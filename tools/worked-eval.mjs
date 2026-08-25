/* ============================================================================
   WORKED-PROBLEM EVAL — does the method marker mark the METHOD?

   Marking working is not marking an essay, and the way it goes wrong is
   specific. A calculation carries its mistakes forward: one wrong value in
   step 1 flows into every line after it, and a marker who fails all of them
   turns a single slip into a page of crosses. Real NCEA marking awards those
   later steps on whether the METHOD was right — "error carried forward" — and
   markWorkingPrompt spends a whole paragraph saying so. This measures whether
   the model actually does it.

     node tools/worked-eval.mjs              # every case
     node tools/worked-eval.mjs --case ecf   # one case
     node tools/worked-eval.mjs --repeat 3   # same cases N times (drift check)

   As in tools/mark-eval.mjs, nothing here re-implements the app:
   markWorkingPrompt, firstBadStep and rescueObjects are lifted out of
   StudyFeed.jsx at run time, so this cannot quietly pass a prompt the app no
   longer sends. If a grab fails, the function was renamed and the eval stops.

   What it measures, in order of how much it matters:
     ecf      — after a slip, are the later steps still credited on method
     firstBad — does the FIRST wrong step match the one the case put there
     final    — correct / wrong / missing, against the real answer
     cap      — a bare answer with no working must not go above Achieved
     shape    — replies that did not parse, or came back missing fields
   ========================================================================== */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, '..', 'StudyFeed.jsx'), 'utf8');

/* Both extractors are the ones from mark-eval.mjs. They are duplicated rather
   than shared because a tool that reaches into a sibling tool to read the app
   is one more thing that can break between them and the thing being measured. */
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

/* Every name in the grab list has to be destructured too, or it is fetched and
   then thrown away — the trap mark-eval.mjs documents at length. */
const { markWorkingPrompt, firstBadStep, rescueObjects } =
  grab(['markWorkingPrompt', 'firstBadStep', 'rescueObjects'], ['NCEA_RULES', 'isNcea', 'nceaRules']);

const ENDPOINT = 'https://studyfeed.app/api/nvidia';
const MODEL = (SRC.match(/const MODEL_SMART = '([^']+)'/) || [])[1];
if (!MODEL) throw new Error('grab: MODEL_SMART not found in StudyFeed.jsx');
/* Read the ceiling off the call site, so a change there is picked up here. */
const SRC_MAX = Number((SRC.match(/markWorkingPrompt\(card, working, level\), (\d+)/) || [])[1]);
const MAX_TOKENS = SRC_MAX || 3000;

const GRADES = ['Not yet', 'Achieved', 'Merit', 'Excellence'];
const LEVEL = 'NCEA Level 1';

/* One card, four steps, a unit conversion in step 1 — chosen because the
   conversion is exactly the slip that then contaminates everything after it,
   which is the whole thing being measured. */
const CARD = {
  type: 'worked',
  prompt: 'A trolley of mass 250 g accelerates uniformly from rest to 12.5 m/s in 4.0 s. Calculate the net force acting on it.',
  marks: 4,
  steps: [
    'Convert the mass to kilograms: 250 g = 0.25 kg',
    'Find the acceleration using a = (v - u) / t',
    'Substitute the values: a = (12.5 - 0) / 4.0 = 3.125 m/s^2',
    'Apply F = ma and state the unit',
  ],
  answer: '0.78 N',
  pitfall: 'Leaving the mass in grams — it gives a force 1000 times too big.',
};

const CASES = [
  {
    kind: 'clean',
    note: 'correct method throughout, right answer, units carried',
    working: [
      'm = 250 g = 0.25 kg',
      'a = (v - u) / t',
      'a = (12.5 - 0) / 4.0',
      'a = 3.125 m/s^2',
      'F = ma',
      'F = 0.25 x 3.125',
      'F = 0.78 N',
    ].join('\n'),
    expect: { minGrade: 'Achieved', final: 'correct', firstBad: null, laterStepsOk: [2, 3, 4] },
  },
  {
    kind: 'ecf',
    note: 'THE ONE THAT MATTERS — forgot to convert g to kg, then carried 250 correctly through every later step',
    working: [
      'm = 250 g',
      'a = (v - u) / t',
      'a = (12.5 - 0) / 4.0',
      'a = 3.125 m/s^2',
      'F = ma',
      'F = 250 x 3.125',
      'F = 781.25 N',
    ].join('\n'),
    /* Steps 2-4 are, as method, exactly what the clean answer did. A marker
       who crosses them has punished one slip four times. */
    expect: { final: 'wrong', firstBad: 1, laterStepsOk: [2, 3, 4] },
  },
  {
    kind: 'bare',
    note: 'right answer, no working at all — must not go above Achieved',
    working: 'F = 0.78 N',
    expect: { final: 'correct', maxGrade: 'Achieved' },
  },
  {
    kind: 'wrong-method',
    note: 'right-ish number reached by a method that does not work',
    working: [
      'F = m / a',
      'F = 0.25 / 3.125',
      'F = 0.08',
      'so F = 0.78 N',
    ].join('\n'),
    expect: { maxGrade: 'Not yet' },
  },
];

async function callOnce(prompt){
  const body = {
    model: MODEL,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.7,
    top_p: 0.9,
    max_tokens: MAX_TOKENS,
    stream: false,
  };
  const started = Date.now();
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const ms = Date.now() - started;
  if (!res.ok) return { ok: false, ms, error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
  let payload;
  try { payload = JSON.parse(text); }
  catch { return { ok: false, ms, error: 'response was not JSON' }; }
  const reply = payload && payload.choices && payload.choices[0]
    && payload.choices[0].message && payload.choices[0].message.content;
  if (typeof reply !== 'string') return { ok: false, ms, error: 'no message content' };
  const parsed = rescueObjects(reply)[0];
  const usage = payload.usage || {};
  const finish = payload.choices[0].finish_reason;
  if (!parsed) return { ok: false, ms, finish, usage, error: 'no JSON object in reply', reply: reply.slice(0, 300) };
  return { ok: true, ms, finish, usage, r: parsed };
}

function score(kase, out){
  const row = { case: kase.kind, ms: out.ms };
  if (out.usage) row.tokens = out.usage.completion_tokens;
  if (!out.ok){ row.FAIL = out.error; row.finish = out.finish; return row; }
  const r = out.r;
  const e = kase.expect;

  row.grade = GRADES.includes(r.grade) ? r.grade : `??(${r.grade})`;
  row.final = r.final;

  const steps = Array.isArray(r.steps) ? r.steps : [];
  row.steps = steps.length;
  if (steps.length !== CARD.steps.length) row.shape = `expected ${CARD.steps.length} steps, got ${steps.length}`;

  const bad = firstBadStep(r);
  row.firstBad = bad ? Number(bad.n) : null;

  const problems = [];
  if (e.final && r.final !== e.final) problems.push(`final=${r.final} want ${e.final}`);
  if (e.firstBad !== undefined && row.firstBad !== e.firstBad) problems.push(`firstBad=${row.firstBad} want ${e.firstBad}`);
  if (e.minGrade && GRADES.indexOf(row.grade) < GRADES.indexOf(e.minGrade)) problems.push(`grade ${row.grade} < ${e.minGrade}`);
  if (e.maxGrade && GRADES.indexOf(row.grade) > GRADES.indexOf(e.maxGrade)) problems.push(`grade ${row.grade} > ${e.maxGrade}`);

  /* The headline number. Steps the case says were correct AS METHOD must not
     be marked "no", however wrong the value flowing through them was. */
  if (e.laterStepsOk){
    const crossed = e.laterStepsOk.filter(n => {
      const s = steps.find(x => Number(x.n) === n);
      return s && s.got === 'no';
    });
    row.ecf = crossed.length === 0 ? 'ok' : `CARRIED-FORWARD STEPS FAILED: ${crossed.join(', ')}`;
    if (crossed.length) problems.push(row.ecf);
  }

  /* Anchoring, same rule as the written marking: a quote that is not in the
     working is dropped in the app, so the student sees fewer highlights than
     the feedback refers to. */
  const notes = Array.isArray(r.notes) ? r.notes : [];
  const unanchored = notes.filter(n => n && n.quote && !kase.working.includes(String(n.quote).trim()));
  row.notes = notes.length;
  if (unanchored.length) row.unanchored = unanchored.length + '/' + notes.length;

  row.verdict = problems.length ? 'FAIL' : 'pass';
  if (problems.length) row.why = problems.join(' | ');
  return row;
}

const argCase = process.argv.indexOf('--case');
const only = argCase > 0 ? process.argv[argCase + 1] : null;
const argRep = process.argv.indexOf('--repeat');
const REPEAT = argRep > 0 ? Number(process.argv[argRep + 1]) : 1;

const run = CASES.filter(c => !only || c.kind === only);
if (!run.length) throw new Error(`no case named "${only}"`);

console.log(`Worked-problem eval — ${run.length * REPEAT} calls against ${ENDPOINT}`);
console.log(`model ${MODEL}, ceiling ${MAX_TOKENS}\n`);

const rows = [];
for (let rep = 0; rep < REPEAT; rep++){
  for (const kase of run){
    const prompt = markWorkingPrompt(CARD, kase.working, LEVEL);
    const out = await callOnce(prompt);
    const row = score(kase, out);
    rows.push(row);
    console.log(`${row.verdict === 'pass' ? 'PASS' : row.FAIL ? 'ERR ' : 'FAIL'}  ${kase.kind.padEnd(13)} grade=${String(row.grade).padEnd(11)} final=${String(row.final).padEnd(8)} firstBad=${String(row.firstBad).padEnd(5)} ${row.ms}ms`);
    if (row.why) console.log(`      ${row.why}`);
    if (row.FAIL) console.log(`      ${row.FAIL}`);
    if (row.shape) console.log(`      shape: ${row.shape}`);
    if (row.unanchored) console.log(`      unanchored notes: ${row.unanchored}`);
  }
}

const passed = rows.filter(r => r.verdict === 'pass').length;
console.log(`\n${passed}/${rows.length} passed`);
const ecfRows = rows.filter(r => r.ecf);
if (ecfRows.length){
  const ecfOk = ecfRows.filter(r => r.ecf === 'ok').length;
  console.log(`error carried forward respected: ${ecfOk}/${ecfRows.length}`);
}
console.log(JSON.stringify(rows, null, 2));
