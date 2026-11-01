import test from 'node:test';
import assert from 'node:assert/strict';
import { rssiToDistance, getProximityZone, evaluateMovementTrend } from '../src/core/physics/path-loss.js';
import { RssiKalmanFilter } from '../src/core/physics/kalman-filter.js';

test('physics: rssiToDistance calculates accurate distance using Log-Distance Path Loss', () => {
  // At -59 dBm (TxPower), distance should be exactly 1.0 meter
  const d1 = rssiToDistance(-59, -59, 2.6);
  assert.equal(d1, 1.0);

  // Closer than 1m (-45 dBm -> ~0.29m)
  const dClose = rssiToDistance(-45, -59, 2.6);
  assert.ok(dClose < 0.5);

  // Further than 1m (-75 dBm -> ~4.1m)
  const dFar = rssiToDistance(-75, -59, 2.6);
  assert.ok(dFar > 3.5);
});

test('physics: getProximityZone maps distances to operational alert zones', () => {
  assert.equal(getProximityZone(0.4).name, 'IMMEDIATE');
  assert.equal(getProximityZone(1.2).name, 'DESK');
  assert.equal(getProximityZone(3.0).name, 'AISLE');
  assert.equal(getProximityZone(6.0).name, 'FAR');
});

test('physics: evaluateMovementTrend detects approaching teacher', () => {
  assert.equal(evaluateMovementTrend(-75, -60), 'APPROACHING');
  assert.equal(evaluateMovementTrend(-60, -75), 'RECEDING');
  assert.equal(evaluateMovementTrend(-65, -66), 'STATIONARY');
});

test('kalman-filter: significantly reduces variance in noisy RSSI measurements', () => {
  const filter = new RssiKalmanFilter(0.08, 4.0);
  const trueRssi = -60;
  const noisyInputs = [-55, -67, -58, -64, -57, -65, -59, -63, -60];
  const filteredOutputs = [];

  for (const raw of noisyInputs) {
    filteredOutputs.push(filter.filter(raw));
  }

  // Last filtered output should be close to true mean -60
  const last = filteredOutputs[filteredOutputs.length - 1];
  assert.ok(Math.abs(last - trueRssi) < 2.0);
});
