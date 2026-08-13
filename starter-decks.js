/* ============================================================================
   STARTER DECKS — ready-made content, no generation, no API call.

   Why this exists: the app asks a first-time visitor to bring their own notes
   before it will show them anything. Someone who arrives from a link, on the
   bus, with no notes on their phone, has nothing to do. These decks are the
   answer — real cards, studiable in ten seconds, and immune to the NVIDIA free
   tier's rate limit because nothing here calls a model.

   Card shapes are exactly the ones cardsFromJson() emits, so a starter deck is
   indistinguishable from a generated one once it lands in the library:
     flip  / cloze / short → { type, front, back }
     mcq                   → { type, front, options[], answer (0-based), why }
     extended              → { type, verb, prompt, marks,
                                achieved, merit, excellence, skeleton, pitfall }

   Ids are NOT stored here. instantiateStarter() stamps fresh ones, so the same
   deck can be added twice without colliding with itself in progress:all.

   The extended cards are the point. They are what the app is actually for, so
   the two in each deck are written to the real grade criteria rather than being
   filler: achieved = the WHAT, merit = the WHY/HOW with cause and effect,
   excellence = links two or more ideas, applies them to the given scenario, and
   evaluates or justifies.

   All prose in the English deck's extracts is original, written for this file,
   so there is no set text to license and no student is disadvantaged by not
   having studied it.
   ========================================================================== */

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

const GENETICS = {
  slug: 'genetics',
  subject: 'Science',
  topic: 'Genetics and variation',
  standard: 'NCEA Level 1',
  blurb: 'Alleles, Punnett squares and why two black sheep can have a white lamb.',
  cards: [
    {
      type: 'extended',
      verb: 'Explain',
      marks: 6,
      prompt: `A farmer keeps sheep. Black wool (B) is dominant to white wool (b). Two black sheep are bred together and produce a white lamb.

Explain how two black parents can produce a white lamb. In your answer give the genotypes of both parents and of the lamb, and explain what this shows about the way alleles are passed on.`,
      achieved: `States that both parents must be heterozygous (Bb) and that the white lamb is homozygous recessive (bb). Names B as the dominant allele and b as the recessive one, and says that the white phenotype only appears when no dominant allele is present.`,
      merit: `Explains the cause. Each parent carries one B and one b. During meiosis the pair separates, so each gamete receives one allele of the two at random, and a parent that looks black can therefore pass on b. When a b gamete from the ram meets a b gamete from the ewe at fertilisation, the lamb inherits bb. With no B allele present to mask it, the recessive allele is expressed and the lamb is white — which is why white wool can disappear for a generation and then reappear in the offspring of two black parents.`,
      excellence: `Links the Punnett square to what it actually predicts and applies it to this farmer. Bb x Bb gives a 1 in 4 (25%) chance of bb, but that is a probability for each lamb independently, not a guarantee of one white lamb in every four born — three black lambs do not make the fourth more likely to be white. Justifies the limits of what the farmer can tell by looking: a black lamb may be BB or Bb and the two are identical in appearance, so the only way to find out is to breed it with a white (bb) sheep and look at the offspring. Evaluates why the white allele survives in the flock at all — heterozygous carriers look black, so choosing breeding stock by appearance can never remove b from the population, and the allele persists hidden in carriers indefinitely.`,
      skeleton: `Name the genotypes → say what happens at meiosis and fertilisation → say why the recessive phenotype shows → then use the ratio to state what is and is not certain for the next lamb.`,
      pitfall: `Writing that the lamb "got the white gene from somewhere" without ever naming the genotypes, and treating the 3:1 ratio as a promise that exactly one lamb in four will be white. The ratio is a probability applying to each lamb separately.`,
    },
    {
      type: 'extended',
      verb: 'Discuss',
      marks: 8,
      prompt: `A population of beetles lives on the brown tree trunks of a small island. Most of the beetles are brown, but some are green. Beetle colour is inherited. A bird that hunts beetles by sight arrives on the island for the first time.

Discuss how the variation in beetle colour arose, and what is likely to happen to the population over the next several generations.`,
      achieved: `States that the beetles vary in colour and that this variation is inherited. States that green beetles are easier for the bird to see against brown bark, so more of them are eaten, and that the proportion of brown beetles in the population will increase.`,
      merit: `Explains where the variation comes from and how the change happens. Mutation is the original source of new alleles, and sexual reproduction shuffles existing alleles into new combinations each generation, so offspring are never identical to their parents. Being brown is an advantage in this particular environment because a camouflaged beetle is less likely to be spotted and eaten, so brown beetles survive longer, breed more often, and pass their alleles on to more offspring than green ones do. Over several generations the allele for brown becomes more common.`,
      excellence: `Links selection to the gene pool rather than to individuals, and applies it to this island. No individual beetle changes colour — the frequency of alleles in the population changes because the survivors are the ones that breed. That is natural selection, and here the bird is the selection pressure. It is worth noting that the green allele was not a disadvantage before the bird arrived: the same allele is harmful or harmless depending on the environment, not in itself. Justifies why green is unlikely to vanish completely — if green is recessive, brown heterozygous beetles carry it without showing it, so selection against green beetles never reaches the copies hidden in carriers. Evaluates the longer-term risk: a population that loses genetic variation has fewer options if the environment shifts again, and if the trees changed or the bird left, the green form could become the advantageous one.`,
      skeleton: `Say where variation comes from → name the selection pressure → explain who survives and therefore breeds → then shift from individuals to allele frequencies in the population, and say what that means if the environment changes again.`,
      pitfall: `Writing that the beetles "changed colour to survive" or "adapted because they needed to". Individuals do not change; the population changes because of who breeds. Also, stopping at "the brown ones survive" is Achieved — you only reach Merit once you say why that changes which alleles are in the next generation.`,
    },
    {
      type: 'mcq',
      front: 'A pea plant has the genotype Tt, where T (tall) is dominant and t (short) is recessive. What is its phenotype?',
      options: ['Tall', 'Short', 'Halfway between tall and short', 'It cannot be predicted without knowing the parents'],
      answer: 0,
      why: 'Tall. T is dominant, so a single copy is enough to be expressed. The tempting answer is that Tt must land somewhere in the middle, but alleles are not blended together — the dominant one is simply the one that shows.',
    },
    {
      type: 'mcq',
      front: 'What is an allele?',
      options: ['A different version of the same gene', 'A different gene', 'A whole chromosome', 'A protein made by a gene'],
      answer: 0,
      why: 'An allele is one version of a gene. B and b are two alleles of the same wool-colour gene and sit at the same position on the chromosome. Calling them "different genes" is the usual slip — they control the same characteristic, in different forms.',
    },
    {
      type: 'mcq',
      front: 'Two Bb sheep have already produced three black lambs. What is the chance that their fourth lamb is white (bb)?',
      options: ['1 in 4', '1 in 3', 'Certain, because the three black outcomes have been used up', 'Zero, because both parents are black'],
      answer: 0,
      why: 'Still 1 in 4. Each fertilisation is independent — which gametes met last time does not change which meet next time. The tempting answer treats the 3:1 ratio like a quota that has to even itself out over four lambs.',
    },
    {
      type: 'flip',
      front: 'What is a gene?',
      back: 'A section of DNA that carries the instructions for one characteristic, such as wool colour or seed shape.',
    },
    {
      type: 'flip',
      front: 'What is the difference between a dominant and a recessive allele?',
      back: 'A dominant allele is expressed whenever it is present, even as a single copy. A recessive allele is only expressed when both alleles are recessive, because there is then no dominant allele to mask it.',
    },
    {
      type: 'flip',
      front: 'What is a Punnett square used for?',
      back: 'Working out every allele combination the offspring of two parents could inherit, and the probability of each one.',
    },
    {
      type: 'cloze',
      front: 'An organism carrying two identical alleles for a characteristic, such as BB or bb, is ____ for that characteristic.',
      back: 'homozygous',
    },
    {
      type: 'cloze',
      front: 'Gametes are produced by ____, which halves the chromosome number so that a fertilised egg ends up with a full set.',
      back: 'meiosis',
    },
    {
      type: 'cloze',
      front: 'A change in the DNA sequence of a gene is called a ____, and it is the original source of every new allele.',
      back: 'mutation',
    },
    {
      type: 'short',
      front: 'What is the difference between genotype and phenotype?',
      back: 'The genotype is the alleles an organism carries, such as Bb. The phenotype is the characteristic you can actually observe, such as black wool. The same phenotype can come from more than one genotype — BB and Bb sheep both look black.',
    },
    {
      type: 'short',
      front: 'Why do gametes contain half the number of chromosomes that body cells do?',
      back: 'So that when two gametes join at fertilisation the offspring receives one full set, half from each parent. If gametes carried the full number, the chromosome number would double in every generation.',
    },
    {
      type: 'short',
      front: 'Give two reasons why offspring of the same two parents are not identical to each other.',
      back: 'Meiosis shuffles the alleles differently into each gamete, so no two gametes carry quite the same combination, and fertilisation is random — which sperm reaches which egg is chance. Mutation can also introduce a new allele that neither parent showed.',
    },
  ],
};

const ACIDS = {
  slug: 'acids-bases',
  subject: 'Science',
  topic: 'Acids, bases and reaction rates',
  standard: 'NCEA Level 1',
  blurb: 'Neutralisation, the pH scale, gas tests, and what actually makes a reaction go faster.',
  cards: [
    {
      type: 'extended',
      verb: 'Explain',
      marks: 6,
      prompt: `A student adds a single 2 g marble chip to hydrochloric acid and times how long the reaction takes to finish. She then repeats the experiment using 2 g of powdered marble with the same volume and concentration of acid, at the same temperature. The powdered marble reacts much faster.

Explain why, using ideas about particles.`,
      achieved: `States that powdering the marble increases its surface area, so more marble is in contact with the acid and the reaction is faster.`,
      merit: `Explains the mechanism. A reaction only happens where acid particles collide with the marble surface with enough energy to react. Grinding one chip into powder exposes far more of that surface, so at any given moment many more acid particles are in a position to collide with marble. More successful collisions per second is what a faster rate means. The mass of marble has not changed at all — only how much of it the acid can reach.`,
      excellence: `Links rate to the total amount of product and applies it to what the student would actually record. Both runs start with 2 g of marble and identical acid, so both produce the same volume of carbon dioxide in the end: the powdered run simply gets there sooner, so its graph is steeper but levels off at the same height. Justifies the experiment as a fair test — surface area was the only variable changed, with mass, concentration, volume and temperature all held constant, so the difference in rate can be attributed to surface area alone. Evaluates what happens across each run: both reactions slow down as they proceed, because the acid is being used up and its concentration falls, so collisions become less frequent, and each reaction stops when one reactant runs out entirely.`,
      skeleton: `Say what changed (surface area) → explain it as successful collisions per second → then say what stays the same (total product) and why the comparison is a fair test.`,
      pitfall: `Saying the powder is faster because "there is more of it" or "it dissolves better". The mass is identical — only the exposed surface changed. Vague phrases like "more collisions" score Achieved at best until you say collisions between what, and why there are more of them.`,
    },
    {
      type: 'extended',
      verb: 'Justify',
      marks: 6,
      prompt: `A gardener tests the soil in a vegetable bed and finds it has a pH of 4.5. The vegetables she wants to grow do best at about pH 6.5. The garden centre sells two products that would raise the pH: garden lime (calcium carbonate), and a concentrated sodium hydroxide solution.

Justify which product she should use, and explain what it does to the soil.`,
      achieved: `States that the soil is too acidic and that a base must be added to raise the pH, and identifies lime as the right choice.`,
      merit: `Explains the chemistry. Neutralisation is a reaction between an acid and a base in which the acidity is cancelled out and the pH moves towards 7. Calcium carbonate is a carbonate, so it reacts with the acid in the soil to produce a salt, water and carbon dioxide, removing acid from the soil and raising the pH.`,
      excellence: `Justifies the choice by weighing the two options against each other rather than describing only one. Sodium hydroxide is a strong, highly soluble base: it reacts fast and it is very easy to overshoot straight past the target into soil that is too alkaline to grow anything, and it is corrosive to handle and damaging to roots. Lime is only slightly soluble, so it neutralises slowly and the pH creeps up and settles instead of jumping, which is what makes it safe to spread around living plants. Applies this to the gardener's actual target: she wants pH 6.5, not 7, so control matters more than speed — a reaction that self-limits is an advantage, not a drawback. Evaluates the practical consequence: she should add lime, retest after a few weeks, and add more if needed, rather than attempting to correct the whole bed in one dose.`,
      skeleton: `Name the problem (acidic soil) → name the chemistry that fixes it (neutralisation, and the products) → then compare the two products on speed, control and safety, and tie the comparison back to the target pH.`,
      pitfall: `Describing what lime does and never mentioning the other option. "Justify" requires you to weigh the alternatives against each other. Watch the products too: acid + carbonate gives a salt, water AND carbon dioxide, whereas acid + hydroxide gives only a salt and water.`,
    },
    {
      type: 'mcq',
      front: 'Which statement best describes a strong acid?',
      options: [
        'An acid that fully ionises in water, releasing all of its H+ ions',
        'An acid with a large amount of acid dissolved in a small volume of water',
        'Any acid that is dangerous to handle',
        'Any acid with a pH below 3',
      ],
      answer: 0,
      why: '"Strong" describes how completely an acid ionises, not how much of it is in the bottle — that is "concentrated". A dilute solution of a strong acid and a concentrated solution of a weak acid are both perfectly possible, which is exactly why the two words are not interchangeable.',
    },
    {
      type: 'mcq',
      front: 'Zinc is added to hydrochloric acid. What are the products?',
      options: [
        'Zinc chloride and hydrogen',
        'Zinc chloride and water',
        'Zinc chloride, water and carbon dioxide',
        'Zinc oxide and hydrogen',
      ],
      answer: 0,
      why: 'Acid + metal gives a salt + hydrogen. The tempting wrong answer borrows "and water" from neutralisation — water only appears when the base is a hydroxide or an oxide, and carbon dioxide only when it is a carbonate.',
    },
    {
      type: 'mcq',
      front: "A solution's pH falls from 5 to 3. What has happened to it?",
      options: [
        'It has become 100 times more acidic',
        'It has become twice as acidic',
        'It has become 2 times less acidic',
        'It has become alkaline',
      ],
      answer: 0,
      why: 'The pH scale is logarithmic: each whole step is a ten-fold change in H+ concentration, so two steps is 10 x 10 = 100 times more acidic. Reading the scale as ordinary subtraction — "two units, so twice" — is the usual mistake.',
    },
    {
      type: 'flip',
      front: 'Which gas is given off when an acid reacts with a metal, and how do you test for it?',
      back: 'Hydrogen. Hold a lit splint at the mouth of the test tube — hydrogen burns with a squeaky pop.',
    },
    {
      type: 'flip',
      front: 'Which gas is given off when an acid reacts with a carbonate, and how do you test for it?',
      back: 'Carbon dioxide. Bubble the gas through limewater — the limewater turns milky (cloudy white).',
    },
    {
      type: 'flip',
      front: 'What colour is universal indicator in a strong acid, and in a strong alkali?',
      back: 'Red in a strong acid and purple in a strong alkali. Neutral is green.',
    },
    {
      type: 'cloze',
      front: 'In a neutralisation reaction, acid + base gives ____ + water.',
      back: 'a salt',
    },
    {
      type: 'cloze',
      front: 'A solution with a pH below 7 is ____; above 7 it is alkaline, and exactly 7 is neutral.',
      back: 'acidic',
    },
    {
      type: 'cloze',
      front: 'Reactions slow down as they proceed because the reactants are being ____, so collisions between them happen less often.',
      back: 'used up',
    },
    {
      type: 'short',
      front: 'What does neutralisation mean?',
      back: 'A reaction between an acid and a base that cancels out the acidity and moves the pH towards 7. H+ ions from the acid and OH- ions from the base join to form water, and the remaining ions form a salt.',
    },
    {
      type: 'short',
      front: 'Name three ways to speed up a reaction, and say why each one works.',
      back: 'Raise the temperature — particles move faster, so they collide more often and with more energy. Increase the concentration — more particles in the same volume, so more collisions each second. Increase the surface area by powdering a solid — more of it is exposed to be collided with. A catalyst also speeds a reaction up, by lowering the energy a collision needs in order to succeed.',
    },
    {
      type: 'short',
      front: 'What is the difference between a base and an alkali?',
      back: 'A base is any substance that neutralises an acid. An alkali is a base that dissolves in water. So every alkali is a base, but a base like copper oxide, which will not dissolve, is not an alkali.',
    },
  ],
};

const ENGLISH = {
  slug: 'writing-about-text',
  subject: 'English',
  topic: 'Writing about a text',
  standard: 'NCEA Level 1',
  blurb: 'Language features, evidence and effect — with two extracts to analyse, so you need nothing else to start.',
  cards: [
    {
      type: 'extended',
      verb: 'Explain',
      marks: 6,
      prompt: `Read this extract:

"The house had learned to live without her. Doors that once stuck now swung open at a touch, and the kitchen clock kept its own time, three minutes fast, with nobody left to correct it. Dust settled on the piano lid in a fine grey skin, undisturbed."

Explain how the writer uses personification to develop an idea about loss. Use evidence from the extract.`,
      achieved: `Identifies personification and quotes an example from the extract — "The house had learned to live without her", or the clock that "kept its own time". States that the writer gives human qualities to the house and its objects, and that the extract is about someone who is no longer there.`,
      merit: `Explains the effect, with cause. Giving the house the ability to "learn" makes the building, rather than any person, the thing that adapts, so the absence is shown through what is left behind instead of being stated outright. The clock running three minutes fast "with nobody left to correct it" turns a small domestic habit into the evidence that someone is missing, which makes the loss feel ordinary and permanent rather than dramatic.`,
      excellence: `Links at least two pieces of evidence to one controlling idea and evaluates the choice. The personified house and the undisturbed dust pull against each other: the house adapts and moves on, while the dust settles on the piano lid exactly where a person's hands used to be, so the writer sets the building's easy acceptance against the stillness of the things she actually touched. Applies this to the reader's experience — because the loss is never named, the reader has to assemble it from the objects, which mirrors the way absence is really noticed at home, in small details nobody corrects any more. Justifies the technique by weighing it against the alternative: had the writer simply written that she was gone and the family was sad, the reader would be told the feeling rather than finding it, and the quiet, unemotional tone that gives the extract its force would be lost.`,
      skeleton: `Name the feature and quote it → explain what that specific wording does to the reader → link a second example to the same idea → then judge why the writer chose this over stating the idea plainly.`,
      pitfall: `Feature-spotting: naming "personification", quoting a line, and stopping there. Identifying the feature is Achieved. The marks come from explaining what that particular wording makes the reader think or feel, and connecting it to an idea running through the whole extract.`,
    },
    {
      type: 'extended',
      verb: 'Analyse',
      marks: 6,
      prompt: `Read this extract from a speech given at a school assembly:

"We are told the library is 'underused'. Forty-one of you signed out a book last week. Forty-one. That is not underuse — that is a room doing its job quietly, for people who do not make noise about it. The question is not whether we can afford to keep it. It is who we are willing to lose when it goes."

Analyse how the speaker uses language to persuade the audience. Use evidence from the extract.`,
      achieved: `Identifies at least two techniques and supports each with evidence — the statistic "Forty-one of you signed out a book last week", the repetition of "Forty-one" as a sentence on its own, the direct address "you", or the reframing "The question is not... It is...". States that these are used to persuade the audience that the library should be kept.`,
      merit: `Explains how each choice works on this particular audience. The statistic answers the word "underused" with a number, so the speaker appears reasonable and evidence-led rather than emotional. Repeating "Forty-one" as its own short sentence forces the audience to sit with a figure they had just heard dismissed, so the same number is made to feel large. "Forty-one of you" makes the statistic personal — the evidence is the students sitting in the room, not strangers elsewhere.`,
      excellence: `Links the techniques to a single persuasive strategy and evaluates it. The speaker's whole move is to take the opposition's word, "underused", and redefine it: the quotation marks hold the term at a distance, the statistic supplies a competing fact, and the closing contrast replaces the question being asked — can we afford it — with a different one, who do we lose. Applies this to the audience: a school assembly cannot vote on a budget, so the speech is not really aimed at winning the financial argument. It is aimed at making the quiet students in the room feel counted, and at reframing a decision about money as a decision about people. Justifies its effectiveness and names its limit: the reframing is powerful precisely because it never disputes the cost, but a listener who wanted the budget answered would notice that the speaker has changed the subject rather than answered it.`,
      skeleton: `Name the techniques with evidence → explain what each one does to this specific audience → tie them together into one overall strategy → then judge how well it works, including what it quietly avoids.`,
      pitfall: `Listing techniques one after another — "The speaker uses a statistic. The speaker uses repetition." — without ever saying what they do to the listener. "Analyse" also expects you to reach the strategy behind the choices, not simply catalogue them.`,
    },
    {
      type: 'mcq',
      front: 'Which of these is a metaphor?',
      options: [
        'The classroom was a furnace.',
        'The classroom was as hot as a furnace.',
        'The classroom felt like a furnace.',
        'The furnace in the classroom had broken again.',
      ],
      answer: 0,
      why: 'A metaphor states that one thing is another. The two tempting options use "as" and "like", which makes them similes — the most common mix-up of the lot — and the final option is literal, with no comparison at all.',
    },
    {
      type: 'mcq',
      front: 'A student writes: \'The writer uses a simile, "her voice was like gravel", to describe the character.\' What does this answer most need in order to reach Merit?',
      options: [
        'An explanation of what the simile makes the reader think or feel about the character',
        'A longer quotation from the same paragraph',
        'The title of the text and the name of its author',
        'A second language feature, identified and quoted',
      ],
      answer: 0,
      why: 'Achieved is identifying the feature and supplying evidence, which this answer already does. Merit is explaining the effect — why "gravel" in particular, and what it tells the reader about her. Adding more features or longer quotations without explanation just produces a longer Achieved answer.',
    },
    {
      type: 'mcq',
      front: 'Which of these is a statement of theme?',
      options: [
        'The novel explores how loyalty can survive being betrayed.',
        "The main character's best friend lies to him, and he forgives her.",
        'The novel is set in a small town in the 1980s.',
        'The writer uses very short sentences in the final chapter.',
      ],
      answer: 0,
      why: 'A theme is the idea a text explores, written as an idea rather than as an event. The tempting wrong answer retells the plot — what happens, rather than what the text is about. The others give the setting and a technique.',
    },
    {
      type: 'flip',
      front: 'What is personification?',
      back: 'Giving human qualities, actions or feelings to something that is not human — an object, an animal or an idea. For example: "The wind bullied the fence."',
    },
    {
      type: 'flip',
      front: 'What does the command verb "Analyse" ask you to do?',
      back: "Break the writing down and show how the parts work — what the writer's choices do, why they were made, and what effect they have on the reader. It goes further than \"describe\", which only asks what is there.",
    },
    {
      type: 'cloze',
      front: "A comparison that uses the word 'like' or 'as' is called a ____.",
      back: 'simile',
    },
    {
      type: 'cloze',
      front: 'The big idea a text explores, such as loyalty or isolation, is its ____.',
      back: 'theme',
    },
    {
      type: 'cloze',
      front: "Words chosen to build a picture in the reader's mind, appealing to the senses, are called ____.",
      back: 'imagery',
    },
    {
      type: 'cloze',
      front: 'A question asked purely for effect, where no answer is expected, is called a ____ question.',
      back: 'rhetorical',
    },
    {
      type: 'short',
      front: 'What is the difference between quoting evidence and explaining it?',
      back: 'The quotation shows the words the writer actually used. The explanation says what those particular words do — what they make the reader picture, think or feel, and how that connects to an idea in the text. A quotation on its own proves you found something; the explanation is the part that earns the mark.',
    },
    {
      type: 'short',
      front: 'What is a language feature? Name three.',
      back: "A deliberate technique in a writer's use of words. Examples include metaphor, simile, personification, alliteration, repetition, rhetorical question, emotive language and direct address.",
    },
    {
      type: 'short',
      front: "Why should you explain the writer's purpose, and not just name the technique?",
      back: 'A technique only matters in relation to what the writer was trying to do. Saying that the writer repeats a phrase is a fact about the page; saying that the repetition forces the audience to sit with a statistic they had dismissed shows how it serves the purpose — and that link is what lifts an answer above Achieved.',
    },
  ],
};

export const STARTER_DECKS = [GENETICS, ACIDS, ENGLISH];

/* Fresh ids every time, so adding the same starter deck twice gives two
   independent decks rather than two decks sharing one set of progress rows. */
export function instantiateStarter(slug){
  const src = STARTER_DECKS.find(d => d.slug === slug);
  if (!src) return null;
  return {
    id: uid(),
    subject: src.subject,
    topic: src.topic,
    standard: src.standard,
    cards: src.cards.map(c => ({ ...c, id: uid() })),
  };
}

/* Counts for the picker, so it can say what is in a deck before you take it. */
export function starterCounts(deck){
  let long = 0;
  for (const c of deck.cards) if (c.type === 'extended') long++;
  return { total: deck.cards.length, long: long, quick: deck.cards.length - long };
}
