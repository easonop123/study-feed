/* ============================================================================
   FULL PAPER EVAL — is the generated paper actually exam-shaped, and does it
   keep its mouth shut about standards?

   Two things can go wrong here and only one of them is obvious.

   The obvious one: the paper is not a paper. Parts that do not climb, marks
   that do not go up, a context that is decoration, three questions that are
   really three flashcards. That is a quality problem.

   The other one is the reason this file exists. This feature was asked for as
   "past NCEA papers", and the single most damaging thing it could do is sound
   like one — cite AS91166, state what "the standard requires", claim a credit
   count. NCEA_RULES bars all of that because the model's memory of NCEA is out
   of date (Level 1 was rebuilt for 2024), and a student who revises against an
   invented standard is worse off than one who never opened the app. Every
   generated paper is scanned for it here.

     node tools/paper-eval.mjs              # 3 papers
     node tools/paper-eval.mjs --n 6        # more
   ========================================================================== */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, '..', 'StudyFeed.jsx'), 'utf8');

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

const { paperPrompt, partsFromJson, rescueObjects } =
  grab(['paperPrompt', 'partsFromJson', 'rescueObjects'],
       ['COMMAND_VERBS', 'NCEA_RULES', 'isNcea', 'nceaRules']);

const ENDPOINT = 'https://studyfeed.app/api/nvidia';
const MODEL = (SRC.match(/const MODEL_SMART = '([^']+)'/) || [])[1];
if (!MODEL) throw new Error('grab: MODEL_SMART not found in StudyFeed.jsx');
const MAX_TOKENS = Number((SRC.match(/const PAPER_MAX_TOKENS = (\d+)/) || [])[1]) || 2000;

const LEVEL = 'NCEA Level 1';
/* Deliberately a REAL-sounding standard name in the student's own words. The
   temptation to "helpfully" expand it into a code is exactly what is measured. */
const STANDARD = 'Science 1.1 — chemical reactions';

const SOURCE = [
  'Rate of reaction — how fast reactants are used up or products are made.',
  'Collision theory — particles must collide with enough energy and the correct orientation to react.',
  'Temperature — higher temperature gives particles more kinetic energy, so collisions are more frequent AND a greater fraction exceed the activation energy.',
  'Surface area — breaking a solid into smaller pieces exposes more particles, so there are more collisions per second.',
  'Concentration — more particles in the same volume means more frequent collisions.',
  'Catalyst — provides an alternative pathway with a lower activation energy; not consumed.',
  'Activation energy — the minimum energy a collision needs for a reaction to happen.',
  'Magnesium and hydrochloric acid produce hydrogen gas; the rate can be followed by measuring gas volume against time.',
  'A rate graph is steepest at the start and levels off as a reactant runs out.',
].join('\n');

/* Anything that looks like a standard citation, or a claim about what NZQA
   wants. The same shape of check tools/mark-eval.mjs runs on marking. */
const LEAKS = [
  { name: 'standard number', rx: /\bAS\s?9\d{4}\b|\b9[01238]\d{3}\b/i },
  { name: 'credits claim', rx: /\b\d+\s*credits?\b/i },
  { name: 'internal/external', rx: /\b(internally|externally)\s+assessed\b/i },
  { name: 'speaks for NZQA', rx: /\bNZQA\b|the standard (requires|says|states)|marking schedule/i },
  /* The line that moved. The paper is now deliberately written FROM subject
     knowledge, in the style the standard is really examined — that is the
     point of it. What it must still never do is attach that to a particular
     paper: a cited year is a confabulation a student would revise against. */
  { name: 'cites a real paper', rx: /past paper|previous exam|in the (19|20)[0-9]{2} (exam|paper|session)|(19|20)[0-9]{2} (exam|paper) question|came up in|appeared in the/i },
];

async function callOnce(prompt){
  const started = Date.now();
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7, top_p: 0.9, max_tokens: MAX_TOKENS, stream: false,
      /* buildPaper passes lowEffort:true, so postChat sets this. Without it
         this file measures a request the app does not send — and on gpt-oss
         reasoning comes out of the SAME token budget as the JSON, so the
         difference is not cosmetic: it is the difference between finishing
         inside the proxy's 55s ceiling and not. */
      reasoning_effort: 'low',
    }),
  });
  const text = await res.text();
  const ms = Date.now() - started;
  if (!res.ok) return { ok: false, ms, error: `HTTP ${res.status}: ${text.slice(0, 160)}` };
  let payload;
  try { payload = JSON.parse(text); } catch { return { ok: false, ms, error: 'not JSON' }; }
  const reply = payload && payload.choices && payload.choices[0]
    && payload.choices[0].message && payload.choices[0].message.content;
  if (typeof reply !== 'string') return { ok: false, ms, error: 'no content' };
  let obj = rescueObjects(reply)[0];
  /* buildPaper retries the parse with invalid JSON escapes stripped, so this
     must too — otherwise it reports failures a student would never see. */
  if (!obj) obj = rescueObjects(reply.replace(/\\(?!["\\/bfnrtu])/g, ''))[0];
  if (!obj) return { ok: false, ms, error: 'no JSON object', finish: payload.choices[0].finish_reason };
  return { ok: true, ms, obj, raw: reply, usage: payload.usage || {} };
}

function score(out, n){
  const row = { q: n, ms: out.ms };
  if (!out.ok){ row.FAIL = out.error; return row; }
  row.tokens = out.usage.completion_tokens;
  const obj = out.obj;
  const parts = partsFromJson(obj);
  const problems = [];

  row.context = String(obj.context || '').trim().length;
  if (row.context < 40) problems.push('context too thin to work from');

  row.parts = parts.length;
  if (parts.length < 2) problems.push(`only ${parts.length} part(s)`);

  /* Marks must climb. The last part carries the most because it is the one
     asking them to apply and justify — if it does not, the parts are not a
     ladder, they are three questions in a trenchcoat. */
  const marks = parts.map(p => p.marks);
  row.marks = marks.join('/');
  if (parts.length >= 2 && marks[marks.length - 1] <= marks[0]) problems.push(`marks do not climb (${row.marks})`);

  /* The last part has to be doing more than the first. Not a strict verb
     ordering — "Explain" then "Evaluate" and "Describe" then "Justify" are
     both fine — but the top part should not be the bottom verb. */
  row.verbs = parts.map(p => p.verb).join(' → ');
  const LOW = ['Describe'];
  if (parts.length >= 2 && LOW.includes(parts[parts.length - 1].verb)) problems.push(`last part is "${parts[parts.length - 1].verb}"`);

  /* Every part needs all three rungs, or it gets marked against a criterion
     that is not there. */
  const missing = parts.filter(p => !p.achieved || !p.merit || !p.excellence).length;
  if (missing) problems.push(`${missing} part(s) missing a rung descriptor`);

  /* THE ONE THAT MATTERS. */
  const blob = JSON.stringify(obj);
  const leaked = LEAKS.filter(l => l.rx.test(blob));
  row.leaks = leaked.length ? leaked.map(l => l.name).join(', ') : 'none';
  if (leaked.length) problems.push('NCEA LEAK: ' + row.leaks);

  row.verdict = problems.length ? 'FAIL' : 'pass';
  if (problems.length) row.why = problems.join(' | ');
  return row;
}


/* ---- subject fidelity ----------------------------------------------------
   The check that was missing, and the reason a maths standard came back as a
   science paper. Everything above tested ONE standard, phrased helpfully, so
   "does the paper match the subject you asked for" was never actually asked.

   Two ways it goes wrong and both are here. A standard named in words should
   produce that subject. A standard given as a bare CODE should produce nothing
   at all — the app blocks it in the UI, because the model cannot be allowed to
   infer a subject from a number it does not reliably know. If the model starts
   confidently writing chemistry for "91947", that is the bug returning.

     node tools/paper-eval.mjs --fidelity
   -------------------------------------------------------------------------- */
const SUBJECTS = [
  { standard: 'Maths 1.4 — algebra',
    want:  /equation|expression|solve|simplif|factoris|expand|substitut|gradient|graph|formula|algebra/i,
    avoid: /reaction rate|magnesium|hydrochloric|photosynthes|enzyme|catalyst|ecosystem|titration/i },
  { standard: 'Science 1.1 — chemical reactions',
    want:  /reaction|particle|collision|acid|catalyst|rate/i,
    avoid: /quadratic|factoris|simplify the expression|solve for x/i },
  { standard: 'History 1.2 — a historical event',
    want:  /source|evidence|historian|event|cause|consequence|perspective|account/i,
    avoid: /reaction rate|magnesium|quadratic|photosynthes/i },
];

async function fidelity(){
  console.log(`Subject fidelity — ${SUBJECTS.length} standards against ${ENDPOINT}\n`);
  let ok = 0;
  for (const sub of SUBJECTS){
    const out = await callOnce(paperPrompt('', LEVEL, sub.standard, 1, 1, []));
    if (!out.ok){
      console.log(`ERR   ${sub.standard.padEnd(34)} ${out.error}`);
      continue;
    }
    const blob = JSON.stringify(out.obj);
    const hit = sub.want.test(blob);
    const stray = sub.avoid.test(blob);
    const pass = hit && !stray;
    if (pass) ok++;
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${sub.standard.padEnd(34)} onSubject=${hit} strayed=${stray}  ${out.ms}ms`);
    if (!pass) console.log(`      context: ${String(out.obj.context || '').slice(0, 150)}`);
  }
  console.log(`\n${ok}/${SUBJECTS.length} papers were about the subject asked for`);
}

if (process.argv.indexOf('--fidelity') > 0){
  await fidelity();
  process.exit(0);
}

const argN = process.argv.indexOf('--n');
const N = argN > 0 ? Number(process.argv[argN + 1]) : 3;
/* The deck is optional now, so both ways in get measured. --nodeck is the
   path a student takes when they have not made cards for the standard yet,
   and it is the one with nothing to fall back on if the model's subject
   knowledge is thin — so it matters more, not less. */
const NO_DECK = process.argv.indexOf('--nodeck') > 0;

console.log(`Paper eval — ${N} questions against ${ENDPOINT}`);
console.log(`model ${MODEL}, ceiling ${MAX_TOKENS}, standard "${STANDARD}", deck: ${NO_DECK ? 'NONE' : 'yes'}\n`);

const rows = [];
const already = [];
for (let i = 1; i <= N; i++){
  const out = await callOnce(paperPrompt(NO_DECK ? '' : SOURCE, LEVEL, STANDARD, i, N, already));
  const row = score(out, i);
  rows.push(row);
  console.log(`${row.verdict === 'pass' ? 'PASS' : row.FAIL ? 'ERR ' : 'FAIL'}  Q${i}  parts=${row.parts} marks=${row.marks} leaks=${row.leaks}  ${row.ms}ms`);
  if (row.verbs) console.log(`      ${row.verbs}`);
  if (row.why) console.log(`      ${row.why}`);
  if (row.FAIL) console.log(`      ${row.FAIL}`);
  if (out.ok && out.obj.context) already.push(String(out.obj.context).slice(0, 120));
}

const passed = rows.filter(r => r.verdict === 'pass').length;
const leaks = rows.filter(r => r.leaks && r.leaks !== 'none').length;
console.log(`\n${passed}/${rows.length} passed`);
console.log(`NCEA leaks: ${leaks}/${rows.length}${leaks ? '  <-- FIX BEFORE SHIPPING' : ''}`);
