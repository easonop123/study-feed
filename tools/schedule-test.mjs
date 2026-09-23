/* ============================================================================
   SCHEDULER TEST — does Again/Hard/Good/Easy actually mean anything?

   SM-2 is the core mechanic of this app and the least visible: a card that
   comes back on the wrong day is not a crash, it is revision quietly wasted,
   and nobody would notice for weeks. Everything else in tools/ measures the
   model. This measures the part that has nothing to do with the model.

     node tools/schedule-test.mjs

   Offline. schedule, freshProgress, stateLabel, intervalWord, blendByRatio,
   Q, addDays and dayStr are lifted out of StudyFeed.jsx at run time, the same
   grab technique the evals use, so this cannot pass a scheduler the app has
   stopped shipping.
   ========================================================================== */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'StudyFeed.jsx'), 'utf8');

function extract(name){
  let start = SRC.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('grab: function ' + name + ' not found');
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

const G = new Function(`
${extractConst('dayStr')}
${extractConst('addDays')}
${extractConst('TODAY')}
${extractConst('Q')}
${extractConst('isLongCard')}
${extract('freshProgress')}
${extract('schedule')}
${extract('stateLabel')}
${extract('intervalWord')}
${extract('blendByRatio')}
return { dayStr, addDays, TODAY, Q, isLongCard, freshProgress, schedule, stateLabel, intervalWord, blendByRatio };
`)();

const { Q, schedule, freshProgress, stateLabel, intervalWord, blendByRatio, addDays, TODAY } = G;

let failed = 0;
function check(name, got, want){
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (!ok) console.log(`       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`);
}
/* Interval only — the bit a student feels. */
const ivl = (prev, q, wrong) => schedule(prev, q, wrong).next.interval;
const New = () => undefined;                       // a card never seen
const at = (o) => ({ ...freshProgress(), seen: true, ...o });

console.log('Scheduler — the four buttons have to mean four different things\n');

console.log('  — a brand new card —');
check('Hard',  ivl(New(), Q.HARD),  1);
check('Good',  ivl(New(), Q.GOOD),  2);
check('Easy',  ivl(New(), Q.EASY),  4);
const first = schedule(New(), Q.GOOD).next;
check('a review counts', first.reps, 1);
check('and the card is now seen', first.seen, true);
check('due lands interval days out', first.due, addDays(TODAY(), 2));

console.log('\n  — second review —');
check('Hard', ivl(at({ reps: 1, interval: 2 }), Q.HARD), 3);
check('Good', ivl(at({ reps: 1, interval: 2 }), Q.GOOD), 6);
check('Easy', ivl(at({ reps: 1, interval: 2 }), Q.EASY), 10);

/* The whole reason the graduating steps exist: plain SM-2 gave Hard, Good and
   Easy the SAME interval for the first two reviews, so all four buttons
   previewed the same date and the choice was theatre. */
const firstRow  = [ivl(New(), Q.HARD), ivl(New(), Q.GOOD), ivl(New(), Q.EASY)];
const secondRow = [Q.HARD, Q.GOOD, Q.EASY].map(q => ivl(at({ reps: 1, interval: 2 }), q));
check('first review: three different answers', new Set(firstRow).size, 3);
check('second review: three different answers', new Set(secondRow).size, 3);
check('and each one is bigger than the last (1st)', firstRow, [...firstRow].sort((a, b) => a - b));
check('and each one is bigger than the last (2nd)', secondRow, [...secondRow].sort((a, b) => a - b));

console.log('\n  — settled cards multiply by ease —');
const settled = at({ reps: 3, interval: 10, ease: 2.5 });
check('Good multiplies by ease', ivl(settled, Q.GOOD), 25);
check('Easy adds its own bonus', Math.round(ivl(settled, Q.EASY) * 100) / 100, 10 * 2.65 * 1.3);
check('Hard barely moves', Math.round(ivl(settled, Q.HARD) * 100) / 100, 12);
check('Good beats Hard', ivl(settled, Q.GOOD) > ivl(settled, Q.HARD), true);
check('Easy beats Good', ivl(settled, Q.EASY) > ivl(settled, Q.GOOD), true);

console.log('\n  — Again —');
const lapsed = schedule(settled, Q.AGAIN);
check('comes back today', lapsed.next.due, TODAY());
check('and again in this sitting', lapsed.reinsert, true);
check('reps reset', lapsed.next.reps, 0);
check('a lapse is counted', lapsed.next.lapses, 1);
check('ease drops', Math.round(lapsed.next.ease * 100) / 100, 2.3);
check('nothing else reinserts', schedule(settled, Q.GOOD).reinsert, false);

console.log('\n  — ease has a floor, or intervals collapse —');
let low = at({ reps: 3, interval: 10, ease: 1.35 });
check('Again cannot take ease below 1.3', schedule(low, Q.AGAIN).next.ease, 1.3);
check('nor can Hard', schedule(low, Q.HARD).next.ease, 1.3);
let floored = at({ reps: 3, interval: 10, ease: 1.3 });
for (let i = 0; i < 20; i++) floored = schedule(floored, Q.AGAIN).next;
check('and it stays there however many lapses', floored.ease, 1.3);

console.log('\n  — "you thought you had this" —');
check('a card you had built up, then blanked, is flagged',
  schedule(at({ reps: 3, interval: 10 }), Q.AGAIN).next.flagged, true);
check('a card on a long interval counts as known too',
  schedule(at({ reps: 1, interval: 6 }), Q.AGAIN).next.flagged, true);
check('a card you barely know is NOT flagged — that is just learning',
  schedule(at({ reps: 1, interval: 2 }), Q.AGAIN).next.flagged, false);
check('a brand new card is never flagged',
  schedule(New(), Q.AGAIN).next.flagged, false);
check('committing to a wrong multi-choice flags it even when new',
  schedule(New(), Q.AGAIN, true).next.flagged, true);
check('getting it right clears the flag',
  schedule(at({ reps: 3, interval: 10, flagged: true }), Q.GOOD).next.flagged, false);
check('Hard does NOT clear it',
  schedule(at({ reps: 3, interval: 10, flagged: true }), Q.HARD).next.flagged, true);

console.log('\n  — a flagged card comes back harder —');
const plainIvl   = ivl(at({ reps: 3, interval: 10 }), Q.HARD);
const flaggedIvl = ivl(at({ reps: 3, interval: 10, flagged: true }), Q.HARD);
check('its interval is halved', flaggedIvl, plainIvl / 2);
check('clearing the flag means no halving',
  ivl(at({ reps: 3, interval: 10, flagged: true }), Q.GOOD), 25);

console.log('\n  — invariants —');
let p = freshProgress();
for (let i = 0; i < 40; i++){
  const q = [Q.AGAIN, Q.HARD, Q.GOOD, Q.EASY][i % 4];
  p = schedule(p, q).next;
  if (p.interval < 1 && p.due !== TODAY()){ console.log('  FAIL interval fell below a day'); failed++; break; }
  if (p.ease < 1.3){ console.log('  FAIL ease fell through the floor'); failed++; break; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.due)){ console.log('  FAIL due is not a date: ' + p.due); failed++; break; }
  if (p.lapses < 0 || p.reps < 0){ console.log('  FAIL negative counter'); failed++; break; }
}
check('40 mixed reviews keep every invariant', true, true);
check('a fractional interval still lands on a real date',
  /^\d{4}-\d{2}-\d{2}$/.test(schedule(at({ reps: 3, interval: 7, ease: 2.36 }), Q.GOOD).next.due), true);
check('scheduling never mutates what it was given', (() => {
  const before = at({ reps: 3, interval: 10, ease: 2.5 });
  const copy = JSON.stringify(before);
  schedule(before, Q.AGAIN);
  return JSON.stringify(before) === copy;
})(), true);
check('a progress object from an older version still schedules',
  ivl({ ease: 2.5, interval: 10, reps: 3, due: '2020-01-01', seen: true }, Q.GOOD), 25);

console.log('\n  — what the student is told —');
check('a new card says New', stateLabel(null), 'New');
check('a flagged card says so', stateLabel(at({ flagged: true })), 'Keeps tripping you up');
check('a card due today says Due now', stateLabel(at({ due: TODAY() })), 'Due now');
check('tomorrow is one day, singular', stateLabel(at({ due: addDays(TODAY(), 1) })), 'In 1 day');
check('further out is plural', stateLabel(at({ due: addDays(TODAY(), 9) })), 'In 9 days');
check('an overdue card still reads as due', stateLabel(at({ due: addDays(TODAY(), -30) })), 'Due now');
check('one day reads as tomorrow', intervalWord(1), 'tomorrow');
check('under a month reads in days', intervalWord(9), '9 days');
check('a month reads as a month', intervalWord(30), 'a month');
check('longer reads in months', intervalWord(90), '3 months');
check('a fraction never previews as zero', intervalWord(0.4), 'tomorrow');

console.log('\n  — the quick/long blend —');
const L = (n) => Array.from({ length: n }, (_, i) => 'L' + i);
const Qk = (n) => Array.from({ length: n }, (_, i) => 'q' + i);
const mix = blendByRatio(L(5), Qk(15), 30);
check('nothing is dropped', mix.length, 20);
check('every card appears exactly once', new Set(mix).size, 20);
check('0% long still keeps the long ones', blendByRatio(L(3), Qk(3), 0).length, 6);
check('100% long still keeps the quick ones', blendByRatio(L(3), Qk(3), 100).length, 6);
check('long only', blendByRatio(L(4), [], 30), ['L0', 'L1', 'L2', 'L3']);
check('quick only', blendByRatio([], Qk(3), 30), ['q0', 'q1', 'q2']);
check('nothing at all', blendByRatio([], [], 30), []);
check('a 30% ask puts long cards in the minority',
  mix.filter(x => x[0] === 'L').length <= mix.length * 0.35, true);

console.log(`\n${failed ? failed + ' FAILED' : 'all passed'}`);
if (failed) process.exit(1);
