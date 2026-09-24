/* Would hedging MARKING help, and would it change the marks? The measurement
   behind marking NOT being hedged (see the note above GEN_HEDGE_MS):
   r = 0.97 between a pair, all 12 pairs graded the same.

   Generation got hedged on the strength of tools/probe-hedge.mjs. Marking is a
   different question twice over. First, does it even have the fat tail? Second,
   and the one that matters: a race keeps whichever reply finishes FIRST, and a
   shorter reply finishes sooner — so racing could quietly prefer marks with
   fewer notes, or a different grade. For generation that bias is harmless (a
   few fewer cards). For marking it would be the product's core claim drifting.

   So each round fires two identical marking requests, lets BOTH finish, and
   records time, grade, note count and reply length for each. That answers both:
     latency  — single vs min(A,B), and the pair correlation
     bias     — is the faster reply systematically shorter, or graded differently?
   Uses the real markPrompt and a real merit-band answer from the eval corpus. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CASES } from './mark-eval-cases.mjs';
import { STARTER_DECKS } from '../starter-decks.js';

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
const G = new Function(['NCEA_RULES', 'isNcea', 'nceaRules'].map(extractConst)
  .concat(['markPrompt', 'rescueObjects'].map(extract)).join('\n\n') + '\nreturn { markPrompt, rescueObjects };')();

const MODEL = (SRC.match(/const TEXT_MODELS = \[\s*'([^']+)'/) || [])[1];
const CEIL = Number((SRC.match(/markPrompt\(card, answer, level\), (\d+)/) || [])[1]) || 3000;

/* One merit-band case and one excellence-band case — Excellence is the grade
   that collapsed under low reasoning, so it is the one to watch for drift. */
const pick = (kind) => CASES.find(c => c.kind === kind);
/* Cases name a starter deck and an index into its extended cards — resolved
   the same way tools/mark-eval.mjs does, so this marks the same questions. */
const cardFor = (kase) => {
  const deck = STARTER_DECKS.find(d => d.slug === kase.deck);
  const longs = deck ? deck.cards.filter(c => c.type === 'extended') : [];
  return longs[kase.cardIndex];
};
const cases = ['merit', 'excellence'].map(pick).filter(Boolean).map(k => ({ ...k, card: cardFor(k) })).filter(k => k.card);
if (!cases.length) throw new Error('no merit/excellence case in mark-eval-cases.mjs — check its shape');

async function one(kase){
  const body = JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: G.markPrompt(kase.card, kase.answer, kase.level || 'NCEA Level 1') }],
    temperature: 0.7, top_p: 0.9, max_tokens: CEIL, stream: false });
  const t0 = Date.now();
  try {
    const res = await fetch('https://studyfeed.app/api/nvidia', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    const text = await res.text();
    const ms = Date.now() - t0;
    if (!res.ok) return { ms, ok: false, status: res.status };
    const p = JSON.parse(text);
    const reply = (p.choices && p.choices[0] && p.choices[0].message && p.choices[0].message.content) || '';
    const o = G.rescueObjects(reply)[0] || {};
    return { ms, ok: true, grade: o.grade || '?', notes: Array.isArray(o.notes) ? o.notes.length : 0,
      tok: p.usage ? p.usage.completion_tokens : null };
  } catch (e){ return { ms: Date.now() - t0, ok: false, status: 'ERR' }; }
}

const ROUNDS = Number(process.argv[process.argv.indexOf('--rounds') + 1]) || 6;
console.log('model ' + MODEL + ', ceiling ' + CEIL + ' — ' + ROUNDS + ' rounds per case, two identical marks fired together, both allowed to finish\n');
const rows = [];
for (const kase of cases){
  console.log(kase.kind.toUpperCase() + ' case (' + (kase.deck || '') + ')');
  console.log('  ROUND     A (grade, notes, tok)          B (grade, notes, tok)          faster');
  for (let r = 0; r < ROUNDS; r++){
    const [a, b] = await Promise.all([one(kase), one(kase)]);
    rows.push({ kind: kase.kind, a, b });
    const f = (x) => x.ok ? ((x.ms / 1000).toFixed(1) + 's ' + x.grade + ', ' + x.notes + 'n, ' + x.tok + 't').padEnd(30) : ('HTTP ' + x.status).padEnd(30);
    const faster = (a.ok && b.ok) ? (a.ms <= b.ms ? 'A' : 'B') : '-';
    console.log('  ' + String(r + 1).padStart(5) + '     ' + f(a) + ' ' + f(b) + ' ' + faster);
  }
  console.log('');
}

const ok = rows.filter(r => r.a.ok && r.b.ok);
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const q = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const singles = ok.flatMap(r => [r.a.ms, r.b.ms]);
const races = ok.map(r => Math.min(r.a.ms, r.b.ms));
console.log(ok.length + ' clean pairs');
console.log('latency   single mean ' + (mean(singles) / 1000).toFixed(1) + 's p90 ' + (q(singles, 0.9) / 1000).toFixed(1) + 's max ' + (Math.max(...singles) / 1000).toFixed(1) + 's');
console.log('          race   mean ' + (mean(races) / 1000).toFixed(1) + 's p90 ' + (q(races, 0.9) / 1000).toFixed(1) + 's max ' + (Math.max(...races) / 1000).toFixed(1) + 's');
/* The bias check: compare the winner of each race with its loser. */
const win = ok.map(r => r.a.ms <= r.b.ms ? r.a : r.b), lose = ok.map(r => r.a.ms <= r.b.ms ? r.b : r.a);
console.log('bias      winner tokens ' + mean(win.map(x => x.tok)).toFixed(0) + ' vs loser ' + mean(lose.map(x => x.tok)).toFixed(0)
  + '   winner notes ' + mean(win.map(x => x.notes)).toFixed(2) + ' vs loser ' + mean(lose.map(x => x.notes)).toFixed(2));
const sameGrade = ok.filter(r => r.a.grade === r.b.grade).length;
console.log('          pairs that agreed on the grade: ' + sameGrade + '/' + ok.length);
const GR = ['Not yet', 'Achieved', 'Merit', 'Excellence'];
const lvl = (g) => GR.indexOf(g);
const winHigher = ok.filter(r => { const w = r.a.ms <= r.b.ms ? r.a : r.b, l = r.a.ms <= r.b.ms ? r.b : r.a; return lvl(w.grade) > lvl(l.grade); }).length;
const winLower = ok.filter(r => { const w = r.a.ms <= r.b.ms ? r.a : r.b, l = r.a.ms <= r.b.ms ? r.b : r.a; return lvl(w.grade) < lvl(l.grade); }).length;
console.log('          where they disagreed, the faster one graded higher ' + winHigher + 'x, lower ' + winLower + 'x');
const xs = ok.map(r => r.a.ms), ys = ok.map(r => r.b.ms), mx = mean(xs), my = mean(ys);
let num = 0, dx = 0, dy = 0;
for (let i = 0; i < xs.length; i++){ num += (xs[i] - mx) * (ys[i] - my); dx += (xs[i] - mx) ** 2; dy += (ys[i] - my) ** 2; }
console.log('          latency correlation r = ' + (num / Math.sqrt(dx * dy)).toFixed(2));
