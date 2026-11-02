import React from 'react';
import { PlayerController } from './player.mjs';
import { DEFAULTS, SPEEDS, PREFERENCES_KEY, loadPreferences } from './core.mjs';
import { zh, en } from './locales.mjs';
import css from './style.css';

const NS = 'local.artplayer';
export const PANEL_ID = 'dsh-artplayer';
export const inject = ['slots', 'locale', 'layout'];
const paths = {
  close: 'M15 5 8 12l7 7',
  expand: 'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5',
  shrink: 'M3 8h5V3m13 5h-5V3M8 21v-5H3m13 5v-5h5',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  play: 'm9 5 11 7-11 7Z',
};
function Icon({ name }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d={paths[name]} /></svg>;
}
function Button({ title, icon, onClick }) {
  return <button type="button" className="dsh-ap-icon" aria-label={title} title={title} onClick={onClick}><Icon name={icon} /></button>;
}
function PlayerWindow({ t, locale, onClose }) {
  const dialog = React.useRef(null), container = React.useRef(null), controller = React.useRef(null);
  const picker = React.useRef(null);
  const [initial] = React.useState(() => {
    try { return { prefs: loadPreferences(localStorage), error: null }; }
    catch { return { prefs: null, error: 'preferencesError' }; }
  });
  const [prefs, setPrefs] = React.useState(initial.prefs);
  const [error, setError] = React.useState(initial.error);
  const [expanded, setExpanded] = React.useState(false);
  const [menu, setMenu] = React.useState('source');
  const [title, setTitle] = React.useState('');
  const [boost, setBoost] = React.useState(false);
  const [controls, setControls] = React.useState(true);
  const [url, setURL] = React.useState('');
  const [mode, setMode] = React.useState('auto');
  const toggleExpanded = React.useCallback(() => setExpanded(value => !value), []);
  React.useEffect(() => {
    const element = dialog.current;
    if (typeof element.showModal !== 'function') { setError('dialogError'); return; }
    element.showModal();
    return () => { if (element.open) element.close(); };
  }, []);
  React.useEffect(() => {
    if (!prefs) return;
    const player = new PlayerController({
      container: container.current, locale, preferences: prefs,
      onError: setError, onBoost: setBoost,
      onSource: name => setTitle(name || t('direct')),
      onPreferences: setPrefs, onToggleExpanded: toggleExpanded, onControls: setControls,
    });
    controller.current = player;
    return () => { player.destroy(); controller.current = null; };
    // The player instance owns media lifetime; settings update separately.
  }, [Boolean(prefs)]);
  React.useEffect(() => {
    if (!prefs) return;
    controller.current?.setPreferences(prefs);
    try { localStorage.setItem(PREFERENCES_KEY, JSON.stringify(prefs)); }
    catch { setError('storageError'); }
  }, [prefs]);
  const update = (name, value) => setPrefs(previous => ({ ...previous, [name]: value }));
  const open = async value => {
    const player = controller.current;
    if (!player) return;
    if (await player.open(value)) { setMenu(null); setURL(''); }
  };
  const reset = () => {
    try {
      localStorage.removeItem(PREFERENCES_KEY);
      setPrefs({ ...DEFAULTS });
      setError(null);
    } catch { setError('storageError'); }
  };
  const close = () => { controller.current?.pause(); onClose(); };
  return <dialog className="dsh-ap-dialog" data-expanded={expanded} ref={dialog}
    aria-label={t('title')} onCancel={event => { event.preventDefault(); close(); }}>
    <div className="dsh-ap-stage">
      <div className="dsh-ap-video" ref={container} />
      {!title && !menu && <div className="dsh-ap-tip">{t('hint')}</div>}
      <header className="dsh-ap-header" data-hidden={!controls && !menu && Boolean(title)}>
        <Button title={t('close')} icon="close" onClick={close} />
        <span className="dsh-ap-title">{title || t('title')}</span>
        <Button title={t(expanded ? 'shrink' : 'expand')} icon={expanded ? 'shrink' : 'expand'} onClick={toggleExpanded} />
        <Button title={t('more')} icon="more" onClick={() => setMenu(menu ? null : 'settings')} />
      </header>
      {boost && <div className="dsh-ap-boost" role="status">{t('boost')}</div>}
      {menu === 'source' && <section className="dsh-ap-card dsh-ap-source" aria-label={t('source')}>
        <div className="dsh-ap-card-head"><h2>{t('source')}</h2>
          <Button title={t('back')} icon="close" onClick={() => setMenu('settings')} /></div>
        <form onSubmit={event => { event.preventDefault(); open({ url, mode }); }}>
          <input aria-label={t('link')} type="url" value={url} onChange={event => setURL(event.target.value)}
            placeholder={t('urlPlaceholder')} autoComplete="off" spellCheck="false" required />
          <div className="dsh-ap-row">
            <select aria-label={t('mode')} value={mode} onChange={event => setMode(event.target.value)}>
              <option value="auto">{t('auto')}</option><option value="video">{t('video')}</option><option value="hls">HLS</option>
            </select><button type="submit" disabled={!prefs}>{t('play')}</button>
          </div>
        </form>
        <div className="dsh-ap-row"><button type="button" disabled={!prefs} onClick={() => picker.current.click()}>{t('file')}</button></div>
      </section>}
      <input ref={picker} className="dsh-ap-file" type="file" accept="video/*,.mkv,.m3u8"
        onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) open({ file }); }} />
      {menu === 'settings' && <section className="dsh-ap-card" aria-label={t('more')}>
        <div className="dsh-ap-card-head"><h2>{t('more')}</h2><Button title={t('back')} icon="close" onClick={() => setMenu(null)} /></div>
        <button type="button" onClick={() => setMenu('source')}>{t('source')}</button>
        {prefs && <>
          <label>{t('speed')}<select value={prefs.speed} onChange={event => update('speed', Number(event.target.value))}>
            {SPEEDS.map(speed => <option key={speed} value={speed}>{speed}×</option>)}</select></label>
          {['loop', 'muted', 'rememberProgress'].map(name => <label key={name}>
            {t({ loop: 'loop', muted: 'mute', rememberProgress: 'remember' }[name])}
            <input type="checkbox" checked={prefs[name]} onChange={event => update(name, event.target.checked)} /></label>)}
          <button type="button" onClick={() => controller.current?.rotate()}>{t('rotate')}</button>
        </>}
        <p>{t('hint')}</p>
      </section>}
      {error && <div role="alert" className="dsh-ap-error">{t(error)}
        {error === 'preferencesError' && <button type="button" onClick={reset}>{t('reset')}</button>}
        <button type="button" aria-label={t('back')} onClick={() => setError(null)}>×</button>
      </div>}
    </div>
  </dialog>;
}
export function apply(ctx) {
  for (const [language, dictionary] of Object.entries({ en, zh })) {
    ctx.effect(() => ctx.locale.register(NS, language, dictionary));
  }
  const t = ctx.locale.bind(NS);
  function Panel({ t }) {
    const [open, setOpen] = React.useState(true);
    const locale = ctx.locale.getSnapshot().active;
    const supported = typeof HTMLDialogElement !== 'undefined' &&
      typeof HTMLDialogElement.prototype.showModal === 'function';
    return <div className="dsh-ap-panel"><style>{css}</style>
      {supported ? <button type="button" className="dsh-ap-launch" onClick={() => setOpen(true)}>{t('open')}</button>
        : <p role="alert">{t('dialogError')}</p>}
      {supported && open && <PlayerWindow t={t} locale={locale} onClose={() => {
        setOpen(false);
        ctx.layout.selectPanel(null);
      }} />}
    </div>;
  }
  function SidebarIcon({ size }) {
    return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"
      fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="2" y="4" width="20" height="16" rx="4" /><path d="m10 8 6 4-6 4Z" /></svg>;
  }
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS }, Panel));
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist', id: PANEL_ID, order: 40, label: () => t('title'), locale: NS,
  }, SidebarIcon));
}
