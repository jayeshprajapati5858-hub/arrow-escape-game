// Usage measurement only. No advertising signals or player/profile data are sent.
const MEASUREMENT_ID = 'G-TLQF7ETW8C';
const QUEUE_KEY = 'arrow-escape-analytics-queue-v1';
const FIRST_APP_OPEN_KEY = 'arrow-escape-first-app-open-' + MEASUREMENT_ID;
const MAX_EVENTS = 200;
const MAX_AGE = 7 * 24 * 60 * 60 * 1000;

function setupAnalytics() {
  const allowedEvents = new Set(['apk_download_click', 'installed_app_open',
    'installed_app_first_open', 'pwa_install_accepted', 'game_start',
    'level_start', 'level_end', 'gameplay_time']);
  const enabled = navigator.doNotTrack !== '1' && navigator.globalPrivacyControl !== true;
  let ready = false, loading = false, configured = false, context = {}, levelEnded = true;
  let bucket = null, queue = [];
  const read = key => { try { return localStorage.getItem(key); } catch { return null; } };
  const write = (key, value) => { try { localStorage.setItem(key, value); } catch {} };
  const indiaTime = () => {
    const now = new Date(Date.now() + 330 * 60000);
    return { play_date: now.toISOString().slice(0, 10), play_hour: now.getUTCHours() };
  };
  const appMode = () => ['standalone', 'fullscreen', 'minimal-ui'].some(mode =>
    window.matchMedia('(display-mode: ' + mode + ')').matches)
    || navigator.standalone === true || document.referrer.startsWith('android-app://')
    ? 'installed' : 'browser';
  const saveQueue = () => write(QUEUE_KEY, JSON.stringify(queue));
  const flushQueue = () => {
    if (!enabled || !ready || navigator.onLine === false) return;
    const pending = queue;
    queue = [];
    for (const event of pending) {
      if (Date.now() - event.time > MAX_AGE) continue;
      window.gtag('event', event.name, { ...event.params, send_to: MEASUREMENT_ID });
    }
    saveQueue();
  };
  const track = (name, params = {}) => {
    if (!enabled || !allowedEvents.has(name)) return;
    queue.push({ name, time: Date.now(), params: {
      app_mode: appMode(), ...indiaTime(), ...params
    } });
    queue = queue.slice(-MAX_EVENTS);
    saveQueue();
    flushQueue();
  };
  const flushPlayTime = () => {
    if (!bucket || bucket.play_seconds <= 0) return;
    const event = bucket;
    bucket = null;
    track('gameplay_time', { ...event, play_seconds: Math.round(event.play_seconds * 100) / 100 });
  };
  const loadTag = () => {
    if (!enabled || ready || loading || navigator.onLine === false) return;
    loading = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
    if (!configured) {
      configured = true;
      window.gtag('js', new Date());
      window.gtag('config', MEASUREMENT_ID, {
        allow_google_signals: false,
        allow_ad_personalization_signals: false,
        user_properties: { launch_mode: appMode() }
      });
    }
    const script = document.createElement('script');
    script.id = 'arrowEscapeGoogleAnalytics';
    script.async = true;
    script.src = 'https://www.googletagmanager.com/gtag/js?id=' + MEASUREMENT_ID;
    script.onload = () => { ready = true; loading = false; flushQueue(); };
    script.onerror = () => { loading = false; script.remove(); };
    document.head.append(script);
  };
  if (enabled) {
    try {
      const saved = JSON.parse(read(QUEUE_KEY) || '[]');
      if (Array.isArray(saved)) queue = saved.filter(event => event &&
        allowedEvents.has(event.name) && typeof event.time === 'number' &&
        Date.now() - event.time < MAX_AGE && event.params &&
        typeof event.params === 'object').slice(-MAX_EVENTS);
    } catch {}
    loadTag();
    if (appMode() === 'installed') {
      track('installed_app_open');
      if (!read(FIRST_APP_OPEN_KEY)) {
        track('installed_app_first_open');
        write(FIRST_APP_OPEN_KEY, '1');
      }
    }
    document.addEventListener('click', event => {
      if (event.target.closest?.('#installGameLink')) track('apk_download_click');
    });
    window.addEventListener('appinstalled', () => track('pwa_install_accepted'));
    window.addEventListener('online', () => { loadTag(); flushQueue(); });
    window.addEventListener('pagehide', flushPlayTime);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) flushPlayTime();
    });
  }
  return {
    gameStart(gameMode) {
      flushPlayTime();
      context = { game_mode: gameMode };
      track('game_start', context);
    },
    levelStart(details) {
      flushPlayTime();
      context = { ...details };
      levelEnded = false;
      track('level_start', context);
    },
    levelEnd(success) {
      if (levelEnded) return;
      levelEnded = true;
      flushPlayTime();
      track('level_end', { ...context, success: !!success });
    },
    addPlayTime(seconds) {
      if (!enabled || !Number.isFinite(seconds) || seconds <= 0 || document.hidden) return;
      const time = indiaTime();
      if (bucket && (bucket.play_date !== time.play_date || bucket.play_hour !== time.play_hour)) flushPlayTime();
      bucket = bucket || { ...context, ...time, app_mode: appMode(), play_seconds: 0 };
      bucket.play_seconds += seconds;
      if (bucket.play_seconds >= 30) flushPlayTime();
    },
    flushPlayTime
  };
}

// Storage restrictions, ad blockers, or analytics errors must never stop a game.
const methods = ['gameStart', 'levelStart', 'levelEnd', 'addPlayTime', 'flushPlayTime'];
let implementation = {};
try { implementation = setupAnalytics(); } catch {}
export const analytics = Object.fromEntries(methods.map(name => [name, (...args) => {
  try { return implementation[name]?.(...args); } catch {}
}]));
