/* Does a timed-out request come back CHEAPER on the retry, and does nothing
   else change?

   Offline. postChat, isTimeout, isRetryable and takesReasoningEffort are
   lifted out of StudyFeed.jsx at run time (the grab technique the evals use)
   and driven against a fake fetch, so this tests the shipped code rather than
   a description of it. ATTEMPT_MS/RETRY_WAIT_MS are overridden to keep the run
   instant — the app's real values would make this a three-minute test.

     node tools/retry-downshift-test.mjs
   ========================================================================== */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'StudyFeed.jsx'), 'utf8');

function extract(name){
  let start = SRC.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('grab: function ' + name + ' not found');
  /* Keep an `async` prefix if the declaration has one — postChat does, and
     lifting it without would produce a body whose `await`s do not parse. */
  if (SRC.slice(start - 6, start) === 'async ') start -= 6;
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
  throw new Error('grab: no end for ' + name);
}
function extractConst(name){
  const start = SRC.indexOf('const ' + name + ' = ');
  if (start < 0) throw new Error('grab: const ' + name + ' not found');
  let str = null, esc = false, depth = 0;
  for (let i = start; i < SRC.length; i++){
    const c = SRC[i];
    if (str){ if (esc){ esc = false; continue; } if (c === '\\'){ esc = true; continue; } if (c === str) str = null; continue; }
    if (c === '"' || c === "'" || c === '`'){ str = c; continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ';' && depth === 0) return SRC.slice(start, i + 1);
  }
  throw new Error('grab: no end for ' + name);
}

/* postOnce is replaced by a stub: the real one calls fetch and honours an
   AbortController, neither of which exists here, and what is under test is the
   attempt loop's decisions rather than its transport. The stub records the
   body it was handed on each attempt, which is the whole point. */
const harness = `
${extractConst('isReasoner')}
${extractConst('takesReasoningEffort')}
${extractConst('RETRY_WAIT_MS')}
const ATTEMPT_MS = [1, 1, 1];
const sleep = () => Promise.resolve();
${extract('isRetryable')}
${extract('isTimeout')}
let SEEN = [];
let PLAN = [];
async function postOnce(body){
  SEEN.push({ effort: body.reasoning_effort, max: body.max_tokens, model: body.model });
  const outcome = PLAN[SEEN.length - 1];
  if (outcome) throw new Error(outcome);
  return 'ok';
}
${extract('postChat')}
return { postChat, reset: (p) => { SEEN = []; PLAN = p; }, seen: () => SEEN };
`;
const H = new Function(harness)();

const GPT = 'openai/gpt-oss-20b';
const PROXY_504 = 'API returned 504 — NVIDIA did not respond in time — the model timed out.';
const CLIENT_TIMEOUT = 'timed out — the AI took too long to respond';

let failed = 0;
function check(name, got, want){
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (!ok) console.log(`       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`);
}
const efforts = () => H.seen().map(s => s.effort === undefined ? 'full' : s.effort);

console.log('Retry downshift — the reply that did not fit the time is asked for cheaper\n');

H.reset([PROXY_504, null]);
await H.postChat([], 3000, GPT);
check('proxy 504 -> second attempt drops to low', efforts(), ['full', 'low']);

H.reset([CLIENT_TIMEOUT, null]);
await H.postChat([], 3000, GPT);
check('client-side timeout does the same', efforts(), ['full', 'low']);

H.reset([PROXY_504, PROXY_504, null]);
await H.postChat([], 3000, GPT);
check('stays low once dropped', efforts(), ['full', 'low', 'low']);

H.reset(['API returned 429 — rate limited', null]);
await H.postChat([], 3000, GPT);
check('429 retries UNCHANGED (not a length problem)', efforts(), ['full', 'full']);

H.reset(['API returned 502 — bad gateway', null]);
await H.postChat([], 3000, GPT);
check('502 retries unchanged', efforts(), ['full', 'full']);

H.reset([null]);
await H.postChat([], 3000, GPT);
check('a call that works is never downshifted', efforts(), ['full']);

H.reset([PROXY_504, null]);
await H.postChat([], 3000, GPT, true);
check('a caller already asking for low stays low', efforts(), ['low', 'low']);

H.reset([PROXY_504, null]);
await H.postChat([], 3000, 'meta/llama-3.2-11b-vision-instruct');
check('never sent to a model that has not been tested with it', efforts(), ['full', 'full']);

H.reset([PROXY_504, PROXY_504, PROXY_504]);
let threw = '';
try { await H.postChat([], 3000, GPT); } catch (e){ threw = e.message; }
check('three failures still throw the last error', threw, PROXY_504);
check('and stop at three attempts', H.seen().length, 3);

H.reset(['API returned 401 — unauthorized']);
try { await H.postChat([], 3000, GPT); } catch {}
check('a config error is not retried at all', H.seen().length, 1);

H.reset([PROXY_504, null]);
await H.postChat([], 1700, GPT);
check('the ceiling is never quietly changed', H.seen().map(s => s.max), [1700, 1700]);

console.log(`\n${failed ? failed + ' FAILED' : 'all passed'}`);
if (failed) process.exit(1);
