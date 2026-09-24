/* ============================================================================
   MARKER NOTE TEST — does a student get told when a backup gave their grade?

   The chain falls back to another model when the head hangs, and the fallback
   (nemotron) was measured on 24 Sep 2026 grading 50% in band against the
   head's 90%, never awarding Excellence and rewarding waffle
   (tools/mark-eval-nemotron.log). markerNote decides what the student is told
   about that. What matters, in order:
     - the head's own marks, and the tour's canned ones, say NOTHING
     - a fallback's mark always says so
     - the specific tendencies are claimed only where they were measured:
       nemotron, on written answers — not on working, not on other models

     node tools/marker-note-test.mjs

   Offline. markerNote and TEXT_MODELS are lifted out of StudyFeed.jsx.
   ========================================================================== */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

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
const { markerNote, TEXT_MODELS } = new Function(extractConst('TEXT_MODELS') + '\n' + extract('markerNote') + '\nreturn { markerNote, TEXT_MODELS };')();

let failed = 0;
function check(name, got, want){
  const ok = got === want;
  if (!ok) failed++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (!ok) console.log(`       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`);
}
const head = TEXT_MODELS[0];
const nemo = TEXT_MODELS.find(m => /nemotron/i.test(m));
const other = TEXT_MODELS.find(m => m !== head && !/nemotron/i.test(m));

console.log('Marker note — a student is told when a backup gave their grade\n');
check('the head\'s own mark says nothing', markerNote(head, 'answer'), '');
check('nor does the head marking working', markerNote(head, 'working'), '');
check('a canned tour mark (no servedBy) says nothing', markerNote(undefined, 'answer'), '');
check('an empty servedBy says nothing', markerNote('', 'answer'), '');

if (nemo){
  const n = markerNote(nemo, 'answer');
  check('a nemotron mark on a written answer says a backup marked it', /backup marked this/.test(n), true);
  check('and names what it was measured to get wrong', /almost never gives Excellence/.test(n) && /too generous to thin answers/.test(n), true);
  check('and says what to do about it', /mark it again/i.test(n), true);
  const w = markerNote(nemo, 'working');
  check('nemotron on WORKING gets the plain note — its tendencies were measured on essays', /Excellence/.test(w), false);
  check('but still says a backup marked it', /backup marked this/.test(w), true);
} else console.log('  (no nemotron in the chain — its checks skipped)');

if (other){
  check('any other stand-in gets the plain note, claiming nothing unmeasured', /Excellence|generous/.test(markerNote(other, 'answer')), false);
  check('and it still says so', /backup marked this/.test(markerNote(other, 'answer')), true);
}

console.log(`\n${failed ? failed + ' FAILED' : 'all passed'}`);
if (failed) process.exit(1);
