/* ============================================================================
   DIAGNOSTIC EVAL — does "Find my gaps" actually find the gap?

   The feature's whole claim is that it does not just mark you, it tells you
   WHAT is missing: the term you cannot name, the link you did not make. A
   score of 4/8 is not that. "You did not connect surface area to the number of
   collisions" is. So the thing to measure is not accuracy, it is whether the
   gap sentence names something specific enough to act on tonight.

     node tools/diagnose-eval.mjs                # both halves
     node tools/diagnose-eval.mjs --blueprint    # only the test-writing half
     node tools/diagnose-eval.mjs --diagnose     # only the answer-reading half
     node tools/diagnose-eval.mjs --repeat 2     # drift check

   Hits the LIVE endpoint, because there is no /api/nvidia in local dev.

   Nothing here re-implements the app: the prompts and parsers are bundled out
   of StudyFeed.jsx, so this cannot quietly test a prompt the app stopped
   sending. Same reason as tools/options-eval.mjs.
   ========================================================================== */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as esbuild from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tools', '.diagnose-eval-bundle.mjs');
const ENDPOINT = 'https://studyfeed.app/api/nvidia';

const EXPORTS = ['blueprintPrompt', 'diagnosePrompt', 'cleanBlueprint', 'rungSplit',
  'parseJsonArray', 'rescueObjects', 'RUNGS'];

async function loadApp(){
  const src = fs.readFileSync(path.join(ROOT, 'StudyFeed.jsx'), 'utf8');
  const shim = path.join(ROOT, '.diagnose-eval-src.jsx');
  fs.writeFileSync(shim, src + '\nexport { ' + EXPORTS.join(', ') + ' };\n');
  try {
    await esbuild.build({
      entryPoints: [shim], bundle: true, format: 'esm', outfile: OUT,
      loader: { '.jsx': 'jsx' }, jsx: 'automatic', external: ['react', 'react/jsx-runtime'],
      logLevel: 'error',
    });
  } finally { fs.unlinkSync(shim); }
  const src2 = fs.readFileSync(path.join(ROOT, 'StudyFeed.jsx'), 'utf8');
  const model = (src2.match(/const MODEL_SMART = '([^']+)'/) || [])[1];
  if (!model) throw new Error('MODEL_SMART not found in StudyFeed.jsx');
  const mod = await import('file://' + OUT.replace(/\\/g, '/') + '?t=' + Date.now());
  return { app: mod, model };
}

async function ask(model, prompt, maxTokens){
  const started = Date.now();
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }],
      temperature: 0.7, top_p: 0.9, max_tokens: maxTokens, stream: false }),
  });
  const text = await res.text();
  const ms = Date.now() - started;
  if (!res.ok) return { ok: false, ms, error: `HTTP ${res.status}: ${text.slice(0, 180)}` };
  let payload;
  try { payload = JSON.parse(text); } catch { return { ok: false, ms, error: 'reply was not JSON' }; }
  const c = payload && payload.choices && payload.choices[0];
  const reply = c && c.message && c.message.content;
  if (typeof reply !== 'string') return { ok: false, ms, error: 'no message content' };
  return { ok: true, ms, reply, finish: c.finish_reason, usage: payload.usage || {} };
}

/* The guard the last release put in: the model must never cite a standard it
   half-remembers. These prompts carry NCEA_RULES too, so the same detector
   runs here — a new prompt is a new chance to reintroduce the bug. */
const STANDARD_CITATION = /\bAS\s?9\d{4}\b|\b9[0-2]\d{3}\b|\bNZQA\b|\bthe standard (?:requires|says|wants|asks)\b|\bmarking schedule\b/gi;

/* A gap sentence that could have been written without reading the answer is a
   failure, however true it is. */
const USELESS_GAP = /\b(revise|review|study|read over|go over|revisit|brush up|practi[sc]e more|more detail is needed|be more specific)\b/i;

const args = process.argv.slice(2);
const only = args.includes('--blueprint') ? 'blueprint' : args.includes('--diagnose') ? 'diagnose' : 'both';
const REPEAT = Math.max(1, Number(args[args.indexOf('--repeat') + 1]) || 1);

const { app, model } = await loadApp();
const pct = (n, d) => d ? (100 * n / d).toFixed(0).padStart(3) + '%' : '  --';
let failures = 0;

/* ---- half one: can it write the test? ---------------------------------- */
const TOPICS = [
  { topic: 'rates of reaction', level: 'NCEA Level 1', n: 6 },
  { topic: 'genetic variation', level: 'NCEA Level 1 AS92022 genetic variation', n: 6 },
  { topic: 'the causes of the First World War', level: 'NCEA Level 2', n: 12 },
];

if (only !== 'diagnose'){
  console.log('\nBLUEPRINT — can it turn a bare topic into separable checkpoints?\n');
  console.log('topic                              n   rungs        standalone  one-thing  over  cites  ms');
  for (const t of TOPICS){
    for (let r = 0; r < REPEAT; r++){
      const out = await ask(model, app.blueprintPrompt(t.topic, t.level, t.n), 3000);
      if (!out.ok){ console.log(t.topic.padEnd(34) + ' FAILED ' + out.error); failures++; continue; }
      const items = app.cleanBlueprint(app.parseJsonArray(out.reply), t.n);
      const tally = app.RUNGS.map(rg => items.filter(i => i.rung === rg).length).join('/');
      /* A probe that points at something the student cannot see is unanswerable
         and its "gap" would be noise. */
      const dangling = items.filter(i => /\b(the (diagram|graph|table|text|passage|material|image|figure)|above|below|shown)\b/i.test(i.probe)).length;
      /* Two questions in one probe means a miss cannot be attributed. */
      const doubled = items.filter(i => (i.probe.match(/\?/g) || []).length > 1
        || /\band (also )?(explain|describe|name|state|discuss)\b/i.test(i.probe)).length;
      const cites = (out.reply.match(STANDARD_CITATION) || []).length;
      /* Content from above the stated level manufactures a gap the student is
         not meant to have closed yet. Level 1 chemistry does not do rate laws,
         rate constants, orders of reaction or the Arrhenius equation. */
      const overPitch = items.filter(i => /(rate law|rate constant|order of reaction|arrhenius|ln|half.life|equilibrium constant)/i.test(i.probe + ' ' + i.checkpoint)).length;
      if (items.length < 4) failures++;
      if (cites) failures++;
      console.log(
        t.topic.slice(0, 33).padEnd(34) +
        String(items.length).padStart(2) + '   ' + tally.padEnd(12) +
        pct(items.length - dangling, items.length) + '       ' +
        pct(items.length - doubled, items.length) + '   ' + String(overPitch).padStart(4) + '  ' +
        String(cites).padStart(4) + '  ' + out.ms
      );
      if (r === 0 && t === TOPICS[0]){
        console.log('\n  sample checkpoints:');
        for (const i of items.slice(0, 4)) console.log('   [' + i.rung.padEnd(5) + '] ' + i.probe.slice(0, 95));
        console.log('');
      }
    }
  }
}

/* ---- half two: reading answers whose gap is known in advance ------------
   A fixed blueprint, so this measures the DIAGNOSIS and not the variance of
   the test-writing step. Each answer is written to have one designed flaw. */
const FIXED = [
  { rung: 'name', checkpoint: 'name the factors that change reaction rate',
    probe: 'Name three things that change how fast a reaction goes.',
    expect: 'any three of: temperature, concentration, surface area / particle size, pressure (for gases), a catalyst' },
  { rung: 'name', checkpoint: 'state what a catalyst does',
    probe: 'What does a catalyst do to a reaction?',
    expect: 'speeds the reaction up by providing a route of lower activation energy; is not used up' },
  { rung: 'link', checkpoint: 'explain why temperature raises the rate',
    probe: 'Explain why heating a reaction makes it go faster. (1-3 sentences)',
    expect: 'particles gain kinetic energy, so they collide MORE OFTEN and, crucially, a greater proportion of collisions exceed the activation energy' },
  { rung: 'link', checkpoint: 'explain why surface area raises the rate',
    probe: 'Explain why a powdered solid reacts faster than the same mass as one lump. (1-3 sentences)',
    expect: 'powder exposes more surface area, so more particles are available to be hit, so the frequency of successful collisions rises' },
  { rung: 'apply', checkpoint: 'apply rate factors to an unfamiliar situation',
    probe: 'A student gets hydrogen from magnesium and acid, but the reaction is too slow. They cannot change the acid. Suggest TWO changes they could make and justify which would work best.',
    expect: 'two valid changes (heat it, powder/finer magnesium, catalyst) each justified by collision theory, and a comparison that picks one and says why' },
];

const ANSWERS = [
  { kind: 'full', want: 'solid', a: [
    'Temperature, concentration and surface area.',
    'It speeds the reaction up by giving it a pathway with a lower activation energy, and it is not used up itself.',
    'Heating gives the particles more kinetic energy so they move faster and collide more often, and more of those collisions have enough energy to get over the activation energy, so more collisions are successful.',
    'Powder has a much larger surface area than one lump of the same mass, so more magnesium particles are exposed to the acid at once and the frequency of successful collisions goes up.',
    'They could heat the acid and they could use magnesium powder instead of a ribbon. Heating works on every particle in the mixture, raising both the collision frequency and the proportion of collisions above the activation energy, whereas powdering only increases the exposed surface, so heating would have the bigger effect.',
  ] },
  { kind: 'names but cannot link', want: 'shaky-or-missing on link', a: [
    'Temperature, concentration and surface area.',
    'It speeds up the reaction and is not used up.',
    'Because it is hotter so it goes faster.',
    'Because powder is smaller so it reacts quicker.',
    'Heat it up and use powder.',
  ], expectGapMentions: [null, null, /collision|activation|energy/i, /surface area|collision/i, /justif|compar|why|because/i] },
  { kind: 'link asserted, mechanism missing', want: 'shaky on link', a: [
    'Temperature, concentration, surface area.',
    'Lowers the activation energy needed and is not used up.',
    'Heating makes the particles collide more often, so the rate goes up.',
    'Powder has more surface area so there are more collisions and it is faster.',
    'Heat it, or powder the magnesium. Both increase the number of collisions so both would work.',
  ], expectGapMentions: [null, null, /activation|proportion|enough energy|successful/i, null, /which|best|compar|justif/i] },
  { kind: 'blank', want: 'missing', a: ['', '', '', '', ''] },
];

if (only !== 'blueprint'){
  console.log('\nDIAGNOSIS — answers written with a KNOWN flaw. Does it name that flaw?\n');
  console.log('answer set                       verdicts             specific  onTarget  cites  tok   ms');
  for (const set of ANSWERS){
    for (let r = 0; r < REPEAT; r++){
      const items = FIXED.map((f, i) => ({ ...f, answer: set.a[i] }));
      const out = await ask(model, app.diagnosePrompt('rates of reaction', 'NCEA Level 1', items), 3000);
      if (!out.ok){ console.log(set.kind.padEnd(33) + ' FAILED ' + out.error); failures++; continue; }
      const obj = app.rescueObjects(out.reply)[0];
      if (!obj || !Array.isArray(obj.items)){
        console.log(set.kind.padEnd(33) + ' FAILED — no parseable object' + (out.finish === 'length' ? ' (TRUNCATED)' : ''));
        failures++; continue;
      }
      const rows = obj.items;
      const verdicts = FIXED.map((_, i) => {
        const row = rows.find(x => Number(x.i) === i);
        const v = row ? String(row.verdict || '') : '';
        return v === 'solid' ? 'S' : v === 'shaky' ? 'k' : v === 'missing' ? 'm' : '?';
      }).join('');
      const gaps = rows.filter(x => String(x.verdict) !== 'solid' && String(x.gap || '').trim());
      /* Specific = not a "revise it" sentence, and long enough to carry a noun. */
      const specific = gaps.filter(g => !USELESS_GAP.test(g.gap) && g.gap.trim().split(/\s+/).length >= 6).length;
      /* On target = for the answers whose flaw we designed, does the gap
         sentence actually mention the thing that was missing? */
      let onTargetHit = 0, onTargetOf = 0;
      if (set.expectGapMentions){
        set.expectGapMentions.forEach((re, i) => {
          if (!re) return;
          onTargetOf++;
          const row = rows.find(x => Number(x.i) === i);
          if (row && re.test(String(row.gap || ''))) onTargetHit++;
        });
      }
      const cites = (out.reply.match(STANDARD_CITATION) || []).length;
      if (cites) failures++;
      if (out.finish === 'length') failures++;
      console.log(
        set.kind.padEnd(33) + verdicts.padEnd(21) +
        pct(specific, gaps.length) + '     ' +
        (onTargetOf ? pct(onTargetHit, onTargetOf) : '   --') + '   ' +
        String(cites).padStart(4) + '  ' +
        String(out.usage.completion_tokens || '?').padStart(4) + '  ' + out.ms
      );
      if (set.kind === 'names but cannot link' && r === 0){
        console.log('\n  headline: ' + (obj.headline || '(none)'));
        console.log('  pattern:  ' + (obj.pattern || '(none)'));
        for (const g of gaps.slice(0, 3)) console.log('  gap #' + g.i + ':   ' + String(g.gap).slice(0, 110));
        console.log('  next:     ' + (obj.next || []).join(' | ').slice(0, 130));
        console.log('');
      }
    }
  }
  console.log('\nverdict letters: S=solid  k=shaky  m=missing  — read them with the answer set,');
  console.log('the "full" row should be all solid and "blank" all missing.\n');
}

try { fs.unlinkSync(OUT); } catch (e){}
console.log(failures ? failures + ' HARD FAILURES (parse, truncation, or a standard citation)\n' : 'no hard failures\n');
process.exit(failures ? 1 : 0);
