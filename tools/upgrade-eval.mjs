/* ============================================================================
   UPGRADE EVAL — the "How do I get to Merit?" panel, not the mark.

   Built because the marking eval was testing the wrong call. The report was
   about outdated NCEA standards turning up in the SUGGESTIONS on a long
   answer, and those come from getUpgrade, which mark-eval.mjs never touches.
   Marking says what is missing; this panel says how to fix it, and it is the
   chattier of the two — so it is the likelier place for the model to start
   reciting a standard it half-remembers.

     node tools/upgrade-eval.mjs
     node tools/upgrade-eval.mjs --no-ncea
     node tools/upgrade-eval.mjs --level "NCEA Level 1 AS92022 genetic variation"

   Same grab() technique as the marking eval: upgradePrompt and the NCEA rules
   come out of StudyFeed.jsx at run time, so this cannot test a prompt the app
   no longer sends.
   ========================================================================== */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, '..', 'StudyFeed.jsx'), 'utf8');

function extractConst(name){
  const start = SRC.indexOf(`const ${name} = `);
  if (start < 0) throw new Error(`grab: const ${name} not found`);
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
  throw new Error(`grab: could not end ${name}`);
}
function extract(name){
  const start = SRC.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`grab: function ${name} not found`);
  let i = SRC.indexOf('{', start), depth = 0, str = null, esc = false, line = false, block = false;
  for (; i < SRC.length; i++){
    const c = SRC[i], n = SRC[i + 1];
    if (line){ if (c === '\n') line = false; continue; }
    if (block){ if (c === '*' && n === '/'){ block = false; i++; } continue; }
    if (str){
      if (esc){ esc = false; continue; }
      if (c === '\\'){ esc = true; continue; }
      if (c === str) str = null;
      continue;
    }
    if (c === '/' && n === '/'){ line = true; i++; continue; }
    if (c === '/' && n === '*'){ block = true; i++; continue; }
    if (c === '"' || c === "'" || c === '`'){ str = c; continue; }
    if (c === '{') depth++;
    else if (c === '}'){ depth--; if (!depth) return SRC.slice(start, i + 1); }
  }
  throw new Error(`grab: could not end ${name}`);
}

const CONSTS = ['NCEA_RULES', 'isNcea', 'nceaRules', 'GRADES', 'NEXT_GRADE', 'nextGradeUp'];
const FNS = ['upgradePrompt', 'rescueObjects'];
const grabbed = new Function(
  CONSTS.map(extractConst).concat(FNS.map(extract)).join('\n\n') +
  `\nreturn { ${CONSTS.concat(FNS).join(', ')} };`)();
const { upgradePrompt, rescueObjects } = grabbed;

const ENDPOINT = 'https://studyfeed.app/api/nvidia';
const MODEL = (SRC.match(/const MODEL_SMART = '([^']+)'/) || [])[1];
const UPGRADE_MAX = Number((SRC.match(/upgradePrompt\(card, answer, result, level\), (\d+)/) || [])[1]) || 1600;

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const NO_NCEA = process.argv.indexOf('--no-ncea') > 0;

/* Same detector as the marking eval: a standard number, or a claim about what
   NZQA or "the standard" wants. It has never seen either. */
const CITATION = /\bAS\s?9\d{4}\b|\b9[0-2]\d{3}\b|\bNZQA\b|\bthe standard (?:requires|says|wants|asks|expects)\b|\bmarking schedule\b|\bachievement standard\b/gi;

function promptFor(card, answer, result, level){
  const p = upgradePrompt(card, answer, result, level);
  if (!NO_NCEA) return p;
  const cut = p.indexOf('\n\nNCEA RULES');
  return cut < 0 ? p : p.slice(0, cut);
}

async function ask(card, answer, result, level){
  const body = { model: MODEL, messages: [{ role: 'user', content: promptFor(card, answer, result, level) }],
    temperature: 0.7, top_p: 0.9, max_tokens: UPGRADE_MAX, stream: false };
  const started = Date.now();
  const res = await fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const text = await res.text();
  const ms = Date.now() - started;
  if (!res.ok) return { ok: false, ms, error: `HTTP ${res.status}` };
  let payload; try { payload = JSON.parse(text); } catch { return { ok: false, ms, error: 'not JSON' }; }
  const reply = payload && payload.choices && payload.choices[0] && payload.choices[0].message && payload.choices[0].message.content;
  if (typeof reply !== 'string') return { ok: false, ms, error: 'no content' };
  const parsed = rescueObjects(reply)[0];
  if (!parsed) return { ok: false, ms, error: 'no JSON object', finish: payload.choices[0].finish_reason };
  return { ok: true, ms, r: parsed, raw: reply };
}

/* Mid-quality answers, deliberately left short of the next grade so the panel
   has something real to say. The grade and "missing" list stand in for a mark
   that has already happened — this call always runs after one. */
const CASES = [
  { deck: 'genetics', cardIndex: 0, grade: 'Achieved',
    missing: ['no mention of meiosis', 'does not say why the recessive shows'],
    answer: 'Both parents are Bb and the lamb is bb. B is dominant so the parents look black. The lamb is white because it got two b alleles.' },
  { deck: 'genetics', cardIndex: 1, grade: 'Achieved',
    missing: ['does not say where the variation came from', 'stops at "the brown ones survive"'],
    answer: 'The bird eats the green beetles because it can see them on the brown bark. So more brown beetles are left and the population becomes mostly brown over time.' },
  { deck: 'acids-bases', cardIndex: 0, grade: 'Merit',
    missing: ['does not say the total gas produced is the same', 'no mention of a fair test'],
    answer: 'The powder has a much bigger surface area, so more acid particles can collide with marble at any one time. More successful collisions per second means the reaction goes faster. The mass is the same in both runs.' },
  { deck: 'writing-about-text', cardIndex: 0, grade: 'Achieved',
    missing: ['names the feature but not its effect', 'only one piece of evidence'],
    answer: 'The writer uses personification when they say "The house had learned to live without her". This gives the house human qualities and shows that someone is gone.' },
];

async function main(){
  const { STARTER_DECKS } = await import('../starter-decks.js');
  console.log(`Upgrade eval — ${CASES.length} calls${NO_NCEA ? ', NCEA rules OFF' : ''}`);
  console.log(`Model: ${MODEL}, max_tokens ${UPGRADE_MAX}${arg('level', null) ? `, level "${arg('level', '')}"` : ''}\n`);

  const rows = [];
  for (let i = 0; i < CASES.length; i++){
    const k = CASES[i];
    const deck = STARTER_DECKS.find(d => d.slug === k.deck);
    const card = deck.cards.filter(c => c.type === 'extended')[k.cardIndex];
    const level = arg('level', deck.standard);
    process.stdout.write(`[${i + 1}/${CASES.length}] ${k.deck} #${k.cardIndex} `);
    let out;
    try { out = await ask(card, k.answer, { grade: k.grade, missing: k.missing }, level); }
    catch (e){ out = { ok: false, ms: 0, error: String(e && e.message || e) }; }
    const row = { deck: k.deck, card: k.cardIndex, ms: out.ms };
    if (!out.ok){ row.fail = out.error; console.log('FAILED —', out.error); }
    else {
      const hits = String(out.raw || '').match(CITATION);
      row.citations = hits ? Array.from(new Set(hits.map(s => s.trim()))) : [];
      row.cited = row.citations.length > 0;
      row.steps = Array.isArray(out.r.steps) ? out.r.steps.length : 0;
      row.hasGap = !!(out.r.gap && String(out.r.gap).trim());
      row.gap = out.r.gap;
      console.log(`${(out.ms / 1000).toFixed(1)}s  ${row.steps} steps  ${row.cited ? 'CITED: ' + row.citations.join(', ') : 'no citation'}`);
    }
    rows.push(row);
    await new Promise(r => setTimeout(r, 1200));
  }

  const done = rows.filter(r => !r.fail);
  const cited = done.filter(r => r.cited);
  console.log('\n' + '='.repeat(64));
  console.log(`Calls            ${rows.length}  (${rows.length - done.length} failed)`);
  console.log(`Cited a standard ${cited.length}/${done.length}   (should be 0)`);
  if (cited.length){
    const all = {};
    for (const r of cited) for (const c of r.citations) all[c] = (all[c] || 0) + 1;
    console.log(`  what it cited: ${Object.entries(all).map(([k, v]) => `${k} x${v}`).join(', ')}`);
  }
  console.log(`Has a "gap"      ${done.filter(r => r.hasGap).length}/${done.length}`);
  writeFileSync(join(HERE, arg('out', 'upgrade-eval-results.json')), JSON.stringify(rows, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
