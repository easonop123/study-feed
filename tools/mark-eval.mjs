/* ============================================================================
   MARKING EVAL — does the marker actually grade like an examiner?

   Marking is the product's whole claim, and until now it has only ever been
   spot-checked by hand on a few answers. This runs a fixed corpus of student
   answers, written to sit in known grade bands, against the LIVE endpoint and
   reports where the marker disagrees with the band the answer was written for.

     node tools/mark-eval.mjs                 # everything
     node tools/mark-eval.mjs --deck genetics # one deck
     node tools/mark-eval.mjs --case waffle   # one case kind, across decks
     node tools/mark-eval.mjs --repeat 3      # same case N times (drift check)

   Nothing here re-implements the app. markPrompt, rescueObjects, locateNotes
   and quoteToRegex are lifted out of StudyFeed.jsx at run time by `grab()`, so
   this cannot quietly test a prompt the app no longer sends. If a grab fails,
   the function was renamed and the eval stops rather than testing a stale copy.

   What it measures, in order of how much it matters:
     grade      — did the grade land in the band the answer was written for
     balance    — an answer graded below Excellence whose notes are ALL "good".
                  The model's default is praise; this is the failure that was
                  found by hand once and has never been measured.
     anchoring  — notes whose quote cannot be found in the answer. Those are
                  silently dropped in the app, so the student sees fewer
                  highlights than the feedback refers to.
     shape      — replies that did not parse, or came back missing fields
   ========================================================================== */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { modelNamed, checkerDeadlineMs } from './app-source.mjs';
import { CASES } from './mark-eval-cases.mjs';
/* Static so Node's MODULE_TYPELESS_PACKAGE_JSON warning about this file prints
   before the run rather than through the middle of the progress table. */
import { STARTER_DECKS } from '../starter-decks.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, '..', 'StudyFeed.jsx'), 'utf8');

/* Pull a top-level `function name(...)` out of the source by balancing braces.
   String and comment aware, because the marking prompt is one long template
   literal full of braces and quotes. */
/* `const NAME = ...;` — the NCEA rules and the level test are consts, not
   functions, and markPrompt calls them. Scans to the semicolon that closes the
   statement, ignoring any inside the template literal. */
function extractConst(name){
  const start = SRC.indexOf(`const ${name} = `);
  if (start < 0) throw new Error(`grab: const ${name} not found in StudyFeed.jsx`);
  let str = null, esc = false, depth = 0;
  for (let i = start; i < SRC.length; i++){
    const c = SRC[i];
    if (str){
      if (esc){ esc = false; continue; }
      if (c === '\\'){ esc = true; continue; }
      if (c === str) str = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`'){ str = c; continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ';' && depth === 0) return SRC.slice(start, i + 1);
  }
  throw new Error(`grab: could not find the end of ${name}`);
}

function extract(name){
  const start = SRC.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`grab: function ${name} not found in StudyFeed.jsx`);
  let i = SRC.indexOf('{', start);
  let depth = 0, str = null, esc = false, line = false, block = false;
  for (; i < SRC.length; i++){
    const c = SRC[i], n = SRC[i + 1];
    if (line){ if (c === '\n') line = false; continue; }
    if (block){ if (c === '*' && n === '/'){ block = false; i++; } continue; }
    if (str){
      if (esc){ esc = false; continue; }
      if (c === '\\'){ esc = true; continue; }
      if (c === str) str = null;
      /* ${...} inside a template literal can hold braces; they balance out
         against each other, so tracking depth through them is unnecessary. */
      continue;
    }
    if (c === '/' && n === '/'){ line = true; i++; continue; }
    if (c === '/' && n === '*'){ block = true; i++; continue; }
    if (c === '"' || c === "'" || c === '`'){ str = c; continue; }
    if (c === '{') depth++;
    else if (c === '}'){ depth--; if (depth === 0) return SRC.slice(start, i + 1); }
  }
  throw new Error(`grab: could not find the end of ${name}`);
}

function grab(fns, consts){
  const src = (consts || []).map(extractConst).concat(fns.map(extract)).join('\n\n');
  const names = (consts || []).concat(fns);
  return new Function(`${src}\nreturn { ${names.join(', ')} };`)();
}

/* Every name in the grab list has to be destructured too, or it is fetched and
   then thrown away — which is how trimQuoteWrapper came to be undefined at the
   one point score() needed it, and why a whole run died three cases in. */
const { markPrompt, rescueObjects, locateNotes, placeNotes, quoteToRegex, trimQuoteWrapper, allOccurrences } =
  grab(['markPrompt', 'rescueObjects', 'trimQuoteWrapper', 'quoteToRegex', 'allOccurrences', 'placeNotes', 'locateNotes'],
       ['NCEA_RULES', 'isNcea', 'nceaRules']);

/* Exactly what markAnswer sends: callModel(prompt, 1700, MODEL_SMART) with no
   reasoning_effort — MODEL_SMART deliberately keeps its full thinking. Read
   from the source rather than retyped, so a model swap is picked up here too. */
const ENDPOINT = process.env.SF_ENDPOINT || 'https://studyfeed.app/api/nvidia';
const MODEL = modelNamed(SRC, 'MODEL_SMART');
if (!MODEL) throw new Error('grab: MODEL_SMART not found in StudyFeed.jsx');
/* Read from the source so this tracks the app, but overridable with
   --max-tokens to answer "what ceiling would stop the truncation". */
const SRC_MAX = Number((SRC.match(/markPrompt\(card, answer, level\), (\d+)/) || [])[1]);
const cliMax = process.argv.indexOf('--max-tokens');
const MARK_MAX_TOKENS = cliMax > 0 ? Number(process.argv[cliMax + 1]) : (SRC_MAX || 1700);

const GRADES = ['Not yet', 'Achieved', 'Merit', 'Excellence'];

/* --no-ncea strips the NCEA block back off a prompt that has it, so the same
   corpus can be run with and without and the difference attributed. Cutting at
   the marker is exact — the block is always the tail of the prompt. */
const NO_NCEA = process.argv.indexOf('--no-ncea') > 0;
function promptFor(card, answer, level){
  const p = markPrompt(card, answer, level);
  if (!NO_NCEA) return p;
  const cut = p.indexOf('\n\nNCEA RULES');
  return cut < 0 ? p : p.slice(0, cut);
}

/* The complaint this is here to measure: the marker citing achievement
   standards it half-remembers. Anything that looks like a standard number, or
   a claim about what NZQA or "the standard" wants, is a citation it should not
   be making — it has never seen the standard. */
const STANDARD_CITATION = /\bAS\s?9\d{4}\b|\b9[0-2]\d{3}\b|\bNZQA\b|\bthe standard (?:requires|says|wants|asks)\b|\bmarking schedule\b/gi;

/* --effort low|medium|high — THE FLAG THE README ASKS FOR BEFORE ANYONE
   TOUCHES THIS SETTING.

   Marking is the one feature deliberately left at full reasoning: everything
   else that could take `reasoning_effort` was turned down, and this was not,
   because grades are the product's claim and nobody had measured what turning
   it down does to them. "Re-run the eval both ways first, not a guess" is the
   standing instruction — and until now there was no way to run the other way,
   so the instruction could not be followed by anyone who wanted to.

   It matters more than it did. The endpoint writes at about 27 tokens a second
   and the proxy gives up at 55, so roughly 1500 tokens is the whole budget. The
   marking replies measured on this corpus came in at median 1256, p90 1749 and
   max 2497 — which puts the median call at about 46 seconds and everything
   past the median over the wall. Cutting the reasoning is the cheapest lever
   available; whether it costs any accuracy is what this flag exists to answer.

   Run it both ways over the same corpus and compare `in band`, not vibes:
     node tools/mark-eval.mjs                 > full.log
     node tools/mark-eval.mjs --effort low    > low.log                        */
const EFFORT = (() => {
  const i = process.argv.indexOf('--effort');
  const v = i > 0 ? process.argv[i + 1] : null;
  return (v === 'low' || v === 'medium' || v === 'high') ? v : null;
})();

/* The same 90-second deadline `tools/health.mjs` and `tools/paper-eval.mjs`
   carry, and for the same reason: the proxy gives up at 55s, so nothing still
   open at 90 is coming, and undici will otherwise sit on a hung HTTP/2 stream
   for as long as five minutes before throwing. A 42-case run that stalls twice
   is an hour of nothing. */
/* Derived from the proxy's own budget rather than written down: it has to sit
   comfortably PAST the point where the proxy gives up and returns its 504, or
   this starts reporting a timeout for an answer that was about to arrive. That
   number moved from 55s to 85s on 18 Sep 2026 and three files had it hardcoded
   at 90000 with a comment explaining why 90 was safely past 55. */
const DEADLINE_MS = checkerDeadlineMs(readFileSync(join(HERE, '..', 'api', 'nvidia.js'), 'utf8'));

async function mark(card, answer, level){
  const body = {
    model: MODEL,
    messages: [{ role: 'user', content: promptFor(card, answer, level) }],
    temperature: 0.7,
    top_p: 0.9,
    max_tokens: MARK_MAX_TOKENS,
    stream: false,
  };
  /* Guarded the way the app guards it — see takesReasoningEffort: an unknown
     parameter is a 400 from NVIDIA, so this must never reach a model family
     nobody has tried it on. */
  if (EFFORT && /gpt-oss/i.test(MODEL)) body.reasoning_effort = EFFORT;
  const started = Date.now();
  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(DEADLINE_MS),
    });
  } catch (e){
    const ms = Date.now() - started;
    const timedOut = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    return { ok: false, ms, error: timedOut ? `no reply in ${DEADLINE_MS / 1000}s` : String(e && e.message || e) };
  }
  const text = await res.text();
  const ms = Date.now() - started;
  if (!res.ok) return { ok: false, ms, error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
  let payload;
  try { payload = JSON.parse(text); }
  catch { return { ok: false, ms, error: 'response was not JSON' }; }
  const reply = payload && payload.choices && payload.choices[0]
    && payload.choices[0].message && payload.choices[0].message.content;
  if (typeof reply !== 'string') return { ok: false, ms, error: 'no message content' };
  const finish = payload.choices[0].finish_reason;
  /* Completion tokens are the whole story on truncation: gpt-oss reasons, and
     that reasoning is spent out of the SAME max_tokens budget as the JSON, so
     a hard question can burn the ceiling before it starts writing the mark. */
  const usage = payload.usage || {};
  const parsed = rescueObjects(reply)[0];
  if (!parsed) return { ok: false, ms, finish, usage, error: 'no JSON object in reply', reply: reply.slice(0, 300) };
  return { ok: true, ms, finish, usage, r: parsed, raw: reply };
}

/* One answer, scored against the band it was written for. */
function score(kase, card, out){
  const row = { deck: kase.deck, card: kase.cardIndex, kind: kase.kind, ms: out.ms, ceiling: MARK_MAX_TOKENS };
  if (out.usage) row.completionTokens = out.usage.completion_tokens;
  if (!out.ok){ row.fail = out.error; row.finish = out.finish; return row; }
  const r = out.r;
  row.grade = GRADES.includes(r.grade) ? r.grade : `??(${r.grade})`;
  row.expected = kase.expect;
  row.gradeOk = kase.expect.includes(row.grade);

  const notes = Array.isArray(r.notes) ? r.notes : [];
  row.notes = notes.length;
  /* Ask the real placer rather than re-deriving it here. An earlier version of
     this file reimplemented the matching, drifted the moment placeNotes learned
     to strip quote wrappers, and started reporting a NEGATIVE overlap count —
     the exact class of bug the grab() technique exists to prevent. */
  const placed = placeNotes(kase.answer, notes);
  const located = placed.located;
  row.located = located.length;
  row.unanchored = placed.orphans.length;
  /* WHY a note was dropped, because the two causes need opposite fixes. A
     quote that cannot be found at all is the model failing to copy; a quote
     that was found but overlaps an earlier one is locateNotes throwing away
     perfectly good feedback. Mirrors locateNotes' own two steps. */
  /* WHY each note failed to anchor, using the same helpers the app uses. A
     quote that cannot be found anywhere is the model failing to copy; one that
     can be found but did not get a home lost its span to another note. */
  row.notFound = 0; row.overlapDropped = 0; row.malformed = 0;
  row.missedQuotes = [];
  const anchoredNotes = {};
  for (const l of located) anchoredNotes[l.note] = 1;
  for (const n of notes){
    const raw = (n && typeof n.quote === 'string') ? n.quote : '';
    const note = (n && typeof n.note === 'string') ? n.note.trim() : '';
    if (!note || anchoredNotes[note]) continue;
    const quote = trimQuoteWrapper(raw);
    if (quote.length < 4){ row.malformed++; continue; }
    if (allOccurrences(kase.answer, quote).length){ row.overlapDropped++; continue; }
    row.notFound++;
    row.missedQuotes.push(raw);
  }
  /* Quotes the model invented or tidied. The app drops these silently, so the
     student reads numbered feedback with numbers missing from their answer. */
  /* Not "dropped" any more: an unanchored note still reaches the student, it
     just has no highlight over their words. */
  row.dropped = row.unanchored;

  const kinds = notes.map(n => n && n.kind === 'good' ? 'good' : 'weak');
  row.weakNotes = kinds.filter(k => k === 'weak').length;
  /* The prompt says an all-good set of notes below Excellence is wrong. */
  row.balanceBroken = row.grade !== 'Excellence' && notes.length > 0 && row.weakNotes === 0;

  row.hasLift = typeof r.lift === 'string' && r.lift.trim().length > 0;
  row.missing = Array.isArray(r.missing) ? r.missing.length : 0;
  row.truncated = out.finish === 'length';
  const hits = String(out.raw || '').match(STANDARD_CITATION);
  row.citations = hits ? Array.from(new Set(hits.map(s => s.trim()))) : [];
  row.cited = row.citations.length > 0;
  return row;
}

function arg(name, fallback){
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main(){
  const onlyDeck = arg('deck', null);
  const onlyKind = arg('case', null);
  const repeat = Number(arg('repeat', 1));

  let cases = CASES;
  if (onlyDeck) cases = cases.filter(c => c.deck === onlyDeck);
  if (onlyKind) cases = cases.filter(c => c.kind === onlyKind);
  if (!cases.length){ console.error('No cases matched.'); process.exit(1); }

  const cardFor = (kase) => {
    const deck = STARTER_DECKS.find(d => d.slug === kase.deck);
    if (!deck) throw new Error(`unknown deck ${kase.deck}`);
    const longs = deck.cards.filter(c => c.type === 'extended');
    const card = longs[kase.cardIndex];
    if (!card) throw new Error(`${kase.deck} has no extended card ${kase.cardIndex}`);
    /* --level reproduces the case this was built for: a student who has named
       their actual standard on the deck. That is when the marker was most
       tempted to recite what it thought that standard said. */
    return { card, level: arg('level', deck.standard) };
  };

  const total = cases.length * repeat;
  console.log(`Marking eval — ${total} calls against ${ENDPOINT}`);
  console.log(`Model: ${MODEL}, max_tokens ${MARK_MAX_TOKENS}, reasoning ${EFFORT || 'full'}${NO_NCEA ? ', NCEA rules OFF' : ''}${arg('level', null) ? ', level "' + arg('level', '') + '"' : ''}\n`);

  const rows = [];
  let n = 0;
  for (let pass = 0; pass < repeat; pass++){
    for (const kase of cases){
      const { card, level } = cardFor(kase);
      n++;
      process.stdout.write(`[${String(n).padStart(3)}/${total}] ${kase.deck} #${kase.cardIndex} ${kase.kind.padEnd(18)}`);
      let out;
      try { out = await mark(card, kase.answer, level); }
      catch (e){ out = { ok: false, ms: 0, error: String(e && e.message || e) }; }
      const row = score(kase, card, out);
      if (repeat > 1) row.pass = pass + 1;
      rows.push(row);
      if (row.fail) console.log(`FAILED — ${row.fail}`);
      else {
        const flags = [];
        if (!row.gradeOk) flags.push(`GRADE ${row.grade} want ${row.expected.join('/')}`);
        if (row.balanceBroken) flags.push('ALL-GOOD NOTES');
        if (row.dropped) flags.push(`${row.dropped} quote${row.dropped > 1 ? 's' : ''} dropped`);
        if (row.truncated) flags.push('TRUNCATED');
        console.log(`${row.grade.padEnd(11)} ${String(row.ms / 1000).slice(0, 4)}s  ${flags.length ? '⚠ ' + flags.join(' · ') : 'ok'}`);
      }
      /* Gentle on a shared free tier; the ceiling is about 40 requests a
         minute across everyone using it, and a 429 here costs a whole case. */
      await new Promise(r => setTimeout(r, 1200));
    }
  }

  report(rows);
  const outPath = join(HERE, arg('out', 'mark-eval-results.json'));
  const { writeFileSync } = await import('node:fs');
  writeFileSync(outPath, JSON.stringify(rows, null, 2));
  console.log(`\nFull rows: ${outPath}`);
}

function pct(a, b){ return b ? Math.round(a / b * 100) + '%' : '—'; }

function report(rows){
  const done = rows.filter(r => !r.fail);
  const failed = rows.filter(r => r.fail);
  console.log('\n' + '='.repeat(72));
  console.log('SUMMARY');
  console.log('='.repeat(72));
  console.log(`Calls            ${rows.length}  (${failed.length} failed outright)`);
  if (done.length){
    const gradeOk = done.filter(r => r.gradeOk).length;
    const balance = done.filter(r => r.balanceBroken).length;
    const withNotes = done.filter(r => r.notes > 0);
    const totalNotes = done.reduce((s, r) => s + r.notes, 0);
    const totalDropped = done.reduce((s, r) => s + r.dropped, 0);
    const trunc = done.filter(r => r.truncated).length;
    const noLift = done.filter(r => !r.hasLift).length;
    const ms = done.map(r => r.ms).sort((a, b) => a - b);
    console.log(`Grade in band    ${gradeOk}/${done.length}  ${pct(gradeOk, done.length)}`);
    console.log(`All-good notes   ${balance}/${done.length}  ${pct(balance, done.length)}   (should be 0)`);
    console.log(`Unanchored       ${totalDropped}/${totalNotes}  ${pct(totalDropped, totalNotes)}  across ${withNotes.length} answers with notes`);
    const nf = done.reduce((s, r) => s + (r.notFound || 0), 0);
    const ov = done.reduce((s, r) => s + (r.overlapDropped || 0), 0);
    const mal = done.reduce((s, r) => s + (r.malformed || 0), 0);
    console.log(`  ...not found   ${nf}   (model did not copy the answer at all)`);
    console.log(`  ...overlapping ${ov}   (findable, but another note took the span)`);
    console.log(`  ...too short   ${mal}`);
    console.log(`  (all of these still SHOW — they just carry no highlight)`);
    console.log(`Truncated        ${trunc}`);
    console.log(`Missing "lift"   ${noLift}`);
    const cited = done.filter(r => r.cited);
    console.log(`Cited a standard ${cited.length}/${done.length}  ${pct(cited.length, done.length)}   (should be 0 — it has never seen one)`);
    if (cited.length){
      const all = {};
      for (const r of cited) for (const c of r.citations) all[c] = (all[c] || 0) + 1;
      console.log(`  what it cited: ${Object.entries(all).map(([k, v]) => `${k} x${v}`).join(', ')}`);
    }
    console.log(`Latency          median ${(ms[Math.floor(ms.length / 2)] / 1000).toFixed(1)}s   slowest ${(ms[ms.length - 1] / 1000).toFixed(1)}s`);
    const toks = rows.map(r => r.completionTokens).filter(Number.isFinite).sort((a, b) => a - b);
    if (toks.length){
      console.log(`Completion tokens median ${toks[Math.floor(toks.length / 2)]}  p90 ${toks[Math.floor(toks.length * 0.9)]}  max ${toks[toks.length - 1]}  (ceiling ${MARK_MAX_TOKENS})`);
    }

    console.log('\nBY CASE KIND');
    const kinds = [...new Set(done.map(r => r.kind))];
    for (const k of kinds){
      const sub = done.filter(r => r.kind === k);
      const ok = sub.filter(r => r.gradeOk).length;
      const grades = sub.map(r => r.grade).join(', ');
      console.log(`  ${k.padEnd(18)} ${ok}/${sub.length} in band   → ${grades}`);
    }

    const offBand = done.filter(r => !r.gradeOk);
    if (offBand.length){
      console.log('\nOFF-BAND');
      for (const r of offBand) console.log(`  ${r.deck} #${r.card} ${r.kind.padEnd(18)} got ${r.grade}, wanted ${r.expected.join('/')}`);
    }
    const broke = done.filter(r => r.balanceBroken);
    if (broke.length){
      console.log('\nALL-GOOD NOTES BELOW EXCELLENCE (the praise-bias failure)');
      for (const r of broke) console.log(`  ${r.deck} #${r.card} ${r.kind.padEnd(18)} graded ${r.grade} with ${r.notes} notes, none weak`);
    }
  }
  if (failed.length){
    console.log('\nFAILED CALLS');
    for (const r of failed) console.log(`  ${r.deck} #${r.card} ${r.kind.padEnd(18)} ${r.fail}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
