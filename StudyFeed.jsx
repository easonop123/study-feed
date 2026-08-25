import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
/* Ready-made decks for anyone who arrives without notes on them. Content only —
   no model call — so it also works when the free tier is rate limiting. */
import { STARTER_DECKS, instantiateStarter, starterCounts } from './starter-decks.js';

/* ============================================================================
   STUDY FEED  —  single-file build
   Card types: flip, cloze, short answer, multiple choice, extended response.
   Continuous feed (scheduled cards, then endless practice). SM-2 scheduling.

   Visual direction: light, soft, rounded. White cards on a near-white page,
   indigo accent, pill buttons, one rounded sans throughout.

   Constraints honoured:
   - single file, default export, no required props
   - no localStorage/sessionStorage. window.storage.* wrapped in try/catch;
     storage.get returns { value } and set takes a JSON string.
   - four storage keys (library:main, progress:all, stats:main, settings:main)
   - Tailwind core utilities for layout only; colour from the token object
   - avoids ?? / ?. / ||= (the artifact transpiler rejects them)
   ========================================================================== */

/* ---- tokens --------------------------------------------------------------
   Colours are CSS custom properties so the whole app flips light/dark by
   toggling data-theme on <html> (see THEME_CSS below). T.* holds the var()
   references; rgba() makes any of them translucent. */
const T = {
  bg:        'var(--sf-bg)',
  surface:   'var(--sf-surface)',
  well:      'var(--sf-well)',
  border:    'var(--sf-border)',
  ink:       'var(--sf-ink)',
  muted:     'var(--sf-muted)',
  faint:     'var(--sf-faint)',
  accent:    'var(--sf-accent)',
  accentInk: 'var(--sf-accent-ink)',
  green:     'var(--sf-green)',
  amber:     'var(--sf-amber)',
  red:       'var(--sf-red)',
};

/* One indirection so the typeface is switchable at runtime (Settings →
   Appearance). The stack itself lives in --sf-font; `data-font` on <html>
   swaps it, exactly like data-theme swaps the palette. system-ui is always the
   last fallback, so the Artifact — which can't load webfonts — still looks
   deliberate rather than broken. */
const SANS = 'var(--sf-font)';
const SYSTEM_STACK = 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
/* Inter is the brand typeface (see CLAUDE.md), so it leads and is the default.
   The other two stay: the typeface is a reading preference as much as an
   identity, and someone who finds Inter tight at 13px should be able to change
   it. Brand surfaces — the wordmark, the supplied SVGs — are Inter regardless. */
const FONTS = [
  { v: 'inter',   label: 'Inter',   stack: `"Inter", ${SYSTEM_STACK}`, note: 'The Study Feed typeface — the default' },
  { v: 'jakarta', label: 'Rounded', stack: `"Plus Jakarta Sans", ${SYSTEM_STACK}`, note: 'Friendlier and more geometric' },
  { v: 'system',  label: 'System',  stack: SYSTEM_STACK, note: 'Whatever your device already uses' },
];

/* translucent colour that works for hex (#rrggbb) AND CSS vars / any colour
   (via color-mix) — so one helper covers subject hues and theme tokens. */
const rgba = (c, a) => {
  if (c && c[0] === '#'){
    const n = parseInt(c.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }
  return `color-mix(in srgb, ${c} ${Math.round(a * 100)}%, transparent)`;
};

const R  = { card: 18, well: 14, input: 12, pill: 999 };
const SH = {
  card:   'var(--sf-sh-card)',
  raised: 'var(--sf-sh-raised)',
  pop:    'var(--sf-sh-pop)',
  accent: 'var(--sf-sh-accent)',
};

/* soft, muted subject hues (same in both themes — they sit on tinted tiles) */
const HUES = ['#6472F0','#E1A63E','#37B98C','#9B7EDE','#3BA9C4','#E285B4','#8B84E0','#E59A5B'];

/* Both palettes, injected once (see Shell). Light is default; dark applies via
   the OS preference AND an explicit data-theme="dark" (the toggle), while
   data-theme="light" forces light even on a dark OS. */
const THEME_CSS = `
  :root{
    --sf-font: "Inter", ${SYSTEM_STACK};
  }
  :root[data-font="jakarta"]{ --sf-font: "Plus Jakarta Sans", ${SYSTEM_STACK}; }
  :root[data-font="system"]{ --sf-font: ${SYSTEM_STACK}; }
  :root{
    --sf-bg:#F6F8FB; --sf-surface:#FFFFFF; --sf-well:#F1F4F9; --sf-border:#EBEEF3;
    /* Contrast, every figure measured against the WELL (#F1F4F9) — the darkest
       of the three light grounds, so the worst case. Measuring on white would
       flatter all of them.
         ink   12.13: 1
         muted  7.52: 1  (was #6E7482, 4.25 — marginally under AA)
         faint  4.62: 1  (was #A6ABB7, 2.09 — nowhere near, and it is used for
                          real labels, not decoration)
       The old faint was legible on a good desktop screen and disappeared on a
       phone outdoors, which is where this app is actually read.

       #686E7E is the LIGHTEST grey that still clears 4.5:1 on the well — one
       step lighter (#6A7080) is 4.49 and already under. So faint has no room,
       and the muted/faint hierarchy has to be re-opened from the other end:
       muted was darkened to #494E5E to keep a visible step between the two
       (1.63x apart, against 2.04x before this change). Any lighter and the
       label/value pairs that encode their hierarchy purely in muted-vs-faint
       collapse into one grey. Nothing here is near black, so the soft look
       survives. Dark theme is untouched — its faint is already 5.07:1. */
    --sf-ink:#2B2F3A; --sf-muted:#494E5E; --sf-faint:#686E7E;
    --sf-accent:#7C5CFF; --sf-accent-ink:#5B3FD9;
    --sf-green:#37B98C; --sf-amber:#E1A63E; --sf-red:#E06B62;
    --sf-nav:rgba(255,255,255,.9); --sf-track:#D9DEE8;
    --sf-sh-card:0 1px 2px rgba(30,34,50,.04), 0 12px 28px -18px rgba(30,34,50,.22);
    --sf-sh-raised:0 1px 2px rgba(30,34,50,.05);
    --sf-sh-pop:0 2px 10px rgba(30,34,50,.08);
    --sf-sh-accent:0 6px 18px -6px rgba(124,92,255,.40);
  }
  :root[data-theme="dark"]{
    --sf-bg:#141024; --sf-surface:#1C1836; --sf-well:#241F42; --sf-border:#2E2752;
    --sf-ink:#FFFFFF; --sf-muted:#B0A8C8; --sf-faint:#8F88A8;
    --sf-accent:#7C5CFF; --sf-accent-ink:#9B85FF;
    --sf-green:#46C79A; --sf-amber:#EAB454; --sf-red:#EA7B72;
    --sf-nav:rgba(20,16,36,.9); --sf-track:#3A3160;
    --sf-sh-card:0 1px 2px rgba(0,0,0,.25), 0 14px 30px -20px rgba(0,0,0,.6);
    --sf-sh-raised:0 1px 2px rgba(0,0,0,.3);
    --sf-sh-pop:0 2px 10px rgba(0,0,0,.4);
    --sf-sh-accent:0 6px 18px -6px rgba(124,92,255,.55);
  }
  @media (prefers-color-scheme: dark){
    :root:not([data-theme="light"]){
      --sf-bg:#141024; --sf-surface:#1C1836; --sf-well:#241F42; --sf-border:#2E2752;
      --sf-ink:#FFFFFF; --sf-muted:#B0A8C8; --sf-faint:#8F88A8;
      --sf-accent:#7C5CFF; --sf-accent-ink:#9B85FF;
      --sf-green:#46C79A; --sf-amber:#EAB454; --sf-red:#EA7B72;
      --sf-nav:rgba(20,16,36,.9); --sf-track:#3A3160;
      --sf-sh-card:0 1px 2px rgba(0,0,0,.25), 0 14px 30px -20px rgba(0,0,0,.6);
      --sf-sh-raised:0 1px 2px rgba(0,0,0,.3);
      --sf-sh-pop:0 2px 10px rgba(0,0,0,.4);
      --sf-sh-accent:0 6px 18px -6px rgba(124,92,255,.55);
    }
  }
  /* Tailwind's preflight sets its own stack on body; ours has to win, so any
     text that isn't explicitly given SANS still inherits the chosen face. */
  html,body{ background:var(--sf-bg); font-family:var(--sf-font); }
`;
function subjectColour(name){
  const s = (name || '').trim().toLowerCase();
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return HUES[h % HUES.length];
}

const TYPE_LABEL = { flip: 'Flip', cloze: 'Fill the blank', short: 'Short answer', mcq: 'Multiple choice', extended: 'Long answer', typed: 'Type the answer', worked: 'Working' };
const LEVEL_PRESETS = ['NCEA Level 1', 'NCEA Level 2', 'NCEA Level 3'];

/* The accounts, in one place. docs/index.html carries the same two in its
   footer; if these ever change, both move together. */
const SOCIAL = [
  { k: 'tiktok', label: 'TikTok', url: 'https://www.tiktok.com/@studyfeednz' },
  { k: 'instagram', label: 'Instagram', url: 'https://www.instagram.com/studyfeednz/' },
];

/* Symbols that are a pain to type when answering chemistry/physics/maths.
   Subscripts build formulae (H + ₂ + O = H₂O); superscripts build charges
   and powers (SO₄ + ² + ⁻ = SO₄²⁻; ×10 + ⁻ + ⁷). */
const SYMBOL_GROUPS = [
  ['Subscript (formulae)', ['₀','₁','₂','₃','₄','₅','₆','₇','₈','₉']],
  ['Superscript (charges, powers)', ['⁰','¹','²','³','⁴','⁵','⁶','⁷','⁸','⁹','⁺','⁻']],
  ['Reactions', ['→','⇌','↔','↑','↓','Δ']],
  ['Maths', ['°','×','÷','±','√','≈','≠','≤','≥','·','∴','⁻']],
];

/* ---- dates : YYYY-MM-DD so they compare lexically ------------------------ */
const dayStr = (d = new Date()) => {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
};
const addDays = (base, n) => {
  const d = new Date(base + 'T00:00:00');
  d.setDate(d.getDate() + Math.round(n));
  return dayStr(d);
};
const TODAY = () => dayStr();

/* ---- platform ------------------------------------------------------------
   The same file runs in two places: inside a claude.ai Artifact (which
   provides window.storage) and as a plain website. On the website the AI
   key lives server-side in the Vercel proxy (api/nvidia.js), so the browser
   never handles a key. Detect the runtime, don't fork. */
const IN_ARTIFACT = typeof window !== 'undefined' && !!window.storage;

/* ---- storage ------------------------------------------------------------- */
async function load(key, fallback){
  try {
    if (!IN_ARTIFACT){
      const raw = window.localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    }
    const r = await window.storage.get(key);
    if (r === undefined || r === null) return fallback;
    const raw = (r && typeof r === 'object' && 'value' in r) ? r.value : r;
    if (raw === undefined || raw === null) return fallback;
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch { return fallback; }
}
async function save(key, value){
  try {
    if (!IN_ARTIFACT){ window.localStorage.setItem(key, JSON.stringify(value)); return true; }
    await window.storage.set(key, JSON.stringify(value));
    return true;
  } catch (e){ console.error('storage.set failed', key, e); return false; }
}

/* longMix = what % of your cards should be long (extended-response) answers.
   Drives both what gets generated and how the feed is blended. */
const DEFAULT_SETTINGS = { interleave: true, newPerDay: 12, capNew: false, longMix: 30, theme: 'system', name: '', examDate: '', lastSeenVersion: '', onboarded: false, dismissedTips: {}, sound: true, font: 'inter', learnSession: null, diagnosis: null };

/* ---- sound ---------------------------------------------------------------
   Synthesised, not sampled. Three reasons: a card grade fires 30+ times in a
   session and the same recording grates fast; synthesis lets the pitch RISE
   with your combo, which is most of why Duolingo's chime feels good; and there
   are no asset files, so it behaves identically on the website and inside the
   Artifact (which has no bundler to load them).

   Every note comes from a major pentatonic scale — that scale has no wrong
   note in it, so overlapping sounds never clash. */
const PENT = [523.25, 587.33, 659.25, 783.99, 880.00, 1046.50, 1174.66]; // C5 D5 E5 G5 A5 C6 D6
let audioCtx = null;
let soundOn = true;
const setSoundOn = (v) => { soundOn = !!v; };

function audio(){
  if (audioCtx) return audioCtx;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) audioCtx = new AC();
  } catch { audioCtx = null; }
  return audioCtx;
}

/* One note. `when` is an offset in seconds so a caller can lay out a small
   melody in a single pass without timers. */
function tone(c, freq, when, dur, type, peak){
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type || 'sine';
  o.frequency.setValueAtTime(freq, c.currentTime + when);
  const t0 = c.currentTime + when;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak || 0.16, t0 + 0.014);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g); g.connect(c.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.03);
}

/* Nothing repeats exactly. A grade fires 30+ times a session, and the fastest
   way to make a chime irritating is to play the identical waveform every time,
   so three things vary:

   - WEIGHT. At a combo of 0-1 you get one short quiet note — a confirmation,
     not a fanfare. Two notes from 2, three and a sparkle from 5. The common
     case is the subtle one and the reward grows into the streak.
   - SHAPE. The interval between notes rotates through a few voicings instead
     of always being the same jump.
   - TUNING. Every note is detuned by up to ±0.4%, which is inaudible on its
     own but means no two chimes are bit-identical. */
const VOICINGS = [[0, 2], [0, 3], [0, 1], [0, 2, 4], [0, 3, 5], [0, 2, 5]];
let variant = 0;
const detune = (f) => f * (1 + (Math.random() - 0.5) * 0.008);
const scaleAt = (i) => PENT[Math.min(Math.max(i, 0), PENT.length - 1)];

function play(name, step){
  if (!soundOn) return;
  const c = audio();
  if (!c) return;
  // browsers hold the audio clock suspended until a gesture; every call here
  // happens inside a tap, so this is the right moment to wake it
  if (c.state === 'suspended'){ try { c.resume(); } catch {} }
  const n = Math.max(step || 0, 0);

  if (name === 'right'){
    const root = Math.min(n, 4);                       // climbs, then holds
    if (n < 2){                                        // the everyday case: light
      tone(c, detune(scaleAt(root)), 0, 0.1, 'sine', 0.085);
      return;
    }
    variant = (variant + 1) % VOICINGS.length;
    const shape = VOICINGS[n >= 5 ? 3 + (variant % 3) : variant % 3];
    shape.forEach((off, k) => tone(c, detune(scaleAt(root + off)), k * 0.055,
      k === shape.length - 1 ? 0.24 : 0.14, 'sine', 0.13 - k * 0.008));
    if (n >= 8) tone(c, detune(scaleAt(root + 6)), 0.16, 0.3, 'triangle', 0.045);
  } else if (name === 'ok'){
    tone(c, detune(PENT[1]), 0, 0.14, 'sine', 0.085);
  } else if (name === 'wrong'){
    tone(c, detune(174.61), 0, 0.26, 'triangle', 0.11);   // F3, soft — a nudge, not a buzzer
  } else if (name === 'milestone'){
    [0, 2, 4].forEach((off, k) => tone(c, detune(PENT[off]), k * 0.07, k === 2 ? 0.3 : 0.16, 'sine', 0.14));
  } else if (name === 'done'){
    [0, 2, 3, 5].forEach((off, k) => tone(c, detune(PENT[off]), k * 0.085, 0.42, 'sine', 0.15));
    tone(c, detune(PENT[6]), 0.34, 0.6, 'triangle', 0.08);
  } else if (name === 'excellence'){
    [0, 2, 4, 6].forEach((off, k) => tone(c, detune(PENT[off]), k * 0.06, 0.5, 'sine', 0.14));
  } else if (name === 'tick'){
    tone(c, detune(PENT[2]), 0, 0.045, 'sine', 0.04);
  }
}

/* Android fires these; iOS Safari ignores them entirely. Wrapped because a
   few browsers throw rather than no-op. */
const buzz = (ms) => { try { if (navigator.vibrate) navigator.vibrate(ms); } catch {} };

/* ---- usage counts --------------------------------------------------------
   How many people are making decks, marking answers and so on. NOT imported
   from @vercel/analytics here: this file also runs as a claude.ai Artifact,
   where that package does not exist and there is no endpoint to report to.
   web/main.jsx hangs the real reporter on window.__sfTrack; with no reporter
   this is a no-op, which is exactly what the Artifact wants.

   COUNTS AND FIXED VALUES ONLY. Never pass subject, topic, a card, a question,
   an answer or a filename: subject and topic are free-text boxes a student can
   type anything into, up to and including their own name, and the notes are
   the very thing we just promised not to keep. Numbers, and words chosen from
   a fixed list in this file, are the whole allowance. */
function track(event, props){
  try {
    const fn = (typeof window !== 'undefined') && window.__sfTrack;
    if (typeof fn === 'function') fn(event, props || {});
  } catch {}
}

const GRADES = ['Not yet', 'Achieved', 'Merit', 'Excellence'];

/* Errors are classified before they are counted, never sent raw — an upstream
   message can quote the prompt back, and the prompt is the student's notes. */
function failureKind(e){
  const m = (e && e.message) ? e.message : '';
  if (/\b429\b/.test(m)) return 'rate_limited';
  if (/timed out/i.test(m)) return 'timeout';
  if (/\b410\b/.test(m) || /\b404\b/.test(m)) return 'model_gone';
  if (/\b401\b/.test(m) || /\b403\b/.test(m) || /no API key/i.test(m)) return 'key';
  if (/API returned 5\d\d/.test(m)) return 'upstream';
  return 'other';
}

/* ---- version + changelog -------------------------------------------------
   APP_VERSION is the id we compare against settings.lastSeenVersion to decide
   whether to pop the "What's new" note. Bump it whenever PATCH_NOTES gains an
   entry. Newest first; the first element is the current release.

   The public version series restarts at 1.0.0 on launch day. Everything before
   it was built before anyone was using the app, and opening with seven releases
   of development history says "you missed a lot" to someone on their first day
   — so PRELAUNCH_NOTES is kept, but only behind the second tab on the Updates
   screen. Nothing in it ever reaches the pop-up.

   The two lists are compared by string equality, never ordering, so the old
   1.x numbers sitting above the new 1.0.0 cannot cause a mis-fire. They are not
   shown next to the pre-launch entries either — those were dev builds and the
   numbers mean nothing to a student. */
const APP_VERSION = '1.5.0';
const PATCH_NOTES = [
  { v: '1.5.0', date: '2026-08-25', title: 'Photograph it, and show your working', items: [
    'New: photograph a written answer instead of typing it. Tap "Photo of your writing" above the answer box, and what you wrote on paper comes back as text. Practice answers get written on paper, and so does every real one — typing three hundred words of physics into a phone was the reason marking was worth doing once and never again.',
    'It lands in the answer box, not straight into the marker, and that is on purpose. Reading handwriting is very good but not perfect — it will quietly tidy up a spelling now and then — so you get to see the words and fix them before anything is graded. What you send is what gets marked.',
    'Two pages of answer: photograph the second one and it is added underneath the first instead of replacing it.',
    'New card type: worked problems. A question you solve by showing a method, for the half of NCEA that is not an essay — the rearrangement, the unit conversion, the substitution.',
    'They are marked on the METHOD, step by step, against what a marker would actually award. You get a tick, a half or a cross on every step, and your own working highlighted line by line.',
    'It names where it FIRST went wrong. Everything after a slip in a calculation is carried along by it, so one wrong line can turn a whole page red for no reason. The steps after your mistake are marked on whether the method was right, not on the number you carried into them — which is how the standard is actually marked, and the difference between a fixable mistake and a lost afternoon.',
    'Stuck on one? "Show me the first step" hands over the method one line at a time. It is instant and works with no connection, because those steps are already on the card — they are the mark scheme.',
    'You can photograph working too. Every number came through in testing, though a fraction written with a bar across it comes back on one line with a slash.',
    'To make them: pick "Working" in Create, or leave it on Mixed and they turn up wherever your notes have something to calculate. If the material has nothing to solve, it says so instead of inventing a calculation — a made-up problem teaches a made-up method, and you cannot tell the difference until the exam.',
  ] },
  { v: '1.4.0', date: '2026-08-19', title: 'Find my gaps', items: [
    'New: type in a topic and it builds a short written test whose point is not the score. It tells you WHERE your understanding stops and exactly what was missing — "you did not connect the larger surface area to the number of particles exposed" rather than "6 out of 10".',
    'It asks you three kinds of question in order: name it, then explain how it links, then use it on a situation you have not seen. Those are the three rungs your written answers are graded on, so the report tells you which rung you fall off — the naming, the linking, or the applying.',
    'Every gap comes with the question, what you wrote, and the specific thing that was absent. Then a short list of what to work on, in order.',
    'One button turns everything you missed into cards. They land in Create as drafts, so you still look through them before they are kept.',
    'Quick (6 questions) or Full (12). "Not sure" is a real answer — it is more useful to the diagnosis than a guess, and it is not held against you.',
    'It keeps your last diagnosis so you can come back to the list while you study.',
    'As everywhere else, it will use the standard YOU name and is barred from recalling one of its own.',
    'Find my gaps, Learn and Quiz now sit in a row near the top of Home under "Test yourself", instead of in small print at the very bottom. Learn in particular was only reachable by scrolling past the whole dashboard.',
    'Study Feed is on TikTok and Instagram — @studyfeednz on both. Links are at the bottom of You.',
  ] },
  { v: '1.3.0', date: '2026-08-19', title: 'Options that make you think', items: [
    'The wrong answers in Learn and Quiz used to be pulled at random from your other cards, so a one-word answer could sit next to a whole paragraph — and you could pick the odd one out without reading the question. Wrong answers are now matched to the right one: same sort of length, same sort of thing, a number against numbers and a name against names.',
    'Where a deck holds nothing that could pass for the answer, Learn stops pretending. It shows you that card once, then asks you for it properly later in the same round.',
    'Dates and figures get proper wrong answers now — the year ten out, the value doubled or an order of magnitude off — instead of whatever number happened to be on another card.',
    'Learn keeps your place. Close it mid-round and it offers to pick up where you left off, with the ones that caught you out still marked.',
    'It ends by naming the cards that fought back, and offers to drill just those.',
    'On a keyboard: 1–4 picks an answer and Enter carries on. A right answer moves on by itself, so a long session is half the taps it was.',
    'The Learn progress bar was reading a hundredth of the real number and never appeared to move. It moves.',
    '"I was right" now finishes the card off properly instead of quietly costing you a round.',
  ] },
  { v: '1.2.1', date: '2026-08-18', title: 'Marking that knows what year it is', items: [
    'The marker no longer talks about achievement standards it half-remembers. NCEA has been rebuilt — the old Level 1 standards were retired at the end of 2023 — so it is now barred from naming a standard number, quoting a marking schedule, or telling you what "NZQA wants". It marks against the criteria on your card and the Achieved / Merit / Excellence ladder, which is the part that does not change.',
    'You can name your actual standard when you make a deck — pick "Something else…" under Pitch the questions at and type it. The marker will use yours; it just will not invent one.',
    'Feedback on your writing is no longer lost when the marker mis-copies your words. It used to quietly bin any note it could not line up with your answer — about one note in nine. Those notes now appear underneath without a highlight, so you get the whole mark.',
    'And far fewer go missing in the first place: most of those failures were the marker wrapping your words in quote marks or swapping a ’ for a ".',
  ] },
  { v: '1.2.0', date: '2026-08-18', title: 'Learn it, type it, note it', items: [
    'New Learn mode: it takes a deck and drills you until you can produce every answer, not just recognise it. You pick from four options the first time, then have to write it from memory. Rounds of seven with a checkpoint, and anything you miss comes straight back.',
    'Cards you actually type into. Fill-the-blanks are now filled in, and there is a new "type the answer" card for terms, names and values — because answering in your head is a generous marker.',
    'Typing is checked gently: capitals, punctuation and small spelling slips all pass, and there is always an "I was right" button when it gets you wrong.',
    'Your own notes on any card. Write down the thing that finally made it stick. It stays shut when the card comes back, so it never gives the answer away before you have tried.',
    'Learn and Quiz both leave your due dates alone — the feed is still what decides when you next see a card.',
  ] },
  { v: '1.1.0', date: '2026-08-13', title: 'Decks to start you off', items: [
    'No notes on you? Take a ready-made deck and start straight away — Genetics, Acids and bases, or Writing about a text.',
    'Each one has two full exam-style long answers, so you can try the marking without making anything first.',
    'They behave like your own decks: study them, edit the cards, or delete the lot.',
  ] },
  { v: '1.0.0', date: '2026-08-07', title: 'Study Feed is here', items: [
    'Turn your own notes, slides or a photo of the whiteboard into cards — including real exam-style long answers.',
    'Write a full answer and have it marked against Achieved, Merit and Excellence, with the exact change that moves you up a grade.',
    'Stuck mid-answer? Writing points first, then sentence starters — never the answer itself.',
    'Free, no account, nothing to install.',
  ] },
];

/* Everything below shipped before launch. Kept for the record; shown only under
   Updates → Before launch. */
const PRELAUNCH_NOTES = [
  { v: '1.7.1', date: '2026-08-06', title: 'Launch polish', items: [
    'Clearer about your data: your decks are saved on your device, and what you paste or upload is sent to an AI provider to write the cards. Said on the Create screen and in the site footer.',
    'Generating uses fewer tokens for the same cards, so big batches are less likely to get cut off.',
    'A friendlier message when the app is busy.',
  ] },
  { v: '1.7.0', date: '2026-08-06', title: 'Something to show for it', items: [
    'Share your week straight from the Home screen, under This week.',
    'Clear everything due and you can share that session too — cards done, subjects, streak — as a card built for your story.',
    'Earn an Excellence on a written answer and you can share that too, with a line of what you wrote and why it scored.',
    'The question itself never goes on the card — that came from your teacher\'s material, not yours.',
    'You see the card before it goes anywhere, and you can always just close it.',
  ] },
  { v: '1.6.0', date: '2026-08-05', title: 'A proper look', items: [
    'Study Feed has a real identity now — a stacked-card mark, a near-black and violet palette, and Inter throughout.',
    'The app finally has an icon. Add it to your home screen or pin the tab and you get the mark, not a blurry screenshot of the page.',
    'Sharing a link now shows a proper preview card instead of a blank grey box.',
    'Dark mode is the brand ground, so the app and the website look like the same product.',
  ] },
  { v: '1.5.0', date: '2026-08-05', title: 'Start here', items: [
    'New here? A short tour now runs on your first visit — pointers on the actual screen, walking you through making your first deck.',
    'It hands you a real long-answer card to try, hints and marking included, without saving anything.',
    'It ends by dropping you in the generator.',
    'Skip it whenever you like — and get it back any time from Settings → How this app works.',
  ] },
  { v: '1.4.0', date: '2026-08-03', title: 'Sharper edges', items: [
    'Flip cards actually flip now — the card turns over to show the answer.',
    'Every emoji is gone, replaced with icons drawn to match the rest of the app.',
    'A new typeface, and you can change it: Settings → Appearance.',
    'The chime no longer repeats itself — it stays light for ordinary answers and only opens up as your streak grows.',
    'Marking a long answer shows a loader instead of looking frozen.',
    'The feed progress bar now tells you how many you\'ve done, not just how far along you are.',
  ] },
  { v: '1.3.0', date: '2026-08-03', title: 'It feels like something now', items: [
    'Answers land: colour bursts, sound and a bit of a kick every time you grade a card.',
    'Build a streak — get them right back to back and the chime climbs with your combo.',
    'Finishing your due cards is now an actual moment, not a silent hand-off to practice.',
    'Multi-choice tells you instantly: the right answer glows, a wrong pick shakes.',
    'Drag files straight onto the Create page, and watch real progress while cards are made.',
    'Sound can be switched off any time — the speaker in the top corner, or Settings.',
  ] },
  { v: '1.2.0', date: '2026-07-31', title: 'Ask, explain & upgrade', items: [
    'Ask anything, anywhere — a study helper sits in the corner of every screen, and it can see the card you\'re on.',
    'Didn\'t get the answer? Tap “Explain this further” on any card for the reasoning behind it — and “Simpler” or “Go deeper” if that wasn\'t the right level.',
    'After marking a long answer, tap “How do I get to Merit?” for the exact moves to make on YOUR answer — where to change it and what the better sentence looks like.',
    'Export one deck on its own, or pick exactly which decks go into a backup, instead of always exporting everything.',
  ] },
  { v: '1.1.0', date: '2026-07-29', title: 'Decks, quizzes & PDFs', items: [
    'Study one deck at a time — pick it from the top of your feed instead of always getting the full mix.',
    'Quiz mode: a quick, graded test built from any deck. A fast way to check yourself before an exam.',
    'Upload PDFs too, alongside Word, PowerPoint, images and text.',
    'Keep cards strictly to your notes — turn on “Only my material” so nothing extra is added.',
    'Stuck on a long answer? A second, bigger nudge now gives you sentence starters when writing points aren’t enough.',
    'Little tips for finding your way around, and this “What’s new” note.',
    'Send a feature request straight from the You tab.',
  ] },
];
const dismissedTip = (settings, id) => !!(settings && settings.dismissedTips && settings.dismissedTips[id]);
const fontOf = (s) => (s && s.font) ? s.font : 'inter';
const longMixOf = (s) => (s && s.longMix != null) ? s.longMix : 30;
/* "Long" is about how much of a sitting the card costs, not about which
   type it is — the feed's quick/long blend is a pacing decision. A worked
   problem is several minutes with a pen, so it belongs on the same side of
   that line as an extended response. */
const isLongCard = (c) => c.type === 'extended' || c.type === 'worked';

/* Interleave two lists so roughly pctLong% of the output comes from `long`.
   Nothing is dropped — when one side runs out the rest is appended, so a due
   card is never skipped just because of the mix. */
function blendByRatio(long, quick, pctLong){
  const out = [];
  let li = 0, qi = 0;
  while (li < long.length || qi < quick.length){
    const total = li + qi;
    const wantLong = total === 0 ? (pctLong >= 50) : ((li / total) * 100 < pctLong);
    if (wantLong && li < long.length) out.push(long[li++]);
    else if (qi < quick.length) out.push(quick[qi++]);
    else if (li < long.length) out.push(long[li++]);
  }
  return out;
}
const DEFAULT_STATS = { streak: 0, lastDay: '', newByDate: {}, reviewsByDate: {}, practiceByDate: {}, bySubject: {} };

/* ---- SM-2 scheduler ------------------------------------------------------ */
function freshProgress(){
  return { ease: 2.5, interval: 0, reps: 0, lapses: 0, due: TODAY(), flagged: false, seen: false };
}
const Q = { AGAIN: 0, HARD: 3, GOOD: 4, EASY: 5 };

/* `committedWrong` is only for multiple choice, where picking an option is a
   real commitment. Everywhere else the "I thought I knew this" signal is
   DERIVED: a card you'd built a real interval on, that you then blank, is
   exactly overconfidence — no need to interrupt and ask. */
function schedule(prevRaw, q, committedWrong){
  const p = { ...freshProgress(), ...prevRaw };
  p.seen = true;
  let reinsert = false;
  const wasKnown = !!(prevRaw && prevRaw.seen && (prevRaw.reps >= 2 || prevRaw.interval >= 6));

  if (q === Q.AGAIN){
    p.reps = 0;
    p.ease = Math.max(1.3, p.ease - 0.2);
    p.lapses += 1;
    p.due = TODAY();
    reinsert = true;
    if (wasKnown || committedWrong) p.flagged = true;   // you thought you had this
  } else {
    if (q === Q.HARD)      p.ease = Math.max(1.3, p.ease - 0.15);
    else if (q === Q.EASY) p.ease = p.ease + 0.15;

    /* Distinct steps at every stage — the old SM-2 gave Hard/Good/Easy the
       SAME interval for the first two reviews (1 then 6), so the previews all
       showed the same time. Graduating steps make the four buttons mean
       something from the very first review. */
    let ivl;
    if (p.reps === 0)      ivl = q === Q.HARD ? 1 : q === Q.GOOD ? 2 : 4;
    else if (p.reps === 1) ivl = q === Q.HARD ? 3 : q === Q.GOOD ? 6 : 10;
    else if (q === Q.HARD) ivl = p.interval * 1.2;
    else if (q === Q.EASY) ivl = p.interval * p.ease * 1.3;
    else                   ivl = p.interval * p.ease;
    p.reps += 1;

    if (committedWrong && q < Q.GOOD) p.flagged = true;
    if (q >= Q.GOOD) p.flagged = false;
    if (p.flagged) ivl = ivl / 2;

    p.interval = Math.max(1, ivl);
    p.due = addDays(TODAY(), p.interval);
  }
  return { next: p, reinsert };
}

function stateLabel(p){
  if (!p || !p.seen) return 'New';
  if (p.flagged) return 'Keeps tripping you up';
  if (p.due <= TODAY()) return 'Due now';
  const days = Math.max(1, Math.round((new Date(p.due) - new Date(TODAY())) / 86400000));
  return 'In ' + days + (days === 1 ? ' day' : ' days');
}

function intervalWord(days){
  const d = Math.max(1, Math.round(days));
  if (d === 1) return 'tomorrow';
  if (d < 30) return d + ' days';
  const m = Math.round(d / 30);
  return m === 1 ? 'a month' : m + ' months';
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* ---- import / export -----------------------------------------------------
   Cards cost money to generate, so they should be movable: between the
   Artifact and the website, between devices, or to a friend. Text transfer
   is offered alongside file download because an Artifact iframe may block
   downloads, and copy/paste always works. */
function buildExport(decks, progress){
  const ids = new Set();
  for (const d of decks) for (const c of d.cards) ids.add(c.id);
  const prog = {};
  for (const k of Object.keys(progress || {})) if (ids.has(k)) prog[k] = progress[k];
  return { kind: 'study-feed', version: 1, exportedAt: new Date().toISOString(), decks, progress: prog };
}

function downloadJson(obj, filename){
  try {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
    return true;
  } catch { return false; }
}

/* A filename that survives every OS and every browser: lowercase letters,
   digits and dashes, nothing else. */
function safeFileName(s, fallback){
  const base = String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+/, '').replace(/-+$/, '');
  return base || fallback;
}
const exportName = (decks) => decks.length === 1
  ? 'study-feed-' + safeFileName(decks[0].topic || decks[0].subject, 'deck') + '-' + TODAY() + '.json'
  : 'study-feed-' + TODAY() + '.json';

/* ==========================================================================
   SHAREABLE CARDS

   A story-shaped PNG for the two moments worth telling someone about: clearing
   everything due, and earning an Excellence on a written answer.

   Drawn on a canvas rather than screenshotted from the DOM. html2canvas and
   friends are a dependency this app cannot take — the Artifact build has no
   bundler — and a screenshot of a phone-width screen is the wrong shape for a
   story anyway. Canvas also means the card is composed for sharing rather than
   cropped from something that was not.

   NOTHING THE STUDENT WROTE GOES ON THE CARD. Not the question, not their
   answer. The questions are generated from their teacher's slides and past
   papers, which are not theirs to publish, and their answer is their own work
   that they have not agreed to post. The card carries the achievement and the
   subject they named themselves — which is what makes a good share anyway.
   ========================================================================== */

const SHARE_W = 1080, SHARE_H = 1920;   // 9:16, the story format everywhere

/* The only place the card's URL is written. When the custom domain lands this
   is a one-line change — but it is NOT the only place the domain appears:
   docs/index.html has og:url and two absolute og:image/twitter:image URLs that
   have to move with it, and CLAUDE.md quotes them. Grep for vercel.app. */
const SHARE_URL = 'studyfeed.app';

/* ---- what made this session worth posting -------------------------------
   The first version said "EVERYTHING DUE, DONE" every single time, so someone
   who shares twice has posted the same picture twice and stops bothering. This
   reads the history for the most interesting thing that is actually TRUE today
   and leads with that, which is what makes Bevel's cards feel personal.

   Everything here comes from reviewsByDate, which already exists — no new
   storage, and no claim that isn't backed by the numbers. */
function sessionHeadline(stats, done, subjects){
  const by = (stats && stats.reviewsByDate) || {};
  const today = TODAY();
  const todayN = by[today] || 0;

  const others = Object.keys(by).filter(d => d !== today);
  const best = others.reduce((m, d) => Math.max(m, by[d] || 0), 0);
  if (others.length >= 3 && todayN > best) return 'BEST DAY YET';

  /* How long since the last day with any reviews on it */
  let gap = 0;
  for (let i = 1; i <= 30; i++){
    if (by[addDays(today, -i)]) break;
    gap = i;
  }
  if (gap >= 3 && others.length) return 'FIRST SESSION IN ' + (gap + 1) + ' DAYS';

  if (subjects && subjects.length >= 3) return subjects.length + ' SUBJECTS IN ONE SITTING';
  if ((stats && stats.streak || 0) >= 7) return stats.streak + ' DAYS IN A ROW';
  if (others.length === 0) return 'FIRST SESSION DONE';
  return 'EVERYTHING DUE, DONE';
}

/* The Home card sums a week rather than one sitting, so "best day yet" and
   "first session in N days" don't apply to it — those are about today. */
function weekHeadline(stats, subjects){
  const streak = (stats && stats.streak) || 0;
  if (streak >= 7) return streak + ' DAYS IN A ROW';
  if (subjects && subjects.length >= 3) return subjects.length + ' SUBJECTS THIS WEEK';
  if (streak >= 2) return streak + ' DAYS IN A ROW';
  return 'THIS WEEK';
}

/* Seven days ending today, for the little bar strip. */
function sessionWeek(stats){
  const by = (stats && stats.reviewsByDate) || {};
  const out = [];
  for (let i = 6; i >= 0; i--){
    const day = addDays(TODAY(), -i);
    out.push(by[day] || 0);
  }
  return out;
}

/* Brand literals, not theme tokens: the card looks the same whether the app is
   in light or dark mode and whoever sees it is not running our CSS.

   Light, like the landing page and against the kit's near-black ground. A
   near-black slab filling a story reads as a poster; this has to read as
   something a 16-year-old wants on their story, and the reference for it
   (Bevel) is light, contained and round. Same violet, same mark, same Inter. */
const SC = {
  bgTop: '#EDE6FF', bgBot: '#FBFAFF',
  card: '#FFFFFF',
  ink: '#1F1B2E', muted: '#5C5470', faint: '#8A83A0',
  violet: '#7C5CFF', violetInk: '#5B3FD9', violetSoft: '#F2EEFF',
  green: '#2FA37C', greenInk: '#12805C', greenSoft: '#E4F6EF',
  line: '#EDEAF6',
};

const scFont = (weight, size) => weight + ' ' + size + 'px Inter, ' + SYSTEM_STACK;

function scRoundRect(ctx, x, y, w, h, r){
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* Soft-filled pill, drawn left to right, returning the x it finished at so a
   row of them lays out without measuring twice. Filled rather than outlined —
   outlines read as form fields, fills read as stickers. */
function scChip(ctx, text, x, y, fill, colour, size){
  const fs = size || 32;
  ctx.font = scFont(700, fs);
  const padX = 28, h = fs + 34;
  const w = ctx.measureText(text).width + padX * 2;
  ctx.fillStyle = fill;
  scRoundRect(ctx, x, y, w, h, h / 2);
  ctx.fill();
  ctx.fillStyle = colour;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, x + w / 2, y + h / 2 + 1);
  return x + w + 16;
}
const scChipW = (ctx, text, size) => {
  ctx.font = scFont(700, size || 32);
  return ctx.measureText(text).width + 56;
};

/* One rounded panel with a soft drop shadow. The shadow is reset immediately —
   canvas shadow state is global and leaks into every later fill if left set. */
function scPanel(ctx, x, y, w, h, r, fill, shadow){
  ctx.save();
  if (shadow){
    ctx.shadowColor = 'rgba(48,32,96,0.16)';
    ctx.shadowBlur = 60; ctx.shadowOffsetY = 22;
  }
  ctx.fillStyle = fill;
  scRoundRect(ctx, x, y, w, h, r);
  ctx.fill();
  ctx.restore();
}

/* A tick in a filled circle — the "this was credited" mark. */
function scTick(ctx, cx, cy, r){
  ctx.fillStyle = SC.greenSoft;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = SC.greenInk;
  ctx.lineWidth = r * 0.28; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.42, cy + r * 0.02);
  ctx.lineTo(cx - r * 0.10, cy + r * 0.34);
  ctx.lineTo(cx + r * 0.44, cy - r * 0.34);
  ctx.stroke();
}

/* Seven days of reviews as a small bar strip. Gives the session card something
   to look at besides one number, and it is the student's own week rather than
   decoration — the thing that makes a stat card feel like it is about you.
   Empty days keep a stub so the row still reads as seven days. */
function scWeekBars(ctx, x, y, w, h, week){
  const n = week.length;
  const gap = 16;
  const bw = (w - gap * (n - 1)) / n;
  const max = Math.max(1, ...week);
  const labels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  /* reviewsByDate is keyed by real dates, so the strip ends today — the letters
     have to be rotated to match rather than assuming the week starts Monday */
  const todayIdx = new Date(TODAY() + 'T00:00:00').getDay();   // 0 = Sunday
  for (let i = 0; i < n; i++){
    const isToday = i === n - 1;
    const bh = Math.max(8, Math.round((week[i] / max) * h));
    const bx = x + i * (bw + gap);
    ctx.fillStyle = isToday ? SC.violet : (week[i] ? 'rgba(124,92,255,0.30)' : SC.line);
    /* Radius has to clear HALF THE HEIGHT as well as half the width. An empty
       day is only 8px tall, and a 10px corner on it drew a broken-looking arc
       instead of a stub. */
    scRoundRect(ctx, bx, y + (h - bh), bw, bh, Math.min(bw / 2, bh / 2, 10));
    ctx.fill();
    // Monday-indexed letter for this column
    const dow = (todayIdx - (n - 1 - i) + 70) % 7;
    ctx.fillStyle = isToday ? SC.violetInk : SC.faint;
    ctx.font = scFont(isToday ? 700 : 500, 22);
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(labels[(dow + 6) % 7], bx + bw / 2, y + h + 30);
  }
}

/* Keeps a quote to something a passer-by will actually read. Cuts on a word and
   only adds the ellipsis when it really did cut. */
function scClamp(text, max){
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[,;:.\s]+$/, '') + '…';
}

/* Greedy wrap. Returns the lines rather than drawing, so the caller can centre
   the block vertically once it knows how tall it came out. */
function scWrap(ctx, text, maxW){
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words){
    const next = line ? line + ' ' + word : word;
    if (ctx.measureText(next).width > maxW && line){ lines.push(line); line = word; }
    else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/* The mark, from the same path data as brand/svg/mark-on-light.svg. Path2D
   takes SVG path syntax directly, so the geometry is never transcribed. On a
   light ground the lower two layers are near-black — the kit's own rule. */
function scMark(ctx, x, y, size){
  const s = size / 100;
  ctx.save();
  ctx.translate(x, y); ctx.scale(s, s);
  ctx.lineWidth = 8.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const top = new Path2D('M50 12 L86 33 L50 54 L14 33 Z');
  const mid = new Path2D('M14 49 L50 70 L86 49');
  const low = new Path2D('M14 65 L50 86 L86 65');
  ctx.strokeStyle = SC.violet; ctx.stroke(top);
  ctx.strokeStyle = SC.ink; ctx.stroke(mid); ctx.stroke(low);
  ctx.restore();
}

/* The backdrop the card floats on. Soft blobs rather than a flat wash — the
   card has to read as sitting ON something, or "contained" just looks like a
   smaller poster. Deterministic positions: a card that came out different
   every time would be unsettling rather than delightful. */
function scBackdrop(ctx){
  const g = ctx.createLinearGradient(0, 0, 0, SHARE_H);
  g.addColorStop(0, SC.bgTop); g.addColorStop(1, SC.bgBot);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, SHARE_W, SHARE_H);

  const blob = (cx, cy, r, alpha) => {
    const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    rg.addColorStop(0, 'rgba(124,92,255,' + alpha + ')');
    rg.addColorStop(1, 'rgba(124,92,255,0)');
    ctx.fillStyle = rg;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  };
  blob(880, 240, 520, 0.34);
  blob(140, 620, 460, 0.20);
  blob(940, 1560, 500, 0.22);
  blob(180, 1780, 420, 0.16);
}

/* Small floating circles flanking whatever the card is celebrating. This is the
   one purely decorative thing on the card, so it must never land on top of
   anything that carries meaning — the first version used fixed offsets and put
   dots across the eyebrow and over the middle of a wide grade badge.

   `halfW` is the half-width of the thing being flanked, so the dots start
   outside it: they sit close to a narrow number and further out around a wide
   badge, without either colliding or drifting off the card. */
function scSparkles(ctx, cx, cy, halfW, limit){
  const dots = [
    [30, -34, 12, 0.50], [86, 28, 8, 0.34], [132, -8, 6, 0.26],
  ];
  for (const side of [-1, 1]){
    for (const [gap, dy, r, a] of dots){
      const x = cx + side * (halfW + gap);
      if (Math.abs(x - cx) > limit) continue;      // never past the card edge
      ctx.fillStyle = 'rgba(124,92,255,' + a + ')';
      ctx.beginPath(); ctx.arc(x, cy + dy, r, 0, Math.PI * 2); ctx.fill();
    }
  }
}

/* kind: 'grade'   -> { grade, subject, topic, verb, marks, answer, credit }
   kind: 'session' -> { done, streak, subjects: [] }

   Laid out in two passes. The first measures every block so the card can be
   sized to its contents and centred; the second draws. Without that the card
   is a fixed box that either crops a long answer or leaves a hole under a
   short one, and the whole point of a contained card is that it looks
   deliberate at any content length. */
function drawShareCard(ctx, kind, d){
  scBackdrop(ctx);

  const cardX = 76, cardW = SHARE_W - cardX * 2;
  const pad = 62;                        // card padding
  const innerW = cardW - pad * 2;
  const cx = SHARE_W / 2;

  /* ---- pass 1: measure ---- */
  const blocks = [];
  const push = (h, draw) => blocks.push({ h: h, draw: draw });

  if (kind === 'grade'){
    const badge = String(d.grade || 'Excellence');
    ctx.font = scFont(800, 76);
    const badgeW = ctx.measureText(badge).width + 96;

    push(34, (y) => {
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = SC.faint; ctx.font = scFont(700, 26);
      ctx.fillText('MARKED AGAINST THE NCEA CRITERIA', cx, y + 26);
    });
    push(28, null);
    push(118, (y) => {
      scSparkles(ctx, cx, y + 59, badgeW / 2, cardW / 2 - 26);
      scPanel(ctx, cx - badgeW / 2, y, badgeW, 118, 59, SC.green, true);
      ctx.fillStyle = '#FFFFFF'; ctx.font = scFont(800, 76);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(badge, cx, y + 61);
    });

    /* The ladder, with the rung they reached lit. The badge alone says what
       they got; this says what they got PAST, which is the part that reads as
       a climb. Dots rather than words so it stays a glance, not a second
       reading of the same information. */
    push(22, null);
    push(26, (y) => {
      const tiers = ['Achieved', 'Merit', 'Excellence'];
      const at = tiers.indexOf(badge);
      if (at < 0) return;
      const w = 74, gap = 12;
      let x = cx - (tiers.length * w + (tiers.length - 1) * gap) / 2;
      for (let i = 0; i < tiers.length; i++){
        ctx.fillStyle = i <= at ? SC.green : SC.line;
        scRoundRect(ctx, x, y + 8, w, 10, 5);
        ctx.fill();
        x += w + gap;
      }
    });
    push(32, null);

    ctx.font = scFont(700, 50);
    const subjLines = scWrap(ctx, d.subject || 'My notes', innerW).slice(0, 2);
    push(subjLines.length * 60, (y) => {
      ctx.fillStyle = SC.ink; ctx.font = scFont(700, 50);
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      let yy = y + 46;
      for (const l of subjLines){ ctx.fillText(l, cx, yy); yy += 60; }
    });

    if (d.topic){
      ctx.font = scFont(400, 36);
      const topLines = scWrap(ctx, d.topic, innerW).slice(0, 2);
      push(topLines.length * 46 + 6, (y) => {
        ctx.fillStyle = SC.muted; ctx.font = scFont(400, 36);
        ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
        let yy = y + 40;
        for (const l of topLines){ ctx.fillText(l, cx, yy); yy += 46; }
      });
    }

    /* Their own words. This is the evidence — a grade with nothing behind it
       is a claim, and a claim is not interesting enough to post. The question
       stays off: it is generated from their teacher's material, not theirs. */
    if (d.answer){
      const quote = scClamp(d.answer, 155);
      ctx.font = scFont(400, 34);
      const qLines = scWrap(ctx, '“' + quote + '”', innerW - 76).slice(0, 4);
      const qh = qLines.length * 48 + 96;
      push(38, null);
      push(qh, (y) => {
        scPanel(ctx, cardX + pad, y, innerW, qh, 34, SC.violetSoft, false);
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = SC.violetInk; ctx.font = scFont(700, 24);
        ctx.fillText('WHAT YOU WROTE', cardX + pad + 38, y + 46);
        ctx.fillStyle = SC.ink; ctx.font = scFont(400, 34);
        let yy = y + 96;
        for (const l of qLines){ ctx.fillText(l, cardX + pad + 38, yy); yy += 48; }
      });
    }

    /* One line of the marking, so the grade is shown being earned. */
    if (d.credit){
      ctx.font = scFont(500, 32);
      const cLines = scWrap(ctx, scClamp(d.credit, 120), innerW - 74).slice(0, 3);
      const ch = Math.max(58, cLines.length * 44);
      push(26, null);
      push(ch, (y) => {
        scTick(ctx, cardX + pad + 26, y + 26, 26);
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = SC.muted; ctx.font = scFont(500, 32);
        let yy = y + 36;
        for (const l of cLines){ ctx.fillText(l, cardX + pad + 70, yy); yy += 44; }
      });
    }

    if (d.verb || d.marks){
      const chips = [];
      if (d.verb) chips.push(String(d.verb));
      if (d.marks) chips.push(d.marks + ' marks');
      push(30, null);
      push(66, (y) => {
        let total = 0;
        for (const c of chips) total += scChipW(ctx, c) + 16;
        let x = cx - (total - 16) / 2;
        for (const c of chips) x = scChip(ctx, c, x, y, SC.violetSoft, SC.violetInk);
      });
    }
  } else {
    const headline = d.headline || 'EVERYTHING DUE, DONE';
    push(34, (y) => {
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = SC.violetInk; ctx.font = scFont(700, 26);
      ctx.fillText(headline, cx, y + 26);
    });
    push(20, null);
    push(190, (y) => {
      ctx.font = scFont(800, 172);
      scSparkles(ctx, cx, y + 95, ctx.measureText(String(d.done)).width / 2, cardW / 2 - 26);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = SC.violet; ctx.font = scFont(800, 172);
      ctx.fillText(String(d.done), cx, y + 98);
    });
    push(4, null);
    /* Home shares a week, the feed shares a sitting — same card, different noun */
    const countLabel = d.label || (d.done === 1 ? 'card reviewed' : 'cards reviewed');
    push(60, (y) => {
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = SC.ink; ctx.font = scFont(700, 50);
      ctx.fillText(countLabel, cx, y + 48);
    });

    if (d.subjects && d.subjects.length){
      ctx.font = scFont(400, 36);
      const sLines = scWrap(ctx, d.subjects.join(' · '), innerW).slice(0, 2);
      push(18, null);
      push(sLines.length * 46, (y) => {
        ctx.fillStyle = SC.muted; ctx.font = scFont(400, 36);
        ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
        let yy = y + 38;
        for (const l of sLines){ ctx.fillText(l, cx, yy); yy += 46; }
      });
    }
    /* Their own week. Only shown once there is a week worth showing — a single
       lonely bar next to six empty ones is a worse card than no chart. */
    if (d.week && d.week.filter(n => n > 0).length >= 2){
      push(34, null);
      push(140, (y) => {
        scWeekBars(ctx, cardX + pad + 40, y, innerW - 80, 106, d.week);
      });
    }

    if (d.streak > 0){
      const label = d.streak + ' day streak';
      push(30, null);
      push(66, (y) => {
        const w = scChipW(ctx, label);
        scChip(ctx, label, cx - w / 2, y, SC.greenSoft, SC.greenInk);
      });
    }
  }

  /* footer lives inside the card, so the whole thing is one object */
  push(38, null);
  push(2, (y) => {
    ctx.strokeStyle = SC.line; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cardX + pad, y); ctx.lineTo(cardX + cardW - pad, y); ctx.stroke();
  });
  push(30, null);
  /* Mark + wordmark on one line, domain under it. A bare URL was the whole
     footer before, which read as a link dumped on the artwork; a lockup reads
     as a brand signing its own work — and it stops depending on the domain
     being short enough to carry the line, which today's is not. */
  push(96, (y) => {
    ctx.font = scFont(800, 40);
    const name = 'Study Feed';
    const tw = ctx.measureText(name).width;
    const total = 52 + 18 + tw;
    const x0 = cx - total / 2;
    scMark(ctx, x0, y, 52);
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillStyle = SC.ink;
    ctx.fillText(name, x0 + 70, y + 28);

    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = SC.violetInk; ctx.font = scFont(600, 30);
    ctx.fillText(SHARE_URL, cx, y + 88);
  });

  /* ---- pass 2: size, centre, draw ---- */
  let contentH = 0;
  for (const b of blocks) contentH += b.h;
  const cardH = contentH + pad * 2;
  /* Nudged above centre: a story is read top-down and the bottom third is
     where the reply bar and the poster's own stickers land. */
  const cardY = Math.max(210, Math.round((SHARE_H - cardH) / 2) - 50);

  scPanel(ctx, cardX, cardY, cardW, cardH, 68, SC.card, true);

  let y = cardY + pad;
  for (const b of blocks){
    if (b.draw) b.draw(y);
    y += b.h;
  }
}

/* Waits for Inter before drawing — canvas silently falls back to the system
   face if the webfont has not loaded, and the card would ship in the wrong
   typeface. The Artifact has no webfonts at all, so this resolves immediately
   there and the system stack is the intended fallback. */
async function makeShareBlob(kind, data){
  try { if (document.fonts && document.fonts.ready) await document.fonts.ready; } catch {}
  const canvas = document.createElement('canvas');
  canvas.width = SHARE_W; canvas.height = SHARE_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  drawShareCard(ctx, kind, data);
  return await new Promise(res => {
    try { canvas.toBlob(b => res(b), 'image/png'); } catch { res(null); }
  });
}

/* Web Share with a file is the only route from a web app into Instagram or
   Snapchat stories: there is no API to post directly, so the OS sheet does it
   and the student picks where. Everything else falls back to a download. */
async function shareBlob(blob, filename, text){
  if (!blob) return 'failed';
  try {
    const file = new File([blob], filename, { type: 'image/png' });
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })){
      await navigator.share({ files: [file], text: text });
      return 'shared';
    }
  } catch (e){
    // AbortError is the student closing the sheet — not a failure worth reporting
    if (e && e.name === 'AbortError') return 'cancelled';
  }
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
    return 'saved';
  } catch { return 'failed'; }
}

async function copyText(text){
  try { await navigator.clipboard.writeText(text); return true; }
  catch { return false; }
}

/* Merge an export into the current library. Anything whose id already exists
   gets a fresh one, so importing a friend's deck can't overwrite yours — and
   progress follows the remapped ids so your own backups keep their history. */
function mergeImport(payload, library, progress){
  if (!payload || !Array.isArray(payload.decks)) throw new Error('That file is not a Study Feed export.');
  const existingDeckIds = new Set(library.decks.map(d => d.id));
  const existingCardIds = new Set();
  for (const d of library.decks) for (const c of d.cards) existingCardIds.add(c.id);

  const incoming = [];
  const nextProgress = { ...progress };
  let cardCount = 0;

  for (const d of payload.decks){
    if (!d || !Array.isArray(d.cards)) continue;
    const deckClash = existingDeckIds.has(d.id);
    const idMap = {};
    const cards = [];
    for (const c of d.cards){
      if (!c || !c.type) continue;
      const fresh = (deckClash || existingCardIds.has(c.id) || !c.id) ? uid() : c.id;
      idMap[c.id] = fresh;
      existingCardIds.add(fresh);
      cards.push({ ...c, id: fresh });
    }
    if (!cards.length) continue;
    incoming.push({
      id: deckClash ? uid() : d.id,
      subject: String(d.subject || 'Untitled'),
      topic: String(d.topic || ''),
      standard: String(d.standard || 'NCEA Level 1'),
      cards,
    });
    const p = payload.progress || {};
    for (const oldId of Object.keys(idMap)) if (p[oldId]) nextProgress[idMap[oldId]] = p[oldId];
    cardCount += cards.length;
  }

  if (!incoming.length) throw new Error('No decks found in that file.');
  return { decks: library.decks.concat(incoming), progress: nextProgress, deckCount: incoming.length, cardCount };
}
function shuffle(a){
  const r = a.slice();
  for (let i = r.length - 1; i > 0; i--){ const j = Math.floor(Math.random() * (i + 1)); const t = r[i]; r[i] = r[j]; r[j] = t; }
  return r;
}

/* ==========================================================================
   GENERATION
   ========================================================================== */
const COMMAND_VERBS = ['Describe','Explain','Discuss','Compare and contrast','Evaluate','Justify','Analyse'];

function rescueObjects(text){
  const out = [];
  let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < text.length; i++){
    const c = text[i];
    if (inStr){
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"'){ inStr = true; continue; }
    if (c === '{'){ if (depth === 0) start = i; depth++; }
    else if (c === '}'){
      depth--;
      if (depth === 0 && start >= 0){
        try { out.push(JSON.parse(text.slice(start, i + 1))); } catch {}
        start = -1;
      }
    }
  }
  return out;
}
function parseJsonArray(text){
  try { const m = text.match(/\[[\s\S]*\]/); if (m) return JSON.parse(m[0]); } catch {}
  return rescueObjects(text);
}

function cardsFromJson(arr){
  const out = [];
  for (const o of arr || []){
    if (!o || !o.type) continue;
    const t = o.type;
    if (t === 'flip' || t === 'cloze'){
      if (o.front && o.back) out.push({ id: uid(), type: t, front: String(o.front), back: String(o.back) });
    } else if (t === 'typed'){
      /* Dropped rather than downgraded if the answer is too long to type:
         a "type the answer" card you cannot reasonably type is worse than one
         fewer card, and the model does occasionally return a sentence here. */
      const accept = Array.isArray(o.accept) ? o.accept.map(String).map(s => s.trim()).filter(Boolean).slice(0, 4) : [];
      const cand = { id: uid(), type: 'typed', front: String(o.front || ''), back: String(o.back || ''), accept };
      if (cand.front && cand.back && typedCheckable(cand)) out.push(cand);
    } else if (t === 'short'){
      if (o.front && o.back) out.push({ id: uid(), type: 'short', front: String(o.front), back: String(o.back) });
    } else if (t === 'mcq'){
      const opts = (o.options || []).map(String).map(s => s.trim()).filter(Boolean);
      let ans = Number(o.answer);
      if (!(ans >= 0 && ans < opts.length)) ans = 0;
      if (o.front && opts.length >= 2) out.push({ id: uid(), type: 'mcq', front: String(o.front), options: opts, answer: ans, why: String(o.why || '') });
    } else if (t === 'extended'){
      if (o.prompt && o.achieved) out.push({ id: uid(), type: 'extended',
        verb: COMMAND_VERBS.includes(o.verb) ? o.verb : (o.verb || 'Explain'),
        prompt: String(o.prompt), marks: Number(o.marks) || 4,
        achieved: String(o.achieved || ''), merit: String(o.merit || ''),
        excellence: String(o.excellence || ''), skeleton: String(o.skeleton || ''),
        pitfall: String(o.pitfall || '') });
    } else if (t === 'worked'){
      /* A worked problem with no method is just a question with an answer, and
         the method is the entire point — so a step-less one is dropped rather
         than kept as a degraded card, the same rule as a `typed` card whose
         answer nobody could type. Two steps is the floor at which there is a
         method to mark at all. */
      const steps = Array.isArray(o.steps) ? o.steps.map(String).map(s => s.trim()).filter(Boolean).slice(0, 8) : [];
      if (o.prompt && o.answer && steps.length >= 2) out.push({ id: uid(), type: 'worked',
        prompt: String(o.prompt), marks: Number(o.marks) || 3,
        steps: steps, answer: String(o.answer),
        pitfall: String(o.pitfall || '') });
    }
  }
  return out;
}
function dedupeCards(cards){
  const seen = new Set();
  const out = [];
  for (const c of cards){
    const key = (c.type === 'extended' || c.type === 'worked')
      ? c.type.charAt(0) + ':' + String(c.prompt || '').toLowerCase().slice(0, 80)
      : (c.type + ':' + String(c.front || '').toLowerCase());
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

/* Batch size is a trade: bigger batches burn less usage (fewer API calls), but
   a bigger batch means a longer reply, and a long reply is what pushes a
   request past the proxy's 60s ceiling. 6k characters keeps a single reply
   comfortably inside it even on a slow school connection — the old 12k could
   finish in ~11s at home and still time out on a congested network. */
function batchText(text, size = 6000){
  const paras = text.split(/\n\s*\n/);
  const batches = [];
  let cur = '';
  for (const p of paras){
    if ((cur + '\n\n' + p).length > size && cur){ batches.push(cur); cur = p; }
    else cur = cur ? cur + '\n\n' + p : p;
  }
  if (cur.trim()) batches.push(cur);
  return batches.length ? batches : [text];
}

/* When the student wants cards drawn ONLY from what they uploaded — no outside
   knowledge padded in. Appended to whichever prompt is used. */

/* ---- NCEA ----------------------------------------------------------------
   A model's memory of NCEA is always a year or two stale, and NCEA has moved
   more than most: the Level 1 achievement standards were rebuilt for 2024, the
   old 90xxx Level 1 standards expired at the end of 2023, and the upper levels
   have been through their own review since. A student working on a current
   standard was getting feedback framed around the one it replaced — marked
   against criteria that no longer exist, and told to add things the retired
   version asked for.

   The fix is NOT to teach the model the current list of standards. That list
   changes, this file would go stale in exactly the same way, and it cannot be
   verified from inside a prompt. The fix is to stop the model asserting
   anything about the standards at all.

   Two things are stable and both are already in front of it: the grade ladder
   (demonstrate / in-depth / comprehensive understanding), which has survived
   every version of NCEA; and the card's own achieved/merit/excellence
   descriptors, which were written from the student's own material. Those are
   the only authorities the marker is allowed to appeal to. */
const NCEA_RULES = `

NCEA RULES — these override anything you remember about NZQA:
- NEVER cite, quote or invent an achievement standard number (AS90xxx, AS91xxx, AS92xxx), a standard title, a credit count, or an internal/external label. The Level 1 standards were replaced for 2024 and the old 90xxx Level 1 standards are retired, so whatever you recall about them is out of date — naming one is worse than naming none.
- Do not state what "the standard requires", what "NZQA is looking for", or what the marking schedule says. You have not seen it. Judge the answer against the criteria given to you above and nothing else.
- If the student's own material names a standard or a context, you may refer to it in their words. Never assert its criteria from memory.
- Mark against the ladder, which does not change between versions: Achieved demonstrates understanding; Merit shows in-depth understanding, explaining how and why with cause and effect; Excellence shows comprehensive understanding, linking ideas together, applying them to the specific context in the question, and evaluating or justifying.
- The command verb in the question is the test of what the answer had to do. Judge it against that verb, not against a generic essay.
- Use New Zealand spelling and NCEA vocabulary (Achieved / Merit / Excellence, not grades or percentages).`;

/* Only bolted on when the student is actually working to NCEA. The app is
   curriculum-agnostic and the deck's level is a free-text box — someone
   revising for A-levels or a university paper should not be told about NZQA. */
const isNcea = (level) => /ncea|nzqa/i.test(String(level == null ? '' : level));
const nceaRules = (level) => (isNcea(level) ? NCEA_RULES : '');
const STRICT_CLAUSE = '\n\nSTRICT SOURCE MODE — this overrides everything else: use ONLY facts, terms, examples and figures that are written explicitly in the material below. Do not add outside knowledge, extra context, or anything you happen to know that is not on the page. If the material is thin, make fewer cards rather than inventing content. Every card must be traceable to a specific line in the material.';

function flipPrompt(source, level, strict){
  return `You write flashcards for a ${level} student. From the material below, produce fast-recall cards for definitions, formulae, key facts and vocabulary.
Return ONLY lines of the form:  question | answer
One card per line. No numbering, no extra prose. Keep answers tight.
Do not invent facts not supported by the material.${strict ? STRICT_CLAUSE : ''}

MATERIAL:
${source}`;
}

function extendedPrompt(source, level, strict){
  return `You are an expert ${level} examiner. From the material below, write EXTENDED-RESPONSE exam questions that reward how an answer is CONSTRUCTED, not single-word recall.

Return ONLY a JSON array. Each element:
{ "type":"extended",
  "verb": one of ${COMMAND_VERBS.map(v => '"' + v + '"').join(', ')},
  "prompt": full exam question using that verb,
  "marks": integer (usually 3-6),
  "achieved": states/describes the correct thing (the WHAT),
  "merit": explains with cause and effect linked (the WHY/HOW),
  "excellence": links multiple ideas AND applies them to the scenario in this question, then evaluates/justifies (the SO WHAT),
  "skeleton": the sentence pattern that earns the marks,
  "pitfall": the SPECIFIC mark-losing error for THIS question }

Rules: the verb sets the grade ceiling; the three answers differ in depth not length; Excellence must refer to the actual scenario. Science: claim -> mechanism -> link to context. Maths: show working; method marks independent of the answer; state units; Excellence justifies the method. English: point -> evidence -> analysis of technique -> connection to purpose. Do NOT invent NZQA codes. No JSON outside the array.${strict ? STRICT_CLAUSE : ''}

MATERIAL:
${source}`;
}

/* Worked problems — the half of NCEA this app could not touch.

   Everything above grades WRITING: the ladder, the command verbs, the marking,
   the upgrade path. A student doing Level 1 maths, physics or chemistry spends
   most of their practice time on problems where the marks live in the METHOD,
   and until now the app had nothing to offer them but flashcards of formulae.

   The ladder still applies — NCEA grades calculation work Achieved / Merit /
   Excellence like everything else — but it means something different here, and
   markWorkingPrompt spells out what. */
function workedPrompt(source, level, strict){
  return `You are an expert ${level} teacher. From the material below, write WORKED PROBLEMS — questions the student solves by showing a method, not by recalling a fact.

Return ONLY a JSON array. Each element:
{ "type":"worked",
  "prompt": the full problem, including EVERY number and unit needed to solve it,
  "marks": integer (usually 3-5),
  "steps": [ 3-6 strings: the method IN ORDER, each one step a marker would award for, written as the thing to DO ("convert 250 g to 0.25 kg"), never as a heading ("conversion") ],
  "answer": the final answer with its unit,
  "pitfall": the specific mistake students actually make on THIS problem }

Rules:
- ONLY write a problem where the material genuinely contains something to calculate, derive, balance, or work through in order: a formula, a quantity, a procedure, a set of rules applied in sequence. Maths, physics, chemistry, and the quantitative parts of biology, economics, geography and statistics qualify.
- If the material contains NOTHING of that kind, return an empty array: []. Do not turn a descriptive topic into a fake calculation. A made-up problem teaches a made-up method, and the student cannot tell the difference until the exam.
- Every number the student needs must be IN the prompt. A problem that cannot be solved from its own wording is worthless.
- "steps" IS the mark scheme. Give the rearrangement, the unit conversion and the substitution their own steps wherever they apply — those are where the marks are actually lost, not in the arithmetic.
- Solve it yourself before writing "answer". Give the unit.
- Do NOT invent NZQA codes. No JSON outside the array.${strict ? STRICT_CLAUSE : ''}

MATERIAL:
${source}`;
}

/* turn the slider percentage into concrete per-reply counts */
/* Per-reply card targets. Tuned to ~18-20 cards/batch so a generate returns a
   full set (Qwen produces close to exactly what's asked, so ask for more). */
function mixTargets(pctLong){
  const p = Math.max(0, Math.min(100, pctLong));
  if (p <= 5)  return { long: 0, mcq: 3, quick: 18 };
  if (p >= 95) return { long: 9, mcq: 2, quick: 0 };
  return {
    long:  Math.max(1, Math.round((p / 100) * 10)),
    mcq:   3,
    quick: Math.max(2, Math.round(((100 - p) / 100) * 18)),
  };
}

function mixedPrompt(source, level, pctLong, strict){
  const t = mixTargets(pctLong);
  const longRule = t.long === 0
    ? 'Do NOT include any "extended" cards in this reply — the student has asked for short answers only.'
    : `REQUIRED: exactly ${t.long} "extended" card${t.long > 1 ? 's' : ''} — never fewer. Emit them FIRST; your reply may be cut off at the end, so long cards must come before everything else.`;
  const quickRule = t.quick === 0
    ? 'Include at most one quick card; the student wants long-answer practice.'
    : `Then about ${t.quick} quick cards, MIXED across flip, cloze, typed and short — at least a third of them "typed" or "cloze" wherever the material has terms, values or names worth recalling exactly, because those are the two the student has to produce from memory rather than just recognise.`;
  return `You are an expert ${level} tutor. From the material below, make a MIXED set of study cards. Choose the best type for each idea — do NOT make everything the same type.

Return ONLY a JSON array. Each card is one of:
{ "type":"flip", "front": question, "back": answer }
{ "type":"cloze", "front": a sentence with one key term replaced by "____", "back": the missing term }
{ "type":"typed", "front": a question whose answer is a single term, name, value or short phrase — the student types it from memory, so it must have ONE clearly correct answer, "back": that answer (never a sentence, at most 6 words), "accept": [0-3 other spellings or wordings that should also count, e.g. an abbreviation] }
{ "type":"short", "front": question, "back": a model answer in 1-3 sentences }
{ "type":"mcq", "front": question, "options": [four options], "answer": index (0-based) of the correct option, "why": one line on why it is right and what the tempting wrong option gets wrong }
{ "type":"extended", "verb": one of ${COMMAND_VERBS.map(v => '"' + v + '"').join(', ')}, "prompt": full exam question, "marks": int, "achieved": the WHAT, "merit": the WHY/HOW with cause and effect, "excellence": links >=2 ideas + applies to the scenario + evaluates/justifies, "skeleton": the mark-earning sentence pattern, "pitfall": the specific error to avoid here }
{ "type":"worked", "prompt": a problem to SOLVE, containing every number and unit needed, "marks": int, "steps": [3-6 method steps in order, each one a marker would award for], "answer": the final answer with its unit, "pitfall": the specific mistake made on THIS problem }

THE MIX FOR THIS REPLY:
${longRule}
ONLY if the material genuinely contains something to calculate, derive, balance or work through in order, include 1-2 "worked" cards. If it contains nothing of that kind, include NONE — never invent a calculation for a descriptive topic.
Then about ${t.mcq} "mcq" cards whose wrong options are REAL misconceptions a student actually holds (never filler).
${quickRule}

Emit in this order: extended, then worked, then mcq, then quick.

Ground everything in the material. Do NOT invent NZQA codes. No JSON outside the array.${strict ? STRICT_CLAUSE : ''}

MATERIAL:
${source}`;
}

/* Models served free (rate-limited) by NVIDIA Build (build.nvidia.com), called
   through their OpenAI-compatible endpoint. Everything text runs on gpt-oss-20b:
   fast (a full ~15-card batch in ~11s), returns clean JSON, handles long-answer
   cards, and stays well under the 60s timeout — the 49B Nemotron model was too
   slow on the free tier and hit the timeout on big generates.
   NOTE: NVIDIA retires free models with little notice — qwen3-next-80b-a3b was
   EOL'd 2026-07-27 and returned HTTP 410 "Gone". If generation starts failing
   with 410, the model here was retired: pick a live one at build.nvidia.com and
   swap the id below (and re-check its speed against the 60s cap). */
const NVIDIA_BASE = 'https://integrate.api.nvidia.com/v1/chat/completions';
const MODEL_SMART = 'openai/gpt-oss-20b';   // marking + hints
const MODEL_CHEAP = 'openai/gpt-oss-20b';
const MODEL_GEN   = 'openai/gpt-oss-20b';   // generation
/* Vision model for reading slide images (diagrams, photos of notes). It accepts
   only ONE image per request, so images are transcribed to text one at a time
   and that text is fed to the text model — same card quality as typed notes. */
const MODEL_VISION = 'meta/llama-3.2-11b-vision-instruct';
/* Reasoning models ("deepseek", Nemotron) think out loud by default; that
   reasoning would pollute the JSON the parser expects, so turn it off. */
const isReasoner = (m) => /deepseek|nemotron/i.test(m || '');

/* gpt-oss also reasons, but it does NOT honour chat_template_kwargs — measured
   against the live endpoint, that flag left the reasoning untouched. It takes
   reasoning_effort instead, and "low" cut ~22% of completion tokens on the same
   prompt while returning the identical cards.

   That matters twice over: reasoning tokens are spent out of the same
   max_tokens budget as the cards, so they are a truncation risk on a big batch,
   and they are billed as output the moment this moves off the free tier.

   Scoped to the model family that was actually tested. An unknown parameter is
   a 400 from NVIDIA and a dead generate button, so this must never be sent to a
   model nobody has tried it on.

   GENERATION ONLY, and the caller has to ask for it — MODEL_SMART and MODEL_GEN
   are currently the same model id, so nothing here can tell the two apart.
   Generation is structured extraction and the output was byte-for-byte the same
   with the effort turned down; marking is a judgement about a student's writing
   and is the thing the app is actually for. Cutting its thinking to save tokens
   has not been tested and is not a trade worth making blind. */
const takesReasoningEffort = (m) => /gpt-oss/i.test(m || '');

function pickModel(mode, settings){
  // Generation is all Qwen for now — it returns clean structured output and is
  // the free NVIDIA endpoint. (saveUsage kept for later multi-model routing.)
  return MODEL_GEN;
}

/* One bad batch shouldn't sink the rest — but a failure hitting EVERY batch
   would otherwise surface as a blank "nothing came back". Record it. */
let lastApiError = '';
const noteApiError = (e) => { lastApiError = (e && e.message) ? String(e.message) : String(e); };

/* Turn a raw fetch/API failure into something the user can act on. The most
   common one on the website is simply "no key yet". */
function friendlyApiError(e){
  const m = (e && e.message) ? e.message : '';
  if (/no API key|not set on the server/i.test(m)) return 'The AI isn\'t switched on for this site yet — the owner needs to add the API key.';
  if (/\b401\b/.test(m) || /\b403\b/.test(m)) return 'The AI key was rejected by NVIDIA — the site owner needs to check it.';
  if (/\b404\b/.test(m)) return 'That model wasn\'t found — it may have been removed from NVIDIA\'s catalog. ' + m;
  if (/\b410\b/.test(m)) return 'This AI model was retired by NVIDIA — the app needs a quick update to point at a current one. ' + m;
  /* The likeliest error on launch day by a distance: the free tier's ~40
     requests/minute is shared across everyone using the app at once, so a spike
     hits this and not any one student's doing. Don't hand them our vendor's
     rate limit as if it were their problem, and don't say "try again" in a way
     that invites everyone to hammer it in the same second. */
  if (/\b429\b/.test(m)) return 'Study Feed is busy right now — too many people generating at once. Give it about a minute and it\'ll go through.';
  if (/timed out/i.test(m)) return 'The AI ran out of time, even after retrying and splitting the notes up. It\'s usually a slow connection — try again, or paste a smaller section.';
  if (/no images/i.test(m)) return m;
  // Reached only after the retries gave up, so don't suggest trying immediately.
  if (/API returned 5\d\d/.test(m)) return 'NVIDIA\'s servers are having trouble — it kept failing after three tries, so it isn\'t your device. Give it a minute.';
  return 'Couldn\'t reach the AI. Check your connection and try again.';
}

/* Send an OpenAI-compatible chat request through our own serverless proxy
   (api/nvidia.js on Vercel). `messages` is the usual role/content list — a
   message's content is either a plain string (text prompt) or an OpenAI-style
   content array (for images). The proxy holds the NVIDIA key server-side and
   adds the Authorization header, so the browser never sees the key and there's
   no cross-origin (CORS) problem. */
/* One try at the proxy, with its own wall clock. The abort signal covers the
   body read as well as the connection, because a congested network can hand
   back headers promptly and then dribble the body out for another minute. */
async function postOnce(body, timeoutMs){
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch('/api/nvidia', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (!res.ok){
      // NVIDIA sends {detail} or {error:{message}}; our own proxy sends a plain
      // {error:"..."} string. Without the string case, the proxy's own messages
      // (e.g. the missing-key one) never reached friendlyApiError at all.
      let detail = '';
      try {
        const j = JSON.parse(text);
        const err = j && j.error;
        detail = (j && j.detail) || (typeof err === 'string' ? err : (err && err.message)) || '';
      } catch {}
      throw new Error('API returned ' + res.status + (detail ? ' — ' + detail : ''));
    }
    const data = JSON.parse(text);
    const msg = data && data.choices && data.choices[0] && data.choices[0].message;
    return (msg && msg.content) ? msg.content : '';
  } catch (e){
    if (e && e.name === 'AbortError') throw new Error('timed out — the AI took too long to respond');
    // fetch rejects with a TypeError when it never got a response at all.
    if (e instanceof TypeError) throw new Error('could not reach the AI — check your connection');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/* One wall clock per attempt, not one for the whole call. The first is
   deliberately short: on a busy network (school wifi at lunch) a request that
   hasn't come back in 40s almost never comes back, and starting over beats
   waiting it out. Later attempts sit just past the proxy's own 60s ceiling
   (api/nvidia.js maxDuration) so the server's real error has time to arrive
   instead of the browser hanging up first and hiding it. */
const ATTEMPT_MS = [40000, 62000, 62000];
const RETRY_WAIT_MS = [1200, 4000];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
/* Worth another go: a timeout, a dropped connection, rate limiting, or a 5xx.
   A 401/404/410 is a configuration problem — retrying only wastes the student's
   time and shows them a slower version of the same error. */
function isRetryable(e){
  const m = (e && e.message) ? e.message : '';
  return /timed out|could not reach/i.test(m) || /API returned (429|5\d\d)/.test(m);
}

async function postChat(messages, maxTokens, model, lowEffort){
  const body = {
    model,
    messages,
    temperature: isReasoner(model) ? 0.6 : 0.7,
    top_p: 0.9,
    max_tokens: maxTokens,
    stream: false,
  };
  // Reasoning models: switch off chain-of-thought so replies are clean JSON.
  if (isReasoner(model)) body.chat_template_kwargs = { thinking: false };
  // gpt-oss ignores that flag; this is the lever it does take. Opt-in only:
  // MODEL_SMART and MODEL_GEN are the same model id, so the caller has to say
  // so — see takesReasoningEffort for why marking is deliberately left out.
  if (lowEffort && takesReasoningEffort(model)) body.reasoning_effort = 'low';

  let last;
  for (let i = 0; i < ATTEMPT_MS.length; i++){
    try { return await postOnce(body, ATTEMPT_MS[i]); }
    catch (e){
      last = e;
      if (i === ATTEMPT_MS.length - 1 || !isRetryable(e)) break;
      await sleep(RETRY_WAIT_MS[i]);
    }
  }
  throw last;
}
/* Everything except the chat helper sends exactly one user turn. */
const postMessages = (content, maxTokens, model, lowEffort) => postChat([{ role: 'user', content }], maxTokens, model, lowEffort);
const callModel = (prompt, maxTokens = 1000, model = MODEL_GEN, lowEffort) => postMessages(prompt, maxTokens, model, lowEffort);
/* Read ONE slide/photo with the vision model and return it as plain study text
   (all wording transcribed, diagrams/graphs/formulae described). `img` is a
   { media_type, data } object from resizeImage. */
const VISION_PROMPT = 'You are reading one slide or page from a student\'s study material. Write out EVERYTHING on it that is useful for revision: transcribe all text word-for-word, and describe any diagrams, figures, graphs, tables, labels or formulae in enough detail that someone could learn from them without seeing the image. Output plain study notes only — no preamble, no "this slide shows".';
async function describeImage(img){
  const content = [
    { type: 'text', text: VISION_PROMPT },
    { type: 'image_url', image_url: { url: 'data:' + img.media_type + ';base64,' + img.data } },
  ];
  return postMessages(content, 1500, MODEL_VISION);
}

/* Read a photo of the student's OWN handwritten answer and give back the words.

   This is a different job from describeImage, which reads a slide and is
   allowed to summarise and describe. Nothing here may be summarised, tidied or
   described: whatever comes back is about to be marked as the student's own
   writing, and the marker quotes it back to them phrase by phrase.

   MEASURED against the live vision model (25 Aug 2026) on deliberately hostile
   pages — skewed as if shot at an angle, a hard shadow across the lower half,
   uneven baselines, per-word rotation, a struck-out word: word error 6.4%,
   ~4.3s. Nothing was dropped and nothing was invented. But 4 of 6 deliberate
   misspellings came back silently CORRECTED ("temperture" → "temperature").

   So this is not a faithful transcript, and marking its output unseen would be
   marking words the student did not write. The answer box is the confirmation
   step: the text lands there, they fix whatever it got wrong, and what they
   send is what gets marked. That is also what keeps the inline notes honest —
   the marker quotes the same text the student is looking at, so a highlight
   can never sit over a word only the model believes is there.

   The wording below is the wording that was measured. If it changes, re-run
   the measurement rather than assuming the numbers carried over. */
const HANDWRITING_PROMPT = 'This is a photo of one page of a student\'s HANDWRITTEN exam answer. Transcribe it EXACTLY as written, word for word, including any spelling or grammar mistakes exactly as they appear. Do not correct, improve, summarise or comment on it. If a word is genuinely illegible write [?]. If the page contains no handwritten answer at all, output exactly: NO_ANSWER. Output ONLY the transcription, nothing else.';

/* The model returns this when handed a blank page, a photo of the question, or
   a picture of something that isn't schoolwork. Worth catching by name: the
   alternative is the student marking the word "NO_ANSWER" as their essay. */
const NO_ANSWER = 'NO_ANSWER';

async function transcribeAnswer(img){
  const content = [
    { type: 'text', text: HANDWRITING_PROMPT },
    { type: 'image_url', image_url: { url: 'data:' + img.media_type + ';base64,' + img.data } },
  ];
  const out = await postMessages(content, 1500, MODEL_VISION);
  const clean = String(out == null ? '' : out).trim();
  if (!clean || clean.toUpperCase().indexOf(NO_ANSWER) === 0) return '';
  return clean;
}

/* Working, not prose. Measured on handwritten mechanics working (25 Aug 2026):
   every load-bearing number survived — 250, 0.25, 12.5, 4.0, 3.125, 0.78 — and
   every line came back in order, in ~14.8s (slower than prose, still inside the
   first attempt's 40s budget).

   Two things it does that the instruction below exists to handle: a fraction
   written with a HORIZONTAL BAR comes back as two stacked lines with the bar
   gone, which is genuinely ambiguous, and superscripts arrive as ASCII (m/s^2).
   The second is fine and the student can see it. The first is why the prompt
   asks for fractions inline. */
const WORKING_PROMPT = 'This is a photo of a student\'s HANDWRITTEN working for a maths or science problem. Transcribe it EXACTLY, line by line, keeping every equation, number, unit and symbol as written, including any mistakes. Keep each line of working on its own line. Where a fraction is written with a horizontal bar, write it inline on ONE line using a slash, e.g. (v - u) / t. Do not solve it, correct it, tidy the notation, or comment on it. If something is genuinely illegible write [?]. Output ONLY the transcription.';

async function transcribeWorking(img){
  const content = [
    { type: 'text', text: WORKING_PROMPT },
    { type: 'image_url', image_url: { url: 'data:' + img.media_type + ';base64,' + img.data } },
  ];
  const out = await postMessages(content, 1200, MODEL_VISION);
  const clean = String(out == null ? '' : out).trim();
  if (!clean || clean.toUpperCase().indexOf(NO_ANSWER) === 0) return '';
  return clean;
}

function promptFor(mode, source, level, pctLong, strict){
  if (mode === 'flip') return flipPrompt(source, level, strict);
  if (mode === 'extended') return extendedPrompt(source, level, strict);
  if (mode === 'worked') return workedPrompt(source, level, strict);
  return mixedPrompt(source, level, pctLong, strict);
}
function parseReply(mode, reply){
  if (mode === 'flip'){
    const cards = [];
    for (const line of reply.split('\n')){
      const idx = line.indexOf('|');
      if (idx < 0) continue;
      const front = line.slice(0, idx).trim().replace(/^\d+[.)]\s*/, '');
      const back = line.slice(idx + 1).trim();
      if (front && back) cards.push({ id: uid(), type: 'flip', front, back });
    }
    return cards;
  }
  return cardsFromJson(parseJsonArray(reply));
}

/* Enough room for a 6k-character batch's worth of cards, including the long
   extended-response ones, without inviting a reply so long it can't finish
   inside the proxy's 60s ceiling. Generation time tracks output tokens more
   than input, so this is the main lever on whether a request beats the clock. */
const GEN_MAX_TOKENS = 2400;

/* Cut a chunk at the paragraph break nearest the middle, so a half still reads
   as continuous notes rather than stopping mid-sentence. */
function splitInHalf(text){
  const mid = Math.floor(text.length / 2);
  let cut = text.indexOf('\n\n', mid);
  if (cut < 0) cut = text.lastIndexOf('\n\n', mid);
  if (cut < 0) cut = mid;
  return [text.slice(0, cut).trim(), text.slice(cut).trim()].filter(Boolean);
}

/* Sections that produced nothing at all, so the student can be told they got a
   short stack rather than silently receiving half the cards they asked for. */
let genLost = 0;

/* Cards from one chunk — and if it TIMED OUT, from its halves instead. A
   timeout nearly always means the reply was simply too long to finish in time,
   so halving the material halves the writing. Two levels deep is the floor:
   below that the chunks are too small to be worth cards. */
async function genChunk(chunk, mode, level, model, pctLong, strict, depth){
  try {
    const reply = await callModel(promptFor(mode, chunk, level, pctLong, strict), GEN_MAX_TOKENS, model, true);
    return parseReply(mode, reply);
  } catch (e){
    noteApiError(e);
    const canSplit = depth < 2 && chunk.length > 1500 && /timed out/i.test(e && e.message ? e.message : '');
    if (!canSplit){ genLost++; return []; }
    const halves = splitInHalf(chunk);
    let out = [];
    for (const h of halves) out = out.concat(await genChunk(h, mode, level, model, pctLong, strict, depth + 1));
    return out;
  }
}

async function genText(source, mode, level, onProgress, model, pctLong, strict){
  const batches = batchText(source);
  let cards = [];
  for (let i = 0; i < batches.length; i++){
    onProgress && onProgress(i + 1, batches.length, 'text');
    cards = cards.concat(await genChunk(batches[i], mode, level, model, pctLong, strict, 0));
  }
  return cards;
}
/* Transcribe each image to study text (one vision call per image, since the
   vision model takes only one image at a time), then join into a single notes
   blob the normal Qwen pipeline can turn into cards. */
async function transcribeImages(images, onProgress){
  const parts = [];
  for (let i = 0; i < images.length; i++){
    onProgress && onProgress(i + 1, images.length, 'images');
    try {
      const txt = await describeImage(images[i]);
      if (txt && txt.trim()) parts.push('# Slide ' + (i + 1) + '\n' + txt.trim());
    } catch (e){ noteApiError(e); genLost++; }
  }
  return parts.join('\n\n');
}

function markPrompt(card, answer, level){
  return `You are a ${level} examiner marking one extended-response answer.

COMMAND VERB: ${card.verb}
QUESTION (${card.marks} marks): ${card.prompt}

ACHIEVED looks like: ${card.achieved}
MERIT looks like: ${card.merit}
EXCELLENCE looks like: ${card.excellence}

STUDENT ANSWER:
${answer}

Return ONLY JSON:
{ "grade": "Not yet" | "Achieved" | "Merit" | "Excellence",
  "hit": [ up to 3 things that earned credit ],
  "missing": [ up to 3 specific things needed to reach the NEXT grade up ],
  "lift": one sentence naming the single change that would most raise the grade,
  "notes": [ 2-5 objects, each { "quote": a phrase copied WORD FOR WORD from the student answer above, "kind": "good" | "weak", "note": one short sentence saying why that phrase earned credit, or what is wrong with it } ] }
Be specific to THIS answer. Reward construction (mechanism, links, context) over word count.

RULES FOR "notes" — these are shown highlighted on top of the student's own writing, so they must line up with it exactly:
- "quote" must be an EXACT substring of the student answer. Copy it character for character. Do not paraphrase, correct spelling, or join text from two different sentences.
- Give the BARE words, with no quotation marks wrapped around them, and no full stop added at the end. If the student's own sentence contains quotation marks, keep theirs exactly as they typed them — do not swap ' for " or tidy them.
- Keep each quote short — a clause or a phrase, roughly 3 to 15 words.
- Quotes must not overlap each other.
- BALANCE IS NOT OPTIONAL. Unless you graded this answer Excellence, at least one note MUST be "weak" — you have just said the answer is not yet at the top grade, so something in it is holding it there. Find that phrase and point at it. An all-"good" set of notes on an answer graded below Excellence is wrong.
- A "weak" note is not an insult. Vague wording, a missing mechanism, a sentence that restates the question, or a common misconception all qualify.
- If the answer is too short or empty to quote meaningfully, return "notes": [].${nceaRules(level)}`;
}
/* Bigger ceiling than the other calls because this one now carries the inline
   notes as well as the grade. Marking is the critical path — if the reply is
   truncated the JSON does not close and the student loses the whole mark, not
   just the highlights.

   1700 was not enough, and this was measured rather than guessed. Running 42
   answers through the live endpoint (tools/mark-eval.mjs, 13 Aug 2026):
   completion tokens came in at median 1256, p90 1749, max 2497, so 15% of
   marks wanted more than 1700 and 17% of the run came back truncated with
   finish_reason "length" — every one of those a total loss of the mark, and
   NOT retried, because a truncated reply is a perfectly good HTTP 200.
   Re-running the identical corpus at 3000 took truncation to zero and left
   the grades unchanged (97% in band both times), for about 1.5s on the median
   response. 3000 clears the worst observed reply by ~20%.

   This is a ceiling, not a spend: the median answer still costs ~1256 output
   tokens, so raising it does not make the ordinary call more expensive. If
   more required output is ever added to this prompt, re-run the eval rather
   than assuming the headroom is still there. */
async function markAnswer(card, answer, level){
  const reply = await callModel(markPrompt(card, answer, level), 3000, MODEL_SMART);
  const objs = rescueObjects(reply);
  return objs[0] || null;
}

/* The notes rules are deliberately NOT shared with markPrompt, and this is not
   an oversight. A quote out of an essay is a clause of prose, 3-15 words; a
   quote out of working is a LINE — "a = (12.5 - 0) / 4.0" — and the two want
   opposite instructions. markPrompt is also the one prompt with a measured eval
   behind it (tools/mark-eval.mjs), so it is left byte-for-byte alone. If you
   tune the anchoring rules in one of these, read the other before assuming it
   needs the same change. */
function markWorkingPrompt(card, working, level){
  const steps = (card.steps || []).map((s, i) => (i + 1) + '. ' + s).join('\n');
  return `You are a ${level} examiner marking one student's WORKING on a problem.

PROBLEM (${card.marks} marks): ${card.prompt}
CORRECT FINAL ANSWER: ${card.answer}

THE METHOD, step by step — this is the mark scheme:
${steps}

STUDENT'S WORKING:
${working}

Return ONLY JSON:
{ "grade": "Not yet" | "Achieved" | "Merit" | "Excellence",
  "final": "correct" | "wrong" | "missing",
  "steps": [ one object per numbered step above, IN ORDER and one for EVERY step: { "n": the step number, "got": "yes" | "partly" | "no", "why": one short sentence — for "yes" name what they did that earned it, otherwise say exactly what is wrong or missing } ],
  "lift": one sentence naming the single change that would most raise the grade,
  "notes": [ 2-5 objects, each { "quote": a line or expression copied CHARACTER FOR CHARACTER out of the student's working above, "kind": "good" | "weak", "note": one short sentence on what that line gets right, or what is wrong with it } ] }

GRADING WORKING is not grading an essay:
- Achieved — a correct method carried through, with the answer following from it.
- Merit — correct method AND the reasoning is visible: the rearrangement is shown, units are carried through, each line follows from the one above.
- Excellence — correct method, visible reasoning, AND the answer is justified: units and magnitude checked for sense, or the method explained rather than merely executed.
- "Not yet" — the method does not work, or there is too little working to tell what they did.

ERROR CARRIED FORWARD. This is not optional, it is the thing you are most likely to get wrong, and it is measured. If the student makes ONE mistake and then correctly carries the wrong value through the steps that follow, those later steps are STILL CORRECT METHOD and must be marked "yes". Failing the steps after a single slip is the most unfair thing you could do to this student, and it is not how the standard is marked.

A step that USES a value produced by an earlier step is judged ONLY on whether it did the right thing WITH the value it was given. It is never marked down because that value arrived wrong. "They used the wrong number here" is not by itself a reason to mark a step "no": that wrong number has already been counted once, at the step that produced it, and counting it again punishes one slip twice.

Worked example — follow it. Step 1 is "convert 250 g to 0.25 kg" and the student leaves the mass as 250. Step 4 is "apply F = ma and state the unit" and the student writes F = 250 x 3.125 = 781.25 N. Step 1 is "no". Step 4 is "yes" — they put the value they had into the correct formula and stated the unit, which is the whole of what step 4 asks for. Marking step 4 "no" is the mistake this paragraph exists to stop.

Mark a step "no" only when the operation performed AT THAT STEP is itself wrong: the wrong formula, the wrong operation, or the step skipped altogether.
- A right answer reached by a wrong method is not Achieved. Say so plainly.
- A right answer with NO working shown cannot go above Achieved, however correct it is. The marks are in the method.
- "final" judges the number and its unit against the correct final answer above, and nothing else. Ignore a difference in the last rounding digit.

RULES FOR "notes" — these are shown highlighted on top of the student's own working, so they must line up with it exactly:
- "quote" must be an EXACT substring of the student's working. Copy it character for character, including their spacing and their notation. Do not tidy it, do not convert it to proper mathematical formatting, and do not join text from two different lines.
- Prefer ONE LINE of working per quote — that is the unit a student reads. Never quote more than two lines.
- Give the BARE characters, with no quotation marks wrapped around them and no full stop added at the end.
- Quotes must not overlap each other.
- BALANCE IS NOT OPTIONAL. Unless you graded this Excellence, at least one note MUST be "weak" — you have just said it is not yet at the top grade, so something in it is holding it there. Find that line and point at it.
- Anchor the "weak" note on the line where the method FIRST goes wrong, not on a later line that only carries the earlier mistake forward.
- If there is too little working to quote meaningfully, return "notes": [].${nceaRules(level)}`;
}

/* Same ceiling and the same reason as markAnswer: the step list plus the notes
   make this the longest reply the app asks for, and a truncated one is a total
   loss of the mark rather than a degraded one. */
async function markWorking(card, working, level){
  const reply = await callModel(markWorkingPrompt(card, working, level), 3000, MODEL_SMART);
  const objs = rescueObjects(reply);
  return objs[0] || null;
}

/* The first step that is actually wrong — not the first that looks wrong.
   Everything after a slip in a calculation is contaminated by it, so the one
   fact a student needs out of a page of red pen is WHERE IT STARTED. Derived
   here rather than asked for, because a model asked the same question twice
   can answer it two different ways, and then the checklist and the callout
   would disagree in front of the student. */
function firstBadStep(r){
  const steps = (r && Array.isArray(r.steps)) ? r.steps : [];
  for (const s of steps){
    if (s && s.got === 'no') return s;
  }
  return null;
}

/* ---- locating the marker's notes in the student's own text ---------------
   The model is asked to quote the answer word for word, and mostly does. It
   also sometimes tidies punctuation, swaps a straight apostrophe for a curly
   one, or collapses a line break — so an exact indexOf alone would silently
   drop good notes. Anything that still cannot be found is dropped rather than
   approximated: a highlight sitting over the wrong words is worse than no
   highlight, because the student would read it as the marker's judgement of a
   sentence they didn't write. */
/* The model likes to hand back its quote already dressed as a quotation —
   wrapped in double quotes, sometimes with the full stop pulled inside. None
   of that is in the student's answer, so the match failed and a perfectly good
   note was thrown away. Measured on 42 marked answers, this and the quote-mark
   swap below accounted for 13 of the 14 notes that could not be anchored.

   Only ever shrinks the quote, so a stripped quote can never match MORE than
   the original would have — it cannot drag a highlight onto the wrong words. */
function trimQuoteWrapper(q){
  let s = String(q == null ? '' : q).trim();
  let before;
  do {
    before = s;
    s = s.replace(/^[\s"'‘’“”]+/, '').replace(/[\s"'‘’“”.,;:]+$/, '');
  } while (s !== before && s.length);
  return s;
}

function quoteToRegex(quote){
  let out = '';
  for (const ch of quote){
    if (/\s/.test(ch)){ if (!out.endsWith('\\s+')) out += '\\s+'; continue; }
    /* Every quotation mark is treated as every other one. The model routinely
       re-punctuates the student's nested quotes — writing 'Forty-one' where
       they wrote "Forty-one" — and which flavour of quote mark got used is
       never the thing that should decide whether feedback survives. */
    if (ch === "'" || ch === '‘' || ch === '’' || ch === '"' || ch === '“' || ch === '”'){ out += '[\'‘’"“”]'; continue; }
    if (ch === '-' || ch === '–' || ch === '—'){ out += '[-–—]'; continue; }
    out += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return out;
}

/* Every place a quote could sit, exact matches first. The tolerant regex is
   only consulted when the literal string appears nowhere, so a quote copied
   properly can never be dragged onto a fuzzy match somewhere else. */
function allOccurrences(text, quote){
  const spots = [];
  const seen = {};
  const add = (at, len) => {
    if (at < 0 || spots.length >= 8) return;
    const k = at + ':' + len;
    if (seen[k]) return;
    seen[k] = 1;
    spots.push({ at, len });
  };
  let i = text.indexOf(quote);
  while (i >= 0){ add(i, quote.length); i = text.indexOf(quote, i + 1); }
  /* The tolerant pass runs even when an exact hit was found, because the two
     find different things: a phrase the student wrote twice with different
     capitalisation has two homes, and indexOf only ever sees one of them.
     Exact hits are added first, so they are still the ones preferred when a
     span has to be chosen — the tolerant matches are alternatives, not
     replacements. */
  try {
    const re = new RegExp(quoteToRegex(quote), 'gi');
    let m;
    while ((m = re.exec(text)) !== null){
      if (!m[0]){ re.lastIndex++; continue; }
      add(m.index, m[0].length);
      /* A quote that matches everywhere identifies nothing; stop rather than
         build a huge list for a phrase like "it is". */
      if (spots.length >= 8) break;
    }
  } catch (e){}
  return spots;
}

/* Fit as many notes onto the answer as will sit side by side, and hand back
   the ones that would not fit rather than dropping them.

   The old version walked the notes in the order the model happened to emit
   them, took the first match for each, and threw away anything that overlapped
   something already placed. That lost feedback twice over: a phrase the
   student had written more than once was only ever tried in one spot, and a
   note that lost the race disappeared completely — text and all — so the
   numbered list quietly referred to highlights that were not on screen.

   Two changes. Quotes with the fewest possible positions are placed first,
   because a phrase that occurs once has no alternative and should claim its
   span before one that could sit in three places. And anything still homeless
   comes back as an orphan, so the marker's point survives even when it cannot
   be pinned to particular words. */
function placeNotes(answer, notes){
  const text = String(answer || '');
  const out = { located: [], orphans: [] };
  if (!text || !Array.isArray(notes)) return out;

  const cand = [];
  notes.forEach((n) => {
    const quote = (n && typeof n.quote === 'string') ? trimQuoteWrapper(n.quote) : '';
    const note = (n && typeof n.note === 'string') ? n.note.trim() : '';
    if (!note) return;
    const kind = (n && n.kind === 'good') ? 'good' : 'weak';
    /* One or two characters would highlight a stray letter mid-word. The note
       is still worth showing; it just cannot be anchored. */
    if (quote.length < 4){ out.orphans.push({ kind, note }); return; }
    const spots = allOccurrences(text, quote);
    if (!spots.length){ out.orphans.push({ kind, note }); return; }
    cand.push({ spots, kind, note });
  });

  cand.sort((a, b) => (a.spots.length - b.spots.length) || (a.spots[0].at - b.spots[0].at));

  const taken = [];
  const clashes = (s) => taken.some(t => s.at < t.at + t.len && t.at < s.at + s.len);
  for (const c of cand){
    const spot = c.spots.find(s => !clashes(s));
    if (spot){ taken.push(spot); out.located.push({ at: spot.at, len: spot.len, kind: c.kind, note: c.note }); }
    else out.orphans.push({ kind: c.kind, note: c.note });
  }
  /* Reading order, so the numbering runs down the page. */
  out.located.sort((a, b) => a.at - b.at);
  return out;
}

/* Kept as the anchored-only view, which is what the highlighting needs. */
function locateNotes(answer, notes){
  return placeNotes(answer, notes).located;
}

/* The answer sliced into plain and highlighted runs, ready to render. */
function segmentAnswer(answer, located){
  const text = String(answer || '');
  const segs = [];
  let pos = 0;
  located.forEach((l, i) => {
    if (l.at > pos) segs.push({ text: text.slice(pos, l.at) });
    segs.push({ text: text.slice(l.at, l.at + l.len), mark: l, n: i + 1 });
    pos = l.at + l.len;
  });
  if (pos < text.length) segs.push({ text: text.slice(pos) });
  return segs;
}

/* Writing points — a scaffold when you're stuck, NOT the answer. Prompts and
   structure only, so you still have to write it yourself. */
function hintPrompt(card, level){
  return `A ${level} student is stuck on this exam question and wants a nudge, NOT the answer.

COMMAND VERB: ${card.verb}
QUESTION (${card.marks} marks): ${card.prompt}

Give 3-5 short writing points that guide them to build the answer themselves:
- name WHAT to cover and in what order (the structure the marks follow)
- phrase each as a prompt or a fill-in, e.g. "Start by defining ___" or "Then link it to ___ because…"
- for a ${card.verb} question, remind them what that verb demands
Do NOT state the actual facts, terms, values or model answer — leave the thinking to them.
${isNcea(level) ? 'Never name or cite an achievement standard number or title, and never say what the standard or NZQA "wants" — the NCEA standards have been rebuilt and whatever you recall about them is out of date. Point at the command verb instead.\n' : ''}
Return ONLY a JSON array of short strings. No prose outside it.`;
}
async function getHints(card, level){
  const reply = await callModel(hintPrompt(card, level), 600, MODEL_SMART);
  const arr = parseJsonArray(reply);
  return Array.isArray(arr) ? arr.map(String).filter(Boolean).slice(0, 6) : [];
}

/* The BIGGER nudge — for when the writing points weren't enough. Gives real
   sentence starters (the frame, with a blank where the key idea goes) so the
   student can push the pen forward without being handed the finished answer. */
function bigHintPrompt(card, level){
  return `A ${level} student is REALLY stuck on this exam question — the general pointers didn't get them writing. Give them sentence starters to build the answer, but still leave the actual thinking to them.

COMMAND VERB: ${card.verb}
QUESTION (${card.marks} marks): ${card.prompt}

Write ${Math.min(4, Math.max(2, Math.round(card.marks / 2)))} sentence STARTERS that map to how the marks are earned. Each one:
- gives the opening of a sentence, then a blank "____" exactly where the key term, value or idea belongs
- follows the order the marks follow (state -> explain -> link/evaluate)
- e.g. "The rate increases because ____, which means ____." or "This links to ____ since ____."
Do NOT fill in the blanks. Do NOT give the finished answer, the actual terms, or the values — the student fills every ____ themselves.

Return ONLY a JSON array of short strings. No prose outside it.`;
}
async function getBigHint(card, level){
  const reply = await callModel(bigHintPrompt(card, level), 700, MODEL_SMART);
  const arr = parseJsonArray(reply);
  return Array.isArray(arr) ? arr.map(String).filter(Boolean).slice(0, 5) : [];
}

/* ---- explain this further ------------------------------------------------
   Seeing the right answer isn't the same as understanding it. Any card can be
   unfolded into the reasoning behind it, and the depth is the student's call:
   the same idea again but simpler, or the mechanism underneath it. */

/* One card flattened to question + answer text, whatever its type — used by
   the explainer and by the chat helper's "what am I looking at" context. */
function cardQA(card){
  if (card.type === 'mcq'){
    const opts = (card.options || []).map((o, i) => (i === card.answer ? '(correct) ' : '(wrong) ') + o).join('\n');
    return { q: String(card.front || ''), a: 'Options:\n' + opts + (card.why ? '\nCard\'s reason: ' + card.why : '') };
  }
  if (card.type === 'worked'){
    return {
      q: String(card.prompt || ''),
      a: 'Method:\n' + (card.steps || []).map((s, i) => (i + 1) + '. ' + s).join('\n') +
         '\nAnswer: ' + (card.answer || '—') + (card.pitfall ? '\nCommon trap: ' + card.pitfall : ''),
    };
  }
  if (card.type === 'extended'){
    return {
      q: String(card.prompt || ''),
      a: 'Achieved: ' + (card.achieved || '—') + '\nMerit: ' + (card.merit || '—') +
         '\nExcellence: ' + (card.excellence || '—') + (card.pitfall ? '\nCommon trap: ' + card.pitfall : ''),
    };
  }
  return { q: String(card.front || ''), a: String(card.back || '') };
}

const EXPLAIN_STYLE = {
  normal: 'Assume they know the subject basics but not this particular idea.',
  simple: 'The first explanation did NOT land. Go simpler: everyday words, short sentences, and one concrete example or analogy from ordinary life.',
  deeper: 'They already follow the basic version. Go deeper: the mechanism underneath, why it works that way, and how it connects to the rest of the topic.',
};
function explainPrompt(card, level, depth){
  const qa = cardQA(card);
  return `You are a patient ${level} tutor. A student has just seen the answer to this card and wants to actually understand it.

QUESTION: ${qa.q}

THE CARD'S ANSWER: ${qa.a}

${EXPLAIN_STYLE[depth] || EXPLAIN_STYLE.normal}

Return ONLY JSON:
{ "plain": "2-3 sentences explaining the idea itself, in plain language (define any term you use)",
  "steps": [ 2-4 short lines showing the reasoning that gets from the question to that answer ],
  "watch": "one sentence naming the mistake students usually make here" }
Explain the card's own answer — don't contradict it, and don't invent facts, values or NZQA codes that aren't implied by it.`;
}
async function getExplain(card, level, depth){
  const reply = await callModel(explainPrompt(card, level, depth), 900, MODEL_SMART);
  const objs = rescueObjects(reply);
  return objs[0] || null;
}

/* ---- how do I get a higher grade ----------------------------------------
   The marking says WHAT is missing. This says HOW: the moves to make on the
   answer they actually wrote, anchored to their own sentences. */
const NEXT_GRADE = { 'Not yet': 'Achieved', 'Achieved': 'Merit', 'Merit': 'Excellence', 'Excellence': 'Excellence' };
const nextGradeUp = (g) => NEXT_GRADE[g] || 'Merit';
function upgradePrompt(card, answer, result, level){
  const target = nextGradeUp(result.grade);
  const bar = target === 'Achieved' ? card.achieved : target === 'Merit' ? card.merit : card.excellence;
  const atTop = result.grade === 'Excellence';
  const missing = Array.isArray(result.missing) ? result.missing.join('; ') : '';
  return `You are a ${level} examiner sitting next to the student with THEIR answer in front of you.

QUESTION (${card.marks} marks, command verb "${card.verb}"): ${card.prompt}
WHAT ${target.toUpperCase()} LOOKS LIKE: ${bar || '—'}

THEIR ANSWER:
${answer}

YOU MARKED IT: ${result.grade}${missing ? '. Still missing: ' + missing : ''}

${atTop
  ? 'They are already at Excellence. Show them how to make it airtight — the weakest links in what they wrote, and how to tighten them.'
  : 'They have already been told WHAT is missing. Now show them HOW — the exact edits to make to THIS answer to reach ' + target + '.'}

Return ONLY JSON:
{ "target": "${target}",
  "gap": "2-3 sentences, spoken to the student, naming exactly what separates their current grade from ${target} on THIS question — what the marker is looking for that their answer does not yet do. Name the thinking move, not just the topic.",
  "steps": [ 2-4 objects, each { "move": "the edit to make, as an instruction (start with a verb)", "where": "which part of THEIR answer it applies to — quote 3-6 of their own words", "example": "that part rewritten the way it should read, one sentence, using the real subject content", "why": "one sentence: what this edit gives the marker that the original did not, in the language of the grade criteria" } ],
  "habit": "one sentence: the habit that would earn this grade next time without being told" }
Quote their real words in "where". Write "example" as a finished sentence they could have written — this is feedback after marking, so showing the better version is the point.

"gap" and "why" are the parts that teach. Be concrete about the level of thinking each grade wants — describing what happens, explaining why it happens by naming the mechanism, and evaluating or justifying with linked reasoning are different demands, and the command verb "${card.verb}" decides which one this question is asking for. Say which one they did and which one they need. Do not invent data, quotes or NZQA codes.${nceaRules(level)}`;
}
async function getUpgrade(card, answer, result, level){
  const reply = await callModel(upgradePrompt(card, answer, result, level), 1600, MODEL_SMART);
  const objs = rescueObjects(reply);
  return objs[0] || null;
}

/* ---- ask anything --------------------------------------------------------
   A tutor you can interrupt with. It knows the card on screen (studyContext,
   set by StudyCard) so "why is that the answer?" works without retyping it. */
let studyContext = null;
const setStudyContext = (c) => { studyContext = c; };

const CHAT_SYSTEM = `You are the study helper built into Study Feed, an app a high-school student uses to revise their own notes.

- Answer the question they asked, in plain language, as short as it can be answered well: 2-5 sentences, or a short list.
- Teach, don't just assert: give the reasoning or a quick example so they could work it out themselves next time.
- If they ask you to write an assessment, essay or homework FOR them, help them build it themselves instead — structure, prompts, feedback on their attempt.
- Never invent facts, figures, quotes or NZQA standard codes. If you aren't sure, say so.
- Plain text. A short "- " list is fine and **bold** for a key term, but no headings, tables or code blocks.`;

function chatContextBlock(){
  if (!studyContext) return '';
  const card = studyContext.card, deck = studyContext.deck;
  const qa = cardQA(card);
  const where = (deck.subject || 'their notes') + (deck.topic ? ' · ' + deck.topic : '');
  const block = `\n\n[Context — the card on their screen right now (${where}). Use it if their question is about "this"; otherwise ignore it.]\nQ: ${qa.q}\nA: ${qa.a}`;
  return block.length > 1400 ? block.slice(0, 1400) + '…' : block;
}

/* history is [{ role: 'user'|'assistant', text }]. Only the tail is sent —
   long threads cost tokens and the free tier is rate-limited. */
async function askHelper(history){
  const tail = history.slice(-10);
  const msgs = [{ role: 'system', content: CHAT_SYSTEM }];
  for (let i = 0; i < tail.length; i++){
    const m = tail[i];
    const isLast = i === tail.length - 1;
    msgs.push({ role: m.role, content: m.text + (isLast && m.role === 'user' ? chatContextBlock() : '') });
  }
  const reply = await postChat(msgs, 800, MODEL_SMART);
  return (reply || '').trim();
}

function parseManual(text){
  const seen = new Set();
  const cards = [];
  for (const line of text.split('\n')){
    const idx = line.indexOf('|');
    if (idx < 0) continue;
    const front = line.slice(0, idx).trim();
    const back = line.slice(idx + 1).trim();
    if (!front || !back) continue;
    const key = front.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cards.push({ id: uid(), type: 'flip', front, back });
  }
  return cards;
}

/* ==========================================================================
   FILE EXTRACTION
   ========================================================================== */
const MIN_EMBEDDED_IMAGE_BYTES = 15000;
const MAX_EMBEDDED_IMAGES = 6;

let _jszip = null;
const isZipLib = (m) => !!m && typeof m.loadAsync === 'function';
async function loadJSZip(){
  if (_jszip) return _jszip;
  try {
    const m = await import('jszip');
    const cand = (m && m.default) ? m.default : m;
    if (isZipLib(cand)){ _jszip = cand; return _jszip; }
  } catch {}
  if (isZipLib(window.JSZip)){ _jszip = window.JSZip; return _jszip; }
  await new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
    s.onload = res;
    s.onerror = () => rej(new Error('Could not load the unzip helper — check your connection.'));
    document.head.appendChild(s);
  });
  if (!isZipLib(window.JSZip)) throw new Error('Unzip helper unavailable.');
  _jszip = window.JSZip;
  return _jszip;
}
/* pdf.js, loaded from the CDN the same way JSZip is (it isn't in the bundle).
   The UMD build sets window.pdfjsLib; the worker keeps parsing off the main
   thread so a big PDF doesn't freeze the page. */
let _pdfjs = null;
const PDFJS_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174';
async function loadPdfJs(){
  if (_pdfjs) return _pdfjs;
  if (!window.pdfjsLib){
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = PDFJS_CDN + '/pdf.min.js';
      s.onload = res;
      s.onerror = () => rej(new Error('Could not load the PDF reader — check your connection.'));
      document.head.appendChild(s);
    });
  }
  if (!window.pdfjsLib) throw new Error('PDF reader unavailable.');
  try { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_CDN + '/pdf.worker.min.js'; } catch {}
  _pdfjs = window.pdfjsLib;
  return _pdfjs;
}
/* A page whose text layer is basically empty is a scan or an image-only slide;
   render it to a bitmap so the vision model can read it, like embedded images. */
const MAX_PDF_PAGES = 40;
async function renderPdfPage(page, maxPx = 1500){
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(2, maxPx / Math.max(base.width, base.height, 1));
  const viewport = page.getViewport({ scale: scale > 0 ? scale : 1 });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(viewport.width));
  canvas.height = Math.max(1, Math.round(viewport.height));
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  return await new Promise(res => canvas.toBlob(b => res(b), 'image/jpeg', 0.85));
}
async function extractPdf(file){
  const pdfjs = await loadPdfJs();
  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  const n = Math.min(doc.numPages, MAX_PDF_PAGES);
  const parts = [];
  const images = [];
  for (let i = 1; i <= n; i++){
    const page = await doc.getPage(i);
    let pageText = '';
    try {
      const content = await page.getTextContent();
      pageText = content.items.map(it => (it && it.str) ? it.str : '').join(' ').replace(/\s+/g, ' ').trim();
    } catch {}
    if (pageText.length >= 40) parts.push(pageText);
    else if (images.length < MAX_EMBEDDED_IMAGES){
      try { const b = await renderPdfPage(page); if (b) images.push(b); } catch {}
    }
  }
  const text = parts.join('\n\n').trim();
  if (!text && !images.length) throw new Error('This PDF had no readable text — if it is a scan, try clearer pages or a photo.');
  return { text, images };
}
/* 1280px/0.75 is about 40% fewer bytes on the wire than 1500/0.82 and still
   reads slide text cleanly. Worth it: base64 images are by far the biggest
   thing this app uploads, and school wifi is slowest in that direction. */
async function resizeImage(blob, maxPx = 1280, quality = 0.75){
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, maxPx / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
  if (bmp.close) bmp.close();
  const url = canvas.toDataURL('image/jpeg', quality);
  return { media_type: 'image/jpeg', data: url.split(',')[1] };
}
function stripXml(xml){
  return xml
    .replace(/<\/w:p>/g, '\n').replace(/<\/a:p>/g, '\n')
    .replace(/<w:br\s*\/?>/g, '\n').replace(/<a:br\s*\/?>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#3?9;/g, "'")
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
}
/* Pull the biggest embedded images out of a docx/pptx zip (skips tiny logos and
   bullets via MIN_EMBEDDED_IMAGE_BYTES, caps at MAX_EMBEDDED_IMAGES). Vector
   formats (emf/wmf) are skipped — the browser can't decode them to a bitmap. */
async function embeddedImages(zip, dir){
  const rx = new RegExp('^' + dir + '/.*\\.(png|jpe?g|gif|webp)$', 'i');
  const names = Object.keys(zip.files).filter(n => rx.test(n)).sort();
  const out = [];
  for (const n of names){
    if (out.length >= MAX_EMBEDDED_IMAGES) break;
    const buf = await zip.file(n).async('arraybuffer');
    if (buf.byteLength < MIN_EMBEDDED_IMAGE_BYTES) continue;   // skip icons/bullets
    const ext = n.split('.').pop().toLowerCase();
    const mime = ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    out.push(new Blob([buf], { type: mime }));
  }
  return out;
}

async function extractFile(file){
  const name = (file.name || '').toLowerCase();
  const type = file.type || '';
  // A bare photo/image file goes straight to the vision path.
  if (type.startsWith('image/')) return { text: '', images: [file] };
  if (name.endsWith('.txt') || type === 'text/plain') return { text: (await file.text()).trim(), images: [] };
  if (name.endsWith('.pdf') || type === 'application/pdf') return await extractPdf(file);

  const JSZip = await loadJSZip();
  const zip = await JSZip.loadAsync(file);

  // Text is read directly; embedded pictures (diagrams, photos of notes) are
  // handed to the vision model so slides that are ONLY an image still count.
  if (name.endsWith('.docx')){
    const doc = zip.file('word/document.xml');
    const text = doc ? stripXml(await doc.async('string')).trim() : '';
    const images = await embeddedImages(zip, 'word/media');
    if (!text && !images.length) throw new Error('This Word file had no readable text or images.');
    return { text, images };
  }
  if (name.endsWith('.pptx')){
    const slides = Object.keys(zip.files)
      .filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
      .sort((a, b) => parseInt(a.match(/(\d+)/)[1]) - parseInt(b.match(/(\d+)/)[1]));
    const parts = [];
    for (const n of slides) parts.push(stripXml(await zip.file(n).async('string')).trim());
    const text = parts.filter(Boolean).join('\n\n');
    const images = await embeddedImages(zip, 'ppt/media');
    if (!text && !images.length) throw new Error('This PowerPoint had no readable text or images.');
    return { text, images };
  }
  throw new Error('Use a PDF, Word, PowerPoint, image or text file, or paste your notes.');
}

/* ==========================================================================
   UI PRIMITIVES
   ========================================================================== */
function Title({ children, style }){
  return <div style={{ fontFamily: SANS, fontSize: 21, fontWeight: 700, color: T.ink, letterSpacing: '-0.02em', ...style }}>{children}</div>;
}
function Sub({ children, style }){
  return <div style={{ fontFamily: SANS, fontSize: 13.5, color: T.muted, lineHeight: 1.45, ...style }}>{children}</div>;
}
/* A chip is 12px, and 12px is below the size the brand accent clears contrast
   at (4.28:1 on the ground — it is specified for the mark and for bold text
   24px and up). Solid chips are white on the accent and unaffected; an outline
   chip paints the accent as TEXT, so it defaults to the tint instead. Callers
   passing a semantic colour — green, red, amber — are untouched. */
function Chip({ children, colour = T.accentInk, solid, style }){
  return (
    <span style={{ display: 'inline-block', fontFamily: SANS, fontSize: 12, fontWeight: 600,
      color: solid ? '#fff' : colour, background: solid ? colour : rgba(colour, 0.12),
      borderRadius: R.pill, padding: '4px 10px', whiteSpace: 'nowrap', ...style }}>{children}</span>
  );
}

/* ---- icons ---------------------------------------------------------------
   Emoji were standing in for icons all over this app, and they never matched:
   every platform draws them differently, they don't take the theme colour, and
   at 14px they read as clip art next to a hand-tuned interface. These are the
   replacements — one stroke weight, currentColor, sized in context. */
const ICON_PATHS = {
  bulb:     'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.4.3.6.7.6 1.2v.9h5.8v-.9c0-.5.2-.9.6-1.2A6 6 0 0 0 12 3z',
  warn:     'M12 4.2 2.8 20h18.4L12 4.2zM12 10v4.2M12 17.3v.1',
  search:   'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM16.2 16.2 21 21',
  target:   'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6z',
  flame:    'M12 3s5.2 3.6 5.2 8.4A5.2 5.2 0 0 1 12 16.6a5.2 5.2 0 0 1-5.2-5.2C6.8 8.4 9.4 7 9.4 7s-.4 2.2.9 3c1-1.6 1.7-4.3 1.7-7zM12 16.6V21',
  folder:   'M3 7.5A2.5 2.5 0 0 1 5.5 5h3.2l2 2.2h7.8A2.5 2.5 0 0 1 21 9.7v7.8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z',
  books:    'M4 5.5A1.5 1.5 0 0 1 5.5 4H9v16H5.5A1.5 1.5 0 0 1 4 18.5zM9 4h4.5A1.5 1.5 0 0 1 15 5.5v13a1.5 1.5 0 0 1-1.5 1.5H9zM16.6 5.4l2.6.7a1.5 1.5 0 0 1 1 1.9l-3.3 12',
  save:     'M12 3.5v10M8 10l4 3.8 4-3.8M4.5 16v2.5a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V16',
  plus:     'M12 5.5v13M5.5 12h13',
  stack:    'M12 3 3 7.5l9 4.5 9-4.5zM3 12.5 12 17l9-4.5M3 17.2 12 21.7l9-4.5',
  puzzle:   'M9.5 4h5v2.2a1.8 1.8 0 1 0 3.6 0V4h1.9v5h-2.2a1.8 1.8 0 1 0 0 3.6H20v7.4h-5v-2.2a1.8 1.8 0 1 0-3.6 0V20H4v-5h2.2a1.8 1.8 0 1 0 0-3.6H4V4h5.5z',
  camera:   'M4 8.6h3.3l1.4-2.3h6.6l1.4 2.3H20a1 1 0 0 1 1 1V19a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.6a1 1 0 0 1 1-1zM12 11.3a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8z',
  image:    'M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM4 16l4.5-4.2 4 3.4 3.3-2.8L20 16M9 9.2v.1',
  clip:     'M21 11.5l-8.6 8.6a5 5 0 0 1-7.1-7.1l8.6-8.6a3.4 3.4 0 0 1 4.8 4.8l-8.6 8.6a1.7 1.7 0 0 1-2.4-2.4l7.9-7.9',
  check:    'M4.8 12.5 9.7 17.4 19.2 6.9',
  cross:    'M6 6l12 12M18 6 6 18',
  chevron:  'M6 9.5 12 15.5 18 9.5',
  clock:    'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7.2V12l3.2 2',
  trophy:   'M7 4h10v5a5 5 0 0 1-10 0zM7 5.5H4.5v1.2A3.3 3.3 0 0 0 7.4 10M17 5.5h2.5v1.2A3.3 3.3 0 0 1 16.6 10M12 14v3.5M8.6 20.5h6.8l-.6-3H9.2z',
  sparkle:  'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z',
  speaker:  'M11 5.5 6.8 9H4a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h2.8L11 18.5zM15.2 9.4a3.6 3.6 0 0 1 0 5.2M18 6.8a7.4 7.4 0 0 1 0 10.4',
  muted:    'M11 5.5 6.8 9H4a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h2.8L11 18.5zM16 10l5 4M21 10l-5 4',
  pencil:   'M4.5 19.5h3.6L19.4 8.2a2.3 2.3 0 0 0-3.2-3.2L4.5 15.9zM14.7 6.5l2.8 2.8',
  instagram:'M7.5 3.5h9a4 4 0 0 1 4 4v9a4 4 0 0 1-4 4h-9a4 4 0 0 1-4-4v-9a4 4 0 0 1 4-4zM12 8.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6zM17.4 6.6v.01',
  tiktok:   'M16.6 5.82A4.28 4.28 0 0 1 15.54 3h-3.09v12.4a2.59 2.59 0 0 1-2.59 2.5 2.59 2.59 0 0 1 0-5.18c.27 0 .52.04.76.12v-3.2a5.86 5.86 0 0 0-.76-.05 5.78 5.78 0 1 0 5.78 5.78V9.01a7.35 7.35 0 0 0 4.3 1.38V7.3a4.29 4.29 0 0 1-3.34-1.48z',
};

/* `fill` is only for the couple of glyphs that read better solid (the flame on
   a streak chip). Everything else is a stroke at a single weight. */
function Ico({ name, size = 16, weight = 1.8, fill, style }){
  const d = ICON_PATHS[name];
  if (!d) return null;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false"
      fill={fill ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={weight}
      strokeLinecap="round" strokeLinejoin="round"
      style={{ display: 'block', flexShrink: 0, ...style }}>
      <path d={d} />
    </svg>
  );
}

/* An icon that needs to sit on a text baseline rather than in a flex row. */
function InlineIco({ name, size = 15, colour, weight, fill, style }){
  return (
    <span style={{ display: 'inline-flex', verticalAlign: '-0.15em', color: colour || 'inherit', ...style }}>
      <Ico name={name} size={size} weight={weight} fill={fill} />
    </span>
  );
}

/* ---- reward effects ------------------------------------------------------
   Ported from the kokonutui components (MIT) into this file's idiom: no
   framer-motion, no Tailwind colour classes, no icon package — CSS keyframes
   and the T.* tokens instead, so everything follows light/dark automatically
   and still runs in the Artifact, which has no bundler. */

/* A particle burst. Dots fly outward from the centre of whatever relative
   parent holds it; the parent unmounts it when the animation is done. Pure
   DOM, no canvas — 14 divs is cheaper than a render loop. */
function Burst({ colour, n = 16, spread = 1 }){
  const bits = useMemo(() => {
    const out = [];
    for (let i = 0; i < n; i++){
      const a = (i / n) * Math.PI * 2 + (Math.random() - 0.5) * 0.6;
      const d = (40 + Math.random() * 60) * spread;
      out.push({ x: Math.cos(a) * d, y: Math.sin(a) * d - 10,
        s: 5 + Math.random() * 6, delay: Math.round(Math.random() * 70) });
    }
    return out;
  }, [n, spread]);
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 4 }}>
      {bits.map((b, i) => (
        <div key={i} style={{ position: 'absolute', left: '50%', top: '50%',
          width: b.s, height: b.s, borderRadius: b.s, background: colour, opacity: 0,
          '--bx': b.x + 'px', '--by': b.y + 'px',
          animation: `sf-burst 640ms cubic-bezier(.15,.75,.35,1) ${b.delay}ms forwards` }} />
      ))}
    </div>
  );
}

/* Confetti for the big moments only (finishing your due cards). Falls rather
   than bursts, and covers the whole screen. */
function Confetti({ n = 46 }){
  const hues = [T.accent, T.green, T.amber, HUES[0], HUES[2], HUES[5]];
  const bits = useMemo(() => {
    const out = [];
    for (let i = 0; i < n; i++){
      out.push({ left: Math.random() * 100, delay: Math.round(Math.random() * 900),
        dur: 1500 + Math.round(Math.random() * 1400), w: 6 + Math.random() * 6,
        h: 9 + Math.random() * 8, rot: Math.round(Math.random() * 360),
        drift: Math.round((Math.random() - 0.5) * 130), c: hues[i % hues.length] });
    }
    return out;
  }, [n]);
  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 80, overflow: 'hidden' }}>
      {bits.map((b, i) => (
        <div key={i} style={{ position: 'absolute', top: -24, left: b.left + '%',
          width: b.w, height: b.h, background: b.c, borderRadius: 2, opacity: 0,
          '--drift': b.drift + 'px', '--spin': (b.rot + 540) + 'deg',
          animation: `sf-fall ${b.dur}ms linear ${b.delay}ms forwards` }} />
      ))}
    </div>
  );
}

/* The kokonutui loader, rebuilt with plain CSS. Concentric conic-gradient
   rings, masked to thin circles, spinning at different speeds and directions.
   Tinted to the app accent instead of the original monochrome. */
function Rings({ size = 92 }){
  const ring = (inset, from, sweep, colour, dur, dir, opacity) => ({
    position: 'absolute', inset: 0, borderRadius: '50%', opacity,
    background: `conic-gradient(from ${from}deg, transparent 0deg, ${colour} ${sweep}deg, transparent ${sweep * 2}deg)`,
    mask: `radial-gradient(circle at 50% 50%, transparent ${inset}%, #000 ${inset + 2}%, #000 ${inset + 5}%, transparent ${inset + 7}%)`,
    WebkitMask: `radial-gradient(circle at 50% 50%, transparent ${inset}%, #000 ${inset + 2}%, #000 ${inset + 5}%, transparent ${inset + 7}%)`,
    animation: `${dir === 1 ? 'sf-spin' : 'sf-spin-rev'} ${dur}s linear infinite`,
  });
  return (
    <div style={{ position: 'relative', width: size, height: size,
      animation: 'sf-breathe 4s ease-in-out infinite' }}>
      <div style={ring(35, 0, 90, T.accent, 3, 1, 0.85)} />
      <div style={ring(42, 0, 120, T.accentInk, 2.5, 1, 0.9)} />
      <div style={ring(52, 180, 45, T.accent, 4, -1, 0.4)} />
      <div style={ring(61, 270, 20, T.green, 3.5, 1, 0.55)} />
    </div>
  );
}

/* A labelled progress track, in the shape of the shadcn Progress component:
   label on the left, value on the right, bar underneath. A bare bar makes you
   guess what it's measuring; this says so. `right` can carry something other
   than the number — the feed puts the combo streak there. */
function Progress({ label, value, valueText, right, colour, height = 12, reduceMotion }){
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div>
      <div className="flex items-center justify-between gap-3" style={{ marginBottom: 7, minHeight: 22 }}>
        <span style={{ fontFamily: SANS, fontSize: 12.5, fontWeight: 600, color: T.muted }}>{label}</span>
        {right ? right : (
          <span style={{ fontFamily: SANS, fontSize: 12.5, fontWeight: 700, color: T.ink,
            fontVariantNumeric: 'tabular-nums' }}>{valueText}</span>
        )}
      </div>
      <div style={{ height, background: T.well, borderRadius: R.pill, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: pct + '%', background: colour || T.green, borderRadius: R.pill,
          transition: reduceMotion ? 'none' : 'width 420ms cubic-bezier(.2,.8,.3,1)' }} />
      </div>
    </div>
  );
}

/* Full loading state — rings plus the two lines of copy. Used while cards are
   being generated, which is the app's one genuinely slow wait. */
function Loading({ title, subtitle, size }){
  return (
    <div className="flex flex-col items-center justify-center" style={{ gap: 22, padding: '26px 8px' }}>
      <Rings size={size || 92} />
      <div style={{ textAlign: 'center', maxWidth: 260 }}>
        <div style={{ fontFamily: SANS, fontSize: 15.5, fontWeight: 600, color: T.ink,
          letterSpacing: '-0.02em', animation: 'sf-pulse 3s ease-in-out infinite' }}>{title}</div>
        {subtitle && (
          <Sub style={{ marginTop: 7, fontSize: 13.5, animation: 'sf-pulse 4s ease-in-out infinite' }}>{subtitle}</Sub>
        )}
      </div>
    </div>
  );
}

/* The model replies in light markdown — **bold**, "- " bullets, blank lines.
   Render exactly that much, so replies read as prose instead of raw asterisks
   without pulling in a markdown library. */
function inlineBold(text, keyBase){
  return String(text).split('**').map((p, i) =>
    i % 2 ? <b key={keyBase + i}>{p}</b> : <span key={keyBase + i}>{p}</span>);
}
function RichText({ text, style }){
  const out = [];
  let bullets = [];
  const flush = (k) => {
    if (!bullets.length) return;
    const items = bullets;
    bullets = [];
    out.push(
      <ul key={'u' + k} style={{ margin: '2px 0 8px', paddingLeft: 18 }}>
        {items.map((b, i) => <li key={i} style={{ marginBottom: 3 }}>{inlineBold(b, 'b' + k + i)}</li>)}
      </ul>
    );
  };
  String(text || '').split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (line.slice(0, 2) === '- ' || line.slice(0, 2) === '* '){ bullets.push(line.slice(2)); return; }
    flush(i);
    if (line) out.push(<div key={'p' + i} style={{ marginBottom: 7 }}>{inlineBold(line, 'i' + i)}</div>);
  });
  flush('end');
  return <div style={{ fontFamily: SANS, fontSize: 14.5, lineHeight: 1.55, color: T.ink, ...style }}>{out}</div>;
}

/* A soft, dismissible hint. Dismissing it (by id) remembers the choice in
   settings.dismissedTips so the same nudge never nags twice. */
function Tip({ id, settings, onSettings, icon, tone, children }){
  if (dismissedTip(settings, id)) return null;
  const c = tone || T.accent;
  const dismiss = () => onSettings({ ...settings, dismissedTips: { ...(settings.dismissedTips || {}), [id]: true } });
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, background: rgba(c, 0.09),
      border: `1px solid ${rgba(c, 0.18)}`, borderRadius: R.well, padding: '11px 13px' }}>
      <span style={{ color: c, marginTop: 1, flexShrink: 0 }}><Ico name={icon || 'bulb'} size={16} /></span>
      <div style={{ flex: 1, fontFamily: SANS, fontSize: 13, lineHeight: 1.5, color: T.ink }}>{children}</div>
      <button className="sf-tap" onClick={dismiss} aria-label="Dismiss tip"
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.faint, fontSize: 18,
          lineHeight: '16px', padding: '0 2px', flexShrink: 0 }}>×</button>
    </div>
  );
}

function Btn({ children, onClick, kind = 'default', disabled, full, style }){
  const base = {
    fontFamily: SANS, fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em',
    padding: '14px 20px', borderRadius: R.pill, border: '1px solid transparent',
    background: T.surface, color: T.ink, cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.45 : 1, width: full ? '100%' : 'auto', textAlign: 'center',
    boxShadow: SH.raised, borderColor: T.border,
  };
  const kinds = {
    default: {},
    primary: { background: T.accent, color: '#fff', borderColor: T.accent, boxShadow: SH.accent },
    ghost:   { background: 'transparent', boxShadow: 'none', color: T.muted },
    soft:    { background: T.well, borderColor: 'transparent', boxShadow: 'none' },
    danger:  { background: rgba(T.red, 0.1), color: T.red, borderColor: 'transparent', boxShadow: 'none' },
    again:   { background: rgba(T.red, 0.1), color: T.red, borderColor: 'transparent', boxShadow: 'none' },
  };
  return <button className="sf-btn" onClick={disabled ? undefined : onClick} disabled={disabled}
    style={{ ...base, ...kinds[kind], ...style }}>{children}</button>;
}

function Segmented({ value, onChange, options }){
  return (
    <div style={{ display: 'flex', gap: 3, background: T.well, borderRadius: R.pill, padding: 4 }}>
      {options.map(o => {
        const active = value === o.v;
        return (
          <button key={o.v} className="sf-tap" onClick={() => onChange(o.v)}
            style={{ flex: 1, padding: '10px 6px', borderRadius: R.pill, border: 'none', cursor: 'pointer',
              background: active ? T.surface : 'transparent', color: active ? T.ink : T.muted,
              fontFamily: SANS, fontSize: 14, fontWeight: active ? 700 : 500,
              boxShadow: active ? SH.pop : 'none', transition: 'background 180ms, color 180ms, box-shadow 180ms' }}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* Quick ←→ Long answer balance. Value is the % of cards that should be long. */
function MixSlider({ value, onChange, compact }){
  const pct = Math.max(0, Math.min(100, value));
  const labelFor = (p) =>
    p <= 5   ? 'Short answers only' :
    p >= 95  ? 'Long answers only'  :
    p < 25   ? 'Mostly quick recall' :
    p < 45   ? 'Balanced, leaning quick' :
    p < 60   ? 'An even split' :
    p < 80   ? 'Balanced, leaning long' : 'Mostly exam-style';

  return (
    <div>
      <div className="flex items-center justify-between" style={{ marginBottom: 9 }}>
        <Chip colour={T.green}>{100 - pct}% quick</Chip>
        <div style={{ fontFamily: SANS, fontSize: 12.5, fontWeight: 600, color: T.muted }}>{labelFor(pct)}</div>
        <Chip colour={T.accentInk}>{pct}% long</Chip>
      </div>
      <input className="sf-range" type="range" min={0} max={100} step={5} value={pct}
        onChange={e => onChange(Number(e.target.value))}
        style={{ background: `linear-gradient(to right, ${T.green}, ${T.accent})` }} />
      {!compact && (
        <div className="flex items-center justify-between" style={{ marginTop: 7 }}>
          <Sub style={{ fontSize: 12 }}>Flip · fill-the-blank · multi-choice</Sub>
          <Sub style={{ fontSize: 12 }}>Full exam questions</Sub>
        </div>
      )}
    </div>
  );
}

function Card({ children, style, className }){
  return (
    <div className={className} style={{ background: T.surface, borderRadius: R.card,
      border: `1px solid ${T.border}`, boxShadow: SH.card, ...style }}>{children}</div>
  );
}

/* small square icon tile, like the reference app's list rows */
function Tile({ colour, glyph, size = 40 }){
  return (
    <div style={{ width: size, height: size, borderRadius: 12, background: rgba(colour, 0.14),
      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      color: colour, fontFamily: SANS, fontSize: size * 0.42, fontWeight: 700 }}>{glyph}</div>
  );
}

/* The brand mark — an isometric stack, violet top layer never filled, lower
   two in the ink colour so it works on both themes. Geometry is
   brand/svg/mark-small-on-dark.svg: everywhere it appears in the app is 32px
   or under, which is the weight the kit specifies for that range. The 8.5
   stroke smudges at this size, which is the whole reason the small cut exists. */
function Mark({ size = 26 }){
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" aria-hidden="true"
      strokeLinecap="round" strokeLinejoin="round" strokeWidth="12.5" style={{ flexShrink: 0 }}>
      <path d="M50 14 L85 34 L50 54 L15 34 Z" stroke={T.accent} />
      <path d="M15 51 L50 71 L85 51" stroke={T.ink} />
      <path d="M15 68 L50 88 L85 68" stroke={T.ink} />
    </svg>
  );
}

function Icon({ name, active }){
  const c = active ? T.accentInk : T.faint;
  const common = { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none',
    stroke: c, strokeWidth: active ? 2.2 : 1.9, strokeLinecap: 'round', strokeLinejoin: 'round' };
  if (name === 'home') return <svg {...common}><path d="M4 11l8-6 8 6" /><path d="M6 10v9h12v-9" /></svg>;
  if (name === 'feed') return <svg {...common}><rect x="3" y="7" width="18" height="13" rx="3.5" /><path d="M7 4h10" /></svg>;
  if (name === 'create') return <svg {...common}><circle cx="12" cy="12" r="8.5" /><path d="M12 8.5v7M8.5 12h7" /></svg>;
  if (name === 'decks') return <svg {...common}><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h3.2l2 2.2h7.8A2.5 2.5 0 0 1 21 9.7v7.8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z" /></svg>;
  if (name === 'stats') return <svg {...common}><path d="M5.5 19.5V12M12 19.5V5M18.5 19.5v-5.5" /></svg>;
  if (name === 'changelog') return <svg {...common}><path d="M6 4.5A6 6 0 0 1 18 4.5c0 5 2 6.5 2 6.5H4s2-1.5 2-6.5" /><path d="M10 15a2 2 0 0 0 4 0" /></svg>;
  if (name === 'feedback') return <svg {...common}><path d="M20 12a7.5 7.5 0 0 1-10.9 6.7L4.5 20l1.3-4.4A7.5 7.5 0 1 1 20 12z" /></svg>;
  return <svg {...common}><path d="M4 8h16M4 16h16" /><circle cx="9.5" cy="8" r="2.2" fill={T.surface} /><circle cx="15" cy="16" r="2.2" fill={T.surface} /></svg>;
}

/* ==========================================================================
   STUDY CARD
   ========================================================================== */
function StudyCard({ card, deck, onGrade, reduceMotion, prog, practice, onFeedback, onNote, note }){
  const [phase, setPhase] = useState('attempt');
  const [pick, setPick] = useState(null);
  const colour = subjectColour(deck.subject);
  const isMcq = card.type === 'mcq';
  const isLong = card.type === 'extended';
  const isWorked = card.type === 'worked';
  /* A cloze IS a fill-in-the-blank, so it should be filled in rather than
     read and self-rated — but only when the blank is a term and not a whole
     clause, which typedCheckable decides. Anything longer falls through to
     the old reveal-and-rate behaviour. */
  const isTyped = card.type === 'typed' || (card.type === 'cloze' && typedCheckable(card));

  useEffect(() => { setPhase('attempt'); setPick(null); }, [card.id]);

  /* Tell the ask-anything helper what's on screen, so "why is that the answer?"
     works without retyping the question. Cleared when the feed unmounts. */
  useEffect(() => {
    setStudyContext({ card, deck });
    return () => setStudyContext(null);
  }, [card.id, deck.id]);

  const committedWrong = isMcq && pick !== null && pick !== card.answer;

  const previews = useMemo(() => {
    if (practice) return null;
    const forGrade = (q) => {
      if (q === Q.AGAIN) return 'in a moment';
      const r = schedule(prog, q, committedWrong);
      return intervalWord(r.next.interval);
    };
    return { 0: forGrade(Q.AGAIN), 3: forGrade(Q.HARD), 4: forGrade(Q.GOOD), 5: forGrade(Q.EASY) };
  }, [prog, practice, committedWrong, card.id]);

  const grade = (q) => onGrade(q, committedWrong);
  const anim = reduceMotion ? {} : { animation: 'sf-in 260ms cubic-bezier(.2,.8,.3,1)' };

  return (
    <Card style={{ padding: '18px 18px 18px', minHeight: 400, display: 'flex', flexDirection: 'column', ...anim }}>
      <div className="flex items-center justify-between" style={{ marginBottom: 18 }}>
        <div className="flex items-center gap-3">
          <Tile colour={colour} glyph={(deck.subject || '?').trim().charAt(0).toUpperCase()} size={36} />
          <div>
            <div style={{ fontFamily: SANS, fontSize: 14, fontWeight: 700, color: T.ink }}>{deck.subject || 'Untitled'}</div>
            <div style={{ fontFamily: SANS, fontSize: 12.5, color: T.faint }}>{deck.topic || ''}</div>
          </div>
        </div>
        <Chip colour={T.muted}>{TYPE_LABEL[card.type] || 'Card'}</Chip>
      </div>

      {/* the point of the "I've got it" tap: it catches the gaps you don't
          know you have, and says so when the card comes back */}
      {prog && prog.flagged && (
        <div style={{ background: rgba(T.amber, 0.12), borderRadius: R.well, padding: '10px 13px', marginBottom: 14 }}>
          <Sub style={{ color: '#8A5A00', fontWeight: 600, fontSize: 13, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <InlineIco name="warn" size={15} style={{ marginTop: 2 }} />
            <span>You were sure about this one last time and got it wrong — read it properly.</span>
          </Sub>
        </div>
      )}

      {isWorked ? <WorkedFace card={card} phase={phase} deck={deck}
            onReveal={() => setPhase('reveal')} onBack={() => setPhase('attempt')} />
        : isLong ? <ExtendedFace card={card} phase={phase} deck={deck}
            onReveal={() => setPhase('reveal')} onBack={() => setPhase('attempt')} />
        : isMcq ? <McqFace card={card} phase={phase} deck={deck} pick={pick}
            onPick={(i) => {
              setPick(i); setPhase('reveal');
              /* multi-choice is the one card type where right and wrong are
                 unambiguous the instant you commit — so the reward lands here
                 rather than waiting for the grade buttons */
              if (onFeedback) onFeedback(i === card.answer ? 'right' : 'wrong');
            }} />
        : isTyped ? <TypedFace card={card} phase={phase} deck={deck}
            onAnswered={(kind) => { setPhase('reveal'); if (onFeedback) onFeedback(kind); }} />
        : card.type === 'short' ? <ShortFace card={card} phase={phase} deck={deck} />
        : <FlipFace card={card} phase={phase} deck={deck} />}

      <div style={{ flex: 1, minHeight: 16 }} />

      {/* Available in BOTH phases on purpose: a note is often a hint you wrote
          for yourself, and it is worth most while you are still trying. */}
      <CardNote card={card} note={note} onSave={onNote} />

      <div style={{ marginTop: 18 }}>
        {phase === 'reveal' ? (
          <GradeRow grade={grade} previews={previews} />
        ) : isMcq ? (
          <Sub style={{ textAlign: 'center' }}>Tap the answer you think is right</Sub>
        ) : (isLong || isWorked || isTyped) ? (
          /* both run their own controls — you write, not guess */
          null
        ) : (
          <div>
            <Sub style={{ textAlign: 'center', marginBottom: 12 }}>Say it in your head, then check</Sub>
            <Btn full kind="primary" onClick={() => setPhase('reveal')}>Show answer</Btn>
          </div>
        )}
      </div>
    </Card>
  );
}


/* Your own note on a card — the thing you told yourself last time that made it
   finally stick. Kept on the card itself rather than in a separate store, so
   it travels with the deck through Backup & transfer without any extra work.

   It stays SHUT by default, including when there is one. A note is often the
   hint you wrote for yourself, and having it sitting open above the question
   would hand you the answer before you had tried — which is the one thing that
   would make the feature worth turning off. So an existing note announces
   itself and waits to be asked. */
/* `note` is passed in rather than read off `card`, because the feed's queue is
   a snapshot taken when the session started — the card object in it never sees
   an edit made during that session, so a note saved on the card in front of
   you would vanish the moment it was written. The live value comes from the
   library instead; `card.note` is only the fallback for callers that have no
   library to look in. */
function CardNote({ card, note, onSave }){
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const areaRef = useRef(null);

  const live = note != null ? note : card.note;
  const saved = String(live == null ? '' : live);
  const has = !!saved.trim();

  /* A new card must never inherit the last one's open state or draft text. */
  useEffect(() => { setOpen(false); setEditing(false); setText(saved); }, [card.id]);
  useEffect(() => {
    if (!editing || !areaRef.current) return;
    try { areaRef.current.focus({ preventScroll: true }); } catch (e){}
  }, [editing]);

  if (!onSave) return null;

  const commit = () => { onSave(card.id, text.trim()); setEditing(false); setOpen(!!text.trim()); };
  const cancel = () => { setText(saved); setEditing(false); };
  const remove = () => { onSave(card.id, ''); setText(''); setEditing(false); setOpen(false); };

  const linkStyle = { background: 'none', border: 'none', cursor: 'pointer', padding: '4px 2px',
    fontFamily: SANS, fontSize: 13, fontWeight: 600, color: T.accentInk };

  if (editing){
    return (
      <div style={{ marginTop: 14, background: T.well, borderRadius: R.well, padding: '12px 13px' }}>
        <div className="flex items-center gap-2" style={{ marginBottom: 8 }}>
          <InlineIco name="bulb" size={14} colour={T.accentInk} />
          <span style={{ fontFamily: SANS, fontSize: 12.5, fontWeight: 700, color: T.muted }}>Your note</span>
        </div>
        <textarea ref={areaRef} value={text} onChange={e => setText(e.target.value)} rows={3}
          placeholder="How you remember it, where you went wrong last time, a trick that works…"
          aria-label="Your note on this card"
          style={{ ...INPUT, fontSize: 14.5, resize: 'vertical', background: T.surface }} />
        <div className="flex items-center gap-2" style={{ marginTop: 8, flexWrap: 'wrap' }}>
          <Btn kind="primary" onClick={commit} style={{ fontSize: 13.5, padding: '9px 16px' }}>Save note</Btn>
          <Btn kind="ghost" onClick={cancel} style={{ fontSize: 13.5, padding: '9px 12px' }}>Cancel</Btn>
          {has && <button onClick={remove} className="sf-tap" style={{ ...linkStyle, color: T.red, marginLeft: 'auto' }}>Delete</button>}
        </div>
      </div>
    );
  }

  if (has && open){
    return (
      <div style={{ marginTop: 14, background: rgba(T.accent, 0.08), borderRadius: R.well, padding: '12px 13px' }}>
        <div className="flex items-center gap-2" style={{ marginBottom: 6 }}>
          <InlineIco name="bulb" size={14} colour={T.accentInk} />
          <span style={{ fontFamily: SANS, fontSize: 12.5, fontWeight: 700, color: T.accentInk }}>Your note</span>
          <button onClick={() => setEditing(true)} className="sf-tap" style={{ ...linkStyle, marginLeft: 'auto' }}>Edit</button>
          <button onClick={() => setOpen(false)} className="sf-tap" style={{ ...linkStyle, color: T.faint }}>Hide</button>
        </div>
        <div style={{ fontFamily: SANS, fontSize: 14.5, lineHeight: 1.55, color: T.ink, whiteSpace: 'pre-wrap' }}>{saved}</div>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 14, display: 'flex', justifyContent: 'center' }}>
      <button onClick={() => (has ? setOpen(true) : setEditing(true))} className="sf-tap"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 7, cursor: 'pointer',
          background: has ? rgba(T.accent, 0.10) : 'none', border: has ? 'none' : `1px dashed ${T.border}`,
          borderRadius: R.pill, padding: has ? '7px 14px' : '7px 14px',
          fontFamily: SANS, fontSize: 13, fontWeight: 600, color: has ? T.accentInk : T.faint }}>
        <Ico name="bulb" size={14} weight={2} />
        {has ? 'You left a note — read it' : 'Add a note'}
      </button>
    </div>
  );
}
function GradeRow({ grade, previews }){
  const items = [
    [Q.AGAIN, 'Again', 'got it wrong', T.red],
    [Q.HARD,  'Hard',  'only just',    T.amber],
    [Q.GOOD,  'Good',  'knew it',      T.green],
    [Q.EASY,  'Easy',  'instantly',    T.accentInk],
  ];
  return (
    <div>
      <Sub style={{ textAlign: 'center', marginBottom: 12 }}>How did that go?</Sub>
      <div className="grid grid-cols-4 gap-2 sf-stagger">
        {items.map(([q, label, meaning, c]) => (
          <button key={q} className="sf-btn" onClick={() => grade(q)}
            style={{ background: rgba(c, 0.1), border: '1px solid transparent', borderRadius: R.well,
              padding: '12px 4px', cursor: 'pointer', fontFamily: SANS }}>
            <span style={{ display: 'block', fontSize: 14, fontWeight: 700, color: c }}>{label}</span>
            <span style={{ display: 'block', fontSize: 10.5, color: T.faint, marginTop: 3, fontWeight: 500 }}>
              {previews ? previews[q] : meaning}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}


/* ==========================================================================
   TYPED RECALL
   Free recall beats recognition, but only if the check is fair. A student who
   knows the answer and mistypes it has not got it wrong, and being told they
   did is the fastest way to stop trusting the app — so this is deliberately
   forgiving, and there is always an "I was right" override for what it still
   gets wrong. It errs towards accepting.

   Only used where the expected answer is SHORT — a term, a name, a phrase.
   A `short` card holds a one-to-three sentence model answer, which nobody
   reproduces word for word and which is judged by reading it, not by matching.
   ========================================================================== */

/* Combining marks, so café and cafe are one answer. Written as a code-point
   range rather than a regex escape because this file is edited by tools that
   have mangled \u sequences before. */
function stripMarks(s){
  let out = '';
  for (let i = 0; i < s.length; i++){
    const c = s.charCodeAt(i);
    if (c >= 0x300 && c <= 0x36f) continue;
    out += s.charAt(i);
  }
  return out;
}

/* Everything that must not decide whether an answer is right: case, accents,
   punctuation, doubled spaces, the smart quotes a phone inserts by itself,
   and a leading article. */
function normaliseAnswer(s){
  let t = stripMarks(String(s == null ? '' : s).toLowerCase().normalize('NFD'));
  t = t.replace(/[‘’ʼ`]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-');
  t = t.replace(/[.,;:!?()\[\]{}"]/g, ' ').replace(/\s+/g, ' ').trim();
  return t.replace(/^(a|an|the) /, '');
}

/* Levenshtein, abandoned as soon as it cannot come in under the cap. The
   strings are short, but there is no reason to finish a matrix whose answer
   is already "further than we would accept". */
function editDistance(a, b, cap){
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = [];
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++){
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++){
      const cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < best) best = cur[j];
    }
    if (best > cap) return cap + 1;
    prev = cur;
  }
  return prev[b.length];
}

/* How wrong a spelling may be, by how long the word is. One edit on a short
   answer is usually a different word — "ion" and "ions", "bb" and "Bb" — and
   on a long one it is a slip of the thumb. */
function typoAllowance(len){
  if (len <= 4) return 0;
  if (len <= 8) return 1;
  return 2;
}

/* Every string that counts as correct: the answer, anything the card lists in
   `accept`, and — for a term with a parenthesised gloss, like "meiosis
   (reduction division)" — the part outside the brackets on its own. */
function acceptedAnswers(card){
  const out = [];
  const push = (v) => { const s = String(v == null ? '' : v).trim(); if (s) out.push(s); };
  push(card.back);
  if (Array.isArray(card.accept)) card.accept.forEach(push);
  const bare = String(card.back == null ? '' : card.back).replace(/\([^)]*\)/g, '').trim();
  if (bare) push(bare);
  return out;
}

/* 'right' — accept and move on.
   'close' — matched only once typos were allowed for, so accept it AND show
             the spelling, which is the one case where being corrected helps.
   'wrong' — no match. */
function checkTyped(typed, card){
  const got = normaliseAnswer(typed);
  const options = acceptedAnswers(card);
  if (!got) return { verdict: 'wrong', expected: options[0] || '' };
  for (const opt of options){
    if (normaliseAnswer(opt) === got) return { verdict: 'right', expected: opt };
  }
  for (const opt of options){
    const want = normaliseAnswer(opt);
    const cap = typoAllowance(want.length);
    if (cap > 0 && editDistance(got, want, cap) <= cap) return { verdict: 'close', expected: opt };
  }
  return { verdict: 'wrong', expected: options[0] || '' };
}

/* Whether a card can fairly be answered by typing. The test is what a person
   can be expected to reproduce exactly, not what type the card is: a flip card
   whose answer is one word is fair game, and a cloze whose blank swallowed a
   whole clause is not. */
const TYPED_MAX_CHARS = 42;
const TYPED_MAX_WORDS = 6;
function typedCheckable(card){
  if (!card || card.type === 'extended' || card.type === 'worked' || card.type === 'mcq') return false;
  const a = String(card.back == null ? '' : card.back).trim();
  if (!a) return false;
  return a.length <= TYPED_MAX_CHARS && a.split(/\s+/).length <= TYPED_MAX_WORDS;
}
const QUESTION = { fontFamily: SANS, fontSize: 21, fontWeight: 600, lineHeight: 1.4, color: T.ink, letterSpacing: '-0.015em' };
const ANSWER   = { fontFamily: SANS, fontSize: 16, lineHeight: 1.6, color: T.muted };
const REVEAL   = { marginTop: 18, paddingTop: 18, borderTop: `1px solid ${T.border}`, animation: 'sf-reveal 280ms cubic-bezier(.2,.8,.3,1)' };
const PANEL    = { background: T.well, borderRadius: R.well, padding: '13px 15px' };

/* A collapsible key palette for symbols that are awkward to type. Tapping a
   key calls onInsert(symbol); the parent drops it in at the caret. Collapsed
   by default so it stays out of the way when it isn't needed. */
function SymbolBar({ onInsert }){
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: 10 }}>
      <button className="sf-tap" onClick={() => setOpen(o => !o)}
        style={{ background: T.well, border: 'none', borderRadius: R.pill, padding: '8px 14px', cursor: 'pointer',
          fontFamily: SANS, fontSize: 13, fontWeight: 600, color: T.muted }}>
        {open ? '× Hide symbols' : 'H₂O⁺  Symbols'}
      </button>
      {open && (
        <div style={{ ...PANEL, marginTop: 8 }}>
          {SYMBOL_GROUPS.map(([label, syms]) => (
            <div key={label} style={{ marginBottom: 10 }}>
              <div style={{ fontFamily: SANS, fontSize: 11, fontWeight: 700, color: T.faint, marginBottom: 6 }}>{label}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {syms.map(sym => (
                  <button key={sym} className="sf-tap"
                    onMouseDown={e => e.preventDefault()}   /* keep the textarea focused so the caret survives */
                    onClick={() => onInsert(sym)}
                    style={{ minWidth: 38, height: 38, borderRadius: 10, border: `1px solid ${T.border}`,
                      background: T.surface, cursor: 'pointer', fontFamily: SANS, fontSize: 17, color: T.ink }}>
                    {sym}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <Sub style={{ fontSize: 11.5 }}>Build them up: type H, tap ₂, type O → H₂O</Sub>
        </div>
      )}
    </div>
  );
}

/* Seeing the right answer is not the same as understanding it. Once the answer
   is on screen this unfolds the reasoning behind it — and the LEVEL is the
   student's call: Simpler starts over in everyday words, Go deeper goes at the
   mechanism. Asked for on demand, so a card you already get costs nothing. */
function ExplainMore({ card, deck, compact }){
  const [got, setGot] = useState(null);      // { depth, data } once fetched
  const [busy, setBusy] = useState('');      // depth currently loading, '' when idle
  const [err, setErr] = useState('');
  const level = (deck && deck.standard) ? deck.standard : 'NCEA Level 1';

  useEffect(() => { setGot(null); setBusy(''); setErr(''); }, [card.id]);

  const run = async (depth) => {
    setBusy(depth); setErr('');
    try {
      const r = await getExplain(card, level, depth);
      if (r && (r.plain || r.steps)) setGot({ depth, data: r });
      else setErr('Could not read that explanation. Try again.');
    } catch (e){ setErr(friendlyApiError(e)); }
    finally { setBusy(''); }
  };

  if (!got){
    return (
      <div style={{ marginTop: compact ? 10 : 14 }}>
        <button className="sf-tap" onClick={() => run('normal')} disabled={!!busy}
          style={{ background: 'none', border: 'none', cursor: busy ? 'default' : 'pointer', padding: '2px 2px',
            fontFamily: SANS, fontSize: 13.5, fontWeight: 600, color: busy ? T.faint : T.accentInk }}>
          {busy ? 'Working it out…' : <span className="flex items-center gap-2"><Ico name="search" size={15} />Explain this further</span>}
        </button>
        {err && <Sub style={{ marginTop: 6, color: T.red }}>{err}</Sub>}
      </div>
    );
  }

  const d = got.data;
  const steps = Array.isArray(d.steps) ? d.steps : [];
  const tierLabel = got.depth === 'simple' ? 'In simpler terms' : got.depth === 'deeper' ? 'Going deeper' : 'The reasoning';
  return (
    <div style={{ ...PANEL, marginTop: 14, background: rgba(T.accent, 0.07),
      animation: 'sf-reveal 260ms cubic-bezier(.2,.8,.3,1)' }}>
      <Chip colour={T.accentInk} style={{ marginBottom: 9 }}>{tierLabel}</Chip>
      {d.plain && <RichText text={d.plain} />}
      {steps.length > 0 && (
        <div className="flex flex-col gap-2" style={{ marginTop: 4 }}>
          {steps.map((s, i) => (
            <div key={i} className="flex gap-2" style={{ alignItems: 'flex-start' }}>
              <span style={{ fontFamily: SANS, fontSize: 12, fontWeight: 800, color: T.accentInk,
                lineHeight: '22px', flexShrink: 0 }}>{i + 1}</span>
              <span style={{ fontFamily: SANS, fontSize: 14.5, lineHeight: 1.5, color: T.ink }}>{String(s)}</span>
            </div>
          ))}
        </div>
      )}
      {d.watch && (
        <div style={{ marginTop: 11, paddingTop: 10, borderTop: `1px dashed ${rgba(T.accent, 0.3)}`,
          fontFamily: SANS, fontSize: 13.5, lineHeight: 1.5, color: T.muted }}>
          <b style={{ color: T.amber }}>Watch out:</b> {d.watch}
        </div>
      )}
      <div className="flex gap-2" style={{ marginTop: 12 }}>
        <Btn kind="soft" disabled={!!busy} onClick={() => run('simple')} style={{ fontSize: 13, padding: '9px 14px' }}>
          {busy === 'simple' ? 'Rethinking…' : 'Simpler'}
        </Btn>
        <Btn kind="soft" disabled={!!busy} onClick={() => run('deeper')} style={{ fontSize: 13, padding: '9px 14px' }}>
          {busy === 'deeper' ? 'Digging in…' : 'Go deeper'}
        </Btn>
      </div>
      {err && <Sub style={{ marginTop: 8, color: T.red }}>{err}</Sub>}
    </div>
  );
}

/* A real flip, not a fade. Ported from the kokonutui card-flip (MIT) with two
   changes: it turns on the tap that reveals the answer rather than on hover
   (hover doesn't exist on a phone, which is where this app lives), and the two
   faces are stacked in a single grid cell so the card sizes itself to whichever
   side is taller instead of needing a fixed height. */
function FlipFace({ card, phase, deck }){
  const flipped = phase === 'reveal';
  const face = { gridArea: '1 / 1', backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' };
  return (
    <div style={{ perspective: 1600 }}>
      <div style={{ display: 'grid', transformStyle: 'preserve-3d',
        transition: 'transform 520ms cubic-bezier(.77,0,.175,1)',
        transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)' }}>

        <div style={{ ...face, opacity: flipped ? 0 : 1, transition: 'opacity 0ms 260ms' }}>
          <div style={QUESTION}>{card.front}</div>
        </div>

        <div style={{ ...face, transform: 'rotateY(180deg)', opacity: flipped ? 1 : 0,
          transition: 'opacity 0ms 260ms' }}>
          <div className="flex items-center gap-2" style={{ marginBottom: 10 }}>
            <span style={{ color: T.green, display: 'flex' }}><Ico name="check" size={15} weight={2.4} /></span>
            <Chip colour={T.green}>Answer</Chip>
          </div>
          <div style={{ ...ANSWER, color: T.ink }}>{card.back}</div>
          <ExplainMore card={card} deck={deck} />
        </div>
      </div>
    </div>
  );
}

function ShortFace({ card, phase, deck }){
  return (
    <div>
      <div style={QUESTION}>{card.front}</div>
      {phase === 'reveal' && (
        <div style={REVEAL}>
          <Chip colour={T.green} style={{ marginBottom: 8 }}>Model answer</Chip>
          <div style={ANSWER}>{card.back}</div>
          <ExplainMore card={card} deck={deck} />
        </div>
      )}
    </div>
  );
}


/* Type it, then find out. The whole reason this card type exists is that
   every other quick card is answered in your head, and a head is a generous
   marker — you recognise the answer, feel like you knew it, and grade
   yourself Good. Writing it down removes that.

   Two rules make it bearable. Nothing is ever locked: "I was right" overrides
   the check, because a checker that is confidently wrong is worse than no
   checker. And "close" is a pass, not a failure — it accepts the answer and
   shows the spelling, which is the one moment a correction is welcome. */
function TypedFace({ card, phase, deck, onAnswered }){
  const [value, setValue] = useState('');
  const [res, setRes] = useState(null);
  const [claimed, setClaimed] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => { setValue(''); setRes(null); setClaimed(false); }, [card.id]);
  /* Typing IS the interaction, so the caret belongs in the box on arrival.
     Guarded because a detached ref throws on some mobile browsers. */
  useEffect(() => {
    if (phase !== 'attempt' || !inputRef.current) return;
    try { inputRef.current.focus({ preventScroll: true }); } catch (e){}
  }, [card.id, phase]);

  const submit = () => {
    if (res || !value.trim()) return;
    const r = checkTyped(value, card);
    setRes(r);
    onAnswered(r.verdict === 'wrong' ? 'wrong' : 'right');
  };
  /* Not knowing is a legitimate move, and pretending otherwise just teaches
     people to type a letter to get past the box. */
  const reveal = () => {
    if (res) return;
    setRes({ verdict: 'shown', expected: acceptedAnswers(card)[0] || '' });
    onAnswered('wrong');
  };
  const claim = () => { setClaimed(true); onAnswered('right'); };

  const verdict = claimed ? 'right' : (res ? res.verdict : null);
  const TONE = {
    right: { c: T.green,     label: 'Correct' },
    close: { c: T.amber,     label: 'Nearly — check the spelling' },
    wrong: { c: T.red,       label: 'Not quite' },
    shown: { c: T.muted,     label: 'The answer' },
  };
  const tone = verdict ? TONE[verdict] : null;

  return (
    <div>
      <div style={{ ...QUESTION, whiteSpace: 'pre-wrap' }}>{card.front}</div>

      {!res && (
        <div style={{ marginTop: 18 }}>
          <input ref={inputRef} value={value} onChange={e => setValue(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter'){ e.preventDefault(); submit(); } }}
            placeholder="Type your answer" aria-label="Your answer"
            autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
            style={{ ...INPUT, fontSize: 17, fontWeight: 600 }} />
          <SymbolBar onInsert={(s) => setValue(v => v + s)} />
          {/* This card runs its own controls, like the long answer does —
              the grade row underneath only appears once there is a result. */}
          <div className="flex items-center gap-2" style={{ marginTop: 12 }}>
            <Btn kind="primary" onClick={submit} disabled={!value.trim()} style={{ flex: 1 }}>Check</Btn>
            <Btn kind="soft" onClick={reveal} style={{ whiteSpace: 'nowrap' }}>Show me</Btn>
          </div>
        </div>
      )}

      {res && (
        <div style={{ marginTop: 18 }}>
          {/* what they actually wrote, kept on screen — feedback about an
              answer you can no longer see is the same mistake marking used
              to make with long answers */}
          {res.verdict !== 'shown' && (
            <div style={{ ...INPUT, fontSize: 17, fontWeight: 600, background: T.surface,
              borderColor: rgba(tone.c, 0.5), color: T.ink }}>{value}</div>
          )}
          <div className="flex items-center gap-2" style={{ marginTop: 12, flexWrap: 'wrap' }}>
            <Chip colour={tone.c} solid={verdict === 'right'}>{tone.label}</Chip>
            {/* Only offered where the check could be wrong. On a "right" there
                is nothing to dispute, and offering it would invite doubt. */}
            {!claimed && (verdict === 'wrong' || verdict === 'close') && (
              <button onClick={claim} className="sf-tap"
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px 2px',
                  fontFamily: SANS, fontSize: 13.5, fontWeight: 600, color: T.accentInk }}>
                I was right →
              </button>
            )}
          </div>
          {(verdict !== 'right' || (res.expected && normaliseAnswer(res.expected) !== normaliseAnswer(value))) && (
            <div style={{ marginTop: 12 }}>
              <Chip colour={T.green} style={{ marginBottom: 8 }}>Answer</Chip>
              <div style={ANSWER}>{res.expected}</div>
            </div>
          )}
        </div>
      )}

      {phase === 'reveal' && (
        <div style={REVEAL}>
          <ExplainMore card={card} deck={deck} />
        </div>
      )}
    </div>
  );
}
function McqFace({ card, phase, pick, onPick, deck }){
  const letters = ['A','B','C','D','E','F'];
  const revealed = phase === 'reveal';
  return (
    <div>
      <div style={{ ...QUESTION, marginBottom: 16 }}>{card.front}</div>
      <div className="flex flex-col gap-2">
        {(card.options || []).map((opt, i) => {
          const isAnswer = i === card.answer;
          const isPick = pick === i;
          let bg = T.surface, border = T.border, col = T.ink, dim = 1, anim = 'none';
          if (revealed && isAnswer){
            bg = rgba(T.green, 0.1); border = rgba(T.green, 0.5); col = T.ink;
            /* the right answer takes a beat and pops — the moment of truth on
               a multi-choice is the tap, not the grade buttons below */
            anim = 'sf-pop 420ms cubic-bezier(.2,.8,.3,1)';
          }
          else if (revealed && isPick){
            bg = rgba(T.red, 0.1); border = rgba(T.red, 0.5); col = T.ink;
            anim = 'sf-shake 420ms cubic-bezier(.3,.7,.4,1)';
          }
          else if (revealed){ dim = 0.5; }
          return (
            <button key={i} className="sf-tap" disabled={revealed} onClick={() => onPick(i)}
              style={{ display: 'flex', gap: 12, alignItems: 'center', textAlign: 'left',
                background: bg, border: `1.5px solid ${border}`, borderRadius: R.well, padding: '13px 14px',
                cursor: revealed ? 'default' : 'pointer', color: col, opacity: dim, animation: anim,
                transition: 'border-color 160ms, background 160ms, opacity 200ms' }}>
              <span style={{ width: 24, height: 24, borderRadius: 12, background: T.well, flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: SANS, fontSize: 12, fontWeight: 700, color: T.muted }}>{letters[i]}</span>
              <span style={{ fontFamily: SANS, fontSize: 15.5, lineHeight: 1.45, flex: 1, fontWeight: 500 }}>{opt}</span>
              {revealed && isAnswer && <span style={{ color: T.green }}><Ico name="check" size={17} weight={2.6} /></span>}
              {revealed && isPick && !isAnswer && <span style={{ color: T.red }}><Ico name="cross" size={16} weight={2.6} /></span>}
            </button>
          );
        })}
      </div>
      {revealed && (
        <div style={{ ...REVEAL }}>
          {card.why && <div style={{ ...PANEL, ...ANSWER, fontSize: 14.5 }}>{card.why}</div>}
          <ExplainMore card={card} deck={deck} compact={!card.why} />
        </div>
      )}
    </div>
  );
}

function Rung({ tier, text, colour }){
  return (
    <div style={{ marginBottom: 12 }}>
      <Chip colour={colour} style={{ marginBottom: 6 }}>{tier}</Chip>
      <div style={{ fontFamily: SANS, fontSize: 15, lineHeight: 1.55, color: T.muted }}>
        {text || <span style={{ color: T.faint }}>—</span>}
      </div>
    </div>
  );
}

/* Long answers are a WRITING exercise — you can't rehearse six marks in your
   head. So the textarea is the main event, not a link, and marking is the
   primary action. Skipping to the model answers stays available. */
/* The tour mounts this component for real, so the waiting it shows has to be
   real too — but what comes back is canned. A live model call there would open
   the app on a 15-second spinner, spend tokens on someone who has not made a
   card yet, and fail outright on school wifi. */
const cannedAfter = (value, ms = 700) => new Promise(r => setTimeout(() => r(value), ms));

/* `demo` swaps the three model calls for fixed answers and nothing else — the
   markup, the states and the ordering are the ones a student meets later. */
function ExtendedFace({ card, phase, deck, onReveal, onBack, demo }){
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');
  const [hints, setHints] = useState(null);      // null = not asked, [] = none, [..] = points
  const [hintBusy, setHintBusy] = useState(false);
  const [hintErr, setHintErr] = useState('');
  const [big, setBig] = useState(null);          // tier-2: sentence starters, same shape
  const [bigBusy, setBigBusy] = useState(false);
  const [bigErr, setBigErr] = useState('');
  /* Photographing the answer rather than typing it. `photo` is null when idle,
     otherwise { name, busy } while the page is being read. The transcription
     itself is deliberately NOT held in state — it goes straight into the answer
     box, because the box is the step where the student checks it. */
  const [photo, setPhoto] = useState(null);
  const [photoNote, setPhotoNote] = useState('');   // '' | 'read' | 'added'
  const photoRef = useRef(null);

  const taRef = useRef(null);
  const selRef = useRef({ start: 0, end: 0 });    // last caret/selection in the answer box
  const caretRef = useRef(null);                  // where to put the caret after the next render
  const rememberSel = () => {
    const ta = taRef.current;
    if (ta) selRef.current = { start: ta.selectionStart, end: ta.selectionEnd };
  };
  // after a symbol insert, React resets the caret to the end; put it back
  useEffect(() => {
    if (caretRef.current != null && taRef.current){
      const p = caretRef.current; caretRef.current = null;
      try { taRef.current.setSelectionRange(p, p); } catch {}
    }
  });
  const insertSymbol = (sym) => {
    const ta = taRef.current;
    const val = ta ? ta.value : answer;
    let { start, end } = selRef.current;
    start = Math.min(start, val.length); end = Math.min(end, val.length);
    const pos = start + sym.length;
    selRef.current = { start: pos, end: pos };
    caretRef.current = pos;
    if (ta) ta.focus();
    setAnswer(val.slice(0, start) + sym + val.slice(end));
  };

  useEffect(() => { setAnswer(''); setResult(null); setErr(''); setHints(null); setHintErr(''); setBig(null); setBigErr(''); setPhoto(null); setPhotoNote(''); selRef.current = { start: 0, end: 0 }; }, [card.id]);

  /* Returning to the box to rewrite has to land the caret in it. The textarea
     is unmounted while the mark is showing, so this waits for the phase to flip
     and the box to exist rather than firing at click time, when the ref is
     still the detached node from the last attempt. Caret goes to the end — the
     student is continuing a paragraph, not starting one. */
  const wantFocus = useRef(false);
  useEffect(() => {
    if (phase !== 'attempt' || !wantFocus.current) return;
    wantFocus.current = false;
    const ta = taRef.current;
    if (!ta) return;
    try { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } catch {}
  }, [phase]);

  /* Photo → words → the answer box. Deliberately not photo → mark: the vision
     model quietly tidies spelling (see transcribeAnswer), so grading its output
     unseen would grade words the student did not write. Dropping the text into
     the box they were going to type in anyway makes checking it the same action
     as writing — no extra screen, no extra decision.

     It APPENDS to whatever is already there rather than replacing it. Any
     answer long enough to be worth marking runs past one page, so the second
     photo has to continue the first; replacing would silently eat page one.

     No auto-focus afterwards. On a phone that pops the keyboard over the very
     text they have just been asked to read. */
  const usePhoto = async (file) => {
    setPhoto({ name: file.name, busy: true });
    setErr(''); setPhotoNote('');
    try {
      const shrunk = await resizeImage(file);
      const read = await transcribeAnswer(shrunk);
      if (!read){
        setPhoto(null);
        track('photo_answer', { result: 'empty' });
        setErr('No handwriting found in that photo. Check the whole answer is in frame and the page is the right way up.');
        return;
      }
      const had = answer.trim();
      setAnswer(had ? had + '\n\n' + read : read);
      setPhoto(null);
      setPhotoNote(had ? 'added' : 'read');
      track('photo_answer', { result: 'ok', words: read.split(/\s+/).length });
    } catch (e){
      setPhoto(null);
      track('photo_answer', { result: 'failed', reason: failureKind(e) });
      setErr(friendlyApiError(e));
    }
  };

  const doHints = async () => {
    setHintBusy(true); setHintErr('');
    try {
      const h = demo ? await cannedAfter(demo.hints) : await getHints(card, deck.standard || 'NCEA Level 1');
      if (h.length) setHints(h);
      else setHintErr('Could not fetch points. Try again.');
    } catch (e){ setHintErr(friendlyApiError(e)); }
    finally { setHintBusy(false); }
  };

  const doBigHint = async () => {
    setBigBusy(true); setBigErr('');
    try {
      const h = demo ? await cannedAfter(demo.starters) : await getBigHint(card, deck.standard || 'NCEA Level 1');
      if (h.length) setBig(h);
      else setBigErr('Could not fetch starters. Try again.');
    } catch (e){ setBigErr(friendlyApiError(e)); }
    finally { setBigBusy(false); }
  };

  const doMark = async () => {
    if (!answer.trim()) return;
    setBusy(true); setErr(''); setResult(null);
    try {
      const r = demo ? await cannedAfter(demo.mark, 1100) : await markAnswer(card, answer, deck.standard || 'NCEA Level 1');
      if (r){
        setResult(r); onReveal && onReveal();   // show feedback and the ladder together
        /* the tour's mark is canned, so counting it would inflate the number
           with answers nobody wrote */
        /* Clamped to the ladder rather than forwarded. This is model output, and
           a model that returns something unexpected should not be able to put
           arbitrary text into the analytics. */
        if (!demo) track('answer_marked', {
          grade: GRADES.indexOf(r.grade) >= 0 ? r.grade : 'other' });
        /* a mark you waited 15 seconds for should announce itself */
        if (r.grade === 'Excellence'){ play('excellence'); buzz([14, 40, 14]); }
        else if (r.grade === 'Merit'){ play('milestone'); buzz(16); }
        else if (r.grade === 'Achieved'){ play('right', 1); buzz(10); }
        else play('ok');
      }
      else {
        /* A reply that arrived but could not be read. This is NOT the catch
           below: the request succeeded, so nothing threw, nothing was retried,
           and until now nothing was counted either — which made this the most
           common way marking failed and the only one invisible in the
           analytics. Measured at 17% of marks before the token ceiling was
           raised, and still the residual failure when the model answers in
           prose instead of JSON. A fixed word, like every other reason. */
        if (!demo) track('mark_failed', { reason: 'unparseable' });
        setErr('Could not read the marking. Try again.');
      }
    } catch (e){
      if (!demo) track('mark_failed', { reason: failureKind(e) });
      setErr(friendlyApiError(e) + ' Your answer is safe.');
    }
    finally { setBusy(false); }
  };

  const words = answer.trim() ? answer.trim().split(/\s+/).length : 0;

  return (
    <div>
      <div className="flex items-center gap-2" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
        <Chip colour={T.accent} solid>{card.verb}</Chip>
        <Chip colour={T.muted}>{card.marks} marks</Chip>
      </div>

      {/* pre-wrap because an exam question can carry its own structure — an
          extract to read, then the question about it. Without it the blank
          line collapses and the passage runs straight into the instruction as
          one wall of text. Generated prompts are a single paragraph, so this
          changes nothing for them. */}
      <div style={{ ...QUESTION, whiteSpace: 'pre-wrap' }}>{card.prompt}</div>

      {phase === 'attempt' && (
        <div style={{ marginTop: 16 }}>
          <div className="flex items-center justify-between gap-3" style={{ marginBottom: 8 }}>
            <Sub style={{ fontWeight: 600, color: T.ink }}>Write your answer</Sub>
            {/* Typing three hundred words of physics on a phone is the reason
                this feature gets used once and never again. Practice answers
                get written on paper, and so does every real one — so the paper
                needs a way in. No `capture` attribute: plenty of students have
                already photographed the page, and forcing the camera would
                hide their own library from them. */}
            {!demo && (
              <>
                <input ref={photoRef} type="file" accept="image/*" style={{ display: 'none' }}
                  onChange={(e) => { const f = (e.target.files || [])[0]; if (e.target) e.target.value = ''; if (f) usePhoto(f); }} />
                <button className="sf-tap" onClick={() => photoRef.current && photoRef.current.click()}
                  disabled={!!(photo && photo.busy)} aria-label="Photograph your written answer"
                  style={{ background: 'none', border: 'none', padding: 0, whiteSpace: 'nowrap',
                    cursor: (photo && photo.busy) ? 'default' : 'pointer', fontFamily: SANS,
                    fontSize: 13, fontWeight: 600, color: (photo && photo.busy) ? T.faint : T.accentInk }}>
                  <span className="flex items-center gap-2"><Ico name="camera" size={15} />Photo of your writing</span>
                </button>
              </>
            )}
          </div>
          <textarea ref={taRef} value={answer}
            onChange={e => { setAnswer(e.target.value); selRef.current = { start: e.target.selectionStart, end: e.target.selectionEnd }; }}
            onSelect={rememberSel} onClick={rememberSel} onKeyUp={rememberSel}
            placeholder={`Use the ${card.verb.toLowerCase()} command properly — ${card.marks} marks means ${card.marks >= 5 ? 'several linked points' : 'more than one point'}.`}
            rows={6}
            style={{ width: '100%', background: T.well, color: T.ink, border: `1px solid ${T.border}`,
              borderRadius: R.well, padding: 14, fontFamily: SANS, fontSize: 15, lineHeight: 1.55,
              resize: 'vertical', outline: 'none' }} />
          {photo && photo.busy && (
            <div style={{ ...PANEL, padding: '8px 12px', marginTop: 8 }}>
              <Loading size={58} title="Reading your handwriting…"
                subtitle="It lands in the box above, so you can check it before it is marked." />
            </div>
          )}
          {/* Not a nicety. The model reads the words accurately but normalises
              spelling, so this says plainly that the text is a reading of the
              page and not a copy of it, and puts the last word with them. */}
          {photoNote && !(photo && photo.busy) && (
            <div style={{ background: rgba(T.amber, 0.10), borderRadius: R.well, padding: '10px 13px', marginTop: 8 }}>
              <Sub style={{ color: T.ink, fontSize: 13, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <InlineIco name="warn" size={15} style={{ marginTop: 2 }} />
                <span>
                  {photoNote === 'added' ? 'Added below what was already there. ' : 'Read from your photo. '}
                  Check it says what you actually wrote — it can tidy up spelling — then mark it.
                </span>
              </Sub>
            </div>
          )}
          <SymbolBar onInsert={insertSymbol} />
          <div className="flex items-center justify-between" style={{ marginTop: 7, marginBottom: 11 }}>
            <Sub style={{ fontSize: 12 }}>{words > 0 ? `${words} words` : 'Even a rough attempt beats reading the answer'}</Sub>
          </div>
          {/* Marking is a 10-20 second wait against the model. Without this the
              screen just sits there and reads as frozen. */}
          {busy ? (
            <div style={{ ...PANEL, padding: '8px 12px' }}>
              <Loading size={70} title="Marking your answer…"
                subtitle="Checking it against what Achieved, Merit and Excellence need." />
            </div>
          ) : (
            <div className="flex gap-2">
              <Btn full kind="primary" onClick={doMark} disabled={!answer.trim()}>Mark my answer</Btn>
              {/* In the tour there is nothing to skip to, and a second Skip beside
                  the tour's own reads as the way out of the tour. The slot goes to
                  the way out of WRITING instead: Mark stays disabled until
                  something is typed, and nobody opening an app for the first time
                  wants to compose four marks of physics about a bicycle just to
                  find out what the marking looks like. Never offered on a real
                  card — there it would be doing the work for them. */}
              {!demo && <Btn kind="soft" onClick={() => onReveal && onReveal()} style={{ whiteSpace: 'nowrap' }}>Skip</Btn>}
              {demo && demo.example && !answer.trim() && (
                <Btn kind="soft" onClick={() => setAnswer(demo.example)} style={{ whiteSpace: 'nowrap' }}>Write one for me</Btn>
              )}
            </div>
          )}
          {err && <Sub style={{ marginTop: 10, color: T.red }}>{err}</Sub>}

          {/* a nudge for when you're stuck — structure, not the answer */}
          {hints === null ? (
            <button className="sf-tap" onClick={doHints} disabled={hintBusy}
              style={{ background: 'none', border: 'none', cursor: hintBusy ? 'default' : 'pointer',
                padding: '12px 2px 0', fontFamily: SANS, fontSize: 13.5, fontWeight: 600,
                color: hintBusy ? T.faint : T.accentInk }}>
              {hintBusy ? 'Thinking of some pointers…' : <span className="flex items-center gap-2"><Ico name="bulb" size={15} />Stuck? Give me some writing points</span>}
            </button>
          ) : (
            <div style={{ ...PANEL, marginTop: 14, background: rgba(T.amber, 0.09) }}>
              <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
                <Chip colour={T.amber}>Writing points</Chip>
                <Sub style={{ fontSize: 11.5 }}>The shape of the answer — the words are yours</Sub>
              </div>
              <div className="flex flex-col gap-2">
                {hints.map((h, i) => (
                  <div key={i} className="flex gap-2" style={{ alignItems: 'flex-start' }}>
                    <span style={{ fontFamily: SANS, fontSize: 12, fontWeight: 800, color: T.amber,
                      lineHeight: '22px', flexShrink: 0 }}>{i + 1}</span>
                    <span style={{ fontFamily: SANS, fontSize: 14.5, lineHeight: 1.5, color: T.ink }}>{h}</span>
                  </div>
                ))}
              </div>

              {/* second, bigger nudge — real sentence frames with blanks to fill */}
              {big === null ? (
                <button className="sf-tap" onClick={doBigHint} disabled={bigBusy}
                  style={{ background: 'none', border: 'none', cursor: bigBusy ? 'default' : 'pointer',
                    padding: '12px 2px 0', fontFamily: SANS, fontSize: 13, fontWeight: 700,
                    color: bigBusy ? T.faint : T.accentInk }}>
                  {bigBusy ? 'Writing you some starters…' : 'Still stuck? Give me sentence starters →'}
                </button>
              ) : (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px dashed ${rgba(T.amber, 0.4)}` }}>
                  <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
                    <Chip colour={T.accentInk}>Sentence starters</Chip>
                    <Sub style={{ fontSize: 11.5 }}>Fill each blank yourself</Sub>
                  </div>
                  <div className="flex flex-col gap-2">
                    {big.map((h, i) => (
                      <div key={i} style={{ fontFamily: SANS, fontSize: 14.5, lineHeight: 1.55, color: T.ink,
                        background: T.surface, border: `1px solid ${T.border}`, borderRadius: R.input, padding: '9px 12px' }}>{h}</div>
                    ))}
                  </div>
                </div>
              )}
              {bigErr && <Sub style={{ marginTop: 8, color: T.red }}>{bigErr}</Sub>}
            </div>
          )}
          {hintErr && <Sub style={{ marginTop: 8, color: T.red }}>{hintErr}</Sub>}
        </div>
      )}

      {/* UpgradePath used to be suppressed here by withholding card+answer, since
          it is the one child of MarkResult that fires its own model call. It now
          runs canned like the rest, so the tour can hand over a mark you can
          actually act on rather than a dead end. */}
      {/* The mark stays on screen while they rewrite — the feedback is the
          reason for the edit, so hiding it to make room for the box would be
          backwards. Only offered once the card has flipped to reveal; during
          the first attempt the textarea is already right there. */}
      {result && <MarkResult r={result} card={card} answer={answer}
        level={deck.standard || 'NCEA Level 1'} deck={deck} demo={demo}
        onEdit={(phase === 'reveal' && onBack) ? () => {
          wantFocus.current = true;
          if (!demo) track('answer_reworked', {});
          onBack();
        } : null} />}

      {phase === 'reveal' && (
        <div style={REVEAL}>
          <Rung tier="Achieved" text={card.achieved} colour={T.muted} />
          <Rung tier="Merit" text={card.merit} colour={T.accentInk} />
          <Rung tier="Excellence" text={card.excellence} colour={T.green} />
          {card.skeleton && (
            <div style={{ ...PANEL, marginTop: 14 }}>
              <Chip colour={T.accentInk} style={{ marginBottom: 6 }}>Structure that earns it</Chip>
              <div style={{ fontFamily: SANS, fontSize: 14.5, color: T.ink, fontWeight: 500, lineHeight: 1.5 }}>{card.skeleton}</div>
            </div>
          )}
          {card.pitfall && (
            <div style={{ ...PANEL, marginTop: 10, background: rgba(T.red, 0.07) }}>
              <Chip colour={T.red} style={{ marginBottom: 6 }}>What loses marks here</Chip>
              <div style={{ fontFamily: SANS, fontSize: 14.5, color: T.muted, lineHeight: 1.5 }}>{card.pitfall}</div>
            </div>
          )}
          <ExplainMore card={card} deck={deck} />
        </div>
      )}
    </div>
  );
}

/* The marking says WHAT is missing; this says HOW. Asked for after you've read
   the mark, because the answer is already written — so it can quote your own
   sentences back and show the upgraded version of them. */
function UpgradePath({ card, answer, r, level, demo }){
  const [got, setGot] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const target = nextGradeUp(r.grade);
  const atTop = r.grade === 'Excellence';

  const run = async () => {
    setBusy(true); setErr('');
    try {
      const u = demo ? await cannedAfter(demo.upgrade, 900) : await getUpgrade(card, answer, r, level);
      if (u && (Array.isArray(u.steps) || u.habit)) setGot(u);
      else setErr('Could not read that. Try again.');
    } catch (e){ setErr(friendlyApiError(e)); }
    finally { setBusy(false); }
  };

  if (!got){
    return (
      <div style={{ marginTop: 12 }}>
        <Btn full kind="soft" onClick={run} disabled={busy} style={{ fontSize: 14 }}>
          <span className="flex items-center justify-center gap-2">
            {busy ? <><Rings size={17} />Working out how…</> : (atTop ? 'How do I make this airtight?' : `How do I get to ${target}?`)}
          </span>
        </Btn>
        {err && <Sub style={{ marginTop: 8, color: T.red }}>{err}</Sub>}
      </div>
    );
  }

  const steps = Array.isArray(got.steps) ? got.steps : [];
  return (
    <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px dashed ${T.border}`,
      animation: 'sf-reveal 260ms cubic-bezier(.2,.8,.3,1)' }}>
      <div className="flex items-center justify-between" style={{ marginBottom: 10 }}>
        <Chip colour={T.green} solid>{atTop ? 'Making it airtight' : 'Getting to ' + (got.target || target)}</Chip>
        <Sub style={{ fontSize: 11.5 }}>Changes to YOUR answer</Sub>
      </div>
      {/* Named before the edits, because a student who only follows the steps
          fixes this one answer, and a student who understands the gap fixes the
          next one too. */}
      {got.gap && (
        <div style={{ marginBottom: 11, background: rgba(T.green, 0.09), borderRadius: R.well,
          padding: '11px 13px', fontFamily: SANS, fontSize: 14, lineHeight: 1.6, color: T.ink }}>
          {got.gap}
        </div>
      )}
      <div className="flex flex-col gap-2">
        {steps.map((s, i) => {
          const move = typeof s === 'string' ? s : (s && s.move) || '';
          const where = (s && s.where) || '';
          const example = (s && s.example) || '';
          const why = (s && s.why) || '';
          return (
            <div key={i} style={{ background: T.surface, border: `1px solid ${T.border}`,
              borderRadius: R.input, padding: '11px 13px' }}>
              <div className="flex gap-2" style={{ alignItems: 'flex-start' }}>
                <span style={{ fontFamily: SANS, fontSize: 12, fontWeight: 800, color: T.green,
                  lineHeight: '21px', flexShrink: 0 }}>{i + 1}</span>
                <span style={{ fontFamily: SANS, fontSize: 14.5, fontWeight: 600, lineHeight: 1.5, color: T.ink }}>{move}</span>
              </div>
              {where && (
                <div style={{ marginTop: 6, paddingLeft: 20, fontFamily: SANS, fontSize: 13, color: T.muted, lineHeight: 1.5 }}>
                  Where: <span style={{ fontStyle: 'italic' }}>{where}</span>
                </div>
              )}
              {example && (
                <div style={{ marginTop: 8, marginLeft: 20, borderLeft: `2.5px solid ${rgba(T.green, 0.55)}`,
                  paddingLeft: 10, fontFamily: SANS, fontSize: 14, lineHeight: 1.55, color: T.ink }}>
                  {example}
                </div>
              )}
              {why && (
                <div style={{ marginTop: 7, paddingLeft: 20, fontFamily: SANS, fontSize: 13, color: T.muted, lineHeight: 1.5 }}>
                  <b style={{ color: T.green, fontWeight: 700 }}>Why it scores: </b>{why}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {got.habit && (
        <div style={{ marginTop: 11, fontFamily: SANS, fontSize: 13.5, lineHeight: 1.5, color: T.muted }}>
          <b style={{ color: T.ink }}>Next time:</b> {got.habit}
        </div>
      )}
    </div>
  );
}

/* Your answer, marked up — the thing a teacher hands back.

   Two problems this solves at once. Pressing Mark used to take the answer off
   the screen entirely: the feedback said "you never named the force" about a
   paragraph the student could no longer see, so they had to trust it from
   memory. And feedback about a whole answer is vague by construction, where a
   line drawn under six particular words is not.

   Highlights degrade quietly. If the model quotes something it did not copy
   properly, locateNotes drops that note and the answer still renders — plain,
   readable, and still there. Losing a highlight is a much smaller failure than
   putting one over the wrong sentence. */
function AnnotatedAnswer({ answer, notes, defaultOpen = true }){
  const [open, setOpen] = useState(defaultOpen);
  const placed = useMemo(() => placeNotes(answer, notes), [answer, notes]);
  const located = placed.located;
  const orphans = placed.orphans;
  const segs = useMemo(() => segmentAnswer(answer, located), [answer, located]);
  const words = String(answer || '').trim() ? String(answer).trim().split(/\s+/).length : 0;
  const tint = (kind) => kind === 'good' ? T.green : T.amber;

  return (
    <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px dashed ${T.border}` }}>
      <button className="sf-tap" onClick={() => setOpen(o => !o)}
        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', width: '100%' }}>
        <div className="flex items-center justify-between" style={{ marginBottom: open ? 10 : 0 }}>
          <Chip colour={T.muted}>What you wrote</Chip>
          <Sub style={{ fontSize: 11.5 }}>
            {(located.length + orphans.length) > 0 ? `${located.length + orphans.length} note${(located.length + orphans.length) === 1 ? '' : 's'} · ` : ''}
            {words} words · {open ? 'hide' : 'show'}
          </Sub>
        </div>
      </button>

      {open && (
        <>
          <div style={{ background: T.well, border: `1px solid ${T.border}`, borderRadius: R.well,
            padding: '12px 14px', fontFamily: SANS, fontSize: 14.5, lineHeight: 1.7, color: T.ink,
            /* pre-wrap keeps the student's own line breaks; overflowWrap stops a
               single pasted URL or unspaced formula pushing the card sideways on
               a phone, which pre-wrap alone will happily do */
            whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
            {segs.map((s, i) => s.mark ? (
              <span key={i} style={{ background: rgba(tint(s.mark.kind), 0.18),
                borderBottom: `2px solid ${tint(s.mark.kind)}`, borderRadius: 3, padding: '1px 0' }}>
                {s.text}
                <sup style={{ fontSize: 10, fontWeight: 800, color: tint(s.mark.kind), padding: '0 1px 0 3px' }}>{s.n}</sup>
              </span>
            ) : <span key={i}>{s.text}</span>)}
          </div>

          {located.length > 0 && (
            <div className="flex flex-col gap-2" style={{ marginTop: 10 }}>
              {located.map((l, i) => (
                <div key={i} className="flex gap-2" style={{ alignItems: 'flex-start' }}>
                  <span style={{ fontFamily: SANS, fontSize: 11, fontWeight: 800, color: tint(l.kind),
                    lineHeight: '20px', flexShrink: 0, minWidth: 12 }}>{i + 1}</span>
                  <span style={{ fontFamily: SANS, fontSize: 13.5, lineHeight: 1.5, color: T.muted }}>
                    <b style={{ color: tint(l.kind), fontWeight: 700 }}>{l.kind === 'good' ? 'Works: ' : 'Weak: '}</b>
                    {l.note}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Notes the marker made about the answer that could not be pinned to
              particular words — usually because it tidied the wording of its
              own quote, or because two of its notes wanted the same phrase.
              These used to be discarded outright, which meant the student
              silently lost part of their marking. A point with no underline is
              worth far more than no point at all, so it is shown here without
              a number rather than thrown away. */}
          {orphans.length > 0 && (
            <div className="flex flex-col gap-2" style={{ marginTop: located.length > 0 ? 10 : 12 }}>
              {orphans.map((o, i) => (
                <div key={'o' + i} className="flex gap-2" style={{ alignItems: 'flex-start' }}>
                  <span style={{ color: tint(o.kind), lineHeight: '20px', flexShrink: 0, minWidth: 12,
                    display: 'flex', justifyContent: 'center' }}>
                    <Ico name="check" size={11} weight={3} />
                  </span>
                  <span style={{ fontFamily: SANS, fontSize: 13.5, lineHeight: 1.5, color: T.muted }}>
                    <b style={{ color: tint(o.kind), fontWeight: 700 }}>{o.kind === 'good' ? 'Works: ' : 'Weak: '}</b>
                    {o.note}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function MarkResult({ r, card, answer, level, deck, demo, onEdit }){
  const gc = r.grade === 'Excellence' ? T.green : r.grade === 'Merit' ? T.accent : r.grade === 'Achieved' ? T.muted : T.red;
  const [share, setShare] = useState(false);
  /* Excellence only. Merit is a good day and Achieved is most days; if the card
     appeared for all three it would stop meaning anything and start reading as
     the app asking to be advertised. The demo tour never offers it — that mark
     was not earned. */
  const canShare = !demo && r.grade === 'Excellence';
  return (
    <div style={{ ...PANEL, marginTop: 12, animation: 'sf-reveal 260ms cubic-bezier(.2,.8,.3,1)' }}>
      <Chip colour={gc} solid>{r.grade}</Chip>
      {Array.isArray(r.hit) && r.hit.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <Sub style={{ fontWeight: 700, color: T.ink }}>What earned credit</Sub>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontFamily: SANS, fontSize: 14.5, color: T.muted, lineHeight: 1.55 }}>
            {r.hit.map((h, i) => <li key={i}>{h}</li>)}
          </ul>
        </div>
      )}
      {Array.isArray(r.missing) && r.missing.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <Sub style={{ fontWeight: 700, color: T.ink }}>To reach the next grade</Sub>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontFamily: SANS, fontSize: 14.5, color: T.muted, lineHeight: 1.55 }}>
            {r.missing.map((m, i) => <li key={i}>{m}</li>)}
          </ul>
        </div>
      )}
      {r.lift && <div style={{ marginTop: 10, fontFamily: SANS, fontSize: 15, fontWeight: 600, color: T.ink, lineHeight: 1.5 }}>{r.lift}</div>}
      {answer && <AnnotatedAnswer answer={answer} notes={r.notes} />}
      {card && answer && <UpgradePath card={card} answer={answer} r={r} level={level} demo={demo} />}
      {/* Writing it again with the feedback still on screen is the whole loop —
          and the second attempt is where the grade actually moves. The answer is
          kept, not cleared: this is an edit, not a fresh start. */}
      {onEdit && (
        <div style={{ marginTop: 12 }}>
          <Btn full kind="soft" onClick={onEdit} style={{ fontSize: 14 }}>
            <span className="flex items-center justify-center gap-2"><Ico name="pencil" size={15} />Improve this answer and mark again</span>
          </Btn>
        </div>
      )}
      {canShare && (
        <div style={{ marginTop: 6, paddingTop: 6, borderTop: `1px dashed ${T.border}` }}>
          <ShareLink label="Share this Excellence" onClick={() => setShare(true)} />
        </div>
      )}
      {share && (
        <ShareSheet kind="grade" onClose={() => setShare(false)}
          data={{ grade: r.grade,
            subject: (deck && deck.subject) || '', topic: (deck && deck.topic) || '',
            verb: card && card.verb, marks: card && card.marks,
            /* their own writing, and the marker's reason for the grade — the
               card is evidence rather than a claim. The question itself stays
               off it. */
            answer: answer,
            credit: (Array.isArray(r.hit) && r.hit.length) ? r.hit[0] : '' }} />
      )}
    </div>
  );
}

/* The step checklist, the first slip, and the student's own working marked up.

   The order here is deliberate and it is not the order a written answer's mark
   comes in. On a calculation the first question is "did I get it right", the
   second is "where did it go wrong", and only then does the detail matter. */
function WorkedResult({ r, card, working, onEdit }){
  const gc = r.grade === 'Excellence' ? T.green : r.grade === 'Merit' ? T.accent : r.grade === 'Achieved' ? T.muted : T.red;
  const bad = firstBadStep(r);
  const steps = Array.isArray(r.steps) ? r.steps : [];
  const finalC = r.final === 'correct' ? T.green : r.final === 'wrong' ? T.red : T.amber;
  const finalWord = r.final === 'correct' ? 'Final answer correct'
    : r.final === 'wrong' ? 'Final answer wrong' : 'No final answer given';
  const tick = (got) => got === 'yes' ? T.green : got === 'partly' ? T.amber : T.red;

  return (
    <div style={{ ...PANEL, marginTop: 12, animation: 'sf-reveal 260ms cubic-bezier(.2,.8,.3,1)' }}>
      <div className="flex items-center gap-2" style={{ flexWrap: 'wrap' }}>
        <Chip colour={gc} solid>{r.grade}</Chip>
        <Chip colour={finalC}>{finalWord}</Chip>
      </div>

      {/* The one fact worth pulling out of a page of marking. Everything after
          a slip in a calculation is contaminated by it, so where it STARTED is
          the difference between a fixable mistake and a lost afternoon. */}
      {bad && (
        <div style={{ background: rgba(T.red, 0.10), borderRadius: R.well, padding: '11px 13px', marginTop: 11 }}>
          <div style={{ fontFamily: SANS, fontSize: 12, fontWeight: 800, color: T.red, letterSpacing: '0.03em', marginBottom: 4 }}>
            WHERE IT FIRST WENT WRONG
          </div>
          <div style={{ fontFamily: SANS, fontSize: 14.5, lineHeight: 1.5, color: T.ink }}>
            <b>Step {bad.n}.</b> {bad.why}
          </div>
          {/* Said out loud, because a student looking at a page of crosses
              assumes the whole thing was worthless. Usually it was one line. */}
          <Sub style={{ fontSize: 12.5, marginTop: 6 }}>
            The steps after this one are marked on your method, not on the number you carried into them.
          </Sub>
        </div>
      )}

      {steps.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <Sub style={{ fontWeight: 700, color: T.ink, marginBottom: 7 }}>Your method, step by step</Sub>
          <div className="flex flex-col gap-2">
            {steps.map((s, i) => {
              const label = (card.steps || [])[Number(s.n) - 1] || '';
              return (
                <div key={i} className="flex gap-2" style={{ alignItems: 'flex-start' }}>
                  <span style={{ width: 18, height: 18, borderRadius: 9, flexShrink: 0, marginTop: 2,
                    background: rgba(tick(s.got), 0.16), color: tick(s.got), display: 'inline-flex',
                    alignItems: 'center', justifyContent: 'center' }}>
                    <Ico name={s.got === 'no' ? 'cross' : 'check'} size={11} weight={2.6} />
                  </span>
                  <div style={{ flex: 1 }}>
                    {label && <div style={{ fontFamily: SANS, fontSize: 13.5, fontWeight: 600, color: T.ink, lineHeight: 1.45 }}>{label}</div>}
                    <div style={{ fontFamily: SANS, fontSize: 13.5, color: T.muted, lineHeight: 1.5 }}>{s.why}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {r.lift && <div style={{ marginTop: 11, fontFamily: SANS, fontSize: 15, fontWeight: 600, color: T.ink, lineHeight: 1.5 }}>{r.lift}</div>}

      {r.final !== 'correct' && card.answer && (
        <div style={{ marginTop: 11 }}>
          <Sub style={{ fontWeight: 700, color: T.ink }}>The answer</Sub>
          <div style={{ fontFamily: SANS, fontSize: 15.5, fontWeight: 700, color: T.accentInk, marginTop: 2 }}>{card.answer}</div>
        </div>
      )}

      {working && <AnnotatedAnswer answer={working} notes={r.notes} />}

      {card.pitfall && (
        <div style={{ marginTop: 11 }}>
          <Sub style={{ fontSize: 13, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <InlineIco name="warn" size={15} style={{ marginTop: 2, color: T.amber }} />
            <span><b style={{ color: T.ink }}>Watch for: </b>{card.pitfall}</span>
          </Sub>
        </div>
      )}

      {/* Same loop as the written answers: the second attempt, with the marking
          still on screen, is where the grade actually moves. */}
      {onEdit && (
        <div style={{ marginTop: 12 }}>
          <Btn full kind="soft" onClick={onEdit} style={{ fontSize: 14 }}>
            <span className="flex items-center justify-center gap-2"><Ico name="pencil" size={15} />Fix it and mark again</span>
          </Btn>
        </div>
      )}
    </div>
  );
}

function WorkedFace({ card, phase, deck, onReveal, onBack }){
  const [working, setWorking] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');
  /* How much of the mark scheme has been handed over. Revealed one step at a
     time and entirely offline — the steps are already on the card, so a nudge
     costs no call, cannot fail and cannot make the student wait. It is also a
     better hint than the model could write, because it IS what gets marked. */
  const [shown, setShown] = useState(0);
  const [photo, setPhoto] = useState(null);
  const [photoNote, setPhotoNote] = useState('');
  const photoRef = useRef(null);

  const taRef = useRef(null);
  const selRef = useRef({ start: 0, end: 0 });
  const caretRef = useRef(null);
  const rememberSel = () => {
    const ta = taRef.current;
    if (ta) selRef.current = { start: ta.selectionStart, end: ta.selectionEnd };
  };
  useEffect(() => {
    if (caretRef.current != null && taRef.current){
      const p = caretRef.current; caretRef.current = null;
      try { taRef.current.setSelectionRange(p, p); } catch {}
    }
  });
  const insertSymbol = (sym) => {
    const ta = taRef.current;
    const val = ta ? ta.value : working;
    let { start, end } = selRef.current;
    start = Math.min(start, val.length); end = Math.min(end, val.length);
    const pos = start + sym.length;
    selRef.current = { start: pos, end: pos };
    caretRef.current = pos;
    if (ta) ta.focus();
    setWorking(val.slice(0, start) + sym + val.slice(end));
  };

  useEffect(() => {
    setWorking(''); setResult(null); setErr(''); setShown(0);
    setPhoto(null); setPhotoNote(''); selRef.current = { start: 0, end: 0 };
  }, [card.id]);

  /* Working is even likelier to be on paper than an essay is — nobody types
     three lines of rearranged algebra on a phone. Same confirm-then-mark rule
     as the written answers: it lands in the box, not in the marker. */
  const usePhoto = async (file) => {
    setPhoto({ name: file.name, busy: true });
    setErr(''); setPhotoNote('');
    try {
      const shrunk = await resizeImage(file);
      const read = await transcribeWorking(shrunk);
      if (!read){
        setPhoto(null);
        track('photo_answer', { result: 'empty', kind: 'working' });
        setErr('No working found in that photo. Check the whole page is in frame and the right way up.');
        return;
      }
      const had = working.trim();
      setWorking(had ? had + '\n' + read : read);
      setPhoto(null);
      setPhotoNote(had ? 'added' : 'read');
      track('photo_answer', { result: 'ok', kind: 'working', lines: read.split('\n').length });
    } catch (e){
      setPhoto(null);
      track('photo_answer', { result: 'failed', kind: 'working', reason: failureKind(e) });
      setErr(friendlyApiError(e));
    }
  };

  const doMark = async () => {
    if (!working.trim()) return;
    setBusy(true); setErr(''); setResult(null);
    try {
      const r = await markWorking(card, working, deck.standard || 'NCEA Level 1');
      if (r){
        setResult(r); onReveal && onReveal();
        track('working_marked', {
          grade: GRADES.indexOf(r.grade) >= 0 ? r.grade : 'other',
          final: ['correct', 'wrong', 'missing'].indexOf(r.final) >= 0 ? r.final : 'other' });
        if (r.grade === 'Excellence'){ play('excellence'); buzz([14, 40, 14]); }
        else if (r.grade === 'Merit'){ play('milestone'); buzz(16); }
        else if (r.grade === 'Achieved'){ play('right', 1); buzz(10); }
        else play('ok');
      } else {
        track('mark_failed', { reason: 'unparseable', kind: 'working' });
        setErr('Could not read the marking. Try again.');
      }
    } catch (e){
      track('mark_failed', { reason: failureKind(e), kind: 'working' });
      setErr(friendlyApiError(e) + ' Your working is safe.');
    }
    finally { setBusy(false); }
  };

  const allSteps = card.steps || [];
  const lines = working.trim() ? working.trim().split('\n').filter(l => l.trim()).length : 0;

  return (
    <div>
      <div className="flex items-center gap-2" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
        <Chip colour={T.accent} solid>Show your working</Chip>
        <Chip colour={T.muted}>{card.marks} marks</Chip>
      </div>

      <div style={{ ...QUESTION, whiteSpace: 'pre-wrap' }}>{card.prompt}</div>

      {phase === 'attempt' && (
        <div style={{ marginTop: 16 }}>
          <div className="flex items-center justify-between gap-3" style={{ marginBottom: 8 }}>
            <Sub style={{ fontWeight: 600, color: T.ink }}>Your working, line by line</Sub>
            <>
              <input ref={photoRef} type="file" accept="image/*" style={{ display: 'none' }}
                onChange={(e) => { const f = (e.target.files || [])[0]; if (e.target) e.target.value = ''; if (f) usePhoto(f); }} />
              <button className="sf-tap" onClick={() => photoRef.current && photoRef.current.click()}
                disabled={!!(photo && photo.busy)} aria-label="Photograph your working"
                style={{ background: 'none', border: 'none', padding: 0, whiteSpace: 'nowrap',
                  cursor: (photo && photo.busy) ? 'default' : 'pointer', fontFamily: SANS,
                  fontSize: 13, fontWeight: 600, color: (photo && photo.busy) ? T.faint : T.accentInk }}>
                <span className="flex items-center gap-2"><Ico name="camera" size={15} />Photo of your working</span>
              </button>
            </>
          </div>
          <textarea ref={taRef} value={working}
            onChange={e => { setWorking(e.target.value); selRef.current = { start: e.target.selectionStart, end: e.target.selectionEnd }; }}
            onSelect={rememberSel} onClick={rememberSel} onKeyUp={rememberSel}
            placeholder={'One step per line — the marks are in the method, not in the number.'}
            rows={7}
            style={{ width: '100%', background: T.well, color: T.ink, border: `1px solid ${T.border}`,
              borderRadius: R.well, padding: 14, fontFamily: SANS, fontSize: 15, lineHeight: 1.7,
              resize: 'vertical', outline: 'none' }} />

          {photo && photo.busy && (
            <div style={{ ...PANEL, padding: '8px 12px', marginTop: 8 }}>
              <Loading size={58} title="Reading your working…"
                subtitle="It lands in the box above, so you can check it before it is marked." />
            </div>
          )}
          {photoNote && !(photo && photo.busy) && (
            <div style={{ background: rgba(T.amber, 0.10), borderRadius: R.well, padding: '10px 13px', marginTop: 8 }}>
              <Sub style={{ color: T.ink, fontSize: 13, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <InlineIco name="warn" size={15} style={{ marginTop: 2 }} />
                <span>
                  {photoNote === 'added' ? 'Added below what was already there. ' : 'Read from your photo. '}
                  Check every number came through — then mark it.
                </span>
              </Sub>
            </div>
          )}

          <SymbolBar onInsert={insertSymbol} />
          <div className="flex items-center justify-between" style={{ marginTop: 7, marginBottom: 11 }}>
            <Sub style={{ fontSize: 12 }}>{lines > 0 ? `${lines} line${lines === 1 ? '' : 's'} of working` : 'Write the method out — a bare answer caps at Achieved'}</Sub>
          </div>

          {busy ? (
            <div style={{ ...PANEL, padding: '8px 12px' }}>
              <Loading size={70} title="Marking your working…"
                subtitle="Checking every step of the method, and finding where it first goes wrong." />
            </div>
          ) : (
            <div className="flex gap-2">
              <Btn full kind="primary" onClick={doMark} disabled={!working.trim()}>Mark my working</Btn>
              <Btn kind="soft" onClick={() => onReveal && onReveal()} style={{ whiteSpace: 'nowrap' }}>Skip</Btn>
            </div>
          )}
          {err && <Sub style={{ marginTop: 10, color: T.red }}>{err}</Sub>}

          {/* Offline, and one step at a time. Handing over the whole method at
              once is handing over the answer; handing over the first line is
              usually all that was needed, because where students stop is the
              setup, not the arithmetic. */}
          {allSteps.length > 0 && (
            <div style={{ marginTop: 4 }}>
              {shown > 0 && (
                <div style={{ ...PANEL, marginTop: 10, background: rgba(T.amber, 0.09) }}>
                  <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
                    <Chip colour={T.amber}>First step{shown > 1 ? 's' : ''}</Chip>
                    <Sub style={{ fontSize: 11.5 }}>{shown} of {allSteps.length}</Sub>
                  </div>
                  <div className="flex flex-col gap-2">
                    {allSteps.slice(0, shown).map((s, i) => (
                      <div key={i} className="flex gap-2" style={{ alignItems: 'flex-start' }}>
                        <span style={{ fontFamily: SANS, fontSize: 12, fontWeight: 800, color: T.amber, lineHeight: '22px', flexShrink: 0 }}>{i + 1}</span>
                        <span style={{ fontFamily: SANS, fontSize: 14.5, lineHeight: 1.5, color: T.ink }}>{s}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {shown < allSteps.length && (
                <button className="sf-tap" onClick={() => setShown(n => n + 1)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '12px 2px 0',
                    fontFamily: SANS, fontSize: 13.5, fontWeight: 600, color: T.accentInk }}>
                  <span className="flex items-center gap-2">
                    <Ico name="bulb" size={15} />
                    {shown === 0 ? 'Stuck? Show me the first step' : 'Show me the next step'}
                  </span>
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {phase === 'reveal' && (
        <div style={REVEAL}>
          {result ? (
            <WorkedResult r={result} card={card} working={working}
              onEdit={() => { setResult(null); onBack && onBack(); }} />
          ) : (
            <div>
              <Sub style={{ fontWeight: 700, color: T.ink, marginBottom: 7 }}>The method</Sub>
              <div className="flex flex-col gap-2">
                {allSteps.map((s, i) => (
                  <div key={i} className="flex gap-2" style={{ alignItems: 'flex-start' }}>
                    <span style={{ fontFamily: SANS, fontSize: 12, fontWeight: 800, color: T.accent, lineHeight: '22px', flexShrink: 0 }}>{i + 1}</span>
                    <span style={{ fontFamily: SANS, fontSize: 14.5, lineHeight: 1.5, color: T.ink }}>{s}</span>
                  </div>
                ))}
              </div>
              {card.answer && (
                <div style={{ marginTop: 11 }}>
                  <Sub style={{ fontWeight: 700, color: T.ink }}>The answer</Sub>
                  <div style={{ fontFamily: SANS, fontSize: 15.5, fontWeight: 700, color: T.accentInk, marginTop: 2 }}>{card.answer}</div>
                </div>
              )}
              {card.pitfall && (
                <Sub style={{ fontSize: 13, marginTop: 11, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <InlineIco name="warn" size={15} style={{ marginTop: 2, color: T.amber }} />
                  <span><b style={{ color: T.ink }}>Watch for: </b>{card.pitfall}</span>
                </Sub>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ==========================================================================
   FEED
   ========================================================================== */
const perDay = (s) => (s && s.newPerDay != null) ? s.newPerDay : 12;

function newBudgetFor(settings, stats){
  if (!settings.capNew) return Infinity;
  const used = (stats.newByDate && stats.newByDate[TODAY()]) || 0;
  return Math.max(0, perDay(settings) - used);
}

function buildQueue(decks, progress, settings, stats){
  const today = TODAY();
  const due = [], fresh = [];
  for (const d of decks){
    for (const c of d.cards){
      const p = progress[c.id];
      if (!p || !p.seen) fresh.push({ card: c, deck: d });
      else if (p.due <= today) due.push({ card: c, deck: d });
    }
  }
  /* Shuffle before anything else. Without this the queue rebuilds in the exact
     same order every time the feed remounts, so you meet the same cards again
     after leaving and coming back. Order doesn't affect the scheduling. */
  const shuffledDue = shuffle(due);
  const shuffledFresh = shuffle(fresh);
  const budget = newBudgetFor(settings, stats);
  let items = shuffledDue.concat(budget === Infinity ? shuffledFresh : shuffledFresh.slice(0, budget));

  // round-robin across subjects so no topic arrives in one block
  const interleaveSubjects = (list) => {
    if (!settings.interleave || list.length < 2) return list;
    const bySub = {};
    for (const it of list){
      const k = it.deck.subject || '';
      if (!bySub[k]) bySub[k] = [];
      bySub[k].push(it);
    }
    const lanes = Object.values(bySub);
    if (lanes.length < 2) return list;
    const out = [];
    const cap = list.length * lanes.length + lanes.length;
    let n = 0;
    while (out.length < list.length && n < cap){
      const lane = lanes[n % lanes.length];
      if (lane.length) out.push(lane.shift());
      n++;
    }
    return out.length === list.length ? out : list;
  };

  // then blend long vs quick to the ratio the user picked
  const long = interleaveSubjects(items.filter(it => isLongCard(it.card)));
  const quick = interleaveSubjects(items.filter(it => !isLongCard(it.card)));
  return blendByRatio(long, quick, longMixOf(settings));
}

/* The row above the feed: choose which deck you're studying (or "All decks"),
   with a quiz shortcut for whatever's in focus. Pills scroll; the quiz button
   stays put. Selection lifts state up to App, which re-keys the feed. */
function DeckBar({ decks, progress, focus, setFocus, onQuiz }){
  const today = TODAY();
  const dueOf = (d) => d.cards.filter(c => { const p = progress[c.id]; return p && p.seen && p.due <= today; }).length;
  const many = decks.length > 1;
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
      {many && (
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', flex: 1, padding: '2px 2px 6px', WebkitOverflowScrolling: 'touch' }}>
          {[{ id: 'all', label: 'All decks', colour: T.accent, due: 0 }].concat(
            decks.map(d => ({ id: d.id, label: d.topic || d.subject || 'Untitled', colour: subjectColour(d.subject), due: dueOf(d) }))
          ).map(p => {
            const active = focus === p.id;
            return (
              <button key={p.id} className="sf-tap" onClick={() => setFocus(p.id)}
                style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer',
                  background: active ? T.surface : T.well, border: `1.5px solid ${active ? rgba(p.colour, 0.5) : 'transparent'}`,
                  borderRadius: R.pill, padding: '7px 13px', boxShadow: active ? SH.pop : 'none' }}>
                <span style={{ width: 8, height: 8, borderRadius: 8, background: p.colour, flexShrink: 0 }} />
                <span style={{ fontFamily: SANS, fontSize: 13, fontWeight: active ? 700 : 550, color: active ? T.ink : T.muted,
                  whiteSpace: 'nowrap', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.label}</span>
                {p.due > 0 && <span style={{ fontFamily: SANS, fontSize: 11, fontWeight: 700, color: active ? T.accentInk : T.faint }}>{p.due}</span>}
              </button>
            );
          })}
        </div>
      )}
      <button className="sf-tap" onClick={() => onQuiz(focus)}
        style={{ flexShrink: 0, marginLeft: many ? 0 : 'auto', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
          background: rgba(T.green, 0.12), border: `1px solid ${rgba(T.green, 0.25)}`, color: T.green,
          borderRadius: R.pill, padding: '8px 14px', fontFamily: SANS, fontSize: 13, fontWeight: 700 }}>
        <Ico name="target" size={14} />Quiz
      </button>
    </div>
  );
}

/* The streak chip. Appears at two in a row and escalates — the number going up
   is the whole point, so it gets bigger and warmer rather than just changing
   text. Resets to nothing the moment you press Again. */
function ComboChip({ n }){
  if (n < 2) return null;
  const tier = n >= 10 ? 2 : n >= 5 ? 1 : 0;
  const c = tier === 2 ? T.green : tier === 1 ? T.amber : T.accentInk;
  const label = tier === 2 ? `${n} in a row — unreal` : `${n} in a row`;
  return (
    <span key={n} style={{ display: 'inline-block', fontFamily: SANS,
      fontSize: tier === 2 ? 13 : 12.5, fontWeight: 700, color: tier ? '#fff' : c,
      background: tier ? c : rgba(c, 0.14), borderRadius: R.pill,
      padding: tier === 2 ? '5px 13px' : '4px 11px', whiteSpace: 'nowrap',
      animation: 'sf-combo-in 420ms cubic-bezier(.2,.8,.3,1)' }}>
      <span className="flex items-center gap-1.5">
        {tier > 0 && <Ico name="flame" size={13} weight={2} fill />}{label}
      </span>
    </span>
  );
}

/* Sits over the card and fires once per grade: a colour wash across the whole
   card plus a particle burst. Keyed by an incrementing id so consecutive
   grades of the same kind still replay. */
function RewardLayer({ fx }){
  if (!fx) return null;
  const c = fx.kind === 'wrong' ? T.red : fx.kind === 'ok' ? T.amber : fx.kind === 'milestone' ? T.amber : T.green;
  return (
    <div key={fx.id} style={{ position: 'absolute', inset: 0, pointerEvents: 'none',
      borderRadius: R.card, overflow: 'hidden', zIndex: 3 }}>
      <div style={{ position: 'absolute', inset: 0, background: rgba(c, 0.16),
        animation: 'sf-flash 520ms ease-out forwards' }} />
      {fx.kind !== 'wrong' && <Burst colour={c} n={fx.kind === 'milestone' ? 24 : 15} spread={fx.kind === 'milestone' ? 1.35 : 1} />}
    </div>
  );
}

/* Finishing the cards that were actually due is the biggest moment in the app
   and it used to pass in silence — the feed just slid into endless practice.
   Now it stops, celebrates, and makes carrying on a deliberate choice again. */
function FinishedCard({ done, streak, subjects, week, headline, onPractice, onHome }){
  const [share, setShare] = useState(false);
  useEffect(() => {
    play('done'); buzz([16, 60, 16, 60, 26]);
    track('session_finished', { cards: done, streak: streak, subjects: (subjects || []).length });
  }, []);
  return (
    <>
      <Confetti />
      <Card style={{ padding: '40px 24px', textAlign: 'center', position: 'relative', overflow: 'hidden',
        animation: 'sf-in 300ms cubic-bezier(.2,.8,.3,1)' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14, color: T.green,
          animation: 'sf-float 2.6s ease-in-out infinite' }}>
          <Ico name="trophy" size={46} weight={1.5} />
        </div>
        <Title style={{ fontSize: 23 }}>That's everything due</Title>
        <Sub style={{ marginTop: 8, maxWidth: 300, marginLeft: 'auto', marginRight: 'auto' }}>
          {done} card{done === 1 ? '' : 's'} reviewed. They'll come back exactly when you're about to forget them.
        </Sub>
        {streak > 0 && (
          <div style={{ marginTop: 16 }}>
            <Chip colour={T.amber} solid>
              <span className="flex items-center gap-1.5"><Ico name="flame" size={13} weight={2} fill />{streak} day streak</span>
            </Chip>
          </div>
        )}
        <div className="flex gap-2" style={{ marginTop: 26 }}>
          <Btn full kind="primary" onClick={onHome}>Put the phone down</Btn>
          <Btn kind="soft" onClick={onPractice} style={{ whiteSpace: 'nowrap' }}>Keep going</Btn>
        </div>
        {/* under the two real choices, so it never competes with them */}
        <ShareLink label="Share today's session" onClick={() => setShare(true)} style={{ marginTop: 6 }} />
      </Card>
      {share && (
        <ShareSheet kind="session" onClose={() => setShare(false)}
          data={{ done: done, streak: streak, subjects: subjects || [],
            week: week || [], headline: headline }} />
      )}
    </>
  );
}

function Feed({ decks, progress, settings, stats, onGrade, reduceMotion, focus, setFocus, onSettings, onQuiz, onHome, onNote }){
  const fdecks = useMemo(() => (focus === 'all' ? decks : decks.filter(d => d.id === focus)), [decks, focus]);
  /* Live notes by card id. The queue below is a snapshot, so this is the only
     thing on this screen that reflects an edit made during the session. */
  const notes = useMemo(() => {
    const m = {};
    for (const d of decks) for (const c of d.cards) if (c.note) m[c.id] = c.note;
    return m;
  }, [decks]);
  const focusDeck = focus === 'all' ? null : decks.find(d => d.id === focus);

  const allItems = useMemo(() => {
    const out = [];
    for (const d of fdecks) for (const c of d.cards) out.push({ card: c, deck: d });
    return out;
  }, [fdecks]);

  // practice pool: shuffled, then blended to the same long/quick ratio
  const mixedPool = useCallback(() => {
    const s = shuffle(allItems);
    return blendByRatio(s.filter(it => isLongCard(it.card)), s.filter(it => !isLongCard(it.card)), longMixOf(settings));
  }, [allItems, settings]);

  const [queue, setQueue] = useState(() => buildQueue(fdecks, progress, settings, stats));
  const [reviewed, setReviewed] = useState(0);
  /* Subjects touched in THIS sitting, for the share card. Taken as they are
     graded rather than from the queue, because a queue you abandon halfway
     would otherwise claim subjects you never actually saw. */
  const [seenSubjects, setSeenSubjects] = useState([]);
  const [pool, setPool] = useState([]);
  const [pIdx, setPIdx] = useState(0);
  const [combo, setCombo] = useState(0);
  const [fx, setFx] = useState(null);          // { id, kind } — one reward flash
  const [finished, setFinished] = useState(false);
  const fxId = useRef(0);

  const scheduledLeft = queue.length;
  /* Practice only starts once you've either chosen to keep going, or arrived
     with nothing due in the first place. */
  const inPractice = scheduledLeft === 0 && !finished;
  const bar = <DeckBar decks={decks} progress={progress} focus={focus} setFocus={setFocus} onQuiz={onQuiz} />;

  useEffect(() => {
    if (inPractice && pool.length === 0 && allItems.length > 0){
      setPool(mixedPool());
      setPIdx(0);
    }
  }, [inPractice, pool.length, allItems]);

  /* One place decides what a grade feels like, so scheduled and practice cards
     behave identically. `silent` is for multi-choice, which already gave you
     the sound the moment you committed to an option. */
  const reward = (q, silent) => {
    const good = q >= Q.GOOD;
    const next = good ? combo + 1 : 0;
    setCombo(next);
    const milestone = good && next >= 5 && next % 5 === 0;
    const kind = q === Q.AGAIN ? 'wrong' : q === Q.HARD ? 'ok' : milestone ? 'milestone' : 'right';
    fxId.current += 1;
    setFx({ id: fxId.current, kind });
    if (!silent){
      if (q === Q.AGAIN){ play('wrong'); buzz(34); }
      else if (q === Q.HARD){ play('ok'); buzz(10); }
      else if (milestone){ play('milestone'); buzz([12, 50, 12]); }
      else { play('right', next - 1); buzz(10); }
    }
    return next;
  };

  const gradeScheduled = (q, sure) => {
    const head = queue[0];
    if (!head) return;
    const rest = queue.slice(1);
    const { reinsert } = onGrade(head.card, head.deck, q, sure, false);
    reward(q, head.card.type === 'mcq');
    setReviewed(r => r + 1);
    const subj = head.deck.subject;
    if (subj) setSeenSubjects(s => s.indexOf(subj) === -1 ? s.concat([subj]) : s);
    if (reinsert){
      const nq = rest.slice();
      nq.splice(Math.min(rest.length, 5), 0, head);
      setQueue(nq);
    } else {
      setQueue(rest);
      if (rest.length === 0) setFinished(true);   // that was the last one due
    }
  };

  const gradePractice = (q, sure) => {
    const it = pool[pIdx];
    if (!it) return;
    onGrade(it.card, it.deck, q, sure, true);
    reward(q, it.card.type === 'mcq');
    setReviewed(r => r + 1);
    const next = pIdx + 1;
    if (next >= pool.length){ setPool(mixedPool()); setPIdx(0); }
    else setPIdx(next);
  };

  /* Multi-choice reports the instant you pick, before any grade is given. */
  const pickFeedback = (kind) => {
    fxId.current += 1;
    setFx({ id: fxId.current, kind });
    if (kind === 'right'){ play('right', combo); buzz(10); }
    else { play('wrong'); buzz(34); }
  };

  if (allItems.length === 0){
    return (
      <div>
        {bar}
        <Card style={{ padding: '44px 24px', textAlign: 'center' }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14, color: T.faint }}><Ico name="folder" size={38} weight={1.5} /></div>
          <Title>{focusDeck ? 'This deck is empty' : 'No cards yet'}</Title>
          <Sub style={{ marginTop: 6 }}>{focusDeck ? 'Add cards to it, or pick another deck above.' : <>Head to <b>Create</b> to make your first deck.</>}</Sub>
        </Card>
      </div>
    );
  }

  if (finished){
    return (
      <div>
        {bar}
        <FinishedCard done={reviewed} streak={stats.streak || 0} subjects={seenSubjects}
          week={sessionWeek(stats)} headline={sessionHeadline(stats, reviewed, seenSubjects)}
          onPractice={() => { setFinished(false); setCombo(0); }} onHome={onHome} />
      </div>
    );
  }

  if (inPractice){
    const it = pool[pIdx];
    if (!it) return <div style={{ minHeight: 420 }} />;
    return (
      <div>
        {bar}
        <div className="flex items-center justify-between" style={{ marginBottom: 12, padding: '0 4px' }}>
          <Chip colour={T.green}>{focusDeck ? 'Extra practice · ' + (focusDeck.topic || focusDeck.subject || 'this deck') : 'Extra practice'}</Chip>
          <div className="flex items-center gap-2">
            <ComboChip n={combo} />
            <Sub style={{ fontSize: 12.5 }}>{reviewed} done today</Sub>
          </div>
        </div>
        <div style={{ position: 'relative' }}>
          <StudyCard key={it.card.id + ':' + pIdx} card={it.card} deck={it.deck} onGrade={gradePractice}
            reduceMotion={reduceMotion} prog={progress[it.card.id]} practice={true} onFeedback={pickFeedback}
            onNote={onNote ? ((cardId, text) => onNote(it.deck.id, cardId, text)) : null}
            note={notes[it.card.id]} />
          {!reduceMotion && <RewardLayer fx={fx} />}
        </div>
      </div>
    );
  }

  const done = reviewed;
  const pct = (done + scheduledLeft) ? (done / (done + scheduledLeft)) * 100 : 0;
  return (
    <div>
      {bar}
      {decks.length > 1 && focus === 'all' && (
        <div style={{ marginBottom: 12 }}>
          <Tip id="feed-pick-deck" settings={settings} onSettings={onSettings}>
            Studying everything at once? Tap a deck above to drill just one subject.
          </Tip>
        </div>
      )}
      <div style={{ marginBottom: 14, padding: '0 4px' }}>
        <Progress label={scheduledLeft === 1 ? 'Last one' : `${scheduledLeft} to go`} value={pct}
          valueText={`${done} of ${done + scheduledLeft}`}
          right={combo >= 2 ? <ComboChip n={combo} /> : null}
          reduceMotion={reduceMotion} />
      </div>
      <div style={{ position: 'relative' }}>
        <StudyCard key={queue[0].card.id} card={queue[0].card} deck={queue[0].deck} onGrade={gradeScheduled}
          reduceMotion={reduceMotion} prog={progress[queue[0].card.id]} practice={false} onFeedback={pickFeedback}
          onNote={onNote ? ((cardId, text) => onNote(queue[0].deck.id, cardId, text)) : null}
          note={notes[queue[0].card.id]} />
        {!reduceMotion && <RewardLayer fx={fx} />}
      </div>
    </div>
  );
}

/* ==========================================================================
   CREATE
   ========================================================================== */
const INPUT = { width: '100%', background: T.well, color: T.ink, border: `1px solid ${T.border}`,
  borderRadius: R.well, padding: '13px 14px', fontFamily: SANS, lineHeight: 1.55, outline: 'none' };

/* The dropzone illustration — a dashed orbit, a folder that breathes, and an
   arrow that lifts. Ported from the kokonutui file-upload (MIT); the path
   morph needs SMIL (CSS can't tween `d`), the orbit is plain CSS. Colours are
   theme tokens, so it follows light/dark like everything else. */
function UploadArt({ active }){
  return (
    <svg width="66" height="66" viewBox="0 0 100 100" fill="none" aria-hidden="true"
      style={{ transition: 'transform 240ms cubic-bezier(.2,.8,.3,1)', transform: active ? 'scale(1.06)' : 'none' }}>
      <circle cx="50" cy="50" r="45" strokeDasharray="4 4" strokeWidth="2"
        stroke={active ? rgba(T.accent, 0.55) : T.border}
        style={{ transformOrigin: '50px 50px', animation: 'sf-spin 60s linear infinite' }} />
      <path strokeWidth="2" stroke={T.accent} fill={rgba(T.accent, 0.13)}
        d="M30 35H70C75 35 75 40 75 40V65C75 70 70 70 70 70H30C25 70 25 65 25 65V40C25 35 30 35 30 35Z">
        <animate attributeName="d" dur="2.4s" repeatCount="indefinite"
          values="M30 35H70C75 35 75 40 75 40V65C75 70 70 70 70 70H30C25 70 25 65 25 65V40C25 35 30 35 30 35Z;
                  M30 38H70C75 38 75 43 75 43V68C75 73 70 73 70 73H30C25 73 25 68 25 68V43C25 38 30 38 30 38Z;
                  M30 35H70C75 35 75 40 75 40V65C75 70 70 70 70 70H30C25 70 25 65 25 65V40C25 35 30 35 30 35Z" />
      </path>
      <path d="M30 35C30 35 35 35 40 35C45 35 45 30 50 30C55 30 55 35 60 35C65 35 70 35 70 35"
        fill="none" strokeWidth="2" stroke={T.accent} />
      <line x1="50" x2="50" y1="45" y2="60" strokeWidth="2" strokeLinecap="round" stroke={T.accent}>
        <animate attributeName="y2" dur="2.4s" repeatCount="indefinite" values="60;55;60" />
      </line>
      <polyline points="42,52 50,45 58,52" fill="none" strokeWidth="2" strokeLinecap="round"
        strokeLinejoin="round" stroke={T.accent}>
        <animate attributeName="points" dur="2.4s" repeatCount="indefinite"
          values="42,52 50,45 58,52;42,47 50,40 58,47;42,52 50,45 58,52" />
      </polyline>
    </svg>
  );
}

/* Drag-and-drop or tap to browse. The original simulated an upload bar; ours
   shows the real thing, because reading a PDF genuinely takes a few seconds. */
function DropZone({ onPicked, attaching, imageCount }){
  const [drag, setDrag] = useState(false);
  const fileRef = useRef(null);
  const stop = (e) => { e.preventDefault(); e.stopPropagation(); };

  return (
    <div
      onDragOver={(e) => { stop(e); if (!attaching) setDrag(true); }}
      onDragLeave={(e) => { stop(e); setDrag(false); }}
      onDrop={(e) => {
        stop(e); setDrag(false);
        if (attaching) return;
        const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
        if (files.length) onPicked(files);
      }}
      onClick={() => { if (!attaching && fileRef.current) fileRef.current.click(); }}
      style={{ marginTop: 14, position: 'relative', cursor: attaching ? 'default' : 'pointer',
        borderRadius: R.card, padding: '26px 18px', textAlign: 'center',
        border: `1.5px dashed ${drag ? T.accent : T.border}`,
        background: drag ? rgba(T.accent, 0.07) : T.surface,
        transition: 'background 200ms, border-color 200ms' }}>
      <input ref={fileRef} type="file" multiple style={{ display: 'none' }}
        accept=".pdf,.docx,.pptx,.txt,application/pdf,image/*"
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          if (e.target) e.target.value = '';
          if (files.length) onPicked(files);
        }} />

      {attaching ? (
        <div className="flex flex-col items-center" style={{ gap: 14, padding: '4px 0' }}>
          <Rings size={62} />
          <Sub style={{ fontWeight: 600, color: T.ink }}>{attaching}</Sub>
        </div>
      ) : (
        <div className="flex flex-col items-center">
          <UploadArt active={drag} />
          <div style={{ fontFamily: SANS, fontSize: 16, fontWeight: 700, color: T.ink,
            letterSpacing: '-0.02em', marginTop: 12 }}>
            {drag ? 'Drop it here' : 'Drop a file, or tap to browse'}
          </div>
          <Sub style={{ fontSize: 12.5, marginTop: 4 }}>PDF, Word, PowerPoint, images or text</Sub>
          {imageCount > 0 && (
            <div style={{ marginTop: 10 }}>
              <Chip colour={T.green}>{imageCount} image{imageCount === 1 ? '' : 's'} ready to read</Chip>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Create({ onSave, settings, onSettings, onPending, onStarter, seed, onSeedUsed }){
  const [mode, setMode] = useState('generate');
  const [cardType, setCardType] = useState('mix');
  const [source, setSource] = useState('');
  const [level, setLevel] = useState('NCEA Level 1');
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState(null);
  const [err, setErr] = useState('');
  const [drafts, setDrafts] = useState(null);
  // set when some sections of the material failed but others produced cards
  const [shortfall, setShortfall] = useState('');
  const [meta, setMeta] = useState({ subject: '', topic: '', standard: 'NCEA Level 1' });
  const [attaching, setAttaching] = useState('');
  const [images, setImages] = useState([]);
  const [strictSource, setStrictSource] = useState(false);
  const hasMaterial = source.trim().length > 0 || images.length > 0;

  // let the nav badge the Create tab while cards are sitting unsaved
  useEffect(() => {
    if (onPending) onPending(drafts ? drafts.filter(d => d.keep).length : 0);
  }, [drafts, onPending]);

  /* "Make cards from what's missing" hands the gaps over as material and lands
     HERE rather than saving a deck behind the student's back — the drafts
     screen is where cards get looked at before they are kept, and a deck built
     from a diagnosis has no more right to skip that than one built from notes.
     Strict source mode is on: the gap list already says exactly what is
     missing, so there is nothing for the model to helpfully add.
     Consumed once; the parent clears it. */
  useEffect(() => {
    if (!seed) return;
    setMode('generate');
    setSource(seed.source || '');
    if (seed.level) setLevel(seed.level);
    setDrafts(null); setErr(''); setImages([]); setStrictSource(true);
    if (onSeedUsed) onSeedUsed();
  }, [seed]);

  /* Takes a plain array so the hidden input and the drop target share one path. */
  const takeFiles = async (files) => {
    if (!files || !files.length) return;
    setErr('');
    let added = '';
    const gotImages = [];
    for (const f of files){
      setAttaching(`Reading ${f.name}…`);
      try {
        const { text, images: imgs } = await extractFile(f);
        if (text) added += (added ? '\n\n' : '') + `# ${f.name}\n${text}`;
        if (imgs && imgs.length) gotImages.push(...imgs);
        if (!text && (!imgs || !imgs.length)) setErr(`Nothing readable in ${f.name}.`);
      } catch (er){ setErr(er.message || `Could not read ${f.name}.`); }
    }
    setAttaching('');
    if (added) setSource(s => s ? s + '\n\n' + added : added);
    if (gotImages.length) setImages(prev => [...prev, ...gotImages]);
  };

  const run = async () => {
    const lvl = level.trim() || 'NCEA Level 1';
    if (mode === 'manual'){
      const cards = parseManual(source);
      if (!cards.length){ setErr('Use “question | answer”, one per line.'); return; }
      setMeta({ subject: guessSubject(source), topic: guessTopic(source), standard: lvl });
      setDrafts(cards.map(c => ({ ...c, keep: true })));
      return;
    }
    if (!source.trim() && !images.length){ setErr('Paste notes, type a topic, or attach a PDF, Word, PowerPoint or text file first.'); return; }

    setBusy(true); setErr(''); setProg(null); setShortfall('');
    lastApiError = ''; genLost = 0;
    try {
      const model = pickModel(cardType, settings);
      let cards = [];
      const pctLong = longMixOf(settings);
      const strict = strictSource;
      if (source.trim()) cards = cards.concat(await genText(source, cardType, lvl, (i, n, phase) => setProg({ i, n, phase }), model, pctLong, strict));
      if (images.length){
        setProg({ i: 0, n: 0, phase: 'prep' });
        const shrunk = [];
        for (const b of images.slice(0, 12)){ try { shrunk.push(await resizeImage(b)); } catch {} }
        if (shrunk.length){
          // read each image into study text, then make cards from that text
          const imgText = await transcribeImages(shrunk, (i, n) => setProg({ i, n, phase: 'images' }));
          if (imgText.trim()) cards = cards.concat(await genText(imgText, cardType, lvl, (i, n, phase) => setProg({ i, n, phase }), model, pctLong, strict));
          else if (!cards.length){ setErr('Could not read those images. Try a clearer photo.'); setBusy(false); setProg(null); return; }
        } else if (!cards.length){ setErr('Could not read those images. Try a clearer photo.'); setBusy(false); setProg(null); return; }
      }
      cards = dedupeCards(cards);
      if (!cards.length){
        /* The likelier failure than a throw: genChunk swallows its own errors
           after retrying and leaves the reason in lastApiError, so a rate-limited
           run lands HERE with an empty stack rather than in the catch. Counting
           only the catch would have hidden exactly the thing worth watching on
           launch day. */
        track('generate_failed', { reason: lastApiError ? failureKind({ message: lastApiError }) : 'empty' });
        /* Working mode is told to return nothing rather than invent a
           calculation, so an empty stack there is usually the model obeying
           that instruction on descriptive notes — not a failure. Saying so
           beats sending them off to find "clearer notes" that do not exist. */
        setErr(lastApiError ? friendlyApiError({ message: lastApiError })
          : cardType === 'worked'
            ? 'No problems to solve in this material. Working needs something to calculate — a formula, a quantity, a procedure. Try Mixed instead.'
            : 'Nothing came back. Try clearer notes, a narrower topic, or a sharper photo.');
        setBusy(false); return;
      }
      // Some material made cards and some didn't — say so, rather than handing
      // over a short stack that looks like everything the notes had in them.
      if (genLost > 0){
        setShortfall('Your connection dropped ' + genLost + (genLost === 1 ? ' section' : ' sections')
          + ' of the material, so this is a shorter set than usual. Save these, then generate again from the parts that are missing.');
      }
      setMeta({ subject: guessSubject(source), topic: guessTopic(source), standard: lvl });
      setDrafts(cards.map(c => ({ ...c, keep: true })));
      /* Generated, not yet saved — the gap between this and deck_created is the
         number that says whether the cards coming back are any good. */
      track('cards_generated', { cards: cards.length, images: images.length,
        lost: genLost, mode: String(cardType) });
    } catch (e){
      track('generate_failed', { reason: failureKind(e) });
      setErr('Generation failed. Check your connection and try again.');
    }
    finally { setBusy(false); setProg(null); }
  };

  if (drafts){
    return <DraftReview drafts={drafts} setDrafts={setDrafts} meta={meta} setMeta={setMeta} shortfall={shortfall}
      onCancel={() => { setDrafts(null); setShortfall(''); }}
      onSave={() => { onSave(drafts.filter(d => d.keep), meta); setDrafts(null); setShortfall(''); setSource(''); setImages([]); }} />;
  }

  const progText = !prog ? 'Working…'
    : prog.phase === 'prep' ? 'Preparing images…'
    : prog.n > 0 ? `${prog.phase === 'images' ? 'Reading images' : 'Reading notes'} · ${prog.i} of ${prog.n}`
    : 'Working…';

  return (
    <div>
      <Title style={{ marginBottom: 14 }}>Make cards</Title>

      <Segmented value={mode} onChange={setMode}
        options={[{ v: 'generate', label: 'Generate' }, { v: 'manual', label: 'Type them' }]} />

      {mode === 'generate' && (
        <div style={{ marginTop: 10 }} data-tour="create-type">
          <Segmented value={cardType} onChange={setCardType}
            options={[{ v: 'mix', label: 'Mixed' }, { v: 'extended', label: 'Long' }, { v: 'worked', label: 'Working' }, { v: 'flip', label: 'Quick' }]} />
        </div>
      )}

      {mode === 'generate' && cardType === 'mix' && (
        <Card style={{ padding: 15, marginTop: 10, boxShadow: SH.raised }}>
          <MixSlider value={longMixOf(settings)} onChange={(v) => onSettings({ ...settings, longMix: v })} compact />
        </Card>
      )}

      {mode === 'generate' && (
        <div style={{ marginTop: 10 }}>
          <Tip id="create-time" settings={settings} onSettings={onSettings} icon="clock">
            Generating can take 15–30 seconds while the AI writes each card. Nothing saves until you've looked them over.
          </Tip>
        </div>
      )}

      {mode === 'generate' && (
        <div data-tour="create-upload">
          <DropZone onPicked={takeFiles} attaching={attaching} imageCount={images.length} />
        </div>
      )}

      {mode === 'generate' && (
        <Card style={{ padding: '13px 15px', marginTop: 10, boxShadow: SH.raised }}>
          <div className="flex items-center justify-between" style={{ gap: 12 }}>
            <div style={{ paddingRight: 6 }}>
              <div style={{ fontFamily: SANS, fontSize: 14, fontWeight: 700, color: T.ink }}>Only my material</div>
              <Sub style={{ fontSize: 12.5, marginTop: 2 }}>Sticks to what you paste or upload — nothing extra gets added.</Sub>
            </div>
            <Toggle on={strictSource} onClick={() => setStrictSource(v => !v)} />
          </div>
          {strictSource && !hasMaterial && (
            <Sub style={{ fontSize: 12, marginTop: 9, color: T.amber, fontWeight: 600 }}>
              Add some notes or a file for this — a bare topic has nothing to pull from.
            </Sub>
          )}
        </Card>
      )}

      <textarea value={source} onChange={e => setSource(e.target.value)} data-tour="create-source"
        placeholder={mode === 'manual' ? 'question | answer\nquestion | answer' : 'Paste your notes, or just type a topic like “rates of reaction”…'}
        rows={7}
        style={{ ...INPUT, marginTop: 14, fontSize: 15, resize: 'vertical' }} />

      {mode === 'generate' && (
        <div style={{ marginTop: 14 }} data-tour="create-level">
          <div style={{ fontFamily: SANS, fontSize: 14, fontWeight: 700, color: T.ink }}>Pitch the questions at</div>
          {/* Naming the standard is worth encouraging: the marker is forbidden
              from recalling standards itself (its memory of NCEA is out of
              date), but it will happily use one the student supplies. */}
          <Sub style={{ marginTop: 2, fontSize: 12.5 }}>Sets how hard they are and what the marking expects. Pick <b>Something else…</b> to name your actual standard, like "NCEA Level 1 AS92022 genetic variation".</Sub>
          <div style={{ position: 'relative', marginTop: 8 }}>
            <select value={LEVEL_PRESETS.includes(level) ? level : '__other'}
              onChange={e => setLevel(e.target.value === '__other' ? '' : e.target.value)}
              style={{ ...INPUT, paddingRight: 38, fontWeight: 500, appearance: 'none', WebkitAppearance: 'none' }}>
              {LEVEL_PRESETS.map(p => <option key={p} value={p}>{p}</option>)}
              <option value="__other">Something else…</option>
            </select>
            <span style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)',
              color: T.faint, pointerEvents: 'none', display: 'flex' }}><Ico name="chevron" size={15} /></span>
          </div>
          {!LEVEL_PRESETS.includes(level) && (
            <input value={level} onChange={e => setLevel(e.target.value)} autoFocus
              placeholder="e.g. IB Diploma, Year 12 Physics"
              style={{ ...INPUT, marginTop: 8, fontSize: 15 }} />
          )}
        </div>
      )}

      {err && (
        <div style={{ marginTop: 14, padding: '12px 14px', borderRadius: R.well, background: rgba(T.red, 0.09) }}>
          <Sub style={{ color: T.red, fontWeight: 500 }}>{err}</Sub>
        </div>
      )}
      {busy && (
        <Card style={{ marginTop: 14, padding: '10px 8px', boxShadow: SH.raised }}>
          <Loading title={progText} subtitle="Writing questions, answers and the marking for each one." />
        </Card>
      )}

      <div style={{ marginTop: 16 }} data-tour="create-go">
        <Btn full kind="primary" onClick={run} disabled={busy}>
          {busy ? (mode === 'manual' ? 'Reading…' : 'Generating…') : (mode === 'manual' ? 'Read cards' : 'Generate cards')}
        </Btn>
        {/* Said at the point the upload actually happens, not buried in a policy
            page. "Your decks stay on your device" is true of storage and was the
            only thing being said — which left students to assume nothing left
            the device at all, while their teacher's slides were being posted to
            a third party to be read. */}
        {mode !== 'manual' && (
          <Sub style={{ fontSize: 12, marginTop: 10, textAlign: 'center', lineHeight: 1.5 }}>
            What you paste or upload is sent to an AI provider (NVIDIA) to write the cards.
            Your decks are saved on this device.
          </Sub>
        )}
        {/* Only while the box is empty. Once there is material to work with,
            offering a pre-made deck is just noise in front of the button they
            came here to press. */}
        {!hasMaterial && onStarter && (
          <div style={{ marginTop: 14, textAlign: 'center' }}>
            <button onClick={onStarter} className="sf-tap"
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px 6px',
                fontFamily: SANS, fontSize: 13.5, fontWeight: 600, color: T.accentInk }}>
              Nothing to paste? Take a ready-made deck →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function guessSubject(text){
  const t = text.toLowerCase();
  const map = [['biolog','Biology'],['chemis','Chemistry'],['physic','Physics'],['math','Maths'],['algebra','Maths'],
    ['essay','English'],['shakes','English'],['histor','History'],['geograph','Geography'],['econom','Economics']];
  for (const [k, v] of map) if (t.includes(k)) return v;
  return '';
}
function guessTopic(text){
  const lines = text.trim().split('\n').filter(l => l.trim() && !/^#\s/.test(l));
  const first = (lines[0] || '').slice(0, 40);
  return first.replace(/[|:.].*$/, '').trim();
}

function draftPreview(d){
  if (d.type === 'extended') return { tag: `${d.verb} · ${d.marks} marks`, main: d.prompt, sub: d.achieved };
  if (d.type === 'worked') return { tag: `Working · ${d.marks} marks`, main: d.prompt, sub: 'Answer: ' + d.answer };
  if (d.type === 'mcq') return { tag: 'Multiple choice', main: d.front, sub: d.options[d.answer] || '' };
  if (d.type === 'short') return { tag: 'Short answer', main: d.front, sub: d.back };
  if (d.type === 'cloze') return { tag: 'Fill the blank', main: d.front, sub: d.back };
  if (d.type === 'typed') return { tag: 'Type the answer', main: d.front, sub: d.back };
  return { tag: 'Flip', main: d.front, sub: d.back };
}

function DraftReview({ drafts, setDrafts, meta, setMeta, onSave, onCancel, shortfall }){
  const kept = drafts.filter(d => d.keep).length;
  const toggle = (id) => setDrafts(drafts.map(d => d.id === id ? { ...d, keep: !d.keep } : d));
  const colour = subjectColour(meta.subject);

  return (
    <div>
      <div className="flex items-center justify-between" style={{ marginBottom: 14 }}>
        <Title>Check them over</Title>
        <button className="sf-tap" onClick={onCancel}
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: SANS, fontSize: 14, fontWeight: 600, color: T.red }}>
          Discard
        </button>
      </div>
      <div style={{ background: rgba(T.amber, 0.13), borderRadius: R.well, padding: '11px 14px', marginBottom: 14 }}>
        <Sub style={{ color: '#8A5A00', fontWeight: 600, fontSize: 13, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <InlineIco name="warn" size={14} style={{ marginTop: 2 }} />
          <span>Not saved yet — tap <b>Save</b> at the bottom or these are lost.</span>
        </Sub>
      </div>
      {shortfall && (
        <div style={{ background: rgba(T.accent, 0.11), borderRadius: R.well, padding: '11px 14px', marginBottom: 14 }}>
          <Sub style={{ color: T.accentInk, fontWeight: 600, fontSize: 13, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <InlineIco name="warn" size={14} style={{ marginTop: 2 }} />
            <span>{shortfall}</span>
          </Sub>
        </div>
      )}
      <Sub style={{ marginBottom: 14 }}>Tap a card to drop it. {kept} of {drafts.length} kept.</Sub>

      <Card style={{ padding: 14, marginBottom: 14, boxShadow: SH.raised }}>
        <div className="grid grid-cols-3 gap-2">
          {['subject','topic','standard'].map(k => (
            <div key={k}>
              <div style={{ fontFamily: SANS, fontSize: 12, fontWeight: 700, color: T.muted, textTransform: 'capitalize', marginBottom: 5 }}>{k}</div>
              <input value={meta[k]} onChange={e => setMeta({ ...meta, [k]: e.target.value })}
                style={{ ...INPUT, padding: '9px 10px', fontSize: 13 }} />
            </div>
          ))}
        </div>
      </Card>

      <div className="sf-grid2" style={{ marginBottom: 16 }}>
        {drafts.map(d => {
          const p = draftPreview(d);
          return (
            <button key={d.id} className="sf-tap" onClick={() => toggle(d.id)}
              style={{ textAlign: 'left', background: T.surface, border: `1.5px solid ${d.keep ? T.border : 'transparent'}`,
                borderRadius: R.card, padding: 14, opacity: d.keep ? 1 : 0.42, cursor: 'pointer',
                boxShadow: d.keep ? SH.raised : 'none' }}>
              <div className="flex items-center justify-between" style={{ marginBottom: 7 }}>
                <Chip colour={colour}>{p.tag}</Chip>
                {!d.keep && <Chip colour={T.red}>removed</Chip>}
              </div>
              <div style={{ fontFamily: SANS, fontSize: 15.5, fontWeight: 600, color: T.ink, lineHeight: 1.4 }}>{p.main}</div>
              {p.sub && <Sub style={{ marginTop: 5, fontSize: 13.5 }}>{p.sub}</Sub>}
            </button>
          );
        })}
      </div>

      <Btn full kind="primary" onClick={onSave} disabled={!kept}>Save {kept} cards</Btn>
    </div>
  );
}

/* ==========================================================================
   DECKS
   ========================================================================== */
function Decks({ decks, progress, onEditCard, onDeleteCard, onDeleteDeck, onRenameDeck, onStudyDeck, onQuiz, onLearn, onStarter }){
  const [openId, setOpenId] = useState(null);
  const open = decks.find(d => d.id === openId);

  if (open){
    return <DeckEditor deck={open} progress={progress} onBack={() => setOpenId(null)}
      onEditCard={onEditCard} onDeleteCard={onDeleteCard} onRenameDeck={onRenameDeck}
      onStudyDeck={onStudyDeck} onQuiz={onQuiz} onLearn={onLearn}
      onDeleteDeck={() => { onDeleteDeck(open.id); setOpenId(null); }} />;
  }

  if (!decks.length){
    return (
      <Card style={{ padding: '44px 24px', textAlign: 'center' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14, color: T.faint }}><Ico name="books" size={38} weight={1.5} /></div>
        <Title>No decks yet</Title>
        <Sub style={{ marginTop: 6, marginBottom: 18 }}>Make some cards and they'll show up here.</Sub>
        <Btn kind="soft" onClick={onStarter}>Try a ready-made deck</Btn>
      </Card>
    );
  }

  return (
    <div>
      <Title style={{ marginBottom: 14 }}>Your decks</Title>
      <div className="sf-grid2">
        {decks.map(d => {
          const colour = subjectColour(d.subject);
          const dueN = d.cards.filter(c => { const p = progress[c.id]; return p && p.seen && p.due <= TODAY(); }).length;
          const flagN = d.cards.filter(c => { const p = progress[c.id]; return p && p.flagged; }).length;
          return (
            <button key={d.id} className="sf-tap" onClick={() => setOpenId(d.id)}
              style={{ display: 'flex', gap: 13, alignItems: 'center', textAlign: 'left', background: T.surface,
                border: `1px solid ${T.border}`, borderRadius: R.card, padding: 14, cursor: 'pointer', boxShadow: SH.raised }}>
              <Tile colour={colour} glyph={(d.subject || '?').trim().charAt(0).toUpperCase()} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: SANS, fontSize: 15.5, fontWeight: 700, color: T.ink,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.topic || d.subject || 'Untitled'}</div>
                <Sub style={{ fontSize: 13 }}>{d.cards.length} cards · {d.subject || 'Untitled'}</Sub>
              </div>
              <div className="flex flex-col items-end gap-1">
                {dueN > 0 && <Chip colour={T.red}>{dueN} due</Chip>}
                {flagN > 0 && <Chip colour={T.amber}>{flagN} tricky</Chip>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DeckEditor({ deck, progress, onBack, onEditCard, onDeleteCard, onDeleteDeck, onRenameDeck, onStudyDeck, onQuiz, onLearn }){
  const [confirmDeck, setConfirmDeck] = useState(false);
  const [editId, setEditId] = useState(null);
  const [renaming, setRenaming] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [withProgress, setWithProgress] = useState(false);
  const [shared, setShared] = useState('');
  const [shareBad, setShareBad] = useState(false);
  const [draftMeta, setDraftMeta] = useState({ subject: deck.subject, topic: deck.topic, standard: deck.standard });
  const colour = subjectColour(deck.subject);

  /* One deck on its own — a backup of just this topic, or something to hand a
     friend. Your review schedule is left OUT by default (nobody wants to
     inherit someone else's due dates) but a backup of your own can keep it. */
  const say = (m, bad) => { setShared(m); setShareBad(!!bad); setTimeout(() => setShared(''), 6000); };
  const exportDeck = (mode) => {
    const payload = buildExport([deck], withProgress ? progress : {});
    if (mode === 'file'){
      const ok = downloadJson(payload, exportName([deck]));
      say(ok ? 'Downloaded — that file holds this deck only.' : 'Download blocked here — use Copy instead.', !ok);
    } else {
      copyText(JSON.stringify(payload)).then(ok =>
        say(ok ? 'Copied — paste it under You → Import.' : 'Could not copy. Try the file instead.', !ok));
    }
  };

  const startRename = () => {
    setDraftMeta({ subject: deck.subject, topic: deck.topic, standard: deck.standard });
    setRenaming(true);
  };
  const saveRename = () => {
    onRenameDeck(deck.id, {
      subject: (draftMeta.subject || 'Untitled').trim(),
      topic: (draftMeta.topic || '').trim(),
      standard: (draftMeta.standard || 'NCEA Level 1').trim(),
    });
    setRenaming(false);
  };

  return (
    <div>
      <div className="flex items-center gap-3" style={{ marginBottom: 16 }}>
        <button className="sf-tap" onClick={onBack}
          style={{ width: 38, height: 38, borderRadius: R.pill, background: T.surface, border: `1px solid ${T.border}`,
            cursor: 'pointer', fontSize: 17, color: T.ink, boxShadow: SH.raised, flexShrink: 0 }}>‹</button>
        <div style={{ minWidth: 0, flex: 1 }}>
          <Title style={{ fontSize: 18, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{deck.topic || 'Deck'}</Title>
          <Sub style={{ fontSize: 13 }}>{deck.subject} · {deck.cards.length} cards</Sub>
        </div>
        {!renaming && (
          <div className="flex gap-2" style={{ flexShrink: 0 }}>
            <Btn kind="soft" onClick={startRename} style={{ fontSize: 13, padding: '9px 14px' }}>Rename</Btn>
            <Btn kind={exporting ? 'primary' : 'soft'} onClick={() => setExporting(v => !v)}
              style={{ fontSize: 13, padding: '9px 14px' }}>Export</Btn>
          </div>
        )}
      </div>

      {exporting && !renaming && (
        <Card style={{ padding: 15, marginBottom: 14, boxShadow: SH.raised }}>
          <div style={{ fontFamily: SANS, fontSize: 15, fontWeight: 700, color: T.ink }}>Export just this deck</div>
          <Sub style={{ fontSize: 12.5, marginTop: 2, marginBottom: 12 }}>
            {deck.cards.length} card{deck.cards.length === 1 ? '' : 's'} from <b>{deck.topic || deck.subject || 'this deck'}</b> — none of your other decks.
          </Sub>
          <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
            <div style={{ paddingRight: 12 }}>
              <div style={{ fontFamily: SANS, fontSize: 13.5, fontWeight: 600, color: T.ink }}>Include my review progress</div>
              <Sub style={{ fontSize: 12 }}>Leave off when sending it to someone else</Sub>
            </div>
            <Toggle on={withProgress} onClick={() => setWithProgress(v => !v)} />
          </div>
          <div className="flex gap-2">
            <Btn full kind="soft" onClick={() => exportDeck('copy')} style={{ fontSize: 14 }}>Copy as text</Btn>
            <Btn full kind="soft" onClick={() => exportDeck('file')} style={{ fontSize: 14 }}>Download file</Btn>
          </div>
        </Card>
      )}
      {shared && <Sub style={{ color: shareBad ? T.red : T.green, fontWeight: 600, marginBottom: 12 }}>{shared}</Sub>}

      {!renaming && (onStudyDeck || onQuiz || onLearn) && (
        <div className="flex gap-2" style={{ marginBottom: 16, flexWrap: 'wrap' }}>
          {onStudyDeck && <Btn full kind="primary" onClick={() => onStudyDeck(deck.id)}>Study this deck</Btn>}
          {onLearn && <Btn full kind="soft" onClick={() => onLearn(deck.id)} style={{ maxWidth: onStudyDeck ? 130 : undefined }}>
            <span className="flex items-center justify-center gap-2"><Ico name="puzzle" size={15} />Learn</span>
          </Btn>}
          {onQuiz && <Btn full kind="soft" onClick={() => onQuiz(deck.id)} style={{ maxWidth: onStudyDeck ? 130 : undefined }}>
            <span className="flex items-center justify-center gap-2"><Ico name="target" size={15} />Quiz</span>
          </Btn>}
        </div>
      )}

      {renaming && (
        <Card style={{ padding: 15, marginBottom: 14, borderColor: T.accent, borderWidth: 1.5 }}>
          <div style={{ fontFamily: SANS, fontSize: 15, fontWeight: 700, color: T.ink, marginBottom: 3 }}>Rename this deck</div>
          <Sub style={{ fontSize: 12.5, marginBottom: 12 }}>Changing the subject also changes its colour.</Sub>
          {[['subject','Subject','e.g. Chemistry'],['topic','Topic','e.g. Rates of reaction'],['standard','Level','e.g. NCEA Level 1']].map(([k, label, ph]) => (
            <div key={k} style={{ marginBottom: 10 }}>
              <div style={{ fontFamily: SANS, fontSize: 12.5, fontWeight: 700, color: T.muted, marginBottom: 5 }}>{label}</div>
              <input value={draftMeta[k] || ''} placeholder={ph}
                onChange={e => setDraftMeta({ ...draftMeta, [k]: e.target.value })}
                style={{ ...INPUT, fontSize: 14.5 }} />
            </div>
          ))}
          <div className="flex gap-2" style={{ marginTop: 4 }}>
            <Btn kind="primary" onClick={saveRename} style={{ fontSize: 14, padding: '11px 20px' }}>Save</Btn>
            <Btn kind="ghost" onClick={() => setRenaming(false)} style={{ fontSize: 14, padding: '11px 16px' }}>Cancel</Btn>
          </div>
        </Card>
      )}

      <div className="flex flex-col gap-2">
        {deck.cards.map(c => {
          const p = progress[c.id];
          const label = stateLabel(p);
          const tricky = label === 'Keeps tripping you up';
          if (editId === c.id){
            return <CardEditRow key={c.id} card={c}
              onSave={(patch) => { onEditCard(deck.id, c.id, patch); setEditId(null); }}
              onCancel={() => setEditId(null)} />;
          }
          const prev = draftPreview(c);
          return (
            <Card key={c.id} style={{ padding: 14, boxShadow: SH.raised }}>
              <div className="flex items-center justify-between" style={{ marginBottom: 7 }}>
                <Chip colour={colour}>{prev.tag}</Chip>
                <Chip colour={tricky ? T.amber : T.faint}>{label}</Chip>
              </div>
              <div style={{ fontFamily: SANS, fontSize: 15, fontWeight: 600, color: T.ink, lineHeight: 1.4 }}>{prev.main}</div>
              <div className="flex gap-2" style={{ marginTop: 11 }}>
                <Btn kind="soft" onClick={() => setEditId(c.id)} style={{ fontSize: 13, padding: '8px 16px' }}>Edit</Btn>
                <Btn kind="danger" onClick={() => onDeleteCard(deck.id, c.id)} style={{ fontSize: 13, padding: '8px 16px' }}>Delete</Btn>
              </div>
            </Card>
          );
        })}
      </div>

      <div style={{ marginTop: 22 }}>
        {!confirmDeck ? (
          <Btn full kind="danger" onClick={() => setConfirmDeck(true)}>Delete this deck</Btn>
        ) : (
          <div className="flex gap-2">
            <Btn full kind="danger" onClick={onDeleteDeck} style={{ background: T.red, color: '#fff' }}>
              Delete {deck.cards.length} cards
            </Btn>
            <Btn full kind="soft" onClick={() => setConfirmDeck(false)}>Keep</Btn>
          </div>
        )}
      </div>
    </div>
  );
}

const fieldVal = (v) => (v === null || v === undefined) ? '' : v;

function CardEditRow({ card, onSave, onCancel }){
  const [f, setF] = useState(() => card.type === 'mcq'
    ? { ...card, _opts: (card.options || []).join('\n'), answer: String(card.answer == null ? 0 : card.answer) }
    : card.type === 'worked'
    ? { ...card, _steps: (card.steps || []).join('\n') }
    : card.type === 'typed'
    ? { ...card, _accept: (card.accept || []).join(', ') }
    : { ...card });
  const field = (k, label, area) => (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontFamily: SANS, fontSize: 12.5, fontWeight: 700, color: T.muted, marginBottom: 5 }}>{label}</div>
      {area ? <textarea value={fieldVal(f[k])} onChange={e => setF({ ...f, [k]: e.target.value })} rows={2} style={{ ...INPUT, fontSize: 14.5, resize: 'vertical' }} />
            : <input value={fieldVal(f[k])} onChange={e => setF({ ...f, [k]: e.target.value })} style={{ ...INPUT, fontSize: 14.5 }} />}
    </div>
  );

  const doSave = () => {
    if (f.type === 'mcq'){
      const options = (f._opts || '').split('\n').map(s => s.trim()).filter(Boolean);
      let answer = Number(f.answer);
      if (!(answer >= 0 && answer < options.length)) answer = 0;
      const { _opts, ...rest } = f;
      onSave({ ...rest, options, answer });
    } else if (f.type === 'worked'){
      /* Same shape as the multi-choice options: one per line in a textarea,
         because the steps ARE an ordered list and editing them as prose would
         lose the order the marker walks. */
      const steps = (f._steps || '').split('\n').map(s => s.trim()).filter(Boolean).slice(0, 8);
      const { _steps, ...rest } = f;
      onSave({ ...rest, steps });
    } else if (f.type === 'typed'){
      const accept = (f._accept || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 4);
      const { _accept, ...rest } = f;
      onSave({ ...rest, accept });
    } else onSave(f);
  };

  return (
    <Card style={{ padding: 16, borderColor: T.accent, borderWidth: 1.5 }}>
      {f.type === 'extended' ? (
        <>
          {field('verb', 'Command verb')}{field('prompt', 'Question', true)}
          {field('achieved', 'Achieved', true)}{field('merit', 'Merit', true)}{field('excellence', 'Excellence', true)}
          {field('skeleton', 'Structure')}{field('pitfall', 'What loses marks', true)}
        </>
      ) : f.type === 'worked' ? (
        <>
          {field('prompt', 'The problem', true)}
          {field('_steps', 'Method — one step per line', true)}
          {field('answer', 'Final answer (with unit)')}
          {field('marks', 'Marks')}
          {field('pitfall', 'What loses marks', true)}
        </>
      ) : f.type === 'mcq' ? (
        <>
          {field('front', 'Question', true)}
          {field('_opts', 'Options (one per line)', true)}
          {field('answer', 'Correct option number (0 = first)')}
          {field('why', 'Why', true)}
        </>
      ) : (
        <>
          {field('front', f.type === 'cloze' ? 'Sentence (use ____)' : 'Question', true)}
          {field('back', f.type === 'short' ? 'Model answer' : 'Answer', true)}
          {/* Only typed cards are checked automatically, so only they need a
              list of other wordings that count. It belongs in the editor
              because the moment you want it is the moment the checker has
              just rejected an answer you know was right. */}
          {f.type === 'typed' && field('_accept', 'Also accept (comma separated)')}
        </>
      )}
      {/* Every type gets one, including the long answers and the multi-choice
          ones that have no `back` to edit — the note is about how YOU remember
          the card, not about what kind of card it is. */}
      {field('note', 'Your note (only you see this)', true)}
      <div className="flex gap-2" style={{ marginTop: 6 }}>
        <Btn kind="primary" onClick={doSave} style={{ fontSize: 14, padding: '11px 20px' }}>Save</Btn>
        <Btn kind="ghost" onClick={onCancel} style={{ fontSize: 14, padding: '11px 16px' }}>Cancel</Btn>
      </div>
    </Card>
  );
}

/* ==========================================================================
   STATS  —  kept light on purpose. No badges, no notifications.
   ========================================================================== */
function Stats({ decks, progress, stats }){
  const today = TODAY();
  const dueTotal = useMemo(() => {
    let n = 0;
    for (const d of decks) for (const c of d.cards){ const p = progress[c.id]; if (p && p.seen && p.due <= today) n++; }
    return n;
  }, [decks, progress]);
  const totalCards = decks.reduce((s, d) => s + d.cards.length, 0);
  const reviewedToday = (stats.reviewsByDate && stats.reviewsByDate[today]) || 0;
  const practiceToday = (stats.practiceByDate && stats.practiceByDate[today]) || 0;

  const subjects = {};
  for (const d of decks){
    const s = d.subject || 'Untitled';
    if (!subjects[s]) subjects[s] = { total: 0, mastered: 0 };
    for (const c of d.cards){
      subjects[s].total++;
      const p = progress[c.id];
      if (p && p.seen && !p.flagged && p.interval >= 6 && p.due > today) subjects[s].mastered++;
    }
  }

  return (
    <div>
      <Title style={{ marginBottom: 14 }}>Today</Title>
      <div className="grid grid-cols-3 gap-2">
        <Stat n={stats.streak || 0} k="day streak" colour={T.amber} />
        <Stat n={reviewedToday} k="reviewed" colour={T.green} />
        <Stat n={dueTotal} k="still due" colour={dueTotal > 0 ? T.red : T.faint} />
      </div>
      <Sub style={{ marginTop: 10, fontSize: 12.5 }}>
        {practiceToday > 0 ? `Plus ${practiceToday} extra practice (doesn't affect your schedule).` : 'Reviewed counts scheduled revision only.'}
      </Sub>

      <Title style={{ margin: '26px 0 12px' }}>How well you know it</Title>
      <div className="sf-grid2">
        {Object.keys(subjects).length === 0 && <Sub>No cards yet.</Sub>}
        {Object.entries(subjects).map(([s, v]) => {
          const pct = v.total ? Math.round((v.mastered / v.total) * 100) : 0;
          const c = subjectColour(s);
          return (
            <Card key={s} style={{ padding: 14, boxShadow: SH.raised }}>
              <div className="flex items-center gap-3" style={{ marginBottom: 10 }}>
                <Tile colour={c} glyph={s.trim().charAt(0).toUpperCase()} size={32} />
                <div style={{ flex: 1, fontFamily: SANS, fontSize: 15, fontWeight: 700, color: T.ink }}>{s}</div>
                <div style={{ fontFamily: SANS, fontSize: 15, fontWeight: 700, color: c }}>{pct}%</div>
              </div>
              <div style={{ height: 8, background: T.well, borderRadius: R.pill, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${pct}%`, background: c, borderRadius: R.pill, transition: 'width 400ms' }} />
              </div>
            </Card>
          );
        })}
      </div>
      <Sub style={{ marginTop: 18, textAlign: 'center' }}>{totalCards} cards across {decks.length} decks</Sub>
    </div>
  );
}
function Stat({ n, k, colour }){
  return (
    <Card style={{ padding: '16px 8px 13px', textAlign: 'center', boxShadow: SH.raised }}>
      <div style={{ fontFamily: SANS, fontSize: 30, fontWeight: 800, lineHeight: 1, color: colour, letterSpacing: '-0.03em' }}>{n}</div>
      <div style={{ fontFamily: SANS, fontSize: 12, fontWeight: 600, color: T.faint, marginTop: 7 }}>{k}</div>
    </Card>
  );
}

/* ==========================================================================
   SETTINGS
   ========================================================================== */
function Toggle({ on, onClick }){
  return (
    <button className="sf-tap" onClick={onClick}
      style={{ width: 50, height: 30, borderRadius: R.pill, border: 'none', flexShrink: 0, cursor: 'pointer',
        background: on ? T.green : 'var(--sf-track)', position: 'relative', transition: 'background 200ms' }}>
      <span style={{ position: 'absolute', top: 3, left: on ? 23 : 3, width: 24, height: 24, borderRadius: R.pill,
        background: '#fff', boxShadow: SH.pop, transition: 'left 200ms cubic-bezier(.2,.8,.3,1)' }} />
    </button>
  );
}

function SettingRow({ title, note, children }){
  return (
    <Card style={{ padding: 15, marginBottom: 10, boxShadow: SH.raised }}>
      <div className="flex items-center justify-between">
        <div style={{ paddingRight: 12 }}>
          <div style={{ fontFamily: SANS, fontSize: 15, fontWeight: 700, color: T.ink }}>{title}</div>
          <Sub style={{ fontSize: 12.5, marginTop: 2 }}>{note}</Sub>
        </div>
        {children}
      </div>
    </Card>
  );
}

function TransferCard({ library, progress, onImport }){
  const [pasting, setPasting] = useState(false);
  const [text, setText] = useState('');
  const [msg, setMsg] = useState('');
  const [bad, setBad] = useState(false);
  const [picking, setPicking] = useState(false);   // false = whole library
  const [picked, setPicked] = useState([]);        // deck ids, only while picking
  const fileRef = useRef(null);

  const say = (m, isBad) => { setMsg(m); setBad(!!isBad); };

  /* Exporting everything is the right default for a backup, but a deck is the
     unit you actually hand around — so you can narrow it to the ones you mean. */
  const chosen = picking ? library.decks.filter(d => picked.indexOf(d.id) >= 0) : library.decks;
  const chosenCards = chosen.reduce((s, d) => s + d.cards.length, 0);
  const startPicking = () => { setPicked(library.decks.map(d => d.id)); setPicking(true); };
  const togglePick = (id) => setPicked(p => p.indexOf(id) >= 0 ? p.filter(x => x !== id) : p.concat([id]));

  const doExport = (mode) => {
    if (!library.decks.length) return say('Nothing to export yet.', true);
    if (!chosen.length) return say('Pick at least one deck.', true);
    const payload = buildExport(chosen, progress);
    if (mode === 'file'){
      const ok = downloadJson(payload, exportName(chosen));
      say(ok ? 'Downloaded.' : 'Download blocked here — use Copy instead.', !ok);
    } else {
      copyText(JSON.stringify(payload)).then(ok =>
        say(ok ? 'Copied — paste it into the other version.' : 'Could not copy. Try the file instead.', !ok));
    }
  };

  const applyImport = (raw) => {
    try {
      const res = mergeImport(JSON.parse(raw), library, progress);
      onImport(res);
      say(`Added ${res.deckCount} deck${res.deckCount > 1 ? 's' : ''} · ${res.cardCount} cards.`);
      setText(''); setPasting(false);
    } catch (e){ say(e.message || 'That did not look like an export.', true); }
  };

  const onFile = async (e) => {
    const f = (e.target.files || [])[0];
    if (e.target) e.target.value = '';
    if (!f) return;
    try { applyImport(await f.text()); } catch { say('Could not read that file.', true); }
  };

  return (
    <Card style={{ padding: 15, marginBottom: 10, boxShadow: SH.raised }}>
      <div style={{ fontFamily: SANS, fontSize: 15, fontWeight: 700, color: T.ink }}>Backup &amp; transfer</div>
      <Sub style={{ fontSize: 12.5, marginTop: 2, marginBottom: 12 }}>
        Move decks between the app and the website, or to a friend — without paying to generate them twice.
      </Sub>

      <div className="flex items-center justify-between" style={{ marginBottom: 7 }}>
        <Sub style={{ fontSize: 12.5, fontWeight: 700, color: T.ink }}>
          Export {chosenCards > 0 ? `(${chosen.length} deck${chosen.length > 1 ? 's' : ''} · ${chosenCards} card${chosenCards > 1 ? 's' : ''})` : ''}
        </Sub>
        {library.decks.length > 1 && (
          <button className="sf-tap" onClick={() => picking ? setPicking(false) : startPicking()}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0,
              fontFamily: SANS, fontSize: 12.5, fontWeight: 700, color: T.accentInk }}>
            {picking ? 'Export all' : 'Choose decks'}
          </button>
        )}
      </div>

      {picking && (
        <div style={{ background: T.well, borderRadius: R.well, padding: 8, marginBottom: 10 }}>
          {library.decks.map(d => {
            const on = picked.indexOf(d.id) >= 0;
            return (
              <button key={d.id} className="sf-tap" onClick={() => togglePick(d.id)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
                  background: 'none', border: 'none', cursor: 'pointer', padding: '8px 6px' }}>
                <span style={{ width: 20, height: 20, borderRadius: 6, flexShrink: 0,
                  border: `1.5px solid ${on ? T.accent : T.border}`, background: on ? T.accent : T.surface,
                  color: '#fff', fontFamily: SANS, fontSize: 13, fontWeight: 800, lineHeight: '18px', textAlign: 'center' }}>
                  {on && <span style={{ display: 'flex', justifyContent: 'center' }}><Ico name="check" size={13} weight={3} /></span>}
                </span>
                <span style={{ flex: 1, minWidth: 0, fontFamily: SANS, fontSize: 14, fontWeight: 600, color: T.ink,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {d.topic || d.subject || 'Untitled'}
                </span>
                <Sub style={{ fontSize: 12, flexShrink: 0 }}>{d.cards.length}</Sub>
              </button>
            );
          })}
        </div>
      )}

      <div className="flex gap-2" style={{ marginBottom: 14 }}>
        <Btn full kind="soft" onClick={() => doExport('copy')} style={{ fontSize: 14 }}>Copy as text</Btn>
        <Btn full kind="soft" onClick={() => doExport('file')} style={{ fontSize: 14 }}>Download file</Btn>
      </div>

      <Sub style={{ fontSize: 12.5, fontWeight: 700, color: T.ink, marginBottom: 7 }}>Import</Sub>
      <input ref={fileRef} type="file" accept=".json,application/json,text/plain" onChange={onFile} style={{ display: 'none' }} />
      {!pasting ? (
        <div className="flex gap-2">
          <Btn full kind="soft" onClick={() => setPasting(true)} style={{ fontSize: 14 }}>Paste text</Btn>
          <Btn full kind="soft" onClick={() => fileRef.current && fileRef.current.click()} style={{ fontSize: 14 }}>Choose file</Btn>
        </div>
      ) : (
        <div>
          <textarea value={text} onChange={e => setText(e.target.value)} rows={4}
            placeholder="Paste the exported text here…"
            style={{ ...INPUT, fontSize: 13, resize: 'vertical' }} />
          <div className="flex gap-2" style={{ marginTop: 8 }}>
            <Btn kind="primary" onClick={() => applyImport(text)} disabled={!text.trim()} style={{ fontSize: 14, padding: '11px 20px' }}>Import</Btn>
            <Btn kind="ghost" onClick={() => { setPasting(false); setText(''); }} style={{ fontSize: 14, padding: '11px 16px' }}>Cancel</Btn>
          </div>
        </div>
      )}
      {msg && <Sub style={{ marginTop: 10, color: bad ? T.red : T.green, fontWeight: 600 }}>{msg}</Sub>}
      <Sub style={{ fontSize: 12, marginTop: 10 }}>Importing only adds — it never overwrites decks you already have.</Sub>
    </Card>
  );
}

function Settings({ settings, onChange, library, progress, onImport, onTutorial }){
  const set = (patch) => onChange({ ...settings, ...patch });
  return (
    <div>
      <Title style={{ marginBottom: 14 }}>Settings</Title>

      <Card style={{ padding: 15, marginBottom: 10, boxShadow: SH.raised }}>
        <div className="flex items-center justify-between gap-3" style={{ flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 190 }}>
            <div style={{ fontFamily: SANS, fontSize: 15, fontWeight: 700, color: T.ink }}>How this app works</div>
            <Sub style={{ fontSize: 12.5, marginTop: 2 }}>The tour from your first visit — pointers on the real screens, and a long-answer card to try.</Sub>
          </div>
          <Btn kind="soft" onClick={onTutorial} style={{ fontSize: 14, flexShrink: 0 }}>Show me again</Btn>
        </div>
      </Card>

      <Card style={{ padding: 15, marginBottom: 10, boxShadow: SH.raised }}>
        <div style={{ fontFamily: SANS, fontSize: 15, fontWeight: 700, color: T.ink, marginBottom: 10 }}>Appearance</div>
        <Segmented value={settings.theme || 'system'} onChange={(v) => set({ theme: v })}
          options={[{ v: 'light', label: 'Light' }, { v: 'dark', label: 'Dark' }, { v: 'system', label: 'System' }]} />
        <Sub style={{ fontSize: 12, marginTop: 8 }}>System follows your device's light or dark setting.</Sub>

        <div style={{ fontFamily: SANS, fontSize: 13, fontWeight: 700, color: T.muted, margin: '16px 0 8px' }}>Typeface</div>
        <Segmented value={fontOf(settings)} onChange={(v) => set({ font: v })}
          options={FONTS.map(f => ({ v: f.v, label: f.label }))} />
        <Sub style={{ fontSize: 12, marginTop: 8 }}>
          {(FONTS.find(f => f.v === fontOf(settings)) || FONTS[0]).note}
        </Sub>
      </Card>

      <Card style={{ padding: 15, marginBottom: 10, boxShadow: SH.raised }}>
        <div style={{ fontFamily: SANS, fontSize: 15, fontWeight: 700, color: T.ink }}>Your details</div>
        <Sub style={{ fontSize: 12.5, marginTop: 2, marginBottom: 12 }}>Used to greet you and count down to your exam on the Home screen.</Sub>
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontFamily: SANS, fontSize: 12.5, fontWeight: 700, color: T.muted, marginBottom: 5 }}>Name <span style={{ fontWeight: 500, color: T.faint }}>(optional)</span></div>
          <input value={settings.name || ''} onChange={e => set({ name: e.target.value })} placeholder="Your first name"
            style={{ ...INPUT, fontSize: 14.5 }} />
        </div>
        <div>
          <div style={{ fontFamily: SANS, fontSize: 12.5, fontWeight: 700, color: T.muted, marginBottom: 5 }}>Exam date <span style={{ fontWeight: 500, color: T.faint }}>(optional)</span></div>
          <input type="date" value={settings.examDate || ''} onChange={e => set({ examDate: e.target.value })}
            style={{ ...INPUT, fontSize: 14.5 }} />
        </div>
      </Card>

      <TransferCard library={library} progress={progress} onImport={onImport} />

      <Card style={{ padding: 15, marginBottom: 10, boxShadow: SH.raised }}>
        <div style={{ fontFamily: SANS, fontSize: 15, fontWeight: 700, color: T.ink }}>Answer length</div>
        <Sub style={{ fontSize: 12.5, marginTop: 2, marginBottom: 14 }}>
          Sets the balance of new cards you make, and how your feed is mixed.
        </Sub>
        <MixSlider value={longMixOf(settings)} onChange={(v) => set({ longMix: v })} />
      </Card>

      <SettingRow title="Sounds" note="A chime when you get one right, climbing as your streak builds">
        <Toggle on={settings.sound !== false} onClick={() => { const on = settings.sound === false; set({ sound: on }); if (on) play('right', 1); }} />
      </SettingRow>

      <SettingRow title="Mix subjects up" note="Rotates subjects so you don't do one topic in a block">
        <Toggle on={settings.interleave} onClick={() => set({ interleave: !settings.interleave })} />
      </SettingRow>

      <Card style={{ padding: 15, boxShadow: SH.raised }}>
        <div className="flex items-center justify-between">
          <div style={{ paddingRight: 12 }}>
            <div style={{ fontFamily: SANS, fontSize: 15, fontWeight: 700, color: T.ink }}>Limit new cards a day</div>
            <Sub style={{ fontSize: 12.5, marginTop: 2 }}>Off means every new card is ready straight away</Sub>
          </div>
          <Toggle on={settings.capNew} onClick={() => set({ capNew: !settings.capNew })} />
        </div>
        {settings.capNew && (
          <div className="flex items-center justify-center gap-4" style={{ marginTop: 14 }}>
            <Btn kind="soft" onClick={() => set({ newPerDay: Math.max(0, perDay(settings) - 2) })} style={{ padding: '10px 22px' }}>−</Btn>
            <div style={{ fontFamily: SANS, fontSize: 26, fontWeight: 800, color: T.ink, minWidth: 46, textAlign: 'center' }}>{perDay(settings)}</div>
            <Btn kind="soft" onClick={() => set({ newPerDay: perDay(settings) + 2 })} style={{ padding: '10px 22px' }}>+</Btn>
          </div>
        )}
      </Card>

      <Card style={{ padding: 15, marginTop: 10, boxShadow: SH.raised }}>
        <div style={{ fontFamily: SANS, fontSize: 15, fontWeight: 700, color: T.ink }}>About</div>
        <Sub style={{ fontSize: 12.5, marginTop: 2 }}>Study Feed · version {APP_VERSION}. See <b>Updates</b> for what's new.</Sub>
        <div className="flex items-center gap-2" style={{ marginTop: 12, flexWrap: 'wrap' }}>
          {SOCIAL.map(sc => (
            <a key={sc.k} href={sc.url} target="_blank" rel="me noopener noreferrer" className="sf-tap"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 7, textDecoration: 'none',
                background: T.well, border: `1px solid ${T.border}`, borderRadius: R.pill, padding: '8px 13px',
                fontFamily: SANS, fontSize: 13, fontWeight: 650, color: T.muted }}>
              {/* the TikTok mark is a fill, the Instagram one a stroke */}
              <Ico name={sc.k} size={15} weight={sc.k === 'tiktok' ? 0 : 1.9} fill={sc.k === 'tiktok'} />{sc.label}
            </a>
          ))}
        </div>
      </Card>
    </div>
  );
}

/* ==========================================================================
   APP
   ========================================================================== */
/* ==========================================================================
   HOME  —  the screen the app opens on. A calm overview that answers
   "what should I do now?" before dropping you into a card.
   ========================================================================== */
const WD = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
function greetWord(){
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}
function longDate(){
  try { return new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }); }
  catch { return TODAY(); }
}

function Home({ library, progress, stats, settings, due, onStart, onCreate, onDecks, onStudyDeck, onQuiz, onLearn, onDiagnose, onSettings, onTutorial, onStarter }){
  const [shareWeek, setShareWeek] = useState(false);
  const today = TODAY();
  const decks = library.decks;
  const totalCards = decks.reduce((s, d) => s + d.cards.length, 0);
  const reviewedToday = (stats.reviewsByDate && stats.reviewsByDate[today]) || 0;
  const streak = stats.streak || 0;
  const sessionPct = (reviewedToday + due) > 0 ? Math.round(reviewedToday / (reviewedToday + due) * 100) : (totalCards ? 100 : 0);

  const name = (settings.name || '').trim();
  const exam = (settings.examDate || '').trim();
  const daysToExam = exam ? Math.round((new Date(exam + 'T00:00:00') - new Date(today + 'T00:00:00')) / 86400000) : null;

  const deckRows = decks.map(d => {
    let dueN = 0, mastered = 0;
    for (const c of d.cards){
      const p = progress[c.id];
      if (p && p.seen && p.due <= today) dueN++;
      if (p && p.seen && !p.flagged && p.interval >= 6 && p.due > today) mastered++;
    }
    return { d, dueN, pct: d.cards.length ? Math.round(mastered / d.cards.length * 100) : 0 };
  }).sort((a, b) => b.dueN - a.dueN);

  let flagged = 0;
  for (const d of decks) for (const c of d.cards){ const p = progress[c.id]; if (p && p.flagged) flagged++; }

  const subs = {};
  for (const d of decks){
    const s = d.subject || 'Untitled';
    if (!subs[s]) subs[s] = { t: 0, m: 0 };
    for (const c of d.cards){ subs[s].t++; const p = progress[c.id]; if (p && p.seen && !p.flagged && p.interval >= 6 && p.due > today) subs[s].m++; }
  }
  const subjRows = Object.entries(subs).map(([s, v]) => ({ s, pct: v.t ? Math.round(v.m / v.t * 100) : 0 })).sort((a, b) => b.pct - a.pct).slice(0, 5);

  const week = []; let wkMax = 1;
  for (let i = 6; i >= 0; i--){
    const day = addDays(today, -i);
    const n = (stats.reviewsByDate && stats.reviewsByDate[day]) || 0;
    wkMax = Math.max(wkMax, n);
    week.push({ n, wd: WD[new Date(day + 'T00:00:00').getDay()], isToday: day === today });
  }

  const weekTotal = week.reduce((s, w) => s + w.n, 0);
  /* Top subjects by how much has actually been reviewed, not by deck order. */
  const topSubjects = Object.keys(stats.bySubject || {})
    .sort((a, b) => (stats.bySubject[b] || 0) - (stats.bySubject[a] || 0)).slice(0, 3);

  const LBL = { fontFamily: SANS, fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: T.faint };
  const panel = { padding: 18 };
  const mins = Math.max(1, Math.round(due * 0.4));

  return (
    <div style={{ animation: 'sf-in 300ms cubic-bezier(.2,.8,.3,1)' }}>
      <div style={{ marginBottom: 18 }}>
        <Title style={{ fontSize: 25, fontWeight: 800 }}>{greetWord()}{name ? ', ' + name : ''}</Title>
        <Sub style={{ marginTop: 3 }}>{longDate()}{daysToExam != null && daysToExam >= 0 ? ' · exam in ' + daysToExam + (daysToExam === 1 ? ' day' : ' days') : ''}</Sub>
      </div>

      {totalCards === 0 ? (
        <Card style={{ padding: '32px 24px 26px' }}>
          <div style={{ textAlign: 'center' }}>
            {/* the mark, not a generic sparkle — this card is the first thing a
                new student sees and it is where the app introduces itself */}
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}><Mark size={40} /></div>
            <Title>Welcome to Study Feed</Title>
            <Sub style={{ marginTop: 6, marginBottom: 20 }}>Turn your notes into cards, then review a few whenever you've got a minute. Here's the gist:</Sub>
          </div>
          <div className="flex flex-col gap-3" style={{ marginBottom: 22, textAlign: 'left' }}>
            {[
              ['1', 'Make a deck', 'Paste notes, upload a PDF, Word, PowerPoint or photo, or just type a topic — the AI writes the cards.'],
              ['2', 'Study your feed', 'Swipe through what\'s due. Rate each card so it comes back at the right time.'],
              ['3', 'Check yourself', 'Take a quick quiz before a test, and export your decks to keep them safe.'],
            ].map(([n, t, s]) => (
              <div key={n} className="flex gap-3" style={{ alignItems: 'flex-start' }}>
                <span style={{ width: 26, height: 26, borderRadius: R.pill, background: rgba(T.accent, 0.12), color: T.accentInk,
                  display: 'grid', placeItems: 'center', fontFamily: SANS, fontSize: 13, fontWeight: 800, flexShrink: 0 }}>{n}</span>
                <div>
                  <div style={{ fontFamily: SANS, fontSize: 14.5, fontWeight: 700, color: T.ink }}>{t}</div>
                  <Sub style={{ fontSize: 13, marginTop: 1 }}>{s}</Sub>
                </div>
              </div>
            ))}
          </div>
          <Btn full kind="primary" onClick={onCreate}>Make your first cards</Btn>
          {/* Second, not first: making cards from your own notes is the product,
              and a ready-made deck is the fallback for arriving empty-handed.
              But it has to be here — step 1 above asks for material, and
              someone reading this on the bus has none. */}
          <Btn full kind="soft" onClick={onStarter} style={{ marginTop: 8 }}>Or try a ready-made deck</Btn>
          {/* The way back for anyone who skipped the walkthrough on arrival */}
          <Btn full kind="ghost" onClick={onTutorial} style={{ marginTop: 6, fontSize: 14 }}>Show me how it works</Btn>
        </Card>
      ) : (
        <>
          <div style={{ marginBottom: 16 }}>
            <Tip id="home-backup" settings={settings} onSettings={onSettings} icon="save" tone={T.green}>
              Your decks are saved on this device only. Use <b>You → Backup &amp; transfer</b> to export them so a cleared browser can't wipe your work.
            </Tip>
          </div>
          {/* hero — what to do now */}
          <Card style={{ padding: '22px 24px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 22, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 260px' }}>
              <div style={{ fontFamily: SANS, fontSize: 21, fontWeight: 750, letterSpacing: '-0.01em', color: T.ink }}>
                {due > 0 ? `You've got ${due} card${due > 1 ? 's' : ''} ready` : 'You\'re all caught up'}
              </div>
              <Sub style={{ marginTop: 5, marginBottom: 18 }}>
                {due > 0 ? `A mix of quick recall and long answers — about ${mins} min.` : 'Nothing due right now. Get ahead with some extra practice, or make more cards.'}
              </Sub>
              <div className="flex items-center gap-3" style={{ flexWrap: 'wrap' }}>
                <Btn kind="primary" onClick={onStart}>{due > 0 ? 'Start studying →' : 'Practice anyway →'}</Btn>
                <Sub style={{ fontSize: 12.5 }}>or pick a deck below</Sub>
              </div>
            </div>
            <div style={{ position: 'relative', width: 116, height: 116, borderRadius: '50%', flexShrink: 0,
              background: `conic-gradient(${T.accent} 0 ${sessionPct}%, ${T.well} 0)` }}>
              <div style={{ position: 'absolute', inset: 11, borderRadius: '50%', background: T.surface }} />
              <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ fontFamily: SANS, fontSize: 24, fontWeight: 800, lineHeight: 1, color: T.ink }}>{reviewedToday}</div>
                <div style={{ fontFamily: SANS, fontSize: 10.5, color: T.faint, marginTop: 3, textTransform: 'uppercase', letterSpacing: '0.05em' }}>done today</div>
              </div>
            </div>
          </Card>

          {/* The three ways to test yourself, directly under the hero.
              They lived at the very bottom of this screen, in the same small
              row as "make new cards", which meant the only way to reach Learn
              was to scroll past the whole dashboard — so nobody found it. They
              are the answer to "what should I do now?", which is what this
              screen is for, so they go above the fold. */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ ...LBL, marginBottom: 9 }}>Test yourself</div>
            <div style={{ display: 'flex', gap: 10 }}>
              {[
                /* First on purpose: quiz and learn both assume you already know
                   what to work on, and this is the one that tells you. */
                { icon: 'search', t: 'Find my gaps', s: 'What am I missing?', on: onDiagnose },
                { icon: 'puzzle', t: 'Learn a deck', s: 'Until you can produce it', on: () => onLearn('all') },
                { icon: 'target', t: 'Quiz me', s: 'A quick graded test', on: () => onQuiz('all') },
              ].map((q, i) => (
                <button key={i} className="sf-tap" onClick={q.on}
                  style={{ flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
                    gap: 9, textAlign: 'left', cursor: 'pointer', background: T.surface,
                    border: `1px solid ${T.border}`, borderRadius: R.well, boxShadow: SH.raised, padding: '15px 14px' }}>
                  <span style={{ width: 38, height: 38, borderRadius: 11, background: rgba(T.accent, 0.12),
                    color: T.accentInk, display: 'grid', placeItems: 'center', flexShrink: 0 }}><Ico name={q.icon} size={19} /></span>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontFamily: SANS, fontSize: 14.5, fontWeight: 700, color: T.ink, letterSpacing: '-0.01em' }}>{q.t}</span>
                    <span className="sf-act-sub" style={{ fontFamily: SANS, fontSize: 11.5, color: T.faint, marginTop: 2 }}>{q.s}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* stat strip */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
            {[{ n: due, label: 'Due now', col: T.accentInk }, { n: streak, label: 'Day streak', col: T.amber, icon: 'flame' },
              { n: reviewedToday, label: 'Reviewed today', col: T.green }, { n: totalCards, label: 'Cards total', col: T.ink }].map((it, i) => (
              <Card key={i} style={{ flex: '1 1 140px', padding: '15px 16px', boxShadow: SH.raised }}>
                <div className="flex items-center gap-1.5" style={{ color: it.col }}>
                  {it.icon && <Ico name={it.icon} size={17} weight={2} fill />}
                  <span style={{ fontFamily: SANS, fontSize: 23, fontWeight: 800, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{it.n}</span>
                </div>
                <div style={{ fontFamily: SANS, fontSize: 11.5, color: T.faint, marginTop: 6 }}>{it.label}</div>
              </Card>
            ))}
          </div>

          {/* dashboard grid */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
            <Card style={{ ...panel, flex: '1 1 340px' }}>
              <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
                <span style={LBL}>Your decks</span>
                <button className="sf-tap" onClick={onDecks} style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: SANS, fontSize: 12.5, fontWeight: 650, color: T.accentInk }}>All decks →</button>
              </div>
              {deckRows.slice(0, 5).map(({ d, dueN, pct }, i) => {
                const c = subjectColour(d.subject);
                return (
                  <button key={d.id} className="sf-tap" onClick={() => onStudyDeck(d.id)}
                    style={{ display: 'flex', alignItems: 'center', gap: 13, width: '100%', textAlign: 'left', cursor: 'pointer',
                      background: 'none', border: 'none', borderTop: i ? `1px solid ${T.border}` : 'none', padding: '11px 0' }}>
                    <Tile colour={c} glyph={(d.subject || '?').trim().charAt(0).toUpperCase()} size={38} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: SANS, fontSize: 14, fontWeight: 650, color: T.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.topic || d.subject || 'Untitled'}</div>
                      <div style={{ fontFamily: SANS, fontSize: 12, color: T.faint, marginTop: 1 }}>{d.subject || 'Untitled'} · {d.cards.length} cards</div>
                    </div>
                    <div style={{ width: 72, height: 6, background: T.well, borderRadius: R.pill, overflow: 'hidden', flexShrink: 0 }}>
                      <div style={{ height: '100%', width: pct + '%', background: T.green, borderRadius: R.pill }} />
                    </div>
                    <span style={{ fontFamily: SANS, fontSize: 11, fontWeight: 700, borderRadius: R.pill, padding: '2px 9px', flexShrink: 0,
                      color: dueN ? '#fff' : T.faint, background: dueN ? T.accent : T.well }}>{dueN} due</span>
                  </button>
                );
              })}
            </Card>

            <div style={{ flex: '1 1 240px', display: 'flex', flexDirection: 'column', gap: 16 }}>
              <Card style={panel}>
                <div style={{ ...LBL, marginBottom: 14 }}>This week</div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', height: 60 }}>
                  {week.map((w, i) => (
                    <div key={i} title={w.n + ' reviewed'} style={{ flex: 1, minHeight: 6, background: T.well, borderRadius: 7, position: 'relative' }}>
                      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: Math.round(10 + (w.n / wkMax) * 90) + '%', background: w.isToday ? T.green : T.accent, borderRadius: 7, opacity: w.n ? 0.95 : 0.25 }} />
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 7 }}>
                  {week.map((w, i) => <span key={i} style={{ flex: 1, textAlign: 'center', fontFamily: SANS, fontSize: 10, color: T.faint }}>{w.wd[0]}</span>)}
                </div>
                {/* The findable one. The other two sit behind clearing the whole
                    feed or earning an Excellence, which a new student may not
                    reach for days — this shares the panel it is sitting on, and
                    only appears once there is a week worth showing. */}
                {weekTotal > 0 && (
                  <ShareLink label="Share your week" onClick={() => setShareWeek(true)}
                    style={{ marginTop: 10, width: '100%' }} />
                )}
              </Card>

              <Card style={panel}>
                <div style={{ ...LBL, marginBottom: 12 }}>How well you know it</div>
                {subjRows.length === 0 && <Sub style={{ fontSize: 13 }}>Study a little and this fills in.</Sub>}
                {subjRows.map(({ s, pct }, i) => (
                  <div key={s} className="flex items-center gap-3" style={{ padding: '9px 0', borderTop: i ? `1px solid ${T.border}` : 'none' }}>
                    <span style={{ flex: 1, fontFamily: SANS, fontSize: 13.5, fontWeight: 650, color: T.ink }}>{s}</span>
                    <div style={{ width: 110, height: 6, background: T.well, borderRadius: R.pill, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: pct + '%', background: T.green, borderRadius: R.pill }} />
                    </div>
                    <span style={{ width: 34, textAlign: 'right', fontFamily: SANS, fontSize: 12, fontWeight: 650, color: T.muted, fontVariantNumeric: 'tabular-nums' }}>{pct}%</span>
                  </div>
                ))}
              </Card>
            </div>
          </div>

          {/* quick actions */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 16 }}>
            {[
              { icon: 'plus', t: 'Make new cards', s: 'Paste notes, a file, or a topic', on: onCreate },
              flagged > 0
                ? { icon: 'warn', t: 'Review your tricky ones', s: `${flagged} card${flagged > 1 ? 's' : ''} keep tripping you up`, on: onStart }
                : { icon: 'stack', t: 'Study your feed', s: 'Review what\'s due today', on: onStart },
              { icon: 'folder', t: 'All my decks', s: 'Edit, rename, export or delete', on: onDecks },
            ].map((q, i) => (
              <button key={i} className="sf-tap" onClick={q.on}
                style={{ flex: '1 1 220px', display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left', cursor: 'pointer',
                  background: T.surface, border: `1px solid ${T.border}`, borderRadius: R.well, boxShadow: SH.raised, padding: '15px 16px' }}>
                <span style={{ width: 34, height: 34, borderRadius: 10, background: rgba(T.accent, 0.12), color: T.accentInk, display: 'grid', placeItems: 'center', flexShrink: 0 }}><Ico name={q.icon} size={17} /></span>
                <div>
                  <div style={{ fontFamily: SANS, fontSize: 14, fontWeight: 700, color: T.ink }}>{q.t}</div>
                  <div style={{ fontFamily: SANS, fontSize: 12, color: T.faint, marginTop: 1 }}>{q.s}</div>
                </div>
              </button>
            ))}
          </div>
        </>
      )}
      {shareWeek && (
        <ShareSheet kind="session" onClose={() => setShareWeek(false)}
          data={{ done: weekTotal, label: weekTotal === 1 ? 'card this week' : 'cards this week',
            streak: streak, subjects: topSubjects,
            week: week.map(w => w.n), headline: weekHeadline(stats, topSubjects) }} />
      )}
    </div>
  );
}

/* ==========================================================================
   OPTIONS  —  building a multiple-choice question worth answering.

   The complaint that produced this section: a question whose right answer was
   one word was offered next to an option that ran to a paragraph. Distractors
   were drawn at random from every other answer in scope, so nothing kept them
   the same shape as the answer they were meant to hide among — and length
   alone gives the game away. A student can score full marks on a deck like
   that without recalling a word of it, which is worse than a bad question,
   because the score then says they know it.

   A wrong option has to be plausible in SHAPE before it can be plausible in
   content. Candidates are ranked against the answer: same rough length, same
   rough word count, the same kind of thing. Where the deck cannot supply
   enough lookalikes, numbers are invented — the figure doubled, halved, an
   order of magnitude out — and only after that does it settle for the closest
   of a bad lot, which is all the old build ever did.
   ========================================================================== */
/* Is there a keyboard? The number hints on the options are help on a laptop
   and clutter on a phone. */
const HAS_KEYBOARD = (() => {
  try { return window.matchMedia('(hover: hover) and (pointer: fine)').matches; } catch (e){ return false; }
})();

const MCQ_OPTIONS = 4;
const MCQ_LONG = 90;     /* past this an option is a paragraph, not a choice */
const FIT_GOOD = 0.45;   /* could pass for the answer at a glance */
const FIT_POOR = 0.26;   /* visibly different, but still worth offering */

/* What an answer looks like from across the room — which is all anyone needs
   to rule an option out without reading it. */
function answerShape(s){
  const t = String(s == null ? '' : s).trim();
  const words = t ? t.split(/\s+/).length : 0;
  const letters = t.replace(/[^A-Za-z]/g, '').length;
  return {
    len: t.length,
    words: words,
    /* "1840", "6.02 x 10^23", "37 degrees" — opens with a figure and is mostly
       figures. A number offered against a word is never picked. */
    numeric: /^[\s(]*[-+]?\d/.test(t) && letters <= Math.max(3, Math.round(t.length * 0.34)),
    /* A written answer rather than a term. Mixing the two is the whole
       complaint this section exists to answer. */
    sentence: words >= 7,
  };
}

/* 0 = unusable, 1 = indistinguishable in shape. Length is weighted hardest
   because it is the tell the eye reads first, before any of the words. */
function distractorFit(a, b){
  if (!a.len || !b.len) return 0;
  if (a.numeric !== b.numeric) return 0;
  if (a.sentence !== b.sentence) return 0;
  const lenFit = Math.min(a.len, b.len) / Math.max(a.len, b.len);
  const wordFit = Math.min(a.words, b.words) / Math.max(a.words, b.words);
  return lenFit * 0.65 + wordFit * 0.35;
}

/* Every candidate in the pool, best fit first, with the ones that must never
   be offered taken out: the answer itself, the same answer spelled another
   way, and anything close enough that picking it would be right in spirit —
   the same test the typed check uses to accept a near miss. */
function rankDistractors(correct, pool){
  const shape = answerShape(correct);
  const want = normaliseAnswer(correct);
  const cap = typoAllowance(want.length);
  const seen = new Set([want]);
  const out = [];
  for (const cand of pool){
    const text = String(cand == null ? '' : cand).trim();
    if (!text) continue;
    const key = normaliseAnswer(text);
    if (!key || seen.has(key)) continue;
    if (cap > 0 && editDistance(key, want, cap) <= cap) continue;
    seen.add(key);
    out.push({ text: text, fit: distractorFit(shape, answerShape(text)) });
  }
  out.sort((a, b) => b.fit - a.fit);
  return out;
}

/* Numbers are the one answer type whose wrong answers can be made rather than
   found, and the made ones are better: an order of magnitude out, doubled,
   halved — the mistakes actually made. Years get years, not orders of
   magnitude, because 3680 is not a wrong answer anybody would consider. */
function numericDistractors(correct, want){
  const s = String(correct);
  const m = s.match(/-?\d[\d,]*(?:\.\d+)?/);
  if (!m) return [];
  const raw = m[0];
  const n = parseFloat(raw.replace(/,/g, ''));
  if (!isFinite(n) || n === 0) return [];
  const dec = (raw.split('.')[1] || '').length;
  const yearish = !dec && n >= 1000 && n <= 2999 && s.length <= 14;
  const steps = yearish
    ? [n - 10, n + 10, n - 1, n + 1, n - 50, n + 50, n - 100, n + 100]
    : [n * 2, n / 2, n * 10, n / 10, n * 1.5, n * 100, n / 100];
  /* The first four are the plausible ones either way, so they get shuffled
     among themselves and the long shots stay at the back. */
  const tiered = shuffle(steps.slice(0, 4)).concat(steps.slice(4));
  const seen = new Set([normaliseAnswer(s)]);
  const out = [];
  for (const v of tiered){
    if (out.length >= want) break;
    if (!isFinite(v) || v === n) continue;
    const txt = dec ? v.toFixed(dec) : String(Math.round(v));
    const full = s.replace(raw, txt);
    const key = normaliseAnswer(full);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(full);
  }
  return out;
}

/* A card that came with its own options keeps them — they were written for
   this question and no pool will beat them. Only duplicates go, because two
   identical options mean one of them is marked wrong for saying the right
   thing. */
function ownOptions(card){
  const raw = (card.options || []).map(o => String(o == null ? '' : o).trim()).filter(Boolean);
  if (raw.length < 2) return null;
  const correct = String(card.options[card.answer] != null ? card.options[card.answer] : raw[0]).trim();
  const seen = new Set();
  const kept = [];
  for (const o of raw){
    const k = normaliseAnswer(o);
    if (seen.has(k)) continue;
    seen.add(k); kept.push(o);
  }
  const options = shuffle(kept);
  let at = options.indexOf(correct);
  if (at < 0) at = options.findIndex(o => normaliseAnswer(o) === normaliseAnswer(correct));
  return at < 0 ? null : { options: options, answer: at };
}

/* The options for one question: the answer plus up to three wrong ones,
   shuffled so position carries nothing. Returns null when the pool cannot make
   a question worth asking — Learn takes that as a reason to ask the card a
   different way, Quiz has to ask something and lowers its floor instead.

   Three plausible options beat four where one is visibly not in the running,
   so a short question is never padded out with a bad option. Padding only
   happens below `minPicks`, which is the point where it stops being a
   question at all. */
function buildOptions(correct, pool, opts){
  const answer = String(correct == null ? '' : correct).trim();
  if (!answer) return null;
  const o = opts || {};
  /* Four options of eighty words each is a reading test rather than a recall
     test — on a phone it is the whole screen twice over. Where the answers are
     that long the question drops to three, which halves the reading for eight
     points of guess rate. */
  const need = (answer.length > MCQ_LONG ? 3 : MCQ_OPTIONS) - 1;
  const minFit = o.minFit == null ? FIT_POOR : o.minFit;
  const minPicks = o.minPicks == null ? 2 : o.minPicks;
  const ranked = rankDistractors(answer, pool);
  const taken = new Set([normaliseAnswer(answer)]);
  const picks = [];
  const add = (text) => {
    const key = normaliseAnswer(text);
    if (!key || taken.has(key)) return;
    taken.add(key); picks.push(text);
  };

  /* Real answers off the student's own cards first: a wrong option that is
     something they have to know anyway is the one that teaches twice. Taken
     from a window rather than strictly the top three, so the same card does
     not come round with the same three every single time. */
  const good = ranked.filter(r => r.fit >= FIT_GOOD);
  const near = good.length > need ? shuffle(good.slice(0, need * 3)) : good;
  for (const r of near){ if (picks.length >= need) break; add(r.text); }

  if (picks.length < need && answerShape(answer).numeric){
    for (const d of numericDistractors(answer, need - picks.length)) add(d);
  }
  /* Last resort, and only to get up to the minimum. `ranked` is sorted, so the
     first one under the floor means nothing after it passes either. */
  if (picks.length < minPicks){
    for (const r of ranked){
      if (picks.length >= minPicks || r.fit < minFit) break;
      add(r.text);
    }
  }
  if (picks.length < minPicks) return null;
  const options = shuffle([answer].concat(picks));
  return { options: options, answer: options.indexOf(answer) };
}

/* Which deck are we working on? A pill per deck that wraps, rather than a
   segmented control — past three decks a segmented row squeezes every label
   down to its first two letters. Shared by Quiz and Learn. */
function ScopePicker({ decks, value, onChange, label }){
  if (!decks || decks.length < 2) return null;
  const opts = [{ id: 'all', label: 'All decks', colour: T.accent }].concat(
    decks.map(d => ({ id: d.id, label: d.topic || d.subject || 'Untitled', colour: subjectColour(d.subject) })));
  return (
    <Card style={{ padding: 15, marginBottom: 12, boxShadow: SH.raised }}>
      <div style={{ fontFamily: SANS, fontSize: 13, fontWeight: 700, color: T.muted, marginBottom: 10 }}>{label || 'Which deck?'}</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {opts.map(o => {
          const active = value === o.id;
          return (
            <button key={o.id} className="sf-tap" onClick={() => onChange(o.id)} aria-pressed={active}
              style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer',
                background: active ? T.surface : T.well, border: `1.5px solid ${active ? rgba(o.colour, 0.5) : 'transparent'}`,
                borderRadius: R.pill, padding: '8px 13px', boxShadow: active ? SH.pop : 'none' }}>
              <span style={{ width: 8, height: 8, borderRadius: 8, background: o.colour }} />
              <span style={{ fontFamily: SANS, fontSize: 13, fontWeight: active ? 700 : 550, color: active ? T.ink : T.muted,
                whiteSpace: 'nowrap', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>{o.label}</span>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

/* ==========================================================================
   QUIZ  —  a quick, finite, self-graded test built from a deck's own cards.
   No API cost: multiple-choice, correct answer from the card, distractors
   ranked out of the pool by the section above. Extended (essay) cards sit
   this out.
   ========================================================================== */
function quizAnswerText(c){
  if (c.type === 'mcq') return (c.options && c.options[c.answer] != null) ? String(c.options[c.answer]) : '';
  return String(c.back != null ? c.back : '');
}
function quizQuestionText(c){
  return String((c.front != null ? c.front : c.prompt) || '');
}
/* Quiz and Learn both draw from this. Worked problems are excluded for the
   same reason extended ones are: there is no single answer to recognise, and
   a multi-choice built out of one would be asking the wrong question. */
const quizUsable = (c) => c.type !== 'extended' && c.type !== 'worked' && quizQuestionText(c).trim() && quizAnswerText(c).trim();
const QUIZ_MIN = 4;

function buildQuiz(cards, count){
  const usable = cards.filter(quizUsable);
  const answerPool = Array.from(new Set(usable.map(quizAnswerText)));
  const ask = (c, opts) => {
    const built = (c.type === 'mcq' && c.options && c.options.length >= 2)
      ? ownOptions(c) : buildOptions(quizAnswerText(c), answerPool, opts);
    return built ? { cardId: c.id, q: quizQuestionText(c), options: built.options, answer: built.answer } : null;
  };
  const order = shuffle(usable);
  const out = [];
  const held = [];
  for (const c of order){
    if (out.length >= count) break;
    const q = ask(c, { minPicks: 2 });
    if (q) out.push(q); else held.push(c);
  }
  /* Asking fewer questions is better than asking a bad one: the count you
     chose is a request, not a promise, and the score is out of what you were
     actually asked. The floor only drops to the bottom when the deck cannot
     make a single fair question, where the choice is a rough quiz or none. */
  if (!out.length){
    for (const c of held){
      if (out.length >= count) break;
      const q = ask(c, { minFit: 0, minPicks: 1 });
      if (q) out.push(q);
    }
  }
  return out;
}

function Quiz({ decks, deckId, onClose, onDone }){
  const [scope, setScope] = useState(deckId && deckId !== 'all' && decks.some(d => d.id === deckId) ? deckId : 'all');
  const [phase, setPhase] = useState('setup');
  const [want, setWant] = useState(10);
  const [questions, setQuestions] = useState([]);
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState([]);
  const [picked, setPicked] = useState(null);
  const [quizRun, setQuizRun] = useState(0);   // consecutive right answers
  const doneRef = useRef(false);

  const scopeDecks = scope === 'all' ? decks : decks.filter(d => d.id === scope);
  const scopeCards = useMemo(() => { const o = []; for (const d of scopeDecks) for (const c of d.cards) o.push(c); return o; }, [scope, decks]);
  const usableCount = useMemo(() => scopeCards.filter(quizUsable).length, [scopeCards]);
  const subject = scope === 'all' ? '' : ((scopeDecks[0] && scopeDecks[0].subject) || '');

  const lenOpts = [];
  if (usableCount > 10) lenOpts.push({ v: 10, label: '10' });
  if (usableCount > 20) lenOpts.push({ v: 20, label: '20' });
  lenOpts.push({ v: 'all', label: 'All ' + usableCount });
  useEffect(() => { if (want !== 'all' && want > usableCount) setWant('all'); }, [usableCount]);

  const start = () => {
    const n = want === 'all' ? usableCount : Math.min(want, usableCount);
    const qs = buildQuiz(scopeCards, n);
    if (!qs.length) return;
    doneRef.current = false;
    setQuestions(qs); setAnswers(new Array(qs.length).fill(null)); setIdx(0); setPicked(null); setQuizRun(0); setPhase('run');
  };
  /* A quiz is the most game-like thing in the app, so it gets the fullest
     feedback: the run of right answers drives the pitch the same way the feed
     does, and a wrong pick breaks the run. */
  const choose = (i) => {
    if (picked !== null) return;
    setPicked(i);
    setAnswers(a => { const b = a.slice(); b[idx] = i; return b; });
    const right = questions[idx] && i === questions[idx].answer;
    const run = right ? quizRun + 1 : 0;
    setQuizRun(run);
    if (right){ play(run >= 5 && run % 5 === 0 ? 'milestone' : 'right', run - 1); buzz(10); }
    else { play('wrong'); buzz(34); }
  };
  const next = () => { if (idx + 1 >= questions.length) setPhase('done'); else { setIdx(idx + 1); setPicked(null); } };

  /* Same keys as Learn — 1-4 to answer, Enter to carry on. Re-bound every
     render so it is never holding a stale question. */
  useEffect(() => {
    if (phase !== 'run') return;
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Escape'){ onClose(); return; }
      const q = questions[idx];
      if (!q) return;
      if (picked !== null){
        if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); next(); }
        return;
      }
      const n = (e.key >= '1' && e.key <= '9') ? Number(e.key) : 0;
      if (n && n <= q.options.length){ e.preventDefault(); choose(n - 1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const score = answers.reduce((s, a, i) => s + ((a != null && questions[i] && a === questions[i].answer) ? 1 : 0), 0);
  const pct = questions.length ? Math.round((score / questions.length) * 100) : 0;

  useEffect(() => {
    if (phase === 'done' && !doneRef.current){
      doneRef.current = true;
      onDone(questions.length, subject);
      play(pct >= 80 ? 'done' : pct >= 50 ? 'milestone' : 'ok');
      buzz(pct >= 80 ? [16, 60, 16, 60, 26] : 16);
    }
  }, [phase]);

  const closeBtn = (
    <button onClick={onClose} className="sf-tap" aria-label="Close quiz"
      style={{ width: 38, height: 38, borderRadius: R.pill, background: T.surface, border: `1px solid ${T.border}`,
        cursor: 'pointer', color: T.muted, boxShadow: SH.raised, flexShrink: 0, display: 'flex',
        alignItems: 'center', justifyContent: 'center' }}><Ico name="cross" size={15} weight={2.2} /></button>
  );

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, background: T.bg, overflowY: 'auto' }}>
      <div style={{ width: '100%', maxWidth: 560, margin: '0 auto', padding: '16px 16px 64px' }}>
        <div className="flex items-center justify-between" style={{ marginBottom: 20 }}>
          <div style={{ fontFamily: SANS, fontSize: 20, fontWeight: 800, color: T.ink, letterSpacing: '-0.02em' }}>Quiz</div>
          {closeBtn}
        </div>

        {phase === 'setup' && (
          <div style={{ animation: 'sf-in 260ms cubic-bezier(.2,.8,.3,1)' }}>
            <Title style={{ fontSize: 23, marginBottom: 6 }}>Test yourself</Title>
            <Sub style={{ marginBottom: 18 }}>A quick multiple-choice check built from your cards. It's graded but never changes your review schedule.</Sub>

            <ScopePicker decks={decks} value={scope} onChange={setScope} />

            {usableCount < QUIZ_MIN ? (
              <Card style={{ padding: '30px 22px', textAlign: 'center' }}>
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12, color: T.faint }}><Ico name="puzzle" size={34} weight={1.5} /></div>
                <Title style={{ fontSize: 18 }}>Not enough to quiz yet</Title>
                <Sub style={{ marginTop: 6 }}>A quiz needs at least {QUIZ_MIN} quick or multiple-choice cards. Long-answer cards sit quizzes out — make a few more and come back.</Sub>
              </Card>
            ) : (
              <>
                <Card style={{ padding: 15, marginBottom: 16, boxShadow: SH.raised }}>
                  <div style={{ fontFamily: SANS, fontSize: 13, fontWeight: 700, color: T.muted, marginBottom: 10 }}>How many questions?</div>
                  <Segmented value={want} onChange={setWant} options={lenOpts} />
                </Card>
                <Btn full kind="primary" onClick={start}>Start quiz →</Btn>
              </>
            )}
          </div>
        )}

        {phase === 'run' && questions[idx] && (() => {
          const q = questions[idx];
          const answered = picked !== null;
          return (
            <div style={{ animation: 'sf-in 220ms cubic-bezier(.2,.8,.3,1)' }} key={idx}>
              <div className="flex items-center gap-3" style={{ marginBottom: 14 }}>
                <div style={{ flex: 1, height: 8, background: T.well, borderRadius: R.pill, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${Math.round(((idx + (answered ? 1 : 0)) / questions.length) * 100)}%`,
                    background: T.accent, borderRadius: R.pill, transition: 'width 300ms cubic-bezier(.2,.8,.3,1)' }} />
                </div>
                <Sub style={{ fontSize: 12.5, fontWeight: 600 }}>{idx + 1} / {questions.length}</Sub>
              </div>

              <Card style={{ padding: '22px 20px', minHeight: 120, marginBottom: 14 }}>
                <div style={{ fontFamily: SANS, fontSize: 19, fontWeight: 650, color: T.ink, lineHeight: 1.4, letterSpacing: '-0.01em' }}>{q.q}</div>
              </Card>

              <div className="flex flex-col gap-2">
                {q.options.map((opt, i) => {
                  const isCorrect = i === q.answer;
                  const isPicked = i === picked;
                  let bg = T.surface, bd = T.border, col = T.ink, mark = null;
                  if (answered){
                    if (isCorrect){ bg = rgba(T.green, 0.12); bd = rgba(T.green, 0.5); col = T.ink; mark = 'check'; }
                    else if (isPicked){ bg = rgba(T.red, 0.1); bd = rgba(T.red, 0.45); col = T.ink; mark = 'cross'; }
                    else { col = T.faint; }
                  }
                  return (
                    <button key={i} className="sf-tap" onClick={() => choose(i)} disabled={answered}
                      style={{ display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left', width: '100%',
                        cursor: answered ? 'default' : 'pointer', background: bg, border: `1.5px solid ${bd}`,
                        borderRadius: R.well, padding: '15px 16px', boxShadow: answered ? 'none' : SH.raised }}>
                      {HAS_KEYBOARD && !answered && (
                        <span aria-hidden="true" style={{ flexShrink: 0, minWidth: 18, height: 18, borderRadius: 5,
                          background: T.well, color: T.faint, fontFamily: SANS, fontSize: 11, fontWeight: 700,
                          lineHeight: '18px', textAlign: 'center' }}>{i + 1}</span>
                      )}
                      <span style={{ flex: 1, fontFamily: SANS, fontSize: 15.5, fontWeight: 550, color: col, lineHeight: 1.4 }}>{opt}</span>
                      {mark && <span style={{ color: isCorrect ? T.green : T.red }}><Ico name={mark} size={17} weight={2.6} /></span>}
                    </button>
                  );
                })}
              </div>

              {answered && (
                <div style={{ marginTop: 16, animation: 'sf-reveal 240ms cubic-bezier(.2,.8,.3,1)' }}>
                  <div style={{ fontFamily: SANS, fontSize: 14, fontWeight: 700, color: picked === q.answer ? T.green : T.red, marginBottom: 12, textAlign: 'center' }}>
                    {picked === q.answer ? 'Nice — that\'s right' : 'Not quite'}
                  </div>
                  <Btn full kind="primary" onClick={next}>{idx + 1 >= questions.length ? 'See results →' : 'Next →'}</Btn>
                </div>
              )}
            </div>
          );
        })()}

        {phase === 'done' && (() => {
          const missed = questions.map((q, i) => ({ q, i })).filter(({ q, i }) => answers[i] !== q.answer);
          const ring = pct >= 80 ? T.green : pct >= 50 ? T.amber : T.red;
          const line = pct >= 80 ? 'Strong — you know this well.' : pct >= 50 ? 'Getting there. Review the misses below.' : 'Worth another look — the misses are below.';
          return (
            <div style={{ animation: 'sf-in 260ms cubic-bezier(.2,.8,.3,1)' }}>
              {/* 80%+ earns the full treatment; below that a scorecard that
                  throws confetti would just feel sarcastic */}
              {pct >= 80 && <Confetti n={38} />}
              <Card style={{ padding: '26px 22px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
                <div style={{ position: 'relative', width: 108, height: 108, borderRadius: '50%', flexShrink: 0,
                  background: `conic-gradient(${ring} 0 ${pct}%, ${T.well} 0)` }}>
                  <div style={{ position: 'absolute', inset: 10, borderRadius: '50%', background: T.surface }} />
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ fontFamily: SANS, fontSize: 26, fontWeight: 800, lineHeight: 1, color: T.ink }}>{pct}%</div>
                    <div style={{ fontFamily: SANS, fontSize: 11, color: T.faint, marginTop: 3 }}>{score}/{questions.length}</div>
                  </div>
                </div>
                <div style={{ flex: '1 1 200px' }}>
                  <Title style={{ fontSize: 21 }}>Quiz done</Title>
                  <Sub style={{ marginTop: 5 }}>{line}</Sub>
                </div>
              </Card>

              {missed.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontFamily: SANS, fontSize: 13, fontWeight: 700, color: T.muted, margin: '0 2px 8px' }}>
                    {missed.length} to review
                  </div>
                  <div className="flex flex-col gap-2">
                    {missed.map(({ q, i }) => (
                      <Card key={i} style={{ padding: 14, boxShadow: SH.raised }}>
                        <div style={{ fontFamily: SANS, fontSize: 14.5, fontWeight: 650, color: T.ink, lineHeight: 1.4, marginBottom: 8 }}>{q.q}</div>
                        {answers[i] != null && (
                          <div style={{ fontFamily: SANS, fontSize: 13.5, color: T.red, marginBottom: 3 }}>
                            <span className="flex items-center gap-1.5"><Ico name="cross" size={13} weight={2.4} />You said: {q.options[answers[i]]}</span>
                          </div>
                        )}
                        <div style={{ fontFamily: SANS, fontSize: 13.5, color: T.green, fontWeight: 600 }}>
                          <span className="flex items-center gap-1.5"><Ico name="check" size={13} weight={2.4} />{q.options[q.answer]}</span>
                        </div>
                      </Card>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                <Btn full kind="primary" onClick={start}>Retake</Btn>
                <Btn full kind="soft" onClick={onClose}>Done</Btn>
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

/* ==========================================================================
   OVERLAYS  —  What's new, and the feature-request form
   ========================================================================== */

/* ==========================================================================
   LEARN — inspired by Quizlet's Learn mode, adapted to this app's cards.

   What was worth taking from it:
   - A card is not "done" the first time you get it right. Two correct answers
     are needed, and the second one has to be harder than the first.
   - The question format ESCALATES with familiarity. The first time you meet a
     card you pick it out of four options, which is recognition and is easy.
     Once you have it, you have to produce the answer from memory. Recognition
     first is what makes starting an unfamiliar deck feel possible.
   - Short rounds with a checkpoint, so progress is visible while you are still
     in the middle of it rather than only at the end.
   - A card you miss comes back inside the same session, not tomorrow.

   What was deliberately NOT taken:
   - Quizlet's Learn feeds its long-term memory model. This does not touch the
     SM-2 schedule at all — it counts as practice, exactly like Quiz. The feed
     is the scheduler, and two things quietly moving the same due dates would
     make both of them lie.
   - Extended cards sit it out. A six-mark written answer is marked, not
     recalled, and it already has a better home in the feed.
   ========================================================================== */
const LEARN_ROUND = 7;       /* cards per round before the checkpoint */
const LEARN_MASTER = 2;      /* correct answers to master, the second one harder */
const LEARN_KEEP_DAYS = 14;  /* how long a half-finished run is worth offering back */
const LEARN_AUTO_MS = 800;   /* pause on a right answer before moving on by itself */

/* One question, decided in one place. The format follows how well the card is
   known — recognition while it is new, production once it is not — but it also
   has to be a question this deck can actually ask.

   A card whose answer nothing in the deck resembles cannot be made into four
   options: three of them would be obviously wrong on sight, which tests
   eyesight rather than memory. That card gets shown once instead, and then
   comes back later in the same round with the answer off the screen. */
function buildLearnQuestion(item, answerPool){
  const card = item.card;
  if (item.box <= 0){
    const built = (card.type === 'mcq' && card.options && card.options.length >= 2)
      ? ownOptions(card)
      : buildOptions(quizAnswerText(card), answerPool, { minPicks: 2 });
    if (built && built.options.length >= 3) return { format: 'mcq', mcq: built };
    if (!item.seen) return { format: 'preview', mcq: null };
  }
  return { format: typedCheckable(card) ? 'typed' : 'recall', mcq: null };
}

/* A run is stored as boxes by card id — small, and it survives the deck being
   edited underneath it. A card that has gone takes its progress with it, and
   one that is new starts where everything else started. */
function packLearn(scope, items, round){
  const cards = {};
  for (const it of items) cards[it.card.id] = [it.box, it.misses, it.seen ? 1 : 0];
  return { scope: scope, round: round, at: Date.now(), cards: cards };
}
function unpackLearn(session, scopeCards){
  if (!session || !session.cards) return null;
  const list = scopeCards.map(x => {
    const s = session.cards[x.card.id];
    return { card: x.card, deck: x.deck,
      box: s ? Math.max(0, Math.min(LEARN_MASTER, s[0] | 0)) : 0,
      misses: s ? Math.max(0, s[1] | 0) : 0,
      seen: s ? !!s[2] : false };
  });
  /* Nothing to come back to if none of it was started, or if it was finished. */
  if (!list.some(it => it.box > 0 || it.misses > 0)) return null;
  if (!list.some(it => it.box < LEARN_MASTER)) return null;
  return list;
}

function LearnMode({ decks, deckId, session, onSaveSession, onClose, onDone }){
  const [scope, setScope] = useState(deckId && deckId !== 'all' && decks.some(d => d.id === deckId) ? deckId : 'all');
  const [phase, setPhase] = useState('setup');   // setup | run | round | done
  const [items, setItems] = useState([]);        // [{ card, deck, box, misses, seen }]
  const [order, setOrder] = useState([]);        // item indices queued for this round
  const [qi, setQi] = useState(0);
  const [round, setRound] = useState(1);
  const [pick, setPick] = useState(null);
  const [typedValue, setTypedValue] = useState('');
  const [result, setResult] = useState(null);    // { verdict, expected } once answered
  const [shown, setShown] = useState(false);     // recall: answer revealed
  const [run, setRun] = useState(0);             // consecutive correct, drives the pitch
  const answeredRef = useRef(0);
  const doneRef = useRef(false);
  const inputRef = useRef(null);
  const timerRef = useRef(null);                 // pending auto-advance
  const leftRef = useRef('');                    // question key already advanced past
  const preBoxRef = useRef(0);                   // box before this answer, for "I was right"

  const scopeDecks = scope === 'all' ? decks : decks.filter(d => d.id === scope);
  const scopeCards = useMemo(() => {
    const o = [];
    for (const d of scopeDecks) for (const c of d.cards) if (quizUsable(c)) o.push({ card: c, deck: d });
    return o;
  }, [scope, decks]);
  const poolRef = useRef([]);
  const subject = scope === 'all' ? '' : ((scopeDecks[0] && scopeDecks[0].subject) || '');

  const masteredCount = items.filter(i => i.box >= LEARN_MASTER).length;
  const current = order.length && qi < order.length ? items[order[qi]] : null;

  /* The question is built once per card shown and cached against its key, not
     rebuilt on every render — otherwise the options reshuffle under the finger
     every time any state changes. The key changes only when a different card
     comes up, which is exactly when new options are wanted. */
  const qKey = phase === 'run' && current ? (round + ':' + qi + ':' + order[qi]) : '';
  const qRef = useRef({ key: '', value: null });
  if (qKey && qRef.current.key !== qKey) qRef.current = { key: qKey, value: buildLearnQuestion(current, poolRef.current) };
  const view = qKey ? qRef.current.value : null;
  const format = view ? view.format : null;

  /* Mirrors, so the auto-advance timer and the unmount handler are not reading
     the state as it was when they were created. */
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const snapRef = useRef(null);
  snapRef.current = { scope: scope, phase: phase, items: items, round: round };
  const saveRef = useRef(onSaveSession);
  saveRef.current = onSaveSession;

  /* An unfinished run is worth picking up, but only for the deck it was for,
     and only while it is still recent enough to remember starting. */
  const saved = useMemo(() => {
    if (!session || session.scope !== scope) return null;
    if (session.at && Date.now() - session.at > LEARN_KEEP_DAYS * 86400000) return null;
    const list = unpackLearn(session, scopeCards);
    if (!list) return null;
    return { list: list, round: session.round || 1,
      mastered: list.filter(i => i.box >= LEARN_MASTER).length,
      part: list.filter(i => i.box > 0 && i.box < LEARN_MASTER).length };
  }, [session, scope, scopeCards]);

  const clearTimer = () => { if (timerRef.current){ clearTimeout(timerRef.current); timerRef.current = null; } };
  const persist = (list, roundNo) => {
    if (saveRef.current) saveRef.current(packLearn(scope, list, roundNo));
  };

  /* Everything not yet mastered, hardest first: cards you have missed lead the
     next round, and one you have never seen comes before one already half
     learned. */
  const buildRound = (list) => {
    const left = list.map((it, i) => ({ it, i })).filter(x => x.it.box < LEARN_MASTER);
    left.sort((a, b) => (b.it.misses - a.it.misses) || (a.it.box - b.it.box) || (Math.random() - 0.5));
    return left.slice(0, LEARN_ROUND).map(x => x.i);
  };

  const resetQuestion = () => { clearTimer(); setPick(null); setTypedValue(''); setResult(null); setShown(false); };

  const begin = (list, roundNo) => {
    if (!list.length) return;
    answeredRef.current = 0;
    doneRef.current = false;
    /* Wrong answers come out of the run's OWN cards, fixed here rather than
       read off the scope picker while the run is going. In normal use they are
       the same set; when they disagree, the run is the one telling the truth,
       and the difference is a history card offered biology distractors. */
    poolRef.current = Array.from(new Set(list.map(x => quizAnswerText(x.card))));
    setItems(list);
    setOrder(buildRound(list));
    setQi(0); setRound(roundNo || 1); setRun(0);
    leftRef.current = '';
    qRef.current = { key: '', value: null };
    resetQuestion();
    setPhase('run');
  };
  const start = () => {
    begin(shuffle(scopeCards).map(x => ({ card: x.card, deck: x.deck, box: 0, misses: 0, seen: false })), 1);
    track('learn_started', { cards: scopeCards.length, resumed: 0 });
  };
  const resume = () => {
    if (!saved) return;
    begin(shuffle(saved.list), saved.round);
    track('learn_started', { cards: saved.list.length, resumed: 1 });
  };
  /* Straight back into the ones that fought back, at the bottom of the ladder
     again. A fresh run rather than a continuation — they have been mastered
     once already, and the point is to do it a second time from cold. */
  const drillMissed = () => {
    const hard = items.filter(i => i.misses > 0).map(i => ({ card: i.card, deck: i.deck, box: 0, misses: 0, seen: true }));
    if (!hard.length) return;
    begin(shuffle(hard), 1);
    track('learn_started', { cards: hard.length, resumed: 0 });
  };

  useEffect(() => {
    if (phase !== 'run' || format !== 'typed' || result || !inputRef.current) return;
    try { inputRef.current.focus({ preventScroll: true }); } catch (e){}
  }, [phase, qKey, format, result]);

  /* One place where a card's fate is decided, whatever asked the question. */
  const settle = (correct) => {
    answeredRef.current += 1;
    preBoxRef.current = current ? current.box : 0;
    if (correct){ setRun(n => n + 1); play(run + 1 >= 5 && (run + 1) % 5 === 0 ? 'milestone' : 'right', run); buzz(10); }
    else { setRun(0); play('wrong'); buzz(34); }
    setItems(list => list.map((it, i) => {
      if (i !== order[qi]) return it;
      /* A miss drops it back to recognition. Being asked to produce an answer
         you have just failed to recognise teaches nothing but frustration. */
      return correct
        ? { ...it, box: it.box + 1, seen: true }
        : { ...it, box: 0, misses: it.misses + 1, seen: true };
    }));
  };

  /* A right answer has nothing left on screen to read, and over forty cards
     the extra tap each time is a real part of the session. Everything else
     waits — a correction is the one thing worth stopping for. */
  const armAdvance = (verdict) => {
    if (verdict !== 'right') return;
    clearTimer();
    timerRef.current = setTimeout(() => { timerRef.current = null; next(false); }, LEARN_AUTO_MS);
  };

  const answerMcq = (i) => {
    if (result || !view || !view.mcq) return;
    setPick(i);
    const correct = i === view.mcq.answer;
    setResult({ verdict: correct ? 'right' : 'wrong', expected: view.mcq.options[view.mcq.answer] });
    settle(correct);
    armAdvance(correct ? 'right' : 'wrong');
  };
  const answerTyped = () => {
    if (result || !typedValue.trim()) return;
    const r = checkTyped(typedValue, current.card);
    setResult(r);
    settle(r.verdict !== 'wrong');
    armAdvance(r.verdict);
  };
  const revealTyped = () => {
    if (result) return;
    setResult({ verdict: 'shown', expected: acceptedAnswers(current.card)[0] || '' });
    settle(false);
  };
  /* The override moves the card as well as the message, or "I was right" would
     be sympathy with no consequence. It has to undo the miss as well as credit
     the answer: the miss has already knocked the card back to recognition, and
     leaving it there would make being right cost a round. */
  const claimRight = () => {
    setResult(r => ({ ...r, verdict: 'right' }));
    setItems(list => list.map((it, i) => (i === order[qi]
      ? { ...it, box: Math.min(LEARN_MASTER, preBoxRef.current + 1), misses: Math.max(0, it.misses - 1) } : it)));
    setRun(n => n + 1);
    play('right', run); buzz(10);
  };
  const answerRecall = (got) => {
    if (result) return;
    setResult({ verdict: got ? 'right' : 'wrong', expected: quizAnswerText(current.card) });
    settle(got);
    armAdvance(got ? 'right' : 'wrong');
  };
  /* Reading a card is not answering it, so nothing is scored and the card
     comes back before this round is out — with the answer off the screen. */
  const ackPreview = () => {
    setItems(list => list.map((it, i) => (i === order[qi] ? { ...it, seen: true } : it)));
    next(true);
  };

  const next = (missed) => {
    if (leftRef.current === qKey) return;   /* the timer and a tap can land together */
    leftRef.current = qKey;
    clearTimer();
    const list = itemsRef.current;
    const wasMissed = missed == null
      ? !!(result && (result.verdict === 'wrong' || result.verdict === 'shown'))
      : missed;
    /* A missed card goes back at the end of THIS round rather than being held
       over — the point of a round is that you leave it knowing them. Capped at
       one repeat so a card you cannot get does not trap you in the round. */
    let nextOrder = order;
    if (wasMissed && order.filter(x => x === order[qi]).length < 2) nextOrder = order.concat([order[qi]]);
    const at = qi + 1;
    resetQuestion();
    setOrder(nextOrder);
    if (at < nextOrder.length){ setQi(at); return; }
    if (!list.filter(i => i.box < LEARN_MASTER).length){ setPhase('done'); return; }
    /* Round boundaries are where the run is written down, so closing the tab
       between rounds costs nothing. */
    persist(list, round);
    setPhase('round');
  };

  const nextRound = () => {
    setOrder(buildRound(itemsRef.current));
    setQi(0); setRound(r => r + 1);
    leftRef.current = '';
    resetQuestion();
    setPhase('run');
  };

  /* Keyboard: pick with 1–4, carry on with Enter. Re-bound every render on
     purpose, so it is never holding a stale answer handler. */
  useEffect(() => {
    if (phase !== 'run') return;
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Escape'){ onClose(); return; }
      const tag = e.target && e.target.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA';
      if (result){
        if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); next(); }
        return;
      }
      if (typing || !view) return;   /* the answer box owns its own keys */
      if (view.format === 'preview'){
        if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); ackPreview(); }
        return;
      }
      if (view.format === 'mcq' && view.mcq){
        const n = (e.key >= '1' && e.key <= '9') ? Number(e.key) : 0;
        if (n && n <= view.mcq.options.length){ e.preventDefault(); answerMcq(n - 1); }
        return;
      }
      if (view.format === 'recall'){
        if (!shown && (e.key === 'Enter' || e.key === ' ')){ e.preventDefault(); setShown(true); return; }
        if (!shown) return;
        if (e.key === '1' || e.key === 'y'){ e.preventDefault(); answerRecall(true); }
        else if (e.key === '2' || e.key === 'n'){ e.preventDefault(); answerRecall(false); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    if (phase !== 'done' || doneRef.current) return;
    doneRef.current = true;
    if (saveRef.current) saveRef.current(null);   /* finished runs are not resumed */
    onDone(answeredRef.current, subject);
    track('learn_finished', { cards: items.length, answered: answeredRef.current, rounds: round });
    play('done'); buzz([16, 60, 16, 60, 26]);
  }, [phase]);

  /* Whichever way you leave — the cross, Escape, Stop here, the tab — the run
     is written down on the way out. Someone who only opened the setup screen
     and closed it again has not replaced anything, so their old run stands. */
  useEffect(() => () => {
    clearTimer();
    const s = snapRef.current;
    if (!s || !saveRef.current || s.phase === 'setup' || s.phase === 'done') return;
    const worth = s.items.length
      && s.items.some(i => i.box < LEARN_MASTER)
      && s.items.some(i => i.box > 0 || i.misses > 0);
    saveRef.current(worth ? packLearn(s.scope, s.items, s.round) : null);
  }, []);

  const closeBtn = (
    <button onClick={onClose} className="sf-tap" aria-label="Close Learn"
      style={{ width: 38, height: 38, borderRadius: R.pill, background: T.surface, border: `1px solid ${T.border}`,
        cursor: 'pointer', color: T.muted, boxShadow: SH.raised, flexShrink: 0, display: 'flex',
        alignItems: 'center', justifyContent: 'center' }}><Ico name="cross" size={15} weight={2.2} /></button>
  );
  const shell = (children) => (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, background: T.bg, overflowY: 'auto' }}>
      <div style={{ width: '100%', maxWidth: 560, margin: '0 auto', padding: '16px 16px 64px' }}>
        <div className="flex items-center justify-between" style={{ marginBottom: 20 }}>
          <div style={{ fontFamily: SANS, fontSize: 20, fontWeight: 800, color: T.ink, letterSpacing: '-0.02em' }}>Learn</div>
          {closeBtn}
        </div>
        {children}
      </div>
    </div>
  );

  if (phase === 'setup'){
    const enough = scopeCards.length >= QUIZ_MIN;
    return shell(
      <>
        <ScopePicker decks={decks} value={scope} onChange={setScope} label="What to learn" />
        {saved && (
          <Card style={{ padding: 18, marginBottom: 12, borderColor: rgba(T.accent, 0.35) }}>
            <div className="flex items-center gap-2" style={{ marginBottom: 8, color: T.accentInk }}>
              <Ico name="clock" size={16} />
              <div style={{ fontFamily: SANS, fontSize: 14.5, fontWeight: 700, color: T.ink }}>You were part-way through</div>
            </div>
            {/* "0 of 15 learned" is true and sounds like nothing happened. What
                was actually kept is which ones caught you out, so say that. */}
            <Sub style={{ marginBottom: 14 }}>
              {saved.mastered > 0
                ? saved.mastered + ' of ' + saved.list.length + ' learned, ' + (saved.part ? saved.part + ' part-way there' : 'and the rest still to go') + '.'
                : 'You got as far as round ' + saved.round + '. Nothing mastered yet, but it remembers which ones caught you out.'}
              {' '}Carry on from there, or wipe it and start cold.
            </Sub>
            <Btn full kind="primary" onClick={resume}>Pick up where you left off →</Btn>
            <Btn full kind="ghost" onClick={start} style={{ marginTop: 6, fontSize: 14 }}>Start again from scratch</Btn>
          </Card>
        )}
        <Card style={{ padding: 20 }}>
          <Title>Learn this deck properly</Title>
          <Sub style={{ marginTop: 6, marginBottom: 18 }}>
            You will see every card twice over — picking it out of four options first, then producing it from
            memory. A card is only done once you have had it both ways, and anything you miss drops back to
            the easy version and comes round again. Nothing here changes when your cards are next due.
          </Sub>
          {enough ? (
            <>
              <Sub style={{ marginBottom: 14 }}>
                {scopeCards.length} cards in this run. Long answers sit this one out — they belong in the feed, where they get marked.
              </Sub>
              {!saved && <Btn full kind="primary" onClick={start}>Start learning →</Btn>}
            </>
          ) : (
            <Sub>You need at least {QUIZ_MIN} cards to learn from. Make a few more first.</Sub>
          )}
        </Card>
      </>
    );
  }

  if (phase === 'round'){
    const still = items.length - masteredCount;
    return shell(
      <Card style={{ padding: 24, textAlign: 'center' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12, color: T.green }}><Ico name="check" size={34} weight={2} /></div>
        <Title>Round {round} done</Title>
        <Sub style={{ marginTop: 6, marginBottom: 20 }}>Keep going — the ones you missed come back first.</Sub>
        <div style={{ marginBottom: 20 }}>
          <Progress label="Mastered" value={items.length ? (masteredCount / items.length) * 100 : 0}
            valueText={masteredCount + ' of ' + items.length} colour={T.green} />
        </div>
        <div className="flex items-center justify-center gap-3" style={{ marginBottom: 20, flexWrap: 'wrap' }}>
          <Chip colour={T.green}>{masteredCount} mastered</Chip>
          <Chip colour={T.amber}>{still} still learning</Chip>
        </div>
        <Btn full kind="primary" onClick={nextRound}>Next round →</Btn>
        <Btn full kind="ghost" onClick={onClose} style={{ marginTop: 6, fontSize: 14 }}>Stop here — it will keep</Btn>
      </Card>
    );
  }

  if (phase === 'done'){
    const hard = items.filter(i => i.misses > 0).sort((a, b) => b.misses - a.misses);
    return shell(
      <Card style={{ padding: 28, textAlign: 'center' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14, color: T.amber }}><Ico name="trophy" size={40} weight={1.8} fill /></div>
        <Title style={{ fontSize: 23 }}>All {items.length} learned</Title>
        <Sub style={{ marginTop: 8, marginBottom: 22 }}>
          You got every one of them twice, the second time from memory. That is the half that sticks.
          Your due dates have not moved — the feed still decides when you see these next.
        </Sub>
        {hard.length > 0 && (
          <div style={{ ...PANEL, textAlign: 'left', marginBottom: 18 }}>
            <div style={{ fontFamily: SANS, fontSize: 12.5, fontWeight: 700, color: T.muted, marginBottom: 9 }}>
              {hard.length === 1 ? 'This one fought back' : 'These ' + hard.length + ' fought back'}
            </div>
            {hard.slice(0, 4).map((it, i) => (
              <div key={i} className="flex items-start justify-between gap-3" style={{ marginBottom: i === Math.min(hard.length, 4) - 1 ? 0 : 7 }}>
                <div style={{ fontFamily: SANS, fontSize: 13.5, lineHeight: 1.4, color: T.ink,
                  overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box',
                  WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{quizQuestionText(it.card)}</div>
                <Chip colour={T.amber} style={{ flexShrink: 0 }}>{it.misses}×</Chip>
              </div>
            ))}
            {hard.length > 4 && <Sub style={{ marginTop: 8, fontSize: 12.5 }}>and {hard.length - 4} more</Sub>}
          </div>
        )}
        {hard.length > 1 && (
          <Btn full kind="soft" onClick={drillMissed} style={{ marginBottom: 6 }}>
            Drill the {hard.length} that fought back
          </Btn>
        )}
        <Btn full kind="primary" onClick={onClose}>Done</Btn>
      </Card>
    );
  }

  if (!current || !view) return shell(<Card style={{ padding: 24 }}><Sub>Nothing left to learn here.</Sub></Card>);

  const card = current.card;
  const TONE = { right: T.green, close: T.amber, wrong: T.red, shown: T.muted };
  const LABEL = { right: 'Correct', close: 'Nearly — check the spelling', wrong: 'Not quite', shown: 'The answer' };
  const STEP = { mcq: 'Pick the answer', typed: 'From memory', recall: 'Say it, then check', preview: 'Take this one in' };

  return (
    <>
      {shell(
        <>
          <div style={{ marginBottom: 14 }}>
            <Progress label={'Round ' + round} value={items.length ? (masteredCount / items.length) * 100 : 0}
              valueText={masteredCount + ' of ' + items.length + ' mastered'} colour={T.accent} />
          </div>
          <Card style={{ padding: '18px 18px 20px', minHeight: 340 }}>
            <div className="flex items-center justify-between gap-2" style={{ marginBottom: 16 }}>
              <Chip colour={T.muted}>{current.deck.topic || current.deck.subject || 'Card'}</Chip>
              {/* Naming the step is what makes the escalation read as progress
                  rather than as the app randomly getting harder. */}
              <Chip colour={format === 'preview' ? T.faint : (current.box > 0 ? T.accentInk : T.faint)}>{STEP[format]}</Chip>
            </div>

            <div style={{ ...QUESTION, whiteSpace: 'pre-wrap' }}>{quizQuestionText(card)}</div>

            {format === 'mcq' && view.mcq && (
              <div className="flex flex-col gap-2" style={{ marginTop: 18 }} role="group" aria-label="Answer options">
                {view.mcq.options.map((o, i) => {
                  const isRight = i === view.mcq.answer;
                  const chosen = pick === i;
                  const c = !result ? T.border : isRight ? T.green : (chosen ? T.red : T.border);
                  return (
                    <button key={i} className="sf-tap" onClick={() => answerMcq(i)} disabled={!!result}
                      style={{ display: 'flex', alignItems: 'flex-start', gap: 10, textAlign: 'left', width: '100%',
                        background: result && (isRight || chosen) ? rgba(c, 0.10) : T.surface,
                        border: `1.5px solid ${result && (isRight || chosen) ? c : T.border}`, borderRadius: R.well,
                        padding: '13px 15px', cursor: result ? 'default' : 'pointer',
                        fontFamily: SANS, fontSize: 15.5, lineHeight: 1.45, color: T.ink }}>
                      {HAS_KEYBOARD && (
                        <span aria-hidden="true" style={{ flexShrink: 0, minWidth: 18, height: 18, borderRadius: 5,
                          background: T.well, color: T.faint, fontSize: 11, fontWeight: 700, lineHeight: '18px',
                          textAlign: 'center', marginTop: 2 }}>{i + 1}</span>
                      )}
                      <span>{o}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {format === 'preview' && (
              <div style={{ marginTop: 18 }}>
                <Chip colour={T.green} style={{ marginBottom: 8 }}>Answer</Chip>
                <div style={ANSWER}>{quizAnswerText(card)}</div>
                <Sub style={{ marginTop: 14, fontSize: 12.5 }}>
                  Nothing else in this deck looks anything like that, so four options would answer itself.
                  Read it — it comes back before this round is out.
                </Sub>
                <Btn full kind="primary" onClick={ackPreview} style={{ marginTop: 14 }}>Got it — ask me later →</Btn>
              </div>
            )}

            {format === 'typed' && (
              <div style={{ marginTop: 18 }}>
                {!result ? (
                  <>
                    <input ref={inputRef} value={typedValue} onChange={e => setTypedValue(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter'){ e.preventDefault(); answerTyped(); } }}
                      placeholder="Type your answer" aria-label="Your answer"
                      autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
                      style={{ ...INPUT, fontSize: 17, fontWeight: 600 }} />
                    <SymbolBar onInsert={(s) => setTypedValue(v => v + s)} />
                    <div className="flex items-center gap-2" style={{ marginTop: 12 }}>
                      <Btn kind="primary" onClick={answerTyped} disabled={!typedValue.trim()} style={{ flex: 1 }}>Check</Btn>
                      <Btn kind="soft" onClick={revealTyped} style={{ whiteSpace: 'nowrap' }}>Show me</Btn>
                    </div>
                  </>
                ) : (
                  result.verdict !== 'shown' && (
                    <div style={{ ...INPUT, fontSize: 17, fontWeight: 600, background: T.surface,
                      borderColor: rgba(TONE[result.verdict], 0.5) }}>{typedValue}</div>
                  )
                )}
              </div>
            )}

            {format === 'recall' && (
              <div style={{ marginTop: 18 }}>
                {!shown && !result && <Btn full kind="primary" onClick={() => setShown(true)}>Show answer</Btn>}
                {shown && (
                  <div>
                    <Chip colour={T.green} style={{ marginBottom: 8 }}>Answer</Chip>
                    <div style={ANSWER}>{quizAnswerText(card)}</div>
                    {!result && (
                      <div className="flex items-center gap-2" style={{ marginTop: 16 }}>
                        <Btn kind="primary" onClick={() => answerRecall(true)} style={{ flex: 1 }}>I had it</Btn>
                        <Btn kind="soft" onClick={() => answerRecall(false)} style={{ flex: 1 }}>I did not</Btn>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            <div aria-live="polite">
              {result && (
                <div style={{ marginTop: 16 }}>
                  <div className="flex items-center gap-2" style={{ flexWrap: 'wrap' }}>
                    <Chip colour={TONE[result.verdict]} solid={result.verdict === 'right'}>{LABEL[result.verdict]}</Chip>
                    {format === 'typed' && (result.verdict === 'wrong' || result.verdict === 'close') && (
                      <button onClick={claimRight} className="sf-tap"
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px 2px',
                          fontFamily: SANS, fontSize: 13.5, fontWeight: 600, color: T.accentInk }}>I was right →</button>
                    )}
                  </div>
                  {format !== 'mcq' && result.verdict !== 'right' && result.expected && (
                    <div style={{ marginTop: 12 }}>
                      <Chip colour={T.green} style={{ marginBottom: 8 }}>Answer</Chip>
                      <div style={ANSWER}>{result.expected}</div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </Card>

          {result && (
            <div style={{ marginTop: 14 }}>
              <Btn full kind="primary" onClick={() => next()}>Continue →</Btn>
            </div>
          )}
        </>
      )}
    </>
  );
}
/* ==========================================================================
   DIAGNOSE  —  a short test whose output is a list of gaps, not a score.

   The ask behind it: "I want to know what to work on." A quiz answers that
   badly. It tells you 7/10 and leaves you to guess which three, and worse,
   getting a question wrong does not tell you WHY it was wrong — whether the
   term was missing, the mechanism, or the ability to use either one on a
   situation you had not seen.

   So every question here is aimed at ONE checkpoint, and every checkpoint sits
   on a rung of the ladder:

     name   you can NAME or state the thing            (Achieved)
     link   you can EXPLAIN how and why it follows     (Merit)
     apply  you can USE it on a situation and justify  (Excellence)

   That is deliberate, and it is where the NCEA grounding comes from. The
   standards themselves get rebuilt — the Level 1 ones were replaced for 2024
   and the model's memory of them is out of date, which is why NCEA_RULES bars
   it from naming any of them. The LADDER does not get rebuilt. It has survived
   every version, it is already what the marking runs on, and it happens to be
   exactly the distinction a student needs to hear: "you can name it, you
   cannot link it" is a study instruction. "You got 7/10" is not.

   The student can still name their real standard, and it is passed through in
   their words like everywhere else in the app. Nothing here recalls one.

   Two model calls per run — one to plan the test, one to read every answer at
   once. Reading them together is the point: the pattern across the misses is
   the finding, and a per-question marker cannot see it.
   ========================================================================== */
const RUNGS = ['name', 'link', 'apply'];
const RUNG = {
  name:  { label: 'Naming it',   grade: 'Achieved',   blurb: 'stating the terms, processes and facts' },
  link:  { label: 'Linking it',  grade: 'Merit',      blurb: 'explaining how and why one thing causes another' },
  apply: { label: 'Applying it', grade: 'Excellence', blurb: 'using it on a situation you have not seen' },
};
const DIAG_LENGTHS = [
  { v: 6,  label: 'Quick',  note: 'about 5 minutes' },
  { v: 12, label: 'Full',   note: 'about 12 minutes' },
];
const DIAG_KEEP_DAYS = 30;

/* The split is weighted down the ladder on purpose. A gap at "name" makes
   every rung above it fail too, so there is no point asking six Excellence
   questions of someone who cannot name the process — the report would say
   "everything is missing" and be useless. Establish the floor first. */
function rungSplit(n){
  const nameN = Math.max(2, Math.round(n * 0.4));
  const linkN = Math.max(2, Math.round(n * 0.35));
  return { name: nameN, link: linkN, apply: Math.max(1, n - nameN - linkN) };
}

function blueprintPrompt(topic, level, n){
  const s = rungSplit(n);
  return `You are an expert ${level} examiner planning a DIAGNOSTIC on: ${topic}

The purpose is NOT to score the student. It is to find exactly WHERE their understanding stops, so each checkpoint must test ONE separable thing. A student who misses one should learn one specific thing about themselves, not "I am bad at this topic".

Write exactly ${n} checkpoints across three rungs:
- "name" (${s.name} of them): can they NAME, state or define the thing. Demonstrating understanding.
- "link" (${s.link} of them): can they EXPLAIN how and why, with cause and effect joined up. In-depth understanding.
- "apply" (${s.apply} of them): can they use it on a SPECIFIC situation given in the question, linking more than one idea and justifying. Comprehensive understanding.

Return ONLY a JSON array. Each element:
{ "rung": "name" | "link" | "apply",
  "checkpoint": the one thing they must be able to do, 4-12 words, starting with a verb ("name the...", "explain why...", "apply... to...")
  "probe": the question to ask them,
  "expect": what a correct answer MUST contain — the key terms and the causal steps, as a compact note to the marker, NOT a model answer }

Rules:
- PITCH EVERY PROBE AT ${level} AND NO HIGHER. A checkpoint drawn from a level above this one manufactures a gap the student is not supposed to have closed yet, which is worse than asking nothing. If you are unsure whether something is on this course, leave it out.
- A "name" probe must test something worth knowing — a process, a structure, a factor, a rule. Never ask for a word that the question itself defines ("what is the term for how fast a reaction goes"): that tests vocabulary trivia and diagnoses nothing.
- Order them: all "name" first, then "link", then "apply". A student who cannot name it should meet that before being asked to apply it.
- A "name" probe is answerable in a word or a short phrase. A "link" or "apply" probe in one to three sentences. Say so in the probe if it is not obvious.
- NEVER ask two things in one probe.
- An "apply" probe MUST contain a short concrete situation to apply the idea to — invent a plausible one.
- Probes must stand alone. Do not refer to a diagram, a table, a graph, "the text" or "the material" — the student has none in front of them.
- Cover the topic's main ideas rather than circling one.
- No JSON outside the array.${nceaRules(level)}

TOPIC: ${topic}`;
}

function diagnosePrompt(topic, level, items){
  const body = items.map((it, i) => `#${i}  [${it.rung}]  CHECKPOINT: ${it.checkpoint}
PROBE: ${it.probe}
A CORRECT ANSWER MUST CONTAIN: ${it.expect}
STUDENT ANSWER: ${it.answer && it.answer.trim() ? it.answer.trim() : '(left blank — they said they did not know)'}`).join('\n\n');

  return `You are an expert ${level} examiner reading one student's answers to a diagnostic on: ${topic}

You are NOT scoring them. You are telling them what is missing, precisely enough that they know what to study tonight. Judge each answer ONLY against the checkpoint and the expectation printed with it.

${body}

Return ONLY ONE JSON object:
{ "items": [ one per answer, in order:
    { "i": the number after the #,
      "verdict": "solid" | "shaky" | "missing",
      "got": a short phrase naming what they DID get right, or "" if nothing,
      "gap": ONE sentence addressed to the student ("you"), naming the specific thing that is missing — a term, a step, a link, a condition. "" when solid. } ],
  "headline": one sentence naming the rung where their understanding stops and what that means, addressed to them,
  "pattern": one sentence naming what the misses have in common, or "" if they have nothing in common,
  "next": [ 2 to 4 things to go and do, most useful first, each a short phrase. Say what they should be able to DO — "explain temperature using collision frequency AND activation energy" — not "review collision theory". ] }

How to judge:
- "solid": the answer contains what the expectation asks for. Different wording is fine. Do not require their phrasing to match yours.
- "shaky": the right idea is there but incomplete — a term missing, a step of the mechanism skipped, or a link asserted without explaining why it follows.
- "missing": not there, blank, or wrong.
- A blank answer is "missing", and its gap should still name what they would have needed to say.
- Be generous about spelling and grammar. This is a diagnosis of understanding, not of writing.

How to write the gap sentence — this is the whole point of the exercise:
- Name the specific thing. "You named the reactants but did not say the collisions have to exceed the activation energy" is useful. "Revise rates of reaction" is useless and is not an acceptable answer.
- Point at the missing LINK where one is missing: "you know both facts but did not connect the surface area to the number of collisions".
- Never praise, never soften, never pad. One sentence.
- Do not tell them to "review your notes" or "study more".${nceaRules(level)}`;
}

/* Blueprint items the student could actually be asked. A malformed one is
   dropped rather than repaired: a probe with no question in it wastes a slot
   and, worse, produces a "gap" that means nothing. */
function cleanBlueprint(arr, want){
  const out = [];
  for (const o of arr || []){
    if (!o || typeof o !== 'object') continue;
    const probe = String(o.probe == null ? '' : o.probe).trim();
    const checkpoint = String(o.checkpoint == null ? '' : o.checkpoint).trim();
    if (!probe || !checkpoint) continue;
    const rung = RUNGS.indexOf(String(o.rung || '').toLowerCase()) >= 0 ? String(o.rung).toLowerCase() : 'name';
    out.push({ rung: rung, checkpoint: checkpoint, probe: probe,
      expect: String(o.expect == null ? '' : o.expect).trim(), answer: '' });
  }
  /* Up the ladder, whatever order they came back in. */
  out.sort((a, b) => RUNGS.indexOf(a.rung) - RUNGS.indexOf(b.rung));
  return out.slice(0, want);
}

async function buildDiagnostic(topic, level, n){
  const reply = await callModel(blueprintPrompt(topic, level, n), 3000, MODEL_GEN, true);
  return cleanBlueprint(parseJsonArray(reply), n);
}

/* One call for every answer, because the finding is the pattern across them.
   Anything the model failed to judge comes back "shaky" with no gap sentence
   rather than being dropped — a checkpoint that silently vanished from the
   report would read as a pass. */
async function runDiagnosis(topic, level, items){
  const reply = await callModel(diagnosePrompt(topic, level, items), 3000, MODEL_SMART);
  const obj = rescueObjects(reply)[0] || {};
  const byIndex = {};
  for (const r of (Array.isArray(obj.items) ? obj.items : [])){
    const i = Number(r && r.i);
    if (Number.isInteger(i) && i >= 0 && i < items.length) byIndex[i] = r;
  }
  const verdicts = ['solid', 'shaky', 'missing'];
  const results = items.map((it, i) => {
    const r = byIndex[i] || {};
    const v = verdicts.indexOf(String(r.verdict || '').toLowerCase()) >= 0 ? String(r.verdict).toLowerCase() : 'shaky';
    /* A blank answer is a gap whatever the model says about it — the student
       told us they did not know. */
    const blank = !String(it.answer || '').trim();
    return { ...it, verdict: blank ? 'missing' : v,
      got: blank ? '' : String(r.got == null ? '' : r.got).trim(),
      gap: String(r.gap == null ? '' : r.gap).trim() };
  });
  return {
    topic: topic, level: level, at: Date.now(), items: results,
    headline: String(obj.headline == null ? '' : obj.headline).trim(),
    pattern: String(obj.pattern == null ? '' : obj.pattern).trim(),
    next: (Array.isArray(obj.next) ? obj.next : []).map(s => String(s).trim()).filter(Boolean).slice(0, 4),
  };
}

/* Where the wall is: the first rung that is more wrong than right. Named
   rather than scored, because "your naming is fine, your linking is not" is
   the sentence that changes what someone does next. */
function rungTally(items){
  const t = {};
  for (const r of RUNGS) t[r] = { solid: 0, shaky: 0, missing: 0, total: 0 };
  for (const it of items || []){
    const row = t[it.rung];
    if (!row) continue;
    row[it.verdict === 'solid' ? 'solid' : it.verdict === 'missing' ? 'missing' : 'shaky']++;
    row.total++;
  }
  return t;
}
function wallRung(items){
  const t = rungTally(items);
  for (const r of RUNGS){
    if (t[r].total && t[r].solid < t[r].total / 2) return r;
  }
  return null;
}

/* The gaps, turned into material the generator can make cards from. Written as
   study notes rather than as a list of failures, because that is what the card
   prompts expect to read — and because a card that says "you got this wrong"
   is not a card, it is a scold. */
function gapsToSource(report){
  const gaps = (report.items || []).filter(it => it.verdict !== 'solid');
  const lines = ['Revision notes for ' + report.topic + ', focused on the specific points this student has not got yet.', ''];
  for (const g of gaps){
    lines.push('- ' + g.checkpoint.charAt(0).toUpperCase() + g.checkpoint.slice(1) + '.');
    if (g.expect) lines.push('  What a full answer needs: ' + g.expect);
    if (g.gap) lines.push('  What is currently missing: ' + g.gap);
    lines.push('');
  }
  return lines.join('\n');
}

function Diagnose({ decks, defaultLevel, report, onSaveReport, onClose, onMakeCards }){
  const [phase, setPhase] = useState(report ? 'report' : 'setup');  // setup | building | run | marking | report
  const [topic, setTopic] = useState('');
  const [level, setLevel] = useState(defaultLevel || 'NCEA Level 1');
  const [want, setWant] = useState(6);
  const [items, setItems] = useState([]);
  const [qi, setQi] = useState(0);
  const [answer, setAnswer] = useState('');
  const [out, setOut] = useState(report || null);
  const [err, setErr] = useState('');
  const inputRef = useRef(null);

  const current = items[qi] || null;
  const topics = useMemo(() => {
    const seen = [];
    for (const d of (decks || [])){
      const t = (d.topic || d.subject || '').trim();
      if (t && seen.indexOf(t) < 0) seen.push(t);
    }
    return seen.slice(0, 6);
  }, [decks]);

  useEffect(() => {
    if (phase !== 'run' || !inputRef.current) return;
    try { inputRef.current.focus({ preventScroll: true }); } catch (e){}
  }, [phase, qi]);

  const start = async () => {
    const t = topic.trim();
    if (t.length < 3){ setErr('Type what you want tested — a topic, a standard, or a question you keep getting wrong.'); return; }
    setErr(''); setPhase('building');
    try {
      const built = await buildDiagnostic(t, level.trim() || 'NCEA Level 1', want);
      if (built.length < 4) throw new Error('The AI did not return enough questions. Try naming the topic a bit more specifically.');
      setItems(built); setQi(0); setAnswer(''); setPhase('run');
      track('diagnostic_started', { probes: built.length, length: want });
    } catch (e){
      setErr(friendlyApiError(e)); setPhase('setup');
    }
  };

  const submit = async (skipped) => {
    const list = items.map((it, i) => (i === qi ? { ...it, answer: skipped ? '' : answer } : it));
    setItems(list);
    setAnswer('');
    if (qi + 1 < list.length){ setQi(qi + 1); return; }
    setPhase('marking');
    try {
      const r = await runDiagnosis(topic.trim(), level.trim() || 'NCEA Level 1', list);
      setOut(r); setPhase('report');
      if (onSaveReport) onSaveReport(r);
      const gaps = r.items.filter(x => x.verdict !== 'solid').length;
      track('diagnostic_finished', { probes: r.items.length, gaps: gaps, wall: wallRung(r.items) || 'none' });
      play(gaps ? 'ok' : 'done'); buzz(16);
    } catch (e){
      setErr(friendlyApiError(e)); setPhase('run');
    }
  };

  /* Keeps the old report rather than binning it: it is a to-do list, and
     "test me on something else" is not a request to throw the last one away.
     Holding it is also what makes the "see it again" card on the setup screen
     reachable at all. The topic goes, since something else is the point. */
  const restart = () => {
    setPhase('setup'); setItems([]); setQi(0); setAnswer(''); setTopic(''); setErr('');
  };

  const closeBtn = (
    <button onClick={onClose} className="sf-tap" aria-label="Close"
      style={{ width: 38, height: 38, borderRadius: R.pill, background: T.surface, border: `1px solid ${T.border}`,
        cursor: 'pointer', color: T.muted, boxShadow: SH.raised, flexShrink: 0, display: 'flex',
        alignItems: 'center', justifyContent: 'center' }}><Ico name="cross" size={15} weight={2.2} /></button>
  );
  const shell = (children) => (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, background: T.bg, overflowY: 'auto' }}>
      <div style={{ width: '100%', maxWidth: 560, margin: '0 auto', padding: '16px 16px 64px' }}>
        <div className="flex items-center justify-between" style={{ marginBottom: 20 }}>
          <div style={{ fontFamily: SANS, fontSize: 20, fontWeight: 800, color: T.ink, letterSpacing: '-0.02em' }}>Find my gaps</div>
          {closeBtn}
        </div>
        {children}
      </div>
    </div>
  );

  if (phase === 'building' || phase === 'marking'){
    return shell(
      <Card style={{ padding: 30 }}>
        <Loading
          title={phase === 'building' ? 'Working out what to ask you' : 'Reading all your answers together'}
          subtitle={phase === 'building'
            ? 'Breaking ' + (topic.trim() || 'the topic') + ' into the separate things you have to be able to do.'
            : 'The pattern across your answers is the part that matters, so they get read as a set.'} />
      </Card>
    );
  }

  if (phase === 'setup'){
    return shell(
      <>
        <Card style={{ padding: 20 }}>
          <Title>What do you want tested?</Title>
          <Sub style={{ marginTop: 6, marginBottom: 14 }}>
            A short written test whose point is not the score. It asks you to name things, then to explain
            how they link, then to use them on a situation — and tells you which of those three you stop at,
            and exactly what was missing.
          </Sub>
          <input value={topic} onChange={e => setTopic(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter'){ e.preventDefault(); start(); } }}
            placeholder="e.g. rates of reaction, or genetic variation"
            aria-label="Topic to be tested on"
            style={{ ...INPUT, fontSize: 16, fontWeight: 600 }} />
          {topics.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontFamily: SANS, fontSize: 12, fontWeight: 600, color: T.faint, marginBottom: 7 }}>Or from your decks</div>
              <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                {topics.map(t => (
                  <button key={t} className="sf-tap" onClick={() => setTopic(t)}
                    style={{ background: T.well, border: 'none', borderRadius: R.pill, padding: '7px 12px', cursor: 'pointer',
                      fontFamily: SANS, fontSize: 12.5, fontWeight: 600, color: T.muted, maxWidth: 200,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t}</button>
                ))}
              </div>
            </div>
          )}

          <div style={{ marginTop: 16 }}>
            <div style={{ fontFamily: SANS, fontSize: 13, fontWeight: 700, color: T.ink }}>Pitch it at</div>
            <Sub style={{ marginTop: 2, fontSize: 12.5 }}>
              Pick <b>Something else…</b> to name your actual standard. It will use yours — it is not allowed to recall one of its own.
            </Sub>
            <div style={{ position: 'relative', marginTop: 8 }}>
              <select value={LEVEL_PRESETS.includes(level) ? level : '__other'}
                onChange={e => setLevel(e.target.value === '__other' ? '' : e.target.value)}
                aria-label="Level"
                style={{ ...INPUT, paddingRight: 38, fontWeight: 500, appearance: 'none', WebkitAppearance: 'none' }}>
                {LEVEL_PRESETS.map(p => <option key={p} value={p}>{p}</option>)}
                <option value="__other">Something else…</option>
              </select>
              <span style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)',
                color: T.faint, pointerEvents: 'none', display: 'flex' }}><Ico name="chevron" size={15} /></span>
            </div>
            {!LEVEL_PRESETS.includes(level) && (
              <input value={level} onChange={e => setLevel(e.target.value)} autoFocus
                placeholder='e.g. NCEA Level 1 AS92022 genetic variation'
                aria-label="Your standard"
                style={{ ...INPUT, marginTop: 8, fontSize: 14 }} />
            )}
          </div>

          <div style={{ marginTop: 16 }}>
            <div style={{ fontFamily: SANS, fontSize: 13, fontWeight: 700, color: T.ink, marginBottom: 8 }}>How long</div>
            <Segmented value={want} onChange={setWant}
              options={DIAG_LENGTHS.map(l => ({ v: l.v, label: l.label + ' · ' + l.v }))} />
            <Sub style={{ marginTop: 7, fontSize: 12.5 }}>
              {(DIAG_LENGTHS.find(l => l.v === want) || DIAG_LENGTHS[0]).note}. You type short answers — a phrase for the
              naming ones, a sentence or two for the rest.
            </Sub>
          </div>

          {err && <Sub style={{ marginTop: 14, color: T.red }}>{err}</Sub>}
          <Btn full kind="primary" onClick={start} style={{ marginTop: 16 }}>Build my test →</Btn>
        </Card>

        {out && (
          <Card style={{ padding: 16, marginTop: 12 }}>
            <Sub>You have a diagnosis from before on <b>{out.topic}</b>.</Sub>
            <Btn full kind="soft" onClick={() => setPhase('report')} style={{ marginTop: 10, fontSize: 14 }}>See it again</Btn>
          </Card>
        )}
      </>
    );
  }

  if (phase === 'run' && current){
    const r = RUNG[current.rung] || RUNG.name;
    const short = current.rung === 'name';
    return shell(
      <>
        <div style={{ marginBottom: 14 }}>
          <Progress label={r.label} value={(qi / items.length) * 100}
            valueText={(qi + 1) + ' of ' + items.length} colour={T.accent} />
        </div>
        <Card style={{ padding: '18px 18px 20px' }}>
          <div className="flex items-center justify-between gap-2" style={{ marginBottom: 16 }}>
            <Chip colour={T.accentInk}>{r.label}</Chip>
            {/* Naming the rung is half the teaching: it tells them what kind of
                thinking is being asked for before they are judged on it. */}
            <Sub style={{ fontSize: 12 }}>{r.blurb}</Sub>
          </div>
          <div style={{ ...QUESTION, whiteSpace: 'pre-wrap' }}>{current.probe}</div>
          <textarea ref={inputRef} value={answer} onChange={e => setAnswer(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)){ e.preventDefault(); submit(false); } }}
            rows={short ? 2 : 4}
            placeholder={short ? 'A word or a short phrase' : 'One to three sentences'}
            aria-label="Your answer"
            style={{ ...INPUT, marginTop: 18, fontSize: 16, resize: 'vertical' }} />
          <SymbolBar onInsert={(s) => setAnswer(v => v + s)} />
          {err && <Sub style={{ marginTop: 12, color: T.red }}>{err}</Sub>}
          <div className="flex items-center gap-2" style={{ marginTop: 14 }}>
            <Btn kind="primary" onClick={() => submit(false)} disabled={!answer.trim()} style={{ flex: 1 }}>
              {qi + 1 >= items.length ? 'Finish and diagnose →' : 'Next →'}
            </Btn>
            {/* Not knowing is a finding, not a failure — and pretending
                otherwise would have them guess, which pollutes the diagnosis. */}
            <Btn kind="soft" onClick={() => submit(true)} style={{ whiteSpace: 'nowrap' }}>Not sure</Btn>
          </div>
        </Card>
        <Sub style={{ marginTop: 12, textAlign: 'center', fontSize: 12.5 }}>
          Answer in your own words. Half an answer is more useful here than a guess.
        </Sub>
      </>
    );
  }

  if (phase === 'report' && out){
    const tally = rungTally(out.items);
    const wall = wallRung(out.items);
    const gaps = out.items.filter(it => it.verdict !== 'solid');
    const solid = out.items.length - gaps.length;
    return shell(
      <>
        <Card style={{ padding: 22, marginBottom: 12 }}>
          <Chip colour={T.muted} style={{ marginBottom: 10 }}>{out.topic}</Chip>
          <Title style={{ fontSize: 20, lineHeight: 1.35 }}>
            {out.headline || (wall
              ? 'Where it stops is ' + RUNG[wall].label.toLowerCase() + '.'
              : 'No clear gaps in this one.')}
          </Title>
          {out.pattern && <Sub style={{ marginTop: 10 }}>{out.pattern}</Sub>}

          <div style={{ marginTop: 18 }}>
            {RUNGS.map(rg => {
              const t = tally[rg];
              if (!t.total) return null;
              const isWall = wall === rg;
              return (
                <div key={rg} style={{ marginBottom: 12 }}>
                  <div className="flex items-center justify-between gap-2" style={{ marginBottom: 6 }}>
                    <div className="flex items-center gap-2" style={{ flexWrap: 'wrap' }}>
                      <span style={{ fontFamily: SANS, fontSize: 13.5, fontWeight: 700, color: T.ink }}>{RUNG[rg].label}</span>
                      <Sub style={{ fontSize: 12 }}>{RUNG[rg].grade}</Sub>
                      {isWall && <Chip colour={T.amber}>where it stops</Chip>}
                    </div>
                    <span style={{ fontFamily: SANS, fontSize: 12.5, fontWeight: 700, color: T.muted, fontVariantNumeric: 'tabular-nums' }}>
                      {t.solid} / {t.total}
                    </span>
                  </div>
                  {/* One bar per rung, split by verdict, so the shape of the
                      problem is visible before a word of it is read. */}
                  <div style={{ display: 'flex', gap: 2, height: 10 }}>
                    {[['solid', T.green], ['shaky', T.amber], ['missing', T.red]].map(([k, c]) => (
                      t[k] ? <div key={k} title={t[k] + ' ' + k} style={{ flex: t[k], background: c, borderRadius: R.pill }} /> : null
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        {out.next.length > 0 && (
          <Card style={{ padding: 18, marginBottom: 12 }}>
            <div style={{ fontFamily: SANS, fontSize: 13, fontWeight: 700, color: T.muted, marginBottom: 10 }}>Work on these, in this order</div>
            {out.next.map((s, i) => (
              <div key={i} className="flex items-start gap-3" style={{ marginBottom: i === out.next.length - 1 ? 0 : 9 }}>
                <span style={{ flexShrink: 0, width: 20, height: 20, borderRadius: 6, background: rgba(T.accent, 0.14),
                  color: T.accentInk, fontFamily: SANS, fontSize: 11.5, fontWeight: 700, lineHeight: '20px', textAlign: 'center' }}>{i + 1}</span>
                <div style={{ fontFamily: SANS, fontSize: 14.5, lineHeight: 1.45, color: T.ink }}>{s}</div>
              </div>
            ))}
          </Card>
        )}

        {gaps.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontFamily: SANS, fontSize: 13, fontWeight: 700, color: T.muted, margin: '4px 2px 10px' }}>
              What was missing, one by one
            </div>
            {gaps.map((g, i) => {
              const c = g.verdict === 'missing' ? T.red : T.amber;
              return (
                <Card key={i} style={{ padding: 16, marginBottom: 8 }}>
                  <div className="flex items-center gap-2" style={{ marginBottom: 8, flexWrap: 'wrap' }}>
                    <Chip colour={c}>{g.verdict === 'missing' ? 'Not there' : 'Half there'}</Chip>
                    <Sub style={{ fontSize: 12 }}>{RUNG[g.rung].label}</Sub>
                  </div>
                  <div style={{ fontFamily: SANS, fontSize: 15, fontWeight: 650, color: T.ink, lineHeight: 1.4 }}>{g.probe}</div>
                  {g.gap && <div style={{ ...ANSWER, marginTop: 10, color: T.ink }}>{g.gap}</div>}
                  {g.got && <Sub style={{ marginTop: 8 }}><b>You did get:</b> {g.got}</Sub>}
                  {g.answer && g.answer.trim() && (
                    <div style={{ ...PANEL, marginTop: 10 }}>
                      <div style={{ fontFamily: SANS, fontSize: 11.5, fontWeight: 700, color: T.faint, marginBottom: 4 }}>YOU WROTE</div>
                      <div style={{ fontFamily: SANS, fontSize: 13.5, lineHeight: 1.5, color: T.muted, whiteSpace: 'pre-wrap' }}>{g.answer.trim()}</div>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}

        {solid > 0 && (
          <Card style={{ padding: 16, marginBottom: 12 }}>
            <div className="flex items-center gap-2">
              <span style={{ color: T.green, display: 'flex' }}><Ico name="check" size={17} weight={2.2} /></span>
              <Sub style={{ color: T.ink }}>
                {solid} of {out.items.length} were solid. Those are not worth your revision time tonight.
              </Sub>
            </div>
          </Card>
        )}

        {gaps.length > 0 && onMakeCards && (
          <Btn full kind="primary" onClick={() => onMakeCards(gapsToSource(out), out.topic, out.level)}>
            Make cards from what's missing →
          </Btn>
        )}
        <Btn full kind="soft" onClick={restart} style={{ marginTop: 8 }}>Test me on something else</Btn>
        <Btn full kind="ghost" onClick={onClose} style={{ marginTop: 4, fontSize: 14 }}>Done</Btn>
      </>
    );
  }

  return shell(<Card style={{ padding: 24 }}><Sub>Nothing to show.</Sub><Btn full kind="soft" onClick={restart} style={{ marginTop: 12 }}>Start again</Btn></Card>);
}
function ModalScrim({ onClose, children, maxW = 460 }){
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(15,17,25,0.5)',
      backdropFilter: 'blur(3px)', WebkitBackdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center',
      justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: maxW, maxHeight: '86vh', overflowY: 'auto',
        background: T.surface, borderRadius: R.card, border: `1px solid ${T.border}`, boxShadow: SH.card,
        animation: 'sf-in 240ms cubic-bezier(.2,.8,.3,1)' }}>
        {children}
      </div>
    </div>
  );
}

/* Shared changelog markup — used by both the pop-up (WhatsNew) and the tab
   (Changelog) so there's one source of truth for how releases are shown. */
function PatchNotesList({ notes, showVersion }){
  const list = notes || PATCH_NOTES;
  return (
    <div>
      {list.map((rel, ri) => (
        <div key={rel.v} style={{ marginTop: ri ? 22 : 0 }}>
          <div className="flex items-baseline gap-2">
            <Title style={{ fontSize: 19 }}>{rel.title}</Title>
            <Sub style={{ fontSize: 12 }}>{showVersion === false ? rel.date : 'v' + rel.v + ' · ' + rel.date}</Sub>
          </div>
          <div className="flex flex-col gap-2" style={{ marginTop: 12 }}>
            {rel.items.map((it, i) => (
              <div key={i} className="flex gap-3" style={{ alignItems: 'flex-start' }}>
                <span style={{ color: T.green, fontWeight: 800, fontSize: 14, lineHeight: '20px', flexShrink: 0 }}>›</span>
                <span style={{ fontFamily: SANS, fontSize: 14, lineHeight: 1.5, color: T.ink }}>{it}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function WhatsNew({ onClose }){
  return (
    <ModalScrim onClose={onClose} maxW={480}>
      <div style={{ padding: '22px 22px 20px' }}>
        <div className="flex items-center justify-between" style={{ marginBottom: 16 }}>
          <Chip colour={T.accent} solid>What's new</Chip>
          <button onClick={onClose} className="sf-tap" aria-label="Close"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.faint, padding: 2, display: 'flex' }}><Ico name="cross" size={17} /></button>
        </div>
        <PatchNotesList />
        <div style={{ marginTop: 22 }}>
          <Btn full kind="primary" onClick={onClose}>Got it</Btn>
        </div>
      </div>
    </ModalScrim>
  );
}

/* The way in for someone who has no notes on them. Generation is the app's
   main event, but it asks for material the visitor may not be carrying, takes
   ~11s, and is the one path that can fail on the free tier — a bad first
   minute. These decks are already written, so the first thing a stranger sees
   is a real long-answer card rather than an upload box. */
function StarterPicker({ onAdd, onClose }){
  return (
    <ModalScrim onClose={onClose} maxW={520}>
      <div style={{ padding: '22px 22px 20px' }}>
        <div className="flex items-center justify-between" style={{ marginBottom: 6 }}>
          <Chip colour={T.accent} solid>Ready-made</Chip>
          <button onClick={onClose} className="sf-tap" aria-label="Close"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.faint, padding: 2, display: 'flex' }}><Ico name="cross" size={17} /></button>
        </div>
        <Title style={{ marginTop: 10 }}>Start with a deck we made</Title>
        <Sub style={{ marginTop: 6, marginBottom: 18 }}>
          No notes on you? Take one of these and start straight away. They work exactly like your own decks — study them, edit them, or delete them later.
        </Sub>
        <div className="flex flex-col gap-2.5">
          {STARTER_DECKS.map(d => {
            const n = starterCounts(d);
            const colour = subjectColour(d.subject);
            return (
              <button key={d.slug} className="sf-tap" onClick={() => onAdd(d.slug)}
                style={{ display: 'flex', gap: 13, alignItems: 'flex-start', textAlign: 'left', width: '100%',
                  background: T.surface, border: `1px solid ${T.border}`, borderRadius: R.card,
                  padding: 14, cursor: 'pointer', boxShadow: SH.raised }}>
                <Tile colour={colour} glyph={d.subject.trim().charAt(0).toUpperCase()} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: SANS, fontSize: 15.5, fontWeight: 700, color: T.ink }}>{d.topic}</div>
                  <Sub style={{ fontSize: 13, marginTop: 2 }}>{d.blurb}</Sub>
                  <div className="flex items-center gap-1.5" style={{ marginTop: 8, flexWrap: 'wrap' }}>
                    <Chip colour={T.muted}>{d.subject}</Chip>
                    <Chip colour={T.muted}>{n.total} cards</Chip>
                    {/* the long answers are the reason to pick one of these up */}
                    <Chip colour={T.accentInk}>{n.long} long answer{n.long === 1 ? '' : 's'}</Chip>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
        <Sub style={{ fontSize: 12.5, marginTop: 14 }}>
          Written for NCEA Level 1, but the marking works the same whatever you study.
        </Sub>
      </div>
    </ModalScrim>
  );
}

/* The card is always shown before it can go anywhere. Sharing is the one thing
   in this app that leaves the device, so it does not happen on a single tap
   from a screen where the student has not seen what they would be posting. */
function ShareSheet({ kind, data, onClose }){
  const [url, setUrl] = useState('');
  const [blob, setBlob] = useState(null);
  const [err, setErr] = useState('');
  const [state, setState] = useState('');   // '', 'saved', 'shared'

  useEffect(() => {
    let dead = false, made = '';
    /* Opened the sheet. The gap between this and share_completed is how many
       people look at the card and then do not post it. */
    track('share_opened', { kind: String(kind) });
    (async () => {
      try {
        const b = await makeShareBlob(kind, data);
        if (!b){ if (!dead) setErr('Could not draw the card on this device.'); return; }
        made = URL.createObjectURL(b);
        if (dead){ URL.revokeObjectURL(made); return; }
        setBlob(b); setUrl(made);
      } catch { if (!dead) setErr('Could not draw the card on this device.'); }
    })();
    return () => { dead = true; if (made) URL.revokeObjectURL(made); };
  }, [kind]);

  const filename = 'study-feed-' + (kind === 'grade'
    ? safeFileName(data.grade, 'grade') : 'session') + '-' + TODAY() + '.png';

  const go = async () => {
    const r = await shareBlob(blob, filename, 'Made with Study Feed — ' + SHARE_URL);
    /* result is shared / saved / cancelled / failed — on a phone "shared" means
       the OS sheet took it, which is as far as we can ever see. */
    track('share_completed', { kind: String(kind), result: String(r) });
    if (r === 'failed') setErr('Could not share from this browser. Try saving it instead.');
    else if (r !== 'cancelled') setState(r);
  };

  return (
    <ModalScrim onClose={onClose} maxW={420}>
      <div style={{ padding: '20px 20px 18px' }}>
        <div className="flex items-center justify-between" style={{ marginBottom: 14 }}>
          <Chip colour={T.accentInk}>Share this</Chip>
          <button onClick={onClose} className="sf-tap" aria-label="Close"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.faint, padding: 2, display: 'flex' }}><Ico name="cross" size={17} /></button>
        </div>

        {/* 9:16, so the preview is tall — capped so the buttons stay on screen */}
        <div style={{ background: T.well, borderRadius: R.well, overflow: 'hidden',
          display: 'grid', placeItems: 'center', minHeight: 240, maxHeight: '46vh' }}>
          {url
            ? <img src={url} alt="Your share card" style={{ display: 'block', maxHeight: '46vh', maxWidth: '100%', objectFit: 'contain' }} />
            : <div style={{ padding: 30 }}><Loading size={64} title="Making your card…" /></div>}
        </div>

        <Sub style={{ fontSize: 12.5, marginTop: 10 }}>
          {kind === 'grade'
            ? 'Shows a bit of what you wrote and why it scored. The question itself isn\'t on it.'
            : 'Just your totals and subjects — no card content.'}
        </Sub>

        {err && <Sub style={{ marginTop: 8, color: T.red }}>{err}</Sub>}
        {state === 'saved' && <Sub style={{ marginTop: 8, color: T.green }}>Saved to your device — post it from there.</Sub>}
        {state === 'shared' && <Sub style={{ marginTop: 8, color: T.green }}>Sent.</Sub>}

        <div className="flex gap-2" style={{ marginTop: 14 }}>
          <Btn full kind="primary" onClick={go} disabled={!blob}>Share</Btn>
          <Btn kind="soft" onClick={onClose} style={{ whiteSpace: 'nowrap' }}>Not now</Btn>
        </div>
      </div>
    </ModalScrim>
  );
}

/* Deliberately quiet: a link-weight button, not a second primary. The share is
   offered at a good moment, it does not compete with what the student came to
   do — and a loud one on every Excellence would wear out fast. */
function ShareLink({ label, onClick, style }){
  return (
    <button className="sf-tap" onClick={onClick}
      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '10px 2px',
        fontFamily: SANS, fontSize: 13.5, fontWeight: 600, color: T.accentInk, ...style }}>
      <span className="flex items-center justify-center gap-2"><Ico name="sparkle" size={15} />{label}</span>
    </button>
  );
}

/* ==========================================================================
   FIRST-RUN TOUR

   Pointers on the real screen, not a slideshow about it. A step either
   SPOTLIGHTS a live element — a hole cut in the scrim, so the thing stays
   tappable while it is being talked about — or STAGES a piece of the app to
   try. Only one thing is staged: the long-answer card, because it is the one
   screen a new account cannot reach, having no cards yet.

   The grade ladder is deliberately not taught here. These are school students
   and Achieved / Merit / Excellence is what their teachers say every day;
   three panels of it buried the parts that are actually particular to this app.

   The staged card is the real ExtendedFace with `demo` set, so it cannot drift
   from the component it is teaching. The cost is that TUT_MARK has to keep the
   shape markPrompt asks for.
   ========================================================================== */

const TUT_CARD = {
  id: 'tutorial-example', type: 'extended', verb: 'Explain', marks: 4,
  prompt: 'A cyclist stops pedalling on a flat road and slowly coasts to a stop. Explain why the cyclist slows down and eventually stops.',
};

/* offered as "write one for me" so nobody hits a disabled Mark button and
   decides the tour is broken */
const TUT_ANSWER = 'The bike slows down because of friction between the tyres and the road. Friction is a force that pushes against the movement, so the bike loses speed until it stops.';

const TUT_MARK = {
  grade: 'Merit',
  hit: [
    'Names friction as a force acting against the motion.',
    'Links that force to the loss of speed — cause and effect, not just a label.',
  ],
  missing: [
    'Say the forces are now unbalanced: with nothing driving the bike forward, the resultant force acts backwards.',
    'Follow the energy — the cyclist’s kinetic energy is transferred to heat and sound, so there is none left to keep them moving.',
  ],
  lift: 'You have said what happens. The next grade up needs the unbalanced force named AND the energy followed through to where it ends up.',
  /* Every quote here is copied out of TUT_ANSWER character for character, which
     is exactly what markPrompt demands of the model — if one of these stops
     matching, locateNotes drops it and the tour quietly shows fewer highlights
     than it is describing. */
  notes: [
    { quote: 'friction between the tyres and the road', kind: 'good',
      note: 'The force is named and located, not just called "resistance".' },
    { quote: 'pushes against the movement', kind: 'good',
      note: 'Direction is stated, which is what turns a label into an explanation.' },
    { quote: 'the bike loses speed until it stops', kind: 'weak',
      note: 'This restates the question. Say WHY the speed goes — the forces are unbalanced, and the kinetic energy has gone somewhere.' },
  ],
};

const TUT_HINTS = [
  'Name every force acting on the bike once the pedalling stops.',
  'Say what "unbalanced" means for the resultant force here.',
  'Follow the kinetic energy — where does it end up?',
];

const TUT_STARTERS = [
  'Once the cyclist stops pedalling the forces become unbalanced because ______.',
  'This means the resultant force acts ______, which causes ______.',
  'The cyclist’s kinetic energy is transferred to ______, so ______.',
];

/* Shaped like upgradePrompt's schema (target / steps[move, where, example] /
   habit), and `where` quotes TUT_ANSWER the way a real reply quotes the student.
   Someone who wrote their own answer instead gets these quotes anyway — the
   same compromise the canned mark already makes, and the tour says up front
   that none of it is saved. */
const TUT_UPGRADE = {
  target: 'Excellence',
  gap: 'Right now you describe what happens: friction acts, the bike slows. "Explain" asks for the mechanism underneath that — why the motion changes, not just that it does. The two things carrying the top marks here are the resultant force being unbalanced, and the energy going somewhere specific.',
  steps: [
    { move: 'Say the forces are unbalanced, not just that one is present.',
      where: '“friction between the tyres and the road”',
      example: 'With nothing driving the bike forward, friction is now unbalanced, so the resultant force acts backwards against the direction of travel.',
      why: 'Naming the resultant force is what makes this an explanation of the deceleration rather than a description of it.' },
    { move: 'Follow the energy to where it actually ends up.',
      where: '“the bike loses speed until it stops”',
      example: 'The kinetic energy the cyclist had is transferred to heat and sound at the tyres and axle, so there is none left to keep them moving.',
      why: 'Energy that is only said to be "lost" reads as unfinished; tracking it to heat and sound closes the mechanism.' },
  ],
  habit: 'When a question asks why something slows or stops, name the unbalanced force AND say where the energy went. That pair is what the top grade is looking for.',
};

const TUT_DEMO = { hints: TUT_HINTS, starters: TUT_STARTERS, mark: TUT_MARK, example: TUT_ANSWER, upgrade: TUT_UPGRADE };

/* Anchors are data-tour attributes on the real components. Both nav bars are
   in the DOM at every width (one is display:none), and Create stays mounted
   behind display:none when you are on another tab — so a plain querySelector
   hands back a hidden node about a third of the time. getClientRects() is the
   right visibility test here: a fixed sidebar has no offsetParent even when it
   is perfectly visible on screen. */
function tourAnchor(key){
  const all = document.querySelectorAll('[data-tour="' + key + '"]');
  for (let i = 0; i < all.length; i++){
    if (all[i].getClientRects().length > 0) return all[i];
  }
  return null;
}

const TOUR_STEPS = [
  {
    key: 'welcome', kind: 'stage', tab: 'home',
    title: 'Two things worth knowing',
    lede: 'Half a minute, and you can poke at everything as we go.',
    body: () => (
      <div style={{ textAlign: 'left' }}>
        <Sub style={{ fontSize: 14.5, lineHeight: 1.6 }}>
          It turns your own notes into cards — and it marks the long written answers,
          which is the bit flashcards have never helped with.
        </Sub>
        <div style={{ ...PANEL, marginTop: 14, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <span style={{ color: T.accentInk, flexShrink: 0, marginTop: 1 }}><Ico name="sparkle" size={16} /></span>
          <Sub style={{ fontSize: 13.5, lineHeight: 1.55 }}>
            It ships empty. Everything in here will be yours.
          </Sub>
        </div>
      </div>
    ),
  },
  {
    key: 'nav-create', kind: 'spot', anchor: 'nav-create',
    title: 'Everything starts in Create',
    body: 'This is the only tab you need on day one.',
  },
  {
    key: 'upload', kind: 'spot', tab: 'create', anchor: 'create-upload',
    title: 'Feed it your material',
    body: 'A PDF, Word doc, slides, or a photo of the whiteboard. Files are read on your phone — only the text and pictures inside get sent.',
  },
  {
    key: 'source', kind: 'spot', tab: 'create', anchor: 'create-source',
    title: 'Or just paste and type',
    body: 'Notes straight out of your book work fine. No notes at all? A topic like “rates of reaction” is enough to start.',
  },
  {
    key: 'type', kind: 'spot', tab: 'create', anchor: 'create-type',
    title: 'Pick what comes out',
    body: 'Quick is fast recall. Long is exam-style written questions. Mixed lets it choose per idea — leave it there to begin with.',
  },
  {
    key: 'level', kind: 'spot', tab: 'create', anchor: 'create-level',
    title: 'Set your level',
    body: 'This decides how hard the questions are and what the marking expects of you. Then hit Generate — nothing is saved until you have looked the cards over.',
  },
  {
    key: 'long', kind: 'stage', tab: 'create',
    title: 'This is a long-answer card',
    lede: 'A real one — every button on it works, and nothing you do here is saved.',
    body: () => (
      <div>
        {/* The buttons are the whole point of staging this, and on first sight
            they read as decoration on an example. So all three get named, in the
            order they appear — the third one does not exist until the mark comes
            back, which is exactly why it went unnoticed. */}
        <div style={{ ...PANEL, marginBottom: 14 }}>
          <div className="flex items-center gap-2" style={{ marginBottom: 10 }}>
            <span style={{ color: T.accentInk, display: 'flex' }}><Ico name="bulb" size={16} /></span>
            <span style={{ fontFamily: SANS, fontSize: 13.5, fontWeight: 700, color: T.ink }}>Press them — all three work</span>
          </div>
          <div className="flex flex-col gap-2">
            {[
              ['Stuck? Give me some writing points', 'the help you get while you are writing'],
              ['Mark my answer', 'the grade, and what it says is missing'],
              ['How do I get to Excellence?', 'shows up under the mark — it rewrites your own sentences'],
            ].map(([label, note], n) => (
              <div key={label} className="flex gap-2" style={{ alignItems: 'flex-start' }}>
                <span style={{ fontFamily: SANS, fontSize: 12, fontWeight: 800, color: T.accentInk,
                  lineHeight: '20px', flexShrink: 0 }}>{n + 1}</span>
                <Sub style={{ fontSize: 13.5, lineHeight: 1.5 }}>
                  <b style={{ color: T.ink }}>{label}</b> — {note}
                </Sub>
              </div>
            ))}
          </div>
          <Sub style={{ fontSize: 12.5, marginTop: 10, lineHeight: 1.5 }}>
            Don't fancy writing four marks about a bicycle? <b style={{ color: T.ink }}>Write one for me</b> fills it in.
          </Sub>
        </div>
        <Card style={{ padding: '18px 18px 20px', boxShadow: SH.raised, textAlign: 'left' }}>
          <ExtendedFace card={TUT_CARD} phase="attempt" deck={{ standard: 'NCEA Level 1' }} demo={TUT_DEMO} />
        </Card>
        <Sub style={{ marginTop: 13, fontSize: 13, lineHeight: 1.55 }}>
          The verb and the mark count are telling you how to answer before you write a word:
          <b style={{ color: T.ink }}> Explain</b> wants cause and effect, and 4 marks is not one sentence.
        </Sub>
      </div>
    ),
  },
  {
    key: 'nav-feed', kind: 'spot', tab: 'create', anchor: 'nav-feed',
    title: 'Then they come back here',
    body: 'Your cards return on a schedule, hardest first. The feed ends on purpose when you are done — carrying on is a choice, and it never messes with your schedule.',
  },
  {
    /* Last, and worth the extra step: there is no account and no sync, so a
       cleared browser takes a term's work with it. The home-backup Tip says the
       same thing, but not until you already have cards worth losing. */
    key: 'nav-settings', kind: 'spot', tab: 'create', anchor: 'nav-settings',
    title: 'One thing before you start',
    body: 'Your decks live on this device only — no account, no sync. Clearing your browser wipes them, so export a copy from You → Backup & transfer once you have made a few.',
  },
];

/* onDone fires on finishing OR skipping — both mean "do not show this again".
   `finished` only decides whether we drop them on the Create tab afterwards:
   someone who skipped has said they want to look around by themselves, so they
   are put back on the tab they were reading when the tour opened. */
function Tutorial({ onDone, onNavigate, tab }){
  const [i, setI] = useState(0);
  const [rect, setRect] = useState(null);
  const startTab = useRef(tab);
  const bodyRef = useRef(null);
  const step = TOUR_STEPS[i];
  const last = i === TOUR_STEPS.length - 1;

  const back = () => setI(n => Math.max(0, n - 1));
  const next = () => { if (last) onDone(true); else setI(n => Math.min(TOUR_STEPS.length - 1, n + 1)); };
  const skip = () => { onNavigate(startTab.current); onDone(false); };

  /* put the app on the screen this step is about, before anything is measured */
  useEffect(() => { if (step.tab) onNavigate(step.tab); }, [i]);

  useEffect(() => {
    if (step.kind !== 'spot'){ setRect(null); return; }
    let alive = true;
    let brought = false;   // scroll once, on the first attempt that finds it
    const measure = (mayScroll) => {
      const el = tourAnchor(step.anchor);
      if (!el){ if (alive) setRect(null); return; }
      if (mayScroll && !brought){
        brought = true;
        el.scrollIntoView({ block: 'center', inline: 'nearest' });
      }
      const r = el.getBoundingClientRect();
      if (alive) setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    };
    /* The tab switch above only lands on the next commit, and until then Create
       is still display:none — measuring once gives a rect of zero and a hole in
       the top-left corner. Re-measuring costs nothing and removes the race. */
    const timers = [0, 60, 180, 340].map(d => setTimeout(() => measure(true), d));
    const remeasure = () => measure(false);
    window.addEventListener('resize', remeasure);
    window.addEventListener('scroll', remeasure, true);
    return () => {
      alive = false;
      timers.forEach(clearTimeout);
      window.removeEventListener('resize', remeasure);
      window.removeEventListener('scroll', remeasure, true);
    };
  }, [i]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') skip();
      /* arrows belong to the answer box once there is one to type in */
      else if (step.kind === 'stage' && e.target && /^(TEXTAREA|INPUT|SELECT)$/.test(e.target.tagName)) return;
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') back();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [i, last]);

  useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = 0; }, [i]);

  const dots = (
    <div className="flex items-center gap-1.5" style={{ flexShrink: 0 }}>
      {TOUR_STEPS.map((s, n) => (
        <span key={s.key} style={{ width: n === i ? 18 : 6, height: 6, borderRadius: 6,
          background: n === i ? T.accent : n < i ? rgba(T.accent, 0.4) : 'var(--sf-track)',
          transition: 'width 240ms cubic-bezier(.2,.8,.3,1), background 240ms' }} />
      ))}
    </div>
  );

  const controls = (compact) => (
    <div className="flex items-center gap-2" style={{ marginTop: compact ? 14 : 18, flexWrap: 'wrap' }}>
      {dots}
      <button onClick={skip} className="sf-tap"
        style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer',
          fontFamily: SANS, fontSize: 13, fontWeight: 600, color: T.faint, padding: '4px 6px' }}>Skip</button>
      {i > 0 && <Btn kind="soft" onClick={back} style={{ fontSize: 13.5, padding: '9px 14px' }}>Back</Btn>}
      <Btn kind="primary" onClick={next} style={{ fontSize: 13.5, padding: '9px 16px' }}>
        {last ? 'Make my first cards' : 'Next'}
      </Btn>
    </div>
  );

  /* A staged step, and the fallback when a spotlight's anchor is not on screen
     — Create in "Type them" mode hides half of them, and a replay from Settings
     can start anywhere. Losing the hole should cost the pointer, not the step. */
  if (step.kind === 'stage' || !rect){
    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 80, background: rgba('#000', 0.5),
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 14 }}>
        <div ref={bodyRef} style={{ width: '100%', maxWidth: 520, maxHeight: '100%', overflowY: 'auto',
          background: T.bg, border: `1px solid ${T.border}`, borderRadius: R.card, boxShadow: SH.pop,
          padding: '22px 20px', animation: 'sf-in 280ms cubic-bezier(.2,.8,.3,1)' }}>
          <div key={step.key}>
            <Title style={{ fontSize: 21, fontWeight: 800 }}>{step.title}</Title>
            {step.lede && <Sub style={{ marginTop: 4 }}>{step.lede}</Sub>}
            <div style={{ marginTop: 15 }}>
              {typeof step.body === 'function' ? step.body() : <Sub style={{ fontSize: 14.5, lineHeight: 1.6 }}>{step.body}</Sub>}
            </div>
            {controls(false)}
          </div>
        </div>
      </div>
    );
  }

  /* Four panels around the target rather than one dimmed sheet with a mask:
     the gap between them is a real hole, so the element underneath is still
     genuinely tappable while the pointer is on it. */
  const pad = 6;
  const hTop = rect.top - pad, hLeft = rect.left - pad;
  const hW = rect.width + pad * 2, hH = rect.height + pad * 2;
  const vw = window.innerWidth, vh = window.innerHeight;
  const dim = { position: 'fixed', background: rgba('#000', 0.5), zIndex: 80 };

  const bw = Math.min(340, vw - 24);
  const bLeft = Math.max(12, Math.min(rect.left + rect.width / 2 - bw / 2, vw - bw - 12));
  /* Anchoring to `bottom` when the bubble goes above means its height never has
     to be measured — which would otherwise take a second render to settle. */
  const below = (vh - (hTop + hH)) > 210 || (vh - (hTop + hH)) >= hTop;
  const vpos = below ? { top: hTop + hH + 12 } : { bottom: (vh - hTop) + 12 };

  return (
    <div>
      <div style={{ ...dim, top: 0, left: 0, right: 0, height: Math.max(0, hTop) }} />
      <div style={{ ...dim, top: hTop + hH, left: 0, right: 0, bottom: 0 }} />
      <div style={{ ...dim, top: hTop, left: 0, width: Math.max(0, hLeft), height: hH }} />
      <div style={{ ...dim, top: hTop, left: hLeft + hW, right: 0, height: hH }} />

      <div style={{ position: 'fixed', top: hTop, left: hLeft, width: hW, height: hH, zIndex: 81,
        border: `2px solid ${T.accent}`, borderRadius: R.well, pointerEvents: 'none',
        boxShadow: `0 0 0 4px ${rgba(T.accent, 0.22)}`, animation: 'sf-halo 1.9s ease-in-out infinite',
        transition: 'top 220ms cubic-bezier(.2,.8,.3,1), left 220ms cubic-bezier(.2,.8,.3,1), width 220ms, height 220ms' }} />

      <div style={{ position: 'fixed', left: bLeft, width: bw, zIndex: 82, ...vpos,
        background: T.surface, border: `1px solid ${T.border}`, borderRadius: R.card,
        boxShadow: SH.pop, padding: '15px 16px 14px', animation: 'sf-in 240ms cubic-bezier(.2,.8,.3,1)' }}>
        <div key={step.key}>
          <div style={{ fontFamily: SANS, fontSize: 16, fontWeight: 800, color: T.ink, letterSpacing: '-0.01em' }}>{step.title}</div>
          <Sub style={{ marginTop: 5, fontSize: 13.5, lineHeight: 1.55 }}>
            {typeof step.body === 'function' ? step.body() : step.body}
          </Sub>
          {controls(true)}
        </div>
      </div>
    </div>
  );
}

/* Full-page version of the changelog (its own nav tab). Two sections: what has
   shipped since launch, and the development history behind a second tab for
   anyone who wants it. */
function Changelog(){
  const [tab, setTab] = useState('now');
  const pre = tab === 'before';
  return (
    <div>
      <Title style={{ marginBottom: 6 }}>What's new</Title>
      <Sub style={{ marginBottom: 14 }}>Every update to Study Feed, newest first.</Sub>
      <div style={{ marginBottom: 14 }}>
        <Segmented value={tab} onChange={setTab}
          options={[{ v: 'now', label: 'Updates' }, { v: 'before', label: 'Before launch' }]} />
      </div>
      <Card style={{ padding: 18, boxShadow: SH.raised }}>
        {pre && (
          <Sub style={{ fontSize: 12.5, marginBottom: 16, paddingBottom: 14, borderBottom: `1px solid ${T.border}` }}>
            How Study Feed got built, before anyone was using it.
          </Sub>
        )}
        <PatchNotesList notes={pre ? PRELAUNCH_NOTES : PATCH_NOTES} showVersion={!pre} />
      </Card>
    </div>
  );
}

/* The feature-request screen (its own nav tab). FeedbackForm carries its own
   heading, so the page just gives it room. */
function FeatureRequest(){
  return (
    <div>
      <Title style={{ marginBottom: 14 }}>Ideas &amp; requests</Title>
      <FeedbackForm />
    </div>
  );
}

const FEEDBACK_TO = 'eason.op123@gmail.com';
function FeedbackForm(){
  const [type, setType] = useState('feature');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState('');   // '', 'sent', 'mailto', 'error'

  const openMailto = () => {
    const subject = `Study Feed ${type} from ${name || 'a student'}`;
    const body = `Type: ${type}\nName: ${name}\nEmail: ${email}\n\n${message}`;
    const href = `mailto:${FEEDBACK_TO}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    try { window.location.href = href; } catch {}
  };

  const submit = async () => {
    if (!message.trim()) return;
    setBusy(true); setState('');
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, name, email, message }),
      });
      if (res.ok){ setState('sent'); setMessage(''); }
      else { openMailto(); setState('mailto'); }
    } catch { openMailto(); setState('mailto'); }
    finally { setBusy(false); }
  };

  if (state === 'sent'){
    return (
      <Card style={{ padding: 16, marginBottom: 10, boxShadow: SH.raised }}>
        <div style={{ fontFamily: SANS, fontSize: 15, fontWeight: 700, color: T.green }}>
        <span className="flex items-center gap-2"><Ico name="check" size={16} weight={2.4} />Thanks — sent</span>
      </div>
        <Sub style={{ fontSize: 13, marginTop: 4 }}>Your note is on its way. Want to add another?</Sub>
        <Btn kind="soft" onClick={() => setState('')} style={{ marginTop: 12, fontSize: 14 }}>Send another</Btn>
      </Card>
    );
  }

  const labelStyle = { fontFamily: SANS, fontSize: 12.5, fontWeight: 700, color: T.muted, marginBottom: 5 };
  return (
    <Card style={{ padding: 15, marginBottom: 10, boxShadow: SH.raised }}>
      <div style={{ fontFamily: SANS, fontSize: 15, fontWeight: 700, color: T.ink }}>Request a feature</div>
      <Sub style={{ fontSize: 12.5, marginTop: 2, marginBottom: 12 }}>Something you wish it did, or a bug you hit? Tell the maker directly.</Sub>

      <div style={{ marginBottom: 10 }}>
        <div style={labelStyle}>This is a…</div>
        <Segmented value={type} onChange={setType}
          options={[{ v: 'feature', label: 'Feature' }, { v: 'bug', label: 'Bug' }, { v: 'other', label: 'Other' }]} />
      </div>
      <div className="grid grid-cols-2 gap-2" style={{ marginBottom: 10 }}>
        <div>
          <div style={labelStyle}>Name</div>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Your name" style={{ ...INPUT, fontSize: 14 }} />
        </div>
        <div>
          <div style={labelStyle}>Email <span style={{ fontWeight: 500, color: T.faint }}>(so they can reply)</span></div>
          <input value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" style={{ ...INPUT, fontSize: 14 }} />
        </div>
      </div>
      <div style={{ marginBottom: 12 }}>
        <div style={labelStyle}>Your message</div>
        <textarea value={message} onChange={e => setMessage(e.target.value)} rows={4}
          placeholder="What would you like to see?" style={{ ...INPUT, fontSize: 14, resize: 'vertical' }} />
      </div>
      {state === 'mailto' && <Sub style={{ fontSize: 12.5, color: T.amber, fontWeight: 600, marginBottom: 10 }}>Opening your email app to send it — just hit send there.</Sub>}
      <Btn full kind="primary" onClick={submit} disabled={busy || !message.trim()}>{busy ? 'Sending…' : 'Send to the maker'}</Btn>
    </Card>
  );
}

/* ==========================================================================
   ASK  —  the helper that sits beside everything. Same model as the rest of
   the app, but a real back-and-forth, and it's handed the card on screen so
   "why is that the answer?" works without retyping the question. The thread
   is memory-only: it isn't revision material worth a storage slot, and a
   fresh start is usually what you want next session anyway.
   ========================================================================== */
function AskIcon({ size = 24 }){
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.5 11.5a7.5 7.5 0 0 1-11 6.6L4.5 19.5l1.4-4.6a7.5 7.5 0 1 1 14.6-3.4z" />
      <path d="M12 8.2l.85 2.05 2.05.85-2.05.85L12 14l-.85-2.05L9.1 11.1l2.05-.85z" />
    </svg>
  );
}

function AskFab({ onClick }){
  return (
    <button className="sf-fab sf-btn" onClick={onClick} aria-label="Ask anything"
      style={{ width: 54, height: 54, borderRadius: R.pill, border: 'none', cursor: 'pointer',
        background: T.accent, color: '#fff', boxShadow: SH.accent,
        display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <AskIcon size={25} />
    </button>
  );
}

const ASK_GENERIC = ['What\'s the difference between…?', 'Give me an example of…', 'Why does that happen?'];

function AskPanel({ thread, setThread, onClose }){
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [photo, setPhoto] = useState(null);   // { name, busy, text } — a snapped question
  const endRef = useRef(null);
  const taRef = useRef(null);
  const photoRef = useRef(null);
  const hasCard = !!studyContext;

  // the composer grows with the question instead of scrolling a one-line box
  const grow = () => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 160) + 'px';
  };

  /* Photograph the question you're stuck on. The vision model turns it into
     text here, once, so the thread stays cheap and the reply is grounded in
     what's actually on the page. */
  const attachPhoto = async (file) => {
    setPhoto({ name: file.name, busy: true, text: '' });
    setErr('');
    try {
      const shrunk = await resizeImage(file);
      const read = await describeImage(shrunk);
      if (read && read.trim()) setPhoto({ name: file.name, busy: false, text: read.trim() });
      else { setPhoto(null); setErr('Could not read that photo — try a clearer one.'); }
    } catch (e){ setPhoto(null); setErr(friendlyApiError(e)); }
  };

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // keep the newest message in view as the thread grows
  useEffect(() => {
    if (endRef.current){ try { endRef.current.scrollIntoView({ block: 'end' }); } catch {} }
  }, [thread, busy]);

  const send = async (raw) => {
    const q = String(raw != null ? raw : text).trim();
    if (!q || busy || (photo && photo.busy)) return;
    /* the photo rides along with the message it was attached to, then clears */
    const withPhoto = photo && photo.text
      ? q + '\n\n[Photo they attached, read aloud:]\n' + photo.text
      : q;
    const next = thread.concat([{ role: 'user', text: withPhoto, shown: q }]);
    setThread(next); setText(''); setErr(''); setPhoto(null); setBusy(true);
    if (taRef.current) taRef.current.style.height = 'auto';
    try {
      const reply = await askHelper(next);
      if (reply) setThread(next.concat([{ role: 'assistant', text: reply }]));
      else setErr('Nothing came back. Try asking again.');
    } catch (e){ setErr(friendlyApiError(e)); }
    finally { setBusy(false); }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); send(); }
  };

  const starters = (hasCard ? ['Explain the card I\'m on, simply'] : []).concat(ASK_GENERIC).slice(0, 4);
  /* A starter with a "…" is half a question — drop it in the box for them to
     finish. A complete one is sent straight away. */
  const useStarter = (s) => {
    if (s.indexOf('…') < 0){ send(s); return; }
    setText(s.replace('…?', ' ').replace('…', ' '));
  };

  return (
    <div className="sf-ask">
      <div className="flex items-center justify-between"
        style={{ padding: '12px 14px', borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
        <div className="flex items-center gap-2" style={{ minWidth: 0 }}>
          <span style={{ color: T.accentInk, display: 'flex' }}><AskIcon size={20} /></span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: SANS, fontSize: 15, fontWeight: 700, color: T.ink }}>Ask anything</div>
            {hasCard && <Sub style={{ fontSize: 11.5 }}>It can see the card you're on</Sub>}
          </div>
        </div>
        <div className="flex items-center gap-1" style={{ flexShrink: 0 }}>
          {thread.length > 0 && (
            <button className="sf-tap" onClick={() => { setThread([]); setErr(''); }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px 8px',
                fontFamily: SANS, fontSize: 12.5, fontWeight: 600, color: T.muted }}>Clear</button>
          )}
          <button className="sf-tap" onClick={onClose} aria-label="Close"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.faint,
              padding: '4px 6px', display: 'flex' }}><Ico name="cross" size={17} /></button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 14 }}>
        {thread.length === 0 && (
          <div>
            <Sub style={{ marginBottom: 12 }}>
              Stuck on something? Ask it here — a definition, a worked step, why an answer is what it is.
              {hasCard ? ' It already knows the card you\'re looking at.' : ''}
            </Sub>
            <div className="flex flex-col gap-2">
              {starters.map((s, i) => (
                <button key={i} className="sf-tap" onClick={() => useStarter(s)}
                  style={{ textAlign: 'left', background: T.well, border: 'none', borderRadius: R.well,
                    padding: '11px 13px', cursor: 'pointer', fontFamily: SANS, fontSize: 14, color: T.ink }}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {thread.map((m, i) => m.role === 'user' ? (
          <div key={i} style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
            <div style={{ maxWidth: '86%', background: T.accent, color: '#fff', borderRadius: '16px 16px 5px 16px',
              padding: '9px 13px', fontFamily: SANS, fontSize: 14.5, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
              {m.shown ? m.shown : m.text}
            </div>
          </div>
        ) : (
          <div key={i} style={{ background: T.well, borderRadius: '16px 16px 16px 5px', padding: '11px 13px', marginBottom: 12 }}>
            <RichText text={m.text} />
          </div>
        ))}

        {busy && (
          <div style={{ background: T.well, borderRadius: '16px 16px 16px 5px', padding: '13px 15px',
            marginBottom: 12, display: 'inline-flex', gap: 5, alignItems: 'center' }}>
            {[0, 1, 2].map(i => (
              <span key={i} style={{ width: 7, height: 7, borderRadius: 7, background: T.faint,
                animation: `sf-pulse 1.1s ease-in-out ${i * 160}ms infinite` }} />
            ))}
          </div>
        )}
        {err && <Sub style={{ color: T.red, padding: '2px 4px' }}>{err}</Sub>}
        <div ref={endRef} />
      </div>

      {/* The composer, ported from the kokonutui AI prompt input (MIT): one
          framed well holding the textarea and its controls, rather than a bare
          box with a button beside it. The model picker is left out on purpose
          — there's one model and naming it would only confuse. */}
      <div style={{ flexShrink: 0, padding: '8px 10px calc(10px + env(safe-area-inset-bottom))' }}>
        <div style={{ background: T.well, borderRadius: 16, border: `1px solid ${T.border}`,
          padding: 4, transition: 'border-color 180ms' }}>
          <textarea ref={taRef} value={text} onKeyDown={onKeyDown}
            onChange={e => { setText(e.target.value); grow(); }} rows={1}
            placeholder={photo ? 'Ask about the photo…' : 'Ask a question…'}
            style={{ width: '100%', background: 'transparent', color: T.ink, border: 'none',
              borderRadius: 12, padding: '11px 12px 4px', fontFamily: SANS, fontSize: 15,
              lineHeight: 1.45, resize: 'none', outline: 'none', maxHeight: 160, display: 'block' }} />

          {photo && (
            <div className="flex items-center gap-2" style={{ margin: '0 8px 6px', padding: '6px 9px',
              background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10 }}>
              <span style={{ color: T.muted, display: 'flex' }}><Ico name="image" size={14} /></span>
              <Sub style={{ flex: 1, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {photo.busy ? 'Reading the photo…' : photo.name}
              </Sub>
              {!photo.busy && (
                <button className="sf-tap" onClick={() => setPhoto(null)} aria-label="Remove photo"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.faint, fontSize: 15, padding: 0 }}>×</button>
              )}
            </div>
          )}

          <div className="flex items-center justify-between" style={{ padding: '0 6px 4px' }}>
            <div className="flex items-center gap-1">
              <input ref={photoRef} type="file" accept="image/*" style={{ display: 'none' }}
                onChange={(e) => { const f = (e.target.files || [])[0]; if (e.target) e.target.value = ''; if (f) attachPhoto(f); }} />
              <button className="sf-tap" onClick={() => photoRef.current && photoRef.current.click()}
                aria-label="Attach a photo of the question" title="Attach a photo"
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 7, borderRadius: 9,
                  color: T.faint, display: 'flex' }}>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 11.5l-8.6 8.6a5 5 0 0 1-7.1-7.1l8.6-8.6a3.4 3.4 0 0 1 4.8 4.8l-8.6 8.6a1.7 1.7 0 0 1-2.4-2.4l7.9-7.9" />
                </svg>
              </button>
              <Sub style={{ fontSize: 11, color: T.faint }}>Enter to send</Sub>
            </div>
            <button className="sf-btn" onClick={() => send()} disabled={busy || !text.trim()} aria-label="Send"
              style={{ width: 34, height: 34, borderRadius: R.pill, border: 'none', flexShrink: 0,
                background: text.trim() && !busy ? T.accent : T.border,
                color: text.trim() && !busy ? '#fff' : T.faint, display: 'flex', alignItems: 'center',
                justifyContent: 'center', cursor: (busy || !text.trim()) ? 'default' : 'pointer',
                transition: 'background 180ms, color 180ms' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            </button>
          </div>
        </div>
        <Sub style={{ fontSize: 11, marginTop: 7, textAlign: 'center' }}>
          It can be wrong — check anything that matters against your notes.
        </Sub>
      </div>
    </div>
  );
}

export default function App(){
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState('home');
  const [library, setLibrary] = useState({ decks: [] });
  const [progress, setProgress] = useState({});
  const [stats, setStats] = useState(DEFAULT_STATS);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const [pendingCount, setPendingCount] = useState(0);   // unsaved drafts waiting on Create
  const [focus, setFocus] = useState('all');             // which deck the feed is showing: 'all' or a deck id
  const [quiz, setQuiz] = useState(null);                // { deckId } while a quiz is open, else null
  const [learn, setLearn] = useState(null);              // { deckId } while Learn is open, else null
  const [showNews, setShowNews] = useState(false);       // "What's new" note after an update
  const [showTutorial, setShowTutorial] = useState(false); // first-run walkthrough
  const [askOpen, setAskOpen] = useState(false);         // the ask-anything helper
  const [thread, setThread] = useState([]);              // its conversation, this session only
  const [starterOpen, setStarterOpen] = useState(false); // the ready-made deck picker
  const [diagOpen, setDiagOpen] = useState(false);       // the gap-finding diagnostic
  const [createSeed, setCreateSeed] = useState(null);    // material handed to Create from elsewhere
  const reduceMotion = useRef(false);

  // a focused deck that then gets deleted shouldn't leave the feed stuck empty
  useEffect(() => {
    if (focus !== 'all' && ready && !library.decks.some(d => d.id === focus)) setFocus('all');
  }, [library, focus, ready]);

  const startDeck = (deckId) => { setFocus(deckId); setTab('feed'); };
  const openQuiz = (deckId) => setQuiz({ deckId: deckId || 'all' });
  const openLearn = (deckId) => setLearn({ deckId: deckId || 'all' });
  /* The diagnosis names what is missing; making the cards is what closes the
     loop, so it hands the gaps to Create rather than ending on a report. */
  const cardsFromGaps = (source, topic, level) => {
    setDiagOpen(false);
    setCreateSeed({ source: source, topic: topic, level: level });
    setTab('create');
    track('diagnostic_to_cards', {});
  };
  /* Whatever they last said they were working to. Someone who set their real
     standard on a deck should not have to type it again to be tested on it. */
  const usualLevel = () => {
    const d = library.decks[library.decks.length - 1];
    return (d && d.standard) ? d.standard : 'NCEA Level 1';
  };

  useEffect(() => {
    (async () => {
      const [lib, prog, st, se] = await Promise.all([
        load('library:main', { decks: [] }),
        load('progress:all', {}),
        load('stats:main', DEFAULT_STATS),
        load('settings:main', DEFAULT_SETTINGS),
      ]);
      setLibrary(lib && lib.decks ? lib : { decks: [] });
      setProgress(prog || {});
      setStats({ ...DEFAULT_STATS, ...st });
      const merged = { ...DEFAULT_SETTINGS, ...se };

      /* Inter is the brand typeface as of 1.6.0. Everyone who has ever opened
         the app has font:'jakarta' written into their settings — not because
         they chose it, but because it was the default and defaults get merged
         in and saved. Left alone, the rebrand would visibly skip every existing
         install. Migrating on the version stamp moves those people once; anyone
         who picks Jakarta after this release has a current lastSeenVersion, so
         the test is already false and their choice stands. */
      if (merged.font === 'jakarta' && merged.lastSeenVersion && merged.lastSeenVersion !== APP_VERSION){
        merged.font = 'inter';
        /* Persist it here rather than leaving it to whichever branch below
           happens to save. Without this the migration is re-derived on every
           load until the changelog is dismissed, and the stored settings
           disagree with what is on screen the whole time. */
        save('settings:main', merged);
      }

      /* Who is actually new? `onboarded` defaults to false, so it alone would
         fire the tutorial at every existing user the first time they load this
         build — a walkthrough of an app they already use. Never having seen
         ANY version is the honest signal, and a stored deck is the backstop
         for anyone whose lastSeenVersion predates that field. */
      const neverSeenAVersion = !merged.lastSeenVersion;
      const hasDecks = !!(lib && lib.decks && lib.decks.length);
      const isNewcomer = !merged.onboarded && neverSeenAVersion && !hasDecks;

      if (isNewcomer){
        setShowTutorial(true);
        /* A changelog is a catch-up for people who were already here. Stacking
           it behind the tutorial for someone who has never opened the app is
           two overlays and no context for either, so this one is spent. */
        merged.lastSeenVersion = APP_VERSION;
        save('settings:main', merged);
      } else {
        /* Pop "What's new" as soon as the site opens for anyone who hasn't seen
           THIS version yet. Once they dismiss it, lastSeenVersion is stamped so
           it won't reappear until the next update. The changelog also has its
           own tab for reopening any time. */
        if (merged.lastSeenVersion !== APP_VERSION) setShowNews(true);
        /* An existing user is retroactively onboarded, so that flipping this
           build's newcomer test can never ambush them later. */
        if (!merged.onboarded){ merged.onboarded = true; save('settings:main', merged); }
      }
      setSettings(merged);
      try { reduceMotion.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch {}
      setReady(true);
    })();
  }, []);

  /* Deep links from the landing page. Only the two it actually advertises;
     an open-ended hash router would be a bigger surface than this needs. The
     hash is cleared once used, so a reload does not reopen the overlay and the
     back button behaves. */
  useEffect(() => {
    if (!ready) return;
    let h = '';
    try { h = (window.location.hash || '').replace('#', '').toLowerCase(); } catch (e){ return; }
    if (h !== 'gaps' && h !== 'ideas') return;
    if (h === 'gaps') setDiagOpen(true);
    else setTab('feedback');
    try { window.history.replaceState(null, '', window.location.pathname + window.location.search); } catch (e){}
  }, [ready]);

  const dismissNews = () => {
    setShowNews(false);
    const s = { ...settings, lastSeenVersion: APP_VERSION };
    setSettings(s); save('settings:main', s);
  };

  /* Finishing and skipping both mean "don't show me this again". They differ
     only in where you land: finishing ends on "Make my first cards", so the
     generator is the obvious next step, while skipping is a request to be left
     alone — moving that person off Home would be ignoring what they just said. */
  const endTutorial = (finished) => {
    setShowTutorial(false);
    /* The onboarding funnel: how many people who land actually get through the
       tour to the generator, versus bailing out of it. */
    track(finished ? 'tour_finished' : 'tour_skipped', {});
    persistSettings({ ...settings, onboarded: true, lastSeenVersion: APP_VERSION });
    if (finished) setTab('create');
  };
  /* Skipping is permanent otherwise, and "I'll look at that later" is a
     perfectly reasonable thing to have meant. */
  const replayTutorial = () => setShowTutorial(true);

  /* The sound engine is a module-level singleton (it owns one AudioContext), so
     the setting is pushed to it rather than passed down through every card. */
  useEffect(() => { setSoundOn(settings.sound !== false); }, [settings.sound]);

  /* Apply the chosen theme to <html>: 'system' follows the OS, otherwise force
     light/dark. The palette itself lives in THEME_CSS (data-theme selectors). */
  useEffect(() => {
    try {
      const el = document.documentElement;
      const t = settings.theme || 'system';
      if (t === 'system') el.removeAttribute('data-theme');
      else el.setAttribute('data-theme', t);
      el.setAttribute('data-font', fontOf(settings));
    } catch {}
  }, [settings.theme, settings.font]);

  const persistLibrary = useCallback((lib) => { setLibrary(lib); save('library:main', lib); }, []);
  const persistProgress = useCallback((p) => { setProgress(p); save('progress:all', p); }, []);
  const persistStats = useCallback((s) => { setStats(s); save('stats:main', s); }, []);
  const persistSettings = useCallback((s) => { setSettings(s); save('settings:main', s); }, []);

  /* Learn writes its half-finished run through here on the way out. It reads
     the settings off a ref rather than the closure so the callback can stay
     stable — Learn hangs on to it and calls it from an unmount handler, which
     is exactly where a stale closure would quietly save the wrong thing.
     Kept inside settings rather than a fifth storage key: the four-key limit
     at the top of this file is a constraint of the Artifact runtime, not a
     preference. */
  const saveLearnSession = useCallback((sess) => {
    const s = { ...settingsRef.current, learnSession: sess || null };
    setSettings(s); save('settings:main', s);
  }, []);
  /* The last diagnosis is kept for the same reason as the Learn session: it is
     a to-do list, and one you cannot reopen is a worse one. Same storage key
     too — the four-key limit is the Artifact runtime's, not a preference. */
  const saveDiagnosis = useCallback((report) => {
    const s = { ...settingsRef.current, diagnosis: report || null };
    setSettings(s); save('settings:main', s);
  }, []);

  const saveDeck = (cards, meta) => {
    const deck = {
      id: uid(),
      subject: (meta.subject || 'Untitled').trim(),
      topic: (meta.topic || '').trim(),
      standard: (meta.standard || 'NCEA Level 1').trim(),
      cards: cards.map(({ keep, ...c }) => c),
    };
    /* Deliberately not the subject or topic — free-text boxes. */
    track('deck_created', { cards: deck.cards.length,
      long: deck.cards.filter(isLongCard).length });
    persistLibrary({ decks: [...library.decks, deck] });
    setTab('feed');
  };

  /* A starter deck enters the library exactly the way a generated one does —
     same shape, same scheduler, editable and deletable — so nothing downstream
     needs to know where it came from. It goes straight to the feed focused on
     itself, because the whole point is that the next thing on screen is a card
     rather than another decision.
     `slug` is one of our own fixed identifiers, never anything the student
     typed, so it is safe to send with the event. */
  const addStarter = (slug) => {
    const deck = instantiateStarter(slug);
    if (!deck) return;
    track('starter_deck_added', { slug: slug, cards: deck.cards.length });
    persistLibrary({ decks: [...library.decks, deck] });
    setStarterOpen(false);
    setFocus(deck.id);
    setTab('feed');
  };

  /* practice=true: count the review, but never touch the scheduler */
  const gradeCard = (card, deck, q, committedWrong, practice) => {
    const today = TODAY();
    let reinsert = false;
    let wasNew = false;

    if (!practice){
      const prev = progress[card.id];
      wasNew = !prev || !prev.seen;
      const r = schedule(prev, q, committedWrong);
      reinsert = r.reinsert;
      persistProgress({ ...progress, [card.id]: r.next });
    }

    const s = { ...stats, newByDate: { ...stats.newByDate }, reviewsByDate: { ...stats.reviewsByDate },
      practiceByDate: { ...stats.practiceByDate }, bySubject: { ...stats.bySubject } };
    if (practice) s.practiceByDate[today] = (s.practiceByDate[today] || 0) + 1;
    else s.reviewsByDate[today] = (s.reviewsByDate[today] || 0) + 1;
    if (wasNew) s.newByDate[today] = (s.newByDate[today] || 0) + 1;
    s.bySubject[deck.subject] = (s.bySubject[deck.subject] || 0) + 1;
    if (s.lastDay !== today){
      s.streak = (s.lastDay === addDays(today, -1)) ? (s.streak || 0) + 1 : 1;
      s.lastDay = today;
    }
    persistStats(s);
    return { reinsert };
  };

  /* A finished quiz counts as practice — it keeps the streak and today's
     activity honest without touching the SM-2 schedule. */
  const recordQuiz = (total, subject) => {
    if (!total) return;
    const today = TODAY();
    const s = { ...stats, practiceByDate: { ...stats.practiceByDate }, bySubject: { ...stats.bySubject } };
    s.practiceByDate[today] = (s.practiceByDate[today] || 0) + total;
    if (subject) s.bySubject[subject] = (s.bySubject[subject] || 0) + total;
    if (s.lastDay !== today){
      s.streak = (s.lastDay === addDays(today, -1)) ? (s.streak || 0) + 1 : 1;
      s.lastDay = today;
    }
    persistStats(s);
  };

  const editCard = (deckId, cardId, patch) => {
    persistLibrary({ decks: library.decks.map(d => d.id !== deckId ? d
      : { ...d, cards: d.cards.map(c => c.id === cardId ? { ...c, ...patch } : c) }) });
  };
  const deleteCard = (deckId, cardId) => {
    persistLibrary({ decks: library.decks.map(d => d.id !== deckId ? d : { ...d, cards: d.cards.filter(c => c.id !== cardId) }) });
  };
  const deleteDeck = (deckId) => persistLibrary({ decks: library.decks.filter(d => d.id !== deckId) });
  const renameDeck = (deckId, patch) => {
    persistLibrary({ decks: library.decks.map(d => d.id === deckId ? { ...d, ...patch } : d) });
  };
  const importLibrary = ({ decks, progress: mergedProgress }) => {
    persistLibrary({ decks });
    persistProgress(mergedProgress);
  };

  const cardCount = library.decks.reduce((s, d) => s + d.cards.length, 0);
  const dueCount = useMemo(() => {
    if (!ready) return 0;
    const today = TODAY();
    let n = 0;
    let freshLeft = newBudgetFor(settings, stats);
    for (const d of library.decks) for (const c of d.cards){
      const p = progress[c.id];
      if (!p || !p.seen){ if (freshLeft > 0){ n++; freshLeft--; } }
      else if (p.due <= today) n++;
    }
    return n;
  }, [ready, library, progress, settings, stats]);

  if (!ready) return <Shell><Sub style={{ padding: 40, textAlign: 'center' }}>Loading…</Sub></Shell>;

  return (
    <>
    <Shell tab={tab} setTab={setTab} due={dueCount} pending={pendingCount}>
      {tab !== 'home' && <Masthead due={dueCount} streak={stats.streak || 0}
        sound={settings.sound !== false}
        onSound={() => persistSettings({ ...settings, sound: settings.sound === false })} />}
      <div style={{ minHeight: 440 }}>
        {tab === 'home' && <Home library={library} progress={progress} stats={stats} settings={settings}
          due={dueCount} onStart={() => { setFocus('all'); setTab('feed'); }} onCreate={() => setTab('create')}
          onDecks={() => setTab('decks')} onStudyDeck={startDeck} onQuiz={openQuiz} onLearn={openLearn}
          onDiagnose={() => setDiagOpen(true)} onSettings={persistSettings}
          onTutorial={replayTutorial} onStarter={() => setStarterOpen(true)} />}
        {/* key includes focus + mix so switching deck or moving the slider rebuilds the queue */}
        {tab === 'feed' && <Feed key={'feed-' + focus + '-' + cardCount + '-' + longMixOf(settings)}
          decks={library.decks} progress={progress} settings={settings} stats={stats} onGrade={gradeCard}
          reduceMotion={reduceMotion.current} focus={focus} setFocus={setFocus}
          onSettings={persistSettings} onQuiz={openQuiz} onHome={() => setTab('home')}
          onNote={(deckId, cardId, text) => editCard(deckId, cardId, { note: text })} />}
        {/* Create stays MOUNTED and is hidden instead — unmounting it threw away
            unsaved drafts, pasted notes and attached photos the moment you
            switched tabs, and those drafts cost real API usage to produce. */}
        <div style={{ display: tab === 'create' ? 'block' : 'none' }}>
          <Create onSave={saveDeck} settings={settings} onSettings={persistSettings} onPending={setPendingCount}
            onStarter={() => setStarterOpen(true)} seed={createSeed} onSeedUsed={() => setCreateSeed(null)} />
        </div>
        {tab === 'decks' && <Decks decks={library.decks} progress={progress} onEditCard={editCard}
          onDeleteCard={deleteCard} onDeleteDeck={deleteDeck} onRenameDeck={renameDeck}
          onStudyDeck={startDeck} onQuiz={openQuiz} onLearn={openLearn} onStarter={() => setStarterOpen(true)} />}
        {tab === 'stats' && <Stats decks={library.decks} progress={progress} stats={stats} />}
        {tab === 'changelog' && <Changelog />}
        {tab === 'feedback' && <FeatureRequest />}
        {tab === 'settings' && <Settings settings={settings} onChange={persistSettings}
          library={library} progress={progress} onImport={importLibrary} onTutorial={replayTutorial} />}
      </div>
    </Shell>
    {quiz && <Quiz decks={library.decks} deckId={quiz.deckId} onClose={() => setQuiz(null)} onDone={recordQuiz} />}
    {learn && <LearnMode decks={library.decks} deckId={learn.deckId} session={settings.learnSession}
      onSaveSession={saveLearnSession} onClose={() => setLearn(null)} onDone={recordQuiz} />}
    {diagOpen && <Diagnose decks={library.decks} defaultLevel={usualLevel()} report={settings.diagnosis}
      onSaveReport={saveDiagnosis} onClose={() => setDiagOpen(false)} onMakeCards={cardsFromGaps} />}
    {starterOpen && <StarterPicker onAdd={addStarter} onClose={() => setStarterOpen(false)} />}
    {showNews && !showTutorial && <WhatsNew onClose={dismissNews} />}
    {/* the tour drives the tabs itself — it points at the real screens */}
    {showTutorial && <Tutorial onDone={endTutorial} onNavigate={setTab} tab={tab} />}
    {/* the helper is available on every screen — except where something else
        already owns the whole screen (a quiz, the update note, the tutorial) */}
    {askOpen && <AskPanel thread={thread} setThread={setThread} onClose={() => setAskOpen(false)} />}
    {!askOpen && !quiz && !learn && !diagOpen && !showNews && !showTutorial && !starterOpen && <AskFab onClick={() => setAskOpen(true)} />}
    </>
  );
}

function Shell({ children, tab, setTab, due, pending }){
  return (
    <div style={{ background: T.bg, minHeight: '100vh', color: T.ink }}>
      <style>{THEME_CSS}</style>
      <style>{`
        @keyframes sf-in { from { opacity: 0; transform: translateY(12px) scale(0.985); } to { opacity: 1; transform: none; } }
        @keyframes sf-reveal { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }
        @keyframes sf-rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
        /* the tour's spotlight ring — breathes so it reads as "look here" */
        @keyframes sf-halo {
          0%, 100% { box-shadow: 0 0 0 4px color-mix(in srgb, var(--sf-accent) 24%, transparent); }
          50%      { box-shadow: 0 0 0 9px color-mix(in srgb, var(--sf-accent) 12%, transparent); }
        }

        /* ---- reward effects ---------------------------------------------- */
        @keyframes sf-burst {
          0%   { opacity: 1; transform: translate(-50%, -50%) scale(0.4); }
          65%  { opacity: 1; }
          100% { opacity: 0; transform: translate(calc(-50% + var(--bx)), calc(-50% + var(--by))) scale(1); }
        }
        @keyframes sf-fall {
          0%   { opacity: 1; transform: translate(0, 0) rotate(0deg); }
          100% { opacity: 0.9; transform: translate(var(--drift), 105vh) rotate(var(--spin)); }
        }
        @keyframes sf-pop {
          0%   { transform: scale(1); }
          38%  { transform: scale(1.11); }
          100% { transform: scale(1); }
        }
        @keyframes sf-shake {
          0%, 100% { transform: translateX(0); }
          15% { transform: translateX(-7px); }
          32% { transform: translateX(6px); }
          50% { transform: translateX(-4px); }
          68% { transform: translateX(3px); }
          85% { transform: translateX(-1px); }
        }
        @keyframes sf-flash {
          0%   { opacity: 0; }
          22%  { opacity: 1; }
          100% { opacity: 0; }
        }
        @keyframes sf-combo-in {
          0%   { opacity: 0; transform: scale(0.5) translateY(6px); }
          60%  { opacity: 1; transform: scale(1.14) translateY(0); }
          100% { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes sf-spin { to { transform: rotate(360deg); } }
        @keyframes sf-spin-rev { to { transform: rotate(-360deg); } }
        @keyframes sf-breathe { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.025); } }
        @keyframes sf-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.62; } }
        @keyframes sf-float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-5px); } }

        * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
        body { overscroll-behavior-y: none; }
        textarea, input, select { font-size: 16px; font-family: ${SANS}; }
        ::placeholder { color: ${T.faint}; }
        ::selection { background: ${rgba(T.accent, 0.18)}; }

        .sf-btn { transition: transform 110ms cubic-bezier(.3,.8,.4,1), filter 180ms, box-shadow 180ms; -webkit-user-select: none; user-select: none; }
        .sf-btn:active:not(:disabled) { transform: scale(0.96); filter: brightness(0.97); }
        .sf-tap { transition: transform 110ms cubic-bezier(.3,.8,.4,1), border-color 180ms, background 180ms; }
        /* Three actions across a 375px phone leaves ~106px each, and a
           one-line description wraps to four lines in that. The label and the
           icon carry it there; the description comes back when there is room. */
        .sf-act-sub { display: none; }
        @media (min-width: 460px) { .sf-act-sub { display: block; } }
        .sf-tap:active { transform: scale(0.985); }
        @media (hover: hover) {
          .sf-btn:hover:not(:disabled) { filter: brightness(0.98); }
          .sf-tap:hover { border-color: ${rgba(T.accent, 0.35)}; }
        }
        :focus-visible { outline: 2.5px solid ${rgba(T.accent, 0.5)}; outline-offset: 2px; }

        .sf-range { -webkit-appearance: none; appearance: none; width: 100%; height: 10px;
          border-radius: 999px; outline: none; cursor: pointer; }
        .sf-range::-webkit-slider-thumb { -webkit-appearance: none; appearance: none;
          width: 28px; height: 28px; border-radius: 999px; background: #fff;
          border: 3px solid ${T.surface}; box-shadow: 0 2px 8px rgba(20,22,43,0.28); cursor: grab; }
        .sf-range::-webkit-slider-thumb:active { cursor: grabbing; transform: scale(1.08); }
        .sf-range::-moz-range-thumb { width: 24px; height: 24px; border-radius: 999px; background: #fff;
          border: 3px solid ${T.surface}; box-shadow: 0 2px 8px rgba(20,22,43,0.28); cursor: grab; }

        .sf-stagger > * { animation: sf-rise 280ms cubic-bezier(.2,.8,.3,1) backwards; }
        .sf-stagger > *:nth-child(1) { animation-delay: 0ms; }
        .sf-stagger > *:nth-child(2) { animation-delay: 40ms; }
        .sf-stagger > *:nth-child(3) { animation-delay: 80ms; }
        .sf-stagger > *:nth-child(4) { animation-delay: 120ms; }

        /* ---- responsive layout -------------------------------------------
           Phone: single column, bottom nav. As the window grows the column
           widens; past 1024px the nav becomes a sidebar and the content gets
           the rest. Text still stops widening — long lines are hard to read,
           so extra space goes to multi-column grids, not longer sentences. */
        .sf-page { display: flex; justify-content: center; }
        .sf-main { width: 100%; max-width: 520px; padding: 10px 16px 104px; position: relative; }
        @media (min-width: 720px)  { .sf-main { max-width: 640px; padding-left: 22px; padding-right: 22px; } }
        @media (min-width: 1024px) { .sf-main { max-width: 780px; padding-bottom: 52px; } }
        @media (min-width: 1400px) { .sf-main { max-width: 880px; } }

        .sf-navbottom { display: flex; }
        .sf-navside   { display: none; }
        @media (min-width: 1024px) {
          .sf-navbottom { display: none; }
          .sf-navside   { display: flex; }
          .sf-page      { padding-left: 232px; }
        }

        /* ---- ask helper --------------------------------------------------
           Full screen on a phone (a 390px panel floating over a 375px screen
           is just a worse full screen), a docked panel once there's room.
           The button clears the bottom nav until the nav moves to the side. */
        .sf-fab { position: fixed; right: 16px; bottom: 84px; z-index: 55; }
        .sf-ask { position: fixed; inset: 0; z-index: 65; display: flex; flex-direction: column;
          background: ${T.surface}; animation: sf-in 220ms cubic-bezier(.2,.8,.3,1); }
        @media (min-width: 720px) {
          .sf-ask { inset: auto 20px 20px auto; width: 390px; height: min(620px, 78vh);
            border: 1px solid ${T.border}; border-radius: 20px; box-shadow: ${SH.card}; overflow: hidden; }
        }
        @media (min-width: 1024px) { .sf-fab { right: 26px; bottom: 26px; } }

        /* one column on a phone, two once there's room */
        .sf-grid2 { display: grid; grid-template-columns: 1fr; gap: 10px; }
        @media (min-width: 720px) { .sf-grid2 { grid-template-columns: 1fr 1fr; } }

        @media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
      `}</style>

      <SideNav tab={tab} setTab={setTab} due={due} pending={pending} />
      <div className="sf-page">
        <div className="sf-main">{children}</div>
      </div>
      <Nav tab={tab} setTab={setTab} due={due} pending={pending} />
    </div>
  );
}

const NAV_ITEMS = [['home','Home'],['feed','Study'],['create','Create'],['decks','Decks'],['stats','Stats'],['changelog','Updates'],['feedback','Ideas'],['settings','You']];

function NavBadge({ k, due, pending }){
  if (k === 'feed' && due > 0){
    return <span style={{ marginLeft: 'auto', fontFamily: SANS, fontSize: 11, fontWeight: 700, color: '#fff',
      background: T.red, borderRadius: R.pill, padding: '2px 8px' }}>{due}</span>;
  }
  if (k === 'create' && pending > 0){
    return <span style={{ marginLeft: 'auto', fontFamily: SANS, fontSize: 11, fontWeight: 700, color: '#fff',
      background: T.amber, borderRadius: R.pill, padding: '2px 8px' }}>{pending}</span>;
  }
  return null;
}

/* desktop only — a real sidebar instead of a bottom bar stretched across 1400px */
function SideNav({ tab, setTab, due, pending }){
  return (
    <div className="sf-navside" style={{ position: 'fixed', top: 0, left: 0, bottom: 0, width: 232,
      flexDirection: 'column', padding: '26px 16px', background: T.surface,
      borderRight: `1px solid ${T.border}`, zIndex: 5 }}>
      <div className="flex items-center gap-2" style={{ fontFamily: SANS, fontSize: 21, fontWeight: 800,
        color: T.ink, letterSpacing: '-0.03em', padding: '0 10px', marginBottom: 22 }}>
        <Mark size={24} />Study Feed
      </div>
      <div className="flex flex-col gap-1">
        {NAV_ITEMS.map(([k, label]) => {
          const active = tab === k;
          return (
            <button key={k} className="sf-tap" onClick={() => setTab(k)} data-tour={'nav-' + k}
              style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left',
                padding: '11px 12px', borderRadius: 14, border: 'none', cursor: 'pointer',
                background: active ? rgba(T.accent, 0.1) : 'transparent',
                transition: 'background 160ms' }}>
              <Icon name={k} active={active} />
              <span style={{ fontFamily: SANS, fontSize: 15, fontWeight: active ? 700 : 500,
                color: active ? T.accentInk : T.muted }}>{label}</span>
              <NavBadge k={k} due={due} pending={pending} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Masthead({ due, streak, sound, onSound }){
  return (
    <div className="flex items-center justify-between" style={{ padding: '10px 2px 18px' }}>
      <div className="flex items-center gap-2" style={{ fontFamily: SANS, fontSize: 24, fontWeight: 800,
        color: T.ink, letterSpacing: '-0.03em' }}>
        <Mark size={26} />Study Feed
      </div>
      <div className="flex items-center gap-2">
        {streak > 0 && <Chip colour={T.amber}><span className="flex items-center gap-1"><Ico name="flame" size={12} weight={2} fill />{streak}</span></Chip>}
        {due > 0 && <Chip colour={T.red} solid>{due} due</Chip>}
        {/* muting has to be one tap from wherever you are — this gets used in
            class, and hunting through Settings mid-lesson is not an option */}
        <button className="sf-tap" onClick={onSound} aria-label={sound ? 'Mute sounds' : 'Unmute sounds'}
          title={sound ? 'Mute sounds' : 'Unmute sounds'}
          style={{ width: 32, height: 32, borderRadius: R.pill, border: 'none', cursor: 'pointer',
            background: 'transparent', color: sound ? T.muted : T.faint, padding: 0, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Ico name={sound ? 'speaker' : 'muted'} size={17} />
        </button>
      </div>
    </div>
  );
}

function Nav({ tab, setTab, due, pending }){
  const items = NAV_ITEMS;
  return (
    <div className="sf-navbottom" style={{ position: 'fixed', bottom: 0, left: 0, right: 0, justifyContent: 'center', pointerEvents: 'none' }}>
      <div style={{ width: '100%', maxWidth: 520, pointerEvents: 'auto',
        background: 'var(--sf-nav)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
        borderTop: `1px solid ${T.border}`, display: 'flex',
        padding: '8px 6px calc(8px + env(safe-area-inset-bottom))' }}>
        {items.map(([k, label]) => {
          const active = tab === k;
          return (
            <button key={k} className="sf-tap" onClick={() => setTab(k)} data-tour={'nav-' + k}
              style={{ flex: 1, background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, position: 'relative' }}>
              <Icon name={k} active={active} />
              <span style={{ fontFamily: SANS, fontSize: 10.5, fontWeight: active ? 700 : 500,
                color: active ? T.accentInk : T.faint, transition: 'color 160ms' }}>{label}</span>
              {k === 'feed' && due > 0 && (
                <span style={{ position: 'absolute', top: 2, right: '50%', marginRight: -16, width: 8, height: 8,
                  borderRadius: 8, background: T.red, border: `1.5px solid ${T.surface}` }} />
              )}
              {/* cards generated but not yet saved */}
              {k === 'create' && pending > 0 && (
                <span style={{ position: 'absolute', top: 0, right: '50%', marginRight: -22, minWidth: 17, height: 17,
                  borderRadius: 17, background: T.amber, color: '#fff', border: `1.5px solid ${T.surface}`,
                  fontFamily: SANS, fontSize: 10, fontWeight: 700, lineHeight: '14px', textAlign: 'center', padding: '0 4px' }}>
                  {pending}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
