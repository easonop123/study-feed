/* Website entry point. The Artifact build renders StudyFeed.jsx directly;
   here we mount it ourselves. Same component either way.

   Vercel Web Analytics lives ONLY here, not in StudyFeed.jsx — that file also
   runs as a claude.ai Artifact, where @vercel/analytics doesn't exist and
   there's no Vercel endpoint to report to. The <Analytics/> component posts
   page views to /_vercel/insights, which Vercel serves once Web Analytics is
   enabled for the project. It stays quiet on localhost (debug mode). */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { Analytics } from '@vercel/analytics/react';
import App from '../StudyFeed.jsx';

createRoot(document.getElementById('root')).render(
  <>
    <App />
    <Analytics />
  </>
);
