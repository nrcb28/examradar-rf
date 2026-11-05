import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  generateIncidentAuditReport,
  generateHtmlIncidentCertificate,
  verifyIncidentAuditReport,
  REPORT_LIMITS,
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
    incidents: [{
      id: 'event-1', timestamp: threat.firstSeen, type: 'ANOMALY_NEW_SUSPECT_DEVICE',
      deviceId: threat.id, deviceName: threat.name, rssi: -40, reason: 'Original',
      category: { id: 'SPY_EARPIECE', label: 'Earpiece', level: 'CRITICAL', score: 95 },
    }],
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

function recomputeChecksum(report) {
  const payload = structuredClone(report);
  delete payload.evidenceIntegrity.hash;
  report.evidenceIntegrity.hash = createHash('sha256').update(JSON.stringify(sortedJsonData(payload))).digest('hex');
  return report;
}

test('incident report: Web Crypto checksum covers the complete detached JSON snapshot', async () => {
  const session = makeSession();
  const pendingReport = generateIncidentAuditReport(session);
  session.incidents[0].category.label = 'Changed while digesting';
  session.incidents.push({ type: 'LATER' });
  const report = await pendingReport;

  assert.equal(report.incidentEvents.length, 1);
  assert.equal(report.incidentEvents[0].category.label, 'Earpiece');
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
    (r) => { r.incidentEvents[0].category.label = 'Altered'; },
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

test('redacted exports use consistent per-report aliases without device names or identifiers in JSON or HTML', async () => {
  const session = makeSession();
  const ble = session.getRecordedThreats()[0];
  ble.id = '00:11:22:33:44:55';
  ble.name = 'Nano-Ear Secret Alice';
  ble.type = 'BLE';
  ble.classification.reason = `A name and identifier: ${ble.name} ${ble.id}`;
  const wifi = { ...structuredClone(ble), type: 'WIFI', name: 'iPhone Secret Bob' };
  wifi.classification.reason = `SSID: ${wifi.name} ${wifi.id}`;
  session.getRecordedThreats = () => [ble, wifi];
  session.trackedDevices = new Map([['BLE', ble], ['WIFI', wifi]]);
  session.incidents = [ble, wifi].map((device, index) => ({
    id: `event-${index}`, timestamp: device.firstSeen, type: 'ANOMALY_NEW_SUSPECT_DEVICE',
    deviceId: device.id, deviceType: device.type, deviceKey: `${device.type}:${device.id}`,
    deviceName: device.name, category: { id: 'SPY_EARPIECE', ...device.classification.category },
    rssi: -40, reason: `Original data: ${device.id} ${device.name}`,
  }));
  const first = await generateIncidentAuditReport(session, { redactIdentifiers: true });
  const second = await generateIncidentAuditReport(session, { redactIdentifiers: true });
  assert.equal(first.reportVersion, 2);
  assert.deepEqual(first.privacy, { redactIdentifiers: true, scheme: 'PER_REPORT_RANDOM' });
  assert.equal(await verifyIncidentAuditReport(first), true);
  assert.equal(await verifyIncidentAuditReport(second), true);
  assert.notEqual(first.threats[0].deviceId, first.threats[1].deviceId);
  assert.notEqual(first.threats[0].deviceId, second.threats[0].deviceId);
  first.threats.forEach((threat, index) => {
    assert.match(threat.deviceId, /^DEV-[a-f0-9-]{36}$/);
    assert.equal(threat.deviceName, threat.deviceId);
    assert.equal(first.incidentEvents[index].deviceId, threat.deviceId);
    assert.equal(first.incidentEvents[index].deviceKey, threat.deviceId);
    assert.equal(first.incidentEvents[index].deviceName, threat.deviceId);
  });
  const json = JSON.stringify(first);
  const html = generateHtmlIncidentCertificate(first);
  for (const original of [ble.id, ble.name, wifi.name, ble.classification.reason, wifi.classification.reason]) {
    assert.equal(json.includes(original), false);
    assert.equal(html.includes(original), false);
  }
  assert.ok(html.includes('metadatos del examen, aula y profesor se conservan'));
  assert.equal(first.sessionMetadata.instructor, session.instructor);
  assert.equal(session.incidents[0].deviceId, ble.id);
  const full = await generateIncidentAuditReport(session);
  assert.equal(full.privacy.redactIdentifiers, false);
  assert.equal(full.threats[0].deviceId, ble.id);
});

test('verifier rejects invalid schemas even when their SHA-256 checksum has been recomputed', async () => {
  const report = await generateIncidentAuditReport(makeSession());
  const mutations = [
    (r) => { r.sessionMetadata.totalDevicesScanned = -1; },
    (r) => { r.sessionMetadata.totalDevicesScanned = 1001; },
    (r) => { r.sessionMetadata.suspiciousThreatsDetected = 0; },
    (r) => { r.timestamp = '2026-02-30T00:00:00.000Z'; },
    (r) => { r.threats[0].threatScore = '95'; },
    (r) => { r.threats[0].confidence = 2; },
    (r) => { r.threats[0].peakRssi = 0; },
    (r) => { r.threats[0].estimatedDistance = '-1 m'; },
    (r) => { r.threats[0].extra = 'hidden data'; },
    (r) => { r.threats.push(structuredClone(r.threats[0])); r.sessionMetadata.suspiciousThreatsDetected = 2; r.sessionMetadata.totalDevicesScanned = 2; },
    (r) => { r.incidentEvents[0].deviceKey = 'WIFI:wrong'; },
    (r) => { r.incidentEvents[0].deviceId = 'unrecorded-device'; r.incidentEvents[0].deviceKey = 'BLE:unrecorded-device'; },
    (r) => { r.incidentEvents[0].type = 'INVENTED_EVENT'; },
    (r) => { r.incidentEvents.push(structuredClone(r.incidentEvents[0])); },
    (r) => { r.privacy.redactIdentifiers = true; r.privacy.scheme = 'PER_REPORT_RANDOM'; },
    (r) => { r.unexpectedTopLevelData = 'unknown'; },
    (r) => { delete r.threats; },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(report);
    mutate(changed);
    recomputeChecksum(changed);
    assert.equal(await verifyIncidentAuditReport(changed), false);
  }
  const arbitrary = { reportVersion: 2, evidenceIntegrity: { algorithm: 'SHA-256', status: 'UNSIGNED_CHECKSUM', hash: '' }, arbitrary: 'payload' };
  recomputeChecksum(arbitrary);
  assert.equal(await verifyIncidentAuditReport(arbitrary), false);
});

test('verifier accepts the previous complete v1 schema while validating its shape', async () => {
  const legacy = await generateIncidentAuditReport(makeSession());
  legacy.reportVersion = 1;
  delete legacy.privacy;
  for (const threat of legacy.threats) {
    delete threat.deviceType;
    delete threat.baselineProfileChanged;
  }
  for (const event of legacy.incidentEvents) {
    delete event.deviceType;
    delete event.deviceKey;
  }
  recomputeChecksum(legacy);
  assert.equal(await verifyIncidentAuditReport(legacy), true);
  legacy.sessionMetadata.totalDevicesScanned = '1';
  recomputeChecksum(legacy);
  assert.equal(await verifyIncidentAuditReport(legacy), false);
});

test('JSON processing enforces depth, node, array, string and UTF-8 byte budgets', async () => {
  const report = await generateIncidentAuditReport(makeSession());
  let deep = {};
  for (let index = 0; index <= REPORT_LIMITS.maxDepth; index++) deep = { nested: deep };
  const invalidStructures = [
    deep,
    Array(REPORT_LIMITS.maxArrayLength + 1).fill(0),
    'x'.repeat(REPORT_LIMITS.maxStringLength + 1),
    Array(1000).fill(Array(200).fill(0)),
    Array(1400).fill('😀'.repeat(1024)),
  ];
  for (const extra of invalidStructures) {
    const oversized = { ...report, extra };
    assert.equal(await verifyIncidentAuditReport(oversized), false);
    assert.throws(() => generateHtmlIncidentCertificate(oversized), RangeError);
  }
});

test('redaction options reject misspellings, inherited flags and accessors instead of exporting originals silently', async () => {
  let accessed = false;
  const getterOption = Object.defineProperty({}, 'redactIdentifiers', {
    enumerable: true, get() { accessed = true; return true; },
  });
  for (const options of [null, true, [], { redactIdentifers: true }, { redactIdentifiers: 'true' },
    Object.create({ redactIdentifiers: true }), getterOption, { [Symbol('redactIdentifiers')]: true }]) {
    await assert.rejects(generateIncidentAuditReport(makeSession(), options), TypeError);
  }
  assert.equal(accessed, false);
});
