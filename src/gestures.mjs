// One pointer adapter replaces ArtPlayer's touch-only fastForward and gestures.
// Double tap anywhere changes presentation; it never also seeks or pauses.
export function bindGestures({ surface, video, toggleExpanded, boost = () => {}, reveal = () => {},
  windowTarget = window, documentTarget = document, timers = globalThis }) {
  let pointer = null, timer = null, held = false, boosted = false, previousRate = 1, lastTap = null;
  const disposers = [];
  const on = (target, name, handler) => {
    target.addEventListener(name, handler);
    disposers.push(() => target.removeEventListener(name, handler));
  };
  const restore = () => {
    timers.clearTimeout(timer);
    timer = null;
    if (boosted) { boosted = false; video.playbackRate = previousRate; boost(false); }
  };
  const cancel = () => { restore(); pointer = null; lastTap = null; };
  on(surface, 'pointerdown', event => {
    if (event.button !== 0 || event.isPrimary === false) return cancel();
    restore();
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
    held = false;
    surface.setPointerCapture?.(event.pointerId);
    timer = timers.setTimeout(() => {
      if (pointer && !video.paused) {
        held = boosted = true;
        previousRate = video.playbackRate;
        video.playbackRate = 3;
        boost(true);
      }
    }, 450);
  });
  on(surface, 'pointermove', event => {
    if (pointer && Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 14) cancel();
  });
  on(surface, 'pointerup', event => {
    if (!pointer || event.pointerId !== pointer.id) return;
    const start = pointer;
    pointer = null;
    restore();
    if (held) { lastTap = null; return; }
    reveal();
    const time = Date.now();
    if (lastTap && time - lastTap.time < 300 &&
      Math.hypot(start.x - lastTap.x, start.y - lastTap.y) < 40) {
      lastTap = null;
      toggleExpanded();
    } else lastTap = { time, x: start.x, y: start.y };
  });
  on(surface, 'lostpointercapture', () => { restore(); pointer = null; });
  on(surface, 'pointercancel', cancel);
  on(surface, 'contextmenu', event => event.preventDefault());
  on(windowTarget, 'pointerup', restore);
  on(windowTarget, 'pointercancel', cancel);
  on(windowTarget, 'blur', cancel);
  on(documentTarget, 'visibilitychange', cancel);
  on(video, 'pause', cancel);
  return { cancel, destroy() { cancel(); disposers.forEach(dispose => dispose()); } };
}
