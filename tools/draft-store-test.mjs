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
/* Pretend to be the Artifact, where reading storage is a real async round
   trip, and make that trip SLOW on demand. The website's localStorage path is
   still async (load is an async function) but resolves in a microtask, which
   is too small a window to catch the race this is here to test. */
let READ_DELAY = 0;
const IN_ARTIFACT = true;
const window = { storage: {
  get: (k) => new Promise(r => setTimeout(() => r(k in STORE ? { value: STORE[k] } : null), READ_DELAY)),
  set: (k, v) => { STORE[k] = String(v); return Promise.resolve(); },
} };
${extract('load')}
${extract('save')}
${extractConst('DRAFT_KEY')}
${extractConst('DRAFT_MAX_AGE_MS')}
${extractConst('DRAFT_MAX')}
${extractConst('DRAFT_DEBOUNCE_MS')}
let draftCache = null;
let draftPending = null;
let draftLoading = null;
let draftTimer = null;
${extract('pruneDrafts')}
${extract('ensureDrafts')}
${extract('readDraft')}
${extract('writeDraft')}
${extract('clearDraft')}
return {
  readDraft, writeDraft, clearDraft, pruneDrafts,
  DRAFT_MAX, DRAFT_MAX_AGE_MS, DRAFT_DEBOUNCE_MS,
  raw: () => STORE[DRAFT_KEY],
  seed: (obj) => { STORE[DRAFT_KEY] = JSON.stringify(obj); },
  setReadDelay: (ms) => { READ_DELAY = ms; },
  /* "close the tab and come back": drop every bit of in-memory state so the
     next read has to go through storage, which is the whole thing tested. */
  reload: () => {
    draftCache = null; draftPending = null; draftLoading = null;
    if (draftTimer) clearTimeout(draftTimer); draftTimer = null;
  },
  wipe: () => {
    for (const k of Object.keys(STORE)) delete STORE[k];
    draftCache = null; draftPending = null; draftLoading = null;
  },
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
await new Promise(r => setTimeout(r, 40));   // clearDraft persists asynchronously
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

/* ---- typing while the store is still being read -------------------------
   The Artifact reads storage over a real round trip and the student is typing
   into the box the whole time. Both things that can go wrong in that window
   silently destroy work, so both are pinned here. */
console.log('\n  — typing during the initial read —');

D.wipe();
D.seed({ other: { text: 'a draft on another card', at: Date.now() },
         c1: { text: 'what was on disk', at: Date.now() } });
D.setReadDelay(80);
const reading = D.readDraft('c1');            // starts the slow read
D.writeDraft('c1', 'what they just typed');   // lands mid-flight
check('the read still resolves', typeof (await reading), 'string');
check('typing mid-read is not overwritten by the load', await D.readDraft('c1'), 'what they just typed');
check('and another card\'s draft is not lost', await D.readDraft('other'), 'a draft on another card');

await settle();
const persisted = JSON.parse(D.raw());
check('what was persisted keeps both cards', Object.keys(persisted).sort(), ['c1', 'other']);
check('and keeps the typed version', persisted.c1.text, 'what they just typed');

D.reload();
check('still there after a reload', await D.readDraft('c1'), 'what they just typed');
check('and so is the other card', await D.readDraft('other'), 'a draft on another card');

/* Grading a card before its store has finished loading must still clear it. */
D.wipe();
D.seed({ g1: { text: 'already marked', at: Date.now() }, g2: { text: 'keep me', at: Date.now() } });
D.setReadDelay(80);
D.clearDraft('g1');
await new Promise(r => setTimeout(r, 200));
check('clearing during the read still clears', await D.readDraft('g1'), '');
check('and leaves the others alone', await D.readDraft('g2'), 'keep me');

/* Two cards read at once must share one load, not race each other. */
D.wipe();
D.seed({ p: { text: 'P', at: Date.now() }, q: { text: 'Q', at: Date.now() } });
D.setReadDelay(60);
const [rp, rq] = await Promise.all([D.readDraft('p'), D.readDraft('q')]);
check('concurrent reads both get their own draft', [rp, rq], ['P', 'Q']);
D.setReadDelay(0);

console.log(`\n${failed ? failed + ' FAILED' : 'all passed'}`);
if (failed) process.exit(1);
