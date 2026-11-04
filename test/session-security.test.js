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
  assert.equal(session.trackedDevices.get('device-1').rssiFiltered, original);
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
  session.ingestDevice(beacon({ services: ['0000110b-0000-1000-8000-00805f9b34fb'] }));
  assert.equal(session.trackedDevices.get('device-1').classification.category.id, 'SPY_EARPIECE');
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
  const minimum = session.trackedDevices.get('device-1').distanceMeters;
  for (let index = 0; index < 20; index++) {
    session.ingestDevice(beacon({ name: 'VIP-Pro', rssi: -90 }));
  }
  const tracked = session.getRecordedThreats()[0];
  assert.equal(tracked.peakRssi, -45);
  assert.equal(tracked.minimumDistanceMeters, minimum);
  assert.ok(tracked.distanceMeters > minimum);
  assert.ok(tracked.rssiFiltered < tracked.peakRssi);
});

test('expired devices leave the active radar while remaining in the historical report', () => {
  const session = new ExamSession({ activeTimeoutMs: 1000 });
  session.startExam();
  session.ingestDevice(beacon({ name: 'VIP-Pro' }));
  session.trackedDevices.get('device-1').lastSeen = new Date(Date.now() - 2000).toISOString();
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
  assert.equal(session.getRecordedThreats()[0].classification.device.services[0], '0000110b-0000-1000-8000-00805f9b34fb');
});
