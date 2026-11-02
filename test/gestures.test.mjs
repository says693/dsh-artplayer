import test from 'node:test';
import assert from 'node:assert/strict';
import { bindGestures } from '../src/gestures.mjs';

function fixture() {
  const surface = new EventTarget(), video = new EventTarget();
  const windowTarget = new EventTarget(), documentTarget = new EventTarget();
  video.paused = false;
  video.playbackRate = 1.5;
  const tasks = new Map();
  let next = 0, fills = 0, reveals = 0;
  const boosts = [], captures = [];
  surface.setPointerCapture = id => captures.push(id);
  const timers = {
    setTimeout(fn, delay) { assert.equal(delay, 450); tasks.set(++next, fn); return next; },
    clearTimeout(id) { tasks.delete(id); },
  };
  const binding = bindGestures({
    surface, video, windowTarget, documentTarget, timers,
    toggleExpanded: () => fills++, boost: value => boosts.push(value), reveal: () => reveals++,
  });
  const send = (target, type, props = {}) => {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { pointerId: 7, button: 0, isPrimary: true, clientX: 50, clientY: 50, ...props });
    target.dispatchEvent(event);
    return event;
  };
  const down = props => send(surface, 'pointerdown', props);
  const up = props => send(surface, 'pointerup', props);
  const elapsed = () => { for (const [id, fn] of [...tasks]) { tasks.delete(id); fn(); } };
  return {
    surface, video, windowTarget, documentTarget, binding, tasks, boosts, captures, send, down, up, elapsed,
    get fills() { return fills; }, get reveals() { return reveals; },
  };
}

for (const [name, target, event] of [
  ['surface release', 'surface', 'pointerup'],
  ['window release', 'windowTarget', 'pointerup'],
  ['pointer cancellation', 'surface', 'pointercancel'],
  ['window pointer cancellation', 'windowTarget', 'pointercancel'],
  ['lost pointer capture', 'surface', 'lostpointercapture'],
  ['window blur', 'windowTarget', 'blur'],
  ['media pause', 'video', 'pause'],
  ['document visibility change', 'documentTarget', 'visibilitychange'],
]) {
  test(`3× boost restores exactly selected 1.5× on ${name}`, () => {
    const f = fixture();
    f.down();
    assert.equal(f.video.playbackRate, 1.5);
    f.elapsed();
    assert.equal(f.video.playbackRate, 3);
    assert.deepEqual(f.boosts, [true]);
    f.send(f[target], event);
    assert.equal(f.video.playbackRate, 1.5);
    assert.deepEqual(f.boosts, [true, false]);
    assert.equal(f.tasks.size, 0);
    assert.equal(f.fills, 0);
    f.binding.destroy();
  });
}

for (const point of [{ clientX: 1, clientY: 10 }, { clientX: 150, clientY: 90 }, { clientX: 300, clientY: 10 }]) {
  test(`double tap anywhere toggles only page fill at x=${point.clientX}`, () => {
    const f = fixture();
    f.down(point); f.up(point);
    assert.equal(f.fills, 0);
    f.down(point); f.up(point);
    assert.equal(f.fills, 1);
    assert.equal(f.reveals, 2);
    assert.equal(f.video.playbackRate, 1.5);
    assert.equal(f.video.paused, false);
    f.binding.destroy();
  });
}

test('holding is not a tap and cannot combine with the following tap to toggle page fill', () => {
  const f = fixture();
  f.down(); f.up();
  f.down(); f.elapsed(); f.up();
  assert.equal(f.video.playbackRate, 1.5);
  assert.equal(f.fills, 0);
  f.down(); f.up();
  assert.equal(f.fills, 0);
  f.down(); f.up();
  assert.equal(f.fills, 1);
  f.binding.destroy();
});

test('double tap requires proximity; distant taps do not toggle presentation', () => {
  const f = fixture();
  f.down({ clientX: 10 }); f.up({ clientX: 10 });
  f.down({ clientX: 200 }); f.up({ clientX: 200 });
  assert.equal(f.fills, 0);
  f.binding.destroy();
});

test('movement beyond 14px cancels a pending or active hold without generating a tap', () => {
  const f = fixture();
  f.down();
  f.send(f.surface, 'pointermove', { clientX: 65 });
  f.elapsed();
  assert.equal(f.video.playbackRate, 1.5);
  assert.equal(f.tasks.size, 0);
  f.up();
  assert.equal(f.fills, 0);
  f.down(); f.elapsed();
  assert.equal(f.video.playbackRate, 3);
  f.send(f.surface, 'pointermove', { clientY: 65 });
  assert.equal(f.video.playbackRate, 1.5);
  f.up();
  assert.equal(f.fills, 0);
  f.binding.destroy();
});

test('paused video, non-primary pointers and non-left clicks never boost', () => {
  const f = fixture();
  for (const props of [{ isPrimary: false }, { button: 2 }]) {
    f.down(props); f.elapsed();
    assert.equal(f.video.playbackRate, 1.5);
  }
  f.video.paused = true;
  f.down(); f.elapsed();
  assert.equal(f.video.playbackRate, 1.5);
  assert.deepEqual(f.boosts, []);
  f.binding.destroy();
});

test('cancel clears double-tap history and pending timers', () => {
  const f = fixture();
  f.down(); f.up();
  f.binding.cancel();
  f.down(); f.up();
  assert.equal(f.fills, 0);
  f.down();
  f.binding.cancel();
  f.elapsed();
  assert.equal(f.video.playbackRate, 1.5);
  f.binding.destroy();
});

test('dispose restores 1.5× during boost and removes all event listeners and timers', () => {
  const f = fixture();
  f.down(); f.elapsed();
  assert.equal(f.video.playbackRate, 3);
  f.binding.destroy();
  assert.equal(f.video.playbackRate, 1.5);
  assert.deepEqual(f.boosts, [true, false]);
  assert.equal(f.tasks.size, 0);
  f.down(); f.up(); f.down(); f.up(); f.elapsed();
  assert.equal(f.fills, 0);
  assert.equal(f.reveals, 0);
  assert.equal(f.video.playbackRate, 1.5);
  assert.equal(f.tasks.size, 0);
  f.binding.destroy();
  assert.deepEqual(f.boosts, [true, false]);
});

test('dispose cancels a pending hold before its callback can run', () => {
  const f = fixture();
  f.down();
  assert.equal(f.tasks.size, 1);
  f.binding.destroy();
  f.elapsed();
  assert.equal(f.video.playbackRate, 1.5);
  assert.deepEqual(f.boosts, []);
});

test('context menu is prevented on the gesture surface', () => {
  const f = fixture();
  assert.equal(f.send(f.surface, 'contextmenu').defaultPrevented, true);
  f.binding.destroy();
});
