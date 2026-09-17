# Study Feed

A study app that turns dead time into revision — swipe-scroll habit, redirected at your own notes. Responsive down to a phone, but not pitched as a phone app: the thing it is actually for is writing long answers, and nobody writes a six-mark answer with their thumbs.

Subject- and curriculum-agnostic. Ships empty. Default level is NCEA Level 1 (free-text, so any curriculum works).

## What it is

A single-file React app (`StudyFeed.jsx`) that runs in **two** places from the same source:

| Runtime | Storage | AI |
|---|---|---|
| **Website** (Vercel) | `window.localStorage` | serverless proxy `api/nvidia.js` |
| **claude.ai Artifact** | `window.storage` | same proxy (needs the deployed site) |

`IN_ARTIFACT` detects `window.storage` and forks storage only — everything else is shared. On the website, add to your home screen from Safari/Chrome and it behaves like an app.

## AI — NVIDIA Build, behind our own proxy

Model calls are OpenAI-compatible requests to NVIDIA Build (`integrate.api.nvidia.com`), routed through `api/nvidia.js` so the key stays server-side and there's no CORS problem. The browser only ever POSTs to the relative path `/api/nvidia`.

**The model is a chain, not a constant** (17 Sep 2026). `TEXT_MODELS` and `VISION_MODELS` are ordered lists and `postChat` walks them; `MODEL_GEN` / `MODEL_SMART` / `MODEL_VISION` are just the heads, so every call site and every checker in `tools/` still names a model the way it always did.

| Chain | Order | Used for |
|---|---|---|
| `TEXT_MODELS` | `google/gemma-4-31b-it` → `nvidia/nemotron-3.5-lightning-30b-a3b` → `openai/gpt-oss-20b` | generation, marking, hints, explain, upgrade, chat, papers |
| `VISION_MODELS` | `meta/llama-3.2-11b-vision-instruct` | reading slides/photos (one image per request) |

- Key lives in the Vercel env var `NVIDIA_API_KEY` — never in a file (`.env*` is gitignored).
- `postChat`'s first attempt runs to 88s, just past the proxy's own 85s abort, so the client receives the proxy's structured 504 rather than hanging up first and hiding it. `api/nvidia.js` sets `maxDuration = 90` and passes the upstream status and **response** through unchanged — the request is rebuilt rather than forwarded, see below.
- **NVIDIA retires free models with days of notice, and that is now handled rather than documented.** A 404 or 410 answers in about a third of a second, so `postChat` falls onto the next model in the chain and the student never finds out. Replacing a dead head is still worth doing — the chain buys the time to do it calmly instead of during an outage. `node tools/models.mjs` finds the replacement; see "when the catalogue collapsed" below.
- **A model that HANGS is a different failure from one that is retired,** and costs a whole attempt rather than a third of a second. `noteHang` moves it to the back of the chain for the rest of the page's life. In memory, never in storage: it is a fact about NVIDIA this minute, not about this student, and a browser that cached "gemma is down" for a week would be worse than the problem.
- Reasoning models (`deepseek`, `nemotron`) need `chat_template_kwargs: { thinking: false }` or chain-of-thought pollutes the JSON. `isReasoner` handles this.

`api/feedback.js` emails feature requests via Resend when `RESEND_API_KEY` is set (optional `FEEDBACK_TO`, `FEEDBACK_FROM`); with no key the client falls back to a `mailto:`.

### The proxy only forwards what the app asks for

It used to forward `req.body` verbatim, which made it **a free, uncapped, unauthenticated LLM endpoint** for anyone who read the page source and found the URL: any model in NVIDIA's catalogue, any prompt, any length, all of it on the one API key this app has. There is no login to hide behind and there cannot be one — the Artifact build calls this from claude.ai, so a same-origin check would break a real user while stopping nobody who can edit a header.

The harm is not a bill. The tier is free. It is the **quota**: roughly 40 requests a minute shared across everyone using the app at once, which is already why revision at 8pm is slow. A script pointed at this endpoint does not cost money, it takes the app away from students, and it looks exactly like the app being broken.

So the handler now builds the upstream request itself rather than passing one through: an allowlist of the four models the app can send (every member of both chains, not just the heads — a fallback that 400s from our own proxy is the fallback failing at the exact moment it is needed), a 4000-token ceiling, a cap on message count, and the two reasoning switches accepted only in the shapes the app sends them in. Nothing there constrains any request the app makes — and that is **asserted, not assumed**. `npm test` reads every model id in both chains and every token ceiling out of `StudyFeed.jsx` and fails if one of them would be turned away — **and fails the other way too**, on an id left in the allowlist that the app no longer sends, since that is this project's key left open on a model nobody is using, because the way a hand-written allowlist drifts is the worst possible one: NVIDIA retires a model, the ids get swapped, and every AI feature starts 400-ing from our own proxy. The 400 names the allowed models for the same reason.

This stops opportunistic use, not a determined attacker. Nothing without state can, and real rate limiting needs a store this project does not have.

## Brand

The identity lives in `CLAUDE.md` (canonical rules) and `brand/` (vector and
raster masters); served copies sit in `docs/`. Near-black `#141024` ground, one
violet accent `#7C5CFF` with a `#9B85FF` tint for small text, Inter. The mark is
an isometric stack — violet top layer, never filled.

The accent is only 4.28:1 on the ground, so it is a **fill and a mark colour**;
anything set in it as text uses the tint instead. That is why `Chip` defaults to
`T.accentInk` and why nav labels, link-style buttons and outline chips take the
tint rather than `T.accent`.

## Routes

| Path | What | Source |
|---|---|---|
| `/` | Marketing landing page | `docs/index.html` — standalone, no framework, no build step |
| `/app/` | The app itself | `docs/app/index.html` + `docs/app.js` + `docs/app/sw.js` |

The landing page is deliberately not part of the React bundle: a marketing page
lives or dies on how fast it paints, and this one is one file — 83KB raw, 24KB
gzipped — with inline CSS and four small scripts. It shares the app's palette and typeface so arriving
in the app doesn't feel like a different product. The PWA manifest points at
`/app/`, so installing to the home screen opens the app, not the pitch.

### The app has no third-party CSS, and opens with no signal

Two changes that go together, because the first is what made the second possible.

**The Tailwind play CDN is gone** (7 Sep 2026), replaced by 3KB of CSS inline in `docs/app/index.html`. Measured against the live page, its entire contribution to this app was Preflight plus **eighteen** layout utilities — flex, grid, six gaps, four alignments. Everything else is `style={{...}}` in `StudyFeed.jsx`. For that it was shipping a CSS compiler to the browser and running it on every page load. Four things wrong with it, in the order they reach a student:

1. **It compiles after the first paint.** The play build generates only the classes already in the DOM and then watches for more. This is a single-page app, so `grid-cols-3`, `items-baseline` and `justify-center` did not exist until the student opened the screen that used them — an unstyled frame, on the cheapest device, every time.
2. **It is a third party on the critical path.** A school network that blocks an unknown CDN does not break a stylesheet, it breaks the layout of the whole app, with nothing to fall back to.
3. **It cannot be cached for offline use** — which is the next section.
4. It is a few hundred KB of JavaScript to deliver 3KB of CSS.

Preflight is copied **verbatim** rather than trimmed, license comment included. The parts that look removable are the ones that turn out to be load-bearing: `input::placeholder` outranks the app's own `::placeholder` on specificity, so dropping it would silently recolour every placeholder in the app.

Verified by walking all eight tabs and diffing the computed value of 25 CSS properties plus the bounding box for **2003 elements**, with and without the CDN. One difference, on the study feed, whose element count varies between visits anyway because it shows a different card. The trade is that the utility set is now fixed — a class with no rule silently does nothing — so `npm test` reads every class out of `StudyFeed.jsx` and fails on a class with no rule *or* a rule with no class.

**And now it works offline.** `docs/app/sw.js` is a service worker registered from `web/main.jsx`, which keeps it out of the Artifact build for the same reason the analytics live there. The manifest has always promised this — `display: standalone`, a maskable icon, `start_url: /app/` — and until now installing it and opening it with no signal gave a **white screen**, because the HTML and the bundle both had to come off the network. Almost nothing this app does needs a network: the feed, the scheduler, Learn, Quiz, your notes, your stats and every card are in localStorage. The pitch is revising in dead time, and dead time is on a bus.

**The rule it is built on is "never pin anyone to a stale build",** because that is the classic service-worker disaster: cache-first on the shell, one bad deploy, and every returning visitor is locked to it with no way to ask for a new one. Nobody clears a cache they do not know exists. So the shell and the bundle are **network-first** with a 3-second timeout — online you always get what was deployed, offline you get the last copy that worked. `app.js` has no content hash, so it is network-first for a second reason: a cached bundle beside a fresh shell is a build nobody tested. Cache-first is used only for icons and fonts. **`/api/` is never touched** — a cached answer from the marker is a grade for somebody else's essay.

`node tools/sw-test.mjs` runs the worker in a fake `ServiceWorkerGlobalScope` with a mock cache and a controllable clock: **35 checks, no browser, no network**. The clock is what makes the timeout path testable in milliseconds rather than three seconds a case. It found a real bug before this shipped — a navigation is answered by re-requesting `/app/`, and the new request built to do that has the default mode rather than `navigate`, so the check for it never matched and the offline page was unreachable. The one screen the file exists to replace.

**If it ever needs killing:** deploy an `sw.js` whose install step calls `self.registration.unregister()`. Deleting the registration call in `web/main.jsx` is *not* enough — an already-installed worker keeps running. Browsers re-check the worker file on every navigation, so the fix reaches everyone on their next load. Bumping `VERSION` also drops every cache the old one made.

**Not yet confirmed in a browser.** Service-worker registration is blocked in the embedded browser this was built in — a one-line, valid worker fails there identically — so the 30 routing checks above are what has actually been run. Confirm on the first deploy: DevTools → Application → Service Workers should show it activated for `/app/`, and Network → Offline should still open the app.

**Its pitch leads with the diagnostic**, changed 19 Aug 2026: *"Stop revising what
you already know. Find the bit you don't."* The previous headline — *"Flashcards
get you Achieved. Excellence is a writing problem."* — was true and is still the
argument, but it names a problem without naming an action, so it now leads the
"three ways to not know something" section instead of the page. The rung
vocabulary (name it / link it / apply it) is shared verbatim with the marking and
with Find my gaps, so the page teaches the thing the app then uses. Two CTAs deep
link: `/app/#gaps` opens the diagnostic and `/app/#ideas` opens the feature
form, both read once on load and then cleared from the URL. TikTok and Instagram
(@studyfeednz) are linked from the footer and from the app's You tab.

`og-image.png` is redrawn to match, by `brand/make-og.html` — a canvas that
retypesets the SAME template (ground, mark, wordmark, two-line headline with the
second line in the accent, standard chip row) so the card cannot drift from the
kit. It runs in a browser rather than Node because the card is set in Inter and
nothing in this repo can rasterise a font; canvas can. **Replacing the file does
not refresh anyone's cached preview** — force a re-scrape with Facebook's Sharing
Debugger, or iMessage, WhatsApp and the rest keep showing the old card for days.

Everything on it that starts hidden (`.rise`, `.reveal`, `.words .w`) has a
failsafe: if the IntersectionObserver hasn't reported within two seconds the page
reveals everything, and a `<noscript>` block does the same with JS off. Anything
whose *resting* state is hidden — the mark that draws itself in the nav — is
gated behind a `.js` class set by a one-line script in `<head>`, so with JS off
the hidden state is never reachable. A missing animation is a far smaller failure
than a blank page; a logo that never draws is a missing logo.

**The effects layer** (spotlights, tilt, magnetic buttons, parallax, scroll
progress, aurora) plays by four rules, all of them load-bearing:

- **Only `transform`, `opacity` and `background-image` animate.** Nothing can
  trigger layout, so nothing can drop a frame. The card spotlight is a
  *background-image* rather than a `::before` overlay specifically because a
  background image paints above the background colour and below the content, so
  it can never wash over text however the card is built.
- **One rAF loop for the whole page.** Every listener does nothing but record a
  number; a single frame callback does all the writing. Reads never interleave
  with writes, so pointer and scroll effects cannot compound into layout
  thrash. Scroll *state* (the nav's background, the parallax offset) is applied
  synchronously at load, not on the first frame — a page opened already scrolled
  had a transparent nav over content until then.
- **Pointer effects are behind `(hover:hover) and (pointer:fine)`** at both the
  JS and CSS layer. A `:hover` that sticks after a tap reads as a bug.
- **Reduced motion switches all of it off**, and every effect that rests at
  opacity 0 or a transform is named individually in that block and put back.
  The universal `animation:none` is not sufficient on its own: without the
  named overrides those elements would simply never arrive.

The blur on `.reveal` is desktop-only (`min-width:760px`) — `filter:blur()`
promotes an element to its own layer and is the one property here with a real
paint cost, and the cheapest device is the one most likely to be reading this on
a bus.

## Working on this from another machine

```bash
git clone https://github.com/easonop123/study-feed.git
cd study-feed
npm install
npm run build
npm test
```

Verified from a clean clone (29 Aug 2026): 64 tracked files, and `npm run build`
reproduces `docs/app.js` **byte-for-byte identical** to the committed one — so the
repo really is the whole project, not the project plus whatever happened to be on
one laptop. That property is no longer checked by hand: `npm test` asserts it on
every run, and it is the check most likely to be the one that saves you.

Deliberately NOT in the repo:

- **`NVIDIA_API_KEY`.** It lives only in the Vercel dashboard (Project → Settings →
  Environment Variables); `.env*` is gitignored and the key has never been
  committed. That is why `/api/nvidia` exists only on the deployed site, and why
  no AI feature can be exercised in a local static serve. To try an AI change,
  deploy it — or use anything in `tools/`, which all call the live endpoint and
  therefore work from any machine with no key at all.
- `node_modules/`, the eval `.log` files, and `StudyFeed.txt` (a paste-friendly
  copy of the source for dropping into a chat, never a second source of truth).

Beyond the clone you need Node LTS, and the GitHub CLI if you want to open PRs.
On this machine neither is on the default shell PATH — they live at
`C:\Program Files\nodejs\` and `C:\Program Files\GitHub CLI\gh.exe`.

## Build & deploy

```bash
npm run build     # node build.mjs → esbuild bundles web/main.jsx into docs/app.js
```

The deployed site serves `docs/app.js`, so **always rebuild after editing `StudyFeed.jsx`** or the change won't ship. Vercel settings: Output Directory `docs`, Build Command `npm run build`. `web/main.jsx` is the website-only entry — it renders `<App/>` plus Vercel `<Analytics/>`, which stays out of `StudyFeed.jsx` because that file also runs as an Artifact.

Local render check: `npm run serve`, or `.claude/launch.json`'s `studyfeed-web`, both of which are `npx esbuild --servedir=docs --serve=8123`. `/api/nvidia` only exists on Vercel, so AI features can't be exercised in a local static serve.

`npx` rather than `node node_modules/esbuild/bin/esbuild`, which the launch config used and which **only works where npm installed esbuild as a JavaScript shim**. On macOS it installs the platform binary at that path, so node tried to parse a Mach-O executable and the preview never started at all. Note also that esbuild's `--serve` stops the moment stdin closes, so it cannot be backgrounded with a plain `&`.

## Did I break anything? — `npm test`

```bash
npm test          # every check that needs no endpoint and no key, in about half a second
```

`tools/offline.mjs` runs the ten things that can be established without a model call. It exists because the repo already had good offline checks and no way to run them: they were spread across four tools behind four different flags, so knowing whether a change had broken something meant knowing which of eight scripts to reach for and which of them needed a network. In practice that means they get run when someone remembers, which is not when they are needed.

| Check | What it holds |
|---|---|
| `health.mjs --dry` | every prompt the app sends can still be **built** |
| `paper-eval.mjs --dedup` | setup de-duplication, deck reading, weak spots, paper into cards |
| `options-eval.mjs` | a guesser reading only option lengths scores no free marks |
| `place-notes-test.mjs` | a quoted phrase highlights where the student actually wrote it |
| `sw-test.mjs` | the service worker never caches `/api/` and never pins a stale build |
| `chain-test.mjs` | a retired model is fallen past for free, a hung one is not asked twice |
| syntax | `StudyFeed.jsx` bundles — no `??` / `?.` / `||=`, which the Artifact rejects |
| classes | every Tailwind class used has a rule in the shell, and no rule is dead |
| freshness | `docs/app.js` is byte-identical to a fresh build |

Six of these are new, and the freshness one matters most. **`docs/app.js` is what the deployed site serves, and it only matches `StudyFeed.jsx` because a human remembered to run the build.** "Always rebuild or the change won't ship" was a rule enforced by memory, and a change that did not ship looks exactly like a change that did not work — you go back and edit the thing that was already right. The check rebuilds to a scratch file and compares, importing the real options from `build.mjs` rather than a copy of them, because a staleness check written against a copy of the build settings would pass while shipping a differently-built bundle.

`--dry` is the other one worth knowing. The prompt builders are lifted out of `StudyFeed.jsx` at run time, and the list of what to lift is hand-maintained, so a builder that grows a new dependency breaks the checker rather than the app. That is not hypothetical: when the full paper learned to ask for a calculation, `paperPrompt` started reading `PAPER_VERBS`, the list was not updated, and `health.mjs` died with a `ReferenceError` **four minutes into a live run, on the twelfth row, where the results should have been**. The dependency was missing the moment the file was saved. `--dry` builds all sixteen requests, sends none of them, and finds it in 60 milliseconds.

One trap, since it cost fifteen minutes to find: a child process that runs esbuild does not close its stdout when it exits, because esbuild's long-lived service process inherits the same pipe. Wait on `exit`, not on `close`.

**And `tools/app-source.mjs` is where "read it out of the app" now lives.** Every
checker here reads its settings out of `StudyFeed.jsx` rather than retyping them,
which is the rule that stops a checker quietly testing a request the app stopped
sending. The cost is that each tool knows the *shape* of the source — and on
17 Sep 2026 the shape changed twice at once: `MODEL_SMART` became
`TEXT_MODELS[0]` and `GEN_MAX_TOKENS` became an expression rather than a literal.
**Six tools matched the first as a string and broke; one matched the second with
`= (\d+)` and silently fell back to a stale default,** which is worse, because it
then reports confidently on a request nobody makes. `modelNamed`, `numberNamed`,
`chain` and `allModels` are that lookup, written once.

## Is the AI actually working?

`node tools/health.mjs` calls every model-backed feature in the app through its
REAL prompt, ceiling, model and reasoning setting — all read out of the call site in
`StudyFeed.jsx` rather than retyped, so the checker cannot drift from the app. It
reports OK / EMPTY / UNUSABLE / HTTP and the wall time for each.

```
node tools/health.mjs                 # all 16 features
node tools/health.mjs --only mark     # one, by name fragment
node tools/health.mjs --repeat 3      # latency varies a lot; take a few
node tools/health.mjs --dry           # build all 16 requests, send none (60ms)
caffeinate -dimsu node tools/health.mjs   # macOS: a full run is minutes long
```

Every model-backed tool in `tools/` now reads `SF_ENDPOINT` before falling back to the live site, so a **Vercel preview deployment can be measured before it is promoted** — which is the workflow this file already recommends for any AI change ("to try one, deploy it"), and which was impossible while every tool pointed at production regardless.

```bash
SF_ENDPOINT=https://study-feed-git-mybranch.vercel.app/api/nvidia node tools/mark-eval.mjs
```

**It marks a real card now, not an easier one.** The `mark written answer` row used a hand-written four-mark "Explain" with a one-line rubric and a one-sentence answer. No card the app ships looks like that: every extended card in `starter-decks.js` is **six marks or eight**, with a three-rung rubric and a pitfall, and the difference is not cosmetic — measured 8 Sep 2026, the four-mark card came back in 26.6s and an eight-mark one hit the proxy's 55-second wall four times out of four, at every answer length from 71 to 232 words. The checker was reporting the product's core feature healthy while testing a load the product never puts on it. The card now comes out of `starter-decks.js` and the answer out of the marking eval's own corpus, so this row and `tools/mark-eval.mjs` can no longer disagree about what "marking works" means.

**The three vision features are checked too**, and they were the gap: this file printed the vision model's name in its header and then never called it, so a retired model id would have broken photo answers, photo working and slide reading with nothing noticing — the three a student cannot route around by typing instead. The page they read is drawn by `tools/test-image.mjs`, a 5x7 bitmap font written straight into a PNG with `zlib`, because the repo cannot rasterise a font and a photo of real schoolwork is not ours to commit. It answers "is the model alive and do the words come back", not "how good is the transcription" — that is measured by hand on real handwriting and the numbers below are those.

It has already earned its keep twice. On its first run (29 Aug 2026) it found
**"Still stuck? sentence starters" returning nothing at all** — `finish_reason:
"length"`, all 700 tokens spent, empty message: gpt-oss reasons out of the same
budget as its answer and the reasoning had eaten the lot, so the button failed every
time it was pressed. And it found worked-problem generation timing out at the
proxy's 55s ceiling. Both fixed the same day.

It also found the second bug the hard way: `low` was hand-written per row instead
of read from the source, so after the fix landed the checker went on testing the old
request and kept reporting a working feature as broken. Everything the app decides is
now read from the app.

**A checker that can hang for sixteen minutes is not a checker.** Measured 7 Sep 2026:
one call sat inside `fetch` for **991 seconds** before undici gave up on a hung HTTP/2
stream and threw. Every model-backed checker carries a deadline of its own now, and
**it is derived from the proxy's budget rather than written down** — `checkerDeadlineMs`
in `tools/app-source.mjs`. Three files used to hardcode 90 seconds with a comment
explaining why 90 was safely past the proxy's 55; when the proxy's budget moved to 85s
that sentence became false in all three at once, and a deadline five seconds after the
server's would have started cutting off real replies. Past the deadline, every second is
the tool hanging rather than the feature being slow, and from the outside those look
identical while you watch a blank row — a run that takes twenty minutes to report a flake
gets stopped rather than read.

**And the deadline is kept on the wall clock, not only on a timer**, because on a laptop
a timer is not enough. A run left going overnight came back with five rows reading TIMEOUT
at 663, 772, 944, 965 and 981 seconds against a 90-second deadline, with the endpoint
answering in three seconds either side of it. macOS had been dropping into maintenance
sleep for 726, 916 and 957 seconds at a stretch — `AbortSignal.timeout` does not advance
while the host is suspended, so it fired minutes late and every one of those rows was the
machine asleep rather than a feature down. A 1-second interval comparing `Date.now()`
catches up the moment the machine wakes, and a row that still runs far past its deadline
now reports **ASLEEP** with the reason, rather than blaming the endpoint. `caffeinate -dimsu`
helps, but nothing beats a closed lid, so start a full run and leave the machine awake. Failures are
also now split in the summary: TIMEOUT, THREW and 5xx mean *run it again*, while EMPTY,
UNUSABLE and PROMPT are the app's own and mean *stop*.

**Why things are slow, and what was done about it.** The endpoint writes at roughly
30 tokens a second, so wall time tracks output length almost exactly. Two levers:

- **Ask for less.** `mixTargets` was asking for ~21 cards a call and
  `GEN_MAX_TOKENS` allowed 2400 — 83 seconds of writing at that rate, against a
  55s ceiling, so the calls that succeeded were the ones that happened to stop
  early. Halved (11 quick / 6 long / 2 mcq, ceiling 1700, `batchText` 6000→4000).
  The same notes still make the same number of cards; they just arrive across more
  calls that each finish.
- **Wait in parallel.** `mapLimit` runs `GEN_CONCURRENCY` (3) jobs at a time,
  preserving input order, for card generation, slide reading and paper marking.
  Measured **2.90× on three real generates, no failures** — the free tier genuinely
  overlaps them, and per-call latency barely moved. A twelve-slide PDF goes from
  twelve waits to four; a nine-part paper from nine to three.
- **Turn the reasoning down where it is not needed.** The hints and the explainer
  now pass `lowEffort`: sentence starters went from *broken at 21.9s* to working at
  2.7s, writing points 5.1s → 6.6s-ish but reliable, explain 9.9s → 5.5s. Marking is
  deliberately NOT given this — see `takesReasoningEffort` — because grades are the
  product's core claim and `tools/mark-eval.mjs` measures them at full reasoning.
  Changing that needs the eval re-run both ways first, not a guess. It has now
  been run both ways — `--effort` exists for it — and the answer was **no**. See
  below.

### The endpoint got three times slower, and marking is what it cost

This is the most important thing measured in this repo since the marking eval was
written, and none of it is a change anyone made to the code.

**The numbers.** The same corpus, the same prompt, the same `openai/gpt-oss-20b`,
the same 3000-token ceiling. The August column is the whole 42 cases, read out of
the committed snapshot `tools/mark-eval-results-3000.json`; the September column
is the 14 genetics cases run today, so the failure rates are not equally
precise — but the throughput figure is a per-call median and does not care about
sample size:

| | 13 Aug 2026 (42 cases) | 8 Sep 2026 (14 cases) |
|---|---|---|
| completion tokens, median | 1256 | 1351 |
| **throughput, median** | **90.9 tok/s** | **28.5 tok/s** |
| latency, median | 14.3s | 43.7s |
| calls that never returned | 3 of 42 (7%) | **6 of 14 (43%)** |

The model writes the same amount and takes three times as long to do it. Marking
was built with the wall four times further away than the median call needed;
the vendor moved the wall's effective position and nobody re-checked. Everything
else slowed by the same factor — card generation now lands at 40-46s against a
1700-token ceiling — but marking is the one where the median crossed the line.

**The quality was never the problem.** Of the eight calls that did come back,
**8 of 8 landed in the right grade band**, no all-good note sets, no unanchored
quotes, no truncation, no invented standards. When it answers, it answers well.

**Turning the reasoning down does not fix it, and this is now measured rather
than assumed.** `node tools/mark-eval.mjs --deck genetics --effort low`, same
corpus, same day:

| | full reasoning | low reasoning |
|---|---|---|
| calls that never returned | 6 of 14 | **0 of 14** |
| grade in band | 8/8 · 100% | **11/14 · 79%** |
| latency, median | 43.7s | **19.1s** |
| completion tokens, median | 1351 | **482** |

Low is two and a half times faster and never times out, and it is still the
wrong trade. All three misses go the same way — **it marks harder than it
should**: a Merit answer read as Achieved, an Excellence answer read as Merit,
and worst of the three, a short correct answer read as **Not yet**. That last one
is precisely what the `terse-correct` case exists to catch, and it is the
feedback most likely to make a student stop writing. A timeout says "try again"
and is recoverable; a confident wrong grade is neither. Medium was tried too and
timed out on its first call.

**So the levers that remain, in order of what they cost:**

1. **Give the request more time.** `api/nvidia.js` aborts five seconds inside a
   `maxDuration` of 60, which was the Hobby ceiling when it was written; Vercel's
   Fluid compute now allows considerably more on Hobby. This is the only fix here
   that costs nothing in quality. **It depends on what this project's Vercel plan
   actually permits, so it is not changed blind** — but it is now a one-line
   change to make: the upstream abort is *derived* from `maxDuration` rather than
   written out again, and `npm test` checks the third number, `ATTEMPT_MS[0]` in
   `StudyFeed.jsx`, against it. Raise `maxDuration` alone and the test says
   exactly what else has to move. Getting that wrong is not hypothetical — the
   client once gave up at 40s against a 55s abort, hanging up on answers that
   were on their way and reporting "couldn't reach the AI" for a request the
   server was still happily working on.
2. **A faster model — except there may not be one.** Probed through our own proxy
   on 8 Sep 2026, `openai/gpt-oss-120b`, `meta/llama-3.3-70b-instruct` and
   `meta/llama-3.1-8b-instruct` all answer **HTTP 410 Gone**, and four other
   plausible ids 404. The warning at the top of this file about NVIDIA retiring
   free models with days of notice has been playing out across the whole
   catalogue; `gpt-oss-20b` is one of the survivors, at 27.8 tok/s. A swap is
   still worth looking for at build.nvidia.com, and `tools/health.mjs` makes a
   candidate cheap to try — but it needs the full corpus re-run before it ships,
   the same standard that just ruled out low reasoning, and a candidate has to
   exist first.

   *Nine days later there was one, and the search is no longer done by hand:
   `node tools/models.mjs` reads the catalogue and probes it. `google/gemma-4-31b-it`
   is the head now. Read on.*
3. **Ask the marker for less.** Cuts the wait and the feedback together, and the
   feedback is the product.

**In the meantime the client already rescues most of it.** `isRetryable` counts a
504 as worth another go, so a 43% per-attempt failure becomes roughly 8% across
the three attempts `ATTEMPT_MS` allows. What that costs is the student's time —
up to about three minutes — which is why the marking screen now says which
attempt it is on rather than showing one unchanging sentence throughout.

### And on 17 September it stopped working altogether — what that turned out to be

Reported as "none of the AI generation is working", and it was not one problem.
It was two, and they had nothing to do with each other beyond both being the
vendor's weather rather than anything in this repo.

**One: the ask had become arithmetically impossible.** Measured through the live
proxy that day, marking wrote 243 tokens in 8.4 seconds — **29 tokens a second**,
holding almost exactly at the 28.5 measured on 8 September and a third of
August's 90.9. Generation's ceiling was still 1700 tokens, and the prompt asked
for a dozen cards, so the model wrote to it. **1700 ÷ 29 = 59 seconds, against a
proxy that gives up at 55.** Every mixed generate was losing a race that could
not be won, while marking — which asks for a quarter as much — went through fine
on the same model, in the same second, over the same connection. That is why the
complaint was about *generation* specifically and why it looked so much like a
broken feature rather than a slow one.

The fix is the same lever as 29 August, pulled again because the rate moved
again, but it is no longer a number somebody chose:

```
WRITE_RATE     29     tokens/second, measured
WRITE_BUDGET_S 33     of the proxy's 55; the rest is queue, prompt read, network
GEN_MAX_TOKENS 950    = WRITE_RATE × WRITE_BUDGET_S, rounded
```

`mixTargets` came down to match (about 6 cards a reply, ~500 tokens at the
default slider), and `batchText` from 4000 characters to 2400, because handing
over twice the material while asking for half the cards just invites the model
to ignore one of the two instructions. **The same notes still make the same
number of cards** — `batchText` cuts them into more chunks and `mapLimit` runs
three at a time — so what changed is that the calls finish.

Measured after — same prompt, same model, the real 2400-character batch, eight
runs back to back through the live proxy:

| | |
|---|---|
| succeeded | **8 of 8** |
| cards parsed by the app's own `cardsFromJson` | **6, every time** |
| completion tokens | 552-586 (of a 950 ceiling) |
| wall time | 12.5s / 20.5s / 21.1s / 24.6s / 26.5s / 32.7s / 39.4s / 44.5s |

Before, at the old size, the same prompt returned two clean `504`s at 55.4s and
56.0s.

**And then, an hour later, the same request 504'd again** — which is worth
writing down rather than quietly leaving out of the good run. The endpoint's
success rate moves around a great deal over a day, and the failures are not
slow answers: a request that writes 570 tokens in 12.5 seconds one minute and
never answers at all the next is **queued, not throttled**. That has two
consequences. Asking for even less would not help, because the size is no longer
what is failing. And retrying is exactly the right response to a queue — which
is what the chain does, on a different model each time, since a different model
is a different pool.

**Two: the catalogue collapsed.** `node tools/models.mjs` reads NVIDIA's public
model list — `integrate.api.nvidia.com/v1/models` needs no key — and probes every
chat-shaped id through our own proxy. Of the 34 ids this project had used or
considered, **27 answered 404 or 410**, and the EOL dates cluster inside three
weeks:

| Gone | When |
|---|---|
| `meta/llama-3.1-8b`, `3.1-70b`, `3.3-70b`, `3.2-1b`, `3.2-3b`, `llama-4-maverick` | 26 Aug 2026 |
| the whole previous `nvidia/*-nemotron-*` generation | 26 Aug 2026 |
| `openai/gpt-oss-120b` | 3 Sep 2026 |
| `google/gemma-3-27b-it`, `moonshotai/kimi-k2`, `qwen3-coder-480b`, `microsoft/phi-4-mini` | earlier |

`openai/gpt-oss-20b` — the one id every text feature in the app named — survived,
but only just: it answered a two-token prompt in 1.6s and then failed to answer
the same prompt at all, repeatedly. Alive, retired and not answering are three
different states and the app could only ever tell the difference between the
first two.

So **the model id became a chain**. `TEXT_MODELS` and `VISION_MODELS` are ordered
lists and `postChat` walks one. The worst case for the student is exactly what it
was — the three waits in `ATTEMPT_MS`, about three minutes — but **that total is
now a deadline rather than a count of tries**, and each try goes to a different
model. Both halves are load-bearing:

- **A different model is the better bet.** Asking one that is not answering to
  answer again mostly buys another timeout.
- **A failure that comes back fast has not spent the budget, so it must not cost
  a try.** A retired model answers `410` in a third of a second; a busy one
  answers `503` in half that. Counting those as attempts meant a three-model
  chain could burn all three tries in under two seconds and give up with nearly
  the whole three minutes unspent — the fallback failing *because* the fallbacks
  were quick about it. Only a genuinely slow attempt moves the clock now.

A hang is the expensive case and is remembered: `noteHang` moves that model to
the back of the chain for the rest of the page's life, so the next call starts
with one that answered. In memory, never in storage — it is a fact about NVIDIA
this minute, not about this student.

Three ids survived the scan and were baked off on the app's real prompts:

| Model | on the app's real generate | note |
|---|---|---|
| `google/gemma-4-31b-it` | **6 cards, 14-33s**, grade in 8s | does not think out loud, so the whole ceiling is answer |
| `nvidia/nemotron-3.5-lightning-30b-a3b` | **7 cards, 20s** | only with `thinking:false` — without it, 950 tokens of transcript and zero cards |
| `openai/gpt-oss-20b` | **6 cards, 36-50s** | only with `reasoning_effort:low` — without it, the same 950-token wipeout |
| `nvidia/nemotron-3-super-120b-a12b` | 15s once, then `503` twice in a minute | **not in the chain** — a fallback that is down half the time spends the budget to say so |
| `mistralai/mistral-nemotron` | `504` at 55s | **not in the chain** |

Two of the three that made it are unusable in their default configuration, and
both fail the same way: the model reasons into the reply, spends the entire
950-token ceiling on it, returns `finish_reason: stop` and zero cards. That is
not a slow failure or a loud one — it is a full-looking HTTP 200 that the app
can do nothing with. `isReasoner` and `takesReasoningEffort` decide which switch
each one gets, **per model in the chain rather than once per call**, which is
pinned by `tools/chain-test.mjs`: deciding it once from the head is exactly how a
fallback ends up sent a request it cannot use.

**A measurement trap worth knowing about before trusting any number here.** Two
of them cost an afternoon between them.

- **A laptop that goes to sleep mid-request reports nonsense.** Durations of 805s,
  999s and 1026s came back for calls with a 75-second timeout, from both `curl`
  and Node — the timers are wall-clock and the process was frozen. Every one of
  those rows was noise. Run anything that measures latency under
  `caffeinate -dimsu`; `tools/health.mjs` already prints `ASLEEP` when it spots
  the signature, and that check is there because of this.
- **A missing dependency in `grab` reads as a broken model.** `cardsFromJson`
  calls `typedCheckable`; leave it out of the lift and every card is dropped by a
  `ReferenceError` inside a `try`, so a model that generated perfectly scores
  zero cards. The lookup that six tools had each written out for themselves now
  lives once, in `tools/app-source.mjs`, which is also what stopped six of them
  breaking at once when `MODEL_SMART` became `TEXT_MODELS[0]`.

### Every failure that day was the wall, and nothing else

Eighteen real calls through the live proxy, three models, the app's own generate
and mark prompts at the sizes the app really sends (`node tools/models.mjs
--bake`):

| Model | usable | median | every failure |
|---|---|---|---|
| `openai/gpt-oss-20b` | 5/6 | 31.4s | `504` at 55.3s |
| `google/gemma-4-31b-it` | 4/6 | 30.7s | `504` at 55.4s and 55.5s |
| `nvidia/nemotron-3.5-lightning-30b-a3b` | 4/6 | 32.4s | `504` at 55.3s |

**Not one call failed for any other reason.** No malformed JSON, no empty reply,
no truncation, no refusal, no rate limit — thirteen usable replies and five
requests cut off by the clock at exactly the moment the proxy stops waiting. The
successes run from 5.8s to 48.6s, right up to the edge, which is what a
distribution looks like when it is being clipped rather than failing.

So `maxDuration` went from 60 to 90 (18 Sep 2026), and the README's long-standing
caution about not changing it blind is honoured rather than ignored: the failure
is now measured. Trivial requests to the same endpoint in the same minutes came
back in 0.3-2.0s, so there is no queue in front of the function — the delay is
NVIDIA writing. A ~570-token reply that has not arrived by 55s is being written
at under 10 tokens a second, inside the measured 12-46 range. Those are answers
that exist and were being thrown away five seconds before they landed.

**It costs the student nothing.** `ATTEMPT_MS` went from three attempts to two,
so the worst case is 180 seconds either way — the same total, spent on two tries
that can finish instead of three that cannot. A chain of three is still walked in
full when the failures are cheap, because a retired or busy model does not spend
the clock.

**And it was tested where a wrong answer is free.** Vercel fails the *build* on a
`maxDuration` the plan does not allow, so the change went up as a pull request
first and the preview deployment's green check is the proof that the plan permits
it. A red check costs nothing; a bad guess in production costs the app.

### `node tools/models.mjs` — is there anything to move to?

```bash
node tools/models.mjs          # alive scan: the catalogue, one cheap call each
node tools/models.mjs --bake   # the survivors, on the app's REAL generate and mark prompts
```

The alive scan answers *is there anything alive*. The bake-off answers the only
question that matters after that: whether the reply is **usable by the app's own
parsers**, which is a different question from whether the model is good. A model
that writes beautiful prose where `cardsFromJson` wants an array is worth nothing
here. Both read the app's current ids and ceilings out of `StudyFeed.jsx`, so the
control row is always what is actually shipping and the request is always the one
the app really sends.

## Usage counts

PostHog for custom events, Vercel Web Analytics for page views. Both live ONLY in
`web/main.jsx`, which hangs the reporter on `window.__sfTrack`; `StudyFeed.jsx` calls its
own dependency-free `track()` that no-ops when that hook is absent. Same reason
`<Analytics/>` was already kept out: the Artifact build has neither the package nor an
endpoint, and there it stays a silent no-op.

| Event | Properties |
|---|---|
| `deck_created` | cards, long |
| `cards_generated` | cards, images, lost, mode, **served**, **walked** |
| `generate_failed` | reason, **served**, **walked** |
| `answer_marked` | grade |
| `working_marked` | grade, final |
| `paper_started` / `paper_marked` / `paper_failed` | questions, asked, marks, grade, minutes, blank, shape, planned, steered, weak, reason |
| `paper_to_cards` | parts, grade |
| `photo_answer` | result, kind, words / lines, reason |
| `mark_failed` | reason, **served**, **walked** |
| `session_finished` | cards, streak, subjects |
| `share_opened` / `share_completed` | kind, result |
| `tour_finished` / `tour_skipped` | — |

**`served` and `walked` exist because the chain hides its own failures.** That is
the point of it for the student and the problem with it for us: `generate_failed:
timeout` does not say whether the head model died overnight and everybody has
quietly been running on the last resort for a week. `served` is the id that
answered (or the last one tried); `walked` is how many were asked before it, so
**0 is a healthy day** and a drifting average is the alarm. Without them the next
retirement is something somebody has to reproduce on a laptop three weeks later.

**Vercel Hobby cannot query custom events** — the beacon is accepted (`/_vercel/insights/event`
returns 200) but the dashboard gates the Events panel behind Pro, so verifying by HTTP
status is misleading. Page views, referrers and top pages all work on Hobby. Hence
**PostHog free tier** (decided 9 Aug 2026, wired 9 Aug 2026) for the table above.
`<Analytics/>` is kept for now because page views still work and cost nothing; once
PostHog is confirmed reporting it is redundant and can go, which would also empty the
`define` block in `build.mjs` — that block exists only for `@vercel/analytics`.

### PostHog settings that are load-bearing

Set in `posthog.init`, and imported from `posthog-js/dist/module.slim` rather than the
package root:

- **`autocapture: false`** — autocapture records the text of whatever gets clicked, and on
  this app that is the student's own cards. The slim build ships without the autocapture,
  session-replay and survey code at all, so this is enforced by the bundle rather than by
  a flag someone can flip back. It is also about half the bytes.
- **`person_profiles: 'never'`** — nobody signs in, so there is no person to build. Events
  still carry an anonymous device id, so unique-device counts still work.
- **`persistence: 'localStorage'`** — same anonymous id, no cookie, no banner question.
- `disable_session_recording` / `disable_surveys` — belt and braces on top of the slim build.

Verified 9 Aug 2026 against a deliberately invalid key: PostHog's ingest endpoint returned
`401 authentication_failed`, which is proof the transport works end to end — with a real
key the same path returns 200. Note that **the browser network panel does not show these
requests** and neither does patching `fetch`/`sendBeacon`/`XHR`; the reliable check is
`posthog.debug(true)` and the `send "<event>"` line in the console. Don't conclude from a
quiet network tab that nothing is being sent.

Auto-attached properties were audited the same day: browser/OS/screen/session metadata plus
`$current_url`, which is safe here only because the app puts nothing user-typed in the URL —
no query string, no hash routing. Keep it that way.

**Counts and fixed words only.** Never subject, topic, a card, a question, an answer or
a filename — subject and topic are free-text boxes a student can type anything into,
including their own name or their teacher's. Errors are classified through
`failureKind()` rather than sent raw, because an upstream message can quote the prompt
back and the prompt is the notes. `grade` is clamped to `GRADES`, so odd model output
cannot inject text.

`generate_failed` is counted on BOTH failure paths. `genChunk` swallows its own errors
after retrying and leaves the reason in `lastApiError`, so a rate-limited run returns an
empty stack rather than throwing — counting only the `catch` would miss the failure
that matters most under load.

## Data model — four storage keys

| Key | Holds |
|---|---|
| `library:main` | `{ decks: [{ id, subject, topic, standard, cards }] }` |
| `progress:all` | `{ [cardId]: { ease, interval, reps, lapses, due, flagged, seen } }` |
| `stats:main` | `{ streak, lastDay, newByDate, reviewsByDate, practiceByDate, bySubject }` |
| `settings:main` | `{ interleave, newPerDay, capNew, longMix, theme, name, examDate, lastSeenVersion, onboarded, dismissedTips, learnSession, diagnosis, paper }` |

Card shapes:
- `flip` / `cloze` — `{ id, type, front, back }`
- `short` — `{ id, type:'short', front, back }`
- `mcq` — `{ id, type:'mcq', front, options[], answer, why }`
- `extended` — `{ id, type:'extended', verb, prompt, marks, achieved, merit, excellence, skeleton, pitfall }`
- `worked` — `{ id, type:'worked', prompt, marks, steps[], answer, pitfall }` — `steps` is the mark scheme, in order; a card that arrives with fewer than two is dropped rather than kept

Decks are portable: export the whole library, a chosen subset, or one deck on its own (with or without your review progress). Importing only ever adds — ids clash-remap so a friend's deck can't overwrite yours.

## Status

- **Scheduling:** SM-2 with distinct graduating steps, so Again/Hard/Good/Easy mean something from the first review. Cards you were *sure* about and got wrong get flagged and come back harder.
- **Card types:** flip, cloze, short answer, multiple choice (distractors are real misconceptions), extended response. A **Mixed** generate mode picks the best type per idea; a long/quick slider sets the balance of what's made *and* how the feed is blended.
- **Extended response, end to end:** command verb, A/M/E ladder, structural skeleton, per-question pitfall, and "mark my written answer" graded against the ladder. Two tiers of nudge while writing — writing points, then sentence starters with blanks.
- **Getting better, not just marked:** after a mark, **How do I get to \<next grade\>?** returns the exact edits to make to *your* answer — the move, where it applies (quoting your words), and that sentence rewritten properly.
- **It responds:** grading a card fires a colour wash, a particle burst and a chime whose pitch *climbs with your combo* (consecutive non-Again answers). Multi-choice reports right/wrong the instant you commit — the correct option pops, a wrong pick shakes. Finishing the cards actually due stops the feed, throws confetti and makes carrying on into practice a deliberate choice again.
- **Sound is synthesised, not sampled** (`play()` / `tone()`, Web Audio, major pentatonic). No asset files, so it behaves the same on the website and in the Artifact, and the pitch can vary per combo step. One `AudioContext`, resumed lazily inside a tap since browsers hold it suspended until a gesture. Muted from the masthead speaker or Settings; `navigator.vibrate` adds haptics on Android (iOS Safari ignores it).
- **Explain this further:** on any revealed card — the reasoning behind the answer, plus **Simpler** and **Go deeper** when the first pass lands at the wrong level.
- **Ask anything:** a chat helper on every screen. It keeps the thread and is handed the card on screen, so "why is that the answer?" works without retyping. Memory-only — no fifth storage key.
- **Feed:** ends deliberately ("put the phone down"); **Keep practising anyway** opens opt-in endless practice (recorded as practice, never touches the schedule). A deck bar at the top drills one subject at a time.
- **Find my gaps (diagnostic):** type a topic and it builds a short written test whose output is a list of what is missing, not a score. Two model calls: one plans the test, one reads every answer together — reading them as a set is the point, because the pattern across the misses is the finding and a per-question marker cannot see it. Probes climb three rungs in order — **name** it (Achieved), **link** it with cause and effect (Merit), **apply** it to an unseen situation and justify (Excellence) — and the report names the rung where understanding stops, then gives each gap as a sentence that has to point at something specific ("you did not connect the larger surface area to the number of particles exposed"). "Not sure" is a first-class answer. One button turns the gaps into study material and lands it in Create as drafts, so nothing is saved unlooked-at. The last report is kept in `settings:main` — it is a to-do list, and one you cannot reopen is a worse one. Measured by `tools/diagnose-eval.mjs` against answers written with a designed flaw.
- **Why the diagnostic is built on the ladder, not on a list of standards:** the standards get rebuilt (the Level 1 ones were replaced for 2024, which is why `NCEA_RULES` bars the model from naming any of them) and a list shipped in this file would rot exactly the way the model's memory did. The **ladder** does not get rebuilt — it has survived every version and is already what the marking runs on. It also happens to be the distinction a student actually needs: "you can name it, you cannot link it" is a study instruction; "7/10" is not. The student still names their real standard and it is passed through in their words. A sourced NZQA standards file is a possible follow-up, not a prerequisite.
- **Photograph a written answer:** the marking's problem was never the marking, it was the typing — three hundred words of physics into a phone, when the answer was already on paper. "Photo of your writing" reads the page and drops the words into the answer box. It lands in the BOX, not in the marker, and that is the whole design: measured against the vision model on deliberately hostile pages (skewed, hard shadow, uneven baselines, per-word rotation, a struck-out word) word error was **6.4%** at ~4.3s with nothing dropped and nothing invented — but **4 of 6 deliberate misspellings came back silently corrected**. So the transcription is a reading of the page, not a copy of it, and grading it unseen would grade words the student did not write. The box they were going to type in anyway becomes the place they check it, which costs no extra screen and keeps the inline notes honest — the marker quotes the same text the student is looking at. A second photo appends rather than replaces, because any answer worth marking runs past one page. Prompt wording is the wording that was measured; change it and re-measure.
- **Worked problems:** a card type for the half of NCEA that is not an essay. `prompt`, `marks`, `steps` (the mark scheme, in order), `answer`, `pitfall`. The student writes their working and it is marked on the **method**: a tick, a half or a cross against every step, their own working highlighted line by line, and the ladder read the way calculation work is actually graded — Achieved is a correct method carried through, Merit shows the reasoning, Excellence justifies it; a right answer with no working shown cannot go above Achieved.
- **It names where it FIRST went wrong,** and credits everything after it on method. One wrong value in step 1 flows into every line below, and a marker who crosses them all turns a single slip into a page of red. `markWorkingPrompt` spends a paragraph on error-carried-forward and `tools/worked-eval.mjs` measures whether the model obeys: on the case built for it — the g→kg conversion skipped, then 250 carried correctly through every later step — it put the first error at step 1 and left steps 2-4 uncrossed. The callout is derived in code from the first `"no"` step (`firstBadStep`) rather than asked for separately, so the checklist and the headline cannot disagree in front of the student.
- **Stuck on a problem?** "Show me the first step" hands over the method one line at a time, entirely offline — the steps are already on the card, so the nudge costs no call, cannot fail and cannot make the student wait. It is also a better hint than the model could write, because it *is* what gets marked.
- **Making them:** a **Working** mode in Create, or leave it on Mixed and they appear wherever the material has something to calculate. Both prompts are told to return nothing rather than invent a calculation for a descriptive topic — a made-up problem teaches a made-up method — and the empty case says so instead of blaming the notes.
- **Photographing working** goes through its own prompt (`transcribeWorking`), because working is not prose. Measured on handwritten mechanics: every load-bearing number survived and every line came back in order, in ~14.8s. A fraction written with a horizontal bar comes back flattened, which is why the prompt asks for fractions inline; superscripts arrive as ASCII (`m/s^2`).
- **Full paper:** a full-length practice paper — name the standard and it writes an exam: a concrete context, parts that climb from naming it to justifying it, marks per part, and a clock. **A deck is optional.** A chosen deck steers the emphasis rather than fencing it in.
- **The paper is PLANNED before it is written,** and that is the fix for the complaint that its questions were not relevant. The problem was structural rather than a matter of wording. Questions were generated one at a time, and the only force holding them apart was the list of contexts already used plus "pick a DIFFERENT idea" — a purely *negative* constraint. Told what to avoid and never what to cover, the model walks away from the middle of a subject: every question was defensibly on-topic and the paper as a whole kept missing the course. Nothing in the loop ever decided what the paper should COVER. So `planPaper` now spends one cheap call (`PLAN_MAX_TOKENS` 700, a fifth of a question's ceiling) choosing the ideas — weighed against the student's own material and, optionally, their review history — and each question is then written to an assigned focus. Same two-call shape the diagnostic already uses, for the same reason: **the set is the unit**, and a per-question generator cannot see the paper.
- **One question may stretch beyond the notes; the rest may not.** The old prompt said *"the best question is often about the part a student has not written down"*, which was written to stop a nine-card deck producing a nine-card paper. It overshot: with no plan to balance it, it read as an instruction to go looking away from the student's course. The blueprint now owns that balance as an explicit budget — at most one focus off the notes — so the pull toward the material and the pull past it are set in one place instead of fighting inside every question.
- **It reads the whole deck, not the first 3500 characters.** `paperSource` walked the cards in storage order and stopped dead at a cap, so the back half of any sizeable deck never influenced a paper — make cards in the order you are taught and it wrote you a paper on term one. It now strides across the deck so front, middle and end are all represented, and hands over the **question side only**: the answer side is what the paper is meant to make the student produce, and printing it beside a request for exam questions invites the model to ask for it straight back. That is also what turned whole Q/A pairs into "three flashcards in a trenchcoat" — the failure this feature's own eval already warned about.
- **It can aim at what keeps going wrong.** `progress:all` has recorded `lapses` and `flagged` — the latter meaning *you were sure and you were wrong*, the sharpest signal in the store — since the first review, and the paper was never told. `weakSpots` ranks them (flagged outranks lapse count) and the blueprint is told to spend at least one question there. A steer, not a syllabus: a paper built only from your worst cards is a punishment, not practice. `ExamPaper` had to be handed `progress` to do it — it was the one screen in the app that never received it.
- **The student can just say what they want examined.** An optional "anything in particular?" box, passed to both the blueprint and every question. The most direct relevance lever there is: someone a week out from an exam usually knows exactly which three topics frighten them, and until now there was nowhere on the screen to say so.
- **Two separate lines, and only one of them moved.** Writing in the style of a standard is a different act from claiming to be a paper from it. (1) It never cites or reproduces a particular past paper — those are Crown copyright, and a model's recall of a specific one is confabulation with a year attached, which a student would then revise against. (2) `NCEA_RULES` still holds: no standard numbers, no credit counts, no speaking for NZQA, because the Level 1 standards were rebuilt for 2024. The student names their standard and it is used in their words. `tools/paper-eval.mjs` scans every generated question for both: **0 leaks in 11**.
- **The eval sends what the app sends.** `buildPaper` passes `lowEffort`, so `paper-eval.mjs` sets `reasoning_effort: 'low'` too. On gpt-oss the reasoning comes out of the same token budget as the JSON, so an eval without it is measuring a different request — the drift that has bitten this repo before.
- **Generated one question at a time,** not as one reply. A paper is the longest thing the app asks for, and a single reply big enough to hold three questions with parts is one big enough to be truncated — which would hand back half an exam. Per question a failure costs one question instead of the paper, and the student sees a count rather than a blank wait. A question that fails to come back (~1 in 8 on the free tier) is skipped and the short paper **says so**, since a short paper handed over silently misstates both the mark total and the time.
- **And now at the same time as each other,** which the blueprint is what makes safe. The old loop *had* to run in series: each question was told which contexts were already taken, so question three could not start until question two came back. With the focuses decided up front no question depends on any other, so they go through `mapLimit` at the usual `GEN_CONCURRENCY`. A three-question paper is two waits instead of three — the extra planning call costs less wall time than it saves. If the planning call is the one that fails, `buildPaper` falls back to the old sequential exclusion-list path rather than refusing to write a paper.
- **The paper may ask a calculation; a card may not.** `COMMAND_VERBS` is seven ways of asking for prose, which is right for an extended-response card — that card type exists to grade writing. It was also the only list the full paper could pick a verb from, so a student who named a maths or physics standard got three questions of Describe, Explain and Discuss: every part an essay, in a subject examined mostly by working. That is the sharpest form of "not relevant" and the eval could not see it, because its only verb check was that the last part was not "Describe". `CALC_VERBS` (Calculate, Determine, Show that, Solve) is added for the paper alone, so card generation and marking do not move. A calculation part still grades on the A/M/E ladder rather than needing the step-by-step method marker, because the ladder already says the right thing about working — Achieved is a correct method carried through, Merit shows the reasoning, Excellence justifies it — which is the same rule `markWorkingPrompt` spends a paragraph on. `--fidelity` now asserts that a maths and a physics standard actually ask for one.
- **And that rule immediately broke chemistry, which is why the check was worth writing.** Told that chemistry is examined by working and must therefore carry a calculation, the model went and found one — heating copper in water, a calorimetry question — and handed back a paper that was **not about reaction rates at all**. `onSubject=false` on the very next run. A demand for numbers will be satisfied from a neighbouring topic if the nearest calculation lives there, and that is a worse failure than the essay-only paper it replaced, because the student is now revising something they were not studying. So the rule is now conditional in both places it appears: the calculation must belong to the idea the question examines, and if that idea genuinely cannot be calculated with, it is asked for in words and another question carries the numbers. That is the same judgement the worked-problem prompts already make when they refuse to invent a calculation for a descriptive topic. Verified after: maths, chemistry and physics all `onSubject=true`, with calculations where they belong.
- **The stock-example trap, and the measurement that found it.** Every subject has one example the textbooks reach for first, and left alone the paper uses it for all three questions. Measured on rates of reaction, **four questions in five were built on magnesium and hydrochloric acid** — before the blueprint and after it. Each one scored full marks for being about the material, because that reaction *is* the material, and the paper was still one situation rehearsed three times. That is what "not relevant enough" turns out to mean once you can measure it, and no topic-coverage number can see it: `--relevance` therefore reports **situations per question**, where 1.00 means the paper never repeats itself.
- **And telling the model to vary them did not work.** Adding the rule in words moved nothing: over six plans, **two in three still put all three questions on the same reaction, at 0.56 distinct setups per question**. Which is the lesson the blueprint already taught, applied to itself — an instruction the model is free to ignore is not a mechanism. So the constraint is enforced where it cannot be talked out of. The plan must now name a `setup` per question, the substances or apparatus in a few words; `cleanPaperPlan` compares them and a repeat **loses its context** and is handed the list already taken, which `paperPrompt` turns into a ban. A repeat keeps its *focus*, because the idea was fine and it was the situation that was borrowed.
- **Measured after: 0.89 setups per question, from 0.56.** Three plans survived a six-plan run (the endpoint was dropping half its calls that evening), giving 2, 3 and 3 distinct setups against a before-run of 3, 1 and 1. It is a small sample and it is quoted as one. It also *understates* the fix, because it is measured at the planning stage: the one plan that scored 2 was the one where the guard fired, and the ban it raised is applied when the question is written, which a plan-only measurement cannot see. Read `situations` as the number to watch rather than as a settled result.
- **The comparison is by word overlap, not string equality,** because "magnesium ribbon and dilute hydrochloric acid" and "magnesium and hydrochloric acid" are the same experiment. The words that decide it are the substances and the apparatus, never the solvent: nearly every rates experiment is run in hydrochloric acid, and matching on it made magnesium look like sodium thiosulfate — which would have banned a perfectly good second question. **A guard that is too eager is the worse failure**, since the student never sees the question they lost, so `SETUP_NOISE` drops the shared reagents and the interesting half of the test cases are the ones that must NOT match. `node tools/paper-eval.mjs --dedup` runs them offline in a second, with no API call, on wordings the model really returned.
- **One retry per question.** A question that does not come back is not a degraded paper, it is a missing one: the student is handed two questions where a real sitting has three. `genChunk` splits a failed generate in half instead, because a chunk of notes can be halved and still make cards; a question is one indivisible reply, so the only useful move is to ask again. Exactly one retry, not a loop — the failures are timeouts, and a third attempt mostly stacks another minute onto someone already waiting, while a second is nearly free now the questions run in parallel and only the failures are still going.
- **The pure functions are pinned offline.** `--dedup` also exercises the two changes that were bugs of omission rather than of wording, for no API call and in about a second: that `paperSource` now reaches the end of a long deck (a 300-card deck gets as far as card 295, where the old prefix-cap stopped near card 30) and never sends the answer side, and that `weakSpots` ranks a flagged card above a merely lapsed one and returns nothing rather than throwing when there is no deck or no history. 21 checks, and they are the ones to run on every change since they cannot fail because the endpoint is busy.
- **The report now has somewhere to go.** The diagnostic has always ended by turning its findings into study material; the paper, which costs an hour rather than ten minutes, ended by naming where the marks went and stopping — leaving the most motivated minute in the app, the one just after a grade nobody wanted, with nothing to press. `paperToSource` builds notes from the parts that came in under the headline grade, biggest marks first, each carrying the question's own topic, **the rung above the one reached** (teaching the Achieved descriptor to someone already at Achieved teaches them what they just proved), and the marker's single line on what was missing from *their* answer. Drafts into Create, same as the diagnostic, so nothing is kept unlooked-at.
- **The checker no longer dies when the endpoint stalls.** A run was ending in a stack trace rather than results: undici gives up on a hung HTTP/2 stream after five minutes and throws out of `fetch`, uncaught, so one stalled request took the remaining subjects with it. `callOnce` now has a deadline of its own, derived from the proxy's budget rather than written down (`checkerDeadlineMs`), and returns a failure row instead of throwing. The very next run proved the point: History timed out, and the other three subjects still reported.
- **What the relevance measurement has and has not shown.** The plan step itself is verified: the blueprint returns three distinct, on-topic focuses reliably, in about eleven seconds. Running three questions at once is verified: **2.41× faster over three real generates, no failures**. The *end-to-end* claim that planned papers are more relevant than unplanned ones is **not yet demonstrated** — a three-paper comparison against the live endpoint scored the two arms level on topic coverage, and more than a third of the calls in it failed with timeouts, which is too little surviving signal to conclude anything from. The topic metric is also blunt by construction here: every rates question names temperature and collision theory whatever it is about. Situations per question is the sharper measure and is the one to re-run when the endpoint is behaving.
- **Relevance is measured, not asserted.** `tools/paper-eval.mjs --relevance` scores two numbers the older checks could not see, because "is it exam-shaped" and "does it leak a standard number" can both pass while the paper is still not worth sitting. **On-material** is the fraction of questions touching an idea the student is demonstrably studying — a question touching none of them is the drift being complained about. **Coverage** is how many *distinct* core ideas the paper reaches, which is the one that catches three good questions all on temperature. `--unplanned` runs the same measurement with the planning step off, so the plan's contribution can be isolated rather than assumed.
- **Marked part by part through `markAnswer`** — the marker with the eval behind it — rather than a second marker written for this screen. Every part is already an extended-response question, so it is handed over as the card it is, and each part gets the annotated answer and the upgrade path for free. Sequentially, because eight parallel calls at a free tier that limits ~40/min is eight failures after an hour's work.
- **One grade, worked out in code:** the best rung that more than half the paper's marks reached. Not asked of the model — it has already graded every part, and asking again invites it to disagree with itself in front of the student. The rule is printed beside the number, because this is the figure they will read as "what I'd get". Then **where the paper cost you**: the parts under that grade, biggest marks first.
- **The clock counts down but never locks you out.** Destroying an hour of someone's writing to enforce a timer is the app making a point at the user's expense; a student who runs over has already learned what the clock was teaching. The paper, the clock and every word are saved as you go, so closing it mid-paper resumes.
- **Not gated.** It was asked for as a premium feature and is worth being one, but there is no payment path yet — no accounts, no Stripe — and accounts were deliberately deferred. The gate attaches at the single Home entry point and at `ExamPaper`'s mount.
- **Quiz mode:** a finite graded test built from a deck's own cards. No API cost — distractors come from other cards. 1–4 answers and Enter carries on.
- **Learn mode:** takes a deck and drills it until you can *produce* every answer, not just recognise one. A card needs two correct answers to be done and the second is harder than the first: you pick it out of a list first, then have to write it from memory (or, where nobody could reproduce the wording, say it and mark yourself). Rounds of seven with a checkpoint; a miss drops the card back to recognition and it returns before the round is out. It keeps your place if you close it, ends by naming the cards that fought back, and offers to drill just those. Like Quiz, it counts as practice and never moves a due date — the feed is the only scheduler.
- **Options that don't answer themselves:** wrong answers used to be drawn at random from every other answer in scope, so a one-word answer could sit beside a paragraph and the odd one out was free marks. Candidates are now ranked against the answer they have to hide among — same rough length, same word count, number against numbers, term against terms — and a near-spelling of the right answer is never offered, since picking it would be right in spirit. Numbers get invented neighbours (doubled, halved, an order of magnitude out; years get years). Where a deck holds nothing that could pass for the answer, Learn shows the card once and asks for it properly later instead of faking a question, and long answers are asked with three options rather than four so the question is not a reading test. Measured by `tools/options-eval.mjs`, which scores a guesser that only looks at option lengths: on the mixed deck that prompted it, free marks went 11% → 0% and the shortest-to-longest option ratio 0.06 → 0.47.
- **First run:** a seven-panel walkthrough (`Tutorial`) opens for a genuinely new visitor and ends by handing them to the generator. It teaches the A/M/E ladder off a *canned* marked answer rendered through the real `MarkResult` — no API call, so it can't spin, cost tokens or fail on a bad connection before the student has made a single card. The trade-off is that `TUT_MARK` must keep the shape `markPrompt` asks for. Skippable from every panel; reachable again from Settings → How this app works, and from the Home empty state. "New" means `!onboarded && !lastSeenVersion && no decks` — `onboarded` alone would have shown it to every existing user, who instead get backfilled as onboarded on load.
- **Shareable cards:** clearing the due feed, or earning an Excellence on a written answer, offers a 1080×1920 PNG built for a story. Drawn on a canvas (`drawShareCard`), not screenshotted — html2canvas is a dependency the Artifact build can't take, and a phone-width screenshot is the wrong shape anyway. It is a *contained* light card floating on a violet backdrop, not a full-bleed slab: laid out in two passes so the card sizes to its own content and centres, which is what lets a four-line answer and a one-line answer both look deliberate. Three entry points: **Home → This week → Share your week** (the findable one; the other two sit behind clearing the whole feed or earning an Excellence, which a new student may not reach for days), the finish screen, and an Excellence mark. The session card leads with a headline chosen from the actual history (`sessionHeadline` — best day yet, first session in N days, N subjects in one sitting) and carries a seven-day bar strip, so someone who shares twice does not post the same picture twice; both come from `reviewsByDate`, which already exists. The grade card carries an excerpt of **the student's own answer** and one line of the marking, so it is evidence rather than a claim; **the question stays off it**, being generated from a teacher's slides and past papers. The card clears the top and bottom ~250px that Instagram and Snapchat overlay with their own furniture, since the footer URL is the whole point. Sharing goes through `navigator.share({files})` — there is no API to post to a story directly, so the OS sheet does it — and falls back to a download everywhere else, including the Artifact.
- **Home dashboard:** greeting, exam countdown, due hero, streak, this-week bars, subject mastery, quick actions. All from local data.
- **Upload:** PDF (pdf.js — text plus embedded images; text-less pages are rendered and sent to the vision model), `.docx`, `.pptx`, images, `.txt`. Office files are unzipped in the browser. Everything is shrunk to ≤1500px JPEG and only extracted content is sent, so there's no file-size ceiling. Up to 12 images per generate.
- **Look:** "Calm" light system with full dark mode (`data-theme` on `<html>`, Light/Dark/System in Settings). Bottom nav on a phone, sidebar past 1024px. Flip cards do a real 3D turn (two faces in one grid cell, so the card sizes to the taller side instead of needing a fixed height).
- **Typeface:** Inter (the brand face), with Plus Jakarta Sans and the system stack selectable in Settings → Appearance. `SANS` is `var(--sf-font)` and `data-font` on `<html>` swaps it, mirroring how `data-theme` swaps the palette. The webfonts are linked from `docs/index.html`; system-ui is always the last fallback so the Artifact build still looks deliberate.
- **No emoji.** Every icon is a stroked SVG on a single weight taking `currentColor` (`ICON_PATHS` / `Ico`). Emoji rendered differently on every platform, ignored the theme, and read as clip art next to the rest of the UI.
- **The controls with no text now have a name.** The app labels almost everything with a styled `<div>` rather than a `<label>`, which costs nothing where the control has visible text and costs everything where it does not. `Toggle` renders a bare button with a sliding dot, and its whole meaning is the state it is in — a screen reader announced "button", not what it switches and not whether it was on. There are six, and two of them ("Only my material", "aim it at what trips you up") change what the AI is asked for. They are now `role="switch"` with `aria-checked` and a label from the call site; the long/quick slider carries an `aria-valuetext` of the sentence already shown beside it ("30% long — Balanced, leaning quick"), because "30" is not a setting; and the exam-date field, which has no placeholder to fall back on, has a name. Measured in the browser before and after: **nine unnamed controls to zero**, the only survivor a `display:none` file input that nothing can reach. `npm test` fails on a `Toggle` with no label or a range or date input with no `aria-label`, since the way the last ones lost their labels was copy-paste. The landing page was already clean — `lang`, alt text, and a sane heading order.
- **Compatibility:** avoids `??` / `?.` / `||=` — the Artifact transpiler rejects them. `jszip` and `pdf.js` load from cdnjs `<script>` when the bundler doesn't provide them. Syntax-check with:
  ```bash
  node ./node_modules/esbuild/bin/esbuild StudyFeed.jsx --loader:.jsx=jsx --bundle --external:react --format=esm --outfile=out.mjs
  ```
- **It survives its own vendor.** Every text feature named one model id, and NVIDIA retires free models weekly — 27 of 34 ids this project had used or considered were 404 or 410 by 17 Sep 2026, most of them EOL'd inside three weeks. `TEXT_MODELS` is an ordered chain now and `postChat` walks it: a retired model is fallen past in a third of a second and does not cost an attempt, a model that has gone quiet is moved to the back for the rest of the visit, and the three-attempt budget became a three-attempt *deadline* so a chain of fast failures cannot burn it in two seconds. Pinned offline by `tools/chain-test.mjs`, which runs the shipped function over a fake transport.
- **The size of a generate is arithmetic now, not taste.** `GEN_MAX_TOKENS` is `WRITE_RATE × WRITE_BUDGET_S` against a rate somebody measured, because the vendor keeps moving it: at 29 tokens a second the old 1700-token ceiling needed 59s against a proxy that gives up at 55, so every mixed generate was losing a race that could not be won. See "it stopped working altogether".
- **Not built yet:** per-standard tagging, accounts/sync (deliberately local-only — real auth would need a backend).

See the in-app **Updates** tab (`PATCH_NOTES` in `StudyFeed.jsx`) for the release history.

## Credits

The dropzone illustration, the loading rings, the chat composer and the card
flip are ports of components from [KokonutUI](https://kokonutui.com) (MIT) by
@dorianbaffier and @kokonutui; the labelled progress track follows the shape of
the shadcn/ui Progress. They're rebuilt rather than imported: the originals are Next.js +
TypeScript + Tailwind + framer-motion + shadcn/ui, and this app is one `.jsx`
file with inline styles that also has to run in an Artifact with no bundler. The
ports use CSS keyframes and the theme tokens instead, so they follow light/dark
with the rest of the app.
