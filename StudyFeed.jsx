import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';

/* ============================================================================
   STUDY FEED  —  single-file build
   - Phase 2 extended-response cards (verb, A/M/E ladder, skeleton, pitfall,
     mark-my-answer) plus a MIX of lighter types: flip, cloze, short answer,
     multiple choice.
   - Feed still ends deliberately; an opt-in "keep practising" mode goes endless.

   Constraints honoured:
   - single file, default export, no required props
   - no localStorage/sessionStorage. window.storage.* wrapped in try/catch;
     a missing key throws, so every read falls back.
   - four storage keys (library:main, progress:all, stats:main, settings:main)
   - Tailwind core utilities for layout only; colour from the token object
   - generation via the messages API (claude-sonnet-4-6). Ships empty.
   ========================================================================== */

/* ---- design tokens : "exam paper, at night" ------------------------------ */
const T = {
  ink:   '#0C1116',
  paper: '#141C23',
  raised:'#1A242C',
  rule:  '#22303A',
  bone:  '#E8E4DA',
  muted: '#8A97A2',
  faint: '#5B6873',
  red:   '#D9503F',
};
const SERIF = 'Georgia, "Iowan Old Style", "Times New Roman", serif';
const MONO  = '"SF Mono", "Roboto Mono", ui-monospace, Menlo, Consolas, monospace';
const SANS  = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

const HUES = ['#5B8BB0','#B0895B','#7FA06A','#A96FA0','#6FA0A0','#B06F6F','#8A7FB0','#A0A05B'];
function subjectColour(name){
  const s = (name || '').trim().toLowerCase();
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return HUES[h % HUES.length];
}

const TYPE_LABEL = { flip: 'Flip', cloze: 'Cloze', short: 'Short answer', mcq: 'Multiple choice', extended: 'Extended' };

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

/* ---- storage : the runtime returns { value } and takes a string ---------- */
async function load(key, fallback){
  try {
    const r = await window.storage.get(key);
    if (r === undefined || r === null) return fallback;
    const val = (r && typeof r === 'object' && 'value' in r) ? r.value : r;
    if (val === undefined || val === null) return fallback;
    return typeof val === 'string' ? JSON.parse(val) : val;
  } catch { return fallback; }
}
async function save(key, value){
  try { await window.storage.set(key, JSON.stringify(value)); return true; }
  catch (e){ console.error('storage.set failed', key, e); return false; }
}

/* capNew off by default: the feed is continuous, so nothing needs throttling */
const DEFAULT_SETTINGS = { interleave: true, newPerDay: 12, capNew: false, saveUsage: false };
const DEFAULT_STATS = { streak: 0, lastDay: '', newByDate: {}, reviewsByDate: {}, bySubject: {} };

/* ---- SM-2 scheduler ------------------------------------------------------ */
function freshProgress(){
  return { ease: 2.5, interval: 0, reps: 0, lapses: 0, due: TODAY(), flagged: false, seen: false };
}
const Q = { AGAIN: 0, HARD: 3, GOOD: 4, EASY: 5 };

function schedule(prevRaw, q, confidentSure){
  const p = { ...freshProgress(), ...prevRaw };
  p.seen = true;
  let reinsert = false;

  if (q === Q.AGAIN){
    p.reps = 0;
    p.ease = Math.max(1.3, p.ease - 0.2);
    p.lapses += 1;
    p.due = TODAY();
    reinsert = true;
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

    if (confidentSure && q < Q.GOOD) p.flagged = true;
    if (q >= Q.GOOD) p.flagged = false;
    if (p.flagged) ivl = ivl / 2;

    p.interval = Math.max(1, ivl);
    p.due = addDays(TODAY(), p.interval);
  }
  return { next: p, reinsert };
}

function stateLabel(p){
  if (!p || !p.seen) return 'UNSEEN';
  if (p.flagged) return 'MISCONCEPTION';
  if (p.due <= TODAY()) return 'DUE';
  const days = Math.max(1, Math.round((new Date(p.due) - new Date(TODAY())) / 86400000));
  const lap = p.lapses ? ` · ${p.lapses} LAPSE${p.lapses > 1 ? 'S' : ''}` : '';
  return `IN ${days}D${lap}`;
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

/* turn model JSON into normalised typed cards */
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

/* bigger batches = fewer API calls = less of your usage burned per generate */
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

function mixedPrompt(source, level){
  return `You are an expert ${level} tutor. From the material below, make a MIXED set of study cards. Choose the best type for each idea — do NOT make everything the same type.

Return ONLY a JSON array. Each card is one of:
{ "type":"flip", "front": question, "back": answer }                       // definitions, facts, formulae, vocab
{ "type":"cloze", "front": a sentence with one key term replaced by "____", "back": the missing term }
{ "type":"short", "front": question, "back": a model answer in 1-3 sentences }
{ "type":"mcq", "front": question, "options": [four options], "answer": index (0-based) of the correct option, "why": one line on why it is right and what the tempting wrong option gets wrong }
{ "type":"extended", "verb": one of ${COMMAND_VERBS.map(v => '"' + v + '"').join(', ')}, "prompt": full exam question, "marks": int, "achieved": the WHAT, "merit": the WHY/HOW with cause and effect, "excellence": links >=2 ideas + applies to the scenario + evaluates/justifies, "skeleton": the mark-earning sentence pattern, "pitfall": the specific error to avoid here }

ORDER MATTERS. Emit the array in this order:
  1. the "extended" cards FIRST,
  2. then the "mcq" cards,
  3. then the quick ones (flip/cloze/short).
Your reply may be cut off at the end, so the long cards must come first or they are lost.

REQUIRED COUNTS per reply: at least 2 "extended" cards (3 if the material supports it), then 2-3 "mcq" whose wrong options are REAL misconceptions a student actually holds (never filler), then 5-8 quick cards. Never return zero extended cards.

Ground everything in the material. Do NOT invent NZQA codes. No JSON outside the array.

MATERIAL:
${source}`;
}

/* Two tiers. Haiku is ~3x cheaper per token and plenty for short recall cards;
   Sonnet does the work where quality actually shows — extended-response
   ladders and marking a written answer. Routing is per WHOLE call: splitting
   one batch across both models sends the same notes twice, and the duplicated
   input cancels most of the saving. */
const MODEL_SMART = 'claude-sonnet-4-6';
const MODEL_CHEAP = 'claude-haiku-4-5';

function pickModel(mode, settings){
  if (settings && settings.saveUsage) return MODEL_CHEAP;   // user opted for cheap everywhere
  return mode === 'flip' ? MODEL_CHEAP : MODEL_SMART;       // flip-only is all short cards
}

async function callModel(prompt, maxTokens = 1000, model = MODEL_SMART){
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!res.ok) throw new Error('api ' + res.status);
  const data = await res.json();
  return (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
}
async function callModelMulti(prompt, images, maxTokens = 1000, model = MODEL_SMART){
  const content = images.map(im => ({ type: 'image', source: { type: 'base64', media_type: im.media_type, data: im.data } }));
  content.push({ type: 'text', text: prompt });
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: 'user', content }] }),
  });
  if (!res.ok) throw new Error('api ' + res.status);
  const data = await res.json();
  return (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
}

/* pick the prompt + parse for a generation mode */
function promptFor(mode, source, level){
  if (mode === 'flip') return flipPrompt(source, level);
  if (mode === 'extended') return extendedPrompt(source, level);
  return mixedPrompt(source, level);
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

async function genText(source, mode, level, onProgress, model){
  const batches = batchText(source);
  let cards = [];
  for (let i = 0; i < batches.length; i++){
    onProgress && onProgress(i + 1, batches.length, 'text');
    let reply = '';
    try { reply = await callModel(promptFor(mode, batches[i], level), 2000, model); } catch { continue; }
    cards = cards.concat(parseReply(mode, reply));
  }
  return cards;
}
async function genImages(images, mode, level, onProgress, model){
  const groups = [];
  for (let i = 0; i < images.length; i += 6) groups.push(images.slice(i, i + 6));
  const note = 'Base the cards ONLY on the attached image(s). Read all text, labels, diagrams, formulae and handwriting in them.';
  let cards = [];
  for (let g = 0; g < groups.length; g++){
    onProgress && onProgress(g + 1, groups.length, 'images');
    let reply = '';
    try { reply = await callModelMulti(promptFor(mode, note, level), groups[g], 2000, model); } catch { continue; }
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
  // always the smarter model — grading against A/M/E is the bit worth paying for
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
   FILE EXTRACTION  —  photos, .docx / .pptx / .txt, read in the browser
   ========================================================================== */
const MIN_EMBEDDED_IMAGE_BYTES = 15000;   // below this it's a logo/bullet/icon
const MAX_EMBEDDED_IMAGES = 6;

let _jszip = null;
const isZipLib = (m) => !!m && typeof m.loadAsync === 'function';
async function loadJSZip(){
  if (_jszip) return _jszip;
  try {
    const m = await import('jszip');
    const cand = (m && m.default) ? m.default : m;
    if (isZipLib(cand)){ _jszip = cand; return _jszip; }   // don't cache a dud
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
  // Only real content images: skip logos/bullets/icons, and cap the count.
  // Every image sent costs usage, and a deck's decorative art teaches nothing.
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
    if (!text && !images.length) throw new Error('This .docx had no readable text or images.');
    return { text, images };
  }
  if (name.endsWith('.pptx')){
    const slides = Object.keys(zip.files)
      .filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
      .sort((a, b) => parseInt(a.match(/(\d+)/)[1]) - parseInt(b.match(/(\d+)/)[1]));
    const parts = [];
    for (const n of slides) parts.push(stripXml(await zip.file(n).async('string')).trim());
    const text = parts.filter(Boolean).join('\n\n');
    if (!text && !images.length) throw new Error('This .pptx had no readable content.');
    return { text, images };
  }
  throw new Error('Use a photo, .docx, .pptx or .txt file.');
}

/* ==========================================================================
   UI PRIMITIVES
   ========================================================================== */
function Label({ children, style }){
  return <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '0.12em',
    textTransform: 'uppercase', color: T.muted, ...style }}>{children}</span>;
}

function Btn({ children, onClick, kind = 'default', disabled, full, style }){
  const base = {
    fontFamily: MONO, fontSize: 13, letterSpacing: '0.08em', textTransform: 'uppercase',
    padding: '14px 18px', borderRadius: 12, border: `1px solid ${T.rule}`,
    background: T.raised, color: T.bone, cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.4 : 1, width: full ? '100%' : 'auto', textAlign: 'center',
  };
  const kinds = {
    default: {},
    primary: { background: T.bone, color: T.ink, borderColor: T.bone },
    danger:  { background: 'transparent', color: T.red, borderColor: T.red },
    ghost:   { background: 'transparent', borderColor: T.rule },
    again:   { background: 'transparent', color: T.red, borderColor: T.red },
  };
  return <button className="sf-btn" onClick={disabled ? undefined : onClick} disabled={disabled}
    style={{ ...base, ...kinds[kind], ...style }}>{children}</button>;
}

function Segmented({ value, onChange, options }){
  return (
    <div style={{ display: 'flex', gap: 4, background: T.ink, borderRadius: 12, padding: 4, border: `1px solid ${T.rule}` }}>
      {options.map(o => {
        const active = value === o.v;
        return (
          <button key={o.v} className="sf-tap" onClick={() => onChange(o.v)}
            style={{ flex: 1, padding: '10px 6px', borderRadius: 9, border: 'none', cursor: 'pointer',
              background: active ? T.bone : 'transparent', color: active ? T.ink : T.muted,
              fontFamily: MONO, fontSize: 12, letterSpacing: '0.05em', textTransform: 'uppercase',
              transition: 'background 150ms, color 150ms' }}>{o.label}</button>
        );
      })}
    </div>
  );
}

function Margin({ colour }){
  return <div style={{ position: 'absolute', left: 22, top: 18, bottom: 18, width: 2,
    background: colour || T.rule, borderRadius: 2, opacity: 0.9 }} />;
}

/* ==========================================================================
   STUDY CARD  —  active recall + confidence + grade
   ========================================================================== */
function StudyCard({ card, deck, onGrade, reduceMotion }){
  const [phase, setPhase] = useState('attempt');   // attempt | reveal
  const [sure, setSure] = useState(null);
  const [pick, setPick] = useState(null);
  const colour = subjectColour(deck.subject);
  const isMcq = card.type === 'mcq';

  useEffect(() => { setPhase('attempt'); setSure(null); setPick(null); }, [card.id]);

  const grade = (q) => onGrade(q, isMcq ? (pick === card.answer) : (sure === true));
  const anim = reduceMotion ? {} : { animation: 'sf-in 200ms ease-out' };

  return (
    <div className="sf-card" style={{ position: 'relative', background: T.paper, borderRadius: 18,
      border: `1px solid ${T.rule}`, padding: '24px 20px 20px 42px', minHeight: 400,
      display: 'flex', flexDirection: 'column', ...anim }}>
      <Margin colour={colour} />

      <div className="flex items-center justify-between" style={{ marginBottom: 18 }}>
        <div className="flex flex-col">
          <Label style={{ color: colour }}>{deck.subject || 'Untitled'}</Label>
          <Label style={{ color: T.faint, marginTop: 2 }}>{deck.topic || ''}</Label>
        </div>
        <Label style={{ color: T.faint }}>{TYPE_LABEL[card.type] || 'Card'}</Label>
      </div>

      {card.type === 'extended' ? <ExtendedFace card={card} phase={phase} deck={deck} />
        : isMcq ? <McqFace card={card} phase={phase} pick={pick} onPick={(i) => { setPick(i); setPhase('reveal'); }} />
        : card.type === 'short' ? <ShortFace card={card} phase={phase} />
        : <FlipFace card={card} phase={phase} />}

      <div style={{ flex: 1 }} />

      <div style={{ marginTop: 18 }}>
        {isMcq ? (
          phase === 'reveal'
            ? <GradeRow grade={grade} />
            : <Label style={{ display: 'block', textAlign: 'center', color: T.faint }}>Tap the answer you think is right</Label>
        ) : phase === 'attempt' && sure === null ? (
          <div>
            <Label style={{ display: 'block', textAlign: 'center', marginBottom: 10, color: T.faint }}>
              Answer it in your head first
            </Label>
            <div className="flex gap-3">
              <Btn full onClick={() => setSure(true)}>Sure</Btn>
              <Btn full kind="ghost" onClick={() => setSure(false)}>Unsure</Btn>
            </div>
          </div>
        ) : phase === 'attempt' ? (
          <Btn full kind="primary" onClick={() => setPhase('reveal')}>
            {card.type === 'extended' ? 'Reveal model answers' : 'Reveal answer'}
          </Btn>
        ) : (
          <GradeRow grade={grade} />
        )}
      </div>
    </div>
  );
}

function GradeRow({ grade }){
  return (
    <div>
      <Label style={{ display: 'block', textAlign: 'center', marginBottom: 10, color: T.faint }}>How did that go?</Label>
      <div className="grid grid-cols-4 gap-2">
        <Btn kind="again" onClick={() => grade(Q.AGAIN)}>Again</Btn>
        <Btn onClick={() => grade(Q.HARD)}>Hard</Btn>
        <Btn onClick={() => grade(Q.GOOD)}>Good</Btn>
        <Btn onClick={() => grade(Q.EASY)}>Easy</Btn>
      </div>
    </div>
  );
}

function FlipFace({ card, phase }){
  return (
    <div>
      <div style={{ fontFamily: SERIF, fontSize: 22, lineHeight: 1.4, color: T.bone }}>{card.front}</div>
      {phase === 'reveal' && (
        <div style={{ marginTop: 18, paddingTop: 16, borderTop: `1px solid ${T.rule}`,
          fontFamily: SANS, fontSize: 17, lineHeight: 1.5, color: T.bone, animation: 'sf-in 200ms ease-out' }}>
          {card.back}
        </div>
      )}
    </div>
  );
}

function ShortFace({ card, phase }){
  return (
    <div>
      <div style={{ fontFamily: SERIF, fontSize: 21, lineHeight: 1.4, color: T.bone }}>{card.front}</div>
      {phase === 'reveal' && (
        <div style={{ marginTop: 18, paddingTop: 16, borderTop: `1px solid ${T.rule}`, animation: 'sf-in 200ms ease-out' }}>
          <Label style={{ color: T.faint }}>Model answer</Label>
          <div style={{ fontFamily: SANS, fontSize: 16, lineHeight: 1.55, color: T.bone, marginTop: 6 }}>{card.back}</div>
        </div>
      )}
    </div>
  );
}

function McqFace({ card, phase, pick, onPick }){
  const letters = ['A','B','C','D','E','F'];
  return (
    <div>
      <div style={{ fontFamily: SERIF, fontSize: 21, lineHeight: 1.4, color: T.bone, marginBottom: 14 }}>{card.front}</div>
      <div className="flex flex-col gap-2">
        {card.options.map((opt, i) => {
          const revealed = phase === 'reveal';
          const isAnswer = i === card.answer;
          const isPick = pick === i;
          let border = T.rule, col = T.bone, bg = T.raised, weight = 400;
          if (revealed && isAnswer){ border = T.bone; weight = 600; }
          if (revealed && isPick && !isAnswer){ border = T.red; col = T.red; }
          return (
            <button key={i} className="sf-tap" disabled={revealed} onClick={() => onPick(i)}
              style={{ display: 'flex', gap: 10, alignItems: 'flex-start', textAlign: 'left',
                background: bg, border: `1px solid ${border}`, borderRadius: 12, padding: '12px 14px',
                cursor: revealed ? 'default' : 'pointer', color: col, transition: 'border-color 150ms' }}>
              <span style={{ fontFamily: MONO, fontSize: 12, color: T.faint, marginTop: 2 }}>{letters[i]}</span>
              <span style={{ fontFamily: SANS, fontSize: 15, lineHeight: 1.4, flex: 1, fontWeight: weight }}>{opt}</span>
              {revealed && isAnswer && <span style={{ color: T.bone }}>✓</span>}
              {revealed && isPick && !isAnswer && <span style={{ color: T.red }}>✕</span>}
            </button>
          );
        })}
      </div>
      {phase === 'reveal' && card.why && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${T.rule}`,
          fontFamily: SANS, fontSize: 14, lineHeight: 1.5, color: T.bone, animation: 'sf-in 200ms ease-out' }}>
          {card.why}
        </div>
      )}
    </div>
  );
}

function Rung({ tier, text }){
  return (
    <div style={{ marginBottom: 14 }}>
      <Label style={{ color: tier === 'Excellence' ? T.bone : T.faint }}>{tier}</Label>
      <div style={{ fontFamily: SANS, fontSize: 15, lineHeight: 1.5, color: T.bone, marginTop: 4 }}>
        {text || <span style={{ color: T.faint }}>—</span>}
      </div>
    </div>
  );
}

function ExtendedFace({ card, phase, deck }){
  const [marking, setMarking] = useState(false);
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');

  const doMark = async () => {
    if (!answer.trim()) return;
    setBusy(true); setErr(''); setResult(null);
    try {
      const r = await markAnswer(card, answer, deck.standard || 'NCEA Level 1');
      if (r) setResult(r);
      else setErr('Could not read the marking. Try again.');
    } catch { setErr('No connection to the marker. Your answer is safe — try again when online.'); }
    finally { setBusy(false); }
  };

  return (
    <div>
      <div className="flex items-center gap-2" style={{ marginBottom: 10, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: MONO, fontSize: 12, letterSpacing: '0.1em', textTransform: 'uppercase',
          color: T.ink, background: T.bone, padding: '3px 8px', borderRadius: 6 }}>{card.verb}</span>
        <Label style={{ color: T.faint }}>{card.marks} marks</Label>
        {card.flagged && <Label style={{ color: T.red }}>· Misconception</Label>}
      </div>

      <div style={{ fontFamily: SERIF, fontSize: 20, lineHeight: 1.45, color: T.bone }}>{card.prompt}</div>

      {phase === 'attempt' && (
        <div style={{ marginTop: 16 }}>
          {!marking && (
            <button className="sf-tap" onClick={() => setMarking(true)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
              <Label style={{ color: T.muted, textDecoration: 'underline' }}>Mark my written answer</Label>
            </button>
          )}
          {marking && (
            <div>
              <textarea value={answer} onChange={e => setAnswer(e.target.value)} placeholder="Write your full answer…" rows={5}
                style={{ width: '100%', background: T.ink, color: T.bone, border: `1px solid ${T.rule}`, borderRadius: 12,
                  padding: 12, fontFamily: SANS, fontSize: 15, lineHeight: 1.5, resize: 'vertical', outline: 'none' }} />
              <div className="flex gap-2" style={{ marginTop: 8 }}>
                <Btn onClick={doMark} disabled={busy || !answer.trim()}>{busy ? 'Marking…' : 'Mark it'}</Btn>
                <Btn kind="ghost" onClick={() => { setMarking(false); setResult(null); setErr(''); }}>Close</Btn>
              </div>
              {err && <div style={{ marginTop: 10, fontFamily: MONO, fontSize: 12, color: T.red }}>{err}</div>}
              {result && <MarkResult r={result} />}
            </div>
          )}
        </div>
      )}

      {phase === 'reveal' && (
        <div style={{ marginTop: 18, paddingTop: 16, borderTop: `1px solid ${T.rule}`, animation: 'sf-in 200ms ease-out' }}>
          <Rung tier="Achieved" text={card.achieved} />
          <Rung tier="Merit" text={card.merit} />
          <Rung tier="Excellence" text={card.excellence} />
          {card.skeleton && (
            <div style={{ marginTop: 12, padding: '10px 12px', background: T.ink, borderRadius: 10, border: `1px solid ${T.rule}` }}>
              <Label style={{ color: T.faint }}>Structure that earns it</Label>
              <div style={{ fontFamily: MONO, fontSize: 13, color: T.bone, marginTop: 4 }}>{card.skeleton}</div>
            </div>
          )}
          {card.pitfall && (
            <div style={{ marginTop: 10 }}>
              <Label style={{ color: T.red }}>What loses marks here</Label>
              <div style={{ fontFamily: SANS, fontSize: 14, color: T.bone, marginTop: 4, lineHeight: 1.5 }}>{card.pitfall}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MarkResult({ r }){
  const gc = r.grade === 'Excellence' || r.grade === 'Merit' ? T.bone : r.grade === 'Achieved' ? T.muted : T.red;
  return (
    <div style={{ marginTop: 12, padding: '12px 14px', background: T.ink, borderRadius: 12, border: `1px solid ${T.rule}`, animation: 'sf-in 200ms ease-out' }}>
      <Label style={{ color: gc }}>Marked: {r.grade}</Label>
      {Array.isArray(r.hit) && r.hit.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <Label style={{ color: T.faint }}>Credit for</Label>
          <ul style={{ margin: '4px 0 0', paddingLeft: 16, fontFamily: SANS, fontSize: 14, color: T.bone, lineHeight: 1.5 }}>
            {r.hit.map((h, i) => <li key={i}>{h}</li>)}
          </ul>
        </div>
      )}
      {Array.isArray(r.missing) && r.missing.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <Label style={{ color: T.faint }}>To reach the next grade</Label>
          <ul style={{ margin: '4px 0 0', paddingLeft: 16, fontFamily: SANS, fontSize: 14, color: T.bone, lineHeight: 1.5 }}>
            {r.missing.map((m, i) => <li key={i}>{m}</li>)}
          </ul>
        </div>
      )}
      {r.lift && <div style={{ marginTop: 8, fontFamily: SERIF, fontSize: 15, color: T.bone, lineHeight: 1.5 }}>{r.lift}</div>}
    </div>
  );
}

/* ==========================================================================
   FEED  —  scheduled cards first, then rolls straight on. Never stops.
   ========================================================================== */
function newBudgetFor(settings, stats){
  if (!settings.capNew) return Infinity;
  const used = (stats.newByDate && stats.newByDate[TODAY()]) || 0;
  return Math.max(0, ((settings.newPerDay == null ? 12 : settings.newPerDay)) - used);
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
  const budget = newBudgetFor(settings, stats);
  let items = due.concat(budget === Infinity ? fresh : fresh.slice(0, budget));

  if (settings.interleave && items.length > 1){
    const bySub = {};
    for (const it of items){
      const k = it.deck.subject || '';
      if (!bySub[k]) bySub[k] = [];
      bySub[k].push(it);
    }
    const lanes = Object.values(bySub);
    if (lanes.length > 1){
      const out = [];
      const cap = items.length * lanes.length + lanes.length;   // explicit bound; no n % 0
      let n = 0;
      while (out.length < items.length && n < cap){
        const lane = lanes[n % lanes.length];
        if (lane.length) out.push(lane.shift());
        n++;
      }
      if (out.length === items.length) items = out;
    }
  }
  return items;
}

function Feed({ decks, progress, settings, stats, onGrade, reduceMotion }){
  const allItems = useMemo(() => {
    const out = [];
    for (const d of decks) for (const c of d.cards) out.push({ card: c, deck: d });
    return out;
  }, [decks]);

  const [queue, setQueue] = useState(() => buildQueue(decks, progress, settings, stats));
  const [reviewed, setReviewed] = useState(0);
  const [pool, setPool] = useState([]);     // shuffled practice pool, refilled forever
  const [pIdx, setPIdx] = useState(0);

  const scheduledLeft = queue.length;
  const inPractice = scheduledLeft === 0;

  // once the scheduled cards run out, roll straight on — no wall, no prompt
  useEffect(() => {
    if (inPractice && pool.length === 0 && allItems.length > 0){
      setPool(shuffle(allItems));
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
      nq.splice(Math.min(rest.length, 5), 0, head);   // ~5 later, same session
      setQueue(nq);
    } else setQueue(rest);
  };

  // extra practice does NOT write the scheduler — it must not push real intervals out
  const gradePractice = (q, sure) => {
    const it = pool[pIdx];
    if (!it) return;
    onGrade(it.card, it.deck, q, sure, true);
    setReviewed(r => r + 1);
    const next = pIdx + 1;                 // computed before any setter runs
    if (next >= pool.length){ setPool(shuffle(allItems)); setPIdx(0); }
    else setPIdx(next);
  };

  if (allItems.length === 0){
    return (
      <div className="flex flex-col items-center justify-center" style={{ minHeight: 420, textAlign: 'center', padding: 24 }}>
        <div style={{ fontFamily: SERIF, fontSize: 20, color: T.bone }}>No cards yet.</div>
        <Label style={{ color: T.faint, display: 'block', marginTop: 8 }}>Make some on the New tab.</Label>
      </div>
    );
  }

  if (inPractice){
    const it = pool[pIdx];
    if (!it) return <div style={{ minHeight: 420 }} />;
    return (
      <div>
        <div className="flex items-center justify-between" style={{ marginBottom: 14 }}>
          <Label style={{ color: T.faint }}>Extra practice · not scheduled</Label>
          {reviewed > 0 && <Label style={{ color: T.faint }}>{reviewed} today</Label>}
        </div>
        <StudyCard key={it.card.id + ':' + pIdx} card={it.card} deck={it.deck} onGrade={gradePractice} reduceMotion={reduceMotion} />
      </div>
    );
  }

  const done = reviewed;
  return (
    <div>
      <div style={{ height: 3, background: T.rule, borderRadius: 3, marginBottom: 14, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${done + scheduledLeft ? (done / (done + scheduledLeft)) * 100 : 0}%`,
          background: T.bone, transition: reduceMotion ? 'none' : 'width 250ms ease' }} />
      </div>
      <StudyCard key={queue[0].card.id} card={queue[0].card} deck={queue[0].deck} onGrade={gradeScheduled} reduceMotion={reduceMotion} />
    </div>
  );
}

/* ==========================================================================
   CREATE
   ========================================================================== */
function Create({ onSave, settings }){
  const [mode, setMode] = useState('generate');   // generate | manual
  const [cardType, setCardType] = useState('mix'); // mix | extended | flip
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
    if (mode === 'manual'){
      const cards = parseManual(source);
      if (!cards.length){ setErr('Use “question | answer”, one per line.'); return; }
      setMeta({ subject: guessSubject(source), topic: guessTopic(source), standard: level });
      setDrafts(cards.map(c => ({ ...c, keep: true })));
      return;
    }
    if (!source.trim() && !images.length){ setErr('Paste notes, type a topic, or attach a file or photo first.'); return; }

    setBusy(true); setErr(''); setProg(null);
    try {
      const model = pickModel(cardType, settings);
      let cards = [];
      if (source.trim()) cards = cards.concat(await genText(source, cardType, level, (i, n, phase) => setProg({ i, n, phase }), model));
      if (images.length){
        setProg({ i: 0, n: 0, phase: 'prep' });
        const shrunk = [];
        for (const b of images.slice(0, 12)){ try { shrunk.push(await resizeImage(b)); } catch {} }
        if (shrunk.length) cards = cards.concat(await genImages(shrunk, cardType, level, (i, n, phase) => setProg({ i, n, phase }), model));
        else if (!cards.length){ setErr('Could not read those images. Try a clearer photo.'); setBusy(false); setProg(null); return; }
      }
      cards = dedupeCards(cards);
      if (!cards.length){ setErr('Nothing came back. Try clearer notes, a narrower topic, or a sharper photo.'); setBusy(false); return; }
      setMeta({ subject: guessSubject(source), topic: guessTopic(source), standard: level });
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
    : prog.n > 0 ? `${prog.phase === 'images' ? 'Reading images' : 'Reading notes'} · batch ${prog.i} of ${prog.n}`
    : 'Working…';

  return (
    <div style={{ padding: '4px 2px' }}>
      <Label style={{ color: T.faint }}>New cards</Label>

      <div style={{ margin: '12px 0' }}>
        <Segmented value={mode} onChange={setMode} options={[{ v: 'generate', label: 'Generate' }, { v: 'manual', label: 'Manual' }]} />
      </div>

      {mode === 'generate' && (
        <div style={{ marginBottom: 12 }}>
          <Segmented value={cardType} onChange={setCardType}
            options={[{ v: 'mix', label: 'Mixed' }, { v: 'extended', label: 'Extended' }, { v: 'flip', label: 'Flip' }]} />
        </div>
      )}

      {mode === 'generate' && (
        <div style={{ marginBottom: 12 }}>
          <input ref={fileRef} type="file" accept="image/*,.docx,.pptx,.txt" multiple onChange={onFiles} style={{ display: 'none' }} />
          <Btn full kind="ghost" onClick={() => fileRef.current && fileRef.current.click()}>Attach photo / Word / PowerPoint</Btn>
          {attaching && <Label style={{ color: T.muted, display: 'block', marginTop: 8 }}>{attaching}</Label>}
          {!attaching && images.length > 0 && (
            <div className="flex items-center justify-between" style={{ marginTop: 8 }}>
              <Label style={{ color: T.muted }}>{images.length} image{images.length > 1 ? 's' : ''} attached{images.length > 12 ? ' (first 12 used)' : ''}</Label>
              <button className="sf-tap" onClick={() => setImages([])} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                <Label style={{ color: T.red }}>Clear</Label>
              </button>
            </div>
          )}
          {!attaching && images.length === 0 && (
            <Label style={{ color: T.faint, display: 'block', marginTop: 8 }}>Photos, or the text and pictures inside a file — any size.</Label>
          )}
        </div>
      )}

      <textarea value={source} onChange={e => setSource(e.target.value)}
        placeholder={mode === 'manual' ? 'question | answer\nquestion | answer' : 'Paste your notes, or type a topic like “rates of reaction”…'}
        rows={8}
        style={{ width: '100%', background: T.paper, color: T.bone, border: `1px solid ${T.rule}`, borderRadius: 12,
          padding: 14, fontFamily: mode === 'manual' ? MONO : SANS, fontSize: 15, lineHeight: 1.5, resize: 'vertical', outline: 'none' }} />

      {mode === 'generate' && (
        <div style={{ marginTop: 10 }}>
          <Label style={{ color: T.faint }}>Level</Label>
          <input value={level} onChange={e => setLevel(e.target.value)}
            style={{ width: '100%', marginTop: 4, background: T.paper, color: T.bone, border: `1px solid ${T.rule}`,
              borderRadius: 10, padding: '10px 12px', fontFamily: MONO, fontSize: 13, outline: 'none' }} />
        </div>
      )}

      {err && <div style={{ marginTop: 12, fontFamily: MONO, fontSize: 12, color: T.red }}>{err}</div>}
      {busy && <div style={{ marginTop: 12 }}><Label style={{ color: T.muted }}>{progText}</Label></div>}

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
  if (d.type === 'extended') return { tag: `${d.verb} · ${d.marks}m`, main: d.prompt, sub: 'A: ' + d.achieved };
  if (d.type === 'mcq') return { tag: 'Multiple choice', main: d.front, sub: '✓ ' + (d.options[d.answer] || '') };
  if (d.type === 'short') return { tag: 'Short answer', main: d.front, sub: d.back };
  if (d.type === 'cloze') return { tag: 'Cloze', main: d.front, sub: d.back };
  return { tag: 'Flip', main: d.front, sub: d.back };
}

function DraftReview({ drafts, setDrafts, meta, setMeta, onSave, onCancel }){
  const kept = drafts.filter(d => d.keep).length;
  const toggle = (id) => setDrafts(drafts.map(d => d.id === id ? { ...d, keep: !d.keep } : d));

  return (
    <div style={{ padding: '4px 2px' }}>
      <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
        <Label style={{ color: T.faint }}>Review · {kept} of {drafts.length} kept</Label>
        <button className="sf-tap" onClick={onCancel} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
          <Label style={{ color: T.muted }}>Discard all</Label>
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2" style={{ marginBottom: 14 }}>
        {['subject','topic','standard'].map(k => (
          <div key={k}>
            <Label style={{ color: T.faint }}>{k}</Label>
            <input value={meta[k]} onChange={e => setMeta({ ...meta, [k]: e.target.value })}
              style={{ width: '100%', marginTop: 4, background: T.paper, color: T.bone, border: `1px solid ${T.rule}`,
                borderRadius: 8, padding: '8px 10px', fontFamily: MONO, fontSize: 12, outline: 'none' }} />
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2" style={{ marginBottom: 16 }}>
        {drafts.map(d => {
          const p = draftPreview(d);
          return (
            <button key={d.id} className="sf-tap" onClick={() => toggle(d.id)}
              style={{ textAlign: 'left', position: 'relative', background: T.paper,
                border: `1px solid ${d.keep ? T.rule : 'transparent'}`, borderRadius: 12,
                padding: '14px 14px 14px 30px', opacity: d.keep ? 1 : 0.4, cursor: 'pointer' }}>
              <Margin colour={subjectColour(meta.subject)} />
              <Label style={{ color: T.faint }}>{p.tag}</Label>
              <div style={{ fontFamily: SERIF, fontSize: 16, color: T.bone, marginTop: 4, lineHeight: 1.4 }}>{p.main}</div>
              {p.sub && <div style={{ fontFamily: SANS, fontSize: 13, color: T.muted, marginTop: 6, lineHeight: 1.45 }}>{p.sub}</div>}
              {!d.keep && <Label style={{ color: T.red, position: 'absolute', top: 12, right: 12 }}>dropped</Label>}
            </button>
          );
        })}
      </div>

      <Btn full kind="primary" onClick={onSave} disabled={!kept}>Save deck · {kept} cards</Btn>
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
    return <div style={{ padding: 24, textAlign: 'center' }}>
      <div style={{ fontFamily: SERIF, fontSize: 20, color: T.bone }}>No decks yet.</div>
      <Label style={{ color: T.faint, display: 'block', marginTop: 8 }}>Make some cards to begin.</Label>
    </div>;
  }

  return (
    <div className="flex flex-col gap-2" style={{ padding: '4px 2px' }}>
      <Label style={{ color: T.faint }}>Decks</Label>
      {decks.map(d => {
        const dueN = d.cards.filter(c => { const p = progress[c.id]; return p && p.seen && p.due <= TODAY(); }).length;
        const flagN = d.cards.filter(c => { const p = progress[c.id]; return p && p.flagged; }).length;
        return (
          <button key={d.id} className="sf-tap" onClick={() => setOpenId(d.id)}
            style={{ position: 'relative', textAlign: 'left', background: T.paper, border: `1px solid ${T.rule}`,
              borderRadius: 12, padding: '14px 14px 14px 30px', cursor: 'pointer' }}>
            <Margin colour={subjectColour(d.subject)} />
            <Label style={{ color: subjectColour(d.subject) }}>{d.subject || 'Untitled'}</Label>
            <div style={{ fontFamily: SERIF, fontSize: 17, color: T.bone, marginTop: 2 }}>{d.topic}</div>
            <div className="flex gap-3" style={{ marginTop: 6 }}>
              <Label style={{ color: T.faint }}>{d.cards.length} cards</Label>
              {dueN > 0 && <Label style={{ color: T.red }}>{dueN} due</Label>}
              {flagN > 0 && <Label style={{ color: T.red }}>{flagN} misconception</Label>}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function DeckEditor({ deck, progress, onBack, onEditCard, onDeleteCard, onDeleteDeck }){
  const [confirmDeck, setConfirmDeck] = useState(false);
  const [editId, setEditId] = useState(null);

  return (
    <div style={{ padding: '4px 2px' }}>
      <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
        <button className="sf-tap" onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
          <Label style={{ color: T.muted }}>‹ Back</Label>
        </button>
        <Label style={{ color: subjectColour(deck.subject) }}>{deck.subject} · {deck.topic}</Label>
      </div>

      <div className="flex flex-col gap-2">
        {deck.cards.map(c => {
          const p = progress[c.id];
          const label = stateLabel(p);
          const isMis = label === 'MISCONCEPTION';
          if (editId === c.id){
            return <CardEditRow key={c.id} card={c}
              onSave={(patch) => { onEditCard(deck.id, c.id, patch); setEditId(null); }}
              onCancel={() => setEditId(null)} />;
          }
          const prev = draftPreview(c);
          return (
            <div key={c.id} style={{ position: 'relative', background: T.paper, border: `1px solid ${T.rule}`,
              borderRadius: 12, padding: '12px 12px 12px 28px' }}>
              <Margin colour={subjectColour(deck.subject)} />
              <div className="flex items-center justify-between" style={{ marginBottom: 4 }}>
                <Label style={{ color: T.faint }}>{prev.tag}</Label>
                <Label style={{ color: isMis ? T.red : T.faint }}>{label}</Label>
              </div>
              <div style={{ fontFamily: SERIF, fontSize: 15, color: T.bone, lineHeight: 1.4 }}>{prev.main}</div>
              <div className="flex gap-3" style={{ marginTop: 8 }}>
                <button className="sf-tap" onClick={() => setEditId(c.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                  <Label style={{ color: T.muted }}>Edit</Label>
                </button>
                <button className="sf-tap" onClick={() => onDeleteCard(deck.id, c.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                  <Label style={{ color: T.red }}>Delete</Label>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 20 }}>
        {!confirmDeck ? (
          <Btn full kind="danger" onClick={() => setConfirmDeck(true)}>Delete this deck</Btn>
        ) : (
          <div className="flex gap-2">
            <Btn full kind="danger" onClick={onDeleteDeck}>Delete {deck.cards.length} cards — sure</Btn>
            <Btn full kind="ghost" onClick={() => setConfirmDeck(false)}>Keep</Btn>
          </div>
        )}
      </div>
    </div>
  );
}

/* only substitute for null/undefined — `|| ''` would blank a legitimate 0 */
const val = (v) => (v === null || v === undefined) ? '' : v;

function CardEditRow({ card, onSave, onCancel }){
  const [f, setF] = useState(() => card.type === 'mcq'
    ? { ...card, _opts: (card.options || []).join('\n'), answer: String(card.answer == null ? 0 : card.answer) }
    : { ...card });
  const inp = { width: '100%', marginTop: 4, background: T.ink, color: T.bone, border: `1px solid ${T.rule}`,
    borderRadius: 8, padding: '8px 10px', fontFamily: SANS, fontSize: 14, outline: 'none', resize: 'vertical' };
  const field = (k, label, area) => (
    <div style={{ marginBottom: 8 }}>
      <Label style={{ color: T.faint }}>{label}</Label>
      {area ? <textarea value={val(f[k])} onChange={e => setF({ ...f, [k]: e.target.value })} rows={2} style={inp} />
            : <input value={val(f[k])} onChange={e => setF({ ...f, [k]: e.target.value })} style={inp} />}
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
    <div style={{ background: T.paper, border: `1px solid ${T.bone}`, borderRadius: 12, padding: 14 }}>
      {f.type === 'extended' ? (
        <>
          {field('verb', 'Verb')}{field('prompt', 'Question', true)}
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
        <Btn kind="primary" onClick={doSave}>Save</Btn>
        <Btn kind="ghost" onClick={onCancel}>Cancel</Btn>
      </div>
    </div>
  );
}

/* ==========================================================================
   STATS  —  kept light. No badges, no notifications.
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
    <div style={{ padding: '4px 2px' }}>
      <Label style={{ color: T.faint }}>Today</Label>
      <div className="grid grid-cols-3 gap-2" style={{ margin: '10px 0 20px' }}>
        <Stat n={stats.streak || 0} k="day streak" />
        <Stat n={reviewedToday} k="reviewed" />
        <Stat n={dueTotal} k="due now" red={dueTotal > 0} />
      </div>

      <Label style={{ color: T.faint }}>Mastery by subject</Label>
      <div className="flex flex-col gap-3" style={{ marginTop: 10 }}>
        {Object.keys(subjects).length === 0 && <Label style={{ color: T.faint }}>No cards yet.</Label>}
        {Object.entries(subjects).map(([s, v]) => {
          const pct = v.total ? Math.round((v.mastered / v.total) * 100) : 0;
          return (
            <div key={s}>
              <div className="flex items-center justify-between" style={{ marginBottom: 4 }}>
                <Label style={{ color: subjectColour(s) }}>{s}</Label>
                <Label style={{ color: T.muted }}>{pct}%</Label>
              </div>
              <div style={{ height: 4, background: T.rule, borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${pct}%`, background: subjectColour(s) }} />
              </div>
            </div>
          );
        })}
      </div>
      <Label style={{ color: T.faint, display: 'block', marginTop: 20 }}>{totalCards} cards across {decks.length} decks</Label>
    </div>
  );
}
function Stat({ n, k, red }){
  return (
    <div style={{ background: T.paper, border: `1px solid ${T.rule}`, borderRadius: 12, padding: '14px 10px', textAlign: 'center' }}>
      <div style={{ fontFamily: SERIF, fontSize: 28, color: red ? T.red : T.bone }}>{n}</div>
      <Label style={{ color: T.faint }}>{k}</Label>
    </div>
  );
}

/* ==========================================================================
   SETTINGS
   ========================================================================== */
function Settings({ settings, onChange }){
  return (
    <div style={{ padding: '4px 2px' }}>
      <Label style={{ color: T.faint }}>Settings</Label>
      <div className="flex items-center justify-between" style={{ margin: '16px 0', padding: 14, background: T.paper, border: `1px solid ${T.rule}`, borderRadius: 12 }}>
        <div>
          <div style={{ fontFamily: SANS, fontSize: 15, color: T.bone }}>Interleave subjects</div>
          <Label style={{ color: T.faint }}>Round-robin so no topic blocks together</Label>
        </div>
        <button className="sf-tap" onClick={() => onChange({ ...settings, interleave: !settings.interleave })}
          style={{ width: 48, height: 28, borderRadius: 14, border: `1px solid ${T.rule}`,
            background: settings.interleave ? T.bone : T.raised, position: 'relative', cursor: 'pointer', flexShrink: 0 }}>
          <span style={{ position: 'absolute', top: 3, left: settings.interleave ? 23 : 3, width: 20, height: 20,
            borderRadius: 10, background: settings.interleave ? T.ink : T.faint, transition: 'left 150ms' }} />
        </button>
      </div>
      <div className="flex items-center justify-between" style={{ marginBottom: 16, padding: 14, background: T.paper, border: `1px solid ${T.rule}`, borderRadius: 12 }}>
        <div style={{ paddingRight: 12 }}>
          <div style={{ fontFamily: SANS, fontSize: 15, color: T.bone }}>Save usage</div>
          <Label style={{ color: T.faint }}>Faster, cheaper model for everything. Long answers get weaker.</Label>
        </div>
        <button className="sf-tap" onClick={() => onChange({ ...settings, saveUsage: !settings.saveUsage })}
          style={{ width: 48, height: 28, borderRadius: 14, border: `1px solid ${T.rule}`,
            background: settings.saveUsage ? T.bone : T.raised, position: 'relative', cursor: 'pointer', flexShrink: 0 }}>
          <span style={{ position: 'absolute', top: 3, left: settings.saveUsage ? 23 : 3, width: 20, height: 20,
            borderRadius: 10, background: settings.saveUsage ? T.ink : T.faint, transition: 'left 150ms' }} />
        </button>
      </div>

      <div style={{ padding: 14, background: T.paper, border: `1px solid ${T.rule}`, borderRadius: 12 }}>
        <div className="flex items-center justify-between">
          <div>
            <div style={{ fontFamily: SANS, fontSize: 15, color: T.bone }}>Limit new cards per day</div>
            <Label style={{ color: T.faint }}>Off means every new card is available straight away</Label>
          </div>
          <button className="sf-tap" onClick={() => onChange({ ...settings, capNew: !settings.capNew })}
            style={{ width: 48, height: 28, borderRadius: 14, border: `1px solid ${T.rule}`,
              background: settings.capNew ? T.bone : T.raised, position: 'relative', cursor: 'pointer', flexShrink: 0 }}>
            <span style={{ position: 'absolute', top: 3, left: settings.capNew ? 23 : 3, width: 20, height: 20,
              borderRadius: 10, background: settings.capNew ? T.ink : T.faint, transition: 'left 150ms' }} />
          </button>
        </div>
        {settings.capNew && (
          <div className="flex items-center gap-3" style={{ marginTop: 12 }}>
            <Btn kind="ghost" onClick={() => onChange({ ...settings, newPerDay: Math.max(0, ((settings.newPerDay == null ? 12 : settings.newPerDay)) - 2) })}>−</Btn>
            <div style={{ fontFamily: SERIF, fontSize: 24, color: T.bone, minWidth: 40, textAlign: 'center' }}>{(settings.newPerDay == null ? 12 : settings.newPerDay)}</div>
            <Btn kind="ghost" onClick={() => onChange({ ...settings, newPerDay: ((settings.newPerDay == null ? 12 : settings.newPerDay)) + 2 })}>+</Btn>
          </div>
        )}
      </div>
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

  /* practice=true means extra practice: count the review, but do NOT touch the
     scheduler, or answering a card again today would push its interval out. */
  const gradeCard = (card, deck, q, confidentSure, practice) => {
    const today = TODAY();
    let reinsert = false;
    let wasNew = false;

    if (!practice){
      const prev = progress[card.id];
      wasNew = !prev || !prev.seen;
      const r = schedule(prev, q, confidentSure);
      reinsert = r.reinsert;
      persistProgress({ ...progress, [card.id]: r.next });
    }

    const s = { ...stats, newByDate: { ...stats.newByDate }, reviewsByDate: { ...stats.reviewsByDate }, bySubject: { ...stats.bySubject } };
    s.reviewsByDate[today] = (s.reviewsByDate[today] || 0) + 1;
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

  if (!ready) return <Shell><div style={{ padding: 40, textAlign: 'center' }}><Label style={{ color: T.faint }}>Loading…</Label></div></Shell>;

  return (
    <Shell>
      <div style={{ minHeight: 440 }}>
        {tab === 'feed' && <Feed key={'feed-' + cardCount} decks={library.decks} progress={progress} settings={settings}
          stats={stats} onGrade={gradeCard} reduceMotion={reduceMotion.current} />}
        {tab === 'create' && <Create onSave={saveDeck} settings={settings} />}
        {tab === 'decks' && <Decks decks={library.decks} progress={progress} onEditCard={editCard} onDeleteCard={deleteCard} onDeleteDeck={deleteDeck} />}
        {tab === 'stats' && <Stats decks={library.decks} progress={progress} stats={stats} />}
        {tab === 'settings' && <Settings settings={settings} onChange={persistSettings} />}
      </div>
      <Nav tab={tab} setTab={setTab} due={dueCount} />
    </Shell>
  );
}

function Shell({ children }){
  return (
    <div style={{ background: T.ink, minHeight: '100vh', color: T.bone, display: 'flex', justifyContent: 'center' }}>
      <style>{`
        @keyframes sf-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
        * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
        textarea, input { font-size: 16px; }
        ::placeholder { color: ${T.faint}; }
        .sf-btn { transition: transform 120ms ease, background 150ms, border-color 150ms, opacity 150ms; }
        .sf-btn:active:not(:disabled) { transform: scale(0.97); }
        .sf-tap { transition: transform 120ms ease, border-color 150ms; }
        .sf-tap:active { transform: scale(0.98); }
        @media (hover: hover) {
          .sf-btn:hover:not(:disabled) { border-color: #2E3E49; }
        }
        .sf-card { box-shadow: 0 10px 30px rgba(0,0,0,0.35); }
        @media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
      `}</style>
      <div style={{ width: '100%', maxWidth: 460, padding: '18px 16px 96px', position: 'relative' }}>
        {children}
      </div>
    </div>
  );
}

function Nav({ tab, setTab, due }){
  const items = [['feed','Feed'],['create','New'],['decks','Decks'],['stats','Stats'],['settings','Set']];
  return (
    <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, display: 'flex', justifyContent: 'center' }}>
      <div style={{ width: '100%', maxWidth: 460, background: 'rgba(20,28,35,0.92)', backdropFilter: 'blur(8px)',
        borderTop: `1px solid ${T.rule}`, display: 'flex', padding: '6px 8px calc(6px + env(safe-area-inset-bottom))' }}>
        {items.map(([k, label]) => {
          const active = tab === k;
          return (
            <button key={k} className="sf-tap" onClick={() => setTab(k)}
              style={{ flex: 1, background: 'none', border: 'none', cursor: 'pointer', padding: '10px 0 8px', position: 'relative' }}>
              <span style={{ position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)',
                width: 20, height: 2, borderRadius: 2, background: active ? T.bone : 'transparent' }} />
              <Label style={{ color: active ? T.bone : T.faint }}>{label}</Label>
              {k === 'feed' && due > 0 && (
                <span style={{ position: 'absolute', top: 4, right: '50%', marginRight: -24, fontFamily: MONO, fontSize: 10,
                  color: T.ink, background: T.red, borderRadius: 8, padding: '1px 5px', minWidth: 16, textAlign: 'center' }}>{due}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
