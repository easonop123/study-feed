/* Does an unfinished answer survive a reload, and does it stop being offered
   when it should?

   Offline. readDraft / writeDraft / clearDraft / pruneDrafts are lifted out of
   StudyFeed.jsx at run time (the grab technique the evals use) and driven
   against a fake localStorage, so this tests the shipped code rather than a
   description of it.

     node tools/draft-store-test.mjs
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

/* A fake store, and the app's REAL load/save on top of it — so the JSON
   round-trip the app actually performs is part of what is under test. */
const harness = `
const STORE = {};
const IN_ARTIFACT = false;
const window = { localStorage: {
  getItem: (k) => (k in STORE ? STORE[k] : null),
  setItem: (k, v) => { STORE[k] = String(v); },
} };
${extract('load')}
${extract('save')}
${extractConst('DRAFT_KEY')}
${extractConst('DRAFT_MAX_AGE_MS')}
${extractConst('DRAFT_MAX')}
${extractConst('DRAFT_DEBOUNCE_MS')}
let draftCache = null;
let draftTimer = null;
${extract('pruneDrafts')}
${extract('readDraft')}
${extract('writeDraft')}
${extract('clearDraft')}
return {
  readDraft, writeDraft, clearDraft, pruneDrafts,
  DRAFT_MAX, DRAFT_MAX_AGE_MS, DRAFT_DEBOUNCE_MS,
  raw: () => STORE[DRAFT_KEY],
  /* "close the tab and come back": drop the in-memory cache so the next read
     has to go through storage, which is the whole thing being tested. */
  reload: () => { draftCache = null; if (draftTimer) clearTimeout(draftTimer); draftTimer = null; },
  wipe: () => { for (const k of Object.keys(STORE)) delete STORE[k]; draftCache = null; },
};
`;
const D = new Function(harness)();
const settle = () => new Promise(r => setTimeout(r, D.DRAFT_DEBOUNCE_MS + 60));

let failed = 0;
function check(name, got, want){
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (!ok) console.log(`       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`);
}

console.log('Answer drafts — an unfinished answer survives a reload\n');

D.wipe();
D.writeDraft('c1', 'the rate increases because');
await settle();
D.reload();
check('a half-written answer comes back after a reload', await D.readDraft('c1'), 'the rate increases because');

check('a card with no draft returns empty', await D.readDraft('never-typed'), '');
check('a missing id is not an error', await D.readDraft(''), '');

D.writeDraft('c1', 'the rate increases because the particles');
await settle();
D.reload();
check('the latest version wins', await D.readDraft('c1'), 'the rate increases because the particles');

D.writeDraft('c1', '');
await settle();
D.reload();
check('clearing the box drops the draft', await D.readDraft('c1'), '');

D.writeDraft('c2', '   \n  ');
await settle();
D.reload();
check('whitespace only is not a draft', await D.readDraft('c2'), '');

/* Grading the card is the app's signal that the answer is finished with. */
D.wipe();
D.writeDraft('c3', 'my finished answer');
await settle();
D.clearDraft('c3');
D.reload();
check('grading the card clears its draft', await D.readDraft('c3'), '');
check('clearing a card that has no draft is a no-op', D.clearDraft('nope'), undefined);

/* Stale drafts must not be handed back on a later review — the point of the
   card coming round again is producing the answer from memory. */
D.wipe();
const old = Date.now() - D.DRAFT_MAX_AGE_MS - 60000;
const aged = D.pruneDrafts({ fresh: { text: 'today', at: Date.now() }, stale: { text: 'last week', at: old } });
check('a draft older than the window is pruned', Object.keys(aged), ['fresh']);

const many = {};
for (let i = 0; i < D.DRAFT_MAX + 15; i++) many['k' + i] = { text: 'x', at: Date.now() - i * 1000 };
const capped = D.pruneDrafts(many);
check('the store is capped', Object.keys(capped).length, D.DRAFT_MAX);
check('and it keeps the most recent', capped['k0'] !== undefined && capped['k' + (D.DRAFT_MAX + 10)] === undefined, true);

check('pruning handles nothing at all', D.pruneDrafts(null), {});
check('pruning survives a junk entry', Object.keys(D.pruneDrafts({ a: null, b: { text: 'ok', at: Date.now() } })), ['b']);

/* Two cards open in one session must not bleed into each other. */
D.wipe();
D.writeDraft('x', 'answer for X');
D.writeDraft('y', 'answer for Y');
await settle();
D.reload();
check('drafts are per card (x)', await D.readDraft('x'), 'answer for X');
check('drafts are per card (y)', await D.readDraft('y'), 'answer for Y');

/* The debounce is the reason typing does not write on every keystroke — but
   the cache has to be right immediately, or a second reader in the same tick
   sees a stale answer. */
D.wipe();
D.writeDraft('fast', 'first');
D.writeDraft('fast', 'second');
D.writeDraft('fast', 'third');
check('the cache is correct before the debounce fires', await D.readDraft('fast'), 'third');
check('and nothing has been written yet', D.raw(), undefined);
await settle();
check('one write lands after the debounce', JSON.parse(D.raw()).fast.text, 'third');

console.log(`\n${failed ? failed + ' FAILED' : 'all passed'}`);
if (failed) process.exit(1);
