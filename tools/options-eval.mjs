/* Does a multiple-choice question give itself away?

   The complaint this measures: on a deck with mixed answer lengths, the right
   answer could be the only long option among three short ones, or the only
   short one among three paragraphs. You could then score well by picking the
   odd one out without reading a word. That is not hypothetical — it is what
   "options of one word answers and whole paragraph answers" means.

   So the test is a CHEAT: a guesser that never reads the question and only
   looks at how long the options are.

   Run: node tools/options-eval.mjs
   No API calls and no key — this is all local logic. */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as esbuild from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tools', '.options-eval-bundle.mjs');

/* The functions under test live in the app file and are not exported — it has
   one default export on purpose, because it also runs as an Artifact. Bundle a
   copy that exposes them rather than restating the logic here, which is how a
   harness quietly stops testing the app (it has happened twice on this repo). */
const EXPORTS = ['buildOptions', 'buildQuiz', 'rankDistractors', 'answerShape',
  'distractorFit', 'numericDistractors', 'ownOptions', 'quizAnswerText',
  'buildLearnQuestion', 'normaliseAnswer'];

async function loadApp(){
  const src = fs.readFileSync(path.join(ROOT, 'StudyFeed.jsx'), 'utf8');
  /* Next to the app file, not in tools/, or its relative imports do not resolve. */
  const shim = path.join(ROOT, '.options-eval-src.jsx');
  fs.writeFileSync(shim, src + '\nexport { ' + EXPORTS.join(', ') + ' };\n');
  try {
    await esbuild.build({
      entryPoints: [shim], bundle: true, format: 'esm', outfile: OUT,
      loader: { '.jsx': 'jsx' }, jsx: 'automatic', external: ['react', 'react/jsx-runtime'],
      logLevel: 'error',
    });
  } finally { fs.unlinkSync(shim); }
  return import('file://' + OUT.replace(/\\/g, '/') + '?t=' + Date.now());
}

/* ---- the old build, kept so the numbers have something to be better than.
   Verbatim from before this change: three answers pulled at random out of the
   whole pool, nothing considered but "is it a different string". */
function oldOptions(correct, pool, shuffle){
  const distractors = shuffle(pool.filter(a => a !== correct)).slice(0, 3);
  const options = shuffle([correct].concat(distractors));
  return { options, answer: options.indexOf(correct) };
}
const shuffle = (a) => {
  const r = a.slice();
  for (let i = r.length - 1; i > 0; i--){ const j = Math.floor(Math.random() * (i + 1)); const t = r[i]; r[i] = r[j]; r[j] = t; }
  return r;
};

/* ---- the cheat -----------------------------------------------------------
   Look for an option whose length is out of step with ALL the others — at
   least twice as long as every one of them, or half as short — and pick it.
   Where there is no such odd one out there is nothing to go on, so it guesses
   at random, which is the honest baseline.

   "giveaway" is the share of questions where that odd one out IS the answer:
   questions anybody can get right knowing nothing whatsoever. */
function oddOneOut(options){
  const lens = options.map(o => o.length);
  let found = -1;
  for (let i = 0; i < lens.length; i++){
    let odd = true;
    for (let j = 0; j < lens.length; j++){
      if (i === j) continue;
      /* Both tests, or "K" next to "Na" registers as twice the length. */
      if (Math.min(lens[i], lens[j]) / Math.max(lens[i], lens[j]) > 0.5) { odd = false; break; }
      if (Math.abs(lens[i] - lens[j]) < 12){ odd = false; break; }
    }
    if (odd){ if (found >= 0) return -1; found = i; }
  }
  return found;
}
function cheatPick(options){
  const odd = oddOneOut(options);
  return odd >= 0 ? odd : Math.floor(Math.random() * options.length);
}

/* ---- decks ---------------------------------------------------------------
   Shapes that actually turn up: the mixed deck from the report (one-word
   answers sitting among paragraphs), one deck of nothing but terms, one of
   nothing but explanations, one of dates and figures, and a small deck with a
   single odd answer in it. */
const DECKS = {
  'mixed (the reported case)': [
    ['What is the powerhouse of the cell?', 'Mitochondria'],
    ['Define osmosis', 'The movement of water molecules from a region of high water potential to a region of lower water potential across a partially permeable membrane, down the water potential gradient.'],
    ['What gas do plants take in?', 'Carbon dioxide'],
    ['Explain why arteries have thick walls', 'Because blood leaving the heart is under high pressure, the thick muscular and elastic wall stops the vessel bursting and helps maintain that pressure between beats.'],
    ['Name the process that splits glucose', 'Glycolysis'],
    ['Describe the role of the ribosome', 'It is the site of protein synthesis, where messenger RNA is translated into a chain of amino acids in the order the codons specify.'],
    ['What is the unit of force?', 'Newton'],
    ['State one adaptation of a root hair cell', 'A long thin extension that gives a large surface area for absorbing water and mineral ions.'],
  ],
  'all terms': [
    ['Site of photosynthesis', 'Chloroplast'],
    ['Green pigment in leaves', 'Chlorophyll'],
    ['Sugar made in photosynthesis', 'Glucose'],
    ['Gas released in photosynthesis', 'Oxygen'],
    ['Pores in a leaf', 'Stomata'],
    ['Cell that guards a pore', 'Guard cell'],
    ['Water transport tissue', 'Xylem'],
    ['Sugar transport tissue', 'Phloem'],
  ],
  'all explanations': [
    ['Why is the Treaty of Waitangi contested?', 'Because the Maori and English texts of the Treaty say materially different things about sovereignty, and the two parties therefore signed with different understandings of what was being given up.'],
    ['Why did trench warfare stall the Western Front?', 'Because defensive technology had outrun offensive tactics, so machine guns and artillery made any advance across open ground enormously costly for very little gained.'],
    ['Why did the Depression hit New Zealand so hard?', 'Because the economy depended almost entirely on exporting farm produce to Britain, so when those prices collapsed there was nothing else earning income to fall back on.'],
    ['Why did women get the vote here first?', 'Because a large organised temperance movement had already built a nationwide petition network, and a small settler parliament was easier to move than an established one.'],
    ['Why did the Musket Wars change Maori society?', 'Because muskets made existing rivalries far more lethal, which drove large migrations and permanently redrew where iwi lived and who held mana over which land.'],
    ['Why was Gallipoli a failure?', 'Because the landings were made on the wrong beaches against prepared high ground, and the campaign was never given the reinforcement it would have needed to break out.'],
  ],
  'dates and figures': [
    ['When was the Treaty of Waitangi signed?', '1840'],
    ['When did the First World War end?', '1918'],
    ['When did women get the vote in New Zealand?', '1893'],
    ['What is the speed of light in a vacuum?', '3.0 x 10^8 m/s'],
    ['What is the acceleration due to gravity?', '9.8 m/s^2'],
    ['What is the Avogadro constant?', '6.02 x 10^23'],
  ],
  'small deck, one long answer': [
    ['Symbol for sodium', 'Na'],
    ['Symbol for potassium', 'K'],
    ['Symbol for iron', 'Fe'],
    ['Explain why noble gases are unreactive', 'Because their outer electron shell is already full, so they have no tendency to gain, lose or share electrons to reach a stable arrangement.'],
  ],
};

const RUNS = 400;
const pct = (n) => (n * 100).toFixed(1).padStart(5) + '%';

function evaluate(cards, build){
  const pool = Array.from(new Set(cards.map(c => c[1])));
  let cheated = 0, giveaway = 0, asked = 0, gaveUp = 0, ratioSum = 0, worst = 1, chance = 0;
  for (let r = 0; r < RUNS; r++){
    for (const [, answer] of cards){
      const built = build(answer, pool);
      if (!built){ gaveUp++; continue; }
      asked++;
      if (cheatPick(built.options) === built.answer) cheated++;
      if (oddOneOut(built.options) === built.answer) giveaway++;
      /* Chance depends on how many options the question got — long answers
         are asked with three, so 25% is not the baseline everywhere. */
      chance += 1 / built.options.length;
      const lens = built.options.map(o => o.length);
      const ratio = Math.min(...lens) / Math.max(...lens);
      ratioSum += ratio;
      if (ratio < worst) worst = ratio;
    }
  }
  return {
    edge: asked ? (cheated - chance) / asked : 0,
    cheat: asked ? cheated / asked : 0,
    giveaway: asked ? giveaway / asked : 0,
    ratio: asked ? ratioSum / asked : 0,
    worst: asked ? worst : 0,
    refused: gaveUp / (RUNS * cards.length),
  };
}

const app = await loadApp();

console.log('');
console.log('A guesser that reads no questions, only option LENGTHS.');
console.log('  giveaway  the answer was the obvious odd one out — free marks');
console.log('  edge      how far above pure chance that guesser lands (0 = no leak)');
console.log('  ratio     shortest option / longest, averaged (1.00 = all one length)');
console.log('');
console.log('                                giveaway    edge    ratio   worst');

const line = (label, r) => label.padEnd(30) + pct(r.giveaway) + '   ' + pct(r.edge) +
  '    ' + r.ratio.toFixed(2) + '    ' + r.worst.toFixed(2) + (r.refused ? '    refused ' + pct(r.refused) : '');

const sums = { og: 0, oc: 0, or: 0, ng: 0, nc: 0, nr: 0, n: 0 };
for (const [name, cards] of Object.entries(DECKS)){
  const before = evaluate(cards, (a, pool) => oldOptions(a, pool, shuffle));
  const after = evaluate(cards, (a, pool) => app.buildOptions(a, pool, { minPicks: 3 }));
  sums.og += before.giveaway; sums.oc += before.edge; sums.or += before.ratio;
  sums.ng += after.giveaway; sums.nc += after.edge; sums.nr += after.ratio;
  sums.n++;
  console.log('');
  console.log(name);
  console.log(line('   before', before));
  console.log(line('   after', after));
}
const n = sums.n;
console.log('');
console.log('MEAN before'.padEnd(30) + pct(sums.og / n) + '   ' + pct(sums.oc / n) + '    ' + (sums.or / n).toFixed(2));
console.log('MEAN after'.padEnd(30) + pct(sums.ng / n) + '   ' + pct(sums.nc / n) + '    ' + (sums.nr / n).toFixed(2));

/* A refusal is not a failure — Learn shows that card instead and asks for it
   properly afterwards. Quiz has to ask something, so check what it ships. */
console.log('');
console.log('Quiz, which must ask something for every card it picks:');
console.log('                                giveaway    edge    ratio   questions');
for (const [name, cards] of Object.entries(DECKS)){
  const deckCards = cards.map(([front, back], i) => ({ id: 'c' + i, type: 'flip', front, back }));
  let cheated = 0, give = 0, asked = 0, ratioSum = 0, made = 0, chance = 0;
  for (let r = 0; r < RUNS; r++){
    const qs = app.buildQuiz(deckCards, deckCards.length);
    made += qs.length;
    for (const q of qs){
      asked++;
      if (cheatPick(q.options) === q.answer) cheated++;
      if (oddOneOut(q.options) === q.answer) give++;
      chance += 1 / q.options.length;
      const lens = q.options.map(o => o.length);
      ratioSum += Math.min(...lens) / Math.max(...lens);
    }
  }
  console.log(name.padEnd(30) + pct(give / asked) + '   ' + pct((cheated - chance) / asked) + '    ' +
    (ratioSum / asked).toFixed(2) + '    ' + (made / RUNS).toFixed(1) + ' of ' + deckCards.length);
}

/* ---- the things that must never happen ---------------------------------- */
console.log('');
console.log('Rules that must hold:');
console.log('');
let failures = 0;
const must = (label, ok, detail) => {
  console.log((ok ? '  ok    ' : '  FAIL  ') + label + (detail ? '  — ' + detail : ''));
  if (!ok) failures++;
};

/* The same answer spelled two ways must never both appear: one of them would
   be marked wrong for saying the right thing. */
{
  const pool = ['Mitochondria', 'mitochondria ', 'Mitochondrion', 'Ribosome', 'Chloroplast', 'Nucleus'];
  let bad = 0;
  for (let i = 0; i < 500; i++){
    const built = app.buildOptions('Mitochondria', pool, { minPicks: 1 });
    const keys = built.options.map(app.normaliseAnswer);
    if (new Set(keys).size !== keys.length) bad++;
    if (built.options.some(o => app.normaliseAnswer(o) === 'mitochondrion')) bad++;
  }
  must('no duplicate or near-duplicate of the answer among the options', bad === 0, bad + ' leaks in 500');
}

/* A number must never be offered against a word, or the other way round. */
{
  const pool = ['1840', 'Photosynthesis', 'Mitochondria', 'Respiration', 'Osmosis'];
  let bad = 0;
  for (let i = 0; i < 500; i++){
    const built = app.buildOptions('1918', pool, { minPicks: 1 });
    if (built.options.some(o => /[a-z]{4}/i.test(o))) bad++;
  }
  must('a year is never offered against a word', bad === 0, bad + ' leaks in 500');
}

/* A deck with nothing like the answer in it refuses, rather than asking a
   question that answers itself. */
{
  const pool = ['Na', 'K', 'Fe', 'Because their outer electron shell is already full, so they have no tendency to gain, lose or share electrons.'];
  const built = app.buildOptions(pool[3], pool, { minPicks: 3 });
  must('refuses when the deck holds no lookalike', built === null, built ? built.options.join(' | ') : '');
  const item = { card: { type: 'flip', front: 'Explain', back: pool[3] }, box: 0, misses: 0, seen: false };
  const q = app.buildLearnQuestion(item, pool);
  must('Learn shows that card instead of guessing at options', q.format === 'preview', 'got ' + q.format);
  const q2 = app.buildLearnQuestion({ ...item, seen: true }, pool);
  must('and asks for it properly the second time', q2.format === 'recall', 'got ' + q2.format);
}

/* The escalation still escalates: recognition while it is new, production once
   it is not. */
{
  const pool = ['Mitochondria', 'Ribosome', 'Chloroplast', 'Nucleus'];
  const card = { type: 'flip', front: 'Powerhouse of the cell', back: 'Mitochondria' };
  const fresh = app.buildLearnQuestion({ card, box: 0, misses: 0, seen: false }, pool);
  const known = app.buildLearnQuestion({ card, box: 1, misses: 0, seen: true }, pool);
  must('a new card is recognition', fresh.format === 'mcq', 'got ' + fresh.format);
  must('a card you have had once must be produced', known.format === 'typed', 'got ' + known.format);
}

/* A card that brought its own options keeps them. */
{
  const card = { type: 'mcq', options: ['Alpha', 'Beta', 'Gamma', 'Delta'], answer: 2 };
  let bad = 0;
  for (let i = 0; i < 200; i++){
    const built = app.ownOptions(card);
    if (built.options.length !== 4 || built.options[built.answer] !== 'Gamma') bad++;
  }
  must('a card with its own options keeps all four, answer tracked', bad === 0, bad + ' wrong in 200');
}

/* Numbers get invented neighbours when the deck has none. */
{
  const made = app.numericDistractors('1840', 3);
  must('a lone year still gets three plausible years',
    made.length === 3 && made.every(m => /^1[789]\d\d$/.test(m)), made.join(', '));
  const mass = app.numericDistractors('44.0 g', 3);
  must('a value keeps its unit', mass.length === 3 && mass.every(m => / g$/.test(m)), mass.join(', '));
}

console.log('');
console.log(failures ? failures + ' FAILED' : 'all rules hold');
console.log('');
try { fs.unlinkSync(OUT); } catch (e){}
process.exit(failures ? 1 : 0);
