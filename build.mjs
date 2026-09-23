/* Build the website bundle (docs/app.js) with esbuild's JS API.

   Why a script instead of a one-line npm command: @vercel/analytics reads a few
   process.env.* vars, and `process` doesn't exist in the browser — left alone
   they throw "process is not defined". We replace them at build time. Doing the
   `define` here (rather than inline in package.json) keeps it readable and
   avoids shell-quoting differences between Windows (cmd) and Vercel (Linux). */
import * as esbuild from 'esbuild';
import { pathToFileURL } from 'node:url';

/* Exported so `tools/offline.mjs` can rebuild to a scratch file and compare,
   rather than restating these options. A staleness check written against a
   COPY of the build settings would pass while shipping a differently-built
   bundle, which is the one thing it exists to prevent. */
export const BUILD = {
  entryPoints: ['web/main.jsx'],
  bundle: true,
  minify: true,
  jsx: 'automatic',
  /* Stated rather than left to esbuild's defaults. Both of these were already
     what it inferred, so pinning them changes nothing today — verified
     byte-for-byte — and that is the point: the bundle is what the site serves,
     and it should not depend on a value being guessed correctly.

     IT IS NOT ENOUGH ON ITS OWN, WHICH IS WORTH WRITING DOWN. Adding
     `"type": "module"` to package.json — a tempting one-liner, because Node
     prints a MODULE_TYPELESS_PACKAGE_JSON warning four lines deep through the
     top of every tool run and that is exactly what it asks for — moves the
     shipped bundle anyway: esbuild reads the field when deciding how to interop
     CommonJS dependencies, and `__toESM(react())` becomes `__toESM(react(), 1)`.
     Harmless for React, which sets no `__esModule`, and precisely the kind of
     harmless that stops being harmless the day a dependency does. Measured on
     18 Sep 2026 and not shipped: a warning in the developer's terminal is not
     worth a change to the thing students load. */
  format: 'iife',
  platform: 'browser',
  loader: { '.jsx': 'jsx' },
  define: {
    'process.env.NODE_ENV': '"production"',
    // optional @vercel/analytics overrides we don't set — resolve to undefined
    'process.env.REACT_APP_VERCEL_OBSERVABILITY_BASEPATH': 'undefined',
    'process.env.REACT_APP_VERCEL_OBSERVABILITY_CLIENT_CONFIG': 'undefined',
  },
  outfile: 'docs/app.js',
};

/* Only when run directly — importing this must not write the bundle.

   pathToFileURL, NOT `file://${process.argv[1]}`. The template-string version
   is right on Linux and silently wrong on Windows: argv[1] there is
   C:\Users\...\build.mjs, which becomes file://C:\Users\... — two slashes and
   backslashes — while import.meta.url is file:///C:/Users/.... They never
   match, so `npm run build` exited 0, printed nothing and did not touch
   docs/app.js. Vercel builds on Linux, so the deployed site was fine, which is
   exactly why it went unnoticed: the damage was all local. Every Windows edit
   since 17 Sep was "built" into a bundle that did not change, and every local
   browser check afterwards was testing the old code. The offline suite's
   "docs/app.js is current" check is what finally said so. */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href){
  await esbuild.build(BUILD);
  console.log('Built docs/app.js');
}
