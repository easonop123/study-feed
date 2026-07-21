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
- **Phase 2:** extended-response cards end to end — command verb, A/M/E ladder, structural skeleton, per-question pitfall, and a "mark my written answer" mode graded against the ladder.
- **Word / PowerPoint upload:** `.docx` / `.pptx` / `.txt` are unzipped and text-extracted in the browser, so only the text is sent — no file-size ceiling. Images *inside* those files aren't read yet (multimodal follow-up).
- **Runtime shims:** storage read/write unwrap `{value}` + JSON round-trip; model calls POST the messages API (`claude-sonnet-4-6`); feed queue rebuilds on card-count change.
- **Not in this file yet:** photo/PDF (multimodal) generation, reading images inside Word/PPT, worked-problem cards, remaining Phase 2b question types.
