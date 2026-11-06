import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./analytics.js', import.meta.url), 'utf8');
const queueKey = 'arrow-escape-analytics-queue-v1';

async function page({ online = true, installed = false, storage = new Map(), restricted = false, dnt = '0' } = {}) {
  const handlers = { window: new Map(), document: new Map() }, scripts = [];
  let clock = Date.UTC(2026, 10, 6, 18, 45);
  class PageDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return clock; }
  }
  const navigator = { onLine: online, doNotTrack: dnt };
  const add = type => (name, fn) => {
    const listeners = handlers[type].get(name) || [];
    listeners.push(fn); handlers[type].set(name, listeners);
  };
  const document = {
    hidden: false, referrer: '', addEventListener: add('document'),
    head: { append(script) { scripts.push(script); } },
    createElement() { return { remove() { this.removed = true; } }; }
  };
  const window = {
    addEventListener: add('window'),
    matchMedia(query) { return { matches: installed && query.includes('standalone') }; }
  };
  const localStorage = {
    getItem(key) { if (restricted) throw Error('Blocked'); return storage.get(key) || null; },
    setItem(key, value) { if (restricted) throw Error('Blocked'); storage.set(key, value); }
  };
  const context = vm.createContext({ window, document, navigator, localStorage, Date: PageDate });
  const module = new vm.SourceTextModule(source, { context });
  await module.link(() => { throw Error('Unexpected dependency'); });
  await module.evaluate();
  const api = module.namespace.analytics;
  return {
    api, scripts, storage, window, document, navigator,
    advance(ms) { clock += ms; },
    ready() { scripts.at(-1)?.onload(); },
    fire(type, name, event = {}) { for (const fn of handlers[type].get(name) || []) fn(event); },
    commands() { return Array.from(window.dataLayer || [], x => JSON.parse(JSON.stringify(Array.from(x)))); },
    events(name) { return this.commands().filter(x => x[0] === 'event' && (!name || x[1] === name)); }
  };
}

test('uses the supplied GA4 destination and disables advertising features', async () => {
  const p = await page(); p.ready();
  assert.equal(p.scripts.length, 1);
  assert.equal(p.scripts[0].src, 'https://www.googletagmanager.com/gtag/js?id=G-TLQF7ETW8C');
  const config = p.commands().find(x => x[0] === 'config');
  assert.equal(config[1], 'G-TLQF7ETW8C');
  assert.equal(config[2].allow_google_signals, false);
  assert.equal(config[2].allow_ad_personalization_signals, false);
  assert.equal(config[2].user_properties.launch_mode, 'browser');
});

test('counts visible gameplay separately and preserves level context', async () => {
  const p = await page(); p.ready();
  p.api.gameStart('original');
  p.api.levelStart({ game_mode: 'original', level_number: 2, level_name: 'Turn', puzzle_type: 'classic' });
  p.api.addPlayTime(12.5);
  p.document.hidden = true;
  p.api.addPlayTime(20);
  p.fire('document', 'visibilitychange');
  const event = p.events('gameplay_time')[0][2];
  assert.equal(event.play_seconds, 12.5);
  assert.equal(event.level_number, 2);
  assert.equal(event.play_date, '2026-11-07');
  assert.equal(event.play_hour, 0);
  assert.equal(p.events('game_start').length, 1);
  p.api.levelEnd(true); p.api.levelEnd(true);
  assert.equal(p.events('level_end').length, 1);
  assert.equal(p.events('level_end')[0][2].success, true);
});

test('download clicks are not reported as installs or first app opens', async () => {
  const p = await page(); p.ready();
  p.fire('document', 'click', { target: { closest: selector => selector === '#installGameLink' ? {} : null } });
  assert.equal(p.events('apk_download_click').length, 1);
  assert.equal(p.events('installed_app_first_open').length, 0);
  assert.equal(p.events('pwa_install_accepted').length, 0);
});

test('installed first-open is counted once per retained device storage', async () => {
  const storage = new Map([['arrow-escape-save', 'keep-progress']]);
  const p = await page({ installed: true, storage }); p.ready();
  assert.equal(p.events('installed_app_first_open').length, 1);
  const q = await page({ installed: true, storage }); q.ready();
  assert.equal(q.events('installed_app_open').length, 1);
  assert.equal(q.events('installed_app_first_open').length, 0);
  assert.equal(storage.get('arrow-escape-save'), 'keep-progress');
});

test('offline events survive reopening and retain their original India hour', async () => {
  const p = await page({ online: false });
  p.api.gameStart('adventure'); p.api.addPlayTime(8); p.api.flushPlayTime();
  assert.equal(p.scripts.length, 0);
  assert.equal(JSON.parse(p.storage.get(queueKey)).length, 2);
  const q = await page({ storage: p.storage }); q.advance(3600000); q.ready();
  assert.equal(q.events('game_start').length, 1);
  assert.equal(q.events('gameplay_time')[0][2].play_hour, 0);
  assert.equal(q.events('gameplay_time')[0][2].play_seconds, 8);
  assert.deepEqual(JSON.parse(p.storage.get(queueKey)), []);
});

test('failed analytics requests can retry without duplicate pageview configuration', async () => {
  const p = await page(); p.scripts[0].onerror();
  p.api.gameStart('color');
  p.fire('window', 'online'); p.ready();
  assert.equal(p.scripts.length, 2);
  assert.equal(p.commands().filter(x => x[0] === 'config').length, 1);
  assert.equal(p.events('game_start').length, 1);
});

test('storage restrictions and disabled tracking do not break gameplay hooks', async () => {
  const p = await page({ restricted: true }); p.ready();
  assert.doesNotThrow(() => { p.api.gameStart('original'); p.api.addPlayTime(3); p.api.flushPlayTime(); });
  assert.equal(p.events('gameplay_time').length, 1);
  const q = await page({ dnt: '1' });
  q.api.gameStart('original'); q.api.addPlayTime(40); q.api.flushPlayTime();
  assert.equal(q.scripts.length, 0);
  assert.equal(q.events().length, 0);
});

test('time is split by hour and level rather than attributed to a later screen', async () => {
  const p = await page(); p.ready();
  p.api.levelStart({ game_mode: 'adventure', level_number: 1 });
  p.api.addPlayTime(5);
  p.advance(3600000); p.api.addPlayTime(7);
  p.api.levelStart({ game_mode: 'adventure', level_number: 2 });
  p.api.addPlayTime(2); p.api.flushPlayTime();
  const events = p.events('gameplay_time').map(x => x[2]);
  assert.deepEqual(events.map(x => [x.level_number, x.play_hour, x.play_seconds]), [[1, 0, 5], [1, 1, 7], [2, 1, 2]]);
});

test('offline queue is bounded to protect local save storage', async () => {
  const p = await page({ online: false });
  for (let i = 0; i < 220; i++) p.api.gameStart('original');
  assert.equal(JSON.parse(p.storage.get(queueKey)).length, 200);
});
