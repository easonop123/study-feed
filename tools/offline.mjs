/* ============================================================================
   EVERYTHING THAT CAN BE CHECKED WITHOUT THE ENDPOINT, IN ONE COMMAND.

     npm test

   The repo already had good offline checks. What it did not have was any way to
   run them: they were spread across four tools with four different flags, so
   knowing whether a change had broken something meant knowing which of eight
   scripts to reach for and which of them needed a network. In practice that
   means they get run when someone remembers, which is not when they are needed.

   Nothing here makes a model call. That is the whole point — these are the
   checks that cannot fail because the free tier is busy, so a red result is
   always a real one and is always yours. `node tools/health.mjs` is still the
   command that answers "is the AI actually working"; this one answers "did I
   break something", which is a different question and a much more frequent one.

   The two checks that are new here are the ones that were not checks at all:

   - THE BUNDLE IS THE THING THAT SHIPS. `docs/app.js` is what the deployed site
     serves, and it only matches `StudyFeed.jsx` because a human remembered to
     run the build. The README says "always rebuild after editing StudyFeed.jsx
     or the change won't ship" — that is a rule enforced by memory, and a change
     that does not ship looks exactly like a change that did not work. Rebuilt
     to a scratch file here and compared byte for byte, using the real build
     options imported from `build.mjs` rather than a copy of them.

   - THE APP STILL PARSES AS THE ARTIFACT WILL TAKE IT. The Artifact transpiler
     rejects `??`, `?.` and `||=`, so the syntax check is not a formality.
   ========================================================================== */

import { spawn } from 'node:child_process';
import { readFileSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import * as esbuild from 'esbuild';
import { BUILD } from '../build.mjs';
import { allModels, numberNamed } from './app-source.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const scratch = (name) => join(tmpdir(), `study-feed-${process.pid}-${name}`);

const args = process.argv.slice(2);
const verbose = args.includes('--verbose');

/* Each suite is a script plus the flags that keep it offline. A tool that
   later grows an offline mode belongs here; one that needs the endpoint does
   not, however useful it is. */
const SUITES = [
  { name: 'requests still build', cmd: ['tools/health.mjs', '--dry'],
    note: 'every prompt the app sends can still be constructed' },
  { name: 'paper: pure functions', cmd: ['tools/paper-eval.mjs', '--dedup'],
    note: 'setup de-duplication, deck reading, weak spots, paper into cards' },
  { name: 'multi-choice options', cmd: ['tools/options-eval.mjs'],
    note: 'a guesser reading only option lengths scores no free marks' },
  { name: 'marking notes land', cmd: ['tools/place-notes-test.mjs'],
    note: 'a quoted phrase is highlighted where the student actually wrote it' },
  { name: 'offline routing', cmd: ['tools/sw-test.mjs'],
    note: 'the service worker never caches /api/ and never pins a stale build' },
  { name: 'the model chain', cmd: ['tools/chain-test.mjs'],
    note: 'a retired model is fallen past, a hung one is not asked twice' },
];

/* WAIT FOR THE PROCESS, NOT FOR ITS PIPES.

   The obvious way to write this — resolve on 'close' — made the options check
   take FIFTEEN MINUTES for work that takes four tenths of a second. 'close'
   does not fire when the child exits; it fires when every writer on its stdout
   has let go, and `tools/options-eval.mjs` bundles the app with esbuild, which
   runs a long-lived service process of its own. That grandchild inherits the
   same pipe, outlives the `process.exit(0)` that ends the check, and holds the
   stream open until it decides to shut down. The suite sat there waiting on a
   compiler that had already given its answer.

   So resolve on 'exit', which is the child's own status, then give the pipes a
   moment to hand over whatever they were mid-way through and destroy them —
   otherwise the readable stream keeps this process alive too and the whole
   thing hangs at the end instead of in the middle. */
function run(cmd){
  return new Promise((resolve) => {
    const p = spawn(process.execPath, cmd, { cwd: ROOT });
    let out = '', settled = false;
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { out += d; });
    const done = (code) => {
      if (settled) return;
      settled = true;
      p.stdout.destroy(); p.stderr.destroy();
      resolve({ code, out });
    };
    p.on('exit', (code) => setTimeout(() => done(code == null ? 1 : code), 50));
    p.on('close', (code) => done(code == null ? 1 : code));
    p.on('error', (e) => { out += String(e && e.message || e); done(1); });
  });
}

/* How many cases each suite actually ran, surfaced next to the tick — because
   "ok" on its own is also what a suite that has quietly stopped running any
   cases looks like, and that is the failure a green board is worst at showing.
   Each of these prints its own count in its own words: "21/21 passed",
   "16/16 requests build", "15 passed, 0 failed", "all rules hold". */
function tally(out){
  const lines = out.trim().split('\n').filter(l => l.trim());
  for (let i = lines.length - 1; i >= 0; i--){
    const line = lines[i].trim();
    const slash = line.match(/\b(\d+)\s*\/\s*(\d+)\b/);
    if (slash) return `${slash[1]}/${slash[2]}`;
    const counted = line.match(/^(\d+) passed, (\d+) failed/i);
    if (counted) return `${counted[1]}/${Number(counted[1]) + Number(counted[2])}`;
    if (/^all .* hold$/i.test(line)) return 'all hold';
  }
  return '';
}

const results = [];
console.log('Offline checks — no API calls, no key needed\n');

for (const s of SUITES){
  const t0 = Date.now();
  const { code, out } = await run(s.cmd);
  const ms = Date.now() - t0;
  results.push({ name: s.name, ok: code === 0, out, ms });
  console.log(`${(code === 0 ? 'ok  ' : 'FAIL').padEnd(6)} ${s.name.padEnd(24)} ${tally(out).padEnd(8)} ${(ms / 1000).toFixed(1)}s`);
  console.log(`       ${s.note}`);
  if (code !== 0 || verbose) console.log(out.trim().split('\n').map(l => '       │ ' + l).join('\n'));
}

/* --- the app still compiles the way the Artifact needs it to ------------- */
{
  const t0 = Date.now();
  const out = scratch('syntax.mjs');
  let ok = true, detail = '';
  try {
    await esbuild.build({
      entryPoints: [join(ROOT, 'StudyFeed.jsx')], bundle: true,
      loader: { '.jsx': 'jsx' }, external: ['react'], format: 'esm', outfile: out,
      logLevel: 'silent',
    });
  } catch (e){ ok = false; detail = String(e && e.message || e); }
  rmSync(out, { force: true });
  results.push({ name: 'StudyFeed.jsx parses', ok, out: detail, ms: Date.now() - t0 });
  console.log(`${(ok ? 'ok  ' : 'FAIL').padEnd(6)} ${'StudyFeed.jsx parses'.padEnd(24)} ${''.padEnd(8)} ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log('       no ?? / ?. / ||= — the Artifact transpiler rejects them');
  if (!ok) console.log(detail.split('\n').map(l => '       │ ' + l).join('\n'));
}

/* --- every control that has no text still has a name ----------------------
   The app styles almost everything inline and labels almost everything with a
   styled <div> rather than a <label>, so nothing connects a heading to the
   control under it. For a control with visible text that costs nothing. For the
   ones with NO text it is the whole name: `Toggle` renders a bare button with a
   sliding dot, and a screen reader announced "button" — not what it switches,
   not whether it is on. Two of them change what the AI is asked for.

   A static check, not a rendered one, so it stays in the fast suite. It cannot
   see everything an audit would; it does pin the three controls that have no
   text to give and are added by copy-paste, which is how the last ones lost
   their labels. */
{
  const t0 = Date.now();
  /* Block comments come out first. This file explains itself at length, and
     the explanation of why `Toggle` needs a label mentions `<Toggle/>` — which
     the check then read as an unlabelled one. A checker that fails on the
     sentence describing the rule is a checker people turn off. */
  const src = readFileSync(join(ROOT, 'StudyFeed.jsx'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const problems = [];

  /* `[\s\S]*?` and not `[^>]*`, which is the obvious way to write this and is
     wrong here: every one of these controls carries an arrow-function handler,
     so the FIRST `>` in the tag belongs to `() =>`. A character class excluding
     `>` stops there and matches nothing — the check found zero switches in a
     file with six and reported success. Non-greedy to the first `/>` instead. */
  const toggles = [...src.matchAll(/<Toggle\b[\s\S]*?\/>/g)].map(m => m[0]);
  for (const t of toggles) if (!/\blabel=/.test(t)) problems.push('a Toggle with no label: ' + t.replace(/\s+/g, ' ').slice(0, 70));

  /* A range or date input has no placeholder to fall back on, and the app has
     no <label> elements at all — so aria-label is the only name available. */
  for (const m of src.matchAll(/<input\b[\s\S]*?type="(range|date)"[\s\S]*?\/>/g))
    if (!/aria-label=/.test(m[0])) problems.push(`an <input type="${m[1]}"> with no aria-label`);

  const ok = !problems.length && toggles.length > 0;
  const detail = problems.length ? problems.join('; ') : (toggles.length ? '' : 'no <Toggle/> found — has it been renamed?');
  const ms = Date.now() - t0;
  results.push({ name: 'unlabelled controls', ok, out: detail, ms });
  console.log(`${(ok ? 'ok  ' : 'FAIL').padEnd(6)} ${'unlabelled controls'.padEnd(24)} ${`${toggles.length} sw`.padEnd(8)} ${(ms / 1000).toFixed(1)}s`);
  console.log('       switches and sliders carry a name and a state for a screen reader');
  if (!ok) console.log('       │ ' + detail);
}

/* --- the proxy will forward everything the app actually asks for ----------
   `api/nvidia.js` now refuses a model it does not recognise and caps how much
   it will ask for, because without that it is a free uncapped LLM endpoint on
   this project's one API key — and the harm is not a bill, it is the free
   tier's shared 40-a-minute being spent on somebody else's script while a
   student waits.

   The list in the proxy cannot import from `StudyFeed.jsx`, so it is written
   out by hand, so it can drift — and the way it drifts is the worst possible
   one: NVIDIA retires a model, the MODEL_* ids are swapped, and every AI
   feature starts returning 400 from our own proxy. Checked here instead. */
{
  const t0 = Date.now();
  const app = readFileSync(join(ROOT, 'StudyFeed.jsx'), 'utf8');
  const proxy = readFileSync(join(ROOT, 'api', 'nvidia.js'), 'utf8');
  /* Everything this block finds wrong ends up here, in the order it was found. */
  const budgetProblems = [];

  /* EVERY model the app can end up sending, not just the head of each chain.

     `postChat` walks TEXT_MODELS / VISION_MODELS when one is retired or stops
     answering, so a chain member missing from the allowlist is not a dormant
     inconsistency — it is the fallback failing at the exact moment the fallback
     is what the app is relying on, and failing with a 400 from our own proxy
     rather than from NVIDIA. The old MODEL_* literals are still read so this
     keeps working if a future change goes back to naming one id. */
  const appModels = allModels(app);
  const allowBlock = (proxy.match(/const ALLOWED_MODELS = \[([\s\S]*?)\];/) || [])[1] || '';
  const allowed = [...allowBlock.matchAll(/'([^']+)'/g)].map(m => m[1]);
  const unlisted = appModels.filter(m => allowed.indexOf(m) < 0);
  /* Drift runs both ways. An id left in the allowlist after the app stopped
     using it is a model this project's key can still be spent on by anyone who
     finds the URL, which is the thing the allowlist exists to prevent. */
  const stale = allowed.filter(m => appModels.indexOf(m) < 0);
  if (!appModels.length) budgetProblems.push('no model ids found in StudyFeed.jsx — this check would pass vacuously');

  /* Every ceiling the app sends, whether written inline or via a constant.

     GEN_MAX_TOKENS is now derived from a measured write rate rather than typed
     as a literal, so it is evaluated rather than matched — a ceiling this check
     cannot see is a ceiling it cannot police, and silently skipping one is how
     a request starts getting turned away by our own proxy. */
  const derived = [];
  for (const m of app.matchAll(/const ([A-Z_]*MAX_TOKENS)\s*=/g)){
    const v = numberNamed(app, m[1]);
    if (v) derived.push(v);
    else budgetProblems.push(`could not work out ${m[1]} — it is a ceiling this check cannot police`);
  }
  const ceilings = [
    ...[...app.matchAll(/(?:callModel|postMessages|postChat)\((?:[^()]|\([^()]*\))*?,\s*(\d+)\s*,/g)].map(m => Number(m[1])),
    ...derived,
  ];
  const cap = Number((proxy.match(/const MAX_TOKENS_CEILING = (\d+)/) || [])[1] || 0);
  const overCap = ceilings.filter(n => n > cap);

  /* THE TIME BUDGET IS THREE NUMBERS IN TWO FILES AND THEY HAVE TO AGREE.

     `maxDuration` is what the platform allows the function; the proxy aborts
     upstream five seconds inside that so it can return its own JSON 504; and
     the client's FIRST attempt has to outlast that abort, or it hangs up while
     the server is still working and the student sees "couldn't reach the AI"
     instead of "the model timed out". That last mistake has already been made
     once on this repo — the first attempt gave up at 40s against a 55s abort,
     turning a 45-second answer into an 86-second wait or a failure.

     Raising the budget is the one fix for the marking timeouts that costs no
     quality, so somebody is going to raise it. This is what stops them raising
     one of the three. */
  const maxDuration = Number((proxy.match(/export const maxDuration = (\d+)/) || [])[1] || 0);
  const abortExpr = (proxy.match(/const UPSTREAM_ABORT_MS = \(maxDuration - (\d+)\)/) || [])[1];
  const abortMs = abortExpr ? (maxDuration - Number(abortExpr)) * 1000 : 0;
  const attempts = ((app.match(/const ATTEMPT_MS = \[([^\]]+)\]/) || [])[1] || '')
    .split(',').map(n => Number(n.trim())).filter(n => n > 0);
  const first = attempts[0] || 0;
  /* (declared at the top of this block) */
  if (!maxDuration || !abortMs) budgetProblems.push('could not read maxDuration / UPSTREAM_ABORT_MS from api/nvidia.js');
  else if (!first) budgetProblems.push('could not read ATTEMPT_MS from StudyFeed.jsx');
  else if (first <= abortMs) budgetProblems.push(`the client gives up at ${first / 1000}s but the proxy works until ${abortMs / 1000}s — it would hang up on an answer that was coming, and report the wrong error`);
  else if (first > maxDuration * 1000) budgetProblems.push(`the client waits ${first / 1000}s but the platform kills the function at ${maxDuration}s — the extra wait buys nothing`);

  const ok = !unlisted.length && !stale.length && !!cap && !overCap.length && !budgetProblems.length;
  const detail = [
    unlisted.length ? `a model the app can fall onto is not in ALLOWED_MODELS: ${unlisted.join(', ')} — it would 400 from our own proxy` : '',
    stale.length ? `ALLOWED_MODELS still permits a model the app never sends: ${stale.join(', ')} — that is this project's key open to a model nobody is using` : '',
    !cap ? 'MAX_TOKENS_CEILING not found in api/nvidia.js' : '',
    overCap.length ? `the app asks for more tokens than the proxy allows (${Math.max(...overCap)} > ${cap})` : '',
    ...budgetProblems,
  ].filter(Boolean).join('; ');
  const ms = Date.now() - t0;
  results.push({ name: 'the proxy allows the app', ok, out: detail, ms });
  console.log(`${(ok ? 'ok  ' : 'FAIL').padEnd(6)} ${'the proxy allows the app'.padEnd(24)} ${`${appModels.length}m ${Math.max(0, ...ceilings)}t`.padEnd(8)} ${(ms / 1000).toFixed(1)}s`);
  console.log(`       models, token ceilings and the ${maxDuration}s/${abortMs / 1000}s/${first / 1000}s time budget all agree`);
  if (!ok) console.log('       │ ' + detail);
}

/* --- the utility classes the app uses all have a rule to match ------------
   The app used to load the Tailwind play CDN, which compiled whatever classes
   it found. It now ships eighteen hand-written rules in `docs/app/index.html`
   instead, which is 3KB of CSS in place of a compiler — but it means a class
   nobody wrote a rule for silently does nothing, and "silently does nothing"
   for a layout class is a screen that looks subtly wrong on one device.

   So the pairing is checked rather than remembered, in both directions. A class
   with no rule is the bug above. A rule with no class is dead CSS, which is how
   a hand-maintained stylesheet turns back into the thing it replaced. */
{
  const t0 = Date.now();
  const src = readFileSync(join(ROOT, 'StudyFeed.jsx'), 'utf8');
  const shell = readFileSync(join(ROOT, 'docs', 'app', 'index.html'), 'utf8');

  const used = new Set();
  for (const m of src.matchAll(/className="([^"]*)"/g))
    for (const cls of m[1].split(/\s+/))
      if (cls && !cls.startsWith('sf-')) used.add(cls);

  /* Only the utility block at the bottom of the shell's first <style>, so
     Preflight's element selectors are not mistaken for utilities. */
  const declared = new Set();
  for (const m of shell.matchAll(/^\s*\.([A-Za-z0-9\\.:_-]+)\{/gm))
    declared.add(m[1].replace(/\\/g, ''));

  const missing = [...used].filter(c => !declared.has(c)).sort();
  const dead = [...declared].filter(c => !used.has(c)).sort();
  const ok = !missing.length && !dead.length;
  const detail = [
    missing.length ? `used in StudyFeed.jsx with no rule in docs/app/index.html: ${missing.join(', ')}` : '',
    dead.length ? `a rule in docs/app/index.html that nothing uses: ${dead.join(', ')}` : '',
  ].filter(Boolean).join('; ');
  const ms = Date.now() - t0;
  results.push({ name: 'utility classes match', ok, out: detail, ms });
  console.log(`${(ok ? 'ok  ' : 'FAIL').padEnd(6)} ${'utility classes match'.padEnd(24)} ${`${used.size}/${declared.size}`.padEnd(8)} ${(ms / 1000).toFixed(1)}s`);
  console.log('       every layout class the app uses has a rule, and no rule is dead');
  if (!ok) console.log('       │ ' + detail);
}

/* --- docs/app.js is what the site serves, so it has to be current -------- */
{
  const t0 = Date.now();
  const out = scratch('bundle.js');
  let ok = false, detail = '';
  try {
    await esbuild.build({ ...BUILD, absWorkingDir: ROOT, outfile: out, logLevel: 'silent' });
    const fresh = readFileSync(out);
    const shipped = readFileSync(join(ROOT, 'docs', 'app.js'));
    ok = fresh.equals(shipped);
    if (!ok) detail = `docs/app.js is ${shipped.length} bytes, a fresh build is ${fresh.length} — run \`npm run build\` and commit the result, or the change will not ship`;
  } catch (e){ detail = String(e && e.message || e); }
  rmSync(out, { force: true });
  const ms = Date.now() - t0;
  results.push({ name: 'docs/app.js is current', ok, out: detail, ms });
  console.log(`${(ok ? 'ok  ' : 'FAIL').padEnd(6)} ${'docs/app.js is current'.padEnd(24)} ${''.padEnd(8)} ${(ms / 1000).toFixed(1)}s`);
  console.log('       the bundle the deployed site serves matches the source');
  if (!ok) console.log('       │ ' + detail);
}

/* --- the deploy config still points at things that exist ------------------
   `vercel.json` carries two jobs that used to need a person: it runs these
   checks as part of the build, and it schedules the daily model-retirement
   guard. Both are strings naming things elsewhere in the repo, which is the
   kind of link that rots in silence — a renamed endpoint turns the alarm off
   and nothing anywhere says so, which is the exact failure the alarm exists to
   prevent. */
{
  const t0 = Date.now();
  const problems = [];
  let crons = 0;
  try {
    const cfg = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));

    /* The build has to run these checks, or the one thing that cannot be
       enforced by a checker — that somebody ran the checker — goes back to
       being a matter of memory. */
    if (!/\bnpm test\b/.test(String(cfg.buildCommand || '')))
      problems.push('vercel.json buildCommand does not run `npm test`, so a deploy can ship a change these checks would have caught');
    if (!/\bnpm run build\b/.test(String(cfg.buildCommand || '')))
      problems.push('vercel.json buildCommand does not run `npm run build`');
    if (cfg.outputDirectory !== 'docs')
      problems.push(`vercel.json outputDirectory is ${JSON.stringify(cfg.outputDirectory)}, and the site is served from docs/`);

    for (const c of cfg.crons || []){
      crons++;
      const path = String(c.path || '');
      const file = join(ROOT, path.replace(/^\//, '') + '.js');
      if (!existsSync(file)) problems.push(`vercel.json schedules ${path}, which has no handler at ${path.replace(/^\//, '')}.js — the job would 404 every day, quietly`);
      if (!/^[-\d,*/ ]+$/.test(String(c.schedule || ''))) problems.push(`cron schedule ${JSON.stringify(c.schedule)} is not a cron expression`);
    }
  } catch (e){ problems.push('could not read vercel.json: ' + String(e && e.message || e)); }

  const ok = !problems.length;
  const detail = problems.join('; ');
  const ms = Date.now() - t0;
  results.push({ name: 'the deploy config holds', ok, out: detail, ms });
  console.log(`${(ok ? 'ok  ' : 'FAIL').padEnd(6)} ${'the deploy config holds'.padEnd(24)} ${`${crons} cron`.padEnd(8)} ${(ms / 1000).toFixed(1)}s`);
  console.log('       the build runs these checks, and every scheduled job has a handler');
  if (!ok) console.log('       │ ' + detail);
}

const failed = results.filter(r => !r.ok);
console.log('\n' + '─'.repeat(60));
console.log(`${results.length - failed.length}/${results.length} offline checks pass`
  + (failed.length ? `  —  FAILING: ${failed.map(f => f.name).join(', ')}` : ''));
console.log('For whether the model is answering: node tools/health.mjs');
process.exit(failed.length ? 1 : 0);
