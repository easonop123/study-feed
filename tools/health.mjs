/* ============================================================================
   HEALTH CHECK — is every AI feature on the site actually working, and how
   slow is each one?

   Every model-backed feature in the app, called through its REAL prompt (the
   builders are lifted out of StudyFeed.jsx at run time, same as the evals) and
   its real token ceiling and reasoning setting. Reports OK/FAIL and the wall
   time for each, so "the AI isn't working" and "some of it is very slow" can
   both be answered with numbers instead of guesses.

     node tools/health.mjs               # everything, in order
     node tools/health.mjs --only mark   # one, by name fragment
     node tools/health.mjs --repeat 3    # for latency, which varies a lot

   The token ceiling and the lowEffort flag for each row are read from the call
   site in the source, not retyped, so this cannot quietly test a request the
   app has stopped sending.
   ========================================================================== */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, '..', 'StudyFeed.jsx'), 'utf8');

function extractConst(name){
  const start = SRC.indexOf(`const ${name} = `);
  if (start < 0) throw new Error(`grab: const ${name} not found`);
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
  throw new Error(`grab: no end for ${name}`);
}
function extract(name){
  const start = SRC.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`grab: function ${name} not found`);
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
  throw new Error(`grab: no end for ${name}`);
}
function grab(fns, consts){
  const src = (consts || []).map(extractConst).concat(fns.map(extract)).join('\n\n');
  const names = (consts || []).concat(fns);
  return new Function(`${src}\nreturn { ${names.join(', ')} };`)();
}

const G = grab(
  ['mixedPrompt', 'extendedPrompt', 'flipPrompt', 'workedPrompt', 'mixTargets',
   'markPrompt', 'markWorkingPrompt', 'hintPrompt', 'bigHintPrompt',
   'explainPrompt', 'cardQA', 'upgradePrompt',
   'blueprintPrompt', 'rungSplit', 'diagnosePrompt', 'paperPrompt',
   'rescueObjects', 'parseJsonArray', 'cardsFromJson', 'typedCheckable'],
  ['COMMAND_VERBS', 'NCEA_RULES', 'isNcea', 'nceaRules', 'STRICT_CLAUSE',
   'EXPLAIN_STYLE', 'GRADES', 'TYPED_MAX_CHARS', 'TYPED_MAX_WORDS',
   'NEXT_GRADE', 'nextGradeUp', 'uid']);

const ENDPOINT = 'https://studyfeed.app/api/nvidia';
const num = (re, d) => { const m = SRC.match(re); return m ? Number(m[1]) : d; };
const str = (re, d) => { const m = SRC.match(re); return m ? m[1] : d; };

const MODEL_SMART  = str(/const MODEL_SMART = '([^']+)'/, '');
const MODEL_GEN    = str(/const MODEL_GEN   = '([^']+)'/, MODEL_SMART);
const MODEL_VISION = str(/const MODEL_VISION = '([^']+)'/, '');
if (!MODEL_SMART) throw new Error('grab: MODEL_SMART not found');

/* Ceiling, model and reasoning setting, all read off the real call site.

   `low` used to be hand-written per row here. That is exactly how a checker
   starts lying: the app was changed to send reasoning_effort on the hints, this
   file kept testing the old request, and it went on reporting a feature broken
   after it had been fixed. Anything the app decides, read from the app. */
function callSite(fnCall, dflt){
  const rx = new RegExp('callModel\\(\\s*' + fnCall.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    + '\\s*,\\s*(\\d+)\\s*,\\s*([A-Za-z_$][\\w$]*)\\s*(,\\s*true)?\\s*\\)');
  const m = SRC.match(rx);
  if (!m) return dflt;
  const modelName = m[2];
  const model = str(new RegExp('const ' + modelName + '\\s*=\\s*\'([^\']+)\''), MODEL_SMART);
  return { max: Number(m[1]), model: model, low: !!m[3] };
}

const GEN_MAX   = num(/const GEN_MAX_TOKENS = (\d+)/, 2400);
const PAPER_MAX = num(/const PAPER_MAX_TOKENS = (\d+)/, 2000);
/* genChunk and buildPaper do not match the callSite shape (they pass a model
   variable and a computed prompt), so their two settings stay explicit — both
   pass lowEffort:true, which is checked by reading the call line. */
const GEN_LOW   = /callModel\(promptFor\([^)]*\), GEN_MAX_TOKENS, model, true\)/.test(SRC);
const PAPER_LOW = /PAPER_MAX_TOKENS, MODEL_SMART, true\)/.test(SRC);

const MARK = callSite('markPrompt(card, answer, level)', { max: 3000, model: MODEL_SMART, low: false });
const WORK = callSite('markWorkingPrompt(card, working, level)', { max: 3000, model: MODEL_SMART, low: false });
const HINT = callSite('hintPrompt(card, level)', { max: 600, model: MODEL_SMART, low: false });
const BIG  = callSite('bigHintPrompt(card, level)', { max: 700, model: MODEL_SMART, low: false });
const EXPL = callSite('explainPrompt(card, level, depth)', { max: 900, model: MODEL_SMART, low: false });
const UPG  = callSite('upgradePrompt(card, answer, result, level)', { max: 1600, model: MODEL_SMART, low: false });
const BLUE = callSite('blueprintPrompt(topic, level, n)', { max: 3000, model: MODEL_GEN, low: false });
const DIAG = callSite('diagnosePrompt(topic, level, items)', { max: 3000, model: MODEL_SMART, low: false });

const LEVEL = 'NCEA Level 1';

const LONG_CARD = {
  type: 'extended', verb: 'Explain', marks: 4,
  prompt: 'Explain why increasing the temperature increases the rate of a reaction.',
  achieved: 'States that the rate increases.',
  merit: 'Links temperature to particle energy and collision frequency.',
  excellence: 'Links collision frequency AND collision energy to activation energy in this context.',
  skeleton: 'Because ... this means ... so ...',
  pitfall: 'Saying particles "have more energy" without saying what that does.',
};
const WORKED_CARD = {
  type: 'worked', marks: 4,
  prompt: 'A trolley of mass 250 g accelerates from rest to 12.5 m/s in 4.0 s. Calculate the net force.',
  steps: ['Convert 250 g to 0.25 kg', 'a = (v - u) / t', 'a = 3.125 m/s^2', 'F = ma with the unit'],
  answer: '0.78 N', pitfall: 'Leaving the mass in grams.',
};
const FLIP_CARD = { type: 'flip', front: 'What is activation energy?', back: 'The minimum energy a collision needs for a reaction to happen.' };
const ANSWER = 'When you heat it up the particles move faster so they hit each other more and the reaction goes quicker.';
const MARK_RESULT = { grade: 'Achieved', hit: ['Says the rate increases'], missing: ['Link collision energy to activation energy'], lift: 'Say what the extra energy does to the number of successful collisions.', notes: [] };
const NOTES = [
  'Rate of reaction — how fast reactants are used up.',
  'Collision theory — particles must collide with enough energy to react.',
  'Temperature raises kinetic energy, so more frequent and more energetic collisions.',
  'Surface area: smaller pieces expose more particles.',
  'A catalyst lowers the activation energy and is not consumed.',
].join('\n');

/* name, the prompt, its ceiling, whether the app sends reasoning_effort:low,
   and a check that the reply is USABLE rather than merely non-empty — a 200
   carrying prose where the app expects JSON is a failure the user sees. */
const CHECKS = [
  { name: 'generate (mixed)', model: MODEL_GEN, low: GEN_LOW, max: GEN_MAX,
    prompt: () => G.mixedPrompt(NOTES, LEVEL, 30, false),
    ok: (r) => G.cardsFromJson(G.parseJsonArray(r)).length > 0 },

  { name: 'generate (long)', model: MODEL_GEN, low: GEN_LOW, max: GEN_MAX,
    prompt: () => G.extendedPrompt(NOTES, LEVEL, false),
    ok: (r) => G.cardsFromJson(G.parseJsonArray(r)).length > 0 },

  { name: 'generate (working)', model: MODEL_GEN, low: GEN_LOW, max: GEN_MAX,
    prompt: () => G.workedPrompt(NOTES, LEVEL, false),
    ok: (r) => Array.isArray(G.parseJsonArray(r)) },

  { name: 'mark written answer', model: MARK.model, low: MARK.low, max: MARK.max,
    prompt: () => G.markPrompt(LONG_CARD, ANSWER, LEVEL),
    ok: (r) => { const o = G.rescueObjects(r)[0]; return !!(o && o.grade); } },

  { name: 'mark working', model: WORK.model, low: WORK.low, max: WORK.max,
    prompt: () => G.markWorkingPrompt(WORKED_CARD, 'm = 250 g\na = 12.5 / 4 = 3.125\nF = 250 x 3.125 = 781 N', LEVEL),
    ok: (r) => { const o = G.rescueObjects(r)[0]; return !!(o && o.grade && Array.isArray(o.steps)); } },

  { name: 'writing points', model: HINT.model, low: HINT.low, max: HINT.max,
    prompt: () => G.hintPrompt(LONG_CARD, LEVEL),
    ok: (r) => r.trim().length > 20 },

  { name: 'sentence starters', model: BIG.model, low: BIG.low, max: BIG.max,
    prompt: () => G.bigHintPrompt(LONG_CARD, LEVEL),
    ok: (r) => r.trim().length > 20 },

  { name: 'explain this further', model: EXPL.model, low: EXPL.low, max: EXPL.max,
    prompt: () => G.explainPrompt(FLIP_CARD, LEVEL, 'normal'),
    ok: (r) => r.trim().length > 40 },

  { name: 'upgrade path', model: UPG.model, low: UPG.low, max: UPG.max,
    prompt: () => G.upgradePrompt(LONG_CARD, ANSWER, MARK_RESULT, LEVEL),
    ok: (r) => r.trim().length > 40 },

  { name: 'diagnostic: plan', model: BLUE.model, low: BLUE.low, max: BLUE.max,
    prompt: () => G.blueprintPrompt('rates of reaction', LEVEL, 6),
    ok: (r) => { const a = G.parseJsonArray(r); return Array.isArray(a) && a.length > 0; } },

  { name: 'diagnostic: read', model: DIAG.model, low: DIAG.low, max: DIAG.max,
    prompt: () => G.diagnosePrompt('rates of reaction', LEVEL, [
      { rung: 'name', checkpoint: 'names a factor', probe: 'Name one factor that changes the rate.', expect: 'temperature / surface area / concentration', answer: 'temperature' },
      { rung: 'link', checkpoint: 'links cause to effect', probe: 'Why does that change the rate?', expect: 'more collisions, more energy', answer: 'it makes it faster' },
    ]),
    ok: (r) => !!G.rescueObjects(r)[0] },

  { name: 'full paper: question', model: MODEL_SMART, low: PAPER_LOW, max: PAPER_MAX,
    prompt: () => G.paperPrompt('', LEVEL, 'Science 1.1 — chemical reactions', 1, 2, []),
    ok: (r) => { let o = G.rescueObjects(r)[0]; if (!o) o = G.rescueObjects(r.replace(/\\(?!["\\/bfnrtu])/g, ''))[0]; return !!(o && o.parts); } },
];

async function call(c){
  const body = {
    model: c.model,
    messages: [{ role: 'user', content: c.prompt() }],
    temperature: 0.7, top_p: 0.9, max_tokens: c.max, stream: false,
  };
  if (c.low && /gpt-oss/i.test(c.model)) body.reasoning_effort = 'low';
  const t0 = Date.now();
  try {
    const res = await fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const text = await res.text();
    const ms = Date.now() - t0;
    if (!res.ok) return { ms, status: 'HTTP ' + res.status, detail: text.slice(0, 120) };
    const p = JSON.parse(text);
    const reply = p.choices && p.choices[0] && p.choices[0].message && p.choices[0].message.content;
    const finish = p.choices && p.choices[0] && p.choices[0].finish_reason;
    const used = p.usage ? p.usage.completion_tokens : null;
    if (typeof reply !== 'string' || !reply.trim())
      return { ms, status: 'EMPTY', detail: 'finish=' + finish + ' tokens=' + used, used, finish };
    const usable = c.ok(reply);
    return { ms, status: usable ? 'OK' : 'UNUSABLE', detail: usable ? '' : reply.slice(0, 110).replace(/\s+/g, ' '), used, finish };
  } catch (e){
    return { ms: Date.now() - t0, status: 'THREW', detail: String(e && e.message || e) };
  }
}

const only = (() => { const i = process.argv.indexOf('--only'); return i > 0 ? process.argv[i + 1] : null; })();
const repeat = (() => { const i = process.argv.indexOf('--repeat'); return i > 0 ? Number(process.argv[i + 1]) : 1; })();
const run = CHECKS.filter(c => !only || c.name.includes(only));

console.log(`Health check — ${run.length * repeat} calls against ${ENDPOINT}`);
console.log(`text ${MODEL_SMART} · vision ${MODEL_VISION}\n`);
console.log('STATUS      FEATURE                  CEIL   LOW  TOK    TIME');
console.log('─'.repeat(62));

const rows = [];
for (let r = 0; r < repeat; r++){
  for (const c of run){
    const out = await call(c);
    rows.push({ name: c.name, ...out });
    const flag = out.status === 'OK' ? (out.ms > 20000 ? 'OK  SLOW' : 'OK      ') : out.status.padEnd(8);
    console.log(`${flag.padEnd(11)} ${c.name.padEnd(24)} ${String(c.max).padEnd(6)} ${(c.low ? 'yes' : 'no').padEnd(4)} ${String(out.used == null ? '-' : out.used).padEnd(6)} ${(out.ms / 1000).toFixed(1)}s`);
    if (out.detail) console.log(`            ↳ ${out.detail}`);
  }
}

const bad = rows.filter(r => r.status !== 'OK');
const slow = rows.filter(r => r.status === 'OK' && r.ms > 20000);
console.log('\n' + '─'.repeat(62));
console.log(`${rows.length - bad.length}/${rows.length} working` + (bad.length ? `  —  BROKEN: ${[...new Set(bad.map(b => b.name))].join(', ')}` : ''));
if (slow.length) console.log(`over 20s: ${[...new Set(slow.map(s => s.name))].join(', ')}`);
const times = rows.filter(r => r.status === 'OK').map(r => r.ms).sort((a, b) => a - b);
if (times.length) console.log(`median ${(times[Math.floor(times.length / 2)] / 1000).toFixed(1)}s · slowest ${(times[times.length - 1] / 1000).toFixed(1)}s`);
