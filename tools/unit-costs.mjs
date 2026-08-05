/* What one active student costs us in inference per month.

   Everything here is traceable to a real call site in StudyFeed.jsx — the
   max_tokens caps are exact (grepped from the source), the input sizes are
   measured prompt templates plus typical card/answer content, and the output
   estimates assume replies land below their cap, which they usually do.

   Run: node tools/unit-costs.mjs
   The numbers worth arguing about are in PROFILES, not in CALLS. Inference
   prices move ~2x between providers; how often a student marks an answer moves
   the total by 10x. Tune the profiles first. */

const CHARS_PER_TOKEN = 4;
const tok = (chars) => Math.round(chars / CHARS_PER_TOKEN);

/* One row per API call the app can make. `cap` is the literal max_tokens in
   the source, kept here so drift is obvious if someone changes it. */
const CALLS = {
  generate: {
    label: 'Generation chunk',
    cap: 2400,                    // GEN_MAX_TOKENS
    inTokens: tok(6000 + 1800),   // 6k batch (batchText) + measured prompt overhead
    outTokens: 1600,              // a full mixed batch; extended cards push toward the cap
    vision: false,
  },
  vision: {
    label: 'Slide/photo transcribe',
    cap: 1500,                    // describeImage
    inTokens: 1100 + tok(600),    // image tokens + VISION_PROMPT
    outTokens: 700,
    vision: true,
  },
  mark: {
    label: 'Mark a long answer',
    cap: 1000,                    // markAnswer
    inTokens: tok(2200),          // template + card criteria + student answer
    outTokens: 350,
    vision: false,
  },
  hint: {
    label: 'Writing points',
    cap: 600,                     // getHints
    inTokens: tok(950),
    outTokens: 180,
    vision: false,
  },
  bigHint: {
    label: 'Sentence starters',
    cap: 700,                     // getBigHint
    inTokens: tok(1150),
    outTokens: 220,
    vision: false,
  },
  explain: {
    label: 'Explain this further',
    cap: 900,                     // explainFurther
    inTokens: tok(1000),
    outTokens: 400,
    vision: false,
  },
  upgrade: {
    label: 'How do I get to <grade>',
    cap: 1100,                    // upgradePath — card + answer + mark result
    inTokens: tok(2800),
    outTokens: 600,
    vision: false,
  },
  chat: {
    label: 'Ask-anything turn',
    cap: 800,                     // postChat from AskPanel
    inTokens: tok(1500),          // thread grows; this is a mid-thread average
    outTokens: 350,
    vision: false,
  },
};

/* Calls per active student per month. The retry multiplier is the cost of
   today's timeout work: a failed attempt is billed by most providers only if
   the model actually produced tokens, but a split chunk genuinely doubles the
   input. 1.15 assumes ~15% of generation work gets repeated on bad networks. */
const RETRY_WASTE = { generate: 1.15, vision: 1.05 };

const PROFILES = {
  light: {
    label: 'Light — makes a few decks, rarely writes long answers',
    generate: 6, vision: 0, mark: 4, hint: 2, bigHint: 1, explain: 5, upgrade: 1, chat: 8,
  },
  typical: {
    label: 'Typical — revises most weeknights in exam season',
    generate: 14, vision: 20, mark: 25, hint: 8, bigHint: 3, explain: 20, upgrade: 8, chat: 30,
  },
  heavy: {
    label: 'Heavy — the student the app is actually built for',
    generate: 30, vision: 60, mark: 70, hint: 25, bigHint: 10, explain: 50, upgrade: 25, chat: 80,
  },
};

/* USD per million tokens. gpt-oss-20b is what the app already runs, so moving
   off NVIDIA's free tier is a base-URL and key change, not a rewrite. The
   Claude rows are a different question — better marking and much better slide
   reading, at 15-50x the token price. Claude bills images at the text input
   rate, so one rate covers both columns. */
const PRICES = {
  ossCheap: { label: 'gpt-oss-20b, cheapest host',  textIn: 0.04,  textOut: 0.15, visIn: 0.16, visOut: 0.20 },
  ossGroq:  { label: 'gpt-oss-20b on Groq',         textIn: 0.075, textOut: 0.30, visIn: 0.24, visOut: 0.24 },
  haiku:    { label: 'Claude Haiku 4.5',            textIn: 1.00,  textOut: 5.00, visIn: 1.00, visOut: 5.00 },
  sonnet:   { label: 'Claude Sonnet 5',             textIn: 3.00,  textOut: 15.00, visIn: 3.00, visOut: 15.00 },
};

/* Everything above is USD; everything the user charges is NZD. */
const NZD_PER_USD = 1 / 0.587;   // NZD/USD ~0.587, 2026-08-04
const nzd = (usd) => usd * NZD_PER_USD;

function monthlyCost(profile, price) {
  let total = 0;
  const rows = [];
  for (const [key, n] of Object.entries(profile)) {
    if (key === 'label' || !CALLS[key]) continue;
    const c = CALLS[key];
    const waste = RETRY_WASTE[key] || 1;
    const inP = c.vision ? price.visIn : price.textIn;
    const outP = c.vision ? price.visOut : price.textOut;
    const cost = n * waste * ((c.inTokens * inP) + (c.outTokens * outP)) / 1e6;
    total += cost;
    rows.push({ call: c.label, n, cost });
  }
  rows.sort((a, b) => b.cost - a.cost);
  return { total, rows };
}

/* Stripe NZ, online domestic cards: 2.65% + NZ$0.30 (down from 2.70% on
   2025-12-01). Overseas cards cost more — a fair chunk of the fixed fee's
   sting is on the small prices, so annual billing matters more than the rate. */
const stripeNetNZD = (grossNZD) => grossNZD - (grossNZD * 0.0265 + 0.30);

const m = (n) => '$' + n.toFixed(2);

console.log('\n=== Inference cost per active student per month (NZD) ===\n');
console.table(Object.entries(PROFILES).map(([pk, profile]) => {
  const row = { profile: pk };
  for (const [k, price] of Object.entries(PRICES)) row[PRICES[k].label] = m(nzd(monthlyCost(profile, price).total));
  return row;
}));

console.log('\n=== Where the money goes (typical student, gpt-oss on Groq) ===\n');
const detail = monthlyCost(PROFILES.typical, PRICES.ossGroq);
console.table(detail.rows.map(r => ({
  call: r.call,
  'calls/mo': r.n,
  'cost NZD': m(nzd(r.cost)),
  share: Math.round(r.cost / detail.total * 100) + '%',
})));

/* The number that actually constrains the business: free users pay nothing but
   still burn inference. This is where model choice stops being a rounding
   error — the same 1,000 free students cost pennies on gpt-oss and real money
   on Claude. It's the argument for putting the cheap model under the free tier
   and the good one behind the paywall. */
console.log('\n=== Monthly bill for FREE users, who bring in no revenue (NZD) ===\n');
console.table([100, 1000, 10000].map(n => {
  const row = { 'free users': n };
  for (const k of Object.keys(PRICES)) {
    row[PRICES[k].label] = m(nzd(monthlyCost(PROFILES.typical, PRICES[k]).total * n));
  }
  return row;
}));

/* ---- the two tiers, as agreed 2026-08-05 --------------------------------
   Free and Pro, nothing in between. The old Pro/Max ladder is gone: Max annual
   at $49.99 undercut a YEAR of Pro monthly, so anyone who did the arithmetic
   bought the cheapest thing on the board and the middle tier earned nothing.

   Free runs on NVIDIA's free API and costs no cash at all — it costs capacity,
   which is a separate question further down. Pro runs Claude Haiku: the same
   calls against a better model, which is most visible on marking and on reading
   photos of slides. Sonnet is priced here only to show why it is not the pick. */
const PRO_MONTHLY = 7.99;
const PRO_ANNUAL  = 49.99;
const PRO_LOCKIN  = 29.99;   // first-release yearly buyers keep this rate for good

console.log('\n=== Pro pricing, all NZD — what reaches you per student per YEAR ===\n');
const yearCost = (profile, price) => nzd(monthlyCost(PROFILES[profile], price).total) * 12;
console.table([
  { tier: 'Pro monthly', billed: m(PRO_MONTHLY) + '/mo', net: stripeNetNZD(PRO_MONTHLY) * 12 },
  { tier: 'Pro annual',  billed: m(PRO_ANNUAL) + '/yr',  net: stripeNetNZD(PRO_ANNUAL) },
  { tier: 'Launch lock-in', billed: m(PRO_LOCKIN) + '/yr', net: stripeNetNZD(PRO_LOCKIN) },
].map(t => ({
  tier: t.tier,
  billed: t.billed,
  'net/yr after Stripe': m(t.net),
  'keeps, light': m(t.net - yearCost('light', PRICES.haiku)),
  'keeps, typical': m(t.net - yearCost('typical', PRICES.haiku)),
  'keeps, heavy': m(t.net - yearCost('heavy', PRICES.haiku)),
})));

/* The lock-in is permanent, so it has to survive the heaviest user who takes it
   — and a discount aimed at early adopters selects FOR heavy users. Haiku holds
   up; Sonnet does not, which is the whole argument for Haiku behind Pro. */
console.log('\n=== Would the ' + m(PRO_LOCKIN) + ' lock-in survive on Sonnet instead? ===\n');
console.table(['light', 'typical', 'heavy'].map(p => {
  const h = yearCost(p, PRICES.haiku), s = yearCost(p, PRICES.sonnet);
  const net = stripeNetNZD(PRO_LOCKIN);
  return {
    user: p,
    'inference/yr Haiku': m(h),
    'keeps on Haiku': m(net - h),
    'inference/yr Sonnet': m(s),
    'keeps on Sonnet': m(net - s),
    verdict: (net - s) < 0 ? 'LOSS on Sonnet' : (net - s) < 5 ? 'thin on Sonnet' : 'ok either way',
  };
}));

/* Monthly is the low-commitment door in; annual is worth more only if the
   average subscriber would have churned before this many months. Exam-season
   subscribers are the ones this decides. */
console.log('\n=== Monthly vs annual: where the break-even sits ===\n');
const netMonth = stripeNetNZD(PRO_MONTHLY);
const netAnnual = stripeNetNZD(PRO_ANNUAL);
const netLockin = stripeNetNZD(PRO_LOCKIN);
console.log('  Monthly ' + m(PRO_MONTHLY) + ' -> ' + m(netMonth) + ' net per month after Stripe');
console.log('  Annual  ' + m(PRO_ANNUAL) + ' -> ' + m(netAnnual) + ' net, one fixed fee instead of twelve');
console.log('  Annual is worth more unless a monthly subscriber stays past '
  + (netAnnual / netMonth).toFixed(1) + ' months.');
console.log('  A student who subscribes only for the exam run-up (3 months) is worth '
  + m(netMonth * 3) + ' on monthly vs ' + m(netAnnual) + ' on annual.');
console.log('  The lock-in nets ' + m(netLockin) + ' — worth ' + (netLockin / netMonth).toFixed(1)
  + ' months of monthly, so it pays off against anyone who would have churned sooner.\n');

/* What the lock-in costs in the years AFTER the first one, which is where a
   permanent discount actually bites. */
console.log('=== The lock-in over time (typical user, Haiku) ===\n');
const costTypical = yearCost('typical', PRICES.haiku);
console.table([1, 2, 3].map(y => ({
  'years subscribed': y,
  'if on lock-in': m((netLockin - costTypical) * y),
  'if on full annual': m((netAnnual - costTypical) * y),
  'given up': m(((netAnnual - costTypical) - (netLockin - costTypical)) * y),
})));

/* Capacity, not cost. The free tier is free in cash and capped in throughput:
   ~40 req/min shared across every user at once. Worth knowing the ceiling, but
   hitting it is the good problem — the fix is a paid host, priced below. */
const NVIDIA_RPM = 40;
const CALLS_PER_SESSION = 6;        // a generate (2 chunks) plus a few marks/hints
const SESSIONS_PER_USER_MONTH = 12; // roughly 3 study nights a week
const PEAK_WINDOW_MIN = 120;        // the after-dinner block the sessions pile into
const PEAK_SHARE = 0.25;            // share of monthly sessions landing in that window
const BURST = 3;                    // peak minute vs average minute inside the window

console.log('\n=== Free tier ceiling, and what lifting it costs ===');
console.log('(NVIDIA free tier is ~' + NVIDIA_RPM + ' req/min shared across ALL users at once)\n');
console.table([200, 1000, 2000, 5000, 10000].map(users => {
  const sessionsInWindow = users * SESSIONS_PER_USER_MONTH * PEAK_SHARE / 30;
  const peakRpm = sessionsInWindow * CALLS_PER_SESSION / PEAK_WINDOW_MIN * BURST;
  return {
    'free users': users,
    'burst req/min': peakRpm.toFixed(1),
    'free tier': peakRpm > NVIDIA_RPM ? 'over the cap' : 'ok',
    'cost/mo to serve them on Groq instead': m(nzd(monthlyCost(PROFILES.typical, PRICES.ossGroq).total) * users),
  };
}));
console.log('  Paying to remove the ceiling is cheap relative to one Pro subscriber:');
console.log('  ' + m(nzd(monthlyCost(PROFILES.typical, PRICES.ossGroq).total) * 1000)
  + '/mo carries 1,000 free users, which ' + Math.ceil((nzd(monthlyCost(PROFILES.typical, PRICES.ossGroq).total) * 1000 * 12) / netAnnual)
  + ' annual Pro subscribers cover for a year.\n');
