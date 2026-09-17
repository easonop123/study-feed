/* ============================================================================
   WHICH MODELS ARE STILL ALIVE, AND IS ANY OF THEM FAST ENOUGH?

   NVIDIA Build retires free models constantly, and when the one this app runs
   on goes, every AI feature stops at once. That has now happened often enough
   to be the normal weather rather than an incident: scanned on 17 Sep 2026,
   **27 of 34 ids the app had ever used or considered answered 404 or 410**, most
   of them EOL'd inside the previous three weeks. Finding a replacement used to
   mean guessing ids by hand against a browser tab.

   It does not need to. `integrate.api.nvidia.com/v1/models` is a PUBLIC list —
   no key, no auth — so the catalogue can be read from here, filtered to the
   chat-shaped ids, and probed through our own proxy, which is the only place
   the key lives. Two stages:

     node tools/models.mjs            # alive scan: one cheap call per candidate
     node tools/models.mjs --bake     # the survivors, on the app's REAL prompts

   The alive scan answers "is there anything to move to". The bake-off answers
   the only question that matters after that — whether the thing that came back
   is usable by the app's own parsers, which is a different question from
   whether the model is good. A model that writes beautiful prose where
   `cardsFromJson` wants an array is worth nothing here.

   Both read the app's current model ids out of `StudyFeed.jsx` and always
   include them, so the control is whatever is actually shipping.
   ========================================================================== */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { allModels, numberNamed } from './app-source.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, '..', 'StudyFeed.jsx'), 'utf8');

/* ---- lifting the app's own prompts, the same way every eval here does ----- */
function extractConst(name){
  const start = SRC.indexOf(`const ${name} = `);
  if (start < 0) throw new Error(`grab: const ${name} not found`);
  let str = null, esc = false, depth = 0;
  for (let i = start; i < SRC.length; i++){
    const c = SRC[i];
    if (str){ if (esc){ esc = false; continue; } if (c === '\\'){ esc = true; continue; } if (c === str) str = null; continue; }
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
    if (str){ if (esc){ esc = false; continue; } if (c === '\\'){ esc = true; continue; } if (c === str) str = null; continue; }
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

const ENDPOINT = process.env.SF_ENDPOINT || 'https://studyfeed.app/api/nvidia';
const CATALOGUE = 'https://integrate.api.nvidia.com/v1/models';

/* The ids the app ships with, so the control row is always the real one. */
const shippingIds = () => allModels(SRC);

/* Ids that could plausibly answer a chat request. The catalogue also carries
   embedders, rerankers, guardrail classifiers, OCR and image models; sending
   them a chat prompt wastes a round trip to be told no. */
const CHATTY = /instruct|chat|-it$|gpt-oss|nemotron|gemma|phi|qwen|mistral|llama|jamba|granite|yi-|dbrx|zamba/i;
const NOT_CHATTY = /embed|rerank|guard|safety|topic-control|reward|parse|retriev|vlm|ocr|translate|code(llama|gemma|stral)|starcoder|diffusion|riva/i;

async function catalogue(){
  const res = await fetch(CATALOGUE);
  if (!res.ok) throw new Error('catalogue: HTTP ' + res.status);
  const j = await res.json();
  return (j.data || []).map(d => d.id);
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* One call through the proxy. Two things here are deliberate.

   A LOCAL network blip is not a dead model. Running this from a laptop on
   home wifi, `fetch failed` inside a second or two came back for ids that
   answered fine on the next try — reported as DEAD that would have crossed a
   live model off the list, which is the expensive mistake here. So a throw
   that is not a timeout gets one retry.

   AND THE CLOCK AFTER AN ABORT IS A LIE. Aborting a stuck HTTP/2 stream does
   not reject promptly — undici can sit on it for minutes — so a row that was
   cut off at the deadline reports the deadline, not the wall time, and says
   `>`. The same trap ended a paper-eval run in a stack trace once. */
async function once(model, prompt, maxTokens, ms, extra){
  const body = Object.assign({
    model, messages: [{ role: 'user', content: prompt }],
    temperature: 0.7, top_p: 0.9, max_tokens: maxTokens, stream: false,
  }, extra || {});
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  const t0 = Date.now();
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: ctrl.signal,
    });
    const text = await res.text();
    return { status: res.status, text, ms: Date.now() - t0 };
  } finally { clearTimeout(timer); }
}

async function probe(model, prompt, maxTokens, ms, extra){
  for (let attempt = 0; attempt < 2; attempt++){
    try { return await once(model, prompt, maxTokens, ms, extra); }
    catch (e){
      const aborted = e && (e.name === 'AbortError' || /aborted/i.test(String(e.message || '')));
      if (aborted) return { status: 0, why: 'no answer in ' + (ms / 1000) + 's', ms, capped: true };
      if (attempt) return { status: 0, why: String(e && e.message || e).slice(0, 50), ms: Date.now() };
      await sleep(1500);
    }
  }
}

function why(row){
  let out = String(row.text || '').slice(0, 78).replace(/\s+/g, ' ');
  try {
    const j = JSON.parse(row.text);
    out = j.detail || (j.error && (j.error.message || j.error)) || out;
  } catch {}
  return String(out).slice(0, 78);
}
const secs = (row) => (row.capped ? '>' : '') + (row.ms / 1000).toFixed(1) + 's';

/* ------------------------------- stage 1 ---------------------------------- */
async function aliveScan(){
  const ids = await catalogue();
  const shipping = shippingIds();
  const cands = [...new Set(shipping.concat(
    ids.filter(id => CHATTY.test(id) && !NOT_CHATTY.test(id))))];

  console.log(`alive scan — ${cands.length} chat-shaped ids of ${ids.length} in the catalogue`);
  console.log(`through ${ENDPOINT}\n`);
  console.log('STATUS  TIME     MODEL');
  console.log('─'.repeat(76));

  const alive = [];
  for (const model of cands){
    const row = await probe(model, 'Reply with the single word: ready', 300, 45000);
    if (row.status === 200){
      let tok = 0;
      try { tok = (JSON.parse(row.text).usage || {}).completion_tokens || 0; } catch {}
      alive.push({ model, ms: row.ms, tok });
      console.log(`ALIVE   ${secs(row).padEnd(8)} ${model}${shipping.includes(model) ? '   (shipping)' : ''}   tok=${tok}`);
    } else if (row.status === 0){
      console.log(`HUNG    ${secs(row).padEnd(8)} ${model}   ${row.why}`);
    } else {
      console.log(`${String(row.status).padEnd(7)} ${secs(row).padEnd(8)} ${model}   ${why(row)}`);
    }
    await sleep(400);
  }

  console.log('\n' + '─'.repeat(76));
  alive.sort((a, b) => a.ms - b.ms);
  console.log(`${alive.length} alive of ${cands.length}:`);
  for (const a of alive) console.log(`  ${(a.ms / 1000).toFixed(1)}s  ${a.model}`);
  if (!alive.length) console.log('  nothing answered — check the endpoint before believing this');
  console.log('\nNext: node tools/models.mjs --bake   (the survivors, on the real prompts)');
  return alive.map(a => a.model);
}

/* ------------------------------- stage 2 ---------------------------------- */
/* Alive is not the same as usable. These are the app's own prompts and the
   app's own parsers: a reply only counts if the thing the app does with it
   produces something. Generation must yield cards, marking must yield a grade. */
/* `cardsFromJson` calls `typedCheckable`, which calls the two TYPED_* limits.
   Leave any of them out and every card is silently dropped by a ReferenceError
   inside the try — which reads as "this model cannot generate" for a model that
   generated perfectly. That mistake cost an afternoon on 17 Sep 2026; the list
   below is the same one `tools/health.mjs` uses, and it is one list on purpose. */
const G = grab(
  ['mixedPrompt', 'mixTargets', 'parseJsonArray', 'cardsFromJson', 'rescueObjects',
   'markPrompt', 'typedCheckable'],
  ['COMMAND_VERBS', 'NCEA_RULES', 'isNcea', 'nceaRules', 'STRICT_CLAUSE', 'uid',
   'GRADES', 'TYPED_MAX_CHARS', 'TYPED_MAX_WORDS']);

const LEVEL = 'NCEA Level 1';
/* The app never hands a generate more than one `batchText` chunk, so neither
   does this. Sending 4000 characters while the app sends 2400 measures a
   request nobody makes, and it measures it as HARDER than the real one — which
   is the direction that quietly condemns a model that would have been fine. */
const BATCH_CHARS = Number((SRC.match(/function batchText\(text, size = (\d+)\)/) || [])[1]) || 2400;
const PARA = 'Rate of reaction is how quickly reactants are turned into products, measured as the change in concentration of a reactant or product per unit time. Collision theory says particles must collide, with the correct orientation, and with at least the activation energy, for a reaction to occur. Increasing temperature gives particles more kinetic energy, so collisions are both more frequent and a greater proportion of them exceed the activation energy. Increasing concentration puts more particles in the same volume, so collisions are more frequent. Increasing the surface area of a solid reactant exposes more particles at the surface. A catalyst provides an alternative pathway with a lower activation energy and is not consumed. A rate graph plots the amount of product against time: the gradient at any point is the rate, and it flattens as reactants are used up. Magnesium ribbon with dilute hydrochloric acid produces hydrogen, collected in a gas syringe. Marble chips with hydrochloric acid produce carbon dioxide, followed by mass loss on a balance. Sodium thiosulfate with hydrochloric acid produces a sulfur precipitate, timed by a cross disappearing.';
let NOTES = '';
while (NOTES.length < BATCH_CHARS) NOTES += PARA + '\n';
NOTES = NOTES.slice(0, BATCH_CHARS);

const LONG_CARD = {
  type: 'extended', verb: 'Explain', marks: 4,
  prompt: 'Explain why increasing the temperature increases the rate of a reaction.',
  achieved: 'States that the rate increases.',
  merit: 'Links temperature to particle energy and collision frequency.',
  excellence: 'Links collision frequency AND collision energy to activation energy in this context.',
  skeleton: 'Because ... this means ... so ...',
  pitfall: 'Saying particles "have more energy" without saying what that does.',
};
const ANSWER = 'When you heat it up the particles move faster so they hit each other more often and more of the hits are hard enough to react, so the reaction goes quicker.';

/* The two ceilings the app really sends, read rather than retyped — the whole
   point of this bake-off is to find out whether the REQUEST THE APP MAKES gets
   an answer, and generation's ceiling is now worked out from a measured write
   rate rather than written down. */
const GEN_MAX = numberNamed(SRC, 'GEN_MAX_TOKENS') || 950;
const MARK_MAX = Number((SRC.match(/callModel\(markPrompt\(card, answer, level\),\s*(\d+)/) || [])[1]) || 3000;

const JOBS = [
  { name: 'generate', max: GEN_MAX, low: true,
    prompt: () => G.mixedPrompt(NOTES, LEVEL, 30, false),
    count: (r) => { try { return G.cardsFromJson(G.parseJsonArray(r)).length; } catch { return 0; } },
    unit: 'cards' },
  { name: 'mark', max: MARK_MAX, low: false,
    prompt: () => G.markPrompt(LONG_CARD, ANSWER, LEVEL),
    count: (r) => { try { const o = G.rescueObjects(r)[0]; return (o && o.grade) ? 1 : 0; } catch { return 0; } },
    unit: 'grade' },
];

/* The two switches the app sends, decided per model exactly as the app decides
   them — a bake-off that sends a different request from the one that will ship
   is measuring a model the app is not going to use. */
const isReasoner = (m) => /deepseek|nemotron/i.test(m || '');
const takesReasoningEffort = (m) => /gpt-oss/i.test(m || '');

async function bake(models){
  const repeat = Number(process.env.REPEAT || 2);
  console.log(`bake-off — ${models.length} models, ${JOBS.length} jobs, ${repeat} each`);
  console.log(`generate: ${BATCH_CHARS}-char batch, ${GEN_MAX} ceiling · mark: ${MARK_MAX} ceiling\n`);
  console.log('MODEL                                          JOB       RESULT');
  console.log('─'.repeat(90));
  const score = {};
  for (const model of models){
    score[model] = { ok: 0, ran: 0, ms: [] };
    for (const job of JOBS){
      for (let r = 0; r < repeat; r++){
        const extra = {};
        if (job.low && takesReasoningEffort(model)) extra.reasoning_effort = 'low';
        if (isReasoner(model)) extra.chat_template_kwargs = { thinking: false };
        const row = await probe(model, job.prompt(), job.max, 70000, extra);
        score[model].ran++;
        let cell;
        if (row.status === 200){
          const p = JSON.parse(row.text);
          const c = (p.choices || [])[0] || {};
          const reply = (c.message && c.message.content) || '';
          const n = job.count(reply);
          if (n > 0){ score[model].ok++; score[model].ms.push(row.ms); }
          cell = `${n > 0 ? 'ok  ' : 'BAD '} ${secs(row).padEnd(7)} tok=${String((p.usage || {}).completion_tokens || 0).padEnd(5)} fin=${String(c.finish_reason).padEnd(6)} ${n} ${job.unit}`;
        } else {
          cell = `FAIL  ${secs(row).padEnd(7)} ${row.status ? 'HTTP ' + row.status + ' ' + why(row) : row.why}`;
        }
        console.log(`${model.padEnd(47)}${job.name.padEnd(10)}${cell}`);
        await sleep(500);
      }
    }
  }
  console.log('\n' + '─'.repeat(90));
  console.log('USABLE  MEDIAN  MODEL');
  const rows = Object.keys(score).map(m => {
    const s = score[m];
    const t = s.ms.slice().sort((a, b) => a - b);
    return { m, ok: s.ok, ran: s.ran, med: t.length ? t[Math.floor(t.length / 2)] : Infinity };
  }).sort((a, b) => (b.ok - a.ok) || (a.med - b.med));
  for (const r of rows)
    console.log(`${(r.ok + '/' + r.ran).padEnd(8)}${(r.med === Infinity ? '-' : (r.med / 1000).toFixed(1) + 's').padEnd(8)}${r.m}`);
}

/* ---------------------------------- run ----------------------------------- */
const args = process.argv.slice(2);
const named = args.filter(a => a[0] !== '-');
if (args.includes('--bake')){
  const models = named.length ? named : await aliveScan().then(a => { console.log(''); return a; });
  await bake(models);
} else {
  await aliveScan();
}
