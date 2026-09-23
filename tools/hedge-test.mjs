/* ============================================================================
   HEDGE TEST — asking twice when the first answer is slow.

   postHedged is concurrency, which is the kind of code that looks right and
   is not: a loser that is never aborted keeps a slot at the vendor, a failure
   that arrives before the duplicate was sent must NOT be swallowed or the model
   chain never hears about it, and a duplicate must share the original's
   deadline or a hedged call can run longer than an unhedged one was allowed to.

     node tools/hedge-test.mjs

   Offline. postHedged is lifted out of StudyFeed.jsx at run time and driven
   against a fake postOnce whose timing and outcome each test sets, with real
   timers on a millisecond scale. The fake records what it was asked for and
   whether it was aborted — which is the whole of what is under test.
   ========================================================================== */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'StudyFeed.jsx'), 'utf8');
function extract(name){
  const start = SRC.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('grab: function ' + name + ' not found');
  let i = SRC.indexOf('{', start), depth = 0, str = null, esc = false, line = false, block = false;
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
  throw new Error('grab: no end for ' + name);
}

/* PLAN is a list of { ms, ok, value|error } — one per call, in call order. */
const H = new Function(`
let PLAN = [], CALLS = [], TRACKED = [];
function track(ev, props){ TRACKED.push(ev); }
function postOnce(body, timeoutMs, cancel){
  const step = PLAN[CALLS.length] || { ms: 5, ok: true, value: 'default' };
  const rec = { timeoutMs, aborted: false, label: step.value || step.error };
  CALLS.push(rec);
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => step.ok ? resolve(step.value) : reject(new Error(step.error)), step.ms);
    if (cancel) cancel.addEventListener('abort', () => { rec.aborted = true; clearTimeout(t); reject(new Error('timed out — aborted')); });
  });
}
${extract('postHedged')}
return {
  postHedged,
  reset: (plan) => { PLAN = plan; CALLS = []; TRACKED = []; },
  calls: () => CALLS, tracked: () => TRACKED,
};
`)();

let failed = 0;
function check(name, got, want){
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (!ok) console.log(`       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`);
}
const run = async (plan, wall, hedge) => {
  H.reset(plan);
  try { return { ok: true, v: await H.postHedged({ model: 'm' }, wall, hedge) }; }
  catch (e){ return { ok: false, e: e.message }; }
};
const settle = () => new Promise(r => setTimeout(r, 30));
/* The wall has to be comfortably more than the 1s "too close to bother" margin
   postHedged keeps, or nothing here would ever hedge. */
const BODY_WALL = 5000, HEDGE = 60;

console.log('Hedged requests — ask again if slow, keep the first answer\n');

console.log('  — the common case costs nothing —');
let r = await run([{ ms: 10, ok: true, value: 'A' }], BODY_WALL, HEDGE);
check('a fast answer is returned', r, { ok: true, v: 'A' });
await new Promise(res => setTimeout(res, HEDGE + 40));
check('and no second request is ever sent', H.calls().length, 1);
check('and nothing is counted as hedged', H.tracked(), []);

console.log('\n  — the slow case —');
r = await run([{ ms: 400, ok: true, value: 'A' }, { ms: 20, ok: true, value: 'B' }], BODY_WALL, HEDGE);
check('a slow original is overtaken by the duplicate', r, { ok: true, v: 'B' });
check('two requests were sent', H.calls().length, 2);
await settle();
check('the loser is aborted, not left holding a slot', H.calls()[0].aborted, true);
check('the hedge is counted once', H.tracked(), ['request_hedged']);

r = await run([{ ms: 120, ok: true, value: 'A' }, { ms: 400, ok: true, value: 'B' }], BODY_WALL, HEDGE);
check('an original that still wins is kept', r, { ok: true, v: 'A' });
await settle();
check('and the duplicate is aborted', H.calls()[1].aborted, true);

console.log('\n  — deadlines —');
r = await run([{ ms: 400, ok: true, value: 'A' }, { ms: 20, ok: true, value: 'B' }], BODY_WALL, HEDGE);
check('the original gets the whole wall', H.calls()[0].timeoutMs, BODY_WALL);
check('the duplicate shares the deadline rather than starting a fresh one', H.calls()[1].timeoutMs, BODY_WALL - HEDGE);

console.log('\n  — failures reach postChat unchanged —');
/* The one that matters most: if the original fails BEFORE we hedged, postChat
   has to see that exact error, or the model chain and the hang memory never
   learn the model is gone. */
r = await run([{ ms: 10, ok: false, error: 'API returned 410 — gone' }], BODY_WALL, HEDGE);
check('an early failure is handed straight back', r, { ok: false, e: 'API returned 410 — gone' });
await new Promise(res => setTimeout(res, HEDGE + 40));
check('without sending a duplicate', H.calls().length, 1);

r = await run([{ ms: 200, ok: false, error: 'API returned 503' }, { ms: 60, ok: true, value: 'B' }], BODY_WALL, HEDGE);
check('an original that fails after the hedge still lets the duplicate win', r, { ok: true, v: 'B' });

r = await run([{ ms: 400, ok: true, value: 'A' }, { ms: 10, ok: false, error: 'API returned 502' }], BODY_WALL, HEDGE);
check('a duplicate that fails leaves the original to finish', r, { ok: true, v: 'A' });

r = await run([{ ms: 150, ok: false, error: 'first' }, { ms: 200, ok: false, error: 'second' }], BODY_WALL, HEDGE);
check('both failing rejects', r.ok, false);
check('with the first failure, which is the one postChat reasons about', r.e, 'first');

console.log('\n  — when not to hedge —');
r = await run([{ ms: 10, ok: true, value: 'A' }], BODY_WALL, 0);
check('no hedge asked for is a plain request', [r.v, H.calls().length], ['A', 1]);
r = await run([{ ms: 10, ok: true, value: 'A' }], BODY_WALL, BODY_WALL);
check('a hedge at or past the wall is a plain request', H.calls()[0].timeoutMs, BODY_WALL);
r = await run([{ ms: 10, ok: true, value: 'A' }], BODY_WALL, BODY_WALL - 500);
check('and so is one too close to the wall to be worth sending', H.calls().length, 1);

console.log(`\n${failed ? failed + ' FAILED' : 'all passed'}`);
if (failed) process.exit(1);
