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

/* ---- tokens -------------------------------------------------------------- */
const T = {
  bg:        '#F6F7FB',
  surface:   '#FFFFFF',
  well:      '#F1F3F9',
  border:    '#E4E7F0',
  ink:       '#14162B',
  muted:     '#5C6178',
  faint:     '#9AA0B4',
  accent:    '#4255FF',
  accentInk: '#2F3EDB',
  green:     '#10B981',
  amber:     '#F59E0B',
  red:       '#E5484D',
};

const SANS = '-apple-system, BlinkMacSystemFont, "SF Pro Rounded", "Segoe UI", Roboto, system-ui, sans-serif';

const rgba = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

const R  = { card: 20, well: 16, input: 14, pill: 999 };
const SH = {
  card:    '0 1px 2px rgba(20,22,43,0.04), 0 10px 28px -12px rgba(20,22,43,0.16)',
  raised:  '0 1px 2px rgba(20,22,43,0.06)',
  pop:     '0 2px 10px rgba(20,22,43,0.09)',
  accent:  `0 6px 16px -4px ${rgba('#4255FF', 0.45)}`,
};

/* friendly hues that read well on white */
const HUES = ['#4255FF','#F59E0B','#10B981','#A855F7','#06B6D4','#EC4899','#8B5CF6','#F97316'];
function subjectColour(name){
  const s = (name || '').trim().toLowerCase();
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return HUES[h % HUES.length];
}

const TYPE_LABEL = { flip: 'Flip', cloze: 'Fill the blank', short: 'Short answer', mcq: 'Multiple choice', extended: 'Long answer' };
const LEVEL_PRESETS = ['NCEA Level 1', 'NCEA Level 2', 'NCEA Level 3'];

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

/* ---- storage ------------------------------------------------------------- */
async function load(key, fallback){
  try {
    const r = await window.storage.get(key);
    if (r === undefined || r === null) return fallback;
    const raw = (r && typeof r === 'object' && 'value' in r) ? r.value : r;
    if (raw === undefined || raw === null) return fallback;
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch { return fallback; }
}
async function save(key, value){
  try { await window.storage.set(key, JSON.stringify(value)); return true; }
  catch (e){ console.error('storage.set failed', key, e); return false; }
}

/* longMix = what % of your cards should be long (extended-response) answers.
   Drives both what gets generated and how the feed is blended. */
const DEFAULT_SETTINGS = { interleave: true, newPerDay: 12, capNew: false, saveUsage: false, longMix: 30 };
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

    let ivl;
    if (p.reps === 0)      ivl = 1;
    else if (p.reps === 1) ivl = 6;
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

/* bigger batches = fewer API calls = less usage burned per generate */
function batchText(text, size = 12000){
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

function flipPrompt(source, level){
  return `You write flashcards for a ${level} student. From the material below, produce fast-recall cards for definitions, formulae, key facts and vocabulary.
Return ONLY lines of the form:  question | answer
One card per line. No numbering, no extra prose. Keep answers tight.
Do not invent facts not supported by the material.

MATERIAL:
${source}`;
}

function extendedPrompt(source, level){
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

Rules: the verb sets the grade ceiling; the three answers differ in depth not length; Excellence must refer to the actual scenario. Science: claim -> mechanism -> link to context. Maths: show working; method marks independent of the answer; state units; Excellence justifies the method. English: point -> evidence -> analysis of technique -> connection to purpose. Do NOT invent NZQA codes. No JSON outside the array.

MATERIAL:
${source}`;
}

/* turn the slider percentage into concrete per-reply counts */
function mixTargets(pctLong){
  const p = Math.max(0, Math.min(100, pctLong));
  if (p <= 5)  return { long: 0, mcq: 2, quick: 11 };
  if (p >= 95) return { long: 6, mcq: 1, quick: 0 };
  return {
    long:  Math.max(1, Math.round((p / 100) * 7)),
    mcq:   2,
    quick: Math.max(1, Math.round(((100 - p) / 100) * 11)),
  };
}

function mixedPrompt(source, level, pctLong){
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

Ground everything in the material. Do NOT invent NZQA codes. No JSON outside the array.

MATERIAL:
${source}`;
}

/* Two tiers. Haiku is ~3x cheaper and plenty for short recall; Sonnet does the
   work where quality shows. Routing is per WHOLE call — splitting one batch
   across both sends the same notes twice and cancels most of the saving. */
const MODEL_SMART = 'claude-sonnet-4-6';
const MODEL_CHEAP = 'claude-haiku-4-5-20251001';

function pickModel(mode, settings){
  if (settings && settings.saveUsage) return MODEL_CHEAP;
  return mode === 'flip' ? MODEL_CHEAP : MODEL_SMART;
}

/* One bad batch shouldn't sink the rest — but a failure hitting EVERY batch
   would otherwise surface as a blank "nothing came back". Record it. */
let lastApiError = '';
const noteApiError = (e) => { lastApiError = (e && e.message) ? String(e.message) : String(e); };

async function postMessages(content, maxTokens, model){
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: 'user', content }] }),
  });
  if (!res.ok) throw new Error('API returned ' + res.status + (res.status === 404 ? ' (unknown model)' : ''));
  const data = await res.json();
  return (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
}
const callModel = (prompt, maxTokens = 1000, model = MODEL_SMART) => postMessages(prompt, maxTokens, model);
function callModelMulti(prompt, images, maxTokens = 1000, model = MODEL_SMART){
  const content = images.map(im => ({ type: 'image', source: { type: 'base64', media_type: im.media_type, data: im.data } }));
  content.push({ type: 'text', text: prompt });
  return postMessages(content, maxTokens, model);
}

function promptFor(mode, source, level, pctLong){
  if (mode === 'flip') return flipPrompt(source, level);
  if (mode === 'extended') return extendedPrompt(source, level);
  return mixedPrompt(source, level, pctLong);
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

async function genText(source, mode, level, onProgress, model, pctLong){
  const batches = batchText(source);
  let cards = [];
  for (let i = 0; i < batches.length; i++){
    onProgress && onProgress(i + 1, batches.length, 'text');
    let reply = '';
    try { reply = await callModel(promptFor(mode, batches[i], level, pctLong), 2000, model); }
    catch (e){ noteApiError(e); continue; }
    cards = cards.concat(parseReply(mode, reply));
  }
  return cards;
}
async function genImages(images, mode, level, onProgress, model, pctLong){
  const groups = [];
  for (let i = 0; i < images.length; i += 6) groups.push(images.slice(i, i + 6));
  const note = 'Base the cards ONLY on the attached image(s). Read all text, labels, diagrams, formulae and handwriting in them.';
  let cards = [];
  for (let g = 0; g < groups.length; g++){
    onProgress && onProgress(g + 1, groups.length, 'images');
    let reply = '';
    try { reply = await callModelMulti(promptFor(mode, note, level, pctLong), groups[g], 2000, model); }
    catch (e){ noteApiError(e); continue; }
    cards = cards.concat(parseReply(mode, reply));
  }
  return cards;
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
async function resizeImage(blob, maxPx = 1500, quality = 0.82){
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
async function extractFile(file){
  const name = (file.name || '').toLowerCase();
  const type = file.type || '';
  if (type.startsWith('image/')) return { text: '', images: [file] };
  if (name.endsWith('.txt') || type === 'text/plain') return { text: (await file.text()).trim(), images: [] };

  const JSZip = await loadJSZip();
  const zip = await JSZip.loadAsync(file);

  // content images only — logos and bullet icons cost usage and teach nothing
  const images = [];
  const media = Object.keys(zip.files).filter(n => /\/media\/[^/]+\.(png|jpe?g|gif|bmp|webp)$/i.test(n));
  for (const n of media){
    if (images.length >= MAX_EMBEDDED_IMAGES) break;
    try {
      const b = await zip.file(n).async('blob');
      if (b && b.size >= MIN_EMBEDDED_IMAGE_BYTES) images.push(b);
    } catch {}
  }

  if (name.endsWith('.docx')){
    const doc = zip.file('word/document.xml');
    const text = doc ? stripXml(await doc.async('string')).trim() : '';
    if (!text && !images.length) throw new Error('This Word file had no readable text or pictures.');
    return { text, images };
  }
  if (name.endsWith('.pptx')){
    const slides = Object.keys(zip.files)
      .filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
      .sort((a, b) => parseInt(a.match(/(\d+)/)[1]) - parseInt(b.match(/(\d+)/)[1]));
    const parts = [];
    for (const n of slides) parts.push(stripXml(await zip.file(n).async('string')).trim());
    const text = parts.filter(Boolean).join('\n\n');
    if (!text && !images.length) throw new Error('This PowerPoint had no readable content.');
    return { text, images };
  }
  throw new Error('Use a photo, Word, PowerPoint or text file.');
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
  if (name === 'feed') return <svg {...common}><rect x="3" y="7" width="18" height="13" rx="3.5" /><path d="M7 4h10" /></svg>;
  if (name === 'create') return <svg {...common}><circle cx="12" cy="12" r="8.5" /><path d="M12 8.5v7M8.5 12h7" /></svg>;
  if (name === 'decks') return <svg {...common}><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h3.2l2 2.2h7.8A2.5 2.5 0 0 1 21 9.7v7.8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z" /></svg>;
  if (name === 'stats') return <svg {...common}><path d="M5.5 19.5V12M12 19.5V5M18.5 19.5v-5.5" /></svg>;
  return <svg {...common}><path d="M4 8h16M4 16h16" /><circle cx="9.5" cy="8" r="2.2" fill={T.surface} /><circle cx="15" cy="16" r="2.2" fill={T.surface} /></svg>;
}

/* ==========================================================================
   STUDY CARD
   ========================================================================== */
function StudyCard({ card, deck, onGrade, reduceMotion, prog, practice }){
  const [phase, setPhase] = useState('attempt');
  const [pick, setPick] = useState(null);
  const colour = subjectColour(deck.subject);
  const isMcq = card.type === 'mcq';
  const isLong = card.type === 'extended';

  useEffect(() => { setPhase('attempt'); setPick(null); }, [card.id]);

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
          <Sub style={{ color: '#8A5A00', fontWeight: 600, fontSize: 13 }}>
            ⚠︎ You were sure about this one last time and got it wrong — read it properly.
          </Sub>
        </div>
      )}

      {isLong ? <ExtendedFace card={card} phase={phase} deck={deck} onReveal={() => setPhase('reveal')} />
        : isMcq ? <McqFace card={card} phase={phase} pick={pick} onPick={(i) => { setPick(i); setPhase('reveal'); }} />
        : card.type === 'short' ? <ShortFace card={card} phase={phase} />
        : <FlipFace card={card} phase={phase} />}

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

function FlipFace({ card, phase }){
  return (
    <div>
      <div style={QUESTION}>{card.front}</div>
      {phase === 'reveal' && <div style={{ ...REVEAL, ...ANSWER }}>{card.back}</div>}
    </div>
  );
}

function ShortFace({ card, phase }){
  return (
    <div>
      <div style={QUESTION}>{card.front}</div>
      {phase === 'reveal' && (
        <div style={REVEAL}>
          <Chip colour={T.green} style={{ marginBottom: 8 }}>Model answer</Chip>
          <div style={ANSWER}>{card.back}</div>
        </div>
      )}
    </div>
  );
}

function McqFace({ card, phase, pick, onPick }){
  const letters = ['A','B','C','D','E','F'];
  const revealed = phase === 'reveal';
  return (
    <div>
      <div style={{ ...QUESTION, marginBottom: 16 }}>{card.front}</div>
      <div className="flex flex-col gap-2">
        {(card.options || []).map((opt, i) => {
          const isAnswer = i === card.answer;
          const isPick = pick === i;
          let bg = T.surface, border = T.border, col = T.ink, dim = 1;
          if (revealed && isAnswer){ bg = rgba(T.green, 0.1); border = rgba(T.green, 0.5); col = T.ink; }
          else if (revealed && isPick){ bg = rgba(T.red, 0.1); border = rgba(T.red, 0.5); col = T.ink; }
          else if (revealed){ dim = 0.5; }
          return (
            <button key={i} className="sf-tap" disabled={revealed} onClick={() => onPick(i)}
              style={{ display: 'flex', gap: 12, alignItems: 'center', textAlign: 'left',
                background: bg, border: `1.5px solid ${border}`, borderRadius: R.well, padding: '13px 14px',
                cursor: revealed ? 'default' : 'pointer', color: col, opacity: dim,
                transition: 'border-color 160ms, background 160ms, opacity 200ms' }}>
              <span style={{ width: 24, height: 24, borderRadius: 12, background: T.well, flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: SANS, fontSize: 12, fontWeight: 700, color: T.muted }}>{letters[i]}</span>
              <span style={{ fontFamily: SANS, fontSize: 15.5, lineHeight: 1.45, flex: 1, fontWeight: 500 }}>{opt}</span>
              {revealed && isAnswer && <span style={{ color: T.green, fontSize: 16, fontWeight: 700 }}>✓</span>}
              {revealed && isPick && !isAnswer && <span style={{ color: T.red, fontSize: 16, fontWeight: 700 }}>✕</span>}
            </button>
          );
        })}
      </div>
      {revealed && card.why && (
        <div style={{ ...REVEAL }}>
          <div style={{ ...PANEL, ...ANSWER, fontSize: 14.5 }}>{card.why}</div>
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

  useEffect(() => { setAnswer(''); setResult(null); setErr(''); }, [card.id]);

  const doMark = async () => {
    if (!answer.trim()) return;
    setBusy(true); setErr(''); setResult(null);
    try {
      const r = await markAnswer(card, answer, deck.standard || 'NCEA Level 1');
      if (r){ setResult(r); onReveal && onReveal(); }   // show feedback and the ladder together
      else setErr('Could not read the marking. Try again.');
    } catch { setErr('No connection to the marker. Your answer is safe — try again when online.'); }
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
          <textarea value={answer} onChange={e => setAnswer(e.target.value)}
            placeholder={`Use the ${card.verb.toLowerCase()} command properly — ${card.marks} marks means ${card.marks >= 5 ? 'several linked points' : 'more than one point'}.`}
            rows={6}
            style={{ width: '100%', background: T.well, color: T.ink, border: `1px solid ${T.border}`,
              borderRadius: R.well, padding: 14, fontFamily: SANS, fontSize: 15, lineHeight: 1.55,
              resize: 'vertical', outline: 'none' }} />
          <div className="flex items-center justify-between" style={{ marginTop: 7, marginBottom: 11 }}>
            <Sub style={{ fontSize: 12 }}>{words > 0 ? `${words} words` : 'Even a rough attempt beats reading the answer'}</Sub>
          </div>
          <div className="flex gap-2">
            <Btn full kind="primary" onClick={doMark} disabled={busy || !answer.trim()}>
              {busy ? 'Marking…' : 'Mark my answer'}
            </Btn>
            <Btn kind="soft" onClick={() => onReveal && onReveal()} style={{ whiteSpace: 'nowrap' }}>Skip</Btn>
          </div>
          {err && <Sub style={{ marginTop: 10, color: T.red }}>{err}</Sub>}
        </div>
      )}

      {result && <MarkResult r={result} />}

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
        </div>
      )}
    </div>
  );
}

function MarkResult({ r }){
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

function Feed({ decks, progress, settings, stats, onGrade, reduceMotion }){
  const allItems = useMemo(() => {
    const out = [];
    for (const d of decks) for (const c of d.cards) out.push({ card: c, deck: d });
    return out;
  }, [decks]);

  // practice pool: shuffled, then blended to the same long/quick ratio
  const mixedPool = useCallback(() => {
    const s = shuffle(allItems);
    return blendByRatio(s.filter(it => isLongCard(it.card)), s.filter(it => !isLongCard(it.card)), longMixOf(settings));
  }, [allItems, settings]);

  const [queue, setQueue] = useState(() => buildQueue(decks, progress, settings, stats));
  const [reviewed, setReviewed] = useState(0);
  const [pool, setPool] = useState([]);
  const [pIdx, setPIdx] = useState(0);

  const scheduledLeft = queue.length;
  const inPractice = scheduledLeft === 0;

  useEffect(() => {
    if (inPractice && pool.length === 0 && allItems.length > 0){
      setPool(mixedPool());
      setPIdx(0);
    }
  }, [inPractice, pool.length, allItems]);

  const gradeScheduled = (q, sure) => {
    const head = queue[0];
    if (!head) return;
    const rest = queue.slice(1);
    const { reinsert } = onGrade(head.card, head.deck, q, sure, false);
    setReviewed(r => r + 1);
    if (reinsert){
      const nq = rest.slice();
      nq.splice(Math.min(rest.length, 5), 0, head);
      setQueue(nq);
    } else setQueue(rest);
  };

  const gradePractice = (q, sure) => {
    const it = pool[pIdx];
    if (!it) return;
    onGrade(it.card, it.deck, q, sure, true);
    setReviewed(r => r + 1);
    const next = pIdx + 1;
    if (next >= pool.length){ setPool(mixedPool()); setPIdx(0); }
    else setPIdx(next);
  };

  if (allItems.length === 0){
    return (
      <Card style={{ padding: '44px 24px', textAlign: 'center' }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>🗂️</div>
        <Title>No cards yet</Title>
        <Sub style={{ marginTop: 6 }}>Head to <b>Create</b> to make your first deck.</Sub>
      </Card>
    );
  }

  if (inPractice){
    const it = pool[pIdx];
    if (!it) return <div style={{ minHeight: 420 }} />;
    return (
      <div>
        <div className="flex items-center justify-between" style={{ marginBottom: 12, padding: '0 4px' }}>
          <Chip colour={T.green}>Extra practice</Chip>
          <Sub style={{ fontSize: 12.5 }}>{reviewed} done today</Sub>
        </div>
        <StudyCard key={it.card.id + ':' + pIdx} card={it.card} deck={it.deck} onGrade={gradePractice}
          reduceMotion={reduceMotion} prog={progress[it.card.id]} practice={true} />
      </div>
    );
  }

  const done = reviewed;
  const pct = (done + scheduledLeft) ? (done / (done + scheduledLeft)) * 100 : 0;
  return (
    <div>
      <div className="flex items-center gap-3" style={{ marginBottom: 12, padding: '0 4px' }}>
        <div style={{ flex: 1, height: 8, background: T.well, borderRadius: R.pill, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: T.green, borderRadius: R.pill,
            transition: reduceMotion ? 'none' : 'width 340ms cubic-bezier(.2,.8,.3,1)' }} />
        </div>
        <Sub style={{ fontSize: 12.5, fontWeight: 600 }}>{scheduledLeft} left</Sub>
      </div>
      <StudyCard key={queue[0].card.id} card={queue[0].card} deck={queue[0].deck} onGrade={gradeScheduled}
        reduceMotion={reduceMotion} prog={progress[queue[0].card.id]} practice={false} />
    </div>
  );
}

/* ==========================================================================
   CREATE
   ========================================================================== */
const INPUT = { width: '100%', background: T.well, color: T.ink, border: `1px solid ${T.border}`,
  borderRadius: R.well, padding: '13px 14px', fontFamily: SANS, lineHeight: 1.55, outline: 'none' };

function Create({ onSave, settings, onSettings, onPending }){
  const [mode, setMode] = useState('generate');
  const [cardType, setCardType] = useState('mix');
  const [source, setSource] = useState('');
  const [level, setLevel] = useState('NCEA Level 1');
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState(null);
  const [err, setErr] = useState('');
  const [drafts, setDrafts] = useState(null);
  const [meta, setMeta] = useState({ subject: '', topic: '', standard: 'NCEA Level 1' });
  const [attaching, setAttaching] = useState('');
  const [images, setImages] = useState([]);
  const fileRef = useRef(null);

  // let the nav badge the Create tab while cards are sitting unsaved
  useEffect(() => {
    if (onPending) onPending(drafts ? drafts.filter(d => d.keep).length : 0);
  }, [drafts, onPending]);

  const onFiles = async (e) => {
    const files = Array.from(e.target.files || []);
    if (e.target) e.target.value = '';
    if (!files.length) return;
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
    if (!source.trim() && !images.length){ setErr('Paste notes, type a topic, or attach a file or photo first.'); return; }

    setBusy(true); setErr(''); setProg(null);
    lastApiError = '';
    try {
      const model = pickModel(cardType, settings);
      let cards = [];
      const pctLong = longMixOf(settings);
      if (source.trim()) cards = cards.concat(await genText(source, cardType, lvl, (i, n, phase) => setProg({ i, n, phase }), model, pctLong));
      if (images.length){
        setProg({ i: 0, n: 0, phase: 'prep' });
        const shrunk = [];
        for (const b of images.slice(0, 12)){ try { shrunk.push(await resizeImage(b)); } catch {} }
        if (shrunk.length) cards = cards.concat(await genImages(shrunk, cardType, lvl, (i, n, phase) => setProg({ i, n, phase }), model, pctLong));
        else if (!cards.length){ setErr('Could not read those images. Try a clearer photo.'); setBusy(false); setProg(null); return; }
      }
      cards = dedupeCards(cards);
      if (!cards.length){
        setErr(lastApiError ? `Nothing came back — ${lastApiError}.`
                            : 'Nothing came back. Try clearer notes, a narrower topic, or a sharper photo.');
        setBusy(false); return;
      }
      setMeta({ subject: guessSubject(source), topic: guessTopic(source), standard: lvl });
      setDrafts(cards.map(c => ({ ...c, keep: true })));
    } catch { setErr('Generation failed. Check your connection and try again.'); }
    finally { setBusy(false); setProg(null); }
  };

  if (drafts){
    return <DraftReview drafts={drafts} setDrafts={setDrafts} meta={meta} setMeta={setMeta}
      onCancel={() => setDrafts(null)}
      onSave={() => { onSave(drafts.filter(d => d.keep), meta); setDrafts(null); setSource(''); setImages([]); }} />;
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
        <Card style={{ padding: 14, marginTop: 14, boxShadow: SH.raised }}>
          <input ref={fileRef} type="file" accept="image/*,.docx,.pptx,.txt" multiple onChange={onFiles} style={{ display: 'none' }} />
          <Btn full kind="soft" onClick={() => fileRef.current && fileRef.current.click()}>
            📎  Add photo, Word or PowerPoint
          </Btn>
          {attaching && <Sub style={{ marginTop: 10, textAlign: 'center' }}>{attaching}</Sub>}
          {!attaching && images.length > 0 && (
            <div className="flex items-center justify-between" style={{ marginTop: 10 }}>
              <Chip colour={T.green}>{images.length} image{images.length > 1 ? 's' : ''} added{images.length > 12 ? ' (first 12 used)' : ''}</Chip>
              <button className="sf-tap" onClick={() => setImages([])}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: SANS, fontSize: 13, fontWeight: 600, color: T.red }}>Clear</button>
            </div>
          )}
          {!attaching && images.length === 0 && (
            <Sub style={{ marginTop: 10, textAlign: 'center', fontSize: 12.5 }}>Any size — it only sends what's readable</Sub>
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
            <span style={{ position: 'absolute', right: 15, top: '50%', transform: 'translateY(-50%)',
              color: T.faint, fontSize: 11, pointerEvents: 'none' }}>▼</span>
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
      {busy && <Sub style={{ marginTop: 14, textAlign: 'center', fontWeight: 600 }}>{progText}</Sub>}

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
  if (d.type === 'mcq') return { tag: 'Multiple choice', main: d.front, sub: '✓ ' + (d.options[d.answer] || '') };
  if (d.type === 'short') return { tag: 'Short answer', main: d.front, sub: d.back };
  if (d.type === 'cloze') return { tag: 'Fill the blank', main: d.front, sub: d.back };
  return { tag: 'Flip', main: d.front, sub: d.back };
}

function DraftReview({ drafts, setDrafts, meta, setMeta, onSave, onCancel }){
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
        <Sub style={{ color: '#8A5A00', fontWeight: 600, fontSize: 13 }}>
          ⚠︎ Not saved yet — tap <b>Save</b> at the bottom or these are lost.
        </Sub>
      </div>
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

      <div className="flex flex-col gap-2" style={{ marginBottom: 16 }}>
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
function Decks({ decks, progress, onEditCard, onDeleteCard, onDeleteDeck }){
  const [openId, setOpenId] = useState(null);
  const open = decks.find(d => d.id === openId);

  if (open){
    return <DeckEditor deck={open} progress={progress} onBack={() => setOpenId(null)}
      onEditCard={onEditCard} onDeleteCard={onDeleteCard}
      onDeleteDeck={() => { onDeleteDeck(open.id); setOpenId(null); }} />;
  }

  if (!decks.length){
    return (
      <Card style={{ padding: '44px 24px', textAlign: 'center' }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>📚</div>
        <Title>No decks yet</Title>
        <Sub style={{ marginTop: 6 }}>Make some cards and they'll show up here.</Sub>
      </Card>
    );
  }

  return (
    <div>
      <Title style={{ marginBottom: 14 }}>Your decks</Title>
      <div className="flex flex-col gap-2">
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

function DeckEditor({ deck, progress, onBack, onEditCard, onDeleteCard, onDeleteDeck }){
  const [confirmDeck, setConfirmDeck] = useState(false);
  const [editId, setEditId] = useState(null);
  const colour = subjectColour(deck.subject);

  return (
    <div>
      <div className="flex items-center gap-3" style={{ marginBottom: 16 }}>
        <button className="sf-tap" onClick={onBack}
          style={{ width: 38, height: 38, borderRadius: R.pill, background: T.surface, border: `1px solid ${T.border}`,
            cursor: 'pointer', fontSize: 17, color: T.ink, boxShadow: SH.raised, flexShrink: 0 }}>‹</button>
        <div style={{ minWidth: 0 }}>
          <Title style={{ fontSize: 18, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{deck.topic || 'Deck'}</Title>
          <Sub style={{ fontSize: 13 }}>{deck.subject} · {deck.cards.length} cards</Sub>
        </div>
      </div>

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
      <div className="flex flex-col gap-3">
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
        background: on ? T.green : '#D5D9E4', position: 'relative', transition: 'background 200ms' }}>
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

function Settings({ settings, onChange }){
  const set = (patch) => onChange({ ...settings, ...patch });
  return (
    <div>
      <Title style={{ marginBottom: 14 }}>Settings</Title>

      <Card style={{ padding: 15, marginBottom: 10, boxShadow: SH.raised }}>
        <div style={{ fontFamily: SANS, fontSize: 15, fontWeight: 700, color: T.ink }}>Answer length</div>
        <Sub style={{ fontSize: 12.5, marginTop: 2, marginBottom: 14 }}>
          Sets the balance of new cards you make, and how your feed is mixed.
        </Sub>
        <MixSlider value={longMixOf(settings)} onChange={(v) => set({ longMix: v })} />
      </Card>

      <SettingRow title="Mix subjects up" note="Rotates subjects so you don't do one topic in a block">
        <Toggle on={settings.interleave} onClick={() => set({ interleave: !settings.interleave })} />
      </SettingRow>

      <SettingRow title="Save usage" note="Faster, cheaper model for everything. Long answers get weaker.">
        <Toggle on={settings.saveUsage} onClick={() => set({ saveUsage: !settings.saveUsage })} />
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
    </div>
  );
}

/* ==========================================================================
   APP
   ========================================================================== */
export default function App(){
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState('feed');
  const [library, setLibrary] = useState({ decks: [] });
  const [progress, setProgress] = useState({});
  const [stats, setStats] = useState(DEFAULT_STATS);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [pendingCount, setPendingCount] = useState(0);   // unsaved drafts waiting on Create
  const reduceMotion = useRef(false);

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
      setSettings({ ...DEFAULT_SETTINGS, ...se });
      try { reduceMotion.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch {}
      setReady(true);
    })();
  }, []);

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

  const editCard = (deckId, cardId, patch) => {
    persistLibrary({ decks: library.decks.map(d => d.id !== deckId ? d
      : { ...d, cards: d.cards.map(c => c.id === cardId ? { ...c, ...patch } : c) }) });
  };
  const deleteCard = (deckId, cardId) => {
    persistLibrary({ decks: library.decks.map(d => d.id !== deckId ? d : { ...d, cards: d.cards.filter(c => c.id !== cardId) }) });
  };
  const deleteDeck = (deckId) => persistLibrary({ decks: library.decks.filter(d => d.id !== deckId) });

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
    <Shell>
      <Masthead due={dueCount} streak={stats.streak || 0} />
      <div style={{ minHeight: 440 }}>
        {/* key includes the mix so moving the slider rebuilds the queue at the new ratio */}
        {tab === 'feed' && <Feed key={'feed-' + cardCount + '-' + longMixOf(settings)} decks={library.decks} progress={progress} settings={settings}
          stats={stats} onGrade={gradeCard} reduceMotion={reduceMotion.current} />}
        {/* Create stays MOUNTED and is hidden instead — unmounting it threw away
            unsaved drafts, pasted notes and attached photos the moment you
            switched tabs, and those drafts cost real API usage to produce. */}
        <div style={{ display: tab === 'create' ? 'block' : 'none' }}>
          <Create onSave={saveDeck} settings={settings} onSettings={persistSettings} onPending={setPendingCount} />
        </div>
        {tab === 'decks' && <Decks decks={library.decks} progress={progress} onEditCard={editCard} onDeleteCard={deleteCard} onDeleteDeck={deleteDeck} />}
        {tab === 'stats' && <Stats decks={library.decks} progress={progress} stats={stats} />}
        {tab === 'settings' && <Settings settings={settings} onChange={persistSettings} />}
      </div>
      <Nav tab={tab} setTab={setTab} due={dueCount} pending={pendingCount} />
    </Shell>
  );
}

function Shell({ children }){
  return (
    <div style={{ background: T.bg, minHeight: '100vh', color: T.ink, display: 'flex', justifyContent: 'center' }}>
      <style>{`
        @keyframes sf-in { from { opacity: 0; transform: translateY(12px) scale(0.985); } to { opacity: 1; transform: none; } }
        @keyframes sf-reveal { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }
        @keyframes sf-rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }

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

        @media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
      `}</style>
      <div style={{ width: '100%', maxWidth: 460, padding: '10px 16px 104px', position: 'relative' }}>
        {children}
      </div>
    </div>
  );
}

function Masthead({ due, streak }){
  return (
    <div className="flex items-center justify-between" style={{ padding: '10px 2px 18px' }}>
      <div style={{ fontFamily: SANS, fontSize: 24, fontWeight: 800, color: T.ink, letterSpacing: '-0.03em' }}>
        Study Feed
      </div>
      <div className="flex items-center gap-2">
        {streak > 0 && <Chip colour={T.amber}>🔥 {streak}</Chip>}
        {due > 0 && <Chip colour={T.red} solid>{due} due</Chip>}
      </div>
    </div>
  );
}

function Nav({ tab, setTab, due, pending }){
  const items = [['feed','Study'],['create','Create'],['decks','Decks'],['stats','Stats'],['settings','You']];
  return (
    <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
      <div style={{ width: '100%', maxWidth: 460, pointerEvents: 'auto',
        background: rgba('#FFFFFF', 0.92), backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
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
