import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';

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
const FONTS = [
  { v: 'jakarta', label: 'Rounded', stack: `"Plus Jakarta Sans", ${SYSTEM_STACK}`, note: 'Friendly and geometric — the default' },
  { v: 'inter',   label: 'Neutral', stack: `"Inter", ${SYSTEM_STACK}`, note: 'Plainer, tuned for small sizes' },
  { v: 'system',  label: 'System',  stack: SYSTEM_STACK, note: 'Whatever your phone or laptop uses' },
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
    --sf-font: "Plus Jakarta Sans", ${SYSTEM_STACK};
  }
  :root[data-font="inter"]{  --sf-font: "Inter", ${SYSTEM_STACK}; }
  :root[data-font="system"]{ --sf-font: ${SYSTEM_STACK}; }
  :root{
    --sf-bg:#F6F8FB; --sf-surface:#FFFFFF; --sf-well:#F1F4F9; --sf-border:#EBEEF3;
    --sf-ink:#2B2F3A; --sf-muted:#6E7482; --sf-faint:#A6ABB7;
    --sf-accent:#6472F0; --sf-accent-ink:#4E5AD6;
    --sf-green:#37B98C; --sf-amber:#E1A63E; --sf-red:#E06B62;
    --sf-nav:rgba(255,255,255,.9); --sf-track:#D9DEE8;
    --sf-sh-card:0 1px 2px rgba(30,34,50,.04), 0 12px 28px -18px rgba(30,34,50,.22);
    --sf-sh-raised:0 1px 2px rgba(30,34,50,.05);
    --sf-sh-pop:0 2px 10px rgba(30,34,50,.08);
    --sf-sh-accent:0 6px 18px -6px rgba(100,114,240,.40);
  }
  :root[data-theme="dark"]{
    --sf-bg:#14161C; --sf-surface:#1B1E26; --sf-well:#222631; --sf-border:#262A34;
    --sf-ink:#E7EAF1; --sf-muted:#9CA2B0; --sf-faint:#636A78;
    --sf-accent:#818DFF; --sf-accent-ink:#9AA4FF;
    --sf-green:#46C79A; --sf-amber:#EAB454; --sf-red:#EA7B72;
    --sf-nav:rgba(27,30,38,.9); --sf-track:#3A4150;
    --sf-sh-card:0 1px 2px rgba(0,0,0,.25), 0 14px 30px -20px rgba(0,0,0,.6);
    --sf-sh-raised:0 1px 2px rgba(0,0,0,.3);
    --sf-sh-pop:0 2px 10px rgba(0,0,0,.4);
    --sf-sh-accent:0 6px 18px -6px rgba(90,105,240,.5);
  }
  @media (prefers-color-scheme: dark){
    :root:not([data-theme="light"]){
      --sf-bg:#14161C; --sf-surface:#1B1E26; --sf-well:#222631; --sf-border:#262A34;
      --sf-ink:#E7EAF1; --sf-muted:#9CA2B0; --sf-faint:#636A78;
      --sf-accent:#818DFF; --sf-accent-ink:#9AA4FF;
      --sf-green:#46C79A; --sf-amber:#EAB454; --sf-red:#EA7B72;
      --sf-nav:rgba(27,30,38,.9); --sf-track:#3A4150;
      --sf-sh-card:0 1px 2px rgba(0,0,0,.25), 0 14px 30px -20px rgba(0,0,0,.6);
      --sf-sh-raised:0 1px 2px rgba(0,0,0,.3);
      --sf-sh-pop:0 2px 10px rgba(0,0,0,.4);
      --sf-sh-accent:0 6px 18px -6px rgba(90,105,240,.5);
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

const TYPE_LABEL = { flip: 'Flip', cloze: 'Fill the blank', short: 'Short answer', mcq: 'Multiple choice', extended: 'Long answer' };
const LEVEL_PRESETS = ['NCEA Level 1', 'NCEA Level 2', 'NCEA Level 3'];

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
const DEFAULT_SETTINGS = { interleave: true, newPerDay: 12, capNew: false, longMix: 30, theme: 'system', name: '', examDate: '', lastSeenVersion: '', onboarded: false, dismissedTips: {}, sound: true, font: 'jakarta' };

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

/* ---- version + changelog -------------------------------------------------
   APP_VERSION is the id we compare against settings.lastSeenVersion to decide
   whether to pop the "What's new" note. Bump it whenever PATCH_NOTES gains an
   entry. Newest first; the first element is the current release. */
const APP_VERSION = '1.5.0';
const PATCH_NOTES = [
  { v: '1.5.0', date: '2026-08-05', title: 'Start here', items: [
    'New here? A short walkthrough now opens on your first visit and hands you over to the generator at the end.',
    'It explains what Achieved, Merit and Excellence actually mean, using a real marked answer rather than a description of one.',
    'It also covers the two levels of help while you write, and “Explain this further” for when an answer makes no sense.',
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
const fontOf = (s) => (s && s.font) ? s.font : 'jakarta';
const longMixOf = (s) => (s && s.longMix != null) ? s.longMix : 30;
const isLongCard = (c) => c.type === 'extended';

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
    }
  }
  return out;
}
function dedupeCards(cards){
  const seen = new Set();
  const out = [];
  for (const c of cards){
    const key = c.type === 'extended'
      ? 'e:' + String(c.prompt || '').toLowerCase().slice(0, 80)
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
    : `Then about ${t.quick} quick cards (flip/cloze/short).`;
  return `You are an expert ${level} tutor. From the material below, make a MIXED set of study cards. Choose the best type for each idea — do NOT make everything the same type.

Return ONLY a JSON array. Each card is one of:
{ "type":"flip", "front": question, "back": answer }
{ "type":"cloze", "front": a sentence with one key term replaced by "____", "back": the missing term }
{ "type":"short", "front": question, "back": a model answer in 1-3 sentences }
{ "type":"mcq", "front": question, "options": [four options], "answer": index (0-based) of the correct option, "why": one line on why it is right and what the tempting wrong option gets wrong }
{ "type":"extended", "verb": one of ${COMMAND_VERBS.map(v => '"' + v + '"').join(', ')}, "prompt": full exam question, "marks": int, "achieved": the WHAT, "merit": the WHY/HOW with cause and effect, "excellence": links >=2 ideas + applies to the scenario + evaluates/justifies, "skeleton": the mark-earning sentence pattern, "pitfall": the specific error to avoid here }

THE MIX FOR THIS REPLY:
${longRule}
Then about ${t.mcq} "mcq" cards whose wrong options are REAL misconceptions a student actually holds (never filler).
${quickRule}

Emit in this order: extended, then mcq, then quick.

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
  if (/\b429\b/.test(m)) return 'Rate limited (NVIDIA\'s free tier allows ~40 requests/min) — wait a moment and try again.';
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

async function postChat(messages, maxTokens, model){
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
const postMessages = (content, maxTokens, model) => postChat([{ role: 'user', content }], maxTokens, model);
const callModel = (prompt, maxTokens = 1000, model = MODEL_GEN) => postMessages(prompt, maxTokens, model);
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

function promptFor(mode, source, level, pctLong, strict){
  if (mode === 'flip') return flipPrompt(source, level, strict);
  if (mode === 'extended') return extendedPrompt(source, level, strict);
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
    const reply = await callModel(promptFor(mode, chunk, level, pctLong, strict), GEN_MAX_TOKENS, model);
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
  "lift": one sentence naming the single change that would most raise the grade }
Be specific to THIS answer. Reward construction (mechanism, links, context) over word count.`;
}
async function markAnswer(card, answer, level){
  const reply = await callModel(markPrompt(card, answer, level), 1000, MODEL_SMART);
  const objs = rescueObjects(reply);
  return objs[0] || null;
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
  "steps": [ 2-4 objects, each { "move": "the edit to make, as an instruction (start with a verb)", "where": "which part of THEIR answer it applies to — quote 3-6 of their own words", "example": "that part rewritten the way it should read, one sentence, using the real subject content" } ],
  "habit": "one sentence: the habit that would earn this grade next time without being told" }
Quote their real words in "where". Write "example" as a finished sentence they could have written — this is feedback after marking, so showing the better version is the point. Do not invent data, quotes or NZQA codes.`;
}
async function getUpgrade(card, answer, result, level){
  const reply = await callModel(upgradePrompt(card, answer, result, level), 1100, MODEL_SMART);
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
function Chip({ children, colour = T.accent, solid, style }){
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
        <Chip colour={T.accent}>{pct}% long</Chip>
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

function Icon({ name, active }){
  const c = active ? T.accent : T.faint;
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
function StudyCard({ card, deck, onGrade, reduceMotion, prog, practice, onFeedback }){
  const [phase, setPhase] = useState('attempt');
  const [pick, setPick] = useState(null);
  const colour = subjectColour(deck.subject);
  const isMcq = card.type === 'mcq';
  const isLong = card.type === 'extended';

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

      {isLong ? <ExtendedFace card={card} phase={phase} deck={deck} onReveal={() => setPhase('reveal')} />
        : isMcq ? <McqFace card={card} phase={phase} deck={deck} pick={pick}
            onPick={(i) => {
              setPick(i); setPhase('reveal');
              /* multi-choice is the one card type where right and wrong are
                 unambiguous the instant you commit — so the reward lands here
                 rather than waiting for the grade buttons */
              if (onFeedback) onFeedback(i === card.answer ? 'right' : 'wrong');
            }} />
        : card.type === 'short' ? <ShortFace card={card} phase={phase} deck={deck} />
        : <FlipFace card={card} phase={phase} deck={deck} />}

      <div style={{ flex: 1, minHeight: 16 }} />

      <div style={{ marginTop: 18 }}>
        {phase === 'reveal' ? (
          <GradeRow grade={grade} previews={previews} />
        ) : isMcq ? (
          <Sub style={{ textAlign: 'center' }}>Tap the answer you think is right</Sub>
        ) : isLong ? (
          /* long answers run their own controls — you write, not guess */
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

function GradeRow({ grade, previews }){
  const items = [
    [Q.AGAIN, 'Again', 'got it wrong', T.red],
    [Q.HARD,  'Hard',  'only just',    T.amber],
    [Q.GOOD,  'Good',  'knew it',      T.green],
    [Q.EASY,  'Easy',  'instantly',    T.accent],
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
            fontFamily: SANS, fontSize: 13.5, fontWeight: 600, color: busy ? T.faint : T.accent }}>
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
      <Chip colour={T.accent} style={{ marginBottom: 9 }}>{tierLabel}</Chip>
      {d.plain && <RichText text={d.plain} />}
      {steps.length > 0 && (
        <div className="flex flex-col gap-2" style={{ marginTop: 4 }}>
          {steps.map((s, i) => (
            <div key={i} className="flex gap-2" style={{ alignItems: 'flex-start' }}>
              <span style={{ fontFamily: SANS, fontSize: 12, fontWeight: 800, color: T.accent,
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
function ExtendedFace({ card, phase, deck, onReveal }){
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

  useEffect(() => { setAnswer(''); setResult(null); setErr(''); setHints(null); setHintErr(''); setBig(null); setBigErr(''); selRef.current = { start: 0, end: 0 }; }, [card.id]);

  const doHints = async () => {
    setHintBusy(true); setHintErr('');
    try {
      const h = await getHints(card, deck.standard || 'NCEA Level 1');
      if (h.length) setHints(h);
      else setHintErr('Could not fetch points. Try again.');
    } catch (e){ setHintErr(friendlyApiError(e)); }
    finally { setHintBusy(false); }
  };

  const doBigHint = async () => {
    setBigBusy(true); setBigErr('');
    try {
      const h = await getBigHint(card, deck.standard || 'NCEA Level 1');
      if (h.length) setBig(h);
      else setBigErr('Could not fetch starters. Try again.');
    } catch (e){ setBigErr(friendlyApiError(e)); }
    finally { setBigBusy(false); }
  };

  const doMark = async () => {
    if (!answer.trim()) return;
    setBusy(true); setErr(''); setResult(null);
    try {
      const r = await markAnswer(card, answer, deck.standard || 'NCEA Level 1');
      if (r){
        setResult(r); onReveal && onReveal();   // show feedback and the ladder together
        /* a mark you waited 15 seconds for should announce itself */
        if (r.grade === 'Excellence'){ play('excellence'); buzz([14, 40, 14]); }
        else if (r.grade === 'Merit'){ play('milestone'); buzz(16); }
        else if (r.grade === 'Achieved'){ play('right', 1); buzz(10); }
        else play('ok');
      }
      else setErr('Could not read the marking. Try again.');
    } catch (e){ setErr(friendlyApiError(e) + ' Your answer is safe.'); }
    finally { setBusy(false); }
  };

  const words = answer.trim() ? answer.trim().split(/\s+/).length : 0;

  return (
    <div>
      <div className="flex items-center gap-2" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
        <Chip colour={T.accent} solid>{card.verb}</Chip>
        <Chip colour={T.muted}>{card.marks} marks</Chip>
      </div>

      <div style={QUESTION}>{card.prompt}</div>

      {phase === 'attempt' && (
        <div style={{ marginTop: 16 }}>
          <Sub style={{ marginBottom: 8, fontWeight: 600, color: T.ink }}>Write your answer</Sub>
          <textarea ref={taRef} value={answer}
            onChange={e => { setAnswer(e.target.value); selRef.current = { start: e.target.selectionStart, end: e.target.selectionEnd }; }}
            onSelect={rememberSel} onClick={rememberSel} onKeyUp={rememberSel}
            placeholder={`Use the ${card.verb.toLowerCase()} command properly — ${card.marks} marks means ${card.marks >= 5 ? 'several linked points' : 'more than one point'}.`}
            rows={6}
            style={{ width: '100%', background: T.well, color: T.ink, border: `1px solid ${T.border}`,
              borderRadius: R.well, padding: 14, fontFamily: SANS, fontSize: 15, lineHeight: 1.55,
              resize: 'vertical', outline: 'none' }} />
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
              <Btn kind="soft" onClick={() => onReveal && onReveal()} style={{ whiteSpace: 'nowrap' }}>Skip</Btn>
            </div>
          )}
          {err && <Sub style={{ marginTop: 10, color: T.red }}>{err}</Sub>}

          {/* a nudge for when you're stuck — structure, not the answer */}
          {hints === null ? (
            <button className="sf-tap" onClick={doHints} disabled={hintBusy}
              style={{ background: 'none', border: 'none', cursor: hintBusy ? 'default' : 'pointer',
                padding: '12px 2px 0', fontFamily: SANS, fontSize: 13.5, fontWeight: 600,
                color: hintBusy ? T.faint : T.accent }}>
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
                    <Chip colour={T.accent}>Sentence starters</Chip>
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

      {result && <MarkResult r={result} card={card} answer={answer} level={deck.standard || 'NCEA Level 1'} />}

      {phase === 'reveal' && (
        <div style={REVEAL}>
          <Rung tier="Achieved" text={card.achieved} colour={T.muted} />
          <Rung tier="Merit" text={card.merit} colour={T.accent} />
          <Rung tier="Excellence" text={card.excellence} colour={T.green} />
          {card.skeleton && (
            <div style={{ ...PANEL, marginTop: 14 }}>
              <Chip colour={T.accent} style={{ marginBottom: 6 }}>Structure that earns it</Chip>
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
function UpgradePath({ card, answer, r, level }){
  const [got, setGot] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const target = nextGradeUp(r.grade);
  const atTop = r.grade === 'Excellence';

  const run = async () => {
    setBusy(true); setErr('');
    try {
      const u = await getUpgrade(card, answer, r, level);
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
      <div className="flex flex-col gap-2">
        {steps.map((s, i) => {
          const move = typeof s === 'string' ? s : (s && s.move) || '';
          const where = (s && s.where) || '';
          const example = (s && s.example) || '';
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

function MarkResult({ r, card, answer, level }){
  const gc = r.grade === 'Excellence' ? T.green : r.grade === 'Merit' ? T.accent : r.grade === 'Achieved' ? T.muted : T.red;
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
      {card && answer && <UpgradePath card={card} answer={answer} r={r} level={level} />}
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
  const c = tier === 2 ? T.green : tier === 1 ? T.amber : T.accent;
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
function FinishedCard({ done, streak, onPractice, onHome }){
  useEffect(() => { play('done'); buzz([16, 60, 16, 60, 26]); }, []);
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
      </Card>
    </>
  );
}

function Feed({ decks, progress, settings, stats, onGrade, reduceMotion, focus, setFocus, onSettings, onQuiz, onHome }){
  const fdecks = useMemo(() => (focus === 'all' ? decks : decks.filter(d => d.id === focus)), [decks, focus]);
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
        <FinishedCard done={reviewed} streak={stats.streak || 0}
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
            reduceMotion={reduceMotion} prog={progress[it.card.id]} practice={true} onFeedback={pickFeedback} />
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
          reduceMotion={reduceMotion} prog={progress[queue[0].card.id]} practice={false} onFeedback={pickFeedback} />
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

function Create({ onSave, settings, onSettings, onPending }){
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
        setErr(lastApiError ? friendlyApiError({ message: lastApiError })
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
    } catch { setErr('Generation failed. Check your connection and try again.'); }
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
        <div style={{ marginTop: 10 }}>
          <Segmented value={cardType} onChange={setCardType}
            options={[{ v: 'mix', label: 'Mixed' }, { v: 'extended', label: 'Long' }, { v: 'flip', label: 'Quick' }]} />
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
        <DropZone onPicked={takeFiles} attaching={attaching} imageCount={images.length} />
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

      <textarea value={source} onChange={e => setSource(e.target.value)}
        placeholder={mode === 'manual' ? 'question | answer\nquestion | answer' : 'Paste your notes, or just type a topic like “rates of reaction”…'}
        rows={7}
        style={{ ...INPUT, marginTop: 14, fontSize: 15, resize: 'vertical' }} />

      {mode === 'generate' && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontFamily: SANS, fontSize: 14, fontWeight: 700, color: T.ink }}>Pitch the questions at</div>
          <Sub style={{ marginTop: 2, fontSize: 12.5 }}>Sets how hard they are and what the marking expects.</Sub>
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

      <div style={{ marginTop: 16 }}>
        <Btn full kind="primary" onClick={run} disabled={busy}>
          {busy ? (mode === 'manual' ? 'Reading…' : 'Generating…') : (mode === 'manual' ? 'Read cards' : 'Generate cards')}
        </Btn>
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
  if (d.type === 'mcq') return { tag: 'Multiple choice', main: d.front, sub: d.options[d.answer] || '' };
  if (d.type === 'short') return { tag: 'Short answer', main: d.front, sub: d.back };
  if (d.type === 'cloze') return { tag: 'Fill the blank', main: d.front, sub: d.back };
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
          <Sub style={{ color: T.accent, fontWeight: 600, fontSize: 13, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
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
function Decks({ decks, progress, onEditCard, onDeleteCard, onDeleteDeck, onRenameDeck, onStudyDeck, onQuiz }){
  const [openId, setOpenId] = useState(null);
  const open = decks.find(d => d.id === openId);

  if (open){
    return <DeckEditor deck={open} progress={progress} onBack={() => setOpenId(null)}
      onEditCard={onEditCard} onDeleteCard={onDeleteCard} onRenameDeck={onRenameDeck}
      onStudyDeck={onStudyDeck} onQuiz={onQuiz}
      onDeleteDeck={() => { onDeleteDeck(open.id); setOpenId(null); }} />;
  }

  if (!decks.length){
    return (
      <Card style={{ padding: '44px 24px', textAlign: 'center' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14, color: T.faint }}><Ico name="books" size={38} weight={1.5} /></div>
        <Title>No decks yet</Title>
        <Sub style={{ marginTop: 6 }}>Make some cards and they'll show up here.</Sub>
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

function DeckEditor({ deck, progress, onBack, onEditCard, onDeleteCard, onDeleteDeck, onRenameDeck, onStudyDeck, onQuiz }){
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

      {!renaming && (onStudyDeck || onQuiz) && (
        <div className="flex gap-2" style={{ marginBottom: 16 }}>
          {onStudyDeck && <Btn full kind="primary" onClick={() => onStudyDeck(deck.id)}>Study this deck</Btn>}
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
        </>
      )}
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
              fontFamily: SANS, fontSize: 12.5, fontWeight: 700, color: T.accent }}>
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
            <Sub style={{ fontSize: 12.5, marginTop: 2 }}>The walkthrough from your first visit — what the marking means, and the help while you write.</Sub>
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

function Home({ library, progress, stats, settings, due, onStart, onCreate, onDecks, onStudyDeck, onQuiz, onSettings, onTutorial }){
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
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12, color: T.accent }}><Ico name="sparkle" size={34} weight={1.5} /></div>
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
              { icon: 'target', t: 'Take a quiz', s: 'A quick graded test from your cards', on: () => onQuiz('all') },
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
    </div>
  );
}

/* ==========================================================================
   QUIZ  —  a quick, finite, self-graded test built from a deck's own cards.
   No API cost: multiple-choice, correct answer from the card, distractors
   pulled from other cards in the pool. Extended (essay) cards sit this out.
   ========================================================================== */
function quizAnswerText(c){
  if (c.type === 'mcq') return (c.options && c.options[c.answer] != null) ? String(c.options[c.answer]) : '';
  return String(c.back != null ? c.back : '');
}
function quizQuestionText(c){
  return String((c.front != null ? c.front : c.prompt) || '');
}
const quizUsable = (c) => c.type !== 'extended' && quizQuestionText(c).trim() && quizAnswerText(c).trim();
const QUIZ_MIN = 4;

function buildQuiz(cards, count){
  const usable = cards.filter(quizUsable);
  const answerPool = Array.from(new Set(usable.map(quizAnswerText)));
  const chosen = shuffle(usable).slice(0, count);
  const out = [];
  for (const c of chosen){
    if (c.type === 'mcq' && c.options && c.options.length >= 2){
      const correctText = String(c.options[c.answer] != null ? c.options[c.answer] : c.options[0]);
      const options = shuffle(c.options.map(String));
      out.push({ cardId: c.id, q: quizQuestionText(c), options, answer: options.indexOf(correctText) });
    } else {
      const correct = quizAnswerText(c);
      const distractors = shuffle(answerPool.filter(a => a !== correct)).slice(0, 3);
      const options = shuffle([correct].concat(distractors));
      out.push({ cardId: c.id, q: quizQuestionText(c), options, answer: options.indexOf(correct) });
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

            {decks.length > 1 && (
              <Card style={{ padding: 15, marginBottom: 12, boxShadow: SH.raised }}>
                <div style={{ fontFamily: SANS, fontSize: 13, fontWeight: 700, color: T.muted, marginBottom: 10 }}>Which deck?</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {[{ id: 'all', label: 'All decks', colour: T.accent }].concat(
                    decks.map(d => ({ id: d.id, label: d.topic || d.subject || 'Untitled', colour: subjectColour(d.subject) }))
                  ).map(o => {
                    const active = scope === o.id;
                    return (
                      <button key={o.id} className="sf-tap" onClick={() => setScope(o.id)}
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
            )}

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
function PatchNotesList(){
  return (
    <div>
      {PATCH_NOTES.map((rel, ri) => (
        <div key={rel.v} style={{ marginTop: ri ? 22 : 0 }}>
          <div className="flex items-baseline gap-2">
            <Title style={{ fontSize: 19 }}>{rel.title}</Title>
            <Sub style={{ fontSize: 12 }}>v{rel.v} · {rel.date}</Sub>
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

/* ==========================================================================
   FIRST-RUN TUTORIAL

   Six panels, shown once to someone who has never opened the app before.

   Everything on the marking panels is canned rather than fetched. A tutorial
   that waited on the model would open with a 15-second spinner, spend tokens
   on someone who has not made a single card yet, and fail outright on a bad
   connection — which is the one first impression we cannot afford. The
   trade-off is that these strings can drift from what the model actually
   returns, so the example is written in the same shape as markPrompt's schema
   (grade / hit / missing / lift) and rendered through the real MarkResult,
   not a lookalike. If that schema changes, this has to change with it.

   MarkResult is deliberately given no `card` or `answer`, which is what
   suppresses UpgradePath — the one child that would fire an API call.
   ========================================================================== */

const TUT_CARD = {
  id: 'tutorial-example', type: 'extended', verb: 'Explain', marks: 4,
  prompt: 'A cyclist stops pedalling on a flat road and slowly coasts to a stop. Explain why the cyclist slows down and eventually stops.',
};

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
  lift: 'You have said what happens. Excellence needs the unbalanced force named AND the energy followed through to where it ends up.',
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

/* The wording matches markPrompt (the WHAT / the WHY / the SO WHAT), so the
   ladder a student is taught here is the ladder the marker is actually using. */
const TUT_LADDER = [
  { tier: 'Not yet',    colour: T.red,   gist: 'Not there yet',   note: 'Usually a right-sounding sentence that never answers the question asked.' },
  { tier: 'Achieved',   colour: T.muted, gist: 'The WHAT',        note: 'You state or describe the correct thing.' },
  { tier: 'Merit',      colour: T.accent, gist: 'The WHY and HOW', note: 'You explain it, with cause and effect joined up.' },
  { tier: 'Excellence', colour: T.green, gist: 'The SO WHAT',     note: 'You link ideas together, apply them to this exact scenario, and justify it.' },
];

/* A numbered row, used by the panels that walk through a sequence. */
function TutStep({ n, title, children }){
  return (
    <div className="flex gap-3" style={{ alignItems: 'flex-start' }}>
      <span style={{ width: 25, height: 25, borderRadius: R.pill, background: rgba(T.accent, 0.12), color: T.accentInk,
        display: 'grid', placeItems: 'center', fontFamily: SANS, fontSize: 12.5, fontWeight: 800, flexShrink: 0 }}>{n}</span>
      <div>
        <div style={{ fontFamily: SANS, fontSize: 14.5, fontWeight: 700, color: T.ink }}>{title}</div>
        <Sub style={{ fontSize: 13, marginTop: 2 }}>{children}</Sub>
      </div>
    </div>
  );
}

/* Frames a piece of the real UI so it reads as a specimen rather than as
   something you are meant to be able to press. */
function TutShot({ label, children }){
  return (
    <div style={{ marginTop: 14 }}>
      {label && <div style={{ fontFamily: SANS, fontSize: 11, fontWeight: 700, letterSpacing: '0.06em',
        textTransform: 'uppercase', color: T.faint, marginBottom: 7 }}>{label}</div>}
      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: R.well,
        padding: '15px 16px', boxShadow: SH.raised }}>{children}</div>
    </div>
  );
}

const TUTORIAL_STEPS = [
  {
    key: 'welcome',
    title: 'Welcome to Study Feed',
    lede: 'A minute now, and the rest will make sense.',
    body: () => (
      <div>
        <div style={{ fontFamily: SANS, fontSize: 15, lineHeight: 1.6, color: T.ink }}>
          Flashcards get you Achieved. The marks that decide your grade sit in the long written
          questions — and those are a writing problem, not a memory problem.
        </div>
        <Sub style={{ marginTop: 12, fontSize: 14, lineHeight: 1.6 }}>
          So this app does the usual quick cards, and then it does the part nothing else does:
          you write a real exam answer, it marks it against Achieved, Merit and Excellence, and it
          tells you exactly what to change.
        </Sub>
        <div style={{ ...PANEL, marginTop: 16, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <span style={{ color: T.accent, flexShrink: 0, marginTop: 1 }}><Ico name="sparkle" size={16} /></span>
          <Sub style={{ fontSize: 13.5, lineHeight: 1.55 }}>
            Nothing here is set up yet — the app ships empty and fills with your own notes.
            That is what the next panel is about.
          </Sub>
        </div>
      </div>
    ),
  },
  {
    key: 'generate',
    title: 'Cards come from your notes',
    lede: 'The Create tab is where everything starts.',
    body: () => (
      <div>
        <div className="flex flex-col gap-3">
          <TutStep n="1" title="Give it your material">
            Paste your notes, or upload a PDF, Word doc, PowerPoint or a photo of the board.
            No topic in mind? Type one — “rates of reaction” is enough to start.
          </TutStep>
          <TutStep n="2" title="Pick what you want out of it">
            <b style={{ color: T.ink }}>Mixed</b> lets it choose the best card type per idea.
            <b style={{ color: T.ink }}> Long</b> makes exam-style written questions.
            <b style={{ color: T.ink }}> Quick</b> makes fast recall cards.
          </TutStep>
          <TutStep n="3" title="Check them, then save">
            The cards appear for you to look over before anything is kept. Bin the ones that
            missed, then save the deck and it lands in your feed.
          </TutStep>
        </div>
        <div style={{ ...PANEL, marginTop: 16, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <span style={{ color: T.accent, flexShrink: 0, marginTop: 1 }}><Ico name="books" size={16} /></span>
          <Sub style={{ fontSize: 13.5, lineHeight: 1.55 }}>
            Set the level (NCEA Level 1 by default) on that screen too — it sets how hard the
            questions are and what the marking expects of you.
          </Sub>
        </div>
      </div>
    ),
  },
  {
    key: 'question',
    title: 'What a long question looks like',
    lede: 'Two labels tell you how to answer before you write a word.',
    body: () => (
      <div>
        <TutShot label="A card in your feed">
          <div className="flex items-center gap-2" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
            <Chip colour={T.accent} solid>{TUT_CARD.verb}</Chip>
            <Chip colour={T.muted}>{TUT_CARD.marks} marks</Chip>
          </div>
          <div style={{ ...QUESTION, fontSize: 18 }}>{TUT_CARD.prompt}</div>
        </TutShot>
        <div className="flex flex-col gap-3" style={{ marginTop: 18 }}>
          <TutStep n="1" title="The command verb caps your grade">
            <b style={{ color: T.ink }}>Explain</b> wants cause and effect. A question that only says
            <i> Describe</i> cannot reach Excellence no matter how well you write it — so answer the
            verb you were given.
          </TutStep>
          <TutStep n="2" title="The marks tell you how much to write">
            4 marks is not one sentence. Roughly, each mark is another linked point — and “linked”
            is doing the work in that sentence.
          </TutStep>
        </div>
        <Sub style={{ marginTop: 16, fontSize: 13.5, lineHeight: 1.6 }}>
          You type your answer straight underneath, then press <b style={{ color: T.ink }}>Mark my
          answer</b>. Next panel is what comes back.
        </Sub>
      </div>
    ),
  },
  {
    key: 'marking',
    title: 'What the marking means',
    lede: 'Every long answer is graded on this ladder.',
    body: () => (
      <div>
        <div className="flex flex-col gap-2">
          {TUT_LADDER.map(l => (
            <div key={l.tier} style={{ display: 'flex', gap: 11, alignItems: 'flex-start',
              background: rgba(l.colour, 0.07), border: `1px solid ${rgba(l.colour, 0.18)}`,
              borderRadius: R.well, padding: '11px 13px' }}>
              <span style={{ width: 4, alignSelf: 'stretch', borderRadius: 4, background: l.colour, flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div className="flex items-baseline gap-2" style={{ flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: SANS, fontSize: 14.5, fontWeight: 800, color: T.ink }}>{l.tier}</span>
                  <span style={{ fontFamily: SANS, fontSize: 12, fontWeight: 700, color: l.colour, letterSpacing: '0.02em' }}>{l.gist}</span>
                </div>
                <Sub style={{ fontSize: 13, marginTop: 2, lineHeight: 1.5 }}>{l.note}</Sub>
              </div>
            </div>
          ))}
        </div>

        <TutShot label="Say you wrote this">
          <div style={{ fontFamily: SANS, fontSize: 14.5, lineHeight: 1.6, color: T.muted, fontStyle: 'italic' }}>
            “{TUT_ANSWER}”
          </div>
        </TutShot>

        <div style={{ marginTop: 14 }}>
          <div style={{ fontFamily: SANS, fontSize: 11, fontWeight: 700, letterSpacing: '0.06em',
            textTransform: 'uppercase', color: T.faint, marginBottom: 7 }}>What comes back</div>
          <MarkResult r={TUT_MARK} />
        </div>

        <div className="flex flex-col gap-3" style={{ marginTop: 18 }}>
          <TutStep n="1" title="What earned credit">
            The parts that actually scored. Worth reading even when the grade is good — it tells
            you which habit to keep.
          </TutStep>
          <TutStep n="2" title="To reach the next grade">
            The specific things missing. Not “add more detail” — the actual physics, or point, or
            link that is not on the page.
          </TutStep>
          <TutStep n="3" title="The line in bold">
            The single change that would lift the grade most, if you only do one thing.
          </TutStep>
        </div>

        <div style={{ ...PANEL, marginTop: 16, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <span style={{ color: T.green, flexShrink: 0, marginTop: 1 }}><Ico name="target" size={16} /></span>
          <Sub style={{ fontSize: 13.5, lineHeight: 1.55 }}>
            Under a real mark there is also <b style={{ color: T.ink }}>How do I get to Excellence?</b> —
            it quotes your own sentences back and shows each one rewritten properly.
          </Sub>
        </div>
      </div>
    ),
  },
  {
    key: 'hints',
    title: 'When you are stuck',
    lede: 'Two nudges, and neither one hands you the answer.',
    body: () => (
      <div>
        <Sub style={{ fontSize: 14, lineHeight: 1.6 }}>
          Staring at a blank box teaches you nothing, but neither does copying a model answer. So
          the help comes in two sizes, under the answer box.
        </Sub>

        <TutShot label="Tap 1 — Stuck? Give me some writing points">
          <div className="flex items-center justify-between" style={{ marginBottom: 9 }}>
            <Chip colour={T.amber}>Writing points</Chip>
            <Sub style={{ fontSize: 11.5 }}>The shape of the answer — the words are yours</Sub>
          </div>
          <div className="flex flex-col gap-2">
            {TUT_HINTS.map((h, i) => (
              <div key={i} className="flex gap-2" style={{ alignItems: 'flex-start' }}>
                <span style={{ fontFamily: SANS, fontSize: 12, fontWeight: 800, color: T.amber,
                  lineHeight: '22px', flexShrink: 0 }}>{i + 1}</span>
                <span style={{ fontFamily: SANS, fontSize: 14.5, lineHeight: 1.5, color: T.ink }}>{h}</span>
              </div>
            ))}
          </div>
        </TutShot>

        <TutShot label="Still stuck? Tap 2 — sentence starters">
          <div className="flex items-center justify-between" style={{ marginBottom: 9 }}>
            <Chip colour={T.accent}>Sentence starters</Chip>
            <Sub style={{ fontSize: 11.5 }}>Fill each blank yourself</Sub>
          </div>
          <div className="flex flex-col gap-2">
            {TUT_STARTERS.map((h, i) => (
              <div key={i} style={{ fontFamily: SANS, fontSize: 14.5, lineHeight: 1.55, color: T.ink,
                background: T.well, border: `1px solid ${T.border}`, borderRadius: R.input, padding: '9px 12px' }}>{h}</div>
            ))}
          </div>
        </TutShot>

        <Sub style={{ marginTop: 16, fontSize: 13.5, lineHeight: 1.6 }}>
          The blanks are the point. Filling them is what gets marked, and it is the bit that has to
          come from you in the exam.
        </Sub>
      </div>
    ),
  },
  {
    key: 'explain',
    title: 'When you do not get it',
    lede: 'Explain this further, on any card you have revealed.',
    body: () => (
      <div>
        <TutShot label="Under any revealed answer">
          <span className="flex items-center gap-2" style={{ fontFamily: SANS, fontSize: 13.5, fontWeight: 600, color: T.accent }}>
            <Ico name="search" size={15} />Explain this further
          </span>
        </TutShot>
        <Sub style={{ marginTop: 14, fontSize: 14, lineHeight: 1.6 }}>
          Getting an answer wrong tells you that you were wrong, not why. This gives you the
          reasoning behind it — the steps, and the thing to watch out for next time.
        </Sub>
        <div style={{ ...PANEL, marginTop: 16 }}>
          <div style={{ fontFamily: SANS, fontSize: 14, fontWeight: 700, color: T.ink, marginBottom: 8 }}>
            Landed at the wrong level?
          </div>
          <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
            <span style={{ fontFamily: SANS, fontSize: 13, fontWeight: 600, color: T.ink, background: T.surface,
              border: `1px solid ${T.border}`, borderRadius: R.pill, padding: '8px 14px' }}>Simpler</span>
            <span style={{ fontFamily: SANS, fontSize: 13, fontWeight: 600, color: T.ink, background: T.surface,
              border: `1px solid ${T.border}`, borderRadius: R.pill, padding: '8px 14px' }}>Go deeper</span>
          </div>
          <Sub style={{ fontSize: 13, marginTop: 10, lineHeight: 1.55 }}>
            Ask again at a different level as many times as you need. It is the same idea explained
            differently, not a different idea.
          </Sub>
        </div>
        <div style={{ ...PANEL, marginTop: 12, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <span style={{ color: T.accent, flexShrink: 0, marginTop: 1 }}><Ico name="bulb" size={16} /></span>
          <Sub style={{ fontSize: 13.5, lineHeight: 1.55 }}>
            The round button in the corner of every screen is <b style={{ color: T.ink }}>Ask anything</b>.
            It can see the card you are on, so “why is that the answer?” works without retyping it.
          </Sub>
        </div>
      </div>
    ),
  },
  {
    key: 'done',
    title: 'That is the whole app',
    lede: 'The rest you will pick up as you go.',
    body: () => (
      <div>
        <div className="flex flex-col gap-3">
          <TutStep n="1" title="Rate every card honestly">
            Again, Hard, Good and Easy decide when a card comes back. Marking something Easy when
            it was not is only cheating your own schedule.
          </TutStep>
          <TutStep n="2" title="The feed is meant to end">
            When the cards actually due are done, it stops and says so. Carrying on is a deliberate
            choice, and it never touches your schedule.
          </TutStep>
          <TutStep n="3" title="Everything stays on this device">
            No account, no sync. Export your decks from Settings if you want them somewhere safe.
          </TutStep>
        </div>
        <div style={{ ...PANEL, marginTop: 16, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <span style={{ color: T.muted, flexShrink: 0, marginTop: 1 }}><Ico name="clock" size={16} /></span>
          <Sub style={{ fontSize: 13.5, lineHeight: 1.55 }}>
            Want this again later? It is in <b style={{ color: T.ink }}>Settings → How this app works</b>.
          </Sub>
        </div>
      </div>
    ),
  },
];

/* onDone fires on finishing OR skipping — both mean "do not show this again".
   `finished` only decides whether we drop them on the Create tab afterwards:
   someone who skipped has said they want to look around by themselves, and
   throwing them into the generator anyway would ignore that. */
function Tutorial({ onDone }){
  const [i, setI] = useState(0);
  const bodyRef = useRef(null);
  const last = i === TUTORIAL_STEPS.length - 1;
  const step = TUTORIAL_STEPS[i];

  const back = () => setI(n => Math.max(0, n - 1));
  const next = () => { if (last) onDone(true); else setI(n => Math.min(TUTORIAL_STEPS.length - 1, n + 1)); };

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onDone(false);
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') back();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [i, last]);

  /* A new panel starts at the top. Without this, panel 5 opens halfway down
     because panel 4 is long enough to scroll. */
  useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = 0; }, [i]);

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 70, background: T.bg, display: 'flex', flexDirection: 'column' }}>
      <div style={{ width: '100%', maxWidth: 560, margin: '0 auto', padding: '16px 16px 0', flexShrink: 0 }}>
        <div className="flex items-center justify-between" style={{ marginBottom: 14 }}>
          <div className="flex items-center gap-2">
            {TUTORIAL_STEPS.map((s, n) => (
              <span key={s.key} style={{ width: n === i ? 22 : 7, height: 7, borderRadius: 7,
                background: n === i ? T.accent : n < i ? rgba(T.accent, 0.4) : 'var(--sf-track)',
                transition: 'width 240ms cubic-bezier(.2,.8,.3,1), background 240ms' }} />
            ))}
          </div>
          <button onClick={() => onDone(false)} className="sf-tap"
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: SANS,
              fontSize: 13.5, fontWeight: 600, color: T.muted, padding: '4px 2px' }}>Skip</button>
        </div>
      </div>

      <div ref={bodyRef} style={{ flex: 1, overflowY: 'auto' }}>
        <div style={{ width: '100%', maxWidth: 560, margin: '0 auto', padding: '4px 16px 24px' }}>
          <div key={step.key} style={{ animation: 'sf-in 280ms cubic-bezier(.2,.8,.3,1)' }}>
            <Title style={{ fontSize: 24, fontWeight: 800 }}>{step.title}</Title>
            <Sub style={{ marginTop: 4, marginBottom: 18 }}>{step.lede}</Sub>
            {step.body()}
          </div>
        </div>
      </div>

      <div style={{ flexShrink: 0, borderTop: `1px solid ${T.border}`, background: T.surface }}>
        <div style={{ width: '100%', maxWidth: 560, margin: '0 auto', padding: '12px 16px',
          paddingBottom: 'calc(12px + env(safe-area-inset-bottom))', display: 'flex', gap: 10 }}>
          {i > 0 && <Btn kind="soft" onClick={back} style={{ flexShrink: 0 }}>Back</Btn>}
          <Btn full kind="primary" onClick={next}>{last ? 'Make my first cards' : 'Next'}</Btn>
        </div>
      </div>
    </div>
  );
}

/* Full-page version of the changelog (its own nav tab). */
function Changelog(){
  return (
    <div>
      <Title style={{ marginBottom: 6 }}>What's new</Title>
      <Sub style={{ marginBottom: 16 }}>Every update to Study Feed, newest first.</Sub>
      <Card style={{ padding: 18, boxShadow: SH.raised }}>
        <PatchNotesList />
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
          <span style={{ color: T.accent, display: 'flex' }}><AskIcon size={20} /></span>
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
  const [pendingCount, setPendingCount] = useState(0);   // unsaved drafts waiting on Create
  const [focus, setFocus] = useState('all');             // which deck the feed is showing: 'all' or a deck id
  const [quiz, setQuiz] = useState(null);                // { deckId } while a quiz is open, else null
  const [showNews, setShowNews] = useState(false);       // "What's new" note after an update
  const [showTutorial, setShowTutorial] = useState(false); // first-run walkthrough
  const [askOpen, setAskOpen] = useState(false);         // the ask-anything helper
  const [thread, setThread] = useState([]);              // its conversation, this session only
  const reduceMotion = useRef(false);

  // a focused deck that then gets deleted shouldn't leave the feed stuck empty
  useEffect(() => {
    if (focus !== 'all' && ready && !library.decks.some(d => d.id === focus)) setFocus('all');
  }, [library, focus, ready]);

  const startDeck = (deckId) => { setFocus(deckId); setTab('feed'); };
  const openQuiz = (deckId) => setQuiz({ deckId: deckId || 'all' });

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

  const saveDeck = (cards, meta) => {
    const deck = {
      id: uid(),
      subject: (meta.subject || 'Untitled').trim(),
      topic: (meta.topic || '').trim(),
      standard: (meta.standard || 'NCEA Level 1').trim(),
      cards: cards.map(({ keep, ...c }) => c),
    };
    persistLibrary({ decks: [...library.decks, deck] });
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
          onDecks={() => setTab('decks')} onStudyDeck={startDeck} onQuiz={openQuiz} onSettings={persistSettings}
          onTutorial={replayTutorial} />}
        {/* key includes focus + mix so switching deck or moving the slider rebuilds the queue */}
        {tab === 'feed' && <Feed key={'feed-' + focus + '-' + cardCount + '-' + longMixOf(settings)}
          decks={library.decks} progress={progress} settings={settings} stats={stats} onGrade={gradeCard}
          reduceMotion={reduceMotion.current} focus={focus} setFocus={setFocus}
          onSettings={persistSettings} onQuiz={openQuiz} onHome={() => setTab('home')} />}
        {/* Create stays MOUNTED and is hidden instead — unmounting it threw away
            unsaved drafts, pasted notes and attached photos the moment you
            switched tabs, and those drafts cost real API usage to produce. */}
        <div style={{ display: tab === 'create' ? 'block' : 'none' }}>
          <Create onSave={saveDeck} settings={settings} onSettings={persistSettings} onPending={setPendingCount} />
        </div>
        {tab === 'decks' && <Decks decks={library.decks} progress={progress} onEditCard={editCard}
          onDeleteCard={deleteCard} onDeleteDeck={deleteDeck} onRenameDeck={renameDeck}
          onStudyDeck={startDeck} onQuiz={openQuiz} />}
        {tab === 'stats' && <Stats decks={library.decks} progress={progress} stats={stats} />}
        {tab === 'changelog' && <Changelog />}
        {tab === 'feedback' && <FeatureRequest />}
        {tab === 'settings' && <Settings settings={settings} onChange={persistSettings}
          library={library} progress={progress} onImport={importLibrary} onTutorial={replayTutorial} />}
      </div>
    </Shell>
    {quiz && <Quiz decks={library.decks} deckId={quiz.deckId} onClose={() => setQuiz(null)} onDone={recordQuiz} />}
    {showNews && !showTutorial && <WhatsNew onClose={dismissNews} />}
    {showTutorial && <Tutorial onDone={endTutorial} />}
    {/* the helper is available on every screen — except where something else
        already owns the whole screen (a quiz, the update note, the tutorial) */}
    {askOpen && <AskPanel thread={thread} setThread={setThread} onClose={() => setAskOpen(false)} />}
    {!askOpen && !quiz && !showNews && !showTutorial && <AskFab onClick={() => setAskOpen(true)} />}
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
      <div style={{ fontFamily: SANS, fontSize: 21, fontWeight: 800, color: T.ink,
        letterSpacing: '-0.03em', padding: '0 10px', marginBottom: 22 }}>Study Feed</div>
      <div className="flex flex-col gap-1">
        {NAV_ITEMS.map(([k, label]) => {
          const active = tab === k;
          return (
            <button key={k} className="sf-tap" onClick={() => setTab(k)}
              style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left',
                padding: '11px 12px', borderRadius: 14, border: 'none', cursor: 'pointer',
                background: active ? rgba(T.accent, 0.1) : 'transparent',
                transition: 'background 160ms' }}>
              <Icon name={k} active={active} />
              <span style={{ fontFamily: SANS, fontSize: 15, fontWeight: active ? 700 : 500,
                color: active ? T.accent : T.muted }}>{label}</span>
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
      <div style={{ fontFamily: SANS, fontSize: 24, fontWeight: 800, color: T.ink, letterSpacing: '-0.03em' }}>
        Study Feed
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
            <button key={k} className="sf-tap" onClick={() => setTab(k)}
              style={{ flex: 1, background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, position: 'relative' }}>
              <Icon name={k} active={active} />
              <span style={{ fontFamily: SANS, fontSize: 10.5, fontWeight: active ? 700 : 500,
                color: active ? T.accent : T.faint, transition: 'color 160ms' }}>{label}</span>
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
