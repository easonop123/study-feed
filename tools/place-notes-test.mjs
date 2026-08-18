import { readFileSync } from 'node:fs';

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'StudyFeed.jsx'), 'utf8');
function extract(name){
  const start = SRC.indexOf(`function ${name}(`);
  if (start < 0) throw new Error('missing ' + name);
  let i = SRC.indexOf('{', start), d = 0, str = null, esc = false, line = false, block = false;
  for (; i < SRC.length; i++){
    const c = SRC[i], n = SRC[i + 1];
    if (line){ if (c === '\n') line = false; continue; }
    if (block){ if (c === '*' && n === '/'){ block = false; i++; } continue; }
    if (str){ if (esc){ esc = false; continue; } if (c === '\\'){ esc = true; continue; } if (c === str) str = null; continue; }
    if (c === '/' && n === '/'){ line = true; i++; continue; }
    if (c === '/' && n === '*'){ block = true; i++; continue; }
    if (c === '"' || c === "'" || c === '`'){ str = c; continue; }
    if (c === '{') d++;
    else if (c === '}'){ d--; if (!d) return SRC.slice(start, i + 1); }
  }
  throw new Error('unterminated ' + name);
}
const names = ['trimQuoteWrapper', 'quoteToRegex', 'allOccurrences', 'placeNotes', 'locateNotes', 'segmentAnswer'];
const { placeNotes, segmentAnswer } = new Function(names.map(extract).join('\n') + `\nreturn { placeNotes, segmentAnswer };`)();

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond){ pass++; console.log('  PASS', name); } else { fail++; console.log('  FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };

console.log('placeNotes:');

// 1. A phrase the student used twice, quoted by two different notes.
{
  const a = 'The cell divides. Later the cell divides again into four.';
  const r = placeNotes(a, [
    { quote: 'the cell divides', kind: 'good', note: 'first' },
    { quote: 'the cell divides', kind: 'weak', note: 'second' },
  ]);
  ok('repeated phrase anchors twice', r.located.length === 2 && r.orphans.length === 0,
    { located: r.located.length, orphans: r.orphans.length });
  ok('  ...at different offsets', r.located.length === 2 && r.located[0].at !== r.located[1].at);
}

// 2. Genuinely overlapping quotes on a phrase that occurs once — one anchors,
//    the other survives as an orphan instead of vanishing.
{
  const a = 'Brown beetles survive longer and breed more often.';
  const r = placeNotes(a, [
    { quote: 'Brown beetles survive longer', kind: 'good', note: 'kept' },
    { quote: 'beetles survive longer and breed', kind: 'weak', note: 'must not be lost' },
  ]);
  ok('overlap keeps one anchored', r.located.length === 1, r.located.length);
  ok('overlap keeps the other as orphan', r.orphans.length === 1 && r.orphans[0].note === 'must not be lost', r.orphans);
}

// 3. A quote the model never actually wrote — note text still survives.
{
  const a = 'Meiosis halves the chromosome number.';
  const r = placeNotes(a, [{ quote: 'mitosis halves the chromosomes', kind: 'weak', note: 'wrong process' }]);
  ok('unfindable quote becomes an orphan', r.located.length === 0 && r.orphans.length === 1, r);
}

// 4. Constrained-first: the single-position quote must win its span.
{
  const a = 'It is dominant. It is recessive. It is dominant again.';
  const r = placeNotes(a, [
    { quote: 'It is', kind: 'good', note: 'loose, three positions' },
    { quote: 'It is recessive', kind: 'weak', note: 'only one position' },
  ]);
  const gotRecessive = r.located.some(l => a.substr(l.at, l.len) === 'It is recessive');
  ok('single-position quote claims its span', gotRecessive && r.located.length === 2,
    r.located.map(l => a.substr(l.at, l.len)));
}

// 5. Nothing overlaps in the output, or the <mark>s would nest.
{
  const a = 'Alleles separate during meiosis so each gamete carries one allele.';
  const r = placeNotes(a, [
    { quote: 'Alleles separate during meiosis', kind: 'good', note: 'a' },
    { quote: 'during meiosis so each gamete', kind: 'good', note: 'b' },
    { quote: 'each gamete carries one allele', kind: 'weak', note: 'c' },
  ]);
  let clean = true;
  const s = r.located.slice().sort((x, y) => x.at - y.at);
  for (let i = 1; i < s.length; i++) if (s[i].at < s[i - 1].at + s[i - 1].len) clean = false;
  ok('no overlapping spans survive', clean, s);
  ok('every note survives somewhere', r.located.length + r.orphans.length === 3,
    { l: r.located.length, o: r.orphans.length });
}

// 6. Notes are in reading order, so the numbering runs down the page.
{
  const a = 'Alpha one. Bravo two. Charlie three.';
  const r = placeNotes(a, [
    { quote: 'Charlie three', kind: 'good', note: 'c' },
    { quote: 'Alpha one', kind: 'good', note: 'a' },
    { quote: 'Bravo two', kind: 'good', note: 'b' },
  ]);
  ok('located sorted by position', r.located.map(l => l.note).join('') === 'abc', r.located.map(l => l.note));
}

// 7. A note with no quote at all keeps its text.
{
  const r = placeNotes('Some answer here.', [{ quote: '', kind: 'weak', note: 'general point' }]);
  ok('quoteless note kept as orphan', r.orphans.length === 1, r);
}

// 8. segmentAnswer still reconstructs the answer exactly.
{
  const a = 'Alleles separate during meiosis so each gamete carries one allele.';
  const r = placeNotes(a, [{ quote: 'during meiosis', kind: 'good', note: 'x' }]);
  const rebuilt = segmentAnswer(a, r.located).map(s => s.text).join('');
  ok('segmentAnswer is lossless', rebuilt === a, rebuilt);
}

// 9-11. Replays of real failures seen in tools/mark-eval-anchor-before.json,
//       where the marker's note was thrown away over punctuation alone.
{
  const a = 'The clearest example is the opening line, and it works well.';
  const r = placeNotes(a, [{ quote: '"The clearest example is the opening line"', kind: 'good', note: 'wrapped in quotes' }]);
  ok('quote wrapped in quotation marks still anchors', r.located.length === 1, r);
}
{
  const a = 'They then repeat "Forty-one" as a sentence on its own.';
  const r = placeNotes(a, [{ quote: "They then repeat 'Forty-one' as a sentence on its own", kind: 'good', note: 'swapped quote marks' }]);
  ok('single vs double quote marks inside a quote', r.located.length === 1, r);
}
{
  const a = 'The writer uses personification throughout the extract.';
  const r = placeNotes(a, [{ quote: '"The writer uses personification throughout the extract."', kind: 'good', note: 'wrapped and full-stopped' }]);
  ok('trailing full stop inside the wrapper', r.located.length === 1, r);
}
{
  // The one class of failure punctuation cannot rescue: a dropped word.
  const a = 'the proportion of green ones will go down.';
  const r = placeNotes(a, [{ quote: 'the proportion of green ones will down', kind: 'weak', note: 'genuine transcription slip' }]);
  ok('a dropped word is still an orphan, not a wrong highlight', r.located.length === 0 && r.orphans.length === 1, r);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
