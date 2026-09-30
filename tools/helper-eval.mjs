/* ============================================================================
   HELPER EVAL — the small AI helps, measured against each other.

     node tools/helper-eval.mjs                       # the chain's first two models
     node tools/helper-eval.mjs --models a,b          # any models ALLOWED_MODELS lets through
     node tools/helper-eval.mjs --out tools/x.json    # keep every reply, to read

   "Stuck? writing points", the sentence starters and "explain this further"
   are the requests a student waits on in the middle of a question, so their
   speed is felt more than any other call's. Nothing measured them. Their only
   latency figures were three health-check timings, and those did not survive
   contact with a busy evening: on 24 Sep 2026 the chain's head took 11.5s to
   return a TWO-token reply, which put every helper past the 12s hedge.

   This runs the app's own prompts (grabbed from StudyFeed.jsx, so a prompt edit
   is picked up here) on the starter decks' real cards, through the app's own
   request builder, and checks the things a helper can get wrong:

     hints      3-6 points that parse, and that do not hand over the answer.
                "Answer words" are the long words in the card's Merit and
                Excellence descriptors that the question itself does not use —
                the terms the student is meant to supply. A hint set that
                spells several of them out is doing the student's thinking.
                It is a proxy, so compare models on it; do not read one number
                as a verdict.
     starters   2-5 sentence starters, EVERY one with a blank to fill, and the
                same answer-word count — a starter with its blank filled in is
                the failure the prompt shouts about.
     explain    plain / steps / watch all present, steps 2-4 lines.
     all        no achievement standard named (the NCEA rule every prompt
                carries), and the time each took.

   Requests go one model at a time and a few at once, not all together: this is
   the free tier the students are on, and a checker that floods it measures the
   flood. */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { chain } from './app-source.mjs';
import { STARTER_DECKS } from '../starter-decks.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, '..', 'StudyFeed.jsx'), 'utf8');
const ENDPOINT = process.env.SF_ENDPOINT || 'https://studyfeed.app/api/nvidia';
const LEVEL = 'NCEA Level 1';
const CONCURRENCY = 3;

/* ---- grab, as the other evals do: balance braces, string and comment aware -- */
function extractConst(name){
  const start = SRC.indexOf(`const ${name} = `);
  if (start < 0) throw new Error(`grab: const ${name} not found in StudyFeed.jsx`);
  let str = null, esc = false, depth = 0;
  for (let i = start; i < SRC.length; i++){
    const c = SRC[i];
    if (str){
      if (esc){ esc = false; continue; }
      if (c === '\\'){ esc = true; continue; }
      if (c === str) str = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`'){ str = c; continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ';' && depth === 0) return SRC.slice(start, i + 1);
  }
  throw new Error(`grab: could not find the end of ${name}`);
}
function extract(name){
  const start = SRC.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`grab: function ${name} not found in StudyFeed.jsx`);
  let i = SRC.indexOf('{', start);
  let depth = 0, str = null, esc = false, line = false, block = false;
  for (; i < SRC.length; i++){
    const c = SRC[i], n = SRC[i + 1];
    if (line){ if (c === '\n') line = false; continue; }
    if (block){ if (c === '*' && n === '/'){ block = false; i++; } continue; }
    if (str){
      if (esc){ esc = false; continue; }
      if (c === '\\'){ esc = true; continue; }
      if (c === str) str = null;
      continue;
    }
    if (c === '/' && n === '/'){ line = true; i++; continue; }
    if (c === '/' && n === '*'){ block = true; i++; continue; }
    if (c === '"' || c === "'" || c === '`'){ str = c; continue; }
    if (c === '{') depth++;
    else if (c === '}'){ depth--; if (depth === 0) return SRC.slice(start, i + 1); }
  }
  throw new Error(`grab: could not find the end of ${name}`);
}
function grab(fns, consts){
  const src = (consts || []).map(extractConst).concat(fns.map(extract)).join('\n\n');
  const names = (consts || []).concat(fns);
  return new Function(`${src}\nreturn { ${names.join(', ')} };`)();
}
const { hintPrompt, bigHintPrompt, explainPrompt, parseJsonArray, rescueObjects, bodyFor } =
  grab(['hintPrompt', 'bigHintPrompt', 'cardQA', 'explainPrompt', 'rescueObjects', 'parseJsonArray', 'bodyFor'],
       ['isNcea', 'EXPLAIN_STYLE', 'isReasoner', 'takesReasoningEffort']);

/* The token ceilings each helper is really called with, read from its call
   site rather than retyped. */
function ceilingOf(fn){
  const m = SRC.match(new RegExp('callModel\\(' + fn + '\\([^)]*\\),\\s*(\\d+)'));
  if (!m) throw new Error(`no callModel(${fn}(...), N) call site found — has the helper moved?`);
  return Number(m[1]);
}
const MAX = { hints: ceilingOf('hintPrompt'), starters: ceilingOf('bigHintPrompt'), explain: ceilingOf('explainPrompt') };

const argAt = (flag) => { const i = process.argv.indexOf(flag); return i > 0 ? process.argv[i + 1] : null; };
const TEXT = chain(SRC, 'TEXT_MODELS');
const MODELS = argAt('--models') ? argAt('--models').split(',').map(s => s.trim()).filter(Boolean) : TEXT.slice(0, 2);
const outArg = argAt('--out');
const OUT = outArg ? ((isAbsolute(outArg) || /[\\/]/.test(outArg)) ? resolve(outArg) : join(HERE, outArg)) : null;

/* ---- the cards: every extended card for the hints, one of each kind for explain */
const extended = [], explainCards = [];
for (const d of STARTER_DECKS){
  const ex = d.cards.filter(c => c.type === 'extended');
  ex.forEach(c => extended.push({ deck: d.slug, card: c }));
  if (ex[0]) explainCards.push({ deck: d.slug, card: ex[0] });
  const flip = d.cards.find(c => c.type === 'flip' || c.type === 'short');
  if (flip) explainCards.push({ deck: d.slug, card: flip });
}

const STANDARD = /\b(AS|US)\s?9\d{4}\b|\b9[01]\d{3}\b|achievement standard/i;
const words = (s) => (String(s || '').toLowerCase().match(/[a-z][a-z'-]{5,}/g) || []);
/* Words the student is meant to supply: in the Merit/Excellence descriptors,
   absent from the question itself. */
function answerWords(card){
  const asked = new Set(words(card.prompt));
  const said = new Set(words((card.merit || '') + ' ' + (card.excellence || '')));
  return [...said].filter(w => !asked.has(w));
}
function leaked(card, texts){
  const pool = new Set(words(texts.join(' ')));
  return answerWords(card).filter(w => pool.has(w));
}

async function ask(model, prompt, maxTokens){
  const started = Date.now();
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      /* lowEffort true, as all three call sites pass it. */
      body: JSON.stringify(bodyFor(model, [{ role: 'user', content: prompt }], maxTokens, true)),
    });
    const text = await res.text();
    const ms = Date.now() - started;
    if (!res.ok) return { ms, error: 'HTTP ' + res.status + ': ' + text.slice(0, 120) };
    let j = null; try { j = JSON.parse(text); } catch {}
    const reply = j && j.choices && j.choices[0] && j.choices[0].message ? (j.choices[0].message.content || '') : '';
    return { ms, reply, tokens: j && j.usage ? j.usage.completion_tokens : null };
  } catch (e){ return { ms: Date.now() - started, error: e.message }; }
}

function judge(kind, item, out){
  const row = { kind, deck: item.deck, ms: out.ms, tokens: out.tokens, problems: [] };
  if (out.error){ row.problems.push(out.error); row.error = true; return row; }
  row.reply = out.reply;
  if (STANDARD.test(out.reply)) row.problems.push('names a standard');
  if (kind === 'hints' || kind === 'starters'){
    const arr = parseJsonArray(out.reply);
    const list = Array.isArray(arr) ? arr.map(String).filter(Boolean) : [];
    row.items = list;
    const [lo, hi] = kind === 'hints' ? [3, 6] : [2, 5];
    if (!list.length) row.problems.push('did not parse');
    else if (list.length < lo || list.length > hi) row.problems.push(`${list.length} items (want ${lo}-${hi})`);
    if (kind === 'starters'){
      const open = list.filter(s => !/_{3,}/.test(s)).length;
      if (open) row.problems.push(`${open} starter(s) with no blank`);
    }
    row.leak = leaked(item.card, list);
  } else {
    const o = rescueObjects(out.reply)[0];
    row.obj = o || null;
    if (!o) row.problems.push('did not parse');
    else {
      if (!o.plain || String(o.plain).length < 40) row.problems.push('no plain explanation');
      if (!Array.isArray(o.steps) || o.steps.length < 2 || o.steps.length > 4) row.problems.push('steps not 2-4');
      if (!o.watch) row.problems.push('no watch-out');
    }
  }
  return row;
}

async function mapLimit(items, n, fn){
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length){ const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

const pct = (xs, p) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

const jobs = [];
for (const it of extended){
  jobs.push({ kind: 'hints', item: it, prompt: hintPrompt(it.card, LEVEL), max: MAX.hints });
  jobs.push({ kind: 'starters', item: it, prompt: bigHintPrompt(it.card, LEVEL), max: MAX.starters });
}
for (const it of explainCards) jobs.push({ kind: 'explain', item: it, prompt: explainPrompt(it.card, LEVEL, 'normal'), max: MAX.explain });

console.log(`Helper eval — ${jobs.length} requests per model against ${ENDPOINT}`);
console.log(`ceilings: hints ${MAX.hints}, starters ${MAX.starters}, explain ${MAX.explain}; ${CONCURRENCY} at a time\n`);

const all = {};
for (const model of MODELS){
  console.log('== ' + model);
  const rows = await mapLimit(jobs, CONCURRENCY, async (j) => {
    const row = judge(j.kind, j.item, await ask(model, j.prompt, j.max));
    const tag = row.error ? 'ERR ' : row.problems.length ? 'WARN' : 'ok  ';
    console.log(`${tag} ${j.kind.padEnd(8)} ${j.item.deck.padEnd(18)} ${String(row.ms).padStart(6)}ms` +
      (row.leak ? `  answer-words ${row.leak.length}` : '') + (row.problems.length ? '  ' + row.problems.join('; ') : ''));
    return row;
  });
  all[model] = rows;
  console.log('');
}

console.log('SUMMARY');
for (const model of MODELS){
  const rows = all[model];
  const ok = rows.filter(r => !r.problems.length).length;
  const errs = rows.filter(r => r.error).length;
  const ms = rows.filter(r => !r.error).map(r => r.ms);
  const lk = rows.filter(r => r.leak).map(r => r.leak.length);
  const meanLeak = lk.length ? (lk.reduce((a, b) => a + b, 0) / lk.length).toFixed(1) : '-';
  console.log(`${model.padEnd(40)} clean ${ok}/${rows.length}  errors ${errs}  median ${pct(ms, 0.5)}ms  p90 ${pct(ms, 0.9)}ms  answer-words/hint-set ${meanLeak}`);
}

if (OUT){
  writeFileSync(OUT, JSON.stringify(all, null, 2));
  console.log('\nreplies written to ' + OUT);
}
