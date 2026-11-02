import test from 'node:test';
import assert from 'node:assert/strict';
import { PlayerController } from '../src/player.mjs';

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
