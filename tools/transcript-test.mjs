/* ============================================================================
   TRANSCRIPT TEST — what a photographed page leaves in the answer box.

   The vision model's reading lands in the student's answer box, where they
   check it before it is marked. So anything it adds that is not on the page is
   something the student has to notice and delete by hand — or leave in, and be
   marked on. The one this exists for: on 23 Sep 2026 it read a four-line page
   of working and then padded "4. [?] 5. [?] ... 9. [?]", lines that do not
   exist, which would have been marked as six blank steps.

     node tools/transcript-test.mjs

   Offline. trimPlaceholderTail is lifted out of StudyFeed.jsx at run time, so
   this tests the shipped function and not a copy of it.
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
const trimPlaceholderTail = new Function(extract('trimPlaceholderTail') + '\nreturn trimPlaceholderTail;')();

let failed = 0;
function check(name, got, want){
  const ok = got === want;
  if (!ok) failed++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (!ok) console.log(`       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`);
}

console.log('Transcripts — nothing lands in the answer box that was not on the page\n');

check('the padding actually seen, 23 Sep 2026',
  trimPlaceholderTail('1. m = 250 g = 0.25 kg\n2. a = 12.5 / 4 = 3.125\n3. F = ma = 0.78 N\n4. [?]\n5. [?]\n6. [?]\n7. [?]\n8. [?]\n9. [?]'),
  '1. m = 250 g = 0.25 kg\n2. a = 12.5 / 4 = 3.125\n3. F = ma = 0.78 N');
check('unnumbered padding', trimPlaceholderTail('line one\n[?]\n[?]'), 'line one');
check('bracket numbering, with and without a space', trimPlaceholderTail('x = 2\n4) [?]\n5)[?]'), 'x = 2');
check('trailing blank lines', trimPlaceholderTail('x = 2\n\n  \n'), 'x = 2');

/* What must SURVIVE — the student needs to see these to fix them. */
check('a word it genuinely could not read, mid-line, stays',
  trimPlaceholderTail('F = 0.25 x [?]\nF = 0.78 N'), 'F = 0.25 x [?]\nF = 0.78 N');
check('an illegible bit on the LAST real line stays',
  trimPlaceholderTail('a = 3.125\nso the [?] is 0.78 N'), 'a = 3.125\nso the [?] is 0.78 N');
check('a placeholder line BETWEEN real lines stays — that line exists',
  trimPlaceholderTail('m = 0.25 kg\n[?]\nF = 0.78 N'), 'm = 0.25 kg\n[?]\nF = 0.78 N');
check('clean prose is untouched',
  trimPlaceholderTail('When you heat it up the particles move faster.'), 'When you heat it up the particles move faster.');

/* A page that is nothing but placeholders read nothing, and the callers treat
   '' as "no handwriting found" — the honest message, rather than a box of [?]. */
check('all placeholders reads as nothing', trimPlaceholderTail('[?]\n2. [?]'), '');
check('null is safe', trimPlaceholderTail(null), '');
check('undefined is safe', trimPlaceholderTail(undefined), '');

console.log(`\n${failed ? failed + ' FAILED' : 'all passed'}`);
if (failed) process.exit(1);
