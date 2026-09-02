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

| Constant | Model | Used for |
|---|---|---|
| `MODEL_GEN` | `openai/gpt-oss-20b` | card generation |
| `MODEL_SMART` | `openai/gpt-oss-20b` | marking, hints, explain, upgrade, chat |
| `MODEL_VISION` | `meta/llama-3.2-11b-vision-instruct` | reading slides/photos (one image per request) |

- Key lives in the Vercel env var `NVIDIA_API_KEY` — never in a file (`.env*` is gitignored).
- `postChat` aborts after 60s; `api/nvidia.js` sets `maxDuration = 60` and passes the upstream status and body through unchanged.
- **NVIDIA retires free models with days of notice.** A sudden HTTP 410 "Gone" on generation means the model id was EOL'd — pick a live one at build.nvidia.com and swap the `MODEL_*` ids (re-check its speed against the 60s cap).
- Reasoning models (`deepseek`, `nemotron`) need `chat_template_kwargs: { thinking: false }` or chain-of-thought pollutes the JSON. `isReasoner` handles this.

`api/feedback.js` emails feature requests via Resend when `RESEND_API_KEY` is set (optional `FEEDBACK_TO`, `FEEDBACK_FROM`); with no key the client falls back to a `mailto:`.

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
| `/app/` | The app itself | `docs/app/index.html` + `docs/app.js` |

The landing page is deliberately not part of the React bundle: a marketing page
lives or dies on how fast it paints, and this one is one file — 83KB raw, 24KB
gzipped — with inline CSS and four small scripts. It shares the app's palette and typeface so arriving
in the app doesn't feel like a different product. The PWA manifest points at
`/app/`, so installing to the home screen opens the app, not the pitch.

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

## Build & deploy

```bash
npm run build     # node build.mjs → esbuild bundles web/main.jsx into docs/app.js
```

The deployed site serves `docs/app.js`, so **always rebuild after editing `StudyFeed.jsx`** or the change won't ship. Vercel settings: Output Directory `docs`, Build Command `npm run build`. `web/main.jsx` is the website-only entry — it renders `<App/>` plus Vercel `<Analytics/>`, which stays out of `StudyFeed.jsx` because that file also runs as an Artifact.

Local render check: `.claude/launch.json` defines `studyfeed-web` (esbuild `--servedir=docs --serve=8123`). `/api/nvidia` only exists on Vercel, so AI features can't be exercised in a local static serve.

## Is the AI actually working?

`node tools/health.mjs` calls every model-backed feature in the app through its
REAL prompt, ceiling, model and reasoning setting — all read out of the call site in
`StudyFeed.jsx` rather than retyped, so the checker cannot drift from the app. It
reports OK / EMPTY / UNUSABLE / HTTP and the wall time for each.

```
node tools/health.mjs                 # all 12 features
node tools/health.mjs --only mark     # one, by name fragment
node tools/health.mjs --repeat 3      # latency varies a lot; take a few
```

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
  Changing that needs the eval re-run both ways first, not a guess.

## Usage counts

PostHog for custom events, Vercel Web Analytics for page views. Both live ONLY in
`web/main.jsx`, which hangs the reporter on `window.__sfTrack`; `StudyFeed.jsx` calls its
own dependency-free `track()` that no-ops when that hook is absent. Same reason
`<Analytics/>` was already kept out: the Artifact build has neither the package nor an
endpoint, and there it stays a silent no-op.

| Event | Properties |
|---|---|
| `deck_created` | cards, long |
| `cards_generated` | cards, images, lost, mode |
| `generate_failed` | reason |
| `answer_marked` | grade |
| `working_marked` | grade, final |
| `paper_started` / `paper_marked` / `paper_failed` | questions, marks, grade, minutes, blank, reason |
| `photo_answer` | result, kind, words / lines, reason |
| `mark_failed` | reason |
| `session_finished` | cards, streak, subjects |
| `share_opened` / `share_completed` | kind, result |
| `tour_finished` / `tour_skipped` | — |

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
- **Full paper:** a full-length practice paper — name the standard and it writes an exam: a concrete context, parts that climb from naming it to justifying it, marks per part, and a clock. **A deck is optional.** The paper is written from the whole subject, so the ideas a student never made cards for can turn up — which is the point, since those are what a real paper catches you on. A chosen deck steers the emphasis rather than fencing it in.
- **Two separate lines, and only one of them moved.** Writing in the style of a standard is a different act from claiming to be a paper from it. (1) It never cites or reproduces a particular past paper — those are Crown copyright, and a model's recall of a specific one is confabulation with a year attached, which a student would then revise against. (2) `NCEA_RULES` still holds: no standard numbers, no credit counts, no speaking for NZQA, because the Level 1 standards were rebuilt for 2024. The student names their standard and it is used in their words. `tools/paper-eval.mjs` scans every generated question for both: **0 leaks in 11**.
- **The eval sends what the app sends.** `buildPaper` passes `lowEffort`, so `paper-eval.mjs` sets `reasoning_effort: 'low'` too. On gpt-oss the reasoning comes out of the same token budget as the JSON, so an eval without it is measuring a different request — the drift that has bitten this repo before.
- **Generated one question at a time,** not as one reply. A paper is the longest thing the app asks for, and a single reply big enough to hold three questions with parts is one big enough to be truncated — which would hand back half an exam. Per question a failure costs one question instead of the paper, and the student sees a count rather than a blank wait. A question that fails to come back (~1 in 8 on the free tier) is skipped and the short paper **says so**, since a short paper handed over silently misstates both the mark total and the time.
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
- **Compatibility:** avoids `??` / `?.` / `||=` — the Artifact transpiler rejects them. `jszip` and `pdf.js` load from cdnjs `<script>` when the bundler doesn't provide them. Syntax-check with:
  ```bash
  node ./node_modules/esbuild/bin/esbuild StudyFeed.jsx --loader:.jsx=jsx --bundle --external:react --format=esm --outfile=out.mjs
  ```
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
