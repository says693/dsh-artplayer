import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import {
  DEFAULTS, SPEEDS, PREFERENCES_KEY, PROGRESS_PREFIX, preferences, mediaURL, isHls,
  sourceKey, resumeSeconds, ResumeGate, progressSnapshot, hlsNoRetryConfig, loadPreferences,
} from '../src/core.mjs';

test('preferences accepts full valid contract, strips unknown keys, rejects coercion/missing fields', () => {
  assert.deepEqual(preferences({ ...DEFAULTS, speed: 1.5, volume: 0.42, extra: 'discard' }),
    { ...DEFAULTS, speed: 1.5, volume: 0.42 });
  for (const invalid of [
    null, [], {}, { ...DEFAULTS, speed: '1.5' }, { ...DEFAULTS, speed: 2.5 },
    { ...DEFAULTS, volume: NaN }, { ...DEFAULTS, volume: Infinity },
    { ...DEFAULTS, volume: -0.01 }, { ...DEFAULTS, volume: 1.01 },
    { ...DEFAULTS, loop: 1 }, { ...DEFAULTS, muted: 'false' },
    { ...DEFAULTS, rememberProgress: null },
  ]) assert.equal(preferences(invalid), null);
  for (const speed of SPEEDS) assert.equal(preferences({ ...DEFAULTS, speed }).speed, speed);
});

test('media URL accepts HTTP(S) and rejects malformed URLs, local schemes and embedded credentials', () => {
  assert.equal(mediaURL(' https://example.test/video.webm?a=1 '), 'https://example.test/video.webm?a=1');
  assert.equal(mediaURL('http://localhost:4000/video'), 'http://localhost:4000/video');
  for (const invalid of ['', 'not a URL', '/relative', 'file:///video.mp4', 'javascript:alert(1)',
    'data:video/webm,test', 'ftp://example.test/video', 'https://name:password@example.test/video']) {
    assert.throws(() => mediaURL(invalid), /urlError|Invalid URL/);
  }
});

test('HLS selection honors explicit mode and extension pathname, not query text', () => {
  assert.equal(isHls('https://example.test/live', 'hls'), true);
  assert.equal(isHls('https://example.test/PLAYLIST.M3U8?token=test', 'auto'), true);
  assert.equal(isHls('https://example.test/live?name=.m3u8', 'auto'), false);
  assert.equal(isHls('https://example.test/list.m3u8', 'video'), false);
});

test('source identity is exact SHA-256, never the original URL, and crypto failures propagate', async () => {
  const url = 'https://example.test/video?token=synthetic-test-only';
  const digest = await sourceKey(url, webcrypto);
  assert.equal(digest, createHash('sha256').update(url).digest('hex'));
  assert.match(digest, /^[a-f0-9]{64}$/);
  assert.notEqual(await sourceKey(`${url}2`, webcrypto), digest);
  await assert.rejects(sourceKey(url, { subtle: { digest() { throw new Error('crypto unavailable'); } } }),
    /crypto unavailable/);
});

test('resume normalizes finished videos and rejects invalid times/durations', () => {
  assert.equal(resumeSeconds(20, 100), 20);
  assert.equal(resumeSeconds(97, 100), 0);
  assert.equal(resumeSeconds(101, 100), 0);
  for (const [seconds, duration] of [[-1, 100], [NaN, 100], [Infinity, 100], [2, Infinity], [2, 0], [2, -1]]) {
    assert.equal(resumeSeconds(seconds, duration), null);
  }
});

test('resume gate validates identity, waits for metadata and seekability, applies only once', () => {
  const gate = new ResumeGate();
  assert.equal(gate.offer({ key: 'key', seconds: 20 }), false);
  gate.reset('key');
  for (const value of [null, {}, { key: 'wrong', seconds: 20 }, { key: 'key', seconds: -1 }]) {
    assert.equal(gate.offer(value), false);
  }
  assert.equal(gate.offer({ key: 'key', seconds: 20 }), true);
  const video = { readyState: 0, duration: 100, currentTime: 0,
    seekable: { length: 1, start: () => 10, end: () => 80 } };
  assert.equal(gate.apply(video), false);
  video.readyState = 1;
  video.seekable.length = 0;
  assert.equal(gate.apply(video), false);
  video.seekable.length = 1;
  assert.equal(gate.apply(video), true);
  assert.equal(video.currentTime, 20);
  assert.equal(gate.offer({ key: 'key', seconds: 30 }), false);
  assert.equal(gate.apply(video), false);
  gate.reset('new-key');
  assert.equal(gate.apply(video), false);
});

test('resume gate does not seek outside live intervals and can apply once an interval becomes available', () => {
  const gate = new ResumeGate();
  gate.reset('key');
  gate.offer({ key: 'key', seconds: 40 });
  const video = { readyState: 2, duration: 100, currentTime: 0,
    seekable: { length: 2, start: i => i ? 60 : 10, end: i => i ? 90 : 30 } };
  assert.equal(gate.apply(video), false);
  assert.equal(video.currentTime, 0);
  video.seekable = { length: 1, start: () => 30, end: () => 80 };
  assert.equal(gate.apply(video), true);
  assert.equal(video.currentTime, 40);
});

test('checkpoint only persists finite loaded progress under a source key with opt-in', () => {
  const video = { readyState: 2, currentTime: 12, duration: 100 };
  assert.deepEqual(progressSnapshot('hash', true, video), { key: 'hash', seconds: 12, duration: 100 });
  assert.equal(progressSnapshot(null, true, video), null);
  assert.equal(progressSnapshot('hash', false, video), null);
  assert.equal(progressSnapshot('hash', true, null), null);
  for (const patch of [{ readyState: 0 }, { currentTime: -1 }, { currentTime: NaN }, { duration: Infinity }, { duration: 0 }]) {
    assert.equal(progressSnapshot('hash', true, { ...video, ...patch }), null);
  }
  assert.notEqual(PREFERENCES_KEY, PROGRESS_PREFIX);
});

test('all configured HLS request policies explicitly disable timeout/error retries', () => {
  const config = hlsNoRetryConfig();
  assert.equal(config.enableWorker, false);
  for (const name of ['manifestLoadPolicy', 'playlistLoadPolicy', 'fragLoadPolicy', 'keyLoadPolicy',
    'certLoadPolicy', 'steeringManifestLoadPolicy', 'interstitialAssetListLoadPolicy']) {
    assert.deepEqual(config[name].default, {
      maxTimeToFirstByteMs: 15000, maxLoadTimeMs: 30000, timeoutRetry: null, errorRetry: null,
    });
  }
});

test('storage defaults only on absent preferences, while corrupt or unavailable storage fails visibly', () => {
  assert.deepEqual(loadPreferences({ getItem: key => { assert.equal(key, PREFERENCES_KEY); return null; } }), DEFAULTS);
  assert.deepEqual(loadPreferences({ getItem: () => JSON.stringify({ ...DEFAULTS, speed: 1.5 }) }),
    { ...DEFAULTS, speed: 1.5 });
  assert.throws(() => loadPreferences({ getItem: () => '{}' }), /preferencesError/);
  assert.throws(() => loadPreferences({ getItem: () => '{invalid' }), SyntaxError);
  assert.throws(() => loadPreferences({ getItem() { throw new Error('storage denied'); } }), /storage denied/);
});
