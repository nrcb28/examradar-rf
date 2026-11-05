import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyBleDevice, classifyWifiNetwork, THREAT_CATEGORIES } from '../src/core/classifier/classifier-engine.js';

test('classifier: flags magnetic spy earpiece with CRITICAL severity', () => {
  const spyDevice = {
    id: 'AA:BB:CC:11:22:33',
    name: 'Nano-Ear VIP Pro',
    rssi: -54,
  };
  const result = classifyBleDevice(spyDevice);

  assert.equal(result.category.id, 'SPY_EARPIECE');
  assert.equal(result.category.level, 'CRITICAL');
  assert.equal(result.category.score, 95);
  assert.ok(result.confidence >= 0.9);
});

test('classifier: identifies smartwatch via name signature', () => {
  const watch = {
    id: 'BB:CC:DD:22:33:44',
    name: 'Apple Watch Series 9',
    rssi: -62,
  };
  const result = classifyBleDevice(watch);

  assert.equal(result.category.id, 'SMARTWATCH');
  assert.equal(result.category.level, 'HIGH');
  assert.equal(result.category.score, 75);
});

test('classifier: common audio service alone is not a critical spy-device signature', () => {
  const unknownWithService = {
    id: 'CC:DD:EE:33:44:55',
    name: '',
    services: ['0000110b-0000-1000-8000-00805f9b34fb'],
    rssi: -58,
  };
  const result = classifyBleDevice(unknownWithService);

  assert.equal(result.category.id, 'GENERIC_AUDIO');
  assert.equal(result.category.level, 'LOW');
  assert.ok(result.category.score < 50);
});

test('classifier: flags unauthorized tethering Wi-Fi hotspot', () => {
  const hotspot = {
    ssid: 'iPhone de Andrea',
    bssid: '00:11:22:33:44:55',
    rssi: -50,
  };
  const result = classifyWifiNetwork(hotspot);

  assert.equal(result.category.id, 'PORTABLE_HOTSPOT');
  assert.equal(result.category.level, 'HIGH');
});

test('classifier: marks institutional / benign devices with LOW threat score', () => {
  const projector = {
    id: 'FF:EE:DD:00:11:22',
    name: 'Epson Projector 2B',
    rssi: -70,
  };
  const result = classifyBleDevice(projector);

  assert.equal(result.category.id, 'GENERIC_DEVICE');
  assert.equal(result.category.level, 'LOW');
});

test('classifier: short, canonical and compact UUID forms produce equivalent service hints', () => {
  for (const service of [
    '110b', '110B', '0x110B', '0000110b', '0x0000110B',
    '0000110B-0000-1000-8000-00805F9B34FB', '0000110b00001000800000805f9b34fb',
    ' 0000110b-0000-1000-8000-00805f9b34fb ',
  ]) {
    assert.equal(classifyBleDevice({ name: 'Headphones', services: [service] }).category.id, 'GENERIC_AUDIO', service);
  }
  for (const service of [
    '7905F431-B5CE-4E99-A40F-4B1E122D00D0', '7905f431b5ce4e99a40f4b1e122d00d0',
  ]) {
    assert.equal(classifyBleDevice({ services: [service] }).category.id, 'SMARTWATCH', service);
  }
  for (const service of ['x110b', '110b-invalid', '0000110b-0000-1000-8000-00805f9b34f0', '7905f431', '00001101']) {
    assert.equal(classifyBleDevice({ name: 'Projector', services: [service] }).category.id, 'GENERIC_DEVICE', service);
  }
});

test('classifier: service priority is independent of ordering and explicit name hints remain strongest', () => {
  const audio = '110b';
  const ancs = '7905f431-b5ce-4e99-a40f-4b1e122d00d0';
  for (const services of [[audio, ancs], [ancs, audio], [audio, audio, ancs]]) {
    assert.equal(classifyBleDevice({ name: 'Accessory', services }).category.id, 'SMARTWATCH');
    assert.equal(classifyBleDevice({ name: 'VIP-Pro Pen', services }).category.id, 'SPY_EARPIECE');
  }
});

test('classifier: unrelated words, ambiguous model numbers and manufacturer names are not threat signatures', () => {
  for (const name of ['FirmwareOS Sensor', 'spymicroscope', 'Desk-A680-Sensor', 'Garmin Drive 53', 'MyAppleWatchlist', 'fitbitterness']) {
    assert.equal(classifyBleDevice({ name }).category.id, 'GENERIC_DEVICE', name);
  }
  for (const ssid of ['Xiaomi Biblioteca', 'Redmi Campus', 'MyAndroidApplication', 'Semifinal-Library', 'NoTetheringAllowed']) {
    assert.equal(classifyWifiNetwork({ ssid }).category.id, 'GENERIC_DEVICE', ssid);
  }
  assert.equal(classifyBleDevice({ name: 'Garmin Forerunner 965' }).category.id, 'SMARTWATCH');
  assert.equal(classifyWifiNetwork({ ssid: 'Galaxy S24' }).category.id, 'PORTABLE_HOTSPOT');
});

test('classifier: normalizes presentation variants while preserving original observations', () => {
  const device = { name: 'Ａｐｐｌｅ Ｗａｔｃｈ', services: ['180a'], rssi: -65 };
  const result = classifyBleDevice(device);
  assert.equal(result.category.id, 'SMARTWATCH');
  assert.equal(result.device.name, device.name);
  device.services[0] = '110b';
  device.name = 'Changed';
  assert.deepEqual(result.device.services, ['180a']);
  assert.equal(result.device.name, 'Ａｐｐｌｅ Ｗａｔｃｈ');
  for (const ssid of ['Alice’s iPhone', "Alice's iPhone", ' ｉＰｈｏｎｅ ｄｅ Ａｎｄｒｅａ ']) {
    assert.equal(classifyWifiNetwork({ ssid }).category.id, 'PORTABLE_HOTSPOT', ssid);
  }
});

test('classifier: missing names are insufficient to infer a suspicious transmitter', () => {
  for (const name of [undefined, '', '   ', 'unknown', ' Unknown ', 'n/a']) {
    const result = classifyBleDevice({ name });
    assert.equal(result.category.id, 'COVERT_BEACON');
    assert.equal(result.category.level, 'LOW');
    assert.ok(result.category.score < 50);
    assert.equal(result.confidenceType, 'HEURISTIC_NOT_PROBABILITY');
    assert.ok(result.confidence < 0.5);
  }
  assert.throws(() => { THREAT_CATEGORIES.SPY_EARPIECE.score = 0; }, TypeError);
});

test('classifier: public APIs reject malformed or oversized input with explicit errors', () => {
  for (const input of [undefined, null, [], 'device', 123]) {
    assert.throws(() => classifyBleDevice(input), TypeError);
    assert.throws(() => classifyWifiNetwork(input), TypeError);
  }
  for (const name of [null, false, 123, {}]) {
    assert.throws(() => classifyBleDevice({ name }), TypeError);
    assert.throws(() => classifyWifiNetwork({ ssid: name }), TypeError);
  }
  assert.throws(() => classifyBleDevice({ name: 'x'.repeat(257) }), RangeError);
  assert.throws(() => classifyWifiNetwork({ ssid: 'x'.repeat(257) }), RangeError);
  for (const services of [null, '110b', [null], [123], Array(2)]) {
    assert.throws(() => classifyBleDevice({ services }), TypeError);
  }
  assert.throws(() => classifyBleDevice({ services: Array(65).fill('110b') }), RangeError);
  assert.throws(() => classifyBleDevice({ services: ['x'.repeat(65)] }), RangeError);
  for (const rssi of [null, 0, 127, -128, NaN, Infinity, -Infinity, '-60']) {
    assert.throws(() => classifyBleDevice({ name: 'VIP-Pro', rssi }), RangeError);
    assert.throws(() => classifyWifiNetwork({ ssid: 'AndroidAP', rssi }), RangeError);
  }
  assert.equal(classifyBleDevice({ name: 'VIP-Pro', rssi: -127 }).category.id, 'SPY_EARPIECE');
});
