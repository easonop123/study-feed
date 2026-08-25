# Study Feed — content brief

**For:** the content-creation AI running the Study Feed social accounts.
**Version of the app this describes:** 1.4.0 (19 Aug 2026). Live at **https://studyfeed.app**.
**Accounts:** TikTok [@studyfeednz](https://www.tiktok.com/@studyfeednz) · Instagram [@studyfeednz](https://www.instagram.com/studyfeednz/)

---

## 0. How to use this document

This is a **factual inventory**, not a script. Everything in §2–§6 is verified against the
shipped code. Everything in §7 is a hard constraint.

Three rules before you write anything:

1. **Only claim what is in §2–§6.** If a feature is not described here, the app does not
   have it. §8 lists things it specifically does *not* do, because they are the things
   people assume a study app has.
2. **§7 is not style guidance, it is a compliance boundary.** The audience is
   15–18-year-olds making decisions about their exams, in a country with a specific
   qualifications authority that this product is not part of. Getting §7 wrong is the one
   failure mode that matters.
3. **The numbers in §9 are internal engineering measurements.** They are here so you
   understand *why* the product is the way it is. They are **not** publishable statistics.
   Do not put them in a caption.

---

## 1. What it is, in one line

**A free web app that finds the specific gap in what a student knows, then closes it —
including marking the long written answers that flashcards have never helped with.**

Positioning line currently on the site:

> **Stop revising what you already know. Find the bit you don't.**

The previous line, still true and still the underlying argument, now used as a supporting
point rather than the headline:

> *Flashcards get you Achieved. Excellence is a writing problem.*

**Audience:** New Zealand secondary students sitting NCEA Levels 1, 2 and 3 — roughly
Years 11–13, ages 15–18. It is curriculum-agnostic underneath (a student can type their
own level and it adapts), but NCEA is who it is built for and who it speaks to.

**Price:** Free. No account, no sign-up, no card, nothing to install. Opens in a browser.

---

## 2. The core concept — the ladder

**This is the single most important thing to understand, and the most useful content angle
the product has.** Everything in the app speaks this vocabulary, so your content should too.

NCEA grades a written answer on three levels. Study Feed treats them as three *different
kinds of not knowing something*, each needing a different fix:

| Rung | NCEA grade | What it means | What it feels like when you're missing it |
|---|---|---|---|
| **Name it** | Achieved | State/define the term, process or factor | You read the question and nothing arrives |
| **Link it** | Merit | Explain *how* and *why*, cause and effect joined up | You know heating speeds a reaction up, but can't say more collisions clear the activation energy |
| **Apply it** | Excellence | Use it on a situation you haven't seen, link ideas, justify | You can recite the mechanism, then freeze on an unfamiliar scenario |

**The argument that makes this interesting content:** flashcards only ever fix the first
rung. An hour of re-reading notes changes nothing if the naming was already fine — and for
most students stuck on Achieved, it was. That is why revision feels like guessing.

This ladder is the one part of NCEA that has survived every rebuild of the standards, which
is why the product is built on it (see §7 for why that matters).

---

## 3. Feature inventory

### 3.1 Find my gaps — the diagnostic *(newest, most distinctive)*

The flagship. A student types a **topic** — "rates of reaction", "genetic variation", "the
causes of WWI" — and gets a short written test whose **output is a list of what's missing,
not a score**.

- Choose **Quick (6 questions, ~5 min)** or **Full (12 questions, ~12 min)**.
- Short typed answers. A phrase for the naming questions, a sentence or two for the rest.
  It has to be *written* — multiple choice cannot reveal a missing link.
- Questions climb the ladder in order: name it → link it → apply it.
- **"Not sure" is a real answer.** It's more useful to the diagnosis than a guess and isn't
  held against you.
- All answers are read **together**, not one at a time — the pattern across the misses is
  the finding.

The report gives:
- A **headline** naming the rung where understanding stops
- The **pattern** across the misses
- Every gap as a specific sentence, with the question, what they wrote, and what they *did*
  get right
- An ordered list of what to work on
- **One button turns every gap into flashcards**

**A real example of the output** (from testing):

> **You can name the factors, but you stop as soon as you have to say why any of them work.**
> Every miss is the same shape: the fact is there, the collision-theory mechanism that connects it is not.
>
> — *you did not mention that the catalyst provides a lower-energy pathway by lowering the activation energy*

Contrast that with "6/10". **That contrast is your best hook.**

The last diagnosis is saved so a student can come back to the list while studying.

### 3.2 Marking written answers *(the deepest feature)*

The thing flashcard apps don't do. A student writes a real exam-style long answer and gets
it marked.

- Graded **Not yet / Achieved / Merit / Excellence** against the criteria on that card
- **Inline annotations on their own words** — phrases highlighted in their answer with a
  note on why that phrase earned credit or what's wrong with it
- Lists what they hit, what's missing for the next grade, and the single change that would
  most raise it
- **"How do I get to Merit?"** returns the exact edits to *their* answer: the move to make,
  where it applies (quoting their words), and that sentence rewritten properly
- At the top grade the button becomes **"How do I make this airtight?"**

**Key selling point:** it rewrites *the student's own sentence*, not a model answer copied
off someone smarter.

### 3.3 Making cards

- **Paste notes**, or **just type a topic** and it writes the cards
- **Upload**: PDF, Word (.docx), PowerPoint (.pptx), images/photos, plain text
- Photos of the whiteboard and diagrams in slides are **read by a vision model** — text
  transcribed, diagrams described
- Up to 12 images per generation; files are unzipped and processed **in the browser**
- **"Only my material"** mode sticks strictly to what was pasted/uploaded and adds nothing
- A **long/quick slider** sets the balance of short-recall vs long-answer cards
- **Nothing saves until the student reviews the drafts** — they can keep, edit or bin each card
- Cards can also be typed by hand (`question | answer`, one per line)

**Card types:** Flip · Fill the blank (cloze) · Short answer · Multiple choice · Type the
answer · Long answer (extended response)

### 3.4 The feed — spaced repetition

- Swipe-scroll through what's due, rate each card **Again / Hard / Good / Easy**
- SM-2 scheduling — a topic comes back the day before you'd forget it
- **The feed ends on purpose** when the due cards are done. Carrying on is a deliberate
  choice ("Keep practising anyway") and never touches the schedule
- Cards you were *sure* about and got wrong get flagged and come back harder
- A deck bar at the top drills one subject at a time
- Set an **exam date** and the dashboard counts down to it

### 3.5 Learn mode

Takes a deck and drills it until you can **produce** every answer, not just recognise one.

- A card needs **two correct answers** to be done, and the second is harder than the first:
  pick it out of a list, then write it from memory
- Where nobody could reproduce the wording, it asks you to say it and mark yourself
- **Rounds of seven** with a checkpoint; a miss drops the card back to recognition and it
  returns before the round is out
- **Keeps your place** — close it mid-round and it offers to pick up where you left off
- Ends by **naming the cards that fought back**, and offers to drill just those
- On a keyboard: 1–4 answers, Enter carries on, right answers advance themselves

### 3.6 Quiz

A quick graded test from a deck's own cards before a test. No AI cost. 1–4 and Enter.

**Worth knowing (and a good "we sweat the details" angle):** the wrong options are matched
to the right answer — same rough length, same kind of thing, a number against numbers, a
name against names. Most quiz apps pull wrong answers at random, which means you can spot
the answer by its *shape* without reading the question. Study Feed can't be beaten that way.

### 3.7 Help while studying

- **Stuck mid-answer?** Two tiers of nudge: writing points first, then sentence starters
  with blanks. **Never the answer itself.**
- **"Explain this further"** on any revealed card — the reasoning behind the answer, plus
  **"Simpler"** and **"Go deeper"** if it landed at the wrong level
- **Ask anything** — a study helper in the corner of every screen that can see the card
  you're on, so "why is that the answer?" works without retyping

### 3.8 Ready-made decks

For arriving with no notes on you. Three, each with two full exam-style long answers so the
marking can be tried immediately:

- **Genetics and variation** (Science) — alleles, Punnett squares, why two black sheep can have a white lamb
- **Acids, bases and reaction rates** (Science) — neutralisation, the pH scale, gas tests, what makes a reaction go faster
- **Writing about a text** (English) — language features, evidence and effect, with two extracts included

They behave like your own decks: study them, edit the cards, or delete the lot.

### 3.9 Progress, stats and sharing

- Home dashboard: what's due, day streak, reviewed today, cards total, this-week bars,
  subject mastery, exam countdown
- **Shareable story cards** (1080×1920 PNG) for finishing your due cards, your week, or
  earning an Excellence. The grade card carries **an excerpt of the student's own answer**
  and one line of the marking — evidence rather than a claim. The question stays off it.
- **Backup & transfer**: export the whole library, a subset, or one deck, with or without
  review progress. Importing only ever adds — a friend's deck can't overwrite yours.

### 3.10 Look and feel

- Light and dark themes (follows the device by default)
- Three typefaces to choose from (a reading preference, not just identity)
- Synthesised sound — the chime **rises in pitch with your streak** of right answers — plus
  haptics on Android. Mutable.
- **No emoji anywhere in the UI.** Every icon is a hand-drawn stroked SVG. Worth knowing if
  you're making mockups: emoji in a screenshot would look wrong.
- Bottom nav on a phone, sidebar on a laptop
- A seven-panel first-run walkthrough that teaches the A/M/E ladder off a canned marked
  answer — no AI call, so it can't fail on a bad connection

---

## 4. The two-minute story of using it

Useful as a content spine — this is the loop the site itself now tells:

1. **Find the gap.** Type a topic, five minutes of writing, learn that you can name things
   but can't link them.
2. **Close it.** One tap turns the gaps into cards, then Learn drills them until you can
   produce every answer from memory.
3. **Prove it.** Write a real six-mark answer, get it marked A/M/E, see the Merit version of
   your own sentence.

---

## 5. What makes it different — angles that are actually true

| Against | The honest difference |
|---|---|
| **Quizlet / Anki** | They test recognition and recall. Neither marks a written answer, and neither tells you *which kind* of not-knowing you have. |
| **Asking ChatGPT** | A general chatbot will grade you generously, won't hold a schedule, won't build a deck from your slides, and will confidently cite NCEA standards that were retired in 2023. Study Feed is barred from doing that (§7). |
| **Re-reading notes** | Only ever helps the bottom rung. The strongest single line the product has. |
| **A tutor** | Free, at 11pm, on the bus. |

---

## 6. Voice and tone

The product's own writing is: **plain, direct, a bit blunt, never cutesy, never hypey.**
It talks to students like they're capable people with limited time.

- Real product copy: *"You already know most of it. Five minutes to find the part you don't."*
- Real product copy: *"Those are not worth your revision time tonight."*
- Real product copy: *"Not sure"* as a first-class answer.

**Do:** specific, concrete, a bit dry, occasionally funny. Name the actual pain
("I always get Achieved and I don't know why" is a real line on the site because it's what
students actually say).

**Don't:** exam-stress fear-mongering, "hack"/"cheat code" framing, fake urgency, guaranteed
outcomes, or anything that implies the app does the thinking for them. **The product's whole
position is that it makes you write more, not less.** Content implying it's a shortcut
around effort contradicts the thing being sold.

**Spelling:** New Zealand English throughout — *organised, colour, practise* (verb) /
*practice* (noun), *analyse*. Use NCEA vocabulary: Achieved / Merit / Excellence, internals
and externals, command verbs, standards.

---

## 7. Hard constraints — do not get these wrong

### 7.1 NCEA and NZQA

- **Study Feed is not affiliated with NZQA in any way.** Never imply endorsement,
  partnership, or official status.
- **Marking is practice, not an official grade.** Always framed as practice against the
  published Achieved / Merit / Excellence wording.
- **Never state or imply a guaranteed grade outcome.** No "get Excellence guaranteed", no
  "this will get you Merit". The app itself never promises this.
- **Never cite a specific achievement standard number** (AS90xxx / AS91xxx / AS92xxx), a
  standard title, a credit count, or an internal/external label — **and never claim the app
  does either.** The Level 1 standards were rebuilt for 2024 and the old ones expired at the
  end of 2023, so anything an AI "remembers" about them is likely out of date. The app is
  *deliberately barred* from naming standards; it uses the criteria on the student's own
  card and the A/M/E ladder instead. A student can type their real standard in and it will
  use theirs — **it just never invents one.** That restraint is a feature and a genuinely
  good content angle; do not undermine it by doing the thing the product refuses to do.
- Do not state Level 2/3 rollout timelines as fact — they have been publicly revised.

### 7.2 Privacy and data — state it accurately

- Decks are saved **on the student's own device only**. No account, no server, no sync.
- **Clearing your browser wipes them.** The app tells students to export a backup. If you
  make content about saving work, this is the honest version.
- To write cards and mark answers, the notes/answers **are sent to an AI provider (NVIDIA)
  for processing**. Study Feed does not store them.
- Anonymous usage counts only (how many decks made, how many answers marked) — never the
  words in them.

### 7.3 Audience

The audience includes **minors (15–18)**. Follow each platform's rules for content aimed at
teens. No pressure tactics, no anxiety-baiting, no implication that their future hinges on
a single decision.

---

## 8. What the app does NOT have — do not promise these

Checked against the shipped code:

- ❌ **No notifications or reminders of any kind.** No push, no daily nudge, no streak alert.
  Do not say "it reminds you". The *feed* holds the schedule; the app never pings you.
- ❌ **No offline mode.** It's installable to the home screen and looks like an app, but
  there's no service worker — **it needs a connection**, and the AI features definitely do.
- ❌ **No accounts, no login, no cloud sync, no cross-device.** Deliberate, but it means
  "your decks follow you everywhere" is false.
- ❌ **No classroom, teacher, group or leaderboard features.** No sharing decks by link.
- ❌ **No native iOS/Android app.** It is a website. Do not call it "download the app" —
  say **"open it in your browser"** or "add it to your home screen".
- ❌ **No live tutoring, no human marking.**
- ❌ **No official NCEA past papers.** It writes exam-*style* questions from the student's
  own material.
- ❌ **No pricing tiers, no premium, no trial.** It is simply free.

---

## 9. Internal quality numbers — context only, NOT for captions

Here so you understand the product's standards. **These are internal engineering
measurements against test corpora, not published or independently verified statistics. Do
not quote them as stats in content.**

- Multiple-choice options were re-engineered so a guesser who only looks at option *lengths*
  gets no advantage: free marks from spotting the odd one out went from 7.2% to 0% across
  test decks.
- The diagnostic was tested against answers written to carry a known flaw; it named the
  designed flaw specifically in every case, and a vague "revise this topic" sentence counts
  as a failure in that test.
- Marking has been measured against a fixed corpus of answers written to sit in known grade
  bands, checking for grade accuracy, praise bias, and feedback that can't be anchored to
  the student's words.

The takeaway you *can* use qualitatively: **the team tests the thing that's easy to fake.**

---

## 10. Brand facts for anything visual

Full rules live in `CLAUDE.md`. The essentials:

- **Colours:** near-black `#141024` ground, one violet accent `#7C5CFF`. Violet tint
  `#9B85FF` for small text on dark. **Do not introduce a second accent colour** — no lime,
  cyan or coral. One accent on near-black is the whole identity.
- **Typeface:** Inter. Headlines ExtraBold (800), body Regular (400).
- **The mark:** an isometric stack of three layers — violet outline on top, two white
  chevrons below (near-black on light grounds). **Never fill the top layer, never rotate it,
  never add shadows, glows, gradients or outlines to it.** Below 28px use the mark alone,
  never the wordmark.
- **Never invent a logo, icon or brand asset.** If something is missing, ask — assets live in
  `brand/`.
- **Standard chip row:** "Free · No sign-up · NCEA 1–3"
- **No emoji in product UI.** In social captions emoji are a platform decision, not a brand
  one — but never composite them into a screenshot or mockup of the app.

---

## 11. Content angles worth building on

Ranked by how distinctive they are:

1. **"There are three ways to not know something."** The ladder, explained with one worked
   example. The single most useful and most shareable idea the product owns.
2. **"6/10 tells you nothing."** Show a score, then show a real gap sentence next to it.
3. **"Flashcards only fix the first one."** Why an hour of Quizlet can change nothing.
4. **The marked answer.** Show a student's real-ish paragraph with the highlighting, then the
   same sentence rewritten to Merit. This is the most visually striking thing the app does.
5. **"Explain why heating speeds up a reaction"** — a genuine before/after: *"because it's
   hotter so it goes faster"* → what the Merit version actually names.
6. **The photo-of-the-whiteboard trick.** Snap the board, get cards. Very demonstrable in 8 seconds.
7. **"Not sure" is a real button.** A small, human detail that says a lot about the product.
8. **The feed that ends on purpose.** Anti-engagement-loop, unusual for a study app, and true.
9. **Wrong answers that are actually plausible.** The "you can't beat it by shape" detail.
10. **Free, no sign-up, works on the bus.** The removal-of-friction angle — always pair with
    "open it in your browser", never "download".

---

## 12. Quick reference

| | |
|---|---|
| **URL** | https://studyfeed.app |
| **App directly** | https://studyfeed.app/app/ |
| **Straight into the diagnostic** | https://studyfeed.app/app/#gaps |
| **Handles** | @studyfeednz on TikTok and Instagram |
| **Price** | Free, no account |
| **Platform** | Web app, any modern browser, phone or laptop |
| **Made in** | Auckland, New Zealand |
| **Current version** | 1.4.0 |

---

*Keep this file current when features ship. If a claim isn't in here, it isn't shippable
content.*
