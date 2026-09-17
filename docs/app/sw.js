/* ============================================================================
   SERVICE WORKER — so the app opens with no signal.

   The manifest already promises this. `display: standalone`, a maskable icon, a
   `start_url` of `/app/`: install it from Safari or Chrome and it sits on the
   home screen looking exactly like an app. Open it on the Tube, or on a bus, or
   anywhere the signal drops, and until now it was a WHITE SCREEN — because the
   HTML and the bundle both had to come off the network first.

   That is worth fixing here more than in most apps, because almost everything
   this one does needs no network at all. The review feed, the scheduler, Learn,
   Quiz, your own notes, your stats and every card you have made are in
   localStorage and computed in the browser. Only the model-backed features —
   making cards, marking, the diagnostic, the paper — need the endpoint, and
   they already fail with a sentence explaining themselves. The pitch is
   revising in dead time. Dead time is on a bus.

   THE DESIGN RULE HERE IS "NEVER PIN ANYONE TO A STALE BUILD", and it is worth
   stating because getting this wrong is the classic service-worker disaster:
   cache-first on the shell, one bad deploy, and every returning visitor is
   locked to a broken version with no way to ask for a new one. Nobody can clear
   a cache they do not know exists.

   So the shell and the bundle are NETWORK-FIRST with a short timeout. Online,
   you always get what was just deployed — the cache never decides what version
   you run. Offline, or on a connection that has not answered in three seconds,
   you get the last copy that worked. The cost is that this buys no speed for a
   fast connection, which is fine: the point was never speed, it was that the
   app opens at all.

   `app.js` is network-first for a second reason. It has no content hash in its
   name, so a cached bundle and a fresh HTML file cannot be told apart — serving
   one from cache and one from the network is how you get a shell running a
   build it was never tested against. Both come from the same place or neither
   does.

   Cache-first is used only for things that cannot go stale in a way that
   matters: icons and font files.

   /api/ IS NEVER TOUCHED. A cached answer from the marker is a grade for
   somebody else's essay.
   ========================================================================== */

/* Bump on any change to this file or to what it precaches. The old cache is
   deleted on activate, so a bump is also the way to force everyone off a bad
   one. */
const VERSION = 'sf-v1';
const SHELL = 'sf-shell-' + VERSION;
const ASSETS = 'sf-assets-' + VERSION;

/* Enough to paint the app with nothing else available. Deliberately short: a
   precache that lists everything fails to install if any ONE of them 404s, and
   an install that fails leaves the user with no service worker at all. */
const PRECACHE = ['/app/', '/app.js', '/manifest.webmanifest'];

/* How long to wait for the network before reaching for the cache. Long enough
   not to serve stale content to someone who is merely on slow wifi, short
   enough that a dead connection does not read as a hung app. */
const NET_TIMEOUT_MS = 3000;

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await openCache(SHELL);
    /* No storage: install anyway and take over. Every route falls back to a
       plain fetch, so the worker is a no-op rather than a broken page — and it
       is in place for when storage comes back. */
    if (!cache) return self.skipWaiting();
    /* One at a time and forgiving, rather than cache.addAll: addAll rejects the
       whole install if a single request fails, and an install that fails is a
       user with no offline support who was never told. */
    await Promise.all(PRECACHE.map(async (url) => {
      try {
        const res = await fetch(url, { cache: 'reload' });
        if (res && res.ok) await cache.put(url, res);
      } catch {}
    }));
    /* Take over as soon as the old worker lets go. Paired with clients.claim
       below, a first-ever visit is protected from its second page load onward
       rather than from its second visit. */
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => (k.startsWith('sf-') && k !== SHELL && k !== ASSETS) ? caches.delete(k) : null));
    } catch {}
    await self.clients.claim();
  })());
});

/* Storage, or nothing, without ever throwing. Returns null when the cache is
   unavailable so callers can decide to carry on rather than fail. */
async function openCache(name){
  try { return await caches.open(name); } catch { return null; }
}

/* Network, with the cache as the thing that answers when the network does not.
   The timeout races rather than aborts: a slow response that arrives after the
   cache has already been served still updates the cache for next time, so a
   patchy connection gradually catches up instead of staying behind forever. */
/* `isNavigation` is passed in rather than read off `req.mode`, and that is not
   tidiness — reading it off the request was a bug, caught by tools/sw-test.mjs
   before this shipped. A navigation is answered by re-requesting `/app/`, and
   the request built to do that is a NEW one whose mode is the default rather
   than "navigate". So the check never matched, the offline page below was
   unreachable, and a first-ever visit with no signal would have got the
   browser's own error page — on the exact screen this whole file exists to
   replace. The caller knows what it is answering; ask it. */
async function networkFirst(req, cacheName, isNavigation){
  /* THE CACHE IS AN OPTIONAL EXTRA, NEVER A DEPENDENCY.

     `caches.open` can reject: a private window in some browsers, a device out
     of storage, a user who has blocked site data. Left to throw, that rejection
     travels straight out of `respondWith` and the browser shows its own network
     error page — for a request that would have worked perfectly if this file
     had not been here. A worker that breaks a page it cannot help is worse than
     no worker, so every use of the cache below is allowed to fail and the whole
     handler falls back to a plain fetch. */
  const cache = await openCache(cacheName);
  if (!cache) return fetch(req);
  const fromNet = fetch(req).then(async (res) => {
    if (res && res.ok) { try { await cache.put(req, res.clone()); } catch {} }
    return res;
  });
  /* No `fromNet.catch(() => {})` here, and that is deliberate rather than an
     oversight. When the cache answers first this promise is abandoned, which
     normally means a later failure has no handler and surfaces as an unhandled
     rejection inside the worker. It does not here: `Promise.race` below
     subscribes to it, so it always carries a handler however the race is
     decided. A no-op catch was written, measured with the test that was meant
     to prove it necessary, found to change nothing, and removed. */

  let timer;
  const deadline = new Promise((resolve) => { timer = setTimeout(() => resolve(null), NET_TIMEOUT_MS); });
  let res = null;
  try { res = await Promise.race([fromNet, deadline]); } catch { res = null; }
  clearTimeout(timer);
  if (res && res.ok) return res;

  let cached = null;
  try { cached = await cache.match(req); } catch { cached = null; }
  if (cached) return cached;
  /* Nothing cached and nothing on the wire. Wait out the real request rather
     than failing at the three-second mark — the alternative is telling someone
     on slow wifi that they are offline when they are not. */
  try { return await fromNet; } catch (e){
    /* A navigation with no network and no cached copy is the one case worth
       answering in words rather than with the browser's own error page. */
    if (isNavigation){
      return new Response(
        '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        + '<title>Study Feed — offline</title>'
        + '<style>body{margin:0;display:grid;place-items:center;min-height:100vh;background:#141024;color:#fff;'
        + 'font:400 16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;text-align:center;padding:24px}'
        + 'h1{font-size:20px;font-weight:800;margin:0 0 8px}p{color:#B0A8C8;margin:0;max-width:34ch}</style>'
        + '<div><h1>No connection, and nothing saved yet</h1>'
        + '<p>Open Study Feed once with a signal and it will work without one from then on.</p></div>',
        { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }
    throw e;
  }
}

async function cacheFirst(req, cacheName){
  const cache = await openCache(cacheName);
  if (!cache) return fetch(req);
  let cached = null;
  try { cached = await cache.match(req); } catch { cached = null; }
  if (cached) return cached;
  const res = await fetch(req);
  if (res && (res.ok || res.type === 'opaque')) { try { await cache.put(req, res.clone()); } catch {} }
  return res;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  /* The model endpoint, the analytics beacons, and anything else that is not a
     file: straight to the network, never cached, never intercepted in a way
     that could serve one student another student's reply. */
  if (url.pathname.startsWith('/api/')) return;
  if (url.pathname.startsWith('/_vercel/')) return;
  if (/posthog/.test(url.hostname)) return;

  /* The shell and the bundle: whatever is deployed, or the last one that
     worked. A navigation to anything under /app/ is answered by /app/, since
     the app is one page and its routes are in memory.

     Fenced to /app/ explicitly. The browser already picks a worker by scope, so
     a navigation to the landing page at `/` should never reach this handler at
     all — but "should never" is doing a lot of work in a file that can replace
     one page with another, and the failure here is serving the app to somebody
     who asked for the pitch. */
  if (req.mode === 'navigate'){
    if (url.origin !== self.location.origin || url.pathname.indexOf('/app/') !== 0) return;
    e.respondWith(networkFirst(new Request('/app/', { credentials: 'same-origin' }), SHELL, true));
    return;
  }
  if (url.origin === self.location.origin && (url.pathname === '/app.js' || url.pathname === '/manifest.webmanifest')){
    e.respondWith(networkFirst(req, SHELL));
    return;
  }

  /* Icons and fonts: cache-first. An icon that is one deploy behind is an icon;
     a font that is one deploy behind is the same font. */
  if (url.origin === self.location.origin && /\.(png|ico|svg|webp|jpg|jpeg)$/.test(url.pathname)){
    e.respondWith(cacheFirst(req, ASSETS));
    return;
  }
  if (/^https:\/\/fonts\.(googleapis|gstatic)\.com$/.test(url.origin)){
    e.respondWith(cacheFirst(req, ASSETS));
    return;
  }

  /* Everything else is left to the browser. A service worker that tries to
     handle every request is a service worker that eventually mishandles one. */
});
