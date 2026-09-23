/* ============================================================================
   THE MODEL CHAIN, PINNED OFFLINE.

     node tools/chain-test.mjs

   `postChat` is the one place in the app where a vendor outage either becomes a
   blank screen or does not. It got considerably more interesting on 17 Sep 2026
   — it walks a chain of models, treats a retired one differently from a busy one
   and both differently from one that has gone quiet, and spends a TIME budget
   rather than a count of tries — and none of that could be exercised without the
   endpoint, which is exactly the wrong dependency for the code whose job is to
   cope when the endpoint is the problem.

   So the real function is lifted out of `StudyFeed.jsx` and run against a fake
   transport. No network, no key, about a millisecond. What is being checked is
   never "did the model answer" — it is the decisions: which model is asked, in
   what order, how often, and what the request carried.
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
    if (str){ if (esc){ esc = false; continue; } if (c === '\\'){ esc = true; continue; } if (c === str) str = null; continue; }
    if (c === '"' || c === "'" || c === '`'){ str = c; continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ';' && depth === 0) return SRC.slice(start, i + 1);
  }
  throw new Error(`grab: no end for ${name}`);
}
/* `indexOf('function postChat(')` also matches INSIDE 'async function postChat(',
   six characters in — which lifts the body without the `async`, and every
   `await` in it then fails to parse. Look for the async form first. */
function extract(name){
  const async = SRC.indexOf(`async function ${name}(`);
  if (async >= 0) return extractFrom(async);
  const start = SRC.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`grab: function ${name} not found`);
  return extractFrom(start);
}
function extractFrom(start){
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
  throw new Error('grab: no end');
}

/* The real thing, over a fake wire.

   `postOnce` is replaced, and nothing else is: the chain order, the error
   classification, the budget arithmetic and the per-model request switches are
   all the shipped code. `sleep` is neutered so the pacing between laps does not
   make the test take as long as the outage it is describing — the waits it
   would have done are recorded instead, because "it paused before going round
   again" is one of the things worth holding. */
function harness(script, opts){
  const calls = [];
  const waits = [];
  const src = [
    'let __now = 0;',
    'const __calls = [];',
    'const __waits = [];',
    /* Time only moves when the fake transport says it did, so the budget
       arithmetic is exercised deterministically rather than against a clock. */
    'const Date = { now: () => __now };',
    'const sleep = (ms) => { __waits.push(ms); __now += ms; return Promise.resolve(); };',
    'async function postOnce(body, timeoutMs){',
    '  const step = __script[__calls.length];',
    '  __calls.push({ model: body.model, timeoutMs: timeoutMs, body: body });',
    /* A hang lasts exactly as long as the wall it was given, which is what a
       real one does — the request is cut off by the clock, not by the model. */
    '  const took = step && step.ms === "wall" ? timeoutMs : (step && step.ms != null ? step.ms : 0);',
    '  __now += took;',
    '  if (step && step.ok) return step.ok;',
    '  throw new Error(step ? step.err : "API returned 500 — no script left");',
    '}',
    extractConst('TEXT_MODELS'),
    extractConst('VISION_MODELS'),
    extract('chainFor'),
    extractConst('SULK_MS'),
    extractConst('sulking'),
    extractConst('noteHang'),
    extractConst('isSulking'),
    extract('liveChain'),
    extractConst('isReasoner'),
    extractConst('takesReasoningEffort'),
    extractConst('ATTEMPT_MS'),
    extractConst('RETRY_WAIT_MS'),
    extract('isRetryable'),
    extract('isGoneModel'),
    extractConst('TOTAL_BUDGET_MS'),
    extractConst('HARD_TRIES'),
    /* The real hedge, not a stand-in: postChat hands every attempt to it. With
       no hedge delay — which is every call these checks make — it forwards
       straight to postOnce above, so the chain is still exercised over the one
       fake wire. Stubbing it instead would have let a hedge that broke the
       chain pass here. The hedge's own racing is tools/hedge-test.mjs. */
    extract('postHedged'),
    extract('postChat'),
    'return { postChat, TEXT_MODELS, VISION_MODELS, calls: __calls, waits: __waits, now: () => __now, advance: (ms) => { __now += ms; } };',
  ].join('\n');
  const made = new Function('__script', src)(script);
  made.calls.push = Array.prototype.push;   // plain array, nothing clever
  return made;
}

const cases = [];
const check = (name, fn) => cases.push({ name, fn });
const eq = (got, want, what) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) throw new Error(`${what}: got ${a}, wanted ${b}`);
};

const OK = (text) => ({ ok: text, ms: 1200 });
const gone = (code) => ({ err: `API returned ${code} — model retired`, ms: 300 });
const busy = () => ({ err: 'API returned 503 — no capacity', ms: 400 });
const hang = () => ({ err: 'timed out — the AI took too long to respond', ms: 'wall' });
const dead = () => ({ err: 'API returned 401 — bad key', ms: 200 });

/* ------------------------------------------------------------------ */

check('the head answers, and nothing else is asked', () => {
  const h = harness([OK('cards')]);
  return h.postChat([{ role: 'user', content: 'x' }], 950, h.TEXT_MODELS[0], true).then(r => {
    eq(r, 'cards', 'reply');
    eq(h.calls.length, 1, 'calls');
    eq(h.calls[0].model, h.TEXT_MODELS[0], 'model asked');
  });
});

check('a retired head falls to the next model', () => {
  const h = harness([gone(410), OK('cards')]);
  return h.postChat([{ role: 'user', content: 'x' }], 950, h.TEXT_MODELS[0], true).then(r => {
    eq(r, 'cards', 'reply');
    eq(h.calls.map(c => c.model), [h.TEXT_MODELS[0], h.TEXT_MODELS[1]], 'order');
  });
});

check('and a retired model does not spend the time budget', () => {
  /* Three 410s cost 300ms each. If those counted as attempts the call would be
     over; what should happen instead is that the whole chain is found to be
     gone, which is a different error and a different message. */
  const h = harness([gone(410), gone(410), gone(404)]);
  return h.postChat([{ role: 'user', content: 'x' }], 950, h.TEXT_MODELS[0], true)
    .then(() => { throw new Error('should have thrown'); },
      (e) => {
        eq(h.calls.length, 3, 'one call per model, no more');
        if (!/404|410/.test(e.message)) throw new Error('the error should name the retirement: ' + e.message);
        if (h.now() > 5000) throw new Error('a retired chain should fail in seconds, took ' + h.now());
      });
});

check('a model that hangs is not asked twice in a row', () => {
  const h = harness([hang(), OK('cards')]);
  return h.postChat([{ role: 'user', content: 'x' }], 950, h.TEXT_MODELS[0], true).then(() => {
    eq(h.calls.map(c => c.model), [h.TEXT_MODELS[0], h.TEXT_MODELS[1]], 'second try is a different model');
  });
});

check('and it is not asked FIRST again on the next call', () => {
  const h = harness([hang(), OK('one'), OK('two')]);
  return h.postChat([{ role: 'user', content: 'x' }], 950, h.TEXT_MODELS[0], true)
    .then(() => h.postChat([{ role: 'user', content: 'y' }], 950, h.TEXT_MODELS[0], true))
    .then(() => {
      eq(h.calls[2].model, h.TEXT_MODELS[1], 'the second call starts with a model that answered');
    });
});

check('but it forgets, so a blip does not cost the whole evening', () => {
  /* The head is the head because it measured fastest. A model demoted for one
     bad minute and never promoted back means every call after it is slower than
     it needed to be, for as long as the student stays on the page. */
  const h = harness([hang(), OK('one'), { ok: 'two', ms: 1200 }]);
  return h.postChat([{ role: 'user', content: 'x' }], 950, h.TEXT_MODELS[0], true)
    .then(() => { h.advance(11 * 60 * 1000); })
    .then(() => h.postChat([{ role: 'user', content: 'y' }], 950, h.TEXT_MODELS[0], true))
    .then(() => {
      eq(h.calls[2].model, h.TEXT_MODELS[0], 'ten minutes on, the fastest model is tried first again');
    });
});

check('a busy chain waits before going round again', () => {
  const h = harness([busy(), busy(), busy(), OK('cards')]);
  return h.postChat([{ role: 'user', content: 'x' }], 950, h.TEXT_MODELS[0], true).then(r => {
    eq(r, 'cards', 'reply');
    eq(h.calls.length, 4, 'a full lap, then the head again');
    if (!h.waits.length) throw new Error('it should have paused before the second lap');
  });
});

check('a bad key stops at once — the next model cannot help', () => {
  const h = harness([dead(), OK('never reached')]);
  return h.postChat([{ role: 'user', content: 'x' }], 950, h.TEXT_MODELS[0], true)
    .then(() => { throw new Error('should have thrown'); },
      () => { eq(h.calls.length, 1, 'calls'); });
});

check('the worst case is the attempt schedule, and not a second longer', () => {
  /* Everything hangs, on every model. This is the state the student actually
     complained about, and the only thing standing between them and an unbounded
     wait is that the budget is a deadline. Read from the source, because the
     schedule moved once already: the point is that the walk obeys whatever it
     says, not that it says any particular thing. */
  const budget = ((SRC.match(/const ATTEMPT_MS = \[([^\]]+)\]/) || [])[1] || '')
    .split(',').map(n => Number(n.trim())).reduce((a, b) => a + b, 0);
  if (!budget) throw new Error('could not read ATTEMPT_MS from StudyFeed.jsx');
  const h = harness(Array.from({ length: 12 }, hang));
  return h.postChat([{ role: 'user', content: 'x' }], 950, h.TEXT_MODELS[0], true)
    .then(() => { throw new Error('should have thrown'); },
      () => {
        /* The overrun allowance is the retry pauses, which are paid on top. */
        if (h.now() > budget + 12000) throw new Error(`spent ${h.now()}ms of a ${budget}ms budget`);
        if (h.calls.length > 4) throw new Error(`${h.calls.length} attempts against a ${h.waits.length + 1}-wait schedule`);
      });
});

check('the first attempt is given the first wall clock, whatever it is set to', () => {
  /* The VALUE is not asserted here — `npm test`'s proxy check owns that, because
     what makes it right is its relationship to the proxy's own abort, which
     lives in another file. What this holds is that the schedule is used at all:
     a walk that quietly gave every attempt the same clock would still pass every
     other case in this file. */
  const first = Number((SRC.match(/const ATTEMPT_MS = \[\s*(\d+)/) || [])[1]);
  if (!first) throw new Error('could not read ATTEMPT_MS from StudyFeed.jsx');
  const h = harness([OK('cards')]);
  return h.postChat([{ role: 'user', content: 'x' }], 950, h.TEXT_MODELS[0], true).then(() => {
    eq(h.calls[0].timeoutMs, first, 'first attempt wall clock');
  });
});

check('reasoning switches are decided per MODEL, not once per call', () => {
  /* The head does not reason out loud, the nemotron member has to be told to
     stop, and gpt-oss takes a different lever entirely. A call that walks all
     three must send all three shapes — deciding this once, from the head, is
     how a fallback gets a request the model cannot use. */
  /* Busy rather than hung, so the walk reaches the third model: a hang spends a
     whole attempt and the budget only stretches to two of those. What is being
     checked here is the SHAPE of each request, not the failure handling. */
  const h = harness([busy(), busy(), OK('cards')]);
  return h.postChat([{ role: 'user', content: 'x' }], 950, h.TEXT_MODELS[0], true).then(() => {
    const [a, b, c] = h.calls;
    if (a.body.chat_template_kwargs) throw new Error('gemma is not a reasoner and was told to stop thinking');
    if (a.body.reasoning_effort) throw new Error('gemma does not take reasoning_effort');
    if (!b.body.chat_template_kwargs || b.body.chat_template_kwargs.thinking !== false)
      throw new Error('the nemotron member must be told not to think out loud, or its reply is a transcript');
    eq(c.body.reasoning_effort, 'low', 'gpt-oss takes reasoning_effort, and generation asks for low');
  });
});

check('marking is never given low reasoning, whichever model answers', () => {
  const h = harness([busy(), busy(), OK('grade')]);
  return h.postChat([{ role: 'user', content: 'x' }], 3000, h.TEXT_MODELS[0], undefined).then(() => {
    for (const c of h.calls)
      if (c.body.reasoning_effort) throw new Error(`${c.model} was asked to think less about a mark`);
  });
});

check('the vision chain is a different chain', () => {
  const h = harness([OK('read')]);
  return h.postChat([{ role: 'user', content: 'x' }], 1500, h.VISION_MODELS[0], false).then(() => {
    eq(h.calls[0].model, h.VISION_MODELS[0], 'a vision call must not fall onto a text model');
  });
});

/* ------------------------------------------------------------------ */

let pass = 0, fail = 0;
console.log('Model chain — offline, no endpoint\n');
for (const c of cases){
  try { await c.fn(); console.log(`ok   ${c.name}`); pass++; }
  catch (e){ console.log(`FAIL ${c.name}\n       ${e && e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
