import test from 'node:test';
import assert from 'node:assert/strict';
import { RadarRenderer } from '../src/ui/radar-canvas.js';

function canvas() {
  const arcs = [];
  const labels = [];
  const ctx = {
    arcs, labels,
    clearRect() {}, beginPath() {}, fill() {}, stroke() {}, moveTo() {}, lineTo() {}, closePath() {},
    arc(...values) { assert.ok(values.every(Number.isFinite)); assert.ok(values[2] >= 0); arcs.push(values); },
    fillText(...values) { labels.push(values); },
  };
  return { width: 320, height: 320, ctx, getContext: () => ctx };
}

function browserFrames(t, reducedMotion = false) {
  const keys = ['requestAnimationFrame', 'cancelAnimationFrame', 'matchMedia'];
  const descriptors = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
  let nextId = 0;
  const queue = new Map();
  const cancelled = [];
  const values = {
    requestAnimationFrame(callback) { const id = nextId++; queue.set(id, callback); return id; },
    cancelAnimationFrame(id) { cancelled.push(id); queue.delete(id); },
    matchMedia() { return { matches: reducedMotion }; },
  };
  for (const key of keys) Object.defineProperty(globalThis, key, { configurable: true, value: values[key] });
  t.after(() => {
    keys.forEach((key, i) => {
      if (descriptors[i]) Object.defineProperty(globalThis, key, descriptors[i]);
      else delete globalThis[key];
    });
  });
  return {
    queue, cancelled,
    frame(timestamp) {
      const [id, callback] = queue.entries().next().value;
      queue.delete(id);
      callback(timestamp);
    },
  };
}

test('radar: start is idempotent, stop cancels frame id zero, and late frames stay cancelled', (t) => {
  const frames = browserFrames(t);
  const renderer = new RadarRenderer(canvas());
  let draws = 0;
  renderer.draw = () => { ++draws; };
  assert.equal(renderer.start(), true);
  assert.equal(renderer.start(), true);
  assert.equal(draws, 1);
  assert.equal(frames.queue.size, 1);
  const staleFrame = [...frames.queue.values()][0];
  renderer.stop();
  assert.deepEqual(frames.cancelled, [0]);
  assert.equal(frames.queue.size, 0);
  renderer.start();
  staleFrame(100);
  assert.equal(draws, 2);
  assert.equal(frames.queue.size, 1);
  renderer.stop();
});

test('radar: sweep speed depends on elapsed time and restarts discard the hidden interval', (t) => {
  const frames = browserFrames(t);
  const renderer = new RadarRenderer(canvas());
  renderer.start();
  frames.frame(0);
  frames.frame(50);
  assert.ok(Math.abs(renderer.sweepAngle - 0.12) < 1e-10);
  renderer.stop();
  renderer.start();
  frames.frame(10000);
  assert.ok(Math.abs(renderer.sweepAngle - 0.12) < 1e-10);
  frames.frame(10050);
  assert.ok(Math.abs(renderer.sweepAngle - 0.24) < 1e-10);
  frames.frame(11000);
  assert.ok(Math.abs(renderer.sweepAngle - 0.48) < 1e-10);
  renderer.stop();
});

test('radar: unsupported conic gradients use a drawable fallback with valid inputs', () => {
  const target = canvas();
  const renderer = new RadarRenderer(target);
  assert.equal(renderer.draw(), true);
  assert.equal(target.ctx.arcs.length, 7);
  target.ctx.createConicGradient = () => { throw new Error('Not supported'); };
  assert.equal(renderer.draw(), true);
});

test('radar: reduced motion renders once without scheduling animation', (t) => {
  const frames = browserFrames(t, true);
  const renderer = new RadarRenderer(canvas());
  let draws = 0;
  renderer.draw = () => { ++draws; };
  assert.equal(renderer.start(), false);
  assert.equal(draws, 1);
  assert.equal(frames.queue.size, 0);
});

test('radar: malformed inputs are skipped and valid blips are immutable snapshots', () => {
  const target = canvas();
  const renderer = new RadarRenderer(target);
  const valid = { name: '<script>text</script>', distanceMeters: 2, classification: { category: { score: 95 } } };
  const hostile = Object.defineProperty({}, 'name', { get() { throw new Error('Invalid'); } });
  assert.equal(renderer.setDevices([null, {}, hostile, { ...valid, distanceMeters: NaN },
    { ...valid, distanceMeters: -1 }, { ...valid, classification: { category: { score: Infinity } } }, valid]), 1);
  valid.name = 'Changed';
  valid.distanceMeters = Infinity;
  valid.classification.category.score = -1;
  assert.equal(renderer.draw(), true);
  assert.equal(target.ctx.labels[0][0], '<script>text</script>');
  assert.ok(Object.isFrozen(renderer.devices));
  assert.throws(() => renderer.setDevices(null), TypeError);
  assert.throws(() => renderer.setDevices(Array(1001).fill(valid)), RangeError);
});

test('radar: absent contexts fail clearly and undersized or lost canvases are safe', () => {
  for (const target of [null, {}, { getContext: () => null }]) {
    assert.throws(() => new RadarRenderer(target), TypeError);
  }
  const target = canvas();
  const renderer = new RadarRenderer(target);
  target.width = 20;
  assert.equal(renderer.draw(), false);
  target.width = 320;
  target.ctx.isContextLost = () => true;
  assert.equal(renderer.draw(), false);
});

test('radar: draw failures stop the animation rather than leaving a phantom running state', (t) => {
  const frames = browserFrames(t);
  const renderer = new RadarRenderer(canvas());
  renderer.start();
  renderer.draw = () => { throw new Error('Context unavailable'); };
  assert.throws(() => frames.frame(100), /Context unavailable/);
  assert.equal(renderer.animationId, null);
  assert.equal(frames.queue.size, 0);
  renderer.draw = () => {};
  assert.equal(renderer.start(), true);
  assert.equal(frames.queue.size, 1);
  renderer.stop();
});
