import test from 'node:test';
import assert from 'node:assert/strict';
import { GeigerEngine } from '../src/core/audio/geiger-synthesizer.js';

test('geiger: repeated audio initialization reuses an open context', (t) => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  let created = 0;
  class AudioContext {
    constructor() { ++created; this.state = 'suspended'; }
  }
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { AudioContext } });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'window', descriptor);
    else delete globalThis.window;
  });
  const engine = new GeigerEngine();
  const original = engine.initAudio();
  assert.equal(engine.initAudio(), original);
  assert.equal(created, 1);
  original.state = 'running';
  assert.equal(engine.initAudio(), original);
  original.state = 'closed';
  assert.notEqual(engine.initAudio(), original);
  assert.equal(created, 2);
});

test('geiger: distant clicks survive repeated 600 ms scan updates', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const engine = new GeigerEngine();
  t.after(() => engine.stop());
  const click = t.mock.method(engine, 'playClick', () => {});
  engine.updateDistance(5);
  for (let scan = 0; scan < 4; ++scan) {
    t.mock.timers.tick(600);
    engine.updateDistance(5.5);
  }
  assert.equal(click.mock.callCount(), 1);
  assert.equal(engine.currentFrequencyHz, 0.5);
});

test('geiger: haptic threshold follows latest distance without a cadence change', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const engine = new GeigerEngine();
  t.after(() => engine.stop());
  t.mock.method(engine, 'playClick', () => {});
  const haptic = t.mock.method(engine, 'triggerHaptic', () => {});
  engine.updateDistance(1.1);
  t.mock.timers.tick(100);
  assert.equal(haptic.mock.callCount(), 0);
  engine.updateDistance(0.9);
  t.mock.timers.tick(100);
  assert.ok(haptic.mock.callCount() > 0);
  const nearbyCount = haptic.mock.callCount();
  engine.updateDistance(1.1);
  t.mock.timers.tick(100);
  assert.equal(haptic.mock.callCount(), nearbyCount);
});

test('geiger: cadence changes take effect and stop clears timer and distance', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const engine = new GeigerEngine();
  t.after(() => engine.stop());
  const click = t.mock.method(engine, 'playClick', () => {});
  engine.updateDistance(5);
  t.mock.timers.tick(600);
  engine.updateDistance(2);
  t.mock.timers.tick(200);
  assert.equal(click.mock.callCount(), 1);
  assert.equal(engine.currentFrequencyHz, 6);
  engine.stop();
  assert.equal(engine.intervalId, null);
  assert.equal(engine.currentDistanceMeters, null);
  assert.equal(engine.currentFrequencyHz, 0);
  t.mock.timers.tick(5000);
  assert.equal(click.mock.callCount(), 1);
  engine.updateDistance(NaN);
  assert.equal(engine.intervalId, null);
  assert.equal(engine.currentDistanceMeters, null);
});
