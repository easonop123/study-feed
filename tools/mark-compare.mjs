/* ============================================================================
   TWO MARKING RUNS, SIDE BY SIDE.

     node tools/mark-compare.mjs <before.json> <after.json>

   `tools/mark-eval.mjs` answers "is this marker any good". This answers the
   question that actually gets asked, which is a different one: **is the new one
   worse than the one it replaced.** Those come apart. A run scoring 36/42 is
   meaningless on its own and decisive next to a 40/42.

   It exists because of a rule this repo already had and a swap that went out
   without honouring it. The README has said since August that changing the
   model "needs the full corpus re-run before it ships, the same standard that
   just ruled out low reasoning". On 18 Sep 2026 the model was changed anyway —
   for the good reason that the old one had stopped answering at all, so there
   was nothing to compare against that week — and the corpus was re-run
   afterwards. Doing it in that order is defensible exactly once. Making the
   comparison a command is what stops it needing to be defended again.

   WHAT IT WEIGHS, and it is not all equal:

   - **Grade in band** is the headline, but the DIRECTION of a miss matters more
     than the count. A marker that reads a Merit answer as Achieved is telling a
     student their work is worse than it is, and that is the feedback most
     likely to make them stop writing. A timeout says "try again" and is
     recoverable; a confident wrong grade is neither. So misses are split into
     harsher and kinder and reported separately.
   - **terse-correct** is called out by name. It is the case written to catch a
     marker that mistakes brevity for ignorance, it is the one that ruled out
     low reasoning in September, and a regression there is disqualifying however
     good the totals look.
   - **Balance** is an answer graded below Excellence whose notes are all
     praise. The model's default is to be encouraging; an all-good note set on a
     Not-yet answer is worse than no feedback, because the student reads it as
     confirmation.
   - **Anchoring** is notes quoting words the student did not write. The app
     drops those silently, so the visible result is feedback referring to
     highlights that are not there.
   ========================================================================== */

import { readFileSync } from 'node:fs';

const GRADES = ['Not yet', 'Achieved', 'Merit', 'Excellence'];
const rank = (g) => GRADES.indexOf(String(g));

const [beforePath, afterPath] = process.argv.slice(2);
if (!beforePath || !afterPath){
  console.log('usage: node tools/mark-compare.mjs <before.json> <after.json>');
  process.exit(1);
}

const load = (p) => {
  const raw = JSON.parse(readFileSync(p, 'utf8'));
  return Array.isArray(raw) ? raw : Object.values(raw);
};

/* Cases are matched by deck + card + kind rather than by position, because the
   corpus grows: comparing row 17 to row 17 across two runs taken a month apart
   silently compares two different answers, and would do it without ever looking
   wrong. Anything present in only one run is reported and left out of the
   totals. */
const key = (r) => `${r.deck}/${r.card}/${r.kind}`;

function summarise(rows){
  const graded = rows.filter(r => r.grade);
  const ok = graded.filter(r => r.gradeOk);
  const missed = graded.filter(r => !r.gradeOk);
  /* "Harsher" is measured against the TOP of the expected band, so an answer
     written to sit in Merit and graded Achieved counts as harsh even when the
     band is a range. */
  const harsher = missed.filter(r => rank(r.grade) < Math.max(...(r.expected || []).map(rank)));
  const times = rows.filter(r => r.ms > 0).map(r => r.ms).sort((a, b) => a - b);
  return {
    total: rows.length,
    answered: graded.length,
    lost: rows.length - graded.length,
    ok: ok.length,
    missed: missed.length,
    harsher: harsher.length,
    kinder: missed.length - harsher.length,
    balance: rows.filter(r => r.balanceBroken).length,
    dropped: rows.reduce((s, r) => s + (r.dropped || 0), 0),
    notes: rows.reduce((s, r) => s + (r.notes || 0), 0),
    truncated: rows.filter(r => r.truncated).length,
    median: times.length ? times[Math.floor(times.length / 2)] : 0,
    slowest: times.length ? times[times.length - 1] : 0,
    tokens: (() => {
      const t = rows.map(r => r.completionTokens).filter(n => n > 0).sort((a, b) => a - b);
      return t.length ? t[Math.floor(t.length / 2)] : 0;
    })(),
  };
}

const before = load(beforePath), after = load(afterPath);
const bMap = new Map(before.map(r => [key(r), r]));
const aMap = new Map(after.map(r => [key(r), r]));
const shared = [...aMap.keys()].filter(k => bMap.has(k));
const onlyAfter = [...aMap.keys()].filter(k => !bMap.has(k));
const onlyBefore = [...bMap.keys()].filter(k => !aMap.has(k));

const B = summarise(shared.map(k => bMap.get(k)));
const A = summarise(shared.map(k => aMap.get(k)));

const pct = (n, d) => d ? ((n / d) * 100).toFixed(0) + '%' : '—';
/* The word, not an arrow. An arrow has to be read against whether the number
   is one you want up or down, and half these rows are each way — "notes
   quoting nothing: 4 ↑ 0" is a genuine improvement that reads as a warning. */
const verdict = (b, a, goodIsUp) => {
  /* null means "for information" — a number worth seeing that is not by itself
     good or bad. Volume of notes is the clearest case: more is not better, and
     47 against 45 is noise being given a verdict it has not earned. */
  if (goodIsUp === null || a === b) return '      ';
  return ((goodIsUp ? a > b : a < b) ? 'better' : ' WORSE');
};

console.log(`Marking, before vs after — ${shared.length} cases in both runs`);
console.log(`before ${beforePath}`);
console.log(`after  ${afterPath}\n`);
if (onlyBefore.length) console.log(`(${onlyBefore.length} case(s) only in the before run, left out)`);
if (onlyAfter.length) console.log(`(${onlyAfter.length} case(s) only in the after run, left out)`);
if (onlyBefore.length || onlyAfter.length) console.log('');

const row = (label, b, a, goodIsUp, fmt) => {
  const f = fmt || (n => String(n));
  console.log(`${label.padEnd(28)} ${f(b).padStart(10)}  ${f(a).padStart(10)}  ${verdict(b, a, goodIsUp)}`);
};

console.log(`${''.padEnd(28)} ${'BEFORE'.padStart(10)}  ${'AFTER'.padStart(10)}`);
console.log('─'.repeat(58));
row('grade in band', B.ok, A.ok, true, n => `${n}/${B.answered} ${pct(n, B.answered)}`);
row('  of the misses, HARSHER', B.harsher, A.harsher, false);
row('  of the misses, kinder', B.kinder, A.kinder, false);
row('never answered', B.lost, A.lost, false);
row('all-praise note sets', B.balance, A.balance, false);
row('notes quoting nothing', B.dropped, A.dropped, false);
row('notes written in total', B.notes, A.notes, null);
row('replies cut off', B.truncated, A.truncated, false);
row('median seconds', B.median, A.median, false, n => (n / 1000).toFixed(1) + 's');
row('slowest', B.slowest, A.slowest, false, n => (n / 1000).toFixed(1) + 's');
row('median tokens written', B.tokens, A.tokens, null);

/* --- the case that is allowed to veto the totals -------------------------- */
const terse = shared.filter(k => bMap.get(k).kind === 'terse-correct');
if (terse.length){
  const bOk = terse.filter(k => bMap.get(k).gradeOk).length;
  const aOk = terse.filter(k => aMap.get(k).gradeOk).length;
  console.log('\nterse-correct — a short right answer read as ignorance');
  console.log(`  before ${bOk}/${terse.length}   after ${aOk}/${terse.length}`);
  if (aOk < bOk) console.log('  REGRESSION. This is the feedback most likely to make a student stop writing.');
}

/* --- every case whose grade moved ----------------------------------------- */
const moved = shared.filter(k => bMap.get(k).grade !== aMap.get(k).grade);
if (moved.length){
  console.log(`\n${moved.length} case${moved.length === 1 ? '' : 's'} graded differently`);
  for (const k of moved){
    const b = bMap.get(k), a = aMap.get(k);
    const flag = (b.gradeOk && !a.gradeOk) ? ' WORSE' : (!b.gradeOk && a.gradeOk) ? ' better' : '';
    console.log(`  ${k.padEnd(34)} ${String(b.grade).padEnd(11)} → ${String(a.grade).padEnd(11)} want ${(b.expected || []).join('/')}${flag}`);
  }
}

/* --- the verdict, stated rather than left to the reader ------------------- */
console.log('\n' + '─'.repeat(58));
const worse = [];
if (A.ok < B.ok) worse.push(`${B.ok - A.ok} fewer grades in band`);
if (A.harsher > B.harsher) worse.push(`${A.harsher - B.harsher} more answers marked harsher than they deserve`);
if (A.balance > B.balance) worse.push(`${A.balance - B.balance} more all-praise note sets`);
if (A.truncated > B.truncated) worse.push(`${A.truncated - B.truncated} more replies cut off`);
if (terse.length && terse.filter(k => aMap.get(k).gradeOk).length < terse.filter(k => bMap.get(k).gradeOk).length)
  worse.push('a terse-correct regression');

if (!worse.length) console.log('No regression on any measure that matters.');
else {
  console.log('REGRESSED: ' + worse.join('; ') + '.');
  console.log('A model that marks worse is not a faster model, it is a different product.');
}
process.exit(worse.length ? 1 : 0);
