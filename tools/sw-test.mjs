/* ============================================================================
   THE SERVICE WORKER, EXERCISED WITHOUT A BROWSER.

     node tools/sw-test.mjs

   `docs/app/sw.js` decides what a student sees when the network is not there,
   and it is the one file in this repo that can break the app for someone who
   is not asking for anything new. A worker that caches the wrong thing pins a
   returning visitor to a stale build; a worker that caches `/api/` hands one
   student another student's marked essay. Neither failure is visible to the
   person who deployed it, and neither can be cleared by the person suffering
   it, because nobody clears a cache they do not know exists.

   So it is tested, and tested here rather than by clicking around with the
   network toggled off — that is one browser, one state, once, and the cases
   that matter most are the ones that only happen on somebody else's bus.

   The worker runs inside a fake ServiceWorkerGlobalScope built below: real
   `Request`, `Response`, `URL` and `fetch` from Node, a mock CacheStorage, and
   a CONTROLLABLE CLOCK. The clock is what makes the network-timeout path
   testable in milliseconds instead of three seconds a case — a timer only
   fires when a test says so, so "the network answered first" and "the network
   did not answer" are two arrangements of the same code rather than a real
   wait.

   THIS IS NOT A REPLACEMENT for loading the app with the network off. It is
   the check that the routing rules are what the file says they are, which is
   the half that is easy to get wrong and impossible to eyeball.
   ========================================================================== */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SW_SRC = readFileSync(join(ROOT, 'docs', 'app', 'sw.js'), 'utf8');

let passed = 0, failed = 0;
const ok = (name, cond, note) => {
  if (cond) { passed++; console.log(`  ok   ${name}${note ? '  ' + note : ''}`); }
  else { failed++; console.log(`  FAIL ${name}${note ? '  ' + note : ''}`); }
};

/* ---- the fakes ---------------------------------------------------------- */

/* Enough CacheStorage to run the worker: keyed by cache name, each holding a
   url -> Response map. `match` compares URLs, which is what the worker relies
   on and all it relies on. */
function makeCaches(){
  const store = new Map();
  const urlOf = (r) => typeof r === 'string' ? new URL(r, 'https://studyfeed.app').href : r.url;
  const cacheFor = (name) => {
    if (!store.has(name)) store.set(name, new Map());
    const m = store.get(name);
    return {
      async put(req, res){ m.set(urlOf(req), res); },
      /* Cloned on the way out, as the real Cache API does. A Response body can
         only be read once, so a mock that hands back the same object makes the
         second reader fail — and "the same cached page served twice" is a case
         these tests need to be able to check. */
      async match(req){ const hit = m.get(urlOf(req)); return hit ? hit.clone() : undefined; },
      async keys(){ return [...m.keys()].map(u => ({ url: u })); },
    };
  };
  return {
    store,
    api: {
      async open(name){ return cacheFor(name); },
      async keys(){ return [...store.keys()]; },
      async delete(name){ return store.delete(name); },
      async match(req){
        for (const m of store.values()){ const hit = m.get(urlOf(req)); if (hit) return hit; }
        return undefined;
      },
    },
  };
}

/* A clock that only moves when a test says so. Nothing here fires on its own,
   so a test that never calls `fire()` is testing the case where the network
   answered inside the timeout — without waiting for it. */
function makeClock(){
  let next = 1;
  const pending = new Map();
  return {
    pending,
    setTimeout(fn, ms){ const id = next++; pending.set(id, { fn, ms }); return id; },
    clearTimeout(id){ pending.delete(id); },
    fire(){ const all = [...pending.values()]; pending.clear(); for (const t of all) t.fn(); },
    delays(){ return [...pending.values()].map(t => t.ms); },
  };
}

/* A Request the worker can actually be handed. Node's own refuses two things a
   browser does routinely: `mode: 'navigate'`, which is exactly the case this
   worker exists to handle, and a relative URL, which is what the worker itself
   writes when it answers a navigation with `new Request('/app/')`. So the shim
   carries the three properties the worker reads and resolves paths against the
   origin, the way a page would. */
const ORIGIN = 'https://studyfeed.app';
class FakeRequest {
  constructor(input, init){
    const opts = init || {};
    const raw = typeof input === 'string' ? input : input.url;
    this.url = new URL(raw, ORIGIN).href;
    this.method = opts.method || (typeof input === 'object' && input.method) || 'GET';
    this.mode = opts.mode || (typeof input === 'object' && input.mode) || 'no-cors';
  }
}

/* Loads a fresh copy of the worker for each scenario, so no test can be
   affected by a cache another test filled. Returns the handlers it registered
   plus the fakes, which is everything a test needs to drive it. */
function loadWorker(fetchImpl){
  const listeners = {};
  const caches = makeCaches();
  const clock = makeClock();
  const calls = [];
  const self = {
    addEventListener: (type, fn) => { listeners[type] = fn; },
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
    location: { origin: 'https://studyfeed.app' },
  };
  const sandbox = {
    self, caches: caches.api, Request: FakeRequest, Response, URL, Promise,
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    fetch: (req, opts) => { calls.push(typeof req === 'string' ? req : req.url); return fetchImpl(req, opts); },
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(SW_SRC, sandbox, { filename: 'sw.js' });
  return { listeners, caches, clock, calls, self };
}

/* Drive one fetch event and report what the worker decided. `handled` is the
   distinction that matters most: a worker that does not call respondWith has
   left the request to the browser, which is the ONLY correct answer for /api/. */
async function fetchEvent(w, url, init){
  const request = new FakeRequest(url, init);
  let responded = null;
  w.listeners.fetch({ request, respondWith: (p) => { responded = p; } });
  if (!responded) return { handled: false };
  return { handled: true, res: await responded };
}

const netOk = (body, status = 200) => async () => new Response(body, { status });
const netDown = () => Promise.reject(new TypeError('Failed to fetch'));
const netHangs = () => new Promise(() => {});

/* ---- what must be true -------------------------------------------------- */

console.log('\nService worker — offline routing, no browser needed\n');

console.log('The endpoint is never cached and never intercepted');
{
  const w = loadWorker(netOk('should not be reached'));
  for (const [label, url, init] of [
    ['a POST to the model endpoint', 'https://studyfeed.app/api/nvidia', { method: 'POST' }],
    ['a GET to the model endpoint', 'https://studyfeed.app/api/nvidia', undefined],
    ['the feedback endpoint', 'https://studyfeed.app/api/feedback', undefined],
  ]){
    const r = await fetchEvent(w, url, init);
    ok(label + ' is left to the browser', r.handled === false,
      'a cached marking reply is somebody else\'s grade');
  }
  const analytics = await fetchEvent(w, 'https://studyfeed.app/_vercel/insights/script.js');
  ok('the analytics beacon is left alone', analytics.handled === false);
  const ph = await fetchEvent(w, 'https://us-assets.i.posthog.com/array/x/config.js');
  ok('so is PostHog', ph.handled === false);
  const post = await fetchEvent(w, 'https://studyfeed.app/app.js', { method: 'POST' });
  ok('a non-GET is left alone', post.handled === false);
}

console.log('\nOnline, the network decides what you run — never the cache');
{
  const w = loadWorker(netOk('FRESH SHELL'));
  const cache = await w.caches.api.open([...(await w.caches.api.keys())][0] || 'sf-shell-sf-v1');
  await cache.put('https://studyfeed.app/app/', new Response('STALE SHELL'));

  const r = await fetchEvent(w, 'https://studyfeed.app/app/', { mode: 'navigate' });
  ok('a navigation gets the deployed shell, not the cached one',
    r.handled && (await r.res.text()) === 'FRESH SHELL',
    'this is the rule that stops one bad deploy pinning everyone to it');

  const js = await fetchEvent(w, 'https://studyfeed.app/app.js');
  ok('and so does the bundle', js.handled && (await js.res.text()) === 'FRESH SHELL');
}

console.log('\nAnd what the network returns is kept for next time');
{
  const w = loadWorker(netOk('FRESH'));
  await fetchEvent(w, 'https://studyfeed.app/app/', { mode: 'navigate' });
  const shell = await w.caches.api.open('sf-shell-sf-v1');
  const kept = await shell.match('https://studyfeed.app/app/');
  ok('the shell is written to the cache on the way past', !!kept);
}

console.log('\nOffline, the last copy that worked is served');
{
  const w = loadWorker(netDown);
  const shell = await w.caches.api.open('sf-shell-sf-v1');
  await shell.put('https://studyfeed.app/app/', new Response('CACHED SHELL'));
  await shell.put('https://studyfeed.app/app.js', new Response('CACHED BUNDLE'));

  const nav = await fetchEvent(w, 'https://studyfeed.app/app/', { mode: 'navigate' });
  ok('a navigation is answered from the cache', nav.handled && (await nav.res.text()) === 'CACHED SHELL');

  const js = await fetchEvent(w, 'https://studyfeed.app/app.js');
  ok('and so is the bundle', js.handled && (await js.res.text()) === 'CACHED BUNDLE');

  const deep = await fetchEvent(w, 'https://studyfeed.app/app/anything', { mode: 'navigate' });
  ok('any route under /app/ is answered by /app/', deep.handled && (await deep.res.text()) === 'CACHED SHELL',
    'the app is one page and its routes are in memory');

  const landing = await fetchEvent(w, 'https://studyfeed.app/', { mode: 'navigate' });
  ok('but the landing page is not', landing.handled === false,
    'serving the app to someone who asked for the pitch is the failure to avoid');
  const elsewhere = await fetchEvent(w, 'https://example.com/anything', { mode: 'navigate' });
  ok('and neither is another origin', elsewhere.handled === false);
}

console.log('\nOffline with nothing cached, it says so in words');
{
  const w = loadWorker(netDown);
  const nav = await fetchEvent(w, 'https://studyfeed.app/app/', { mode: 'navigate' });
  const body = nav.handled ? await nav.res.text() : '';
  ok('a first-ever visit offline gets a page, not a browser error',
    nav.handled && nav.res.status === 200 && /No connection/.test(body));
  ok('and it explains what to do about it', /once with a signal/.test(body));
}

console.log('\nA connection that never answers does not hang the app');
{
  const w = loadWorker(netHangs);
  const shell = await w.caches.api.open('sf-shell-sf-v1');
  await shell.put('https://studyfeed.app/app/', new Response('CACHED SHELL'));

  const request = new FakeRequest('https://studyfeed.app/app/', { mode: 'navigate' });
  let responded = null;
  w.listeners.fetch({ request, respondWith: (p) => { responded = p; } });
  /* One microtask is not enough: networkFirst opens the cache before it arms
     the timer, so the queue has to drain before the timer exists to look at. */
  await new Promise(r => setImmediate(r));
  ok('the wait is bounded by a timer, not by the network', w.clock.delays().length === 1,
    `deadline ${w.clock.delays()[0]}ms`);
  w.clock.fire();
  const res = await responded;
  ok('and the cached copy is served when it expires', (await res.text()) === 'CACHED SHELL');
}

console.log('\nIcons and fonts come from the cache without asking twice');
{
  const w = loadWorker(netOk('ICON BYTES'));
  const first = await fetchEvent(w, 'https://studyfeed.app/icon-192.png');
  ok('an icon is fetched the first time', first.handled && w.calls.length === 1);
  const second = await fetchEvent(w, 'https://studyfeed.app/icon-192.png');
  ok('and not the second time', second.handled && w.calls.length === 1);

  const font = await fetchEvent(w, 'https://fonts.gstatic.com/s/inter/v1/x.woff2');
  ok('a font file is cached the same way', font.handled);
  const fontAgain = await fetchEvent(w, 'https://fonts.gstatic.com/s/inter/v1/x.woff2');
  ok('and served from the cache after that', fontAgain.handled && w.calls.length === 2);
}

console.log('\nInstalling is forgiving; activating is not');
{
  /* One precache entry 404s. The install must still finish: an install that
     fails leaves the student with no offline support and no way to know. */
  const w = loadWorker(async (req) => {
    const url = typeof req === 'string' ? req : req.url;
    return /manifest/.test(url) ? new Response('nope', { status: 404 }) : new Response('OK');
  });
  let waited = null;
  await w.listeners.install({ waitUntil: (p) => { waited = p; } });
  await waited;
  const shell = await w.caches.api.open('sf-shell-sf-v1');
  const urls = (await shell.keys()).map(r => r.url);
  ok('a precache entry that 404s does not fail the install', urls.length === 2, urls.length + ' of 3 cached');
  ok('the shell is one of the ones that made it', urls.some(u => u.endsWith('/app/')));
  ok('and so is the bundle', urls.some(u => u.endsWith('/app.js')));
}
{
  const w = loadWorker(netOk('x'));
  await w.caches.api.open('sf-shell-OLD');
  await w.caches.api.open('sf-assets-OLD');
  await w.caches.api.open('sf-shell-sf-v1');
  await w.caches.api.open('somebody-elses-cache');
  let waited = null;
  await w.listeners.activate({ waitUntil: (p) => { waited = p; } });
  await waited;
  const left = await w.caches.api.keys();
  ok('activating deletes the previous version\'s caches', !left.includes('sf-shell-OLD') && !left.includes('sf-assets-OLD'),
    'a version bump is how you force everyone off a bad cache');
  ok('and keeps the current one', left.includes('sf-shell-sf-v1'));
  ok('and does not touch a cache it did not create', left.includes('somebody-elses-cache'));
}

console.log('\nA request abandoned for the cache still cleans up after itself');
{
  /* The cache answers first and the network request is left running. When it
     later fails, that must not surface as an unhandled rejection: not a broken
     app, but a healthy worker looking broken in the console of someone
     debugging something else.

     It holds because `Promise.race` subscribes to the promise whichever way the
     race goes — NOT because of a guard. A no-op catch was added for this and
     removed again when this test passed identically without it. The property is
     pinned here anyway, because it is the rewrite of `networkFirst` that drops
     the race that would quietly break it. */
  const unhandled = [];
  const watch = (e) => unhandled.push(String(e && e.message || e));
  process.on('unhandledRejection', watch);

  let failLater;
  const w = loadWorker(() => new Promise((_, reject) => { failLater = reject; }));
  const shell = await w.caches.api.open('sf-shell-sf-v1');
  await shell.put('https://studyfeed.app/app/', new Response('CACHED SHELL'));

  const request = new FakeRequest('https://studyfeed.app/app/', { mode: 'navigate' });
  let responded = null;
  w.listeners.fetch({ request, respondWith: (p) => { responded = p; } });
  await new Promise(r => setImmediate(r));
  w.clock.fire();
  const res = await responded;
  ok('the cached copy is served while the request is still open', (await res.text()) === 'CACHED SHELL');

  failLater(new TypeError('Failed to fetch'));
  await new Promise(r => setTimeout(r, 30));
  process.off('unhandledRejection', watch);
  ok('and the late failure does not surface as an unhandled rejection', unhandled.length === 0,
    unhandled.length ? unhandled.join(' / ') : '');
}

console.log('\nWith no storage at all it gets out of the way');
{
  /* `caches.open` rejects in a private window in some browsers, on a device out
     of space, and for anyone who has blocked site data. Left to throw, that
     rejection travels out of respondWith and the browser shows its own network
     error page — for a request that would have worked if this file were not
     installed. A worker that breaks a page it cannot help is worse than none. */
  const w = loadWorker(netOk('LIVE FROM THE NETWORK'));
  w.caches.api.open = async () => { throw new Error('QuotaExceededError'); };
  w.caches.api.keys = async () => { throw new Error('QuotaExceededError'); };

  const nav = await fetchEvent(w, 'https://studyfeed.app/app/', { mode: 'navigate' });
  ok('a navigation still gets the page', nav.handled && (await nav.res.text()) === 'LIVE FROM THE NETWORK');

  const js = await fetchEvent(w, 'https://studyfeed.app/app.js');
  ok('so does the bundle', js.handled && (await js.res.text()) === 'LIVE FROM THE NETWORK');

  const icon = await fetchEvent(w, 'https://studyfeed.app/icon-192.png');
  ok('and so does an icon', icon.handled && (await icon.res.text()) === 'LIVE FROM THE NETWORK');

  let installed = true;
  try {
    let waited = null;
    await w.listeners.install({ waitUntil: (p) => { waited = p; } });
    await waited;
  } catch { installed = false; }
  ok('installing does not throw either', installed, 'a failed install is a user with no worker and no warning');

  let activated = true;
  try {
    let waited = null;
    await w.listeners.activate({ waitUntil: (p) => { waited = p; } });
    await waited;
  } catch { activated = false; }
  ok('nor does activating', activated);
}

console.log(`\n${passed}/${passed + failed} passed`);
process.exit(failed ? 1 : 0);
