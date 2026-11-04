import test from 'node:test';
import assert from 'node:assert/strict';
import { HardwareScanner } from '../src/core/hardware/ble-scanner.js';

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
  return {
    requestLEScan: request,
    addEventListener(type, listener) {
      assert.equal(type, 'advertisementreceived');
      listeners.add(listener);
    },
    removeEventListener(type, listener) {
      assert.equal(type, 'advertisementreceived');
      listeners.delete(listener);
    },
    listeners,
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
