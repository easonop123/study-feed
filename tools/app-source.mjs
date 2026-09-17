/* Reading facts out of StudyFeed.jsx, in one place.

   Every checker in this folder reads its settings out of the app rather than
   retyping them, which is the rule that stops a checker quietly testing a
   request the app has stopped sending. The cost of that rule is that each tool
   knows the SHAPE of the source, and on 17 Sep 2026 the shape changed: the
   model ids became chains — `const MODEL_SMART = TEXT_MODELS[0]` instead of a
   string — so that every AI feature could fall past a model NVIDIA had retired
   instead of stopping with it.

   Six tools matched that line as a string literal, and six tools broke at once.
   None of them was wrong; the lookup was simply written out six times. It lives
   here now, so the next change to the shape is one edit. */

/* The model id a MODEL_* constant resolves to, whether it is written as a
   literal or as the head of a chain. Returns '' if the constant is not there at
   all, which every caller should treat as a reason to stop rather than to
   guess — a checker that invents a model id is testing nothing. */
export function modelNamed(src, name){
  const direct = (src.match(new RegExp('const ' + name + '\\s*=\\s*\'([^\']+)\'')) || [])[1];
  if (direct) return direct;
  const via = src.match(new RegExp('const ' + name + '\\s*=\\s*([A-Z_]+)\\s*\\[\\s*(\\d+)\\s*\\]')) || [];
  if (!via[1]) return '';
  return chain(src, via[1])[Number(via[2])] || '';
}

/* Every id in one of the chains, in order. */
export function chain(src, name){
  const block = (src.match(new RegExp('const ' + name + '\\s*=\\s*\\[([\\s\\S]*?)\\];')) || [])[1] || '';
  return [...block.matchAll(/'([^']+)'/g)].map(m => m[1]);
}

/* A numeric constant, whether it is typed as a number or worked out.

   `GEN_MAX_TOKENS` stopped being a literal on 17 Sep 2026: it is derived from a
   measured write rate, because the number that matters is "what can this
   endpoint actually finish in the time it is given" and that is arithmetic, not
   taste. A checker matching `= (\d+)` silently stopped finding it and fell back
   to a default — which is worse than not reading it at all, since it then tests
   a request the app does not send and reports on a feature that does not exist.

   So evaluate it. Only plain arithmetic over other all-caps constants from the
   same file is allowed through; anything else returns undefined and the caller
   should stop rather than guess. */
export function numberNamed(src, name){
  const m = src.match(new RegExp('const ' + name + '\\s*=\\s*([^;\\n]+);'));
  if (!m) return undefined;
  const expr = m[1].trim();
  if (/^\d+$/.test(expr)) return Number(expr);
  if (!/^[\sA-Z_0-9.()*/+\-]*$/.test(expr.replace(/Math\.\w+/g, ''))) return undefined;
  const deps = [...src.matchAll(/const ([A-Z][A-Z_0-9]*)\s*=\s*(\d+(?:\.\d+)?)\s*;/g)]
    .map(d => `const ${d[1]} = ${d[2]};`).join('\n');
  try {
    const v = Number(new Function(`${deps}\nreturn (${expr});`)());
    return Number.isFinite(v) ? v : undefined;
  } catch { return undefined; }
}

/* Every model id the app can end up sending, heads and fallbacks alike. */
export function allModels(src){
  return [...new Set([
    ...chain(src, 'TEXT_MODELS'),
    ...chain(src, 'VISION_MODELS'),
    ...[...src.matchAll(/const MODEL_[A-Z]+\s*=\s*'([^']+)'/g)].map(m => m[1]),
  ])];
}

/* The proxy's own time budget, read from `api/nvidia.js`.

   Every checker here needs a deadline of its own, because undici will sit on a
   stalled HTTP/2 stream for five minutes before throwing and take the rest of
   the run down with it. That deadline only makes sense relative to the proxy:
   it has to be comfortably past the point where the proxy gives up and returns
   its own 504, or the checker starts reporting timeouts for answers that were
   about to arrive — which is the same mistake the CLIENT made once, and the
   reason `npm test` polices the three numbers.

   Three files had `90000` written out with a comment saying "the proxy gives up
   at 55s, so nothing still open at 90 is coming". When the proxy's budget moved
   to 85s that sentence became false in all three at once, and the number became
   a deadline 5 seconds after the server's — close enough to cut off real
   replies. Derived here instead. */
export function proxyBudget(proxySrc){
  const maxDuration = Number((proxySrc.match(/export const maxDuration = (\d+)/) || [])[1]) || 0;
  const slack = Number((proxySrc.match(/const UPSTREAM_ABORT_MS = \(maxDuration - (\d+)\)/) || [])[1]);
  const abortMs = (maxDuration && Number.isFinite(slack)) ? (maxDuration - slack) * 1000 : 0;
  return { maxDuration, abortMs };
}

/* How long a checker should wait before calling a request dead: the proxy's
   abort plus enough room for the 504 to travel. Generous on purpose — a
   checker that gives up early reports a broken feature that works. */
export function checkerDeadlineMs(proxySrc){
  const { abortMs } = proxyBudget(proxySrc);
  if (!abortMs) throw new Error('could not read the proxy time budget from api/nvidia.js');
  return abortMs + 35000;
}

/* The model a checker should use: the app's, unless `--model <id>` says
   otherwise.

   Every eval here reads the chain head so that an ordinary run measures what
   students actually get. But the moment that matters most is the one where you
   are choosing a REPLACEMENT, and then the default is the wrong thing entirely.
   Without a flag, trying a candidate means editing StudyFeed.jsx, running the
   corpus and remembering to put the old id back — three steps, one of which is
   "remember", and the one that gets forgotten leaves an unmeasured model
   shipping. That is not hypothetical: it is what happened on 18 Sep 2026.

   The candidate still has to be in ALLOWED_MODELS or the proxy turns it away,
   which is the right gate. A model nobody has allowed is a model nobody can
   ship, so there is no point measuring it. */
export function modelFromArgs(src, argv, name){
  const i = (argv || []).indexOf('--model');
  if (i > 0 && argv[i + 1]) return argv[i + 1];
  return modelNamed(src, name || 'MODEL_SMART');
}
