/* Website entry point. The Artifact build renders StudyFeed.jsx directly;
   here we mount it ourselves. Same component either way.

   ALL analytics live ONLY in this file, never in StudyFeed.jsx — that file also
   runs as a claude.ai Artifact, where these packages don't exist and there is no
   endpoint to report to. Keeping the wiring on this side leaves the shared file
   dependency-free and leaves the Artifact a silent no-op. */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { Analytics } from '@vercel/analytics/react';
import posthog from 'posthog-js/dist/module.slim';
import App from '../StudyFeed.jsx';

/* PostHog answers the question Vercel Hobby won't: how many people actually
   make a deck, mark an answer, finish a session. Vercel's dashboard gates the
   Events panel behind Pro — the beacon returns 200 and the numbers are simply
   never shown. <Analytics/> stays for now because page views, referrers and top
   pages do work on Hobby and cost nothing; once PostHog is confirmed reporting,
   it is redundant and can go.

   The project key is public and safe to commit — it is write-only, and every
   PostHog client-side install ships it in the page. */
const POSTHOG_KEY = 'phc_qz4CaKZsLaQZapNSo9AAJ5oSB3x5g2SCeEnSxRpjmpX7';
const POSTHOG_HOST = 'https://us.i.posthog.com';

/* Imported from dist/module.slim rather than the package root on purpose. The
   slim build ships without the autocapture, session-replay and survey code at
   all — roughly half the bytes, and the privacy rule below stops being a config
   flag someone can flip back on by accident. The options are still set
   explicitly so the intent survives a future swap back to the full build. */
if (POSTHOG_KEY.startsWith('phc_') && !POSTHOG_KEY.includes('REPLACE_ME')) {
  try {
    posthog.init(POSTHOG_KEY, {
      api_host: POSTHOG_HOST,
      /* Autocapture records the text of whatever gets clicked. On this app that
         is the student's own cards. Never turn it on. */
      autocapture: false,
      disable_session_recording: true,
      disable_surveys: true,
      /* No profiles: nobody signs in, so there is no person to build. Events
         still carry an anonymous id, so unique-device counts still work — what
         is dropped is the stored profile, which we have no use for. */
      person_profiles: 'never',
      /* localStorage rather than a cookie. Same anonymous id, no cookie banner
         question, and it matches what the footer already promises. */
      persistence: 'localStorage',
      capture_pageview: true,
      capture_pageleave: true,
    });

    /* StudyFeed.jsx counts actions through window.__sfTrack rather than
       importing this package. Wrapped rather than passed as a bare reference:
       posthog.capture is a method and loses `this` when detached.

       Custom events are counts and fixed words only — see the note on track()
       in StudyFeed.jsx for what is deliberately never passed. Set before the
       first render so nothing fired during mount is dropped. */
    window.__sfTrack = (event, props) => posthog.capture(event, props);
  } catch {}
}

createRoot(document.getElementById('root')).render(
  <>
    <App />
    <Analytics />
  </>
);
