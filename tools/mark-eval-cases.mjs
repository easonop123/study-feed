/* ============================================================================
   THE CORPUS — student answers written to sit in known grade bands.

   Seven kinds per extended card, chosen because each one probes a different
   way a marker can be wrong:

     not-yet         on topic, but says almost nothing the criteria ask for
     achieved        states the WHAT, no mechanism
     merit           mechanism with cause and effect, no evaluation
     excellence      links ideas, applies them to the scenario, evaluates
     waffle          long, fluent, confident, restates the question, says
                     nothing. Tests whether length is being mistaken for
                     quality — the prompt says to reward construction over
                     word count, and this is the answer that checks it.
     terse-correct   two or three sentences carrying the real mechanism.
                     The mirror of waffle: is a short answer punished for
                     being short?
     confident-error fluent, well-organised, and wrong. This is the one the
                     marker has already been caught on once — praise is its
                     default and it will not volunteer criticism. It must not
                     grade this well, and it must produce a "weak" note.

   `expect` is the band the answer was written for. Where a real examiner
   could reasonably land either side of a line, both are listed; where the
   criteria are unambiguous, only one is. Off-band results are reported
   individually, so a disagreement is something to read, not a test failure.

   The prose is deliberately uneven — typos, run-on sentences and informal
   register in the weaker answers — because that is what gets typed into the
   box, and because the marker's quotes have to survive it.
   ========================================================================== */

export const CASES = [

  /* ==== Genetics #0 — Explain, sheep monohybrid cross, 6 marks ============ */
  {
    deck: 'genetics', cardIndex: 0, kind: 'not-yet', expect: ['Not yet'],
    answer: `Because one of them must of had the white gene hidden in them and it got passed down to the lamb. Its just random which one you get so sometimes you get a white one.`,
  },
  {
    deck: 'genetics', cardIndex: 0, kind: 'achieved', expect: ['Achieved'],
    answer: `Both of the parents are Bb, which means they are heterozygous. The lamb is bb so it is homozygous recessive. B is the dominant allele and b is the recessive one. The white wool only shows up when the sheep has two b alleles, because if there was a B there it would cover it up.`,
  },
  {
    deck: 'genetics', cardIndex: 0, kind: 'merit', expect: ['Merit'],
    answer: `Both parents must be heterozygous, so their genotype is Bb. They look black because B is dominant, and only one copy of it is needed for black wool to show.

When gametes are made during meiosis the two alleles separate, so each sperm or egg only carries one of them, either B or b. This means a sheep that looks black can still pass on b. If a b sperm fertilises a b egg then the lamb inherits bb. Because there is no B allele present, there is nothing to mask the recessive allele, so the white wool is expressed. That is how a recessive characteristic can disappear for a generation and then turn up in the offspring of two parents that both look black.`,
  },
  {
    deck: 'genetics', cardIndex: 0, kind: 'excellence', expect: ['Excellence'],
    answer: `Both parents must be heterozygous (Bb) and the lamb must be homozygous recessive (bb). The parents look black because B is dominant and a single copy is enough to be expressed. During meiosis the two alleles separate so each gamete carries only one, and at fertilisation a b gamete from each parent has produced a bb lamb. With no B allele present nothing masks the recessive one, so the white phenotype shows.

Drawing a Punnett square for Bb x Bb gives BB, Bb, Bb and bb, which is a 1 in 4 chance of a white lamb. It is worth being careful about what that ratio actually means though. It is a probability for each lamb on its own, not a promise that one lamb in every four will be white — if the next three lambs are all black, the fourth still has a 1 in 4 chance, because each fertilisation is independent of the ones before it.

This also limits what the farmer can tell just by looking. A black lamb could be BB or Bb and the two are identical in appearance, so if he wants to know he would have to breed it with a white (bb) sheep and look at what the offspring are. Any white lamb from that cross would prove the black parent was carrying b. It also explains why the white allele has not disappeared from his flock even though he only breeds the black sheep: the carriers look black, so selecting by appearance never removes b from the population and it keeps being passed on hidden.`,
  },
  {
    deck: 'genetics', cardIndex: 0, kind: 'waffle', expect: ['Not yet'],
    answer: `This question is asking about how two black sheep are able to have a white lamb, which is a really interesting question when you think about it. Genetics is the study of how characteristics get passed on from parents to their offspring and it is very important in farming, because farmers need to be able to predict what their animals are going to look like before they breed them.

In this case the farmer has two black sheep and they have produced a white lamb, which is surprising, because normally you would expect two black sheep to produce a lamb that is also black. The reason that this happens is because of genes and alleles, which are passed down from the parents to their offspring during reproduction. Genes are extremely important because they control all of the characteristics that an organism has, from its colour to lots of other things as well.

So overall the farmer should not really be that surprised that this has happened, because genetics can be quite unpredictable and there are lots of different outcomes that can happen when two animals are bred together.`,
  },
  {
    deck: 'genetics', cardIndex: 0, kind: 'terse-correct', expect: ['Achieved', 'Merit'],
    answer: `Both parents are Bb and the lamb is bb. Each parent passes on one allele at meiosis, so if they both pass on b the lamb has no dominant allele left to mask it and the white shows.`,
  },
  {
    deck: 'genetics', cardIndex: 0, kind: 'confident-error', expect: ['Not yet'],
    answer: `Both of the parents must be BB, because they are black and black is the dominant colour in sheep. The lamb came out white because when the two black alleles combined together they blended, which made a much lighter colour than either of the parents had. This is called incomplete dominance, and it is the reason that you sometimes get a white lamb from two black parents. The lamb's genotype would therefore be Bb, because it received one allele from each of its parents.`,
  },

  /* ==== Genetics #1 — Discuss, beetles and selection, 8 marks ============= */
  {
    deck: 'genetics', cardIndex: 1, kind: 'not-yet', expect: ['Not yet'],
    answer: `The green beetles will get eaten by the bird because it can see them easier on the brown trees. So after a while there will be more brown ones left.`,
  },
  {
    deck: 'genetics', cardIndex: 1, kind: 'achieved', expect: ['Achieved'],
    answer: `The beetles in the population vary in colour, some are brown and some are green, and this variation is inherited from their parents. The bird hunts by sight, so the green beetles are much easier to spot against the brown tree trunks than the brown ones are. That means more of the green beetles get eaten. Over the next few generations the proportion of brown beetles in the population will go up and the proportion of green ones will go down.`,
  },
  {
    deck: 'genetics', cardIndex: 1, kind: 'merit', expect: ['Merit'],
    answer: `The variation in the beetles came from two places. Mutations are random changes in the DNA and they are where new alleles come from in the first place. On top of that, sexual reproduction shuffles the alleles that are already there into new combinations every generation, so the offspring are never identical to their parents or to each other.

Once the bird arrives, being brown is an advantage in this environment. A brown beetle on a brown trunk is camouflaged, so it is less likely to be spotted and eaten, which means it survives for longer and gets more chances to breed. Every time it breeds it passes its alleles on to its offspring. The green beetles are eaten before they have as many offspring, so they pass their alleles on less often. Over several generations this means the allele for brown wing colour becomes more and more common in the population, and the green one becomes rarer.`,
  },
  {
    deck: 'genetics', cardIndex: 1, kind: 'excellence', expect: ['Excellence'],
    answer: `The variation was already there before the bird arrived. Mutation is the original source of any new allele, and sexual reproduction then shuffles the existing alleles into new combinations each generation, so no two beetles are identical.

When the bird arrives it becomes a selection pressure. A brown beetle on a brown trunk is camouflaged, so it survives longer and breeds more, and every time it breeds it passes on its alleles. The green beetles are eaten before they have bred as often. The important thing is that no individual beetle changes colour — a green beetle stays green its whole life. What changes is the frequency of the alleles in the population, because the survivors are the ones doing the breeding. That is what natural selection actually is.

It is worth noticing that the green allele was not a bad allele before the bird came. It was neutral. An allele is only an advantage or a disadvantage relative to the environment the population happens to be in, and the environment changed the moment the bird arrived.

I do not think green would disappear completely, though. If green is recessive then brown heterozygous beetles are carrying a copy of it without showing it, and the bird cannot select against an allele it cannot see, so those hidden copies keep being passed on. That is probably a good thing for the beetles in the long run. A population that loses its genetic variation has fewer options if the environment shifts again — if the bird left, or if the trees changed colour, the green form could become the advantageous one, and the population can only respond to that if the allele is still in there somewhere.`,
  },
  {
    deck: 'genetics', cardIndex: 1, kind: 'waffle', expect: ['Not yet'],
    answer: `Natural selection is one of the most important ideas in the whole of biology and it was first discovered by Charles Darwin, who travelled around the world on a ship and looked at lots of different animals in lots of different places. What he worked out is often described as survival of the fittest, which means that the animals that are the fittest are the ones that survive and the ones that are not as fit do not survive.

In this question we have a population of beetles living on an island and a bird has arrived there and started hunting them. This is going to have an effect on the beetle population over time, because the bird is a predator and the beetles are its prey, and predators and prey always affect each other in an ecosystem.

Over the next several generations the beetle population is going to change because of natural selection and survival of the fittest. The beetles that are the fittest will be the ones that survive and go on to reproduce, and this is how evolution happens over a long period of time.`,
  },
  {
    deck: 'genetics', cardIndex: 1, kind: 'terse-correct', expect: ['Achieved', 'Merit'],
    answer: `Mutation made the colours in the first place and sexual reproduction keeps mixing them up. The bird eats the green ones because it can see them on the brown bark, so the brown ones survive to breed and the brown allele gets more common each generation. The individuals do not change, the population does.`,
  },
  {
    deck: 'genetics', cardIndex: 1, kind: 'confident-error', expect: ['Not yet', 'Achieved'],
    answer: `When the bird arrives the beetles will realise that they are being hunted and that being green is dangerous for them on the brown tree trunks. Over time the green beetles will adapt to their new environment by slowly changing their colour to brown so that the bird cannot see them any more, because animals always adapt to whatever environment they are living in when they need to survive.

The beetles that manage to turn brown will then pass this new brown colour down to their offspring, so the next generation will be born brown already. This is how the population evolves to suit its environment, and after several generations all of the beetles on the island will be brown because they will all have adapted.`,
  },

  /* ==== Acids #0 — Explain, surface area and rate, 6 marks ================ */
  {
    deck: 'acids-bases', cardIndex: 0, kind: 'not-yet', expect: ['Not yet'],
    answer: `The powder is faster because its in smaller bits so the acid can get to it easier and it reacts quicker than the big chip does.`,
  },
  {
    deck: 'acids-bases', cardIndex: 0, kind: 'achieved', expect: ['Achieved'],
    answer: `Grinding the marble chip up into a powder gives it a much bigger surface area than it had when it was one single chip. That means there is a lot more of the marble actually touching the acid at any one time, so the reaction happens faster and finishes sooner.`,
  },
  {
    deck: 'acids-bases', cardIndex: 0, kind: 'merit', expect: ['Merit'],
    answer: `The reaction can only happen where the acid particles actually collide with the surface of the marble, and they have to collide with enough energy for the reaction to take place.

When the marble is one whole chip, most of the marble is on the inside where the acid cannot reach it, so only the particles on the outside are available to be collided with. Grinding it into a powder exposes a far bigger surface area, so at any moment there are many more acid particles able to hit marble. More successful collisions happening every second is exactly what a faster rate of reaction means. The mass of the marble has not changed at all between the two experiments — it is 2 g both times — so it is not that there is more marble, it is that more of the marble is reachable.`,
  },
  {
    deck: 'acids-bases', cardIndex: 0, kind: 'excellence', expect: ['Excellence'],
    answer: `A reaction only happens where acid particles collide with the marble surface with enough energy to react. In a single chip almost all of the marble is locked inside where no acid can reach it, and only the outer layer is available. Grinding it to powder exposes a much greater surface area, so at any given moment far more acid particles are in a position to collide with marble. More successful collisions per second is what a faster rate is.

What does not change is how much product you end up with. Both experiments start with 2 g of marble and the same acid, so the same amount of carbon dioxide is produced in the end. If you graphed the volume of gas against time, the powdered run would be steeper at the start but both lines would flatten out at exactly the same height. The powder does not produce more, it just gets there sooner, and that is a distinction worth making because it shows rate and yield are separate things.

The comparison is also a fair test, which is what lets her draw the conclusion at all. The mass, the concentration and volume of the acid, and the temperature were all kept the same, and surface area was the only variable changed, so the difference in time has to be down to surface area.

Both reactions also slow down as they go, because the acid is steadily being used up. As its concentration falls there are fewer acid particles in the same volume, so collisions become less frequent and the rate drops, until eventually one of the reactants runs out completely and the reaction stops.`,
  },
  {
    deck: 'acids-bases', cardIndex: 0, kind: 'waffle', expect: ['Not yet'],
    answer: `Rates of reaction is a topic that comes up a lot in chemistry and it is about how fast or slow a chemical reaction goes. There are quite a few different factors that can affect the rate of a reaction and scientists have studied all of them in a lot of detail over the years, because it is very useful to know how to make a reaction go faster or slower depending on what you want.

In this experiment the student is using marble and hydrochloric acid, which is a very common experiment to do in a school laboratory because it produces a gas that you can measure. She does the experiment twice, once with a chip and once with powder, and she finds that the powder is a lot faster than the chip was.

This shows that the surface area of a substance has an effect on how fast the reaction goes, which is a very important conclusion and is what the experiment was designed to find out in the first place.`,
  },
  {
    deck: 'acids-bases', cardIndex: 0, kind: 'terse-correct', expect: ['Achieved', 'Merit'],
    answer: `Powdering it exposes way more surface, so more acid particles can collide with marble every second. Same mass either way, so it is not more marble, just more of it reachable. Faster rate, same amount of gas at the end.`,
  },
  {
    deck: 'acids-bases', cardIndex: 0, kind: 'confident-error', expect: ['Not yet', 'Achieved'],
    answer: `The powdered marble reacts faster because grinding it up gives it more mass than the single chip had, and the more mass a reactant has the faster it will react with the acid. The powder also has more energy stored in it because of all the grinding, which makes the particles move around faster and collide more often.

This means the powdered experiment will also produce a much larger volume of carbon dioxide overall than the chip does, because a faster reaction always produces more product than a slow one.`,
  },

  /* ==== Acids #1 — Justify, the gardener's soil, 6 marks ================== */
  {
    deck: 'acids-bases', cardIndex: 1, kind: 'not-yet', expect: ['Not yet'],
    answer: `She should use the lime because the sodium hydroxide is really dangerous and would probably kill all of her plants. Lime is the one that gardeners normally use anyway.`,
  },
  {
    deck: 'acids-bases', cardIndex: 1, kind: 'achieved', expect: ['Achieved'],
    answer: `The soil has a pH of 4.5 which means it is acidic, and she needs to get it up to about 6.5. To raise the pH of something acidic you have to add a base to it, which will neutralise the acid. She should use the garden lime, because calcium carbonate is a base and it will bring the pH up towards neutral.`,
  },
  {
    deck: 'acids-bases', cardIndex: 1, kind: 'merit', expect: ['Merit'],
    answer: `Her soil is at pH 4.5, so it is acidic, and she needs to raise it to about 6.5. Raising the pH means neutralising the acid that is in the soil, which requires a base.

She should use the garden lime. Calcium carbonate is a carbonate, so when it meets the acid in the soil it reacts with it to produce a salt, water and carbon dioxide. The acid is used up in that reaction, so there is less of it left in the soil and the pH rises towards neutral. The sodium hydroxide would also neutralise the acid, because it is a base as well, but it is a strong base and it is corrosive, so it would be dangerous to handle and could damage the plants and their roots.`,
  },
  {
    deck: 'acids-bases', cardIndex: 1, kind: 'excellence', expect: ['Excellence'],
    answer: `The soil is at pH 4.5, so it is acidic, and she wants about 6.5. That means neutralising some of the acid already in the soil, which needs a base. Both products she is looking at would do that chemically — the question is which one is right for this job.

Lime is calcium carbonate, so it reacts with the acid in the soil to give a salt, water and carbon dioxide. That removes acid from the soil, so the pH rises. Sodium hydroxide is a hydroxide, so it would give a salt and water, and it would neutralise the acid too.

The reason lime is the right choice is not the chemistry, it is the control. Sodium hydroxide is a strong base and it is very soluble, so it reacts quickly and all at once. That makes it far too easy to overshoot — she is aiming for 6.5, not 7, and if she adds slightly too much she ends up with alkaline soil that is just as useless to her as the acidic soil was, and she has a second problem to fix. It is also corrosive, which makes it dangerous to spread by hand and damaging to the roots of anything already growing there.

Lime is only slightly soluble, so it dissolves and reacts slowly. That sounds like a disadvantage but it is actually the whole point: the pH creeps up gradually and settles rather than jumping, so it is very hard to overshoot with it, and it is safe to spread around living plants. When the target is a specific pH rather than just "less acidic", a slow reaction you can control beats a fast one you cannot.

So she should spread lime, then retest the soil after a few weeks and add more if it has not come up far enough, rather than trying to correct the whole bed in one go.`,
  },
  {
    deck: 'acids-bases', cardIndex: 1, kind: 'waffle', expect: ['Not yet'],
    answer: `Acids and bases are opposites of each other and they are measured using the pH scale, which goes from 0 all the way up to 14. Anything below 7 on the scale is an acid and anything above 7 is a base or an alkali, and 7 itself is neutral, which is what pure water is.

Gardening is something where chemistry turns out to be really useful in everyday life, because plants are quite fussy about the conditions that they are grown in and the soil has to be right for them or they will not grow properly. This gardener has tested her soil and found that it is not at the right pH for the vegetables that she wants to plant in it, so she is going to have to do something about that before she plants them.

There are two products available at the garden centre and she needs to choose between them carefully and pick the one that is going to be the best option for her particular situation and for the plants that she is intending to grow in that bed.`,
  },
  {
    deck: 'acids-bases', cardIndex: 1, kind: 'terse-correct', expect: ['Achieved', 'Merit'],
    answer: `Lime. It is a carbonate so it neutralises the soil acid to a salt, water and CO2, which brings the pH up. It is barely soluble so it works slowly and she cannot easily overshoot past 6.5, whereas the sodium hydroxide is strong and fast and would take her straight past it, as well as burning the roots.`,
  },
  {
    deck: 'acids-bases', cardIndex: 1, kind: 'confident-error', expect: ['Not yet', 'Achieved'],
    answer: `She should use the sodium hydroxide solution. Sodium hydroxide is a strong base, and because it is strong it is the most effective at neutralising acid, so it will fix the problem in her soil much more quickly and thoroughly than the lime would.

The lime is only a weak base, which means it is not really strong enough to neutralise soil that is as acidic as pH 4.5. When the sodium hydroxide reacts with the acid in the soil it will produce a salt and carbon dioxide, and the pH will go up to exactly 7, which is the neutral point and the best pH for growing vegetables in.`,
  },

  /* ==== English #0 — Explain, personification extract, 6 marks ============ */
  {
    deck: 'writing-about-text', cardIndex: 0, kind: 'not-yet', expect: ['Not yet'],
    answer: `The writer uses personification in this extract. An example of this is when they say "The house had learned to live without her". This is a good use of language because it makes the reader want to keep reading and creates a sad mood.`,
  },
  {
    deck: 'writing-about-text', cardIndex: 0, kind: 'achieved', expect: ['Achieved'],
    answer: `The writer uses personification to develop the idea of loss in this extract. An example of personification is "The house had learned to live without her", which gives the house a human quality because learning is something that only a person can actually do. Another example is the kitchen clock that "kept its own time", which also makes an object sound like it is behaving like a person. This shows the reader that somebody who used to live in the house is not there any more.`,
  },
  {
    deck: 'writing-about-text', cardIndex: 0, kind: 'merit', expect: ['Merit'],
    answer: `The writer uses personification to develop an idea about loss. The clearest example is the opening line, "The house had learned to live without her". Learning is something only a person can do, so giving that ability to the house makes the building itself the thing that has adapted to her absence, rather than any of the people in it. The effect of this on the reader is that the loss is shown to us through the house instead of being stated outright, so we work it out for ourselves.

The writer does the same thing with the kitchen clock, which "kept its own time, three minutes fast, with nobody left to correct it". Correcting a clock is a tiny domestic habit, the kind of thing nobody would notice, and by pointing out that nobody does it any more the writer turns it into the evidence that a person is missing. This makes the loss feel ordinary and permanent rather than dramatic, because it is measured in small everyday details rather than in big emotional statements.`,
  },
  {
    deck: 'writing-about-text', cardIndex: 0, kind: 'excellence', expect: ['Excellence'],
    answer: `The writer uses personification to show loss through objects rather than through people, and the choice is what gives the extract its quietness.

The opening line, "The house had learned to live without her", hands the house an ability that only a person has. It is the building, not the family, that has adapted, and because the writer never tells us who "her" is or what happened to her, the reader has to assemble the loss from what is left behind. The doors that "once stuck" and now "swung open at a touch" carry the same idea — the house has loosened and moved on, as though her absence has physically changed it.

Set against that is the dust that "settled on the piano lid in a fine grey skin, undisturbed". This is the second half of the idea and it pulls against the first. The house adapts, but the piano does not: the dust gathers exactly where her hands used to be, and "undisturbed" tells us nobody has touched it since. So the writer puts the building's easy acceptance directly beside the stillness of the one object she actually used, and the contrast is where the sadness sits.

The clock works the same way. "Three minutes fast, with nobody left to correct it" takes the smallest possible domestic habit and makes it the proof that she is gone. That is the writer's real technique in this extract — grief is not announced, it is noticed in details nobody corrects any more, which is much closer to how absence is actually experienced at home.

It is worth asking why the writer chose this instead of simply telling us. Had the extract said that she had died and that the family was grieving, the reader would have been told the feeling and could have moved on. Because the feeling is only ever implied through the objects, the reader has to do the work of putting it together, and the quiet, unemotional tone survives — which is the thing that makes it land.`,
  },
  {
    deck: 'writing-about-text', cardIndex: 0, kind: 'waffle', expect: ['Not yet'],
    answer: `In this extract the writer has used a wide range of different language features in order to develop their ideas and to create an effect on the reader. Language features are extremely important in writing because they are what makes a piece of writing interesting to read, and without them the writing would be very boring and nobody would want to read it at all.

The writer has clearly thought very carefully about the words that they have chosen to use here and every single word has been chosen for a reason. The description in this extract is very effective and it creates a really strong picture in the reader's mind of what the house is like and what has happened in it.

This makes the reader feel a lot of emotion when they are reading it, and it makes them want to carry on reading to find out what is going to happen next in the story. Overall the writer has used personification very effectively in this extract to develop their ideas about loss and to make the reader think about the theme.`,
  },
  {
    deck: 'writing-about-text', cardIndex: 0, kind: 'terse-correct', expect: ['Achieved', 'Merit'],
    answer: `"The house had learned to live without her" gives the house a human ability, so it is the building that adapts to her being gone rather than a person telling us about it. The clock "with nobody left to correct it" does the same job — a habit nobody keeps up any more is the proof she is missing, which makes the loss feel ordinary instead of dramatic.`,
  },
  {
    deck: 'writing-about-text', cardIndex: 0, kind: 'confident-error', expect: ['Not yet', 'Achieved'],
    answer: `The writer uses a lot of personification in this extract to develop the idea of loss. A clear example of personification is the simile "Dust settled on the piano lid in a fine grey skin", where the writer compares the dust to skin in order to make it sound more human and alive.

Another example of personification is when the writer uses the metaphor "three minutes fast", which is a metaphor for how time is passing quickly for the family now that she is gone. The alliteration in "doors that once stuck" also emphasises the sad mood and makes the reader feel sympathy for the house.`,
  },

  /* ==== English #1 — Analyse, the library speech, 6 marks ================= */
  {
    deck: 'writing-about-text', cardIndex: 1, kind: 'not-yet', expect: ['Not yet'],
    answer: `The speaker uses a statistic and some repetition to persuade the audience. This is effective because it makes the audience agree with them and makes the speech more convincing to listen to.`,
  },
  {
    deck: 'writing-about-text', cardIndex: 1, kind: 'achieved', expect: ['Achieved'],
    answer: `The speaker uses a few different techniques to persuade the audience. Firstly they use a statistic, "Forty-one of you signed out a book last week", which gives the audience a real number to think about. They then use repetition, because they say "Forty-one" again straight afterwards on its own. They also use direct address by saying "you", which speaks to the audience directly. At the end they use a contrast, "The question is not whether we can afford to keep it. It is who we are willing to lose when it goes." All of these are used to persuade the audience that the library should be kept open.`,
  },
  {
    deck: 'writing-about-text', cardIndex: 1, kind: 'merit', expect: ['Merit'],
    answer: `The speaker begins by quoting the word "underused" and then immediately answers it with a statistic: "Forty-one of you signed out a book last week." Putting a real number against a vague word makes the speaker sound reasonable and evidence-based rather than emotional, which matters because the audience is more likely to trust someone who has facts than someone who is just upset.

They then repeat "Forty-one" as a sentence on its own. Because it is isolated like that, the audience is forced to stop and sit with a number they have just heard dismissed as small, and hearing it a second time makes it feel much larger than it did the first time.

The direct address in "Forty-one of you" is also doing work. It means the evidence is not a statistic about strangers somewhere else, it is about the actual students sitting in the room listening, so the audience becomes the proof rather than just the listener.`,
  },
  {
    deck: 'writing-about-text', cardIndex: 1, kind: 'excellence', expect: ['Excellence'],
    answer: `Everything in this extract serves one strategy: the speaker takes the opposition's word and redefines it, rather than arguing against them on their own ground.

It starts with "We are told the library is 'underused'." The quotation marks hold the word at arm's length and mark it as somebody else's language, not the speaker's, so before any evidence arrives the audience is already being invited to distrust the term. Then comes the statistic, "Forty-one of you signed out a book last week", which answers a vague word with a hard number and makes the speaker sound measured rather than emotional. Repeating "Forty-one" as a sentence on its own forces the audience to sit with a figure they have just heard dismissed, and the second hearing makes it feel bigger than the first. "Forty-one of you" then makes the evidence personal — the proof is the people in the room, not strangers.

The final line completes the move: "The question is not whether we can afford to keep it. It is who we are willing to lose when it goes." That swaps out the question entirely, replacing a budget question with a question about people.

What makes this worth noticing is who the speaker is talking to. A school assembly has no power over a budget — the students listening cannot vote on whether the library stays. So the speech is not really trying to win the financial argument at all. It is aimed at the "people who do not make noise about it", and its actual purpose is to make the quiet students in that room feel counted, and to make anyone who does have a say feel that closing the library would be a decision about people rather than about money.

That is also where its limit is. The reframing works precisely because it never disputes the cost — the speaker never claims the library is affordable, and never offers a figure against it. A listener who came wanting the budget question answered would notice that it has been changed rather than answered. It is extremely effective on an audience that already feels overlooked, and much weaker on one that came to talk about money.`,
  },
  {
    deck: 'writing-about-text', cardIndex: 1, kind: 'waffle', expect: ['Not yet'],
    answer: `Persuasive speeches are designed to persuade an audience to agree with the speaker's point of view about a particular topic, and there are many different persuasive techniques that a speaker can use in order to do this successfully. Some of the most common ones are things like rhetorical questions, emotive language, statistics, repetition and direct address, and most good speeches will use several of these at the same time.

In this particular speech the speaker is talking to a school assembly about the school library, which is a topic that a lot of the students listening would care quite a lot about, because libraries are very important in schools and they help students with their learning and their reading.

The speaker uses a range of persuasive techniques throughout the speech in order to get the audience on their side and to convince them of their argument. This is very effective and by the end of the speech the audience would definitely be persuaded to agree with what the speaker has been saying to them about the library.`,
  },
  {
    deck: 'writing-about-text', cardIndex: 1, kind: 'terse-correct', expect: ['Achieved', 'Merit'],
    answer: `The speaker answers the word "underused" with a number, then repeats "Forty-one" alone so the audience has to sit with a figure they just heard dismissed. "Forty-one of you" makes the evidence the people in the room. The last line swaps the budget question for a question about who gets lost, which is the whole strategy — reframing rather than arguing about cost.`,
  },
  {
    deck: 'writing-about-text', cardIndex: 1, kind: 'confident-error', expect: ['Not yet', 'Achieved'],
    answer: `The speaker uses several persuasive techniques in this speech. The main one is the rhetorical question "The question is not whether we can afford to keep it", which is a question the speaker asks without expecting the audience to answer it out loud.

They also use a simile when they describe the library as "a room doing its job quietly", comparing the room to a person doing a job. There is also hyperbole in the statistic "Forty-one of you signed out a book last week", because the speaker is exaggerating the number in order to make the library sound busier than it really is, which is a very common persuasive technique.`,
  },
];
