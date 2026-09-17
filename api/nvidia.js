/* Vercel serverless proxy for the NVIDIA Build API.

   The browser POSTs an OpenAI-compatible chat body to /api/nvidia. This
   function adds the Authorization header — using the NVIDIA_API_KEY that
   lives only in the server's environment — and forwards the request to
   NVIDIA. That keeps the key out of the browser and sidesteps CORS, since
   the page now talks only to its own origin.

   Set NVIDIA_API_KEY in the Vercel dashboard (Project → Settings →
   Environment Variables). It is never committed to the repo. */

const NVIDIA_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';

// How long this function may run. 60 was the Hobby-plan maximum when this was
// written. It is the single number that sets the whole time budget: the abort
// below is derived from it, and the client's first attempt has to outlast the
// abort so it receives this function's own structured 504 rather than hanging
// up first and hiding it.
export const maxDuration = 60;

/* Derived, not written down a second time. Three numbers have to move together
   whenever this budget changes — this function's ceiling, the abort below, and
   `ATTEMPT_MS[0]` in StudyFeed.jsx — and until now all three were literals in
   two files with a paragraph of README asking people to remember. Two of them
   are now one number, and `npm test` checks the third against it.

   Five seconds of headroom so this function returns its OWN 504 rather than
   being killed by the platform, which serves an HTML error page the client
   cannot parse.

   RAISING THIS IS THE ONE FIX FOR THE MARKING TIMEOUTS THAT COSTS NO QUALITY —
   see the README's "the endpoint got three times slower". 60 was the Hobby
   ceiling when this was written; Vercel's Fluid compute allows more now. Change
   `maxDuration` alone and everything here follows; then raise `ATTEMPT_MS` to
   match, or the test will tell you. */
const UPSTREAM_ABORT_MS = (maxDuration - 5) * 1000;

/* ---------------------------------------------------------------------------
   WHAT THIS ENDPOINT WILL AND WILL NOT FORWARD.

   It used to forward `req.body` verbatim. That makes it a free, uncapped,
   unauthenticated LLM proxy for anyone who reads the page source and finds the
   URL — any model in NVIDIA's catalogue, any prompt, any length, all of it
   spent out of the one API key this app has. There is no login to hide behind
   and there cannot be one: the Artifact build calls this from claude.ai, so a
   same-origin check would break a real user while stopping nobody who can edit
   a header.

   The harm is not a bill — the tier is free — it is the QUOTA. NVIDIA's free
   tier is roughly 40 requests a minute shared across everyone using the app at
   once, and it is already the thing that makes revision at 8pm slow. Somebody
   pointing a script at this endpoint does not cost money, it takes the app away
   from students, and the failure looks exactly like the app being broken.

   So: every model the app can send, a ceiling on the reply, and a sanity check
   on the shape. None of it constrains any request the app makes, which is
   asserted by `npm test` rather than assumed — the check reads both model
   chains and every token ceiling out of StudyFeed.jsx and fails if one of them
   would be turned away here.

   This stops opportunistic use, not a determined attacker; nothing without
   state can. Real rate limiting needs a store this project does not have.
   --------------------------------------------------------------------------- */
/* TEXT_MODELS and VISION_MODELS from StudyFeed.jsx, every member and in the
   same order — not just the heads.

   The app walks its chain when a model is retired or stops answering, so an id
   missing from here is not a dormant inconsistency: it is the fallback failing
   at the exact moment the fallback is what the app is relying on, and failing
   with a 400 from its own proxy rather than from NVIDIA. `npm test` reads both
   lists and fails if they disagree — in either direction, since an id left here
   after the app stopped sending it is this project's key left open on a model
   nobody is using.

   ADDING AN ID HERE IS ALSO THE FIRST STEP IN TRYING A NEW MODEL, which is
   worth knowing before going looking for why a probe 400s. `node
   tools/models.mjs` reads NVIDIA's public catalogue and probes every chat-shaped
   id through this endpoint; `--bake` then puts the survivors through the app's
   real prompts. On 17 Sep 2026 that found 27 of 34 ids retired, most of them
   inside the previous three weeks, which is the pace to expect. */
const ALLOWED_MODELS = [
  'google/gemma-4-31b-it',                  // TEXT_MODELS[0]
  'nvidia/nemotron-3.5-lightning-30b-a3b',  // TEXT_MODELS[1]
  'openai/gpt-oss-20b',                     // TEXT_MODELS[2] — the old head, kept as a floor
  'meta/llama-3.2-11b-vision-instruct',     // VISION_MODELS[0]
];
/* The app's largest single request is marking, at 3000. The slack is so that a
   small deliberate increase does not fail in production before anyone notices;
   the test is what stops it drifting past this quietly. */
const MAX_TOKENS_CEILING = 4000;
/* The chat helper is the only feature that sends a thread rather than one turn,
   and it keeps a short one. This is well above anything the app sends and well
   below what somebody would want for a long conversation on our key. */
const MAX_MESSAGES = 40;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed — use POST.' });
  }

  const key = process.env.NVIDIA_API_KEY;
  if (!key) {
    return res.status(500).json({
      error: 'NVIDIA_API_KEY is not set on the server. Add it in the Vercel dashboard.',
    });
  }

  /* Vercel parses the JSON body into req.body. Everything below reads from a
     copy we build ourselves rather than forwarding what arrived, so a field
     nobody has thought about cannot be passed through to NVIDIA on our key. */
  const body = (req.body && typeof req.body === 'object') ? req.body : null;
  if (!body || !Array.isArray(body.messages) || !body.messages.length) {
    return res.status(400).json({ error: 'Send a chat request: { model, messages: [...] }.' });
  }
  if (body.messages.length > MAX_MESSAGES) {
    return res.status(400).json({ error: 'Too many messages in one request.' });
  }
  if (ALLOWED_MODELS.indexOf(body.model) < 0) {
    /* Named in the reply on purpose. The likeliest reader of this message is
       not an abuser, it is whoever swapped a MODEL_* id after NVIDIA retired
       one and has not updated this list — and a 400 that says which models are
       allowed turns a mystifying outage into a one-line fix. */
    return res.status(400).json({
      error: 'That model is not one this app uses. Allowed: ' + ALLOWED_MODELS.join(', ') + '.',
    });
  }

  const forward = {
    model: body.model,
    messages: body.messages,
    stream: false,
    temperature: typeof body.temperature === 'number' ? body.temperature : 0.7,
    top_p: typeof body.top_p === 'number' ? body.top_p : 0.9,
    max_tokens: Math.min(Number(body.max_tokens) || 1000, MAX_TOKENS_CEILING),
  };
  /* The two reasoning switches the app uses, passed through only in the shapes
     it sends them in. See isReasoner and takesReasoningEffort in StudyFeed.jsx
     for why each exists and which model family each belongs to. */
  if (body.reasoning_effort === 'low' || body.reasoning_effort === 'medium' || body.reasoning_effort === 'high') {
    forward.reasoning_effort = body.reasoning_effort;
  }
  if (body.chat_template_kwargs && typeof body.chat_template_kwargs === 'object') {
    forward.chat_template_kwargs = { thinking: !!body.chat_template_kwargs.thinking };
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), UPSTREAM_ABORT_MS);

  try {
    const upstream = await fetch(NVIDIA_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + key,
      },
      body: JSON.stringify(forward),
      signal: ctrl.signal,
    });

    // Pass the upstream status and body straight through, unmodified, so the
    // client keeps seeing NVIDIA's own error details (detail / error.message)
    // on failures instead of a generic wrapper.
    const text = await upstream.text();
    // Log real NVIDIA failures to the Vercel runtime logs so the cause (e.g. a
    // 410 "model reached end of life") is visible without the browser.
    if (!upstream.ok) console.error('NVIDIA ' + upstream.status + ': ' + text.slice(0, 500));
    res.status(upstream.status);
    res.setHeader('Content-Type', 'application/json');
    return res.send(text);
  } catch (e) {
    if (e && e.name === 'AbortError') {
      console.error('NVIDIA timed out after ' + (UPSTREAM_ABORT_MS / 1000) + 's');
      // 504 so the client counts it as retryable rather than a config problem.
      return res.status(504).json({ error: 'NVIDIA did not respond in time — the model timed out.' });
    }
    return res.status(502).json({
      error: 'Failed to reach NVIDIA: ' + (e && e.message ? e.message : String(e)),
    });
  } finally {
    clearTimeout(timer);
  }
}
