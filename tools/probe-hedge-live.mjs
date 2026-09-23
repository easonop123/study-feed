/* Does the SHIPPED hedge actually cut the tail, end to end? The same-hour A/B
   behind GEN_HEDGE_MS — re-run it before moving that number.

   tools/hedge-test.mjs proves the racing logic over a fake wire. This runs the
   real client path — postChat (model chain and all) -> postHedged -> postOnce —
   lifted out of StudyFeed.jsx, against the live endpoint, on the real generate
   prompt, and records wall time and whether a duplicate was sent.

   Compare against the unhedged distribution measured the same afternoon with
   tools/probe-hedge.mjs (20 single requests): mean 30.2s, p90 65.3s, max 83.7s.
   Run with --off to take the same path with hedging disabled, for a same-hour
   baseline — the queue moves too much for a different hour to be a control. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'StudyFeed.jsx'), 'utf8');
function extract(name){
  let start = SRC.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('grab: function ' + name + ' not found');
  if (SRC.slice(start - 6, start) === 'async ') start -= 6;
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

const src = [
  /* The page calls a relative /api/nvidia; point it at the live site. */
  'const __fetch = globalThis.fetch;',
  'const fetch = (u, o) => __fetch(String(u).charAt(0) === "/" ? "https://studyfeed.app" + u : u, o);',
  'let __hedged = 0;',
  'function track(ev){ if (ev === "request_hedged") __hedged++; }',
  'let servedBy = "", servedWalk = 0;',
  'const sleep = (ms) => new Promise(r => setTimeout(r, ms));',
  extractConst('TEXT_MODELS'), extractConst('VISION_MODELS'), extract('chainFor'),
  extractConst('SULK_MS'), extractConst('sulking'), extractConst('noteHang'), extractConst('isSulking'),
  extract('liveChain'), extractConst('isReasoner'), extractConst('takesReasoningEffort'),
  extractConst('ATTEMPT_MS'), extractConst('RETRY_WAIT_MS'), extract('isRetryable'), extract('isGoneModel'),
  extractConst('TOTAL_BUDGET_MS'), extractConst('HARD_TRIES'), extractConst('GEN_HEDGE_MS'),
  extract('postOnce'), extract('postHedged'), extract('postChat'),
  ['NCEA_RULES', 'isNcea', 'nceaRules', 'STRICT_CLAUSE', 'COMMAND_VERBS'].map(extractConst).join('\n'),
  extract('mixTargets'), extract('mixedPrompt'),
  'return { postChat, mixedPrompt, GEN_HEDGE_MS, TEXT_MODELS, hedged: () => __hedged, served: () => servedBy };',
].join('\n\n');
const A = new Function(src)();

const GEN_MAX = Number((SRC.match(/const GEN_MAX_TOKENS = (\d+)/) || [])[1]) || 950;
const NOTES = [
  'Rate of reaction — how fast reactants are used up.',
  'Collision theory — particles must collide with enough energy to react.',
  'Temperature raises kinetic energy, so more frequent and more energetic collisions.',
  'Surface area: smaller pieces expose more particles.',
  'A catalyst lowers the activation energy and is not consumed.',
].join('\n');
/* Interleaved, one arm then the other, so both see the same queue. A run with
   hedging on at 3pm and off at 4pm would be measuring 3pm against 4pm. */
const N = Number(process.argv[process.argv.indexOf('--n') + 1]) || 8;
const prompt = A.mixedPrompt(NOTES, 'NCEA Level 1', 30, false);
console.log('Live, through the shipped postChat -> postHedged -> postOnce, hedge at ' + A.GEN_HEDGE_MS / 1000 + 's.');
console.log(N + ' pairs, alternating hedged and unhedged so both arms see the same queue.');
console.log('');
const arms = { on: [], off: [] };
let hedgedOn = 0;
for (let r = 0; r < N * 2; r++){
  const arm = r % 2 === 0 ? 'on' : 'off';
  const before = A.hedged();
  const t0 = Date.now();
  let status = 'ok';
  try { await A.postChat([{ role: 'user', content: prompt }], GEN_MAX, A.TEXT_MODELS[0], true, arm === 'on' ? A.GEN_HEDGE_MS : 0); }
  catch (e){ status = 'FAILED ' + String(e.message || e).slice(0, 50); }
  const ms = Date.now() - t0;
  const fired = A.hedged() > before;
  if (fired) hedgedOn++;
  if (status === 'ok') arms[arm].push(ms);
  console.log(String(r + 1).padStart(3) + '  ' + arm.padEnd(4) + (ms / 1000).toFixed(1).padStart(6) + 's  ' + (fired ? 'hedged ' : '       ') + A.served().padEnd(32) + (status === 'ok' ? '' : status));
}
const stat = (t) => { const s = t.slice().sort((a, b) => a - b), q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return 'n=' + s.length + '  mean ' + (s.reduce((a, b) => a + b, 0) / s.length / 1000).toFixed(1) + 's  median ' + (q(0.5) / 1000).toFixed(1) + 's  p90 ' + (q(0.9) / 1000).toFixed(1) + 's  max ' + (s[s.length - 1] / 1000).toFixed(1) + 's'; };
console.log('');
console.log('hedged    ' + stat(arms.on) + '   (duplicate sent ' + hedgedOn + '/' + N + ')');
console.log('unhedged  ' + stat(arms.off));
