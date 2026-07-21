import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';

/* ============================================================================
   STUDY FEED  —  single-file build
   Focus of this file: Phase 2 EXTENDED-RESPONSE cards, end to end
   (generate -> draft review -> store -> study in feed -> mark my answer ->
   deck editor), sitting inside the full study loop with flip cards, SM-2,
   generation, stats and settings.

   Constraints honoured:
   - single file, default export, no required props
   - no localStorage/sessionStorage. Uses window.storage.* wrapped in try/catch.
     A missing key THROWS, so every read falls back.
   - four storage keys only (library:main, progress:all, stats:main, settings:main)
   - Tailwind core utilities for layout only; colour comes from the token object
   - generation via window.claude.complete (text). Model target: claude-sonnet-4-6.
   - ships empty. No sample decks.
   ========================================================================== */

/* ---- design tokens : "exam paper, at night" ------------------------------ */
const T = {
  ink:   '#0C1116',   // page
  paper: '#141C23',   // card
  raised:'#1A242C',   // controls
  rule:  '#22303A',   // hairlines
  bone:  '#E8E4DA',   // primary text
  muted: '#8A97A2',   // secondary text
  faint: '#5B6873',   // tertiary / disabled
  red:   '#D9503F',   // the marker's pen — due, Again, destructive ONLY
};
const SERIF = 'Georgia, "Iowan Old Style", "Times New Roman", serif';
const MONO  = '"SF Mono", "Roboto Mono", ui-monospace, Menlo, Consolas, monospace';
const SANS  = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/* eight-hue ring; a stable hash of the subject name picks one */
const HUES = ['#5B8BB0','#B0895B','#7FA06A','#A96FA0','#6FA0A0','#B06F6F','#8A7FB0','#A0A05B'];
function subjectColour(name){
  const s = (name || '').trim().toLowerCase();
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return HUES[h % HUES.length];
}

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

/* ---- storage : every read falls back, every write is guarded ------------- */
/* The artifact runtime's storage.get() returns { key, value, shared } (or the
   raw value on some builds) and set() takes a STRING. So we JSON-stringify on
   write and unwrap + parse on read. A missing key throws -> every read falls back. */
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

const DEFAULT_SETTINGS = { interleave: true, newPerDay: 12 };
const DEFAULT_STATS = { streak: 0, lastDay: '', newByDate: {}, reviewsByDate: {}, bySubject: {} };

/* ---- SM-2 scheduler ------------------------------------------------------ */
/* progress entry: { ease, interval, reps, lapses, due, flagged, seen } */
function freshProgress(){
  return { ease: 2.5, interval: 0, reps: 0, lapses: 0, due: TODAY(), flagged: false, seen: false };
}
const Q = { AGAIN: 0, HARD: 3, GOOD: 4, EASY: 5 };

/* returns { next, reinsert } — reinsert true means "put back in THIS session" */
function schedule(prevRaw, q, confidentSure){
  const p = { ...freshProgress(), ...prevRaw };
  p.seen = true;
  let reinsert = false;

  if (q === Q.AGAIN){
    p.reps = 0;
    p.ease = Math.max(1.3, p.ease - 0.2);
    p.lapses += 1;
    p.due = TODAY();            // never scheduled days out on Again
    reinsert = true;
  } else {
    if (q === Q.HARD)      p.ease = Math.max(1.3, p.ease - 0.15);
    else if (q === Q.EASY) p.ease = p.ease + 0.15;

    let ivl;
    if (p.reps === 0)      ivl = 1;
    else if (p.reps === 1) ivl = 6;
    else {
      if (q === Q.HARD)      ivl = p.interval * 1.2;
      else if (q === Q.EASY) ivl = p.interval * p.ease * 1.3;
      else                   ivl = p.interval * p.ease;      // Good
    }
    p.reps += 1;

    // confidence penalty: sure but graded below Good flags a misconception
    if (confidentSure && q < Q.GOOD) p.flagged = true;
    if (q >= Q.GOOD) p.flagged = false;       // clears once genuinely answered Good

    if (p.flagged) ivl = ivl / 2;             // flagged intervals stay halved

    p.interval = Math.max(1, ivl);
    p.due = addDays(TODAY(), p.interval);
  }
  return { next: p, reinsert };
}

/* human label for a card's scheduler state, for the deck editor */
function stateLabel(p){
  if (!p || !p.seen) return 'UNSEEN';
  if (p.flagged) return 'MISCONCEPTION';
  if (p.due <= TODAY()) return 'DUE';
  const days = Math.max(1, Math.round((new Date(p.due) - new Date(TODAY())) / 86400000));
  const lap = p.lapses ? ` · ${p.lapses} LAPSE${p.lapses > 1 ? 'S' : ''}` : '';
  return `IN ${days}D${lap}`;
}

/* ---- id helper ----------------------------------------------------------- */
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* ==========================================================================
   GENERATION
   Two card shapes come out of the model:
     flip     : { id, type:'flip', front, back }
     extended : { id, type:'extended', verb, prompt, marks,
                  achieved, merit, excellence, skeleton, pitfall }
   ========================================================================== */

const COMMAND_VERBS = ['Describe','Explain','Discuss','Compare and contrast','Evaluate','Justify','Analyse'];

/* pull the first balanced JSON array out of a possibly-truncated reply,
   rescuing whole objects rather than throwing the lot away */
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
    if (c === '"') { inStr = true; continue; }
    if (c === '{'){ if (depth === 0) start = i; depth++; }
    else if (c === '}'){
      depth--;
      if (depth === 0 && start >= 0){
        try { out.push(JSON.parse(text.slice(start, i + 1))); } catch { /* skip partial */ }
        start = -1;
      }
    }
  }
  return out;
}
function parseJsonArray(text){
  try {
    const m = text.match(/\[[\s\S]*\]/);
    if (m) return JSON.parse(m[0]);
  } catch { /* fall through to rescue */ }
  return rescueObjects(text);
}

/* split long notes at paragraph breaks into ~6000-char batches */
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

function flipPrompt(source, level){
  return `You write flashcards for a ${level} student. From the material below, produce fast-recall cards for definitions, formulae, key facts and vocabulary.
Return ONLY lines of the form:  question | answer
One card per line. No numbering, no extra prose. Keep answers tight (a phrase or one sentence).
Do not invent facts that are not supported by the material.

MATERIAL:
${source}`;
}

function extendedPrompt(source, level){
  return `You are an expert ${level} examiner. From the material below, write EXTENDED-RESPONSE exam questions that reward how an answer is CONSTRUCTED, not single-word recall.

Return ONLY a JSON array. Each element:
{
  "verb": one of ${COMMAND_VERBS.map(v => '"' + v + '"').join(', ')},
  "prompt": the full exam question, using that command verb,
  "marks": integer marks available (typically 3-6),
  "achieved": model answer at ACHIEVED level — states/describes the correct thing (the WHAT),
  "merit": model answer at MERIT level — explains with cause and effect linked (the WHY/HOW),
  "excellence": model answer at EXCELLENCE — links multiple ideas AND applies them to the specific scenario in this question, then evaluates or justifies (the SO WHAT),
  "skeleton": the sentence pattern / structure that earns the marks (e.g. "Claim -> mechanism -> link to context"),
  "pitfall": the SPECIFIC mark-losing error for THIS question, not generic advice,
  "subject": subject name,
  "topic": topic name,
  "standard": "${level}"
}

Rules:
- The command verb sets the grade ceiling; make the three answers genuinely differ in depth, not length.
- Excellence MUST refer to the actual scenario/context in the prompt.
- Science: claim -> mechanism -> link to context (Excellence connects >=2 concepts + the scenario).
- Maths: show working; method marks are independent of the final answer; state units; Excellence justifies the method choice.
- English: point -> evidence(quote) -> analysis of technique -> connection to purpose/wider text; Excellence needs a perceptive link to author's purpose.
- Do NOT invent NZQA Achievement Standard codes. Put the given level in "standard".
- Ground every question in the material. No JSON outside the array.

MATERIAL:
${source}`;
}

async function callModel(prompt){
  // window.claude.complete isn't available in the artifact runtime; POST the
  // messages API directly (no key needed inside the artifact). max_tokens 1000
  // per spec — batching + rescueObjects cover any truncation.
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error('api ' + res.status);
  const data = await res.json();
  return (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
}

/* generate flip cards from a text source (may be batched) */
async function genFlip(source, level, onProgress){
  const batches = batchText(source);
  const seen = new Set();
  const cards = [];
  for (let i = 0; i < batches.length; i++){
    onProgress && onProgress(i + 1, batches.length);
    let reply = '';
    try { reply = await callModel(flipPrompt(batches[i], level)); }
    catch { continue; }                    // one batch failing must not sink the rest
    for (const line of reply.split('\n')){
      const idx = line.indexOf('|');
      if (idx < 0) continue;
      const front = line.slice(0, idx).trim().replace(/^\d+[.)]\s*/, '');
      const back  = line.slice(idx + 1).trim();
      if (!front || !back) continue;
      const key = front.toLowerCase();
      if (seen.has(key)) continue;         // dedupe by question text
      seen.add(key);
      cards.push({ id: uid(), type: 'flip', front, back });
    }
  }
  return cards;
}

/* generate extended-response cards from a text source */
async function genExtended(source, level, onProgress){
  const batches = batchText(source);
  const seen = new Set();
  const cards = [];
  for (let i = 0; i < batches.length; i++){
    onProgress && onProgress(i + 1, batches.length);
    let reply = '';
    try { reply = await callModel(extendedPrompt(batches[i], level)); }
    catch { continue; }
    for (const o of parseJsonArray(reply)){
      if (!o || !o.prompt || !o.achieved) continue;
      const key = String(o.prompt).toLowerCase().slice(0, 80);
      if (seen.has(key)) continue;
      seen.add(key);
      cards.push({
        id: uid(),
        type: 'extended',
        verb: COMMAND_VERBS.includes(o.verb) ? o.verb : (o.verb || 'Explain'),
        prompt: String(o.prompt),
        marks: Number(o.marks) || 4,
        achieved: String(o.achieved || ''),
        merit: String(o.merit || ''),
        excellence: String(o.excellence || ''),
        skeleton: String(o.skeleton || ''),
        pitfall: String(o.pitfall || ''),
      });
    }
  }
  return cards;
}

/* mark a typed answer against the A/M/E ladder for one extended card */
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
{
  "grade": "Not yet" | "Achieved" | "Merit" | "Excellence",
  "hit": [ up to 3 things the answer did that earned credit ],
  "missing": [ up to 3 specific things needed to reach the NEXT grade up ],
  "lift": one sentence naming the single change that would most raise the grade
}
Be specific to THIS answer. Reward construction (mechanism, links, context) over word count.`;
}
async function markAnswer(card, answer, level){
  const reply = await callModel(markPrompt(card, answer, level));
  const objs = parseJsonArray('[' + (reply.match(/\{[\s\S]*\}/)?.[0] || '') + ']');
  return objs[0] || null;
}

/* manual entry: "question | answer" per line -> flip cards (same parser shape) */
function parseManual(text){
  const seen = new Set();
  const cards = [];
  for (const line of text.split('\n')){
    const idx = line.indexOf('|');
    if (idx < 0) continue;
    const front = line.slice(0, idx).trim();
    const back  = line.slice(idx + 1).trim();
    if (!front || !back) continue;
    const key = front.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cards.push({ id: uid(), type: 'flip', front, back });
  }
  return cards;
}

/* ==========================================================================
   FILE EXTRACTION  —  .docx / .pptx / .txt read in the browser
   .docx and .pptx are ZIP archives; the typed text lives in XML inside them.
   We extract ONLY the text here, so a 60MB deck sends as a few KB and the
   ~32MB API request cap never comes near. (Images inside the files are not
   read yet — that's the multimodal follow-up.)
   ========================================================================== */
async function loadJSZip(){
  const mod = await import('jszip');           // available in the artifact bundler
  return mod.default || mod;
}
function stripXml(xml){
  return xml
    .replace(/<\/w:p>/g, '\n').replace(/<\/a:p>/g, '\n')   // paragraph breaks
    .replace(/<w:br\s*\/?>/g, '\n').replace(/<a:br\s*\/?>/g, '\n')
    .replace(/<[^>]+>/g, '')                               // drop every tag
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#3?9;/g, "'")
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
}
async function extractFile(file){
  const name = (file.name || '').toLowerCase();
  if (name.endsWith('.txt') || file.type === 'text/plain') return (await file.text()).trim();

  const JSZip = await loadJSZip();
  const zip = await JSZip.loadAsync(file);

  if (name.endsWith('.docx')){
    const doc = zip.file('word/document.xml');
    if (!doc) throw new Error('This .docx has no readable text.');
    return stripXml(await doc.async('string')).trim();
  }
  if (name.endsWith('.pptx')){
    const slides = Object.keys(zip.files)
      .filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
      .sort((a, b) => parseInt(a.match(/(\d+)/)[1]) - parseInt(b.match(/(\d+)/)[1]));
    if (!slides.length) throw new Error('This .pptx has no readable slides.');
    const parts = [];
    for (const n of slides) parts.push(stripXml(await zip.file(n).async('string')).trim());
    return parts.filter(Boolean).join('\n\n');
  }
  throw new Error('Use a .docx, .pptx or .txt file.');
}

/* ==========================================================================
   SMALL UI PRIMITIVES
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
    transition: 'background 150ms',
  };
  const kinds = {
    default: {},
    primary: { background: T.bone, color: T.ink, borderColor: T.bone },
    danger:  { background: 'transparent', color: T.red, borderColor: T.red },
    ghost:   { background: 'transparent', borderColor: T.rule },
    again:   { background: 'transparent', color: T.red, borderColor: T.red },
  };
  return <button onClick={disabled ? undefined : onClick} disabled={disabled}
    style={{ ...base, ...kinds[kind], ...style }}>{children}</button>;
}

/* the signature element: a hairline margin down the left, carrying subject colour */
function Margin({ colour }){
  return <div style={{ position: 'absolute', left: 22, top: 0, bottom: 0, width: 1,
    background: colour || T.rule, opacity: 0.9 }} />;
}

/* ==========================================================================
   STUDY CARD  —  active recall + confidence + grade, shared by both types
   phases: attempt -> confidence -> reveal -> grade
   ========================================================================== */
function StudyCard({ card, deck, onGrade, reduceMotion }){
  const [phase, setPhase] = useState('attempt');   // attempt | reveal
  const [sure, setSure] = useState(null);          // true (Sure) | false (Unsure)
  const colour = subjectColour(deck.subject);

  useEffect(() => { setPhase('attempt'); setSure(null); }, [card.id]);

  const grade = (q) => onGrade(q, sure === true);
  const anim = reduceMotion ? {} : { animation: 'sf-in 200ms ease-out' };

  return (
    <div style={{ position: 'relative', background: T.paper, borderRadius: 18,
      border: `1px solid ${T.rule}`, padding: '26px 22px 22px 42px', minHeight: 380,
      display: 'flex', flexDirection: 'column', ...anim }}>
      <Margin colour={colour} />

      {/* header: subject / topic / type */}
      <div className="flex items-center justify-between" style={{ marginBottom: 18 }}>
        <div className="flex flex-col">
          <Label style={{ color: colour }}>{deck.subject || 'Untitled'}</Label>
          <Label style={{ color: T.faint, marginTop: 2 }}>{deck.topic || ''}</Label>
        </div>
        <Label style={{ color: T.faint }}>
          {card.type === 'extended' ? 'Extended' : 'Flip'}
        </Label>
      </div>

      {card.type === 'extended'
        ? <ExtendedFace card={card} phase={phase} deck={deck} />
        : <FlipFace card={card} phase={phase} />}

      <div style={{ flex: 1 }} />

      {/* controls live in the lower third, where the thumb reaches */}
      <div style={{ marginTop: 18 }}>
        {phase === 'attempt' && sure === null && (
          <div>
            <Label style={{ display: 'block', textAlign: 'center', marginBottom: 10, color: T.faint }}>
              Answer it in your head first
            </Label>
            <div className="flex gap-3">
              <Btn full onClick={() => setSure(true)}>Sure</Btn>
              <Btn full kind="ghost" onClick={() => setSure(false)}>Unsure</Btn>
            </div>
          </div>
        )}

        {phase === 'attempt' && sure !== null && (
          <Btn full kind="primary" onClick={() => setPhase('reveal')}>
            {card.type === 'extended' ? 'Reveal model answers' : 'Reveal answer'}
          </Btn>
        )}

        {phase === 'reveal' && (
          <div>
            <Label style={{ display: 'block', textAlign: 'center', marginBottom: 10, color: T.faint }}>
              How did that go?
            </Label>
            <div className="grid grid-cols-4 gap-2">
              <Btn kind="again" onClick={() => grade(Q.AGAIN)}>Again</Btn>
              <Btn onClick={() => grade(Q.HARD)}>Hard</Btn>
              <Btn onClick={() => grade(Q.GOOD)}>Good</Btn>
              <Btn onClick={() => grade(Q.EASY)}>Easy</Btn>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function FlipFace({ card, phase }){
  return (
    <div>
      <div style={{ fontFamily: SERIF, fontSize: 22, lineHeight: 1.4, color: T.bone }}>
        {card.front}
      </div>
      {phase === 'reveal' && (
        <div style={{ marginTop: 18, paddingTop: 16, borderTop: `1px solid ${T.rule}`,
          fontFamily: SANS, fontSize: 17, lineHeight: 1.5, color: T.bone,
          animation: 'sf-in 200ms ease-out' }}>
          {card.back}
        </div>
      )}
    </div>
  );
}

const AME_COLOURS = { Achieved: T.muted, Merit: T.bone, Excellence: T.bone };
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
      else setErr('Could not read the marking. Try again, or check your connection.');
    } catch {
      setErr('No connection to the marker. Your answer is safe — try again when online.');
    } finally { setBusy(false); }
  };

  return (
    <div>
      {/* command verb, flagged explicitly — it sets the grade ceiling */}
      <div className="flex items-center gap-2" style={{ marginBottom: 10 }}>
        <span style={{ fontFamily: MONO, fontSize: 12, letterSpacing: '0.1em',
          textTransform: 'uppercase', color: T.ink, background: T.bone,
          padding: '3px 8px', borderRadius: 6 }}>{card.verb}</span>
        <Label style={{ color: T.faint }}>{card.marks} marks</Label>
        {card.flagged && <Label style={{ color: T.red }}>· Misconception</Label>}
      </div>

      <div style={{ fontFamily: SERIF, fontSize: 20, lineHeight: 1.45, color: T.bone }}>
        {card.prompt}
      </div>

      {/* attempt phase: option to type an answer and be marked A/M/E */}
      {phase === 'attempt' && (
        <div style={{ marginTop: 16 }}>
          {!marking && (
            <button onClick={() => setMarking(true)} style={{ background: 'none', border: 'none',
              padding: 0, cursor: 'pointer' }}>
              <Label style={{ color: T.muted, textDecoration: 'underline' }}>
                Mark my written answer
              </Label>
            </button>
          )}
          {marking && (
            <div>
              <textarea value={answer} onChange={e => setAnswer(e.target.value)}
                placeholder="Write your full answer…" rows={5}
                style={{ width: '100%', background: T.ink, color: T.bone, border: `1px solid ${T.rule}`,
                  borderRadius: 12, padding: 12, fontFamily: SANS, fontSize: 15, lineHeight: 1.5,
                  resize: 'vertical', outline: 'none' }} />
              <div className="flex gap-2" style={{ marginTop: 8 }}>
                <Btn onClick={doMark} disabled={busy || !answer.trim()}>
                  {busy ? 'Marking…' : 'Mark it'}
                </Btn>
                <Btn kind="ghost" onClick={() => { setMarking(false); setResult(null); setErr(''); }}>Close</Btn>
              </div>
              {err && <div style={{ marginTop: 10, fontFamily: MONO, fontSize: 12, color: T.red }}>{err}</div>}
              {result && <MarkResult r={result} />}
            </div>
          )}
        </div>
      )}

      {/* reveal phase: the A/M/E ladder + skeleton + this-question pitfall */}
      {phase === 'reveal' && (
        <div style={{ marginTop: 18, paddingTop: 16, borderTop: `1px solid ${T.rule}`,
          animation: 'sf-in 200ms ease-out' }}>
          <Rung tier="Achieved"   text={card.achieved} />
          <Rung tier="Merit"      text={card.merit} />
          <Rung tier="Excellence" text={card.excellence} />
          {card.skeleton && (
            <div style={{ marginTop: 12, padding: '10px 12px', background: T.ink,
              borderRadius: 10, border: `1px solid ${T.rule}` }}>
              <Label style={{ color: T.faint }}>Structure that earns it</Label>
              <div style={{ fontFamily: MONO, fontSize: 13, color: T.bone, marginTop: 4, letterSpacing: '0.02em' }}>
                {card.skeleton}
              </div>
            </div>
          )}
          {card.pitfall && (
            <div style={{ marginTop: 10 }}>
              <Label style={{ color: T.red }}>What loses marks here</Label>
              <div style={{ fontFamily: SANS, fontSize: 14, color: T.bone, marginTop: 4, lineHeight: 1.5 }}>
                {card.pitfall}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MarkResult({ r }){
  const gradeColour = r.grade === 'Excellence' || r.grade === 'Merit' ? T.bone
    : r.grade === 'Achieved' ? T.muted : T.red;
  return (
    <div style={{ marginTop: 12, padding: '12px 14px', background: T.ink, borderRadius: 12,
      border: `1px solid ${T.rule}`, animation: 'sf-in 200ms ease-out' }}>
      <Label style={{ color: gradeColour }}>Marked: {r.grade}</Label>
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
      {r.lift && (
        <div style={{ marginTop: 8, fontFamily: SERIF, fontSize: 15, color: T.bone, lineHeight: 1.5 }}>
          {r.lift}
        </div>
      )}
    </div>
  );
}

/* ==========================================================================
   FEED  —  serves only what's due today; ends deliberately
   ========================================================================== */
function buildQueue(decks, progress, settings, stats){
  const today = TODAY();
  const newUsed = (stats.newByDate && stats.newByDate[today]) || 0;
  let newBudget = Math.max(0, (settings.newPerDay ?? 12) - newUsed);

  // flatten cards with their deck, split into due (seen) and new (unseen)
  const due = [], fresh = [];
  for (const d of decks){
    for (const c of d.cards){
      const p = progress[c.id];
      if (!p || !p.seen){ fresh.push({ card: c, deck: d }); }
      else if (p.due <= today){ due.push({ card: c, deck: d }); }
    }
  }
  // take new cards up to today's budget
  const takenNew = fresh.slice(0, newBudget);
  let items = [...due, ...takenNew];

  if (settings.interleave){
    // round-robin across subjects so no topic is blocked together
    const bySub = {};
    for (const it of items){ (bySub[it.deck.subject] ||= []).push(it); }
    const lanes = Object.values(bySub);
    const out = [];
    let n = 0;
    while (out.length < items.length){
      const lane = lanes[n % lanes.length];
      if (lane.length) out.push(lane.shift());
      n++;
      if (n > items.length * lanes.length + 5) break;   // safety
    }
    items = out;
  }
  return items;
}

function Feed({ decks, progress, settings, stats, onGrade, reduceMotion, onDone }){
  // session queue held in state so Again can re-insert within the session
  const [queue, setQueue] = useState(() => buildQueue(decks, progress, settings, stats));
  const [reviewed, setReviewed] = useState(0);
  const initialLen = useRef(queue.length);

  const grade = (q, confidentSure) => {
    const [head, ...rest] = queue;
    if (!head) return;
    const { reinsert } = onGrade(head.card, head.deck, q, confidentSure);
    setReviewed(r => r + 1);
    if (reinsert){
      const pos = Math.min(rest.length, 5);       // ~5 positions later, same session
      const nq = [...rest];
      nq.splice(pos, 0, head);
      setQueue(nq);
    } else {
      setQueue(rest);
    }
  };

  const head = queue[0];

  if (!head){
    return (
      <div className="flex flex-col items-center justify-center" style={{ minHeight: 420, textAlign: 'center', padding: 24 }}>
        <Label style={{ color: T.faint }}>Queue clear</Label>
        <div style={{ fontFamily: SERIF, fontSize: 24, color: T.bone, margin: '14px 0', lineHeight: 1.4 }}>
          There is nothing below this.<br />Put the phone down.
        </div>
        {reviewed > 0 && <Label style={{ color: T.faint }}>{reviewed} reviewed today</Label>}
      </div>
    );
  }

  return (
    <div>
      {/* thin progress strip — functional, not decorative */}
      <div style={{ height: 2, background: T.rule, borderRadius: 2, marginBottom: 14, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${initialLen.current ? (reviewed / (reviewed + queue.length)) * 100 : 0}%`,
          background: T.bone, transition: reduceMotion ? 'none' : 'width 200ms' }} />
      </div>
      <StudyCard key={head.card.id} card={head.card} deck={head.deck}
        onGrade={grade} reduceMotion={reduceMotion} />
    </div>
  );
}

/* ==========================================================================
   CREATE  —  generate (notes / topic) or manual; then draft review
   (photo/PDF attach lives in the existing app's multimodal pipeline — this
    standalone covers the text paths, which is where Phase 2 lives)
   ========================================================================== */
function Create({ onSave, reduceMotion }){
  const [mode, setMode] = useState('generate');     // generate | manual
  const [cardType, setCardType] = useState('extended');
  const [source, setSource] = useState('');
  const [level, setLevel] = useState('NCEA Level 1');
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState(null);           // {i,n}
  const [err, setErr] = useState('');
  const [drafts, setDrafts] = useState(null);       // draft cards awaiting review
  const [meta, setMeta] = useState({ subject: '', topic: '', standard: 'NCEA Level 1' });
  const [attaching, setAttaching] = useState('');
  const fileRef = useRef(null);

  // pull text out of attached files and append it to the source box
  const onFiles = async (e) => {
    const files = Array.from(e.target.files || []);
    if (e.target) e.target.value = '';        // let the same file be re-picked later
    if (!files.length) return;
    setErr('');
    let added = '';
    for (const f of files){
      setAttaching(`Reading ${f.name}…`);
      try {
        const text = await extractFile(f);
        if (text) added += (added ? '\n\n' : '') + `# ${f.name}\n${text}`;
        else setErr(`No text found in ${f.name}.`);
      } catch (er){ setErr(er.message || `Could not read ${f.name}.`); }
    }
    setAttaching('');
    if (added) setSource(s => s ? s + '\n\n' + added : added);
  };

  const run = async () => {
    if (!source.trim()){ setErr('Paste some notes or type a topic first.'); return; }
    setBusy(true); setErr(''); setProg(null);
    try {
      let cards;
      if (mode === 'manual'){
        cards = parseManual(source);
        if (!cards.length){ setErr('Use “question | answer”, one per line.'); setBusy(false); return; }
      } else if (cardType === 'extended'){
        cards = await genExtended(source, level, (i, n) => setProg({ i, n }));
      } else {
        cards = await genFlip(source, level, (i, n) => setProg({ i, n }));
      }
      if (!cards.length){ setErr('Nothing came back. Try clearer notes, or a narrower topic.'); setBusy(false); return; }
      // infer subject/topic from first extended card if present
      const first = cards.find(c => c.type === 'extended');
      setMeta({
        subject: (first && first.subjectGuess) || guessSubject(source),
        topic: guessTopic(source),
        standard: level,
      });
      setDrafts(cards.map(c => ({ ...c, keep: true })));
    } catch (e){
      setErr('Generation failed. Check your connection and try again.');
    } finally { setBusy(false); setProg(null); }
  };

  if (drafts){
    return <DraftReview drafts={drafts} setDrafts={setDrafts} meta={meta} setMeta={setMeta}
      onCancel={() => setDrafts(null)}
      onSave={() => { onSave(drafts.filter(d => d.keep), meta); setDrafts(null); setSource(''); }} />;
  }

  return (
    <div style={{ padding: '4px 2px' }}>
      <Label style={{ color: T.faint }}>New cards</Label>

      <div className="flex gap-2" style={{ margin: '12px 0' }}>
        <Btn full kind={mode === 'generate' ? 'primary' : 'ghost'} onClick={() => setMode('generate')}>Generate</Btn>
        <Btn full kind={mode === 'manual' ? 'primary' : 'ghost'} onClick={() => setMode('manual')}>Manual</Btn>
      </div>

      {mode === 'generate' && (
        <div className="flex gap-2" style={{ marginBottom: 12 }}>
          <Btn full kind={cardType === 'extended' ? 'default' : 'ghost'} onClick={() => setCardType('extended')}
            style={cardType === 'extended' ? { borderColor: T.bone } : {}}>Extended response</Btn>
          <Btn full kind={cardType === 'flip' ? 'default' : 'ghost'} onClick={() => setCardType('flip')}
            style={cardType === 'flip' ? { borderColor: T.bone } : {}}>Flip cards</Btn>
        </div>
      )}

      {mode === 'generate' && (
        <div style={{ marginBottom: 12 }}>
          <input ref={fileRef} type="file" accept=".docx,.pptx,.txt" multiple
            onChange={onFiles} style={{ display: 'none' }} />
          <Btn full kind="ghost" onClick={() => fileRef.current && fileRef.current.click()}>
            Attach Word / PowerPoint / text
          </Btn>
          {attaching
            ? <Label style={{ color: T.muted, display: 'block', marginTop: 8 }}>{attaching}</Label>
            : <Label style={{ color: T.faint, display: 'block', marginTop: 8 }}>
                Reads the typed text from the file — any size. Pictures inside aren’t read yet.
              </Label>}
        </div>
      )}

      <textarea value={source} onChange={e => setSource(e.target.value)}
        placeholder={mode === 'manual'
          ? 'question | answer\nquestion | answer'
          : 'Paste your notes, or type a topic like “rates of reaction”…'}
        rows={8}
        style={{ width: '100%', background: T.paper, color: T.bone, border: `1px solid ${T.rule}`,
          borderRadius: 12, padding: 14, fontFamily: mode === 'manual' ? MONO : SANS, fontSize: 15,
          lineHeight: 1.5, resize: 'vertical', outline: 'none' }} />

      {mode === 'generate' && (
        <div style={{ marginTop: 10 }}>
          <Label style={{ color: T.faint }}>Level</Label>
          <input value={level} onChange={e => setLevel(e.target.value)}
            style={{ width: '100%', marginTop: 4, background: T.paper, color: T.bone,
              border: `1px solid ${T.rule}`, borderRadius: 10, padding: '10px 12px',
              fontFamily: MONO, fontSize: 13, outline: 'none' }} />
        </div>
      )}

      {err && <div style={{ marginTop: 12, fontFamily: MONO, fontSize: 12, color: T.red }}>{err}</div>}
      {busy && prog && (
        <div style={{ marginTop: 12 }}>
          <Label style={{ color: T.muted }}>Batch {prog.i} of {prog.n}</Label>
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <Btn full kind="primary" onClick={run} disabled={busy}>
          {busy ? (mode === 'manual' ? 'Reading…' : 'Generating…')
                : (mode === 'manual' ? 'Read cards' : 'Generate cards')}
        </Btn>
      </div>
    </div>
  );
}

/* crude offline guesses; user edits them in draft review anyway */
function guessSubject(text){
  const t = text.toLowerCase();
  const map = [['biolog','Biology'],['chemis','Chemistry'],['physic','Physics'],
    ['math','Maths'],['algebra','Maths'],['essay','English'],['shakes','English'],
    ['histor','History'],['geograph','Geography'],['econom','Economics']];
  for (const [k, v] of map) if (t.includes(k)) return v;
  return '';
}
function guessTopic(text){
  const first = text.trim().split('\n')[0].slice(0, 40);
  return first.replace(/[|:.].*$/, '').trim();
}

function DraftReview({ drafts, setDrafts, meta, setMeta, onSave, onCancel }){
  const kept = drafts.filter(d => d.keep).length;
  const toggle = (id) => setDrafts(drafts.map(d => d.id === id ? { ...d, keep: !d.keep } : d));

  return (
    <div style={{ padding: '4px 2px' }}>
      <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
        <Label style={{ color: T.faint }}>Review · {kept} of {drafts.length} kept</Label>
        <button onClick={onCancel} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
          <Label style={{ color: T.muted }}>Discard all</Label>
        </button>
      </div>

      {/* editable subject / topic / standard */}
      <div className="grid grid-cols-3 gap-2" style={{ marginBottom: 14 }}>
        {['subject','topic','standard'].map(k => (
          <div key={k}>
            <Label style={{ color: T.faint }}>{k}</Label>
            <input value={meta[k]} onChange={e => setMeta({ ...meta, [k]: e.target.value })}
              style={{ width: '100%', marginTop: 4, background: T.paper, color: T.bone,
                border: `1px solid ${T.rule}`, borderRadius: 8, padding: '8px 10px',
                fontFamily: MONO, fontSize: 12, outline: 'none' }} />
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2" style={{ marginBottom: 16 }}>
        {drafts.map(d => (
          <button key={d.id} onClick={() => toggle(d.id)}
            style={{ textAlign: 'left', position: 'relative', background: T.paper,
              border: `1px solid ${d.keep ? T.rule : 'transparent'}`, borderRadius: 12,
              padding: '14px 14px 14px 30px', opacity: d.keep ? 1 : 0.4, cursor: 'pointer' }}>
            <Margin colour={subjectColour(meta.subject)} />
            {d.type === 'extended' ? (
              <>
                <Label style={{ color: T.faint }}>{d.verb} · {d.marks} marks</Label>
                <div style={{ fontFamily: SERIF, fontSize: 16, color: T.bone, marginTop: 4, lineHeight: 1.4 }}>{d.prompt}</div>
                <div style={{ fontFamily: SANS, fontSize: 13, color: T.muted, marginTop: 6, lineHeight: 1.45 }}>
                  A: {d.achieved}
                </div>
              </>
            ) : (
              <>
                <div style={{ fontFamily: SERIF, fontSize: 16, color: T.bone, lineHeight: 1.4 }}>{d.front}</div>
                <div style={{ fontFamily: SANS, fontSize: 14, color: T.muted, marginTop: 4 }}>{d.back}</div>
              </>
            )}
            {!d.keep && <Label style={{ color: T.red, position: 'absolute', top: 12, right: 12 }}>dropped</Label>}
          </button>
        ))}
      </div>

      <Btn full kind="primary" onClick={onSave} disabled={!kept}>Save deck · {kept} cards</Btn>
    </div>
  );
}

/* ==========================================================================
   DECKS  —  list, editor (edit/delete card, delete deck), scheduler state
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
        const flagN = d.cards.filter(c => progress[c.id]?.flagged).length;
        return (
          <button key={d.id} onClick={() => setOpenId(d.id)}
            style={{ position: 'relative', textAlign: 'left', background: T.paper,
              border: `1px solid ${T.rule}`, borderRadius: 12, padding: '14px 14px 14px 30px', cursor: 'pointer' }}>
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
        <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
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
          return (
            <div key={c.id} style={{ position: 'relative', background: T.paper, border: `1px solid ${T.rule}`,
              borderRadius: 12, padding: '12px 12px 12px 28px' }}>
              <Margin colour={subjectColour(deck.subject)} />
              <div className="flex items-center justify-between" style={{ marginBottom: 4 }}>
                <Label style={{ color: c.type === 'extended' ? T.faint : T.faint }}>
                  {c.type === 'extended' ? `${c.verb} · ${c.marks}m` : 'Flip'}
                </Label>
                <Label style={{ color: isMis ? T.red : T.faint }}>{label}</Label>
              </div>
              <div style={{ fontFamily: SERIF, fontSize: 15, color: T.bone, lineHeight: 1.4 }}>
                {c.type === 'extended' ? c.prompt : c.front}
              </div>
              <div className="flex gap-3" style={{ marginTop: 8 }}>
                <button onClick={() => setEditId(c.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                  <Label style={{ color: T.muted }}>Edit</Label>
                </button>
                <button onClick={() => onDeleteCard(deck.id, c.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
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

function CardEditRow({ card, onSave, onCancel }){
  const [f, setF] = useState(card);
  const field = (k, label, area) => (
    <div style={{ marginBottom: 8 }}>
      <Label style={{ color: T.faint }}>{label}</Label>
      {area
        ? <textarea value={f[k] || ''} onChange={e => setF({ ...f, [k]: e.target.value })} rows={2}
            style={inp} />
        : <input value={f[k] || ''} onChange={e => setF({ ...f, [k]: e.target.value })} style={inp} />}
    </div>
  );
  const inp = { width: '100%', marginTop: 4, background: T.ink, color: T.bone,
    border: `1px solid ${T.rule}`, borderRadius: 8, padding: '8px 10px',
    fontFamily: SANS, fontSize: 14, outline: 'none', resize: 'vertical' };

  return (
    <div style={{ background: T.paper, border: `1px solid ${T.bone}`, borderRadius: 12, padding: 14 }}>
      {card.type === 'extended' ? (
        <>
          {field('verb', 'Verb')}
          {field('prompt', 'Question', true)}
          {field('achieved', 'Achieved', true)}
          {field('merit', 'Merit', true)}
          {field('excellence', 'Excellence', true)}
          {field('skeleton', 'Structure')}
          {field('pitfall', 'What loses marks', true)}
        </>
      ) : (
        <>
          {field('front', 'Question', true)}
          {field('back', 'Answer', true)}
        </>
      )}
      <div className="flex gap-2" style={{ marginTop: 6 }}>
        <Btn kind="primary" onClick={() => onSave(f)}>Save</Btn>
        <Btn kind="ghost" onClick={onCancel}>Cancel</Btn>
      </div>
    </div>
  );
}

/* ==========================================================================
   STATS  —  kept deliberately light. No badges, no notifications.
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

  // per-subject mastery: share of that subject's seen cards not currently due/flagged
  const subjects = {};
  for (const d of decks){
    const s = d.subject || 'Untitled';
    subjects[s] ||= { total: 0, mastered: 0 };
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
      <div className="flex items-center justify-between" style={{ margin: '16px 0', padding: '14px', background: T.paper, border: `1px solid ${T.rule}`, borderRadius: 12 }}>
        <div>
          <div style={{ fontFamily: SANS, fontSize: 15, color: T.bone }}>Interleave subjects</div>
          <Label style={{ color: T.faint }}>Round-robin so no topic blocks together</Label>
        </div>
        <button onClick={() => onChange({ ...settings, interleave: !settings.interleave })}
          style={{ width: 48, height: 28, borderRadius: 14, border: `1px solid ${T.rule}`,
            background: settings.interleave ? T.bone : T.raised, position: 'relative', cursor: 'pointer' }}>
          <span style={{ position: 'absolute', top: 3, left: settings.interleave ? 23 : 3, width: 20, height: 20,
            borderRadius: 10, background: settings.interleave ? T.ink : T.faint, transition: 'left 150ms' }} />
        </button>
      </div>
      <div style={{ padding: 14, background: T.paper, border: `1px solid ${T.rule}`, borderRadius: 12 }}>
        <div style={{ fontFamily: SANS, fontSize: 15, color: T.bone }}>New cards per day</div>
        <Label style={{ color: T.faint }}>Caps how much fresh material enters the queue</Label>
        <div className="flex items-center gap-3" style={{ marginTop: 10 }}>
          <Btn kind="ghost" onClick={() => onChange({ ...settings, newPerDay: Math.max(0, (settings.newPerDay ?? 12) - 2) })}>−</Btn>
          <div style={{ fontFamily: SERIF, fontSize: 24, color: T.bone, minWidth: 40, textAlign: 'center' }}>{settings.newPerDay ?? 12}</div>
          <Btn kind="ghost" onClick={() => onChange({ ...settings, newPerDay: (settings.newPerDay ?? 12) + 2 })}>+</Btn>
        </div>
      </div>
    </div>
  );
}

/* ==========================================================================
   APP  —  loads the four keys, owns writes, routes tabs
   ========================================================================== */
export default function App(){
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState('feed');   // feed | create | decks | stats | settings
  const [library, setLibrary] = useState({ decks: [] });
  const [progress, setProgress] = useState({});
  const [stats, setStats] = useState(DEFAULT_STATS);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const reduceMotion = useRef(false);

  // load everything once
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

  // save a reviewed deck (from draft review)
  const saveDeck = (cards, meta) => {
    const deck = {
      id: uid(),
      subject: (meta.subject || 'Untitled').trim(),
      topic: (meta.topic || '').trim(),
      standard: (meta.standard || 'NCEA Level 1').trim(),
      cards: cards.map(({ keep, subjectGuess, ...c }) => c),
    };
    persistLibrary({ decks: [...library.decks, deck] });
    setTab('feed');
  };

  // grade a card from the feed -> update progress + stats, return {reinsert}
  const gradeCard = (card, deck, q, confidentSure) => {
    const prev = progress[card.id];
    const wasNew = !prev || !prev.seen;
    const { next, reinsert } = schedule(prev, q, confidentSure);
    const nextProg = { ...progress, [card.id]: next };
    persistProgress(nextProg);

    // stats: streak, counts per date, per subject
    const today = TODAY();
    const s = { ...stats,
      newByDate: { ...stats.newByDate },
      reviewsByDate: { ...stats.reviewsByDate },
      bySubject: { ...stats.bySubject } };
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
    persistLibrary({ decks: library.decks.map(d => d.id !== deckId ? d
      : { ...d, cards: d.cards.filter(c => c.id !== cardId) }) });
  };
  const deleteDeck = (deckId) => {
    persistLibrary({ decks: library.decks.filter(d => d.id !== deckId) });
  };

  const dueCount = useMemo(() => {
    if (!ready) return 0;
    const today = TODAY();
    let n = 0;
    const newBudget = Math.max(0, (settings.newPerDay ?? 12) - ((stats.newByDate && stats.newByDate[today]) || 0));
    let freshLeft = newBudget;
    for (const d of library.decks) for (const c of d.cards){
      const p = progress[c.id];
      if (!p || !p.seen){ if (freshLeft > 0){ n++; freshLeft--; } }
      else if (p.due <= today) n++;
    }
    return n;
  }, [ready, library, progress, settings, stats]);

  if (!ready){
    return <Shell><div style={{ padding: 40, textAlign: 'center' }}><Label style={{ color: T.faint }}>Loading…</Label></div></Shell>;
  }

  return (
    <Shell>
      <div style={{ minHeight: 440 }}>
        {tab === 'feed' && <Feed key={'feed-' + library.decks.reduce((s, d) => s + d.cards.length, 0)}
          decks={library.decks} progress={progress} settings={settings}
          stats={stats} onGrade={gradeCard} reduceMotion={reduceMotion.current}
          onDone={() => {}} />}
        {tab === 'create' && <Create onSave={saveDeck} reduceMotion={reduceMotion.current} />}
        {tab === 'decks' && <Decks decks={library.decks} progress={progress}
          onEditCard={editCard} onDeleteCard={deleteCard} onDeleteDeck={deleteDeck} />}
        {tab === 'stats' && <Stats decks={library.decks} progress={progress} stats={stats} />}
        {tab === 'settings' && <Settings settings={settings} onChange={persistSettings} />}
      </div>

      <Nav tab={tab} setTab={setTab} due={dueCount} />
    </Shell>
  );
}

function Shell({ children }){
  return (
    <div style={{ background: T.ink, minHeight: '100vh', color: T.bone,
      display: 'flex', justifyContent: 'center' }}>
      <style>{`
        @keyframes sf-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
        @media (prefers-reduced-motion: reduce){ * { animation: none !important; transition: none !important; } }
        * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
        textarea, input { font-size: 16px; }  /* stop iOS zoom-on-focus */
        ::placeholder { color: ${T.faint}; }
      `}</style>
      <div style={{ width: '100%', maxWidth: 460, padding: '18px 16px 96px', position: 'relative' }}>
        {children}
      </div>
    </div>
  );
}

function Nav({ tab, setTab, due }){
  const items = [
    ['feed', 'Feed'], ['create', 'New'], ['decks', 'Decks'], ['stats', 'Stats'], ['settings', 'Set'],
  ];
  return (
    <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, display: 'flex', justifyContent: 'center' }}>
      <div style={{ width: '100%', maxWidth: 460, background: T.paper, borderTop: `1px solid ${T.rule}`,
        display: 'flex', padding: '8px 8px calc(8px + env(safe-area-inset-bottom))' }}>
        {items.map(([k, label]) => {
          const active = tab === k;
          return (
            <button key={k} onClick={() => setTab(k)}
              style={{ flex: 1, background: 'none', border: 'none', cursor: 'pointer', padding: '8px 0', position: 'relative' }}>
              <Label style={{ color: active ? T.bone : T.faint }}>{label}</Label>
              {k === 'feed' && due > 0 && (
                <span style={{ position: 'absolute', top: 2, right: '50%', marginRight: -22,
                  fontFamily: MONO, fontSize: 10, color: T.ink, background: T.red,
                  borderRadius: 8, padding: '1px 5px', minWidth: 16, textAlign: 'center' }}>{due}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
