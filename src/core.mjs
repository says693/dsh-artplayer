export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 3];
export const DEFAULTS = Object.freeze({ speed: 1, loop: false, volume: 1, muted: false, rememberProgress: true });
export const PREFERENCES_KEY = 'dsh-artplayer.preferences.v1';
export const PROGRESS_PREFIX = 'dsh-artplayer.progress.';

export function preferences(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (!SPEEDS.includes(value.speed) || !Number.isFinite(value.volume) || value.volume < 0 || value.volume > 1 ||
    ['loop', 'muted', 'rememberProgress'].some(key => typeof value[key] !== 'boolean')) return null;
  return Object.fromEntries(Object.keys(DEFAULTS).map(key => [key, value[key]]));
}

export function mediaURL(input) {
  const url = new URL(input.trim());
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('urlError');
  return url.href;
}

export function isHls(url, mode) {
  return mode === 'hls' || (mode === 'auto' && /\.m3u8$/i.test(new URL(url).pathname));
}

export async function sourceKey(url, crypto = globalThis.crypto) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(url));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function resumeSeconds(seconds, duration) {
  if (!Number.isFinite(seconds) || seconds < 0 || !Number.isFinite(duration) || duration <= 0) return null;
  return seconds >= duration - 3 ? 0 : seconds;
}

export class ResumeGate {
  constructor() { this.reset(); }
  reset(key = null) { this.key = key; this.pending = null; this.applied = false; }
  offer(value) {
    if (!value || !this.key || value.key !== this.key || this.applied ||
      !Number.isFinite(value.seconds) || value.seconds < 0) return false;
    this.pending = value.seconds;
    return true;
  }
  apply(video) {
    if (this.applied || this.pending === null || !video || video.readyState < 1) return false;
    const seconds = resumeSeconds(this.pending, video.duration);
    if (seconds === null) return false;
    for (let index = 0; index < video.seekable.length; index++) {
      if (seconds >= video.seekable.start(index) && seconds <= video.seekable.end(index)) {
        video.currentTime = seconds;
        this.pending = null;
        this.applied = true;
        return true;
      }
    }
    return false;
  }
}

export function progressSnapshot(key, remember, video) {
  if (!key || !remember || !video || video.readyState < 1 ||
    !Number.isFinite(video.duration) || video.duration <= 0 ||
    !Number.isFinite(video.currentTime) || video.currentTime < 0) return null;
  return { key, seconds: video.currentTime, duration: video.duration };
}

export function hlsNoRetryConfig() {
  const config = { enableWorker: false };
  for (const name of ['manifestLoadPolicy', 'playlistLoadPolicy', 'fragLoadPolicy', 'keyLoadPolicy',
    'certLoadPolicy', 'steeringManifestLoadPolicy', 'interstitialAssetListLoadPolicy']) {
    config[name] = { default: {
      maxTimeToFirstByteMs: 15000, maxLoadTimeMs: 30000, timeoutRetry: null, errorRetry: null,
    } };
  }
  return config;
}

export function loadPreferences(storage) {
  const raw = storage.getItem(PREFERENCES_KEY);
  if (raw === null) return { ...DEFAULTS };
  const valid = preferences(JSON.parse(raw));
  if (!valid) throw new Error('preferencesError');
  return valid;
}
