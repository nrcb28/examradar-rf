import test from 'node:test';
import assert from 'node:assert/strict';
import { HardwareScanner } from '../src/core/hardware/ble-scanner.js';
import { MockClassroom } from '../src/core/hardware/mock-classroom.js';

function withBluetooth(t, bluetooth) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { bluetooth } });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor);
    else delete globalThis.navigator;
  });
}

function adapter(request) {
  const listeners = new Set();
  const availabilityListeners = new Set();
  return {
    requestLEScan: request,
    addEventListener(type, listener) {
      (type === 'availabilitychanged' ? availabilityListeners : listeners).add(listener);
    },
    removeEventListener(type, listener) {
      (type === 'availabilitychanged' ? availabilityListeners : listeners).delete(listener);
    },
    listeners,
    availabilityListeners,
    emit(event) { for (const listener of listeners) listener(event); },
  };
}

test('hardware: simulation starts once and stops delivering callbacks', async (t) => {
  const scanner = new HardwareScanner();
  const ticks = [];
  let clears = 0;
  t.mock.method(globalThis, 'setInterval', (callback) => { ticks.push(callback); return 1; });
  t.mock.method(globalThis, 'clearInterval', () => { ++clears; });
  const found = [];
  scanner.onDeviceDiscovered((device) => found.push(device));
  assert.equal(await scanner.startScan(), true);
  assert.equal(await scanner.startScan(), true);
  assert.equal(ticks.length, 1);
  ticks[0]();
  assert.equal(found.length, 4);
  scanner.stopScan();
  ticks[0]();
  assert.equal(found.length, 4);
  assert.equal(clears, 1);
  assert.equal(scanner.isScanning, false);
});

test('hardware: rejects invalid interval and unsupported native scanning', async (t) => {
  const scanner = new HardwareScanner({ useSimulation: false });
  withBluetooth(t, {});
  for (const interval of [0, -1, NaN, Infinity, '800', 99, 100.5, 60001]) {
    await assert.rejects(scanner.startScan(interval), RangeError);
  }
  await assert.rejects(scanner.startScan(), /not supported/);
  assert.equal(scanner.isScanning, false);
});

test('hardware: permission rejection propagates and permits retry', async (t) => {
  let calls = 0;
  let stops = 0;
  const denied = new Error('Permission denied');
  const bluetooth = adapter(async () => {
    if (++calls === 1) throw denied;
    return { stop() { ++stops; } };
  });
  withBluetooth(t, bluetooth);
  const scanner = new HardwareScanner({ useSimulation: false });
  await assert.rejects(scanner.startScan(), (error) => error === denied);
  assert.equal(scanner.isScanning, false);
  assert.equal(await scanner.startScan(), true);
  scanner.stopScan();
  assert.equal(stops, 1);
});

test('hardware: pending and active native starts share one scan and stop removes listener', async (t) => {
  let resolve;
  let calls = 0;
  let stops = 0;
  const bluetooth = adapter((options) => {
    ++calls;
    assert.equal(options.keepRepeatedDevices, true);
    return new Promise((done) => { resolve = done; });
  });
  withBluetooth(t, bluetooth);
  const scanner = new HardwareScanner({ useSimulation: false });
  const found = [];
  scanner.onDeviceDiscovered((device) => found.push(device));
  const first = scanner.startScan();
  const second = scanner.startScan();
  assert.equal(calls, 1);
  assert.equal(scanner.isScanning, false);
  resolve({ stop() { ++stops; } });
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  await scanner.startScan();
  assert.equal(calls, 1);
  assert.equal(bluetooth.listeners.size, 1);
  const lateListener = [...bluetooth.listeners][0];
  const event = { device: { id: 'device', name: 'old' }, name: 'advertised', rssi: -50, uuids: ['service'] };
  bluetooth.emit(event);
  assert.deepEqual(found, [{ id: 'device', name: 'advertised', rssi: -50, services: ['service'] }]);
  scanner.stopScan();
  scanner.stopScan();
  assert.equal(stops, 1);
  assert.equal(bluetooth.listeners.size, 0);
  lateListener(event);
  assert.equal(found.length, 1);
});

test('hardware: stopping during permission request stops late scan without registering a listener', async (t) => {
  let resolve;
  let stops = 0;
  const bluetooth = adapter(() => new Promise((done) => { resolve = done; }));
  withBluetooth(t, bluetooth);
  const scanner = new HardwareScanner({ useSimulation: false });
  const pending = scanner.startScan();
  scanner.stopScan();
  resolve({ stop() { ++stops; } });
  assert.equal(await pending, false);
  assert.equal(stops, 1);
  assert.equal(bluetooth.listeners.size, 0);
  assert.equal(scanner.isScanning, false);
});

test('hardware: cancelled scan resolving after a new start cannot replace the new scan', async (t) => {
  const resolve = [];
  const stops = [0, 0];
  const bluetooth = adapter(() => new Promise((done) => { resolve.push(done); }));
  withBluetooth(t, bluetooth);
  const scanner = new HardwareScanner({ useSimulation: false });
  const oldStart = scanner.startScan();
  scanner.stopScan();
  const newStart = scanner.startScan();
  resolve[1]({ stop() { ++stops[1]; } });
  assert.equal(await newStart, true);
  resolve[0]({ stop() { ++stops[0]; } });
  assert.equal(await oldStart, false);
  assert.equal(scanner.isScanning, true);
  assert.deepEqual(stops, [1, 0]);
  assert.equal(bluetooth.listeners.size, 1);
  scanner.stopScan();
  assert.deepEqual(stops, [1, 1]);
});

test('hardware: a listener stopping a simulation prevents subsequent devices in the same frame', async (t) => {
  let tick;
  t.mock.method(globalThis, 'setInterval', (callback) => { tick = callback; return 1; });
  t.mock.method(globalThis, 'clearInterval', () => {});
  const scanner = new HardwareScanner();
  let calls = 0;
  scanner.onDeviceDiscovered(() => { ++calls; scanner.stopScan(); });
  await scanner.startScan();
  tick();
  assert.equal(calls, 1);
});

test('hardware: failure to register advertisements releases the granted scan', async (t) => {
  let stops = 0;
  const bluetooth = adapter(async () => ({ stop() { ++stops; } }));
  bluetooth.addEventListener = () => { throw new Error('Listener unavailable'); };
  withBluetooth(t, bluetooth);
  const scanner = new HardwareScanner({ useSimulation: false });
  await assert.rejects(scanner.startScan(), /Listener unavailable/);
  assert.equal(stops, 1);
  assert.equal(scanner.isScanning, false);
});

test('hardware: malformed advertisements are ignored without breaking later valid frames', async (t) => {
  const bluetooth = adapter(async () => ({ active: true, stop() {} }));
  withBluetooth(t, bluetooth);
  const scanner = new HardwareScanner({ useSimulation: false });
  t.after(() => scanner.stopScan());
  const found = [];
  scanner.onDeviceDiscovered(device => found.push(device));
  await scanner.startScan();
  for (const event of [null, {}, { device: {} }, { device: { id: 'ok' }, rssi: NaN },
    { device: { id: 'ok' }, rssi: -60, uuids: [null] },
    { device: { id: 'ok' }, rssi: -60, name: {} },
    { device: { id: 'x'.repeat(257) }, rssi: -60 },
    { device: { id: 'ok' }, rssi: 0 },
    { device: { id: 'ok' }, rssi: -60, uuids: Array(65).fill('service') },
    Object.defineProperty({}, 'device', { get() { throw new Error('Bad adapter'); } })]) {
    assert.doesNotThrow(() => bluetooth.emit(event));
  }
  bluetooth.emit({ device: { id: ' valid ' }, rssi: -60 });
  assert.deepEqual(found, [{ id: 'valid', name: '', rssi: -60, services: [] }]);
});

test('hardware: listener mutation is bounded and every listener receives immutable data', async (t) => {
  const scanner = new HardwareScanner();
  t.after(() => scanner.stopScan());
  await scanner.startScan();
  const order = [];
  const third = device => { order.push('third'); assert.equal(device.name, 'Original'); };
  scanner.onDeviceDiscovered(device => {
    order.push('first');
    scanner.onDeviceDiscovered(third);
    unsubscribeSecond();
    assert.ok(Object.isFrozen(device));
    assert.ok(Object.isFrozen(device.services));
    assert.throws(() => { device.name = 'Changed'; }, TypeError);
  });
  const unsubscribeSecond = scanner.onDeviceDiscovered(() => order.push('removed'));
  scanner.onDeviceDiscovered(async () => { throw new Error('Async listener failed'); });
  scanner.onDeviceDiscovered(() => { throw new Error('Sync listener failed'); });
  const raw = { id: 'id', name: 'Original', rssi: -50, services: ['one'] };
  assert.equal(scanner.notifyDevice(raw), true);
  assert.deepEqual(order, ['first']);
  scanner.notifyDevice(raw);
  assert.deepEqual(order, ['first', 'first', 'third']);
  assert.deepEqual(raw.services, ['one']);
  await Promise.resolve();
});

test('hardware: native permission revocation clears state, resources and callbacks', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let stops = 0;
  const scan = { active: true, stop() { ++stops; } };
  const bluetooth = adapter(async () => scan);
  withBluetooth(t, bluetooth);
  const scanner = new HardwareScanner({ useSimulation: false });
  t.after(() => scanner.stopScan());
  await scanner.startScan(100);
  scan.active = false;
  t.mock.timers.tick(100);
  assert.equal(scanner.isScanning, false);
  assert.equal(scanner.scanIntervalId, null);
  assert.equal(stops, 1);
  assert.equal(bluetooth.listeners.size, 0);
  assert.equal(bluetooth.availabilityListeners.size, 0);
  assert.match(scanner.lastError.message, /permission was revoked/);
});

test('hardware: loss of adapter availability immediately stops native scanning', async (t) => {
  const bluetooth = adapter(async () => ({ active: true, stop() {} }));
  withBluetooth(t, bluetooth);
  const scanner = new HardwareScanner({ useSimulation: false });
  t.after(() => scanner.stopScan());
  await scanner.startScan();
  for (const listener of [...bluetooth.availabilityListeners]) listener({ value: false });
  assert.equal(scanner.isScanning, false);
  assert.equal(bluetooth.listeners.size, 0);
  assert.equal(bluetooth.availabilityListeners.size, 0);
});

test('hardware: cleanup tolerates adapters throwing after revocation', async (t) => {
  const failure = new Error('Already revoked');
  const bluetooth = adapter(async () => ({ active: true, stop() { throw failure; } }));
  withBluetooth(t, bluetooth);
  const scanner = new HardwareScanner({ useSimulation: false });
  await scanner.startScan();
  bluetooth.removeEventListener = () => { throw failure; };
  assert.doesNotThrow(() => scanner.stopScan());
  assert.equal(scanner.isScanning, false);
  assert.equal(scanner.scanIntervalId, null);
  assert.equal(scanner.lastError, failure);
  assert.doesNotThrow(() => bluetooth.emit({ device: { id: 'late' }, rssi: -50 }));
});

test('hardware: public configuration and listener limits reject accidental misuse', () => {
  for (const options of [null, [], { useSimulation: 'false' }]) {
    assert.throws(() => new HardwareScanner(options), TypeError);
  }
  const scanner = new HardwareScanner();
  assert.throws(() => scanner.onDeviceDiscovered(null), TypeError);
  for (let i = 0; i < 100; ++i) scanner.onDeviceDiscovered(() => {});
  assert.throws(() => scanner.onDeviceDiscovered(() => {}), RangeError);
});

test('hardware: simulation coordinates reject non-finite values atomically and frames own services', () => {
  const classroom = new MockClassroom();
  classroom.setTeacherPosition(2, 3);
  for (const [x, y] of [[NaN, 3], [2, Infinity], ['2', 3], [null, 3]]) {
    assert.throws(() => classroom.setTeacherPosition(x, y), TypeError);
    assert.deepEqual(classroom.teacherPosition, { x: 2, y: 3 });
  }
  const frame = classroom.generateScanFrame();
  frame[0].services.push('injected');
  assert.equal(classroom.generateScanFrame()[0].services.includes('injected'), false);
  classroom.setTeacherPosition(-100, 1000);
  assert.deepEqual(classroom.teacherPosition, { x: 0, y: 10 });
  assert.ok(classroom.generateScanFrame().every(device => Number.isFinite(device.rssi)));
});

test('hardware: inactive scan grants are released and surfaced as failed starts', async (t) => {
  let stops = 0;
  const bluetooth = adapter(async () => ({ active: false, stop() { ++stops; } }));
  withBluetooth(t, bluetooth);
  const scanner = new HardwareScanner({ useSimulation: false });
  await assert.rejects(scanner.startScan(), /no longer active/);
  assert.equal(stops, 1);
  assert.equal(scanner.isScanning, false);
  assert.equal(scanner.scanIntervalId, null);
  assert.equal(bluetooth.listeners.size, 0);
  assert.match(scanner.lastError.message, /no longer active/);
});
