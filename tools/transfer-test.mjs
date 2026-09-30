/* ============================================================================
   TRANSFER TEST — can a deck move without anything being lost or overwritten?

   Decks cost money to generate and there are no accounts, so export/import IS
   the backup, the second device and the way a deck reaches a friend. The
   promise on the tin is specific: "importing only ever adds — ids clash-remap
   so a friend's deck can't overwrite yours, and progress follows the remapped
   ids so your own backups keep their history." Nothing checked it.

     node tools/transfer-test.mjs

   Offline. buildExport, mergeImport, safeFileName, exportName and uid are
   lifted out of StudyFeed.jsx at run time, the same grab technique the evals
   use, so this cannot pass a version the app has stopped shipping.
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
${extractConst('TODAY')}
${extractConst('uid')}
${extract('buildExport')}
${extract('mergeImport')}
${extract('safeFileName')}
${extractConst('exportName')}
return { buildExport, mergeImport, safeFileName, exportName, uid };
`)();
const { buildExport, mergeImport, safeFileName, exportName } = G;

let failed = 0;
function check(name, got, want){
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (!ok) console.log(`       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`);
}
const card = (id, front) => ({ id, type: 'flip', front: front || ('Q' + id), back: 'A' + id });
const deck = (id, cards, extra) => ({ id, subject: 'Chemistry', topic: 'Rates', standard: 'NCEA Level 1', cards, ...extra });
const prog = (o) => o;
const allCardIds = (lib) => lib.decks.flatMap(d => d.cards.map(c => c.id));
const clone = (o) => JSON.parse(JSON.stringify(o));

console.log('Transfer — a deck has to move without losing or overwriting anything\n');

console.log('  — export —');
const mine = { decks: [deck('d1', [card('c1'), card('c2')])] };
const myProg = prog({ c1: { reps: 3, interval: 10 }, ghost: { reps: 9 } });
const exp = buildExport(mine.decks, myProg);
check('it is labelled as ours', [exp.kind, exp.version], ['study-feed', 1]);
check('the decks travel', exp.decks.length, 1);
check('progress for the exported cards travels', Object.keys(exp.progress), ['c1']);
check('progress for cards that are NOT in it does not', exp.progress.ghost, undefined);

console.log('\n  — a backup coming home to an empty device —');
const restored = mergeImport(clone(exp), { decks: [] }, {});
check('the deck arrives', restored.decks.length, 1);
check('with its cards', restored.decks[0].cards.length, 2);
check('ids are kept, so there is nothing to remap', allCardIds(restored).sort(), ['c1', 'c2']);
check('and the review history comes with it', restored.progress.c1.reps, 3);
check('the deck keeps its own id', restored.decks[0].id, 'd1');

console.log('\n  — a friend\'s deck that happens to share your ids —');
const theirs = { kind: 'study-feed', version: 1,
  decks: [deck('d1', [card('c1', 'THEIR question'), card('c2')])],
  progress: { c1: { reps: 99, interval: 400 } } };
const merged = mergeImport(clone(theirs), clone(mine), clone(myProg));
check('nothing is overwritten — both decks are there', merged.decks.length, 2);
check('your deck is untouched', merged.decks[0].cards[0].front, 'Qc1');
check('theirs arrived alongside', merged.decks[1].cards[0].front, 'THEIR question');
check('every card id in the library is unique', new Set(allCardIds(merged)).size, allCardIds(merged).length);
check('every DECK id in the library is unique',
  new Set(merged.decks.map(d => d.id)).size, merged.decks.length);
check('your own progress survives', merged.progress.c1.reps, 3);
check('their progress followed their remapped card', (() => {
  const theirNewId = merged.decks[1].cards[0].id;
  return merged.progress[theirNewId] && merged.progress[theirNewId].reps;
})(), 99);
check('the caller is told what arrived', [merged.deckCount, merged.cardCount], [1, 2]);

console.log('\n  — one payload carrying two decks with the SAME id —');
/* Not something this app exports, but an import is an outside file: two
   exports pasted together, or a hand-edited one. Two decks sharing an id in
   the library is not recoverable from the UI — they render on the same React
   key and edit/delete cannot tell them apart. */
const twins = { kind: 'study-feed', version: 1,
  decks: [deck('same', [card('a1')]), deck('same', [card('a2')])], progress: {} };
const twinned = mergeImport(clone(twins), { decks: [] }, {});
check('both decks arrive', twinned.decks.length, 2);
check('but they do NOT share an id',
  new Set(twinned.decks.map(d => d.id)).size, twinned.decks.length);

console.log('\n  — the same file imported twice —');
const once = mergeImport(clone(exp), { decks: [] }, {});
const twice = mergeImport(clone(exp), once, once.progress);
check('it adds rather than replacing', twice.decks.length, 2);
check('and still nothing collides', new Set(allCardIds(twice)).size, allCardIds(twice).length);
check('deck ids stay unique too', new Set(twice.decks.map(d => d.id)).size, 2);

console.log('\n  — junk in, sensible out —');
const threw = (fn) => { try { fn(); return ''; } catch (e){ return e.message; } };
check('a file that is not ours is rejected',
  threw(() => mergeImport({ hello: 'world' }, { decks: [] }, {})), 'That file is not a Study Feed export.');
check('null is rejected', threw(() => mergeImport(null, { decks: [] }, {})), 'That file is not a Study Feed export.');
check('an empty deck list is rejected',
  threw(() => mergeImport({ decks: [] }, { decks: [] }, {})), 'No decks found in that file.');
check('a deck with no usable cards is rejected, not silently added',
  threw(() => mergeImport({ decks: [deck('x', [{ nope: true }])] }, { decks: [] }, {})), 'No decks found in that file.');
check('a card with no id is given one', (() => {
  const r = mergeImport({ decks: [deck('n', [{ type: 'flip', front: 'f', back: 'b' }])] }, { decks: [] }, {});
  return !!r.decks[0].cards[0].id;
})(), true);
check('a deck with no id is given one, not undefined', (() => {
  const r = mergeImport({ decks: [{ subject: 'X', cards: [card('noid1')] }] }, { decks: [] }, {});
  return typeof r.decks[0].id === 'string' && r.decks[0].id.length > 0;
})(), true);
check('two id-less decks do not share the id they are given', (() => {
  const r = mergeImport({ decks: [{ cards: [card('m1')] }, { cards: [card('m2')] }] }, { decks: [] }, {});
  return r.decks[0].id !== r.decks[1].id;
})(), true);
check('a missing subject does not produce "undefined"',
  mergeImport({ decks: [{ id: 'z', cards: [card('z1')] }] }, { decks: [] }, {}).decks[0].subject, 'Untitled');
check('a missing standard falls back',
  mergeImport({ decks: [{ id: 'z', cards: [card('z1')] }] }, { decks: [] }, {}).decks[0].standard, 'NCEA Level 1');
check('a payload with no progress at all is fine', (() => {
  const r = mergeImport({ decks: [deck('p', [card('p1')])] }, { decks: [] }, {});
  return Object.keys(r.progress).length;
})(), 0);

console.log('\n  — importing must not mutate what you already had —');
const before = clone(mine);
const beforeProg = clone(myProg);
mergeImport(clone(theirs), mine, myProg);
check('the library is untouched', mine, before);
check('progress is untouched', myProg, beforeProg);

console.log('\n  — filenames —');
check('spaces and punctuation become dashes', safeFileName('Rates of Reaction!', 'deck'), 'rates-of-reaction');
check('a name that is all punctuation falls back', safeFileName('!!!', 'deck'), 'deck');
check('an empty name falls back', safeFileName('', 'deck'), 'deck');
check('no leading or trailing dashes', safeFileName('  --Acids & Bases--  ', 'deck'), 'acids-bases');
check('one deck is named after it', exportName([{ topic: 'Rates of reaction' }]).startsWith('study-feed-rates-of-reaction-'), true);
check('several decks are not', /^study-feed-\d{4}-\d{2}-\d{2}\.json$/.test(exportName([{}, {}])), true);
check('a deck with no topic still gets a filename',
  exportName([{ subject: 'Chemistry' }]).startsWith('study-feed-chemistry-'), true);

console.log(`\n${failed ? failed + ' FAILED' : 'all passed'}`);
if (failed) process.exit(1);
