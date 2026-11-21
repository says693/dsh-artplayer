import test from 'node:test';
import assert from 'node:assert/strict';
import { PlayerController } from '../src/player.mjs';
import { DEFAULTS, PROGRESS_PREFIX, ResumeGate } from '../src/core.mjs';

function pendingPlayer() {
  let rejectPlay;
  const errors = [];
  const player = Object.create(PlayerController.prototype);
  Object.assign(player, {
    playRequest: 0, destroyed: false, failed: false, autoplayAllowed: true,
    art: { video: {
      play: () => new Promise((_resolve, reject) => { rejectPlay = reject; }),
      pause() {},
    }, controls: { show: false } },
    saveProgress() {}, onError: error => errors.push(error),
  });
  return { player, errors, reject: () => rejectPlay(new DOMException('Playback interrupted', 'AbortError')) };
}

test('intentional pause invalidates an outstanding play request without reporting autoplay failure', async () => {
  const { player, errors, reject } = pendingPlayer();
  const request = player.play();
  player.pause();
  reject();
  await request;
  assert.deepEqual(errors, []);
  assert.equal(player.autoplayAllowed, false);
});

test('current playback rejection remains visible and exposes controls', async () => {
  const { player, errors, reject } = pendingPlayer();
  const request = player.play();
  reject();
  await request;
  assert.deepEqual(errors, ['autoplayError']);
  assert.equal(player.art.controls.show, true);
});

test('obsolete playback failure cannot affect a replacement media instance', async () => {
  const { player, errors, reject } = pendingPlayer();
  const request = player.play();
  player.art = { video: {}, controls: { show: false } };
  reject();
  await request;
  assert.deepEqual(errors, []);
});

function resumingPlayer(t) {
  const key = 'source-hash';
  const saved = JSON.stringify({ key, seconds: 75, duration: 100 });
  const storage = new Map([[PROGRESS_PREFIX + key, saved]]);
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    setItem: (name, value) => storage.set(name, value),
  } });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else delete globalThis.localStorage;
  });
  const video = {
    readyState: 1, duration: 100, currentTime: 0,
    seekable: { length: 0, start: () => 0, end: () => 100 },
    pause() {}, removeAttribute() {}, load() {},
  };
  const player = Object.create(PlayerController.prototype);
  Object.assign(player, {
    key, prefs: { ...DEFAULTS }, gate: new ResumeGate(), lastProgress: -Infinity,
    generation: 1, playRequest: 0, destroyed: false, sourceURL: null,
    art: { video, option: {}, destroy() {} }, container: { replaceChildren() {} },
    lifecycle: new AbortController(), onBoost() {}, onError: assert.fail,
  });
  player.gate.reset(key);
  assert.equal(player.gate.offer(JSON.parse(saved)), true);
  assert.equal(player.gate.apply(video), false);
  return { player, video, storage, stored: () => storage.get(PROGRESS_PREFIX + key), saved };
}

for (const action of ['saveProgress', 'pause', 'release', 'destroy']) {
  test(`${action} preserves saved progress while a resume is waiting for seekability`, t => {
    const { player, stored, saved } = resumingPlayer(t);
    player[action]();
    assert.equal(stored(), saved);
  });
}

test('progress saving resumes after the deferred position becomes seekable', t => {
  const { player, video, stored } = resumingPlayer(t);
  video.seekable.length = 1;
  assert.equal(player.gate.apply(video), true);
  assert.equal(video.currentTime, 75);
  video.currentTime = 82;
  player.pause();
  assert.deepEqual(JSON.parse(stored()), { key: player.key, seconds: 82, duration: 100 });
});

function unrememberedPlayer(t) {
  const state = resumingPlayer(t);
  const { player, video } = state;
  player.key = null;
  player.gate.reset();
  player.prefs.rememberProgress = false;
  player.sourceURL = 'https://example.test/current.m3u8';
  video.currentTime = 42;
  let resolve, reject;
  const digest = new Promise((yes, no) => { resolve = yes; reject = no; });
  t.mock.method(globalThis.crypto.subtle, 'digest', (algorithm, bytes) => {
    assert.equal(algorithm, 'SHA-256');
    assert.equal(new TextDecoder().decode(bytes), 'https://example.test/current.m3u8');
    return digest;
  });
  return { ...state, resolve: () => resolve(new Uint8Array([1, 2]).buffer), reject };
}

test('enabling progress for an already open source saves its current position without seeking', async t => {
  const { player, video, storage, resolve } = unrememberedPlayer(t);
  const enabling = player.setPreferences({ ...DEFAULTS });
  assert.equal(player.key, null);
  resolve();
  await enabling;
  assert.equal(player.key, '0102');
  assert.equal(player.gate.key, '0102');
  assert.equal(video.currentTime, 42);
  assert.deepEqual(JSON.parse(storage.get(PROGRESS_PREFIX + player.key)),
    { key: '0102', seconds: 42, duration: 100 });
});

for (const action of ['disable', 'release', 'destroy']) {
  test(`pending progress opt-in cannot save after ${action}`, async t => {
    const { player, storage, resolve, saved } = unrememberedPlayer(t);
    const enabling = player.setPreferences({ ...DEFAULTS });
    if (action === 'disable') player.setPreferences({ ...DEFAULTS, rememberProgress: false });
    else player[action]();
    resolve();
    await enabling;
    assert.equal(player.key, null);
    assert.deepEqual([...storage.values()], [saved]);
  });
}

test('failure to identify the current source when enabling progress is reported', async t => {
  const { player, reject } = unrememberedPlayer(t);
  const errors = [];
  player.onError = error => errors.push(error);
  const enabling = player.setPreferences({ ...DEFAULTS });
  reject(new Error('Crypto unavailable'));
  await enabling;
  assert.equal(player.key, null);
  assert.deepEqual(errors, ['hashError']);
});
