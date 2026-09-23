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

   THE THREE VISION FEATURES ARE CHECKED TOO. They were the gap: this file
   printed the vision model's name in its header and then never called it, so a
   retired model id would have broken photo answers, photo working and slide
   reading with nothing here noticing — and those are the three a student cannot
   route around by typing instead. The page they read is drawn by
   `tools/test-image.mjs`, since the repo cannot rasterise a font and a photo of
   real schoolwork is not ours to commit.
   ========================================================================== */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { modelNamed, numberNamed, checkerDeadlineMs } from './app-source.mjs';
import { imageOfText } from './test-image.mjs';
/* Static, not `await import` further down, purely so Node's
   MODULE_TYPELESS_PACKAGE_JSON warning about starter-decks.js lands before the
   results table instead of through the middle of it.

   The warning is noise and its own suggested fix is not available: adding
   `"type": "module"` to package.json moves the shipped bundle, which was tried
   and measured on 18 Sep 2026 — see the note above `format` in build.mjs. So
   the noise stays, in the one place where it costs nothing. */
import { STARTER_DECKS } from '../starter-decks.js';
import { CASES } from './mark-eval-cases.mjs';

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

/* Everything `prompt()` below touches has to be named here, and NOTHING checks
   that it is. A prompt builder that grows a new dependency — `paperPrompt`
   picking up `PAPER_VERBS` when the paper learned to ask for a calculation —
   throws a bare ReferenceError out of `grab`'s eval, which is why `call`
   reports a builder that throws as a PROMPT row rather than letting it end the
   run: the drift shows up as one broken feature next to eleven working ones,
   in the place you are already looking, instead of as a stack trace where the
   results should be. */
const G = grab(
  ['mixedPrompt', 'extendedPrompt', 'flipPrompt', 'workedPrompt', 'mixTargets',
   'markPrompt', 'markWorkingPrompt', 'hintPrompt', 'bigHintPrompt',
   'explainPrompt', 'cardQA', 'upgradePrompt',
   'blueprintPrompt', 'rungSplit', 'diagnosePrompt',
   'blueprintPaperPrompt', 'paperPrompt', 'setupWords', 'sameSetup', 'cleanPaperPlan',
   'rescueObjects', 'parseJsonArray', 'cardsFromJson', 'typedCheckable'],
  ['COMMAND_VERBS', 'CALC_VERBS', 'PAPER_VERBS', 'SETUP_NOISE',
   'NCEA_RULES', 'isNcea', 'nceaRules', 'STRICT_CLAUSE',
   'EXPLAIN_STYLE', 'GRADES', 'TYPED_MAX_CHARS', 'TYPED_MAX_WORDS',
   'NEXT_GRADE', 'nextGradeUp', 'uid',
   'VISION_PROMPT', 'HANDWRITING_PROMPT', 'WORKING_PROMPT']);

/* Production by default, because that is what "is it working" means — but
   overridable, so a Vercel preview deployment can be measured before it is
   promoted. That is the whole workflow the README recommends for an AI change
   ("to try one, deploy it") and until now every tool here pointed at the live
   site regardless.

     SF_ENDPOINT=https://study-feed-git-mybranch.vercel.app/api/nvidia node tools/...  */
const ENDPOINT = process.env.SF_ENDPOINT || 'https://studyfeed.app/api/nvidia';
const num = (re, d) => { const m = SRC.match(re); return m ? Number(m[1]) : d; };
const str = (re, d) => { const m = SRC.match(re); return m ? m[1] : d; };

/* The heads of the app's model chains. Resolved through `modelNamed` because
   these stopped being string literals on 17 Sep 2026 — MODEL_SMART is now
   TEXT_MODELS[0], so that a retired model is something the app falls past
   rather than something it stops on. */
const MODEL_SMART  = modelNamed(SRC, 'MODEL_SMART');
const MODEL_GEN    = modelNamed(SRC, 'MODEL_GEN') || MODEL_SMART;
const MODEL_VISION = modelNamed(SRC, 'MODEL_VISION');
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
  const model = modelNamed(SRC, modelName) || MODEL_SMART;
  return { max: Number(m[1]), model: model, low: !!m[3] };
}

/* Read, never defaulted. A ceiling this file guesses at is a request the app
   does not send — and GEN_MAX_TOKENS is now worked out from a measured write
   rate rather than typed, so a regex looking for digits would have quietly
   fallen back to the old 2400 and gone on "testing" generation at a size the
   app abandoned. Stop instead: a checker that cannot read the app is not a
   checker. */
const ceiling = (name) => {
  const v = numberNamed(SRC, name);
  if (!v) throw new Error('grab: could not read ' + name + ' from StudyFeed.jsx');
  return v;
};
const GEN_MAX   = ceiling('GEN_MAX_TOKENS');
const PAPER_MAX = ceiling('PAPER_MAX_TOKENS');
const PLAN_MAX  = ceiling('PLAN_MAX_TOKENS');
/* genChunk, buildPaper and planPaper do not match the callSite shape (they pass
   a model variable and a computed prompt), so their settings stay explicit —
   all three pass lowEffort:true, which is checked by reading the call line. */
/* An optional trailing argument is allowed: genChunk now passes GEN_HEDGE_MS
   after lowEffort. The hedge is client-side timing — it sends the SAME request
   again — so it changes nothing about the request this check builds, and must
   not quietly turn this into "low: false" the way a stricter match would. */
const GEN_LOW   = /callModel\(promptFor\([^)]*\), GEN_MAX_TOKENS, model, true(?:, [A-Z_]+)?\)/.test(SRC);
if (!GEN_LOW) throw new Error('grab: genChunk no longer passes lowEffort — read its call line before trusting this check');
const PAPER_LOW = /PAPER_MAX_TOKENS, MODEL_SMART, true\)/.test(SRC);
const PLAN_LOW  = /PLAN_MAX_TOKENS, MODEL_SMART, true\)/.test(SRC);

/* The three vision features send a content ARRAY rather than a string, so they
   do not match `callSite` either. Their ceilings are read out of the function
   body instead of retyped, for the same reason everything else here is. */
function visionMax(fnName, dflt){
  try {
    const m = extract(fnName).match(/postMessages\(content,\s*(\d+),\s*MODEL_VISION/);
    return m ? Number(m[1]) : dflt;
  } catch { return dflt; }
}
const SLIDE_MAX = visionMax('describeImage', 1500);
const HAND_MAX  = visionMax('transcribeAnswer', 1500);
const WORK_MAX  = visionMax('transcribeWorking', 1200);

const MARK = callSite('markPrompt(card, answer, level)', { max: 3000, model: MODEL_SMART, low: false });
const WORK = callSite('markWorkingPrompt(card, working, level)', { max: 3000, model: MODEL_SMART, low: false });
const HINT = callSite('hintPrompt(card, level)', { max: 600, model: MODEL_SMART, low: false });
const BIG  = callSite('bigHintPrompt(card, level)', { max: 700, model: MODEL_SMART, low: false });
const EXPL = callSite('explainPrompt(card, level, depth)', { max: 900, model: MODEL_SMART, low: false });
const UPG  = callSite('upgradePrompt(card, answer, result, level)', { max: 1600, model: MODEL_SMART, low: false });
const BLUE = callSite('blueprintPrompt(topic, level, n)', { max: 3000, model: MODEL_GEN, low: false });
const DIAG = callSite('diagnosePrompt(topic, level, items)', { max: 3000, model: MODEL_SMART, low: false });

const LEVEL = 'NCEA Level 1';

/* A REAL CARD, NOT AN EASIER ONE.

   This was a four-mark "Explain" with a one-line rubric, written by hand to be
   a plausible extended-response question. It was not one: every extended card
   the app actually ships is six marks or eight, with a three-rung rubric and a
   pitfall, and the difference is not cosmetic. Measured 8 Sep 2026, the marker
   answered the four-mark card in 26.6s and timed out at the proxy's 55-second
   wall on an eight-mark one — four times out of four, at every answer length
   from 71 words to 232. The checker was reporting the product's core feature
   healthy while testing a load the product never puts on it.

   So the card comes out of `starter-decks.js` and the answer out of the
   marking eval's own corpus. Both are what the app ships and what
   `tools/mark-eval.mjs` grades, which also means this row and that eval can no
   longer disagree about what "marking works" means. */
const realExtended = (() => {
  for (const d of STARTER_DECKS){
    const c = (d.cards || []).find(x => x.type === 'extended');
    if (c) return { deck: d.slug, card: c, level: d.standard };
  }
  throw new Error('grab: starter-decks.js has no extended card to mark');
})();
const LONG_CARD = realExtended.card;
/* The "merit" answer: a real mechanism, no evaluation. Middle of the corpus
   rather than the easiest or the hardest thing the marker will see. */
const REAL_ANSWER = (CASES.find(c => c.deck === realExtended.deck && c.cardIndex === 0 && c.kind === 'merit')
  || CASES.find(c => c.deck === realExtended.deck) || {}).answer || '';
const WORKED_CARD = {
  type: 'worked', marks: 4,
  prompt: 'A trolley of mass 250 g accelerates from rest to 12.5 m/s in 4.0 s. Calculate the net force.',
  steps: ['Convert 250 g to 0.25 kg', 'a = (v - u) / t', 'a = 3.125 m/s^2', 'F = ma with the unit'],
  answer: '0.78 N', pitfall: 'Leaving the mass in grams.',
};
const FLIP_CARD = { type: 'flip', front: 'What is activation energy?', back: 'The minimum energy a collision needs for a reaction to happen.' };
/* The answer the marker sees, and it is the corpus's, not a sentence invented
   here — a one-line answer is quick to mark and tells you nothing about whether
   marking works on what students actually write. */
const ANSWER = REAL_ANSWER;
const MARK_RESULT = { grade: 'Achieved', hit: ['Says the rate increases'], missing: ['Link collision energy to activation energy'], lift: 'Say what the extra energy does to the number of successful collisions.', notes: [] };
const NOTES = [
  'Rate of reaction — how fast reactants are used up.',
  'Collision theory — particles must collide with enough energy to react.',
  'Temperature raises kinetic energy, so more frequent and more energetic collisions.',
  'Surface area: smaller pieces expose more particles.',
  'A catalyst lowers the activation energy and is not consumed.',
].join('\n');

/* Three drawn pages, one per vision feature, each written so the check can name
   what must survive: the two ideas on the slide, two words of the answer, and
   every load-bearing number in the working. */
const SLIDE_IMG = imageOfText([
  'RATES OF REACTION',
  'TEMPERATURE RAISES THE RATE',
  'A CATALYST LOWERS THE',
  'ACTIVATION ENERGY',
]);
const ANSWER_IMG = imageOfText([
  'HEATING IT MAKES THE',
  'PARTICLES MOVE FASTER SO',
  'THEY COLLIDE MORE OFTEN',
]);
const WORKING_IMG = imageOfText([
  'M = 250 G = 0.25 KG',
  'A = 12.5 / 4 = 3.125',
  'F = M A = 0.78 N',
]);
/* Same shape the app builds in describeImage / transcribeAnswer / transcribeWorking. */
const visionContent = (text, img) => ([
  { type: 'text', text: text },
  { type: 'image_url', image_url: { url: 'data:' + img.media_type + ';base64,' + img.data } },
]);

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

  { name: 'full paper: plan', model: MODEL_SMART, low: PLAN_LOW, max: PLAN_MAX,
    prompt: () => G.blueprintPaperPrompt(NOTES, '', LEVEL, 'Science 1.1 — chemical reactions', '', 3),
    /* A plan is only usable if it survives the cleaner the app runs it through:
       an entry with no focus is dropped there, so a reply full of them parses
       and is still worthless. */
    ok: (r) => G.cleanPaperPlan(G.parseJsonArray(r), 3).length === 3 },

  { name: 'full paper: question', model: MODEL_SMART, low: PAPER_LOW, max: PAPER_MAX,
    /* Sent WITH a plan, because that is the path the app takes now — the
       exclusion-list form is the fallback for when the planning call fails. */
    prompt: () => G.paperPrompt('', LEVEL, 'Science 1.1 — chemical reactions', 1, 2, [],
      { focus: 'how temperature changes the rate of a reaction', setup: 'marble chips and acid',
        context: 'A student times how long marble chips take to stop fizzing at three temperatures.', avoid: [], why: '' }, ''),
    ok: (r) => { let o = G.rescueObjects(r)[0]; if (!o) o = G.rescueObjects(r.replace(/\\(?!["\\/bfnrtu])/g, ''))[0]; return !!(o && o.parts); } },

  /* --- the three that read a picture ---------------------------------------
     Until these existed the header printed the vision model's name and then
     never called it, so a retired model id would have taken out photo answers,
     photo working and slide reading silently. The page is drawn by
     `tools/test-image.mjs` rather than committed as a photo; it checks that the
     model is alive and that the words on the page come back, NOT transcription
     quality on real handwriting, which is measured separately and by hand. */
  { name: 'read a slide (vision)', model: MODEL_VISION, low: false, max: SLIDE_MAX,
    prompt: () => visionContent(G.VISION_PROMPT, SLIDE_IMG),
    ok: (r) => /catalyst/i.test(r) && /temperature/i.test(r) },

  { name: 'photo of an answer (vision)', model: MODEL_VISION, low: false, max: HAND_MAX,
    prompt: () => visionContent(G.HANDWRITING_PROMPT, ANSWER_IMG),
    ok: (r) => /particles/i.test(r) && /collide/i.test(r) && r.toUpperCase().indexOf('NO_ANSWER') !== 0 },

  { name: 'photo of working (vision)', model: MODEL_VISION, low: false, max: WORK_MAX,
    /* The numbers are the whole point: a transcription that loses 0.25 or
       3.125 gets the student marked on working they did not do. */
    ok: (r) => /0\.25/.test(r) && /3\.125/.test(r) && /0\.78/.test(r),
    prompt: () => visionContent(G.WORKING_PROMPT, WORKING_IMG) },
];

/* A DEADLINE OF OUR OWN, and it is not decoration.

   Measured here on 7 Sep 2026: one `sentence starters` call sat inside `fetch`
   for SIXTEEN AND A HALF MINUTES before undici finally gave up on a hung HTTP/2
   stream and threw "fetch failed". The proxy's own ceiling is about 55s, so
   nothing still open at 90 is coming back — every second past that is the
   checker hanging, not the feature being slow, and the two are indistinguishable
   from the outside while you sit watching a blank row. `tools/paper-eval.mjs`
   learned this the same way and grew the same deadline; this file did not, and a
   run that takes twenty minutes to report a flake gets stopped rather than read.

   A TIMEOUT row is deliberately not the same as HTTP 504: the proxy answering
   "the model timed out" is the app's own error path working, which is a
   different fact about the system than nobody answering at all.

   AND THE DEADLINE IS KEPT ON THE WALL CLOCK, not only on a timer, because a
   timer is not enough on a laptop. A run left going overnight came back with
   five rows reading TIMEOUT at 663, 772, 944, 965 and 981 seconds against a
   90-second deadline — the endpoint answering in three seconds either side of
   it. macOS had been dropping into maintenance sleep for 726, 916 and 957
   seconds at a stretch: `AbortSignal.timeout` does not advance while the host
   is suspended, so it fired minutes late, and every one of those rows was the
   machine asleep rather than a feature down. A 1-second interval comparing
   `Date.now()` catches up the moment the machine wakes, which bounds the damage
   to one row, and any row that still runs far past its deadline is reported as
   ASLEEP rather than blamed on the endpoint. `caffeinate -dimsu node
   tools/health.mjs` helps on macOS, but nothing beats a closed lid — a full run
   is minutes long, so start it and leave the machine awake. */
/* Derived from the proxy's own budget rather than written down: it has to sit
   comfortably PAST the point where the proxy gives up and returns its 504, or
   this starts reporting a timeout for an answer that was about to arrive. That
   number moved from 55s to 85s on 18 Sep 2026 and three files had it hardcoded
   at 90000 with a comment explaining why 90 was safely past 55. */
const DEADLINE_MS = checkerDeadlineMs(readFileSync(join(HERE, '..', 'api', 'nvidia.js'), 'utf8'));
/* Past this the timer did not merely run late, it stopped: nothing in a
   90-second budget legitimately takes two and a half minutes to abort. */
const SLEPT_MS = DEADLINE_MS * 1.5;

async function call(c){
  const t0 = Date.now();
  /* Building the prompt is the other thing that can fail, and it fails LOUDLY:
     the builders are lifted out of the source, so one that has grown a
     dependency `grab` was not told about throws a bare ReferenceError. Caught
     here, that is one PROMPT row among the others; uncaught it ended the run,
     taking every check after it with it. */
  let content;
  try { content = c.prompt(); }
  catch (e){ return { ms: Date.now() - t0, status: 'PROMPT', detail: String(e && e.message || e) }; }

  const body = {
    model: c.model,
    messages: [{ role: 'user', content: content }],
    temperature: 0.7, top_p: 0.9, max_tokens: c.max, stream: false,
  };
  if (c.low && /gpt-oss/i.test(c.model)) body.reasoning_effort = 'low';
  /* The other switch the app decides per model. It matters as soon as a chain
     head is a reasoner: without it `nemotron-3.5-lightning` returns its thinking
     transcript in `content` and spends the whole ceiling doing it — measured, 950
     tokens and zero cards — which this file would report as a broken feature for
     a model that works perfectly when asked properly. */
  if (/deepseek|nemotron/i.test(c.model)){
    body.chat_template_kwargs = { thinking: false };
    body.temperature = 0.6;
  }

  /* Two clocks on the same abort: the timer for the ordinary case, and a
     wall-clock tick for the case where the timer itself was suspended. */
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DEADLINE_MS);
  const watchdog = setInterval(() => { if (Date.now() - t0 > DEADLINE_MS) ctrl.abort(); }, 1000);
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: ctrl.signal,
    });
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
    const ms = Date.now() - t0;
    const timedOut = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    if (ms > SLEPT_MS) return { ms, status: 'ASLEEP',
      detail: `${(ms / 1000).toFixed(0)}s for a ${DEADLINE_MS / 1000}s deadline — this host suspended mid-request, so the row says nothing about the feature. Re-run it (on macOS: caffeinate -dimsu node tools/health.mjs).` };
    return { ms, status: timedOut ? 'TIMEOUT' : 'THREW',
      detail: timedOut ? `no reply in ${DEADLINE_MS / 1000}s — the endpoint stalled, not the feature` : String(e && e.message || e) };
  } finally {
    clearTimeout(timer);
    clearInterval(watchdog);
  }
}

const only = (() => { const i = process.argv.indexOf('--only'); return i > 0 ? process.argv[i + 1] : null; })();
const repeat = (() => { const i = process.argv.indexOf('--repeat'); return i > 0 ? Number(process.argv[i + 1]) : 1; })();
const run = CHECKS.filter(c => !only || c.name.includes(only));

/* --dry: BUILD EVERY REQUEST AND SEND NONE OF THEM.

   This is the check that would have caught the bug that prompted it. When the
   full paper learned to ask for a calculation, `paperPrompt` started reading
   PAPER_VERBS, `grab` was not told, and the eval it broke was this one — which
   only discovered it four minutes into a live run, on the twelfth row, as a
   ReferenceError where the results should have been. The dependency was
   missing the moment the source was saved; nothing about finding it needed the
   endpoint, a key, or four minutes.

   So it runs in milliseconds, needs no network, and asserts the two things that
   go wrong offline: every builder still resolves, and what it returns is
   actually sendable. It cannot tell you a feature works — only that the request
   the app would send can still be constructed. Run it on every change; run the
   real thing when you want to know the model is answering. */
if (process.argv.includes('--dry')){
  console.log(`Dry run — building ${run.length} requests, sending none\n`);
  let bad = 0;
  for (const c of run){
    let note = '';
    try {
      const p = c.prompt();
      /* A string prompt, or the content array the vision features send. Both
         reach the endpoint as one user turn, and both are worthless empty. */
      if (typeof p === 'string') note = p.trim() ? `${p.length} chars` : 'EMPTY STRING';
      else if (Array.isArray(p)){
        const text = p.find(x => x && x.type === 'text');
        const image = p.find(x => x && x.type === 'image_url');
        note = (text && text.text && image && image.image_url && image.image_url.url)
          ? `${text.text.length} chars + ${Math.round(image.image_url.url.length / 1024)}KB image`
          : 'MALFORMED CONTENT ARRAY';
      } else note = 'NOT A PROMPT — ' + typeof p;
      const ok = !/EMPTY|MALFORMED|NOT A PROMPT/.test(note);
      if (!ok) bad++;
      console.log(`${(ok ? 'ok  ' : 'FAIL').padEnd(6)} ${c.name.padEnd(29)} ${note}`);
    } catch (e){
      bad++;
      console.log(`${'FAIL'.padEnd(6)} ${c.name.padEnd(29)} ${String(e && e.message || e)}`);
    }
  }
  console.log(`\n${run.length - bad}/${run.length} requests build`);
  process.exit(bad ? 1 : 0);
}

console.log(`Health check — ${run.length * repeat} calls against ${ENDPOINT}`);
console.log(`text ${MODEL_SMART} · vision ${MODEL_VISION}\n`);
console.log('STATUS      FEATURE                       CEIL   LOW  TOK    TIME');
console.log('─'.repeat(67));

const rows = [];
for (let r = 0; r < repeat; r++){
  for (const c of run){
    let out = await call(c);
    /* An ASLEEP row is not a result, it is the absence of one — the host was
       suspended and the request never really got a chance. Ask again rather
       than printing a row nobody can act on. Once only: if the machine is still
       asleep the second attempt is worth no more than the first, and the run
       says so at the end. Observed on this hardware, the sleep/wake cycle is
       roughly fifteen minutes down and a minute up, so a retry landing just
       after a wake is the common case rather than a lucky one. */
    if (out.status === 'ASLEEP'){
      const again = await call(c);
      if (again.status !== 'ASLEEP') out = { ...again, detail: (again.detail ? again.detail + ' ' : '') + '(first attempt lost to a sleeping host)' };
    }
    rows.push({ name: c.name, ...out });
    const flag = out.status === 'OK' ? (out.ms > 20000 ? 'OK  SLOW' : 'OK      ') : out.status.padEnd(8);
    console.log(`${flag.padEnd(11)} ${c.name.padEnd(29)} ${String(c.max).padEnd(6)} ${(c.low ? 'yes' : 'no').padEnd(4)} ${String(out.used == null ? '-' : out.used).padEnd(6)} ${(out.ms / 1000).toFixed(1)}s`);
    if (out.detail) console.log(`            ↳ ${out.detail}`);
  }
}

/* Not every failure is the same failure, and reading them as one is how an
   afternoon gets spent on a feature that was fine. TIMEOUT and 504 are the free
   tier dropping calls — the same row usually passes on the next run, so what
   they mean is "run it again", not "fix it". EMPTY, UNUSABLE and PROMPT are the
   app's own: a reply that came back and could not be used, or a request this
   file can no longer even build. Those are the ones worth stopping for. */
const FLAKY = (r) => r.status === 'TIMEOUT' || r.status === 'THREW' || r.status === 'ASLEEP' || /^HTTP 5/.test(r.status);
const bad = rows.filter(r => r.status !== 'OK');
const flaky = bad.filter(FLAKY);
const real = bad.filter(r => !FLAKY(r));
const slept = bad.filter(r => r.status === 'ASLEEP');
const slow = rows.filter(r => r.status === 'OK' && r.ms > 20000);
console.log('\n' + '─'.repeat(67));
console.log(`${rows.length - bad.length}/${rows.length} working`
  + (real.length ? `  —  BROKEN: ${[...new Set(real.map(b => b.name))].join(', ')}` : ''));
if (flaky.length) console.log(`${flaky.length} call${flaky.length === 1 ? '' : 's'} never came back (${[...new Set(flaky.map(b => b.name))].join(', ')}) — re-run those before believing them`);
if (slept.length) console.log(`${slept.length} of those ran past the deadline by minutes: this machine slept, so the whole run is suspect. Re-run it awake — on macOS, caffeinate -dimsu node tools/health.mjs`);
if (slow.length) console.log(`over 20s: ${[...new Set(slow.map(s => s.name))].join(', ')}`);
const times = rows.filter(r => r.status === 'OK').map(r => r.ms).sort((a, b) => a - b);
if (times.length) console.log(`median ${(times[Math.floor(times.length / 2)] / 1000).toFixed(1)}s · slowest ${(times[times.length - 1] / 1000).toFixed(1)}s`);
