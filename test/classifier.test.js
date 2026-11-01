import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyBleDevice, classifyWifiNetwork } from '../src/core/classifier/classifier-engine.js';

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

test('classifier: detects clandestine ANCS and Handsfree UUIDs', () => {
  const unknownWithService = {
    id: 'CC:DD:EE:33:44:55',
    name: '',
    services: ['0000110b-0000-1000-8000-00805f9b34fb'],
    rssi: -58,
  };
  const result = classifyBleDevice(unknownWithService);

  assert.equal(result.category.id, 'SPY_EARPIECE');
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
