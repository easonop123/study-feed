# Study Feed

A study app that turns dead time into revision — swipe-scroll habit, redirected at your own notes. Mobile-first, built to live on an iPhone home screen.

Subject- and curriculum-agnostic. Ships empty. Default level is NCEA Level 1 (free-text, so any curriculum works).

## What it is

A single-file React app (`StudyFeed.jsx`) that runs as a **claude.ai Artifact** — that runtime provides the two things it needs and nothing else does:

- `window.claude.complete` — AI card generation
- `window.storage` — where decks are saved

It cannot run as a plain web page. To use it: paste `StudyFeed.jsx` into a claude.ai Artifact, then Add to Home Screen from Safari.

## Data model — four storage keys

| Key | Holds |
|---|---|
| `library:main` | `{ decks: [{ id, subject, topic, standard, cards }] }` |
| `progress:all` | `{ [cardId]: { ease, interval, reps, lapses, due, flagged, seen } }` |
| `stats:main` | `{ streak, lastDay, newByDate, reviewsByDate, bySubject }` |
| `settings:main` | `{ interleave, newPerDay }` |

Card shapes:
- `flip` — `{ id, type:'flip', front, back }`
- `extended` — `{ id, type:'extended', verb, prompt, marks, achieved, merit, excellence, skeleton, pitfall }`

## Status

- **Built:** SM-2 scheduler, flip cards, generation (notes/topic/manual, batched), draft review, deck editor, ends-deliberately feed, stats, settings.
- **Card types:** flip, cloze, short answer, multiple choice (misconception distractors), and extended response. A **Mixed** generate mode lets the model pick the best type per idea; Extended-only and Flip-only modes remain.
- **Phase 2:** extended-response cards end to end — command verb, A/M/E ladder, structural skeleton, per-question pitfall, and a "mark my written answer" mode graded against the ladder.
- **Feed:** still ends deliberately ("put the phone down"); a **Keep practising anyway** button opens an opt-in endless extra-practice mode (shuffles all cards, never ends, still records reviews).
- **Compatibility:** avoids `??` / `?.` / `||=` and `window.claude.complete` — the artifact transpiler/runtime chokes on them. `jszip` loads from the bundler or, failing that, a cdnjs `<script>`. Syntax-checked with esbuild.
- **Upload:** photos (`image/*`), `.docx`, `.pptx`, `.txt`. Office files are unzipped in the browser — typed text pulled from the XML, pictures pulled from `/media/`. Photos and embedded pictures are shrunk to ≤1500px JPEG and sent as image blocks; text sends as text. Only extracted content is sent, so no file-size ceiling. Up to 12 images per generate.
- **Runtime shims:** storage read/write unwrap `{value}` + JSON round-trip; model calls POST the messages API (`claude-sonnet-4-6`), with a multimodal variant for images; feed queue rebuilds on card-count change.
- **Not in this file yet:** PDF input, worked-problem cards, remaining Phase 2b question types.
