/* Website entry point. The Artifact build renders StudyFeed.jsx directly;
   here we mount it ourselves. Same component either way.

   Vercel Web Analytics lives ONLY here, not in StudyFeed.jsx — that file also
   runs as a claude.ai Artifact, where @vercel/analytics doesn't exist and
   there's no Vercel endpoint to report to. The <Analytics/> component posts
   page views to /_vercel/insights, which Vercel serves once Web Analytics is
   enabled for the project. It stays quiet on localhost (debug mode). */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { Analytics, track } from '@vercel/analytics/react';
import App from '../StudyFeed.jsx';

/* StudyFeed.jsx counts actions through window.__sfTrack rather than importing
   this package, for the same reason <Analytics/> lives here: the Artifact build
   has neither the package nor an endpoint. Wiring it up on this side keeps the
   shared file dependency-free, and leaves the Artifact a silent no-op.

   Custom events are counts only — see the note on track() in StudyFeed.jsx for
   what is deliberately never passed. */
try { window.__sfTrack = track; } catch {}

createRoot(document.getElementById('root')).render(
  <>
    <App />
    <Analytics />
  </>
);
