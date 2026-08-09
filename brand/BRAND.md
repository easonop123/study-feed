# Study Feed — brand rules (canonical)

This file defines the Study Feed visual identity. It is the single source of truth.

**From now on, every logo, icon, colour, favicon, share image, social asset and piece of
brand styling for Study Feed comes from this kit. Do not design a new logo, do not pick
new colours, and do not generate a placeholder mark — use the files in `brand/` and
`public/`. If an asset you need is missing, say so and ask, rather than inventing one.**

---

## The mark

An isometric stack of three layers — the card deck the app is built on.

- **Top layer:** violet outline (`#7C5CFF`)
- **Lower two layers:** white chevron strokes (`#FFFFFF`)
- On light backgrounds the lower two layers become near-black (`#141024`); the top layer
  stays violet.

Never fill the top layer, never recolour a layer outside the palette below, never rotate
the mark, never add shadows, glows, gradients or outlines to it.

### Size rules — this matters

| Size | Use |
|---|---|
| 40px and above | `mark-on-dark.svg` / `mark-on-light.svg` (8.5px strokes) |
| 32px and below | `mark-small-on-dark.svg` (12.5px strokes, tighter stack) |
| Below 28px | Mark only. **Never** the lockup — the wordmark becomes illegible. |

The small mark exists because the standard stroke weight blurs into a smudge at favicon
size. The favicons in `public/` are already built from it. Don't regenerate favicons from
the full-weight mark.

---

## Colours

| Role | Hex | Use |
|---|---|---|
| Near-black | `#141024` | Primary ground, app icon background, dark UI, `theme-color` |
| White | `#FFFFFF` | Lower two layers, wordmark on dark, primary text on dark |
| Violet | `#7C5CFF` | Top layer, accent. **4.28:1 on near-black** — fine for the mark and for bold text 24px and up |
| Violet tint | `#9B85FF` | Use instead of the accent for **small** text on dark (6.37:1) |
| Muted | `#B0A8C8` | Secondary body text on dark |

Rules:

- Violet is an **accent**. It is the top layer and small emphasis. Do not fill large areas
  or backgrounds with it.
- Do not introduce a second accent hue. No lime, no cyan, no coral. A single accent on a
  near-black ground is the whole identity.
- For small text on dark use the tint (`#9B85FF`), not the accent — the accent fails
  contrast below 24px.

---

## Typeface

**Inter**, from Google Fonts.

- Wordmark: Inter Bold (700), tracking -1.8%
- Headlines: Inter ExtraBold (800)
- Body: Inter Regular (400)

The wordmark in the supplied SVGs is converted to outlines, so it renders correctly with
no font installed. Do not re-typeset the wordmark — use `wordmark-*.svg` or the lockups.

---

## Voice, where it touches design

The landing headline is:

> **Flashcards get you Achieved. Excellence is a writing problem.**

Three claims that should appear near any primary call to action:

1. It marks what you actually write — graded Achieved / Merit / Excellence.
2. Free, no account, no sign-up.
3. It builds cards from your own notes, slides and photos.

"Free · No sign-up · NCEA 1–3" is the standard chip row.

---

## Web setup

Copy everything in `public/` into the project's `public/` directory, then add to `<head>`:

```html
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" href="/favicon-32.png" type="image/png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta name="theme-color" content="#141024">

<meta property="og:title" content="Study Feed — flashcards get you Achieved">
<meta property="og:description" content="Excellence is a writing problem. Study Feed marks what you actually write, against the real NCEA criteria, and shows you the sentence that gets you the next grade.">
<meta property="og:image" content="https://studyfeed.app/og-image.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="https://studyfeed.app/og-image.png">
```

**The og:image URL must be absolute.** Relative paths silently fail in iMessage, WhatsApp,
Instagram DMs and most chat apps — and link previews in group chats are load-bearing for
how this app spreads. After deploying, force a re-scrape with Facebook's Sharing Debugger
or the old preview stays cached for days.

PWA manifest icons:

```json
"icons": [
  { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
  { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" }
],
"theme_color": "#141024",
"background_color": "#141024"
```

---

## Known limitation

The stack silhouette is a widely-used stock glyph (the Lucide "layers" shape), redrawn
here as custom vector. It reads well and suits a deck-based app, but it is not distinctive
and could not support a trademark. This is an accepted trade-off for now. If the app gets
real traction, revisit it — but do not change it unprompted.
