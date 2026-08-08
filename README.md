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
lives or dies on how fast it paints, and this one is one ~20KB file with inline
CSS and three small scripts. It shares the app's palette and typeface so
arriving in the app doesn't feel like a different product. The PWA manifest
points at `/app/`, so installing to the home screen opens the app, not the
pitch.

Everything on it that starts hidden (`.rise`, `.reveal`) has a failsafe: if the
IntersectionObserver hasn't reported within two seconds the page reveals
everything, and a `<noscript>` block does the same with JS off. A missing
animation is a far smaller failure than a blank page.

## Build & deploy

```bash
npm run build     # node build.mjs → esbuild bundles web/main.jsx into docs/app.js
```

The deployed site serves `docs/app.js`, so **always rebuild after editing `StudyFeed.jsx`** or the change won't ship. Vercel settings: Output Directory `docs`, Build Command `npm run build`. `web/main.jsx` is the website-only entry — it renders `<App/>` plus Vercel `<Analytics/>`, which stays out of `StudyFeed.jsx` because that file also runs as an Artifact.

Local render check: `.claude/launch.json` defines `studyfeed-web` (esbuild `--servedir=docs --serve=8123`). `/api/nvidia` only exists on Vercel, so AI features can't be exercised in a local static serve.

## Usage counts

Vercel Web Analytics. `<Analytics/>` (page views) and the `track` import both live
ONLY in `web/main.jsx`, which hangs the reporter on `window.__sfTrack`; `StudyFeed.jsx`
calls its own dependency-free `track()` that no-ops when that hook is absent. Same
reason `<Analytics/>` was already kept out: the Artifact build has neither the package
nor an endpoint.

| Event | Properties |
|---|---|
| `deck_created` | cards, long |
| `cards_generated` | cards, images, lost, mode |
| `generate_failed` | reason |
| `answer_marked` | grade |
| `mark_failed` | reason |
| `session_finished` | cards, streak, subjects |
| `share_opened` / `share_completed` | kind, result |
| `tour_finished` / `tour_skipped` | — |

**Vercel Hobby cannot query custom events** — the beacon is accepted (`/_vercel/insights/event`
returns 200) but the dashboard gates the Events panel behind Pro, so verifying by HTTP
status is misleading. Page views, referrers and top pages all work on Hobby. Decision,
9 Aug 2026: report to **PostHog free tier** instead. Wire it in `web/main.jsx` ONLY, by
pointing `window.__sfTrack` at `posthog.capture` — `StudyFeed.jsx` must stay free of any
analytics import because it also runs as an Artifact. The event list and its call sites
are already correct and need no changes.

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
| `settings:main` | `{ interleave, newPerDay, capNew, longMix, theme, name, examDate, lastSeenVersion, onboarded, dismissedTips }` |

Card shapes:
- `flip` / `cloze` — `{ id, type, front, back }`
- `short` — `{ id, type:'short', front, back }`
- `mcq` — `{ id, type:'mcq', front, options[], answer, why }`
- `extended` — `{ id, type:'extended', verb, prompt, marks, achieved, merit, excellence, skeleton, pitfall }`

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
- **Quiz mode:** a finite graded test built from a deck's own cards. No API cost — distractors come from other cards.
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
- **Not built yet:** worked-problem cards, per-standard tagging, accounts/sync (deliberately local-only — real auth would need a backend).

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
