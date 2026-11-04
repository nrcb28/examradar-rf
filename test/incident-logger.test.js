import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  generateIncidentAuditReport,
  generateHtmlIncidentCertificate,
  verifyIncidentAuditReport,
} from '../src/core/surveillance/incident-logger.js';

function makeSession() {
  const threat = {
    id: 'device-1', name: 'Nano-Ear',
    classification: {
      category: { label: 'Earpiece', level: 'CRITICAL', score: 95 },
      confidence: 0.9, reason: 'Advertised name matches heuristic',
    },
    peakRssi: -40, rssiFiltered: -70, minimumDistanceMeters: 0.25,
    distanceMeters: 2.5, proximityZone: { label: 'Lejos' },
    firstSeen: '2026-01-01T10:00:00.000Z', lastSeen: '2026-01-01T10:01:00.000Z',
    isNewInExam: true,
  };
  return {
    id: 'session-1', examName: 'Física', classroom: 'Aula 1', instructor: 'Profesor',
    startTime: '2026-01-01T10:00:00.000Z',
    trackedDevices: new Map([[threat.id, threat]]), baselineDeviceIds: new Set(['baseline-1']),
    incidents: [{ type: 'ANOMALY', deviceId: threat.id, details: { reason: 'Original' } }],
    getRecordedThreats() { return [threat]; },
  };
}

function sortedJsonData(value) {
  if (Array.isArray(value)) return value.map(sortedJsonData);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortedJsonData(value[key])]));
  }
  return value;
}

test('incident report: Web Crypto checksum covers the complete detached JSON snapshot', async () => {
  const session = makeSession();
  const pendingReport = generateIncidentAuditReport(session);
  session.incidents[0].details.reason = 'Changed while digesting';
  session.incidents.push({ type: 'LATER' });
  const report = await pendingReport;

  assert.equal(report.incidentEvents.length, 1);
  assert.equal(report.incidentEvents[0].details.reason, 'Original');
  assert.notEqual(report.incidentEvents, session.incidents);
  assert.equal(report.threats[0].peakRssi, -40);
  assert.equal(report.threats[0].estimatedDistance, '0.25 m');
  assert.equal(report.evidenceIntegrity.status, 'UNSIGNED_CHECKSUM');
  assert.equal(await verifyIncidentAuditReport(report), true);
  assert.equal(await verifyIncidentAuditReport(JSON.parse(JSON.stringify(report))), true);

  const expectedData = structuredClone(report);
  delete expectedData.evidenceIntegrity.hash;
  const expectedHash = createHash('sha256').update(JSON.stringify(sortedJsonData(expectedData))).digest('hex');
  assert.equal(report.evidenceIntegrity.hash, expectedHash);
});

test('incident report: every exported field is protected against silent changes', async () => {
  const report = await generateIncidentAuditReport(makeSession());
  const changes = [
    (r) => { r.reportId += '-changed'; },
    (r) => { r.timestamp = '2027-01-01T00:00:00.000Z'; },
    (r) => { r.sessionMetadata.examName = 'Altered'; },
    (r) => { r.sessionMetadata.totalDevicesScanned++; },
    (r) => { r.sessionMetadata.totalBaselineDevices++; },
    (r) => { r.sessionMetadata.suspiciousThreatsDetected++; },
    (r) => { r.sessionMetadata.incidentLimitReached = true; },
    (r) => { r.threats[0].peakRssi = -20; },
    (r) => { r.incidentEvents[0].details.reason = 'Altered'; },
    (r) => { r.incidentEvents.push({ type: 'EXTRA' }); },
    (r) => { r.extra = 'Uncovered data'; },
    (r) => { delete r.sessionMetadata.instructor; },
    (r) => { r.evidenceIntegrity.status = 'VERIFIED_CHAIN_OF_CUSTODY'; },
    (r) => { r.evidenceIntegrity.algorithm = 'MD5'; },
    (r) => { r.evidenceIntegrity.extra = 'extra'; },
    (r) => { r.evidenceIntegrity.hash = 'a'.repeat(64); },
  ];
  for (const change of changes) {
    const modified = structuredClone(report);
    change(modified);
    assert.equal(await verifyIncidentAuditReport(modified), false);
  }

  const reordered = Object.fromEntries(Object.entries(report).reverse());
  reordered.sessionMetadata = Object.fromEntries(Object.entries(report.sessionMetadata).reverse());
  assert.equal(await verifyIncidentAuditReport(reordered), true);
});

test('incident report: rejects non-JSON values rather than hashing a different representation', async () => {
  const report = await generateIncidentAuditReport(makeSession());
  const invalidValues = [undefined, NaN, Infinity, 1n, new Date(), () => {}, Symbol('value')];
  for (const value of invalidValues) {
    assert.equal(await verifyIncidentAuditReport({ ...report, extra: value }), false);
  }
  const cycle = structuredClone(report);
  cycle.extra = cycle;
  assert.equal(await verifyIncidentAuditReport(cycle), false);

  const sparse = structuredClone(report);
  sparse.incidentEvents = new Array(1);
  assert.equal(await verifyIncidentAuditReport(sparse), false);

  const accessor = structuredClone(report);
  let accessorRead = false;
  Object.defineProperty(accessor, 'extra', {
    enumerable: true,
    get() { accessorRead = true; return 'unsafe'; },
  });
  assert.equal(await verifyIncidentAuditReport(accessor), false);
  assert.equal(accessorRead, false);
  assert.equal(await verifyIncidentAuditReport(null), false);
  assert.equal(await verifyIncidentAuditReport({}), false);

  const invalidSession = makeSession();
  invalidSession.incidents.push({ rssi: NaN });
  await assert.rejects(generateIncidentAuditReport(invalidSession), TypeError);
});

test('incident certificate: treats every interpolated field as text and blocks scripts', async () => {
  const report = await generateIncidentAuditReport(makeSession());
  const payload = '</title><img src=x onerror="alert(1)"><script>alert(1)</script>&\'';
  report.reportId = payload;
  report.evidenceIntegrity.hash = payload;
  for (const key of ['examName', 'classroom', 'instructor', 'suspiciousThreatsDetected']) {
    report.sessionMetadata[key] = payload;
  }
  for (const key of ['deviceId', 'deviceName', 'category', 'threatLevel', 'threatScore', 'estimatedDistance', 'peakRssi']) {
    report.threats[0][key] = payload;
  }

  const html = generateHtmlIncidentCertificate(report);
  assert.equal(html.includes(payload), false);
  assert.equal(html.includes('<img'), false);
  assert.equal(html.includes('<script'), false);
  assert.ok(html.includes('&lt;/title&gt;&lt;img src=x onerror=&quot;alert(1)&quot;&gt;'));
  assert.ok(html.includes('&amp;&#39;'));
  assert.ok(html.includes('Content-Security-Policy'));
  assert.ok(html.includes("default-src 'none'"));
  assert.ok(html.includes('No es una firma digital'));
  assert.equal(html.includes('VERIFIED_CHAIN_OF_CUSTODY'), false);
});

test('incident report: records zero threats without inventing observations', async () => {
  const session = makeSession();
  session.getRecordedThreats = () => [];
  session.incidents = [];
  const report = await generateIncidentAuditReport(session);
  assert.equal(report.threats.length, 0);
  assert.equal(await verifyIncidentAuditReport(report), true);
  assert.ok(generateHtmlIncidentCertificate(report).includes('No se registraron dispositivos señalados'));
});

test('incident report: discloses incomplete sampling and capped incident logs', async () => {
  const session = makeSession();
  session.incidentLimitReached = true;
  session.deviceLimitReached = true;
  session.baselineLimitReached = true;
  const report = await generateIncidentAuditReport(session);
  assert.equal(report.sessionMetadata.incidentLimitReached, true);
  assert.equal(report.sessionMetadata.deviceLimitReached, true);
  assert.equal(report.sessionMetadata.baselineLimitReached, true);
  assert.equal(await verifyIncidentAuditReport(report), true);
  const html = generateHtmlIncidentCertificate(report);
  assert.ok(html.includes('Registro limitado'));
  assert.ok(html.includes('Muestreo incompleto'));
});
