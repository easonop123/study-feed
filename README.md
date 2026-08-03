# Study Feed

A study app that turns dead time into revision — swipe-scroll habit, redirected at your own notes. Mobile-first, built to live on an iPhone home screen.

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

## Build & deploy

```bash
npm run build     # node build.mjs → esbuild bundles web/main.jsx into docs/app.js
```

The deployed site serves `docs/app.js`, so **always rebuild after editing `StudyFeed.jsx`** or the change won't ship. Vercel settings: Output Directory `docs`, Build Command `npm run build`. `web/main.jsx` is the website-only entry — it renders `<App/>` plus Vercel `<Analytics/>`, which stays out of `StudyFeed.jsx` because that file also runs as an Artifact.

Local render check: `.claude/launch.json` defines `studyfeed-web` (esbuild `--servedir=docs --serve=8123`). `/api/nvidia` only exists on Vercel, so AI features can't be exercised in a local static serve.

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
- **Home dashboard:** greeting, exam countdown, due hero, streak, this-week bars, subject mastery, quick actions. All from local data.
- **Upload:** PDF (pdf.js — text plus embedded images; text-less pages are rendered and sent to the vision model), `.docx`, `.pptx`, images, `.txt`. Office files are unzipped in the browser. Everything is shrunk to ≤1500px JPEG and only extracted content is sent, so there's no file-size ceiling. Up to 12 images per generate.
- **Look:** "Calm" light system with full dark mode (`data-theme` on `<html>`, Light/Dark/System in Settings). Bottom nav on a phone, sidebar past 1024px. Flip cards do a real 3D turn (two faces in one grid cell, so the card sizes to the taller side instead of needing a fixed height).
- **Typeface:** Plus Jakarta Sans, with Inter and the system stack selectable in Settings → Appearance. `SANS` is `var(--sf-font)` and `data-font` on `<html>` swaps it, mirroring how `data-theme` swaps the palette. The webfonts are linked from `docs/index.html`; system-ui is always the last fallback so the Artifact build still looks deliberate.
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
