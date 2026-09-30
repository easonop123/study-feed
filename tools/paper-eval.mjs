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

     node tools/paper-eval.mjs              # 3 papers: shape + standards leaks
     node tools/paper-eval.mjs --n 6        # more
     node tools/paper-eval.mjs --dedup      # the repeated-setup guard, offline
     node tools/paper-eval.mjs --relevance  # is it about what they are studying
     node tools/paper-eval.mjs --fidelity   # right subject, and asks a calculation

   --dedup is the only one that costs nothing and cannot fail on a busy
   endpoint, so it is the one to run on every change.
   ========================================================================== */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { modelNamed, modelFromArgs, checkerDeadlineMs } from './app-source.mjs';

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

const { paperPrompt, partsFromJson, rescueObjects, parseJsonArray,
        blueprintPaperPrompt, cleanPaperPlan, CALC_VERBS } =
  grab(['paperPrompt', 'partsFromJson', 'rescueObjects', 'parseJsonArray',
        'blueprintPaperPrompt', 'cleanPaperPlan'],
       ['COMMAND_VERBS', 'CALC_VERBS', 'PAPER_VERBS', 'NCEA_RULES', 'isNcea', 'nceaRules']);

/* The app's own request builder, so every model is sent exactly what the app
   sends it. This file used to write the body itself and put
   reasoning_effort:'low' on EVERY model — the app sends that to gpt-oss only
   (takesReasoningEffort), and the current head is gemma-4 — while leaving out
   nemotron's thinking:false. So on the chain's own models it measured a request
   the app never makes. */
const { bodyFor } = grab(['bodyFor'], ['isReasoner', 'takesReasoningEffort']);

const { sameSetup, paperSource, weakSpots, paperToSource } =
  grab(['setupWords', 'sameSetup', 'cardQA', 'paperSource', 'weakSpots',
        'paperLosses', 'paperToSource'], ['SETUP_NOISE', 'GRADES']);

const ENDPOINT = process.env.SF_ENDPOINT || 'https://studyfeed.app/api/nvidia';
/* `--model <id>` to point the whole run at a candidate — see modelFromArgs. */
const MODEL = modelFromArgs(SRC, process.argv);
if (!MODEL) throw new Error('grab: MODEL_SMART not found in StudyFeed.jsx');
const MAX_TOKENS = Number((SRC.match(/const PAPER_MAX_TOKENS = (\d+)/) || [])[1]) || 2000;
const PLAN_TOKENS = Number((SRC.match(/const PLAN_MAX_TOKENS = (\d+)/) || [])[1]) || 700;

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

/* Wrapped, and given a deadline of its own.

   Without this the whole file dies partway through a run: undici gives up on
   a stalled HTTP/2 stream after five minutes and throws `HeadersTimeoutError`
   out of `fetch`, which nothing caught — so one hung request took the
   remaining subjects down with it and printed a stack trace where the results
   should have been. A checker that cannot survive a slow endpoint reports
   nothing on exactly the evenings worth measuring. The proxy's own ceiling is
   about 55s, so anything still open at 90 is never arriving. */
/* Derived from the proxy's own budget rather than written down: it has to sit
   comfortably PAST the point where the proxy gives up and returns its 504, or
   this starts reporting a timeout for an answer that was about to arrive. That
   number moved from 55s to 85s on 18 Sep 2026 and three files had it hardcoded
   at 90000 with a comment explaining why 90 was safely past 55. */
const CALL_TIMEOUT_MS = checkerDeadlineMs(readFileSync(join(HERE, '..', 'api', 'nvidia.js'), 'utf8'));

async function callOnce(prompt, cap){
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CALL_TIMEOUT_MS);
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      /* buildPaper and planPaper pass lowEffort:true; bodyFor turns that into
         reasoning_effort:'low' for the model families that take it (gpt-oss),
         and nothing for the ones that do not. On gpt-oss reasoning comes out of
         the SAME token budget as the JSON, so this is the difference between
         finishing inside the proxy's ceiling and not. */
      body: JSON.stringify(bodyFor(MODEL, [{ role: 'user', content: prompt }], cap || MAX_TOKENS, true)),
      signal: ctrl.signal,
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
  } catch (e){
    const ms = Date.now() - started;
    return { ok: false, ms, error: (e && e.name === 'AbortError')
      ? `no reply within ${CALL_TIMEOUT_MS / 1000}s`
      : `${e && e.name}: ${e && e.message}` };
  } finally { clearTimeout(timer); }
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


/* ---- the repeated-setup guard, offline ------------------------------------
   Costs no API call, so it can run on every change. It is the one part of
   relevance that is settled in code rather than asked of the model, and it is
   settled in code precisely because asking did not work: told to vary the
   situations, two plans in three still put all three questions on the same
   reaction, at 0.56 distinct setups per question.

   What is being tested is a judgement call about wording, so the cases are
   the wordings that actually came back from the model. The interesting half
   is the FALSE cases: a guard that is too eager bans a good second question,
   which is a worse failure than the repeat it was written to stop, because
   the student never sees what they lost.

     node tools/paper-eval.mjs --dedup
   -------------------------------------------------------------------------- */
const DEDUP_CASES = [
  /* Same experiment, phrased differently — must be caught. */
  ['magnesium and hydrochloric acid', 'magnesium ribbon and dilute hydrochloric acid', true,  'Mg + HCl phrased two ways'],
  ['magnesium ribbon', 'powdered magnesium', true,  'same metal, different form'],
  ['marble chips and acid', 'calcium carbonate chips with hydrochloric acid', true,  'marble IS calcium carbonate'],
  ['hydrogen peroxide and manganese dioxide', 'hydrogen peroxide with catalase', true,  'same decomposition'],
  /* Genuinely different — must NOT be caught. The acid is shared by nearly
     every rates experiment there is, so it must never be what makes two
     situations look alike. */
  ['magnesium and hydrochloric acid', 'sodium thiosulfate and hydrochloric acid', false, 'different reactants, shared solvent'],
  ['a trolley on a ramp', 'a cart on an incline', false, 'different words for a similar idea'],
  ['magnesium and hydrochloric acid', 'a settler\'s diary', false, 'nothing in common'],
  /* Nothing to compare is not a repeat. */
  ['', '', false, 'both empty'],
  ['magnesium', '', false, 'one empty'],
];

function dedupCheck(){
  console.log('Repeated-setup guard — offline, no API calls\n');
  let pass = 0;
  for (const [a, b, want, label] of DEDUP_CASES){
    const got = sameSetup(a, b);
    const ok = got === want;
    if (ok) pass++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${label.padEnd(38)} same=${got} (want ${want})`);
  }
  console.log(`\n${pass}/${DEDUP_CASES.length} passed`);
  return pass === DEDUP_CASES.length;
}

/* ---- what the paper is told about the deck, offline -----------------------
   Both of these were bugs of omission rather than of wording, and both are
   pure functions, so they can be pinned down for nothing.

   paperSource used to walk the cards in storage order and stop at a cap, so a
   long deck only ever steered the paper with the cards made first — someone
   who makes cards in the order they are taught got a paper on term one, every
   time, for the whole year. It must now reach the end of a long deck.

   weakSpots is the signal the app had all along and never passed on. What
   matters is the ORDER: flagged means "you were sure and you were wrong",
   which is a sharper thing to practise than a card merely found difficult. */
function deckCheck(){
  let pass = 0, total = 0;
  const say = (ok, label, detail) => {
    total++; if (ok) pass++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? '  ' + detail : ''}`);
  };

  console.log('\nDeck reading — offline\n');

  /* A deck far longer than the cap, numbered so position is visible. */
  const big = { cards: [] };
  for (let i = 1; i <= 300; i++){
    big.cards.push({ id: 'c' + i, type: 'flip', front: 'Question number ' + i + ' about topic ' + i, back: 'Answer ' + i });
  }
  const src = paperSource(big);
  const nums = (src.match(/number (\d+)/g) || []).map(s => Number(s.slice(7)));
  say(nums.length > 0, 'a long deck produces something', `${nums.length} cards`);
  say(Math.max.apply(null, nums) > 200, 'it reaches the END of a long deck',
    `highest card #${Math.max.apply(null, nums)} of 300`);
  say(Math.min.apply(null, nums) < 20, 'and still starts at the beginning',
    `lowest card #${Math.min.apply(null, nums)}`);
  say(src.indexOf('Answer ') < 0, 'the ANSWER side is never sent',
    'the paper must make the student produce it');

  /* A short deck must be untouched — striding is for long ones. */
  const small = { cards: [] };
  for (let i = 1; i <= 8; i++) small.cards.push({ id: 's' + i, type: 'flip', front: 'Short q ' + i, back: 'a' });
  const smallSrc = paperSource(small);
  say((smallSrc.match(/Short q/g) || []).length === 8, 'a short deck is not thinned', '8 of 8');

  console.log('\nWeak spots — offline\n');
  const deck = { cards: [
    { id: 'a', type: 'flip', front: 'Never seen', back: 'x' },
    { id: 'b', type: 'flip', front: 'Seen and fine', back: 'x' },
    { id: 'c', type: 'flip', front: 'Lapsed twice', back: 'x' },
    { id: 'd', type: 'flip', front: 'Confidently wrong', back: 'x' },
  ] };
  const progress = {
    b: { seen: true, lapses: 0, ease: 2.5 },
    c: { seen: true, lapses: 2, ease: 2.4 },
    d: { seen: true, lapses: 0, ease: 2.4, flagged: true },
  };
  const weak = weakSpots(deck, progress);
  say(weak.indexOf('Never seen') < 0, 'a card never reviewed is not a weak spot');
  say(weak.indexOf('Seen and fine') < 0, 'a card answered correctly is not a weak spot');
  say(weak.indexOf('Lapsed twice') >= 0, 'a lapsed card is');
  say(weak.indexOf('Confidently wrong') >= 0, 'and so is a flagged one');
  say(weak.indexOf('Confidently wrong') < weak.indexOf('Lapsed twice'),
    'FLAGGED outranks lapses', 'being sure and wrong is the sharper signal');
  say(weakSpots(deck, null) === '', 'no progress yields nothing rather than throwing');
  say(weakSpots(null, progress) === '', 'no deck yields nothing rather than throwing');

  /* ---- what a bad paper turns into ------------------------------------
     The report's one forward action. It has to name the topic, the question,
     the rung ABOVE the one reached, and what the marker said was missing —
     a card built from the Achieved descriptor for a part already at Achieved
     teaches the student nothing they did not just demonstrate. */
  console.log('\nPaper into cards — offline\n');
  const paper = { questions: [
    { n: 1, focus: 'effect of temperature on rate', context: 'ctx',
      parts: [{ label: 'a', verb: 'Describe', prompt: 'Describe what happens to the rate.', marks: 2,
                achieved: 'says the rate increases', merit: 'links it to collisions', excellence: 'justifies with activation energy' },
              { label: 'b', verb: 'Explain', prompt: 'Explain why.', marks: 5,
                achieved: 'states the cause', merit: 'explains the mechanism', excellence: 'applies it to this context' }] },
  ] };
  const results = [
    { key: '1a', q: 1, label: 'a', marks: 2, blank: false, grade: 'Merit', r: { lift: 'Name the activation energy.' } },
    { key: '1b', q: 1, label: 'b', marks: 5, blank: false, grade: 'Achieved', r: { lift: 'Link the temperature to the collisions.' } },
  ];
  const notes = paperToSource(paper, results, 'Merit');
  say(notes.indexOf('Explain why.') >= 0, 'the part that cost marks is in the notes');
  /* Case-insensitive: the topic opens a bullet, so it is capitalised there. */
  say(notes.toLowerCase().indexOf('effect of temperature on rate') >= 0,
    'and it is named by its topic');
  say(notes.indexOf('explains the mechanism') >= 0, 'it teaches the rung ABOVE the one reached',
    'Achieved part gets the Merit descriptor');
  say(notes.indexOf('states the cause') < 0, 'not the rung already reached');
  say(notes.indexOf('Link the temperature') >= 0, "the marker's line on what was missing is kept");
  say(notes.indexOf('Describe what happens') < 0, 'a part at the headline grade is left out');

  /* A paper where nothing was below the headline still has to produce
     something, or the button hands back an empty page. */
  const allTop = paperToSource(paper,
    [{ key: '1a', q: 1, label: 'a', marks: 2, blank: false, grade: 'Achieved', r: null }], 'Not yet');
  say(allTop.indexOf('Describe what happens') >= 0,
    'a Not-yet paper still yields notes', 'nothing is "below" Not yet');

  const blank = paperToSource(paper,
    [{ key: '1b', q: 1, label: 'b', marks: 5, blank: true, grade: 'Not yet', r: null }], 'Achieved');
  say(blank.indexOf('not attempted') >= 0, 'a blank part says it was not attempted');
  say(blank.indexOf('states the cause') >= 0, 'and is taught from Achieved up');

  console.log(`\n${pass}/${total} passed`);
  return pass === total;
}

if (process.argv.indexOf('--dedup') > 0){
  const a = dedupCheck();
  const b = deckCheck();
  process.exit(a && b ? 0 : 1);
}

/* ---- relevance ------------------------------------------------------------
   THE COMPLAINT THIS FILE COULD NOT SEE. Everything above asks whether the
   paper is exam-SHAPED and whether it keeps quiet about standards. Both can
   pass while the paper is still not worth sitting, because neither asks the
   question a student actually asks: is this about the thing I am studying?

   Three questions on a subject can all be defensibly on-topic and still miss
   the course. That was the old failure mode and it was structural: questions
   were written one at a time, and the only force holding them apart was a list
   of contexts already used plus "pick a DIFFERENT idea". Told what to avoid
   and never what to cover, the model walks away from the middle of a subject.

   So relevance is measured as two numbers, not one:

     ON-MATERIAL   what fraction of questions touch an idea the student is
                   demonstrably studying. A question that touches none of them
                   is the drift being complained about.
     COVERAGE      how many DISTINCT core ideas the paper reaches. Three
                   questions on temperature score well on-material and are
                   still a bad paper — this is the number that catches it.

     node tools/paper-eval.mjs --relevance
     node tools/paper-eval.mjs --relevance --unplanned   # the old behaviour
   -------------------------------------------------------------------------- */

/* The ideas a rates-of-reaction course is built on, each with the wordings a
   question could legitimately use. Deliberately generous — the test is
   whether the paper is ABOUT the idea, not whether it picked our phrasing. */
const CONCEPTS = [
  { name: 'temperature',       rx: /temperatur|heat(ed|ing)?\b|kinetic energy|degrees|\bhotter|colder/i },
  { name: 'surface area',      rx: /surface area|powder|lump|granul|crush|grind|particle size|chip/i },
  { name: 'concentration',     rx: /concentrat|\bmol\/|\bmolar|dilut|per litre/i },
  { name: 'catalyst',          rx: /catalyst|catalys/i },
  { name: 'activation energy', rx: /activation energy/i },
  { name: 'collision theory',  rx: /collision|collide|orientation/i },
  { name: 'following a rate',  rx: /gas volume|volume of (gas|hydrogen)|mass loss|rate graph|steepest|levels? off|against time|cm3|cm\^3/i },
];

function conceptsIn(text){
  return CONCEPTS.filter(c => c.rx.test(text)).map(c => c.name);
}

/* THE STOCK-EXAMPLE TRAP, which the concept counts above cannot see.

   Measured on this feature: four questions in five were built on magnesium
   and hydrochloric acid. Every one of them scored full marks on "is it about
   the material" — of course they did, that reaction IS the material — and
   the paper was still three rehearsals of one situation. A student who sits
   it has practised the same setup three times, which is precisely what an
   exam does not do to them.

   So the sharpest available relevance number is not about topic at all: it
   is how many DIFFERENT situations the paper puts in front of them. Named
   here as the specific substances and apparatus a rates paper can be built
   on, because a generic noun extractor cannot tell "magnesium" from "student". */
const SETUPS = [
  { name: 'Mg + acid',        rx: /magnesium|\bMg\b/i },
  { name: 'marble/carbonate', rx: /marble|calcium carbonate|CaCO3|limestone/i },
  { name: 'thiosulfate',      rx: /thiosulfate|thiosulphate|sulfur cloud|cross disappear/i },
  { name: 'peroxide',         rx: /hydrogen peroxide|H2O2|manganese dioxide|MnO2|catalase/i },
  { name: 'zinc',             rx: /\bzinc\b|\bZn\b/i },
  { name: 'iron/copper',      rx: /iron\b|\bFe\b|copper|\bCu\b/i },
  { name: 'enzyme',           rx: /enzyme|amylase|yeast|ferment/i },
  { name: 'rusting',          rx: /rust|corrod/i },
];
const setupsIn = (t) => SETUPS.filter(s => s.rx.test(t)).map(s => s.name);

/* One paper, end to end, the way buildPaper does it — plan, then a question
   per plan entry. --unplanned skips the plan and falls back to the exclusion
   list, which is what the paper did before, so the two can be compared. */
async function onePaper(source, standard, n, planned){
  let plan = [];
  if (planned){
    const out = await callOnce(
      blueprintPaperPrompt(source, '', LEVEL, standard, '', n), PLAN_TOKENS);
    if (out.ok) plan = cleanPaperPlan(parseJsonArray(out.raw), n);
  }
  const qs = [];
  const already = [];
  for (let i = 0; i < n; i++){
    const p = planned ? (plan[i] || null) : null;
    const out = await callOnce(
      paperPrompt(source, LEVEL, standard, i + 1, n, already, p, ''), MAX_TOKENS);
    if (!out.ok){ qs.push(null); continue; }
    const parts = partsFromJson(out.obj);
    /* THE STEM ONLY — the context and the questions asked. Scoring the whole
       JSON object measures the MARK SCHEME, and an achieved/merit/excellence
       descriptor for any rates question legitimately names every factor in
       the topic: every question then scored six of seven concepts and the
       metric could not tell a good paper from a bad one. What decides whether
       a paper is about the student's course is what they are asked. */
    const stem = [String(out.obj.context || '')].concat(parts.map(x => x.prompt)).join(' ');
    qs.push({ context: String(out.obj.context || ''), parts: parts,
      text: stem, setups: setupsIn(stem), focus: p ? p.focus : '' });
    const c = String(out.obj.context || '').trim();
    already.push(c.slice(0, 120) || (parts.length ? parts[0].prompt.slice(0, 120) : ''));
  }
  return { plan: plan, questions: qs };
}

/* Mean pairwise overlap of the questions' concept sets — the number that
   catches three perfectly on-topic questions that are all the same
   experiment, which is what "not relevant enough" usually turns out to mean
   in practice. 0 is three separate ideas; 1 is one idea in three costumes. */
function meanOverlap(hits){
  let pairs = 0, sum = 0;
  for (let a = 0; a < hits.length; a++){
    for (let b = a + 1; b < hits.length; b++){
      const A = new Set(hits[a]), B = new Set(hits[b]);
      const inter = Array.from(A).filter(x => B.has(x)).length;
      const uni = new Set(Array.from(A).concat(Array.from(B))).size;
      if (uni){ sum += inter / uni; pairs++; }
    }
  }
  return pairs ? sum / pairs : 0;
}

function relevanceScore(paper){
  const live = paper.questions.filter(Boolean);
  const hits = live.map(q => conceptsIn(q.text));
  const union = new Set();
  for (const h of hits) for (const c of h) union.add(c);
  /* How many distinct situations the paper puts in front of the student.
     Counted as distinct SIGNATURES, one per question, rather than as the
     union of the families matched — a context naming iron(III) chloride and
     sodium thiosulfate matches two families and is still one situation, and
     summing families let a three-question paper score 4 out of 3. A question
     whose setup we do not recognise gets a signature of its own, so an
     unusual context is never punished for being unusual. */
  const setups = new Set();
  let unknown = 0;
  for (const q of live){
    if (!q.setups.length){ unknown++; continue; }
    setups.add(q.setups.slice().sort().join('+'));
  }
  return {
    got: live.length,
    onMaterial: hits.filter(h => h.length > 0).length,
    coverage: union.size,
    overlap: meanOverlap(hits),
    situations: setups.size + unknown,
    per: live.map((q, i) => ({ focus: q.focus, hit: hits[i], setup: q.setups })),
  };
}

async function relevance(){
  const argR = process.argv.indexOf('--papers');
  const RUNS = argR > 0 ? Number(process.argv[argR + 1]) : 2;
  const PLANNED = process.argv.indexOf('--unplanned') < 0;
  const N = 3;
  console.log(`Relevance — ${RUNS} paper(s) of ${N} questions against ${ENDPOINT}`);
  console.log(`standard "${STANDARD}", ${PLANNED ? 'PLANNED (current)' : 'UNPLANNED (the old path)'}\n`);

  let onMat = 0, live = 0, cov = 0, ovSum = 0, ovN = 0, sitSum = 0;
  for (let r = 0; r < RUNS; r++){
    const paper = await onePaper(SOURCE, STANDARD, N, PLANNED);
    const s = relevanceScore(paper);
    live += s.got; onMat += s.onMaterial; cov += s.coverage;
    if (s.got > 1){ ovSum += s.overlap; ovN++; }
    sitSum += s.got ? s.situations / s.got : 0;
    console.log(`Paper ${r + 1} — ${s.onMaterial}/${s.got} on material, ${s.coverage} distinct ideas, overlap ${s.overlap.toFixed(2)}, ${s.situations} situation(s) for ${s.got} question(s)`);
    if (PLANNED){
      if (paper.plan.length) console.log(`  planned: ${paper.plan.map(p => p.focus).join(' | ')}`);
      else console.log('  planned: (the planning call failed — unplanned fallback)');
    }
    for (const q of s.per){
      const tag = q.hit.length ? q.hit.join(', ') : '*** NOTHING FROM THE MATERIAL ***';
      console.log(`   - ${(q.focus || '(unplanned)').slice(0, 40).padEnd(42)} [${q.setup.join('+') || 'other'}] ${tag}`);
    }
    console.log('');
  }
  console.log(`On material: ${onMat}/${live} questions (${live ? Math.round(onMat / live * 100) : 0}%)`);
  console.log(`Coverage:    ${(cov / Math.max(1, RUNS)).toFixed(1)} distinct ideas per ${N}-question paper (max ${CONCEPTS.length})`);
  console.log(`Overlap:     ${(ovN ? ovSum / ovN : 0).toFixed(2)} between questions on one paper (lower is better)`);
  console.log(`Situations:  ${(sitSum / Math.max(1, RUNS)).toFixed(2)} distinct setups per question (1.00 = never repeats itself)`);
}

if (process.argv.indexOf('--relevance') > 0){
  await relevance();
  process.exit(0);
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
  /* `calc: true` means a real paper in this subject puts numbers in front of
     the student, so at least one part must ASK for a calculation. Until the
     paper got its own verb list it could only pick from seven ways of asking
     for prose, and a maths paper came back as three essays — on subject,
     correctly shaped, and the wrong paper. Nothing here could see it. */
  { standard: 'Maths 1.4 — algebra', calc: true,
    want:  /equation|expression|solve|simplif|factoris|expand|substitut|gradient|graph|formula|algebra/i,
    avoid: /reaction rate|magnesium|hydrochloric|photosynthes|enzyme|catalyst|ecosystem|titration/i },
  { standard: 'Science 1.1 — chemical reactions', calc: false,
    want:  /reaction|particle|collision|acid|catalyst|rate/i,
    avoid: /quadratic|factoris|simplify the expression|solve for x/i },
  { standard: 'Physics 1.2 — mechanics', calc: true,
    want:  /force|acceleration|velocity|mass|momentum|energy|newton|friction/i,
    avoid: /factoris the expression|historian|photosynthes/i },
  { standard: 'History 1.2 — a historical event', calc: false,
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
    const verbs = partsFromJson(out.obj).map(p => p.verb);
    const asksCalc = verbs.some(v => CALC_VERBS.indexOf(v) >= 0);
    const calcOk = sub.calc ? asksCalc : true;
    const pass = hit && !stray && calcOk;
    if (pass) ok++;
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${sub.standard.padEnd(34)} onSubject=${hit} strayed=${stray}` +
      (sub.calc ? ` asksCalculation=${asksCalc}` : '') + `  ${out.ms}ms`);
    console.log(`      verbs: ${verbs.join(' -> ')}`);
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
