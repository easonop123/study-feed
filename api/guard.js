/* THE DAILY QUESTION: has NVIDIA retired a model this app ships?

   The outage on 17 Sep 2026 was not that the app broke. It was that nobody
   KNEW. A model was retired, every AI feature stopped in the same second, and
   the first report came from a person trying to use the app days later. The
   model chain in `StudyFeed.jsx` fixes the outage — a retired model is fallen
   past in a third of a second and the student never finds out — but it makes
   the silence worse, not better: the chain gets shorter every time this
   happens and nothing says a word until the last one goes.

   So something has to ask. Vercel's scheduler calls this once a day (see
   `vercel.json`) and it emails only when the answer is yes.

   WHY THIS RUNS HERE RATHER THAN IN GITHUB ACTIONS. The obvious home for a
   daily check is a scheduled workflow, and one was written. It could not be
   committed: pushing anything under `.github/workflows/` needs a token with the
   `workflow` scope, which would have meant asking a human to re-authorise a
   GitHub token before the alarm could exist at all. An alarm that needs a
   favour to install is an alarm that does not get installed. This needs
   nothing that is not already here — the key is already in this project's
   environment, the scheduler is already part of the platform it deploys to, and
   `api/feedback.js` already proves the mail path works.

   WHAT IT WILL AND WILL NOT WAKE SOMEBODY FOR. Only 404 and 410. Those are
   permanent, unambiguous and will not heal. A timeout is not a failure here and
   neither is a 503 or a 429: the free tier has a bad minute most days, and an
   alarm that fires on those is an alarm that gets filtered to a folder and then
   missed on the morning that matters. `node tools/health.mjs` remains the
   command for "is it answering WELL today", which is a judgement and belongs to
   a person. */

import { ALLOWED_MODELS } from './nvidia.js';

const NVIDIA_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';

/* Four small calls, run one at a time. Nothing here is urgent enough to spend
   the free tier's shared per-minute budget in a burst. */
export const maxDuration = 60;

const PROBE = 'Reply with the single word: ready';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* One cheap call. A retirement answers instantly, so this needs nowhere near
   the budget a real request does — and a short clock here means a slow morning
   cannot turn the whole check into a timeout. */
async function ask(model, key){
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(NVIDIA_URL, {
      method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      body: JSON.stringify({
        model: model, messages: [{ role: 'user', content: PROBE }],
        max_tokens: 300, temperature: 0.2, stream: false,
      }),
    });
    const text = await res.text();
    let why = '';
    try {
      const j = JSON.parse(text);
      why = j.detail || (j.error && (j.error.message || j.error)) || '';
    } catch {}
    return { model: model, status: res.status, why: String(why || '').slice(0, 200) };
  } catch (e){
    /* A throw is the network or the clock, never a retirement. Say so plainly
       rather than letting it look like a verdict. */
    return { model: model, status: 0, why: 'no answer: ' + String(e && e.message || e).slice(0, 120) };
  } finally { clearTimeout(timer); }
}

async function mail(retired, checked){
  const key = process.env.RESEND_API_KEY;
  const to = process.env.FEEDBACK_TO || 'eason.op123@gmail.com';
  const from = process.env.FEEDBACK_FROM || 'Study Feed <onboarding@resend.dev>';
  if (!key) return { sent: false, why: 'RESEND_API_KEY is not set' };

  const lines = [
    'NVIDIA has retired ' + retired.length + ' of the ' + checked + ' models Study Feed ships.',
    '',
    'The app is NOT down. postChat falls past a retired model in about a third of',
    'a second and students will not notice. But the chain is now shorter than it',
    'looks, and it gets shorter every time this happens.',
    '',
    'Retired:',
    ...retired.map(r => '  ' + r.model + '  (HTTP ' + r.status + ')  ' + r.why),
    '',
    'To fix it:',
    '  node tools/models.mjs             # what is alive in the catalogue now',
    '  node tools/models.mjs --bake <id> # does it work on the app\'s real prompts',
    '',
    'Then update TEXT_MODELS / VISION_MODELS in StudyFeed.jsx and ALLOWED_MODELS',
    'in api/nvidia.js. `npm test` fails if the two disagree.',
  ].join('\n');

  try {
    const upstream = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      body: JSON.stringify({
        from: from, to: to,
        subject: 'Study Feed: ' + retired.length + ' model' + (retired.length === 1 ? '' : 's') + ' retired by NVIDIA',
        text: lines,
      }),
    });
    if (!upstream.ok){
      const detail = await upstream.text();
      console.error('guard: Resend ' + upstream.status + ': ' + detail.slice(0, 300));
      return { sent: false, why: 'Resend ' + upstream.status };
    }
    return { sent: true };
  } catch (e){
    return { sent: false, why: String(e && e.message || e).slice(0, 160) };
  }
}

export default async function handler(req, res) {
  const key = process.env.NVIDIA_API_KEY;
  if (!key) return res.status(500).json({ error: 'NVIDIA_API_KEY is not set on the server.' });

  /* Not a security boundary and not pretending to be one — Vercel's scheduler
     only sends a bearer token when CRON_SECRET is configured, and setting an
     environment variable is exactly the human step this whole file exists to
     avoid. What it does do is stop a passer-by who finds the path in the source
     from making the mailbox ring. The real limit is below it: nothing is sent
     unless a model is genuinely retired, which is rare and is news. */
  const ua = String(req.headers['user-agent'] || '');
  const fromCron = /vercel-cron/i.test(ua);
  const manual = req.query && (req.query.check === '1');
  if (!fromCron && !manual){
    return res.status(200).json({
      ok: true,
      note: 'Daily model retirement check. Add ?check=1 to run it by hand.',
    });
  }

  const rows = [];
  for (const model of ALLOWED_MODELS){
    rows.push(await ask(model, key));
    await sleep(300);
  }

  const retired = rows.filter(r => r.status === 404 || r.status === 410);
  const summary = { checked: rows.length, retired: retired.length, rows: rows };

  if (!retired.length){
    console.log('guard: all ' + rows.length + ' models still in the catalogue');
    return res.status(200).json(Object.assign({ ok: true }, summary));
  }

  /* Logged as well as emailed. If the mail key is ever unset, the Vercel
     runtime log is the only place this exists, and a finding that is nowhere is
     the situation this file was written to end. */
  console.error('guard: RETIRED — ' + retired.map(r => r.model).join(', '));
  const post = await mail(retired, rows.length);
  return res.status(200).json(Object.assign({ ok: false, mail: post }, summary));
}
