import Artplayer from 'artplayer';
import Hls from 'hls.js';
import { bindGestures } from './gestures.mjs';
import { preferences, mediaURL, isHls, sourceKey, ResumeGate, progressSnapshot, hlsNoRetryConfig, PROGRESS_PREFIX } from './core.mjs';

export class PlayerController {
  constructor({ container, locale = 'en', preferences: initial, onError, onBoost, onSource,
    onPreferences, onToggleExpanded, onControls = () => {} }) {
    this.container = container;
    this.locale = locale;
    this.prefs = preferences(initial);
    if (!this.prefs) throw new Error('preferencesError');
    Object.assign(this, { onError, onBoost, onSource, onPreferences, onToggleExpanded, onControls });
    this.art = null;
    this.hls = null;
    this.gestures = null;
    this.objectURL = null;
    this.key = null;
    this.generation = 0;
    this.playRequest = 0;
    this.destroyed = false;
    this.failed = false;
    this.autoplayAllowed = false;
    this.rotation = 0;
    this.lastProgress = 0;
    this.gate = new ResumeGate();
    this.lifecycle = new AbortController();
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.pause(); }, { signal: this.lifecycle.signal });
    window.addEventListener('pagehide', () => this.pause(), { signal: this.lifecycle.signal });
    Artplayer.RECONNECT_TIME_MAX = 0;
    Artplayer.DBCLICK_FULLSCREEN = false;
    Artplayer.MOBILE_DBCLICK_PLAY = false;
    Artplayer.MOBILE_CLICK_PLAY = false;
    Artplayer.CONTEXTMENU = false;
    Artplayer.LOG_VERSION = false;
  }

  checkpoint() { return progressSnapshot(this.key, this.prefs.rememberProgress, this.art?.video); }

  saveProgress(force = false) {
    const snapshot = this.checkpoint();
    if (!snapshot || (!force && performance.now() - this.lastProgress < 4000)) return;
    this.lastProgress = performance.now();
    try { localStorage.setItem(PROGRESS_PREFIX + snapshot.key, JSON.stringify(snapshot)); }
    catch { this.onError('storageError'); }
  }

  release() {
    ++this.playRequest;
    this.saveProgress(true);
    this.gestures?.destroy();
    this.gestures = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.hls) { this.hls.stopLoad(); this.hls.destroy(); this.hls = null; }
    const old = this.art;
    this.art = null;
    if (old) {
      old.video.pause();
      old.video.removeAttribute('src');
      old.video.load();
      old.destroy();
    }
    if (this.objectURL) URL.revokeObjectURL(this.objectURL);
    this.objectURL = null;
    this.key = null;
    this.gate.reset();
    this.container.replaceChildren();
    this.onBoost(false);
  }

  fail(code, current = this.art) {
    if (current !== this.art || this.destroyed) return;
    this.failed = true;
    ++this.playRequest;
    this.autoplayAllowed = false;
    this.gestures?.cancel();
    if (this.hls) { this.hls.stopLoad(); this.hls.destroy(); this.hls = null; }
    current?.video.pause();
    if (current) { current.loading.show = false; current.controls.show = true; }
    this.onError(code);
  }

  async open({ url: input, mode = 'auto', file = null }) {
    if (this.destroyed) return false;
    let url;
    try {
      if (file && /\.m3u8$/i.test(file.name)) throw new Error('localHlsError');
      url = file ? null : mediaURL(input);
    } catch (error) { this.onError(error.message === 'localHlsError' ? error.message : 'urlError'); return false; }
    const generation = ++this.generation;
    this.release();
    this.failed = false;
    this.autoplayAllowed = true;
    this.rotation = 0;
    this.onError(null);
    let key = null;
    if (!file && this.prefs.rememberProgress) {
      try { key = await sourceKey(url); }
      catch { if (generation === this.generation) this.onError('hashError'); return false; }
    }
    if (this.destroyed || generation !== this.generation) return false;
    if (file) { url = URL.createObjectURL(file); this.objectURL = url; }
    this.key = key;
    this.gate.reset(key);
    if (key && this.prefs.rememberProgress) {
      try {
        const saved = localStorage.getItem(PROGRESS_PREFIX + key);
        if (saved !== null && !this.gate.offer(JSON.parse(saved))) throw new Error('progressError');
      } catch { this.onError('progressError'); return false; }
    }
    try {
      const current = new Artplayer({
        container: this.container, url: '', lang: this.locale.startsWith('zh') ? 'zh-cn' : 'en',
        theme: '#ffffff', volume: this.prefs.volume, muted: this.prefs.muted, autoplay: false,
        fullscreen: false, fullscreenWeb: false, autoOrientation: false, autoMini: false,
        pip: false, airplay: false, hotkey: false, setting: false, playbackRate: false,
        lock: false, gesture: false, fastForward: false, autoPlayback: false,
        playsInline: true, loop: false, miniProgressBar: true,
        moreVideoAttr: { controls: false, preload: 'metadata', disablePictureInPicture: true },
      });
      this.art = current;
      const active = () => this.art === current && generation === this.generation && !this.destroyed;
      current.storage.get = () => undefined;
      current.storage.set = () => {};
      this.applyPreferences();
      const surface = document.createElement('div');
      surface.className = 'dsh-artplayer-gesture-surface';
      surface.dataset.testid = 'gesture-surface';
      surface.setAttribute('aria-hidden', 'true');
      current.template.$player.append(surface);
      this.gestures = bindGestures({
        surface, video: current.video, toggleExpanded: () => this.onToggleExpanded(),
        reveal: () => { current.controls.show = true; },
        boost: value => this.onBoost(value),
      });
      current.proxy(current.template.$player, 'focusin', () => { current.controls.show = true; });
      const control = current.controls.playAndPause;
      control.setAttribute('role', 'button');
      control.tabIndex = 0;
      control.setAttribute('aria-label', this.locale.startsWith('zh') ? '播放 / 暂停' : 'Play / pause');
      const toggle = event => {
        event.preventDefault(); event.stopImmediatePropagation();
        if (current.video.paused) this.play(); else this.pause();
      };
      current.proxy(control, 'click', toggle, true);
      current.proxy(control, 'keydown', event => { if (['Enter', ' '].includes(event.key)) toggle(event); });
      const progress = current.template.$progress;
      progress.tabIndex = 0;
      progress.setAttribute('role', 'slider');
      progress.setAttribute('aria-label', this.locale.startsWith('zh') ? '播放进度' : 'Playback position');
      progress.setAttribute('aria-valuemin', '0');
      const updatePosition = () => {
        progress.setAttribute('aria-valuemax', String(Number.isFinite(current.duration) ? current.duration : 0));
        progress.setAttribute('aria-valuenow', String(current.currentTime || 0));
      };
      current.proxy(progress, 'keydown', event => {
        if (!Number.isFinite(current.duration) || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        current.seek = event.key === 'Home' ? 0 : event.key === 'End' ? current.duration
          : Math.max(0, Math.min(current.duration, current.currentTime + (event.key === 'ArrowLeft' ? -10 : 10)));
      });
      for (const event of ['loadedmetadata', 'durationchange', 'progress', 'canplay', 'timeupdate']) {
        current.on(`video:${event}`, () => {
          if (!active()) return;
          if (this.prefs.rememberProgress) this.gate.apply(current.video);
          updatePosition();
        });
      }
      current.on('video:timeupdate', () => { if (active()) this.saveProgress(); });
      for (const event of ['pause', 'ended']) {
        current.on(`video:${event}`, () => { if (active()) { this.gestures?.cancel(); this.saveProgress(true); } });
      }
      current.on('video:loadedmetadata', () => {
        if (active()) { current.video.playbackRate = this.prefs.speed; this.rotate(0); }
      });
      current.on('video:error', () => { if (active()) this.fail('mediaError', current); });
      current.on('video:volumechange', () => {
        if (!active()) return;
        if (this.prefs.volume !== current.video.volume || this.prefs.muted !== current.video.muted) {
          this.prefs = { ...this.prefs, volume: current.video.volume, muted: current.video.muted };
          this.onPreferences(this.prefs);
        }
      });
      current.on('control', value => { if (active()) this.onControls(value); });
      current.once('video:canplay', () => {
        if (active() && this.autoplayAllowed && !document.hidden) this.play();
      });
      current.on('video:playing', () => { if (active() && !this.failed) this.onError(null); });
      this.resizeObserver = new ResizeObserver(() => this.rotate(0));
      this.resizeObserver.observe(this.container);
      this.onSource(file ? file.name : null);
      if (!file && isHls(url, mode)) {
        if (!Hls.isSupported()) { this.fail('hlsUnsupported', current); return false; }
        this.hls = new Hls(hlsNoRetryConfig());
        this.hls.on(Hls.Events.ERROR, (_event, data) => {
          const bufferNotice = [Hls.ErrorDetails.BUFFER_STALLED_ERROR, Hls.ErrorDetails.BUFFER_NUDGE_ON_STALL,
            Hls.ErrorDetails.BUFFER_SEEK_OVER_HOLE].includes(data.details);
          if (active() && (data.fatal || data.type === Hls.ErrorTypes.NETWORK_ERROR ||
            (data.type === Hls.ErrorTypes.MEDIA_ERROR && !bufferNotice))) this.fail('hlsError', current);
        });
        this.hls.loadSource(url);
        this.hls.attachMedia(current.video);
      } else current.url = url;
      return true;
    } catch { this.release(); this.onError('mediaError'); return false; }
  }

  applyPreferences() {
    if (!this.art) return;
    this.gestures?.cancel();
    const video = this.art.video;
    video.playbackRate = this.prefs.speed;
    video.volume = this.prefs.volume;
    video.muted = this.prefs.muted;
    video.loop = this.prefs.loop;
    video.disablePictureInPicture = true;
    this.art.option.loop = false;
  }

  setPreferences(value) {
    const valid = preferences(value);
    if (!valid) throw new Error('preferencesError');
    this.prefs = valid;
    if (!valid.rememberProgress) this.gate.reset(this.key);
    this.applyPreferences();
  }

  async play() {
    const current = this.art;
    if (!current || this.destroyed || this.failed) return;
    const request = ++this.playRequest;
    this.autoplayAllowed = true;
    try { await current.video.play(); }
    catch {
      if (request === this.playRequest && current === this.art && !this.destroyed && !this.failed) {
        current.controls.show = true;
        this.onError('autoplayError');
      }
    }
  }

  pause() {
    ++this.playRequest;
    this.autoplayAllowed = false;
    this.gestures?.cancel();
    this.art?.video.pause();
    this.saveProgress(true);
  }

  rotate(delta = 90) {
    this.rotation = (this.rotation + delta + 360) % 360;
    if (!this.art) return;
    const { width, height } = this.container.getBoundingClientRect();
    const sideways = this.rotation % 180 !== 0;
    Object.assign(this.art.video.style, {
      width: sideways ? `${height}px` : '100%', height: sideways ? `${width}px` : '100%',
      left: '50%', top: '50%', transform: `translate(-50%, -50%) rotate(${this.rotation}deg)`,
      objectFit: 'contain',
    });
  }

  destroy() {
    if (this.destroyed) return;
    ++this.generation;
    this.release();
    this.destroyed = true;
    this.lifecycle.abort();
  }
}
