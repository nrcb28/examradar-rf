import test from 'node:test';
import assert from 'node:assert/strict';
import { ExamSession, SESSION_STATES } from '../src/core/surveillance/exam-session.js';

const beacon = (overrides = {}) => ({ id: 'device-1', name: 'Projector', rssi: -70, ...overrides });

test('session rejects malformed advertisements without poisoning valid measurements', () => {
  const session = new ExamSession();
  session.startExam();
  const original = session.ingestDevice(beacon()).device.rssiFiltered;
  const invalid = [
    null, [], {}, beacon({ id: '' }), beacon({ id: 1 }), beacon({ id: 'x'.repeat(257) }),
    ...[NaN, Infinity, -Infinity, 0, 127, -128, '-70', null].map((rssi) => beacon({ rssi })),
    beacon({ name: {} }), beacon({ name: 'x'.repeat(257) }), beacon({ ssid: [] }),
    beacon({ type: 'UNKNOWN' }), beacon({ services: 'invalid' }), beacon({ services: [null] }),
    beacon({ services: ['x'.repeat(65)] }), beacon({ services: Array(65).fill('180a') }),
    beacon({ services: Array(2) }),
  ];
  for (const raw of invalid) {
    assert.equal(session.ingestDevice(raw).status, 'REJECTED_INVALID_DEVICE');
  }
  assert.equal(session.trackedDevices.size, 1);
  assert.equal(session.getTrackedDevice('device-1').rssiFiltered, original);
  assert.equal(session.ingestDevice(beacon({ rssi: -65 })).status, 'TRACKED');
});

test('session classifies Wi-Fi hotspot advertisements by SSID and simulator name', () => {
  const session = new ExamSession();
  session.startExam();
  for (const raw of [
    beacon({ id: 'wifi-1', type: 'WIFI', ssid: 'iPhone de Andrea' }),
    beacon({ id: 'wifi-2', type: 'WIFI', name: 'AndroidAP' }),
  ]) {
    assert.equal(session.ingestDevice(raw).device.classification.category.id, 'PORTABLE_HOTSPOT');
  }
  assert.equal(session.getActiveThreats().length, 2);
});

test('session detects a benign transmitter changing its advertised name or services once', () => {
  const session = new ExamSession();
  session.startExam();
  session.ingestDevice(beacon());
  session.ingestDevice(beacon({ name: 'VIP-Pro' }));
  session.ingestDevice(beacon());
  session.ingestDevice(beacon({ services: ['7905f431-b5ce-4e99-a40f-4b1e122d00d0'] }));
  assert.equal(session.getTrackedDevice('device-1').classification.category.id, 'SMARTWATCH');
  assert.equal(session.incidents.length, 1);
  assert.equal(session.incidents[0].type, 'ANOMALY_DEVICE_RECLASSIFIED');
  session.ingestDevice(beacon());
  assert.equal(session.getActiveThreats().length, 0);
  assert.equal(session.getRecordedThreats()[0].name, 'VIP-Pro');
  assert.equal(session.getRecordedThreats()[0].classification.category.id, 'SPY_EARPIECE');
});

test('session preserves peak RSSI and minimum distance when a transmitter recedes', () => {
  const session = new ExamSession();
  session.startExam();
  session.ingestDevice(beacon({ name: 'VIP-Pro', rssi: -45 }));
  const minimum = session.getTrackedDevice('device-1').distanceMeters;
  for (let index = 0; index < 20; index++) {
    session.ingestDevice(beacon({ name: 'VIP-Pro', rssi: -90 }));
  }
  const tracked = session.getRecordedThreats()[0];
  assert.equal(tracked.peakRssi, -45);
  assert.equal(tracked.minimumDistanceMeters, minimum);
  assert.ok(tracked.distanceMeters > minimum);
  assert.ok(tracked.rssiFiltered < tracked.peakRssi);
});

test('expired devices leave the active radar while remaining in the historical report', (t) => {
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const session = new ExamSession({ activeTimeoutMs: 1000 });
  session.startExam();
  session.ingestDevice(beacon({ name: 'VIP-Pro' }));
  now += 2000;
  assert.equal(session.getActiveThreats().length, 0);
  assert.equal(session.getRecordedThreats().length, 1);
  session.ingestDevice(beacon({ name: 'VIP-Pro' }));
  assert.equal(session.getActiveThreats().length, 1);
});

test('session bounds calibration, device tracking and incident storage with explicit statuses', () => {
  const session = new ExamSession({ maxDevices: 2, maxBaselineDevices: 1, maxIncidents: 1 });
  session.startCalibration();
  assert.equal(session.ingestDevice(beacon()).status, 'BASELINED');
  assert.equal(session.ingestDevice(beacon()).status, 'BASELINED');
  assert.equal(session.ingestDevice(beacon({ id: 'too-many' })).status, 'REJECTED_BASELINE_LIMIT');
  session.startExam();
  assert.equal(session.ingestDevice(beacon({ id: 'spy-1', name: 'VIP-Pro' })).status, 'TRACKED');
  assert.equal(session.ingestDevice(beacon({ id: 'spy-2', name: 'VIP-Pro' })).status, 'TRACKED_INCIDENT_LIMIT');
  assert.equal(session.ingestDevice(beacon({ id: 'spy-3', name: 'VIP-Pro' })).status, 'REJECTED_DEVICE_LIMIT');
  assert.equal(session.ingestDevice(beacon({ id: 'spy-1', name: 'VIP-Pro', rssi: -65 })).device.rssiRaw, -65);
  assert.equal(session.incidents.length, 1);
  assert.equal(session.incidentLimitReached, true);
  assert.equal(session.deviceLimitReached, true);
  assert.equal(session.baselineLimitReached, true);
  assert.equal(session.trackedDevices.size, 2);
  assert.equal(session.baselineDeviceIds.size, 1);
});

test('an active or completed session cannot restart and mix evidence between exams', () => {
  const session = new ExamSession();
  assert.throws(() => session.completeExam(), /active exam/);
  session.startCalibration();
  session.ingestDevice(beacon());
  assert.throws(() => session.startCalibration(), /new session/);
  session.startExam();
  session.ingestDevice(beacon({ id: 'spy', name: 'VIP-Pro' }));
  const startTime = session.startTime;
  assert.throws(() => session.startExam(), /once per session/);
  assert.throws(() => session.startCalibration(), /new session/);
  assert.equal(session.startTime, startTime);
  session.completeExam();
  assert.equal(session.state, SESSION_STATES.COMPLETED);
  assert.equal(session.ingestDevice(beacon()).status, 'IGNORED_IDLE');
  assert.throws(() => session.startExam(), /once per session/);
  assert.throws(() => session.startCalibration(), /new session/);
  assert.equal(session.getRecordedThreats().length, 1);
});

test('session copies untrusted service arrays before retaining classifications', () => {
  const session = new ExamSession();
  session.startExam();
  const raw = beacon({ services: ['0000110b-0000-1000-8000-00805f9b34fb'] });
  session.ingestDevice(raw);
  raw.services[0] = 'changed';
  assert.equal(session.getTrackedDevice('device-1').classification.device.services[0], '0000110b-0000-1000-8000-00805f9b34fb');
});

test('observation and collection snapshots cannot rewrite retained measurements or alerts', () => {
  const session = new ExamSession();
  session.startExam();
  const result = session.ingestDevice(beacon({ name: 'VIP-Pro' }));
  const original = session.getTrackedDevice('device-1');
  for (const snapshot of [result.device, session.getTrackedDevice('device-1'), session.getActiveThreats()[0],
    session.getRecordedThreats()[0], session.trackedDevices.get('BLE:device-1')]) {
    snapshot.name = 'Rewritten';
    snapshot.rssiFiltered = -1;
    snapshot.classification.category.score = 0;
    snapshot.classification.device.services.push('changed');
    assert.equal(Object.hasOwn(snapshot, 'filter'), false);
  }
  session.trackedDevices.clear();
  const events = session.incidents;
  events[0].category.label = 'Rewritten';
  events[0].deviceName = 'Rewritten';
  events.length = 0;
  assert.deepEqual(session.getTrackedDevice('device-1'), original);
  assert.equal(session.totalDevicesScanned, 1);
  assert.equal(session.totalIncidentEvents, 1);
  assert.equal(session.incidents[0].deviceName, 'VIP-Pro');
  assert.notEqual(session.incidents[0].category.label, 'Rewritten');
});

test('BLE and Wi-Fi identities have separate baselines, histories and incident cooldowns', () => {
  const session = new ExamSession();
  session.startCalibration();
  session.ingestDevice(beacon());
  session.baselineDeviceIds.clear();
  session.startExam();
  session.ingestDevice(beacon());
  session.ingestDevice(beacon({ type: 'WIFI', ssid: 'iPhone de Andrea' }));
  assert.equal(session.getTrackedDevice('device-1').type, 'BLE');
  assert.equal(session.getTrackedDevice('device-1', 'WIFI').type, 'WIFI');
  assert.equal(session.getTrackedDevice('device-1').isNewInExam, false);
  assert.equal(session.getTrackedDevice('device-1', 'WIFI').isNewInExam, true);
  assert.equal(session.trackedDevices.size, 2);
  assert.equal(session.baselineDeviceIds.has('BLE:device-1'), true);
  assert.equal(session.baselineDeviceIds.has('WIFI:device-1'), false);
  assert.equal(session.incidents[0].deviceType, 'WIFI');
  assert.equal(session.incidents[0].deviceKey, 'WIFI:device-1');
});

test('a changed baseline profile cannot suppress a suspicious first exam observation', () => {
  const session = new ExamSession();
  session.startCalibration();
  session.ingestDevice(beacon());
  session.startExam();
  session.ingestDevice(beacon({ name: 'VIP-Pro' }));
  assert.equal(session.getTrackedDevice('device-1').isNewInExam, false);
  assert.equal(session.getTrackedDevice('device-1').baselineProfileChanged, true);
  assert.equal(session.incidents[0].type, 'ANOMALY_BASELINE_PROFILE_CHANGED');
});

test('listeners receive isolated alerts, can unsubscribe, and cannot alter stored evidence', async () => {
  const session = new ExamSession();
  session.startExam();
  const received = [];
  const stop = session.onAlert((alert) => {
    alert.deviceName = 'Changed by first listener';
    alert.category.score = 0;
  });
  session.onAlert(() => { throw new Error('Broken observer'); });
  session.onAlert(async () => { throw new Error('Broken async observer'); });
  session.onAlert((alert) => received.push(alert));
  session.alertListeners.length = 0;
  session.ingestDevice(beacon({ name: 'VIP-Pro' }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(received.length, 1);
  assert.equal(received[0].deviceName, 'VIP-Pro');
  assert.equal(received[0].category.score, 95);
  assert.equal(session.incidents[0].category.score, 95);
  assert.equal(stop(), true);
  assert.equal(stop(), false);
  assert.throws(() => session.onAlert('callback'), TypeError);
});

test('proximity notifications remain rate-limited after incident storage fills', (t) => {
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const session = new ExamSession({ maxIncidents: 1 });
  session.startExam();
  const alerts = [];
  session.onAlert((alert) => alerts.push(alert));
  session.ingestDevice(beacon({ name: 'VIP-Pro', rssi: -30 }));
  assert.equal(alerts.length, 2);
  assert.equal(alerts[0].recorded, true);
  assert.equal(alerts[1].recorded, false);
  for (let index = 0; index < 200; index++) session.ingestDevice(beacon({ name: 'VIP-Pro', rssi: -30 }));
  now += 9999;
  session.ingestDevice(beacon({ name: 'VIP-Pro', rssi: -30 }));
  assert.equal(alerts.length, 2);
  now++;
  session.ingestDevice(beacon({ name: 'VIP-Pro', rssi: -30 }));
  assert.equal(alerts.length, 3);
  assert.equal(alerts[2].type, 'PROXIMITY_IMMEDIATE_ALERT');
  assert.equal(session.incidents.length, 1);
  assert.equal(session.incidentLimitReached, true);
});

test('raw accessors are rejected without executing them and listeners are bounded', () => {
  const session = new ExamSession();
  session.startExam();
  let read = false;
  const raw = beacon();
  Object.defineProperty(raw, 'name', { get() { read = true; return 'VIP-Pro'; } });
  assert.equal(session.ingestDevice(raw).status, 'REJECTED_INVALID_DEVICE');
  const services = [];
  Object.defineProperty(services, '0', { get() { read = true; return '180a'; } });
  assert.equal(session.ingestDevice(beacon({ services })).status, 'REJECTED_INVALID_DEVICE');
  assert.equal(read, false);
  for (let index = 0; index < 64; index++) session.onAlert(() => {});
  assert.throws(() => session.onAlert(() => {}), /listener limit/);
});

test('session identity, metadata, limits and lifecycle cannot be reassigned accidentally', () => {
  const first = new ExamSession();
  const second = new ExamSession();
  assert.notEqual(first.id, second.id);
  for (const property of ['id', 'examName', 'classroom', 'instructor', 'maxDevices', 'state', 'startTime']) {
    assert.throws(() => { first[property] = 'changed'; }, TypeError);
  }
  for (const options of [{ examName: {} }, { classroom: '' }, { instructor: 'x'.repeat(257) },
    { maxDevices: 1001 }, { maxBaselineDevices: 1001 }, { maxIncidents: 5001 }, { activeTimeoutMs: Infinity }]) {
    assert.throws(() => new ExamSession(options));
  }
});

test('HTTP-context sessions use secure getRandomValues UUIDv4 identities when randomUUID is unavailable', (t) => {
  const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  const getRandomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { getRandomValues } });
  t.after(() => Object.defineProperty(globalThis, 'crypto', originalDescriptor));
  t.mock.method(Math, 'random', () => { throw new Error('Insecure randomness must not be used'); });
  const identities = new Set();
  for (let index = 0; index < 200; index++) {
    const session = new ExamSession();
    assert.match(session.id, /^exam_[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
    identities.add(session.id);
    session.startExam();
    assert.equal(session.ingestDevice(beacon()).status, 'TRACKED');
  }
  assert.equal(identities.size, 200);
});

test('session creation fails explicitly when no secure random source is available', (t) => {
  const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {} });
  t.after(() => Object.defineProperty(globalThis, 'crypto', originalDescriptor));
  assert.throws(() => new ExamSession(), /cryptographically secure random number generator/);
});
