import test from 'node:test';
import assert from 'node:assert/strict';
import { rssiToDistance, getProximityZone, evaluateMovementTrend, PROXIMITY_ZONES } from '../src/core/physics/path-loss.js';
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

test('physics: rejects unavailable RSSI and invalid calibration instead of producing false proximity', () => {
  for (const value of [null, undefined, NaN, Infinity, -Infinity, '-45', 0, 127, -128, {}]) {
    assert.equal(rssiToDistance(value), -1);
    assert.equal(evaluateMovementTrend(-60, value), 'STATIONARY');
    assert.equal(evaluateMovementTrend(value, -60), 'STATIONARY');
  }
  for (const value of [0, -1, NaN, Infinity, '2.6', null, Number.MIN_VALUE]) {
    assert.equal(rssiToDistance(-75, -59, value), -1);
  }
  for (const value of [NaN, Infinity, null, '-59', 0, 127, -128]) {
    assert.equal(rssiToDistance(-60, value), -1);
  }
  assert.equal(rssiToDistance(-45, -59, Number.MIN_VALUE), -1);
});

test('physics: proximity zones require positive finite distances and retain exact boundaries', () => {
  for (const value of [null, undefined, NaN, Infinity, -Infinity, 0, -1, '0.1', false, {}]) {
    assert.equal(getProximityZone(value).name, 'FAR');
  }
  assert.equal(getProximityZone(0.6).name, 'IMMEDIATE');
  assert.equal(getProximityZone(0.600001).name, 'DESK');
  assert.equal(getProximityZone(1.8).name, 'DESK');
  assert.equal(getProximityZone(1.800001).name, 'AISLE');
  assert.equal(getProximityZone(4).name, 'AISLE');
  assert.equal(getProximityZone(4.000001).name, 'FAR');
  assert.throws(() => { PROXIMITY_ZONES.IMMEDIATE.maxDist = 100; }, TypeError);
});

test('physics: distance estimates remain monotonic over the supported RSSI interval', () => {
  let previous = Infinity;
  for (let rssi = -127; rssi < 0; rssi++) {
    const distance = rssiToDistance(rssi);
    assert.ok(Number.isFinite(distance) && distance > 0);
    assert.ok(distance <= previous, `RSSI ${rssi}`);
    previous = distance;
  }
  assert.equal(evaluateMovementTrend(-60, -57, 3), 'STATIONARY');
  assert.equal(evaluateMovementTrend(-60, -56.9, 3), 'APPROACHING');
  for (const threshold of [-1, NaN, Infinity, '3', null]) {
    assert.throws(() => evaluateMovementTrend(-60, -61, threshold), RangeError);
  }
});

test('kalman-filter: invalid measurements cannot poison an established filter or its first sample', () => {
  const actual = new RssiKalmanFilter();
  const reference = new RssiKalmanFilter();
  for (const value of [NaN, Infinity, -Infinity, null, '-60', 0, 127, -128]) {
    assert.throws(() => actual.filter(value), RangeError);
    assert.equal(actual.x, null);
  }
  actual.filter(-60);
  reference.filter(-60);
  for (const value of [NaN, Infinity, -Infinity, null, '-60', 0, 127, -128]) {
    assert.throws(() => actual.filter(value), RangeError);
  }
  assert.equal(actual.filter(-65), reference.filter(-65));
  assert.equal(actual.p, reference.p);
  actual.reset();
  assert.equal(actual.filter(-75), -75);
});

test('kalman-filter: validates noise and stays bounded for extreme finite covariance', () => {
  for (const [q, r] of [[-1, 4], [NaN, 4], [Infinity, 4], [0.08, 0], [0.08, -1], [0.08, NaN], [0.08, Infinity], ['0.08', 4], [0.08, null]]) {
    assert.throws(() => new RssiKalmanFilter(q, r), RangeError);
  }
  for (const [q, r] of [[0, 4], [Number.MAX_VALUE, Number.MAX_VALUE], [Number.MIN_VALUE, Number.MIN_VALUE], [0, Number.MAX_VALUE], [Number.MAX_VALUE, Number.MIN_VALUE]]) {
    const filter = new RssiKalmanFilter(q, r);
    for (let index = 0; index < 500; index++) {
      const estimate = filter.filter(index % 2 ? -127 : -0.01);
      assert.ok(Number.isFinite(estimate) && estimate >= -127 && estimate < 0);
      assert.ok(Number.isFinite(filter.p) && filter.p >= 0);
      assert.ok(Number.isFinite(filter.k) && filter.k >= 0 && filter.k <= 1);
    }
  }
});
