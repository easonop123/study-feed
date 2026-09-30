/* Would racing two identical requests make generation faster? The measurement
   behind GEN_HEDGE_MS — re-run it before moving that number.

   Generation's latency on the free tier is not slow so much as WILD: the same
   prompt and the same ~530-token reply took 13.1, 28.2, 38.4, 40.3, 55.5 and
   81.3 seconds in one sitting (23 Sep 2026). The model is fast when it gets a
   slot (43 tok/s); what varies is the queue. The textbook answer to a fat tail
   is a hedged request — ask twice, take the first — but it only pays if two
   requests sent at the SAME moment land in different parts of the queue. If
   congestion is global, both are slow together and hedging doubles the load
   for nothing. That is the thing to measure, not assume.

   Each round fires A and B at the same instant and records both. From that:
     single   = A                    (what the app does today)
     race     = min(A, B)            (always send two)
     hedge@h  ≈ min(A, h + B)        (send the second only if A is slow)
   The hedge figure assumes B's latency would have been the same launched h
   seconds later, which is optimistic under bursty congestion — so the race
   column is the honest one, and the hedge columns are an upper bound. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'StudyFeed.jsx'), 'utf8');
function extract(name){
  let start = SRC.indexOf('function ' + name + '(');
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
}
function extractConst(name){
  const start = SRC.indexOf('const ' + name + ' = ');
  let str = null, esc = false, depth = 0;
  for (let i = start; i < SRC.length; i++){
    const c = SRC[i];
    if (str){ if (esc){ esc = false; continue; } if (c === '\\'){ esc = true; continue; } if (c === str) str = null; continue; }
    if (c === '"' || c === "'" || c === '`'){ str = c; continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ';' && depth === 0) return SRC.slice(start, i + 1);
  }
}
const G = new Function(['NCEA_RULES', 'isNcea', 'nceaRules', 'STRICT_CLAUSE', 'COMMAND_VERBS'].map(extractConst)
  .concat(['mixedPrompt', 'mixTargets'].map(extract)).join('\n\n') + '\nreturn { mixedPrompt };')();

const MODEL = (SRC.match(/const TEXT_MODELS = \[\s*'([^']+)'/) || [])[1];
const GEN_MAX = Number((SRC.match(/const GEN_MAX_TOKENS = (\d+)/) || [])[1]) || 950;
const NOTES = [
  'Rate of reaction — how fast reactants are used up.',
  'Collision theory — particles must collide with enough energy to react.',
  'Temperature raises kinetic energy, so more frequent and more energetic collisions.',
  'Surface area: smaller pieces expose more particles.',
  'A catalyst lowers the activation energy and is not consumed.',
].join('\n');
const body = JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: G.mixedPrompt(NOTES, 'NCEA Level 1', 30, false) }],
  temperature: 0.7, top_p: 0.9, max_tokens: GEN_MAX, stream: false });

async function one(){
  const t0 = Date.now();
  try {
    const res = await fetch('https://studyfeed.app/api/nvidia', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    await res.text();
    return { ms: Date.now() - t0, ok: res.ok, status: res.status };
  } catch (e){ return { ms: Date.now() - t0, ok: false, status: 'ERR' }; }
}

const ROUNDS = Number(process.argv[process.argv.indexOf('--rounds') + 1]) || 8;
const rows = [];
console.log('model ' + MODEL + ' — ' + ROUNDS + ' rounds, two identical requests fired together\n');
console.log('ROUND     A        B       race   |A-B|');
for (let r = 0; r < ROUNDS; r++){
  const [a, b] = await Promise.all([one(), one()]);
  rows.push({ a, b });
  const s = (x) => (x.ok ? (x.ms / 1000).toFixed(1) + 's' : 'HTTP ' + x.status).padStart(8);
  const race = (a.ok && b.ok) ? Math.min(a.ms, b.ms) : (a.ok ? a.ms : (b.ok ? b.ms : null));
  console.log(String(r + 1).padStart(5) + s(a) + ' ' + s(b) + (race == null ? '     -' : ((race / 1000).toFixed(1) + 's').padStart(8))
    + ((a.ok && b.ok) ? ((Math.abs(a.ms - b.ms) / 1000).toFixed(1) + 's').padStart(8) : ''));
}

const ok = rows.filter(r => r.a.ok && r.b.ok);
const stat = (arr) => { const s = arr.slice().sort((x, y) => x - y); const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { mean: s.reduce((x, y) => x + y, 0) / s.length, med: q(0.5), p90: q(0.9), max: s[s.length - 1] }; };
const fmt = (o) => ['mean', 'med', 'p90', 'max'].map(k => (k + ' ' + (o[k] / 1000).toFixed(1) + 's').padEnd(12)).join('');
const single = stat(ok.map(r => r.a.ms).concat(ok.map(r => r.b.ms)));
const race   = stat(ok.map(r => Math.min(r.a.ms, r.b.ms)));
console.log('\n' + ok.length + ' clean rounds' + (rows.length - ok.length ? ', ' + (rows.length - ok.length) + ' with a failure' : ''));
console.log('single       ' + fmt(single));
console.log('race (x2)    ' + fmt(race));
for (const h of [10, 15, 20, 25]){
  const hedge = stat(ok.map(r => Math.min(r.a.ms, h * 1000 + r.b.ms)));
  const extra = ok.filter(r => r.a.ms > h * 1000).length / ok.length;
  console.log(('hedge @' + h + 's').padEnd(13) + fmt(hedge) + '  (second request sent ' + Math.round(extra * 100) + '% of the time)');
}
/* Correlation: if |A-B| is small relative to the spread, the queue is global
   and racing buys little. Pearson r over the pairs. */
const xs = ok.map(r => r.a.ms), ys = ok.map(r => r.b.ms);
const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
let num = 0, dx = 0, dy = 0;
for (let i = 0; i < xs.length; i++){ num += (xs[i] - mx) * (ys[i] - my); dx += (xs[i] - mx) ** 2; dy += (ys[i] - my) ** 2; }
console.log('\ncorrelation between A and B: r = ' + (num / Math.sqrt(dx * dy)).toFixed(2) + '  (near 1 = congestion is global and racing is wasted)');
