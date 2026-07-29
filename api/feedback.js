/* Vercel serverless function for the in-app "Request a feature" form.

   The browser POSTs { type, name, email, message } to /api/feedback. If an
   email provider is configured (Resend) this sends the note to the maker; if
   not, it returns a clear error and the client falls back to opening the
   user's own mail app (a mailto: link) so feedback still gets through.

   To turn on automatic sending, set these in the Vercel dashboard
   (Project → Settings → Environment Variables):
     RESEND_API_KEY  — a key from resend.com (free tier is plenty)
     FEEDBACK_TO     — where notes go (defaults to eason.op123@gmail.com)
     FEEDBACK_FROM   — verified sender (defaults to Resend's onboarding sender)
   None of these are ever committed to the repo. */

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed — use POST.' });
  }

  const body = req.body || {};
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!message) return res.status(400).json({ error: 'A message is required.' });

  const key = process.env.RESEND_API_KEY;
  const to = process.env.FEEDBACK_TO || 'eason.op123@gmail.com';
  const from = process.env.FEEDBACK_FROM || 'Study Feed <onboarding@resend.dev>';

  // Not configured to send server-side — tell the client so it can fall back
  // to the user's own mail app instead of failing silently.
  if (!key) return res.status(503).json({ error: 'Email is not set up on the server yet.' });

  const type = (body.type || 'feedback').toString().slice(0, 40);
  const name = (body.name || '').toString().slice(0, 120);
  const email = (body.email || '').toString().slice(0, 160);
  const subject = 'Study Feed ' + type + ' from ' + (name || 'a student');
  const text = 'Type: ' + type + '\nName: ' + (name || '—') + '\nEmail: ' + (email || '—') + '\n\n' + message;

  const payload = { from: from, to: to, subject: subject, text: text };
  if (email && /.+@.+\..+/.test(email)) payload.reply_to = email;

  try {
    const upstream = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      body: JSON.stringify(payload),
    });
    const detail = await upstream.text();
    if (!upstream.ok) {
      console.error('Resend ' + upstream.status + ': ' + detail.slice(0, 300));
      return res.status(502).json({ error: 'The email service refused the message.' });
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(502).json({ error: 'Could not reach the email service: ' + (e && e.message ? e.message : String(e)) });
  }
}
