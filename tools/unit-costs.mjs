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

console.log('\n=== Your proposed prices, all NZD ===\n');
const TIERS = [
  { name: 'Pro beta lock-in', price: 4.99,  perMonth: 4.99 },
  { name: 'Pro standard',     price: 8.99,  perMonth: 8.99 },
  { name: 'Max beta lock-in', price: 9.99,  perMonth: 9.99 },
  { name: 'Max standard',     price: 14.99, perMonth: 14.99 },
  { name: 'Max ANNUAL',       price: 49.99, perMonth: 49.99 / 12, annual: true },
];
console.table(TIERS.map(t => {
  // An annual plan pays one fixed fee a year, not twelve — that alone is worth
  // more than any model saving at these prices.
  const netYear = t.annual ? stripeNetNZD(t.price) : stripeNetNZD(t.price) * 12;
  const costYearOss = nzd(monthlyCost(PROFILES.typical, PRICES.ossGroq).total) * 12;
  const costYearHaiku = nzd(monthlyCost(PROFILES.typical, PRICES.haiku).total) * 12;
  return {
    tier: t.name,
    'billed': t.annual ? m(t.price) + '/yr' : m(t.price) + '/mo',
    'per month': m(t.perMonth),
    'net/yr after Stripe': m(netYear),
    'margin/yr on gpt-oss': m(netYear - costYearOss),
    'margin/yr on Haiku': m(netYear - costYearHaiku),
  };
}));

/* Can the NVIDIA free tier carry the free plan? Volume isn't the problem —
   concurrency is. NCEA students are all in one timezone and all revise after
   dinner, so usage isn't spread across the day; it stacks into a couple of
   hours. ~40 requests/minute is shared across every user at once. */
const NVIDIA_RPM = 40;
const CALLS_PER_SESSION = 6;        // a generate (2 chunks) plus a few marks/hints
const SESSIONS_PER_USER_MONTH = 12; // roughly 3 study nights a week
const PEAK_WINDOW_MIN = 120;        // the after-dinner block the sessions pile into
const PEAK_SHARE = 0.25;            // share of monthly sessions landing in that window
const BURST = 3;                    // peak minute vs average minute inside the window

console.log('\n=== Does NVIDIA\'s free tier survive the free plan? ===');
console.log('(~' + NVIDIA_RPM + ' req/min shared across ALL users at once)\n');
console.table([200, 500, 1000, 2000, 5000].map(users => {
  const sessionsInWindow = users * SESSIONS_PER_USER_MONTH * PEAK_SHARE / 30;
  const avgRpm = sessionsInWindow * CALLS_PER_SESSION / PEAK_WINDOW_MIN;
  const peakRpm = avgRpm * BURST;
  return {
    'free users': users,
    'avg req/min at peak hour': avgRpm.toFixed(1),
    'burst req/min': peakRpm.toFixed(1),
    'vs 40/min cap': peakRpm > NVIDIA_RPM ? 'RATE LIMITED' : 'ok',
  };
}));

/* Steady state is not the thing that breaks it — a launch spike is. When a
   video lands, arrivals are compressed into minutes, and every one of them
   generates a deck in their first session. */
console.log('\n=== A spike: N new students arriving within ONE hour ===\n');
console.table([100, 250, 500, 1000].map(arrivals => {
  const rpm = arrivals * CALLS_PER_SESSION / 60;
  return {
    'arrive in 1h': arrivals,
    'req/min': rpm.toFixed(1),
    'vs 40/min cap': rpm > NVIDIA_RPM ? 'RATE LIMITED — first impression is a failure' : 'ok',
  };
}));

/* Monthly is the low-commitment door in; annual is worth more to you only if
   the average subscriber would have churned before this many months. */
console.log('\n=== Monthly vs annual: where the break-even sits ===\n');
const MONTHLY = 6.99, ANNUAL = 49.99;
const netMonth = stripeNetNZD(MONTHLY);
const netAnnual = stripeNetNZD(ANNUAL);
console.log('  Monthly ' + m(MONTHLY) + ' -> ' + m(netMonth) + ' net per month after Stripe');
console.log('  Annual  ' + m(ANNUAL) + ' -> ' + m(netAnnual) + ' net, one fee instead of twelve');
console.log('  Annual is worth more unless a monthly subscriber stays past '
  + (netAnnual / netMonth).toFixed(1) + ' months.');
console.log('  A student who subscribes for the exam run-up (3 months) is worth '
  + m(netMonth * 3) + ' on monthly vs ' + m(netAnnual) + ' on annual.\n');

console.log('\n=== The ladder problem ===\n');
const proYear = 8.99 * 12, maxYear = 14.99 * 12;
console.log('  Pro at $8.99/mo over a year:   ' + m(proYear));
console.log('  Max at $14.99/mo over a year:  ' + m(maxYear));
console.log('  Max annual as proposed:        ' + m(49.99)
  + '   (' + Math.round((1 - 49.99 / maxYear) * 100) + '% off Max monthly)');
console.log('  -> Max annual undercuts a year of PRO by ' + m(proYear - 49.99)
  + ', so nobody who does the arithmetic buys anything else.\n');
