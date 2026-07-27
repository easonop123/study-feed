/* Vercel serverless proxy for the NVIDIA Build API.

   The browser POSTs an OpenAI-compatible chat body to /api/nvidia. This
   function adds the Authorization header — using the NVIDIA_API_KEY that
   lives only in the server's environment — and forwards the request to
   NVIDIA. That keeps the key out of the browser and sidesteps CORS, since
   the page now talks only to its own origin.

   Set NVIDIA_API_KEY in the Vercel dashboard (Project → Settings →
   Environment Variables). It is never committed to the repo. */

const NVIDIA_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';

// Allow the function up to 60s (Hobby-plan max) so a slow model returns a real
// response/error instead of being killed early. The client also aborts at 60s.
export const maxDuration = 60;

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

  try {
    const upstream = await fetch(NVIDIA_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + key,
      },
      // Vercel parses JSON bodies into req.body; re-serialize to forward it.
      body: JSON.stringify(req.body),
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
    return res.status(502).json({
      error: 'Failed to reach NVIDIA: ' + (e && e.message ? e.message : String(e)),
    });
  }
}
