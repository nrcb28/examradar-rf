import test from 'node:test';
import assert from 'node:assert/strict';
import { GeigerEngine } from '../src/core/audio/geiger-synthesizer.js';

function audioContext() {
  const voices = [];
  const gains = [];
  const parameter = () => ({ setValueAtTime() {}, exponentialRampToValueAtTime() {} });
  return {
    state: 'running', currentTime: 1, destination: {}, voices, gains,
    async resume() { this.state = 'running'; },
    async suspend() { this.state = 'suspended'; },
    async close() { this.state = 'closed'; },
    createOscillator() {
      const voice = {
        frequency: parameter(), stopped: [], disconnected: 0,
        connect() {}, start() {}, stop(time) { this.stopped.push(time); },
        disconnect() { ++this.disconnected; },
      };
      voices.push(voice);
      return voice;
    },
    createGain() {
      const gain = { gain: parameter(), disconnected: 0, connect() {}, disconnect() { ++this.disconnected; } };
      gains.push(gain);
      return gain;
    },
  };
}

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

test('geiger: rejected and synchronous resume failures are handled without scheduling voices', async () => {
  for (const resume of [() => Promise.reject(new Error('Gesture required')), () => { throw new Error('Unavailable'); }]) {
    const engine = new GeigerEngine({ audioEnabled: true });
    const context = audioContext();
    context.state = 'suspended';
    context.resume = resume;
    engine.audioContext = context;
    assert.equal(await engine.playClick(), false);
    assert.equal(context.voices.length, 0);
    assert.ok(engine.lastError instanceof Error);
    await engine.stop();
  }
});

test('geiger: concurrent clicks share one resume request', async () => {
  const engine = new GeigerEngine({ audioEnabled: true });
  const context = audioContext();
  context.state = 'suspended';
  let complete;
  let calls = 0;
  context.resume = () => {
    ++calls;
    return new Promise(resolve => { complete = () => { context.state = 'running'; resolve(); }; });
  };
  engine.audioContext = context;
  const first = engine.playClick();
  const second = engine.playClick();
  assert.equal(calls, 1);
  complete();
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  assert.equal(context.voices.length, 2);
  await engine.stop();
});

test('geiger: stop during pending resume prevents delayed sounds and suspends afterwards', async () => {
  const engine = new GeigerEngine({ audioEnabled: true });
  const context = audioContext();
  context.state = 'suspended';
  let complete;
  context.resume = () => new Promise(resolve => { complete = () => { context.state = 'running'; resolve(); }; });
  engine.audioContext = context;
  const pendingClick = engine.playClick();
  const stopped = engine.stop();
  complete();
  assert.equal(await pendingClick, false);
  await stopped;
  assert.equal(context.voices.length, 0);
  assert.equal(context.state, 'suspended');
});

test('geiger: stop immediately disconnects active voices and playback can resume', async () => {
  const engine = new GeigerEngine({ audioEnabled: true });
  const context = audioContext();
  engine.audioContext = context;
  assert.equal(await engine.playClick(), true);
  assert.deepEqual(context.voices[0].stopped, [1.016]);
  const stopped = engine.stop();
  assert.deepEqual(context.voices[0].stopped, [1.016, undefined]);
  assert.equal(context.voices[0].disconnected, 1);
  assert.equal(context.gains[0].disconnected, 1);
  await stopped;
  assert.equal(await engine.playClick(), true);
  assert.equal(context.voices.length, 2);
  await engine.dispose();
  assert.equal(context.state, 'closed');
  assert.equal(engine.audioContext, null);
});

test('geiger: naturally ended and partially created voices release their audio nodes', async () => {
  const engine = new GeigerEngine({ audioEnabled: true });
  const context = audioContext();
  engine.audioContext = context;
  await engine.playClick();
  context.voices[0].onended();
  assert.equal(context.voices[0].disconnected, 1);
  assert.equal(context.gains[0].disconnected, 1);
  context.createGain = () => { throw new Error('No audio resources'); };
  assert.equal(await engine.playClick(), false);
  assert.equal(context.voices[1].disconnected, 1);
  await engine.stop();
});

test('geiger: suspend and close rejections remain handled during cleanup', async () => {
  const engine = new GeigerEngine();
  const context = audioContext();
  context.suspend = async () => { throw new Error('Suspension failed'); };
  context.close = async () => { throw new Error('Close failed'); };
  engine.audioContext = context;
  await assert.doesNotReject(engine.stop());
  await assert.doesNotReject(engine.dispose());
  assert.equal(engine.audioContext, null);
  assert.match(engine.lastError.message, /Close failed/);
});

test('geiger: haptic API errors and invalid pulse durations are contained', (t) => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let calls = 0;
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true, value: { vibrate() { ++calls; throw new Error('Vibration denied'); } },
  });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor);
    else delete globalThis.navigator;
  });
  const engine = new GeigerEngine();
  for (const pulse of [-1, Infinity, NaN, '15', 1001]) assert.equal(engine.triggerHaptic(pulse), false);
  assert.equal(calls, 0);
  assert.equal(engine.triggerHaptic(15), false);
  assert.equal(calls, 1);
  assert.doesNotThrow(() => engine.stop());
});

test('geiger: invalid options fail clearly and missing or closed audio remains silent', async () => {
  for (const options of [null, [], { audioEnabled: 'yes' }, { hapticEnabled: 1 }]) {
    assert.throws(() => new GeigerEngine(options), TypeError);
  }
  const engine = new GeigerEngine({ audioEnabled: true });
  assert.equal(await engine.playClick(), false);
  engine.audioContext = { state: 'closed' };
  assert.equal(await engine.playClick(), false);
});

test('geiger: stop never calls vibration before a successfully started pulse', async (t) => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const pulses = [];
  let permitted = true;
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true, value: { vibrate(duration) { pulses.push(duration); return permitted; } },
  });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor);
    else delete globalThis.navigator;
  });
  const engine = new GeigerEngine({ hapticEnabled: false });
  await engine.stop();
  engine.updateDistance(NaN);
  assert.equal(engine.triggerHaptic(15), false);
  assert.deepEqual(pulses, []);
  engine.hapticEnabled = true;
  await engine.stop();
  assert.deepEqual(pulses, []);
  permitted = false;
  assert.equal(engine.triggerHaptic(15), false);
  await engine.stop();
  assert.deepEqual(pulses, [15]);
  permitted = true;
  assert.equal(engine.triggerHaptic(15), true);
  engine.hapticEnabled = false;
  await engine.stop();
  await engine.stop();
  assert.deepEqual(pulses, [15, 15, 0]);
});
