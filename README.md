# An onboarding triage agent that knows where to stop

An agent applies a bank's onboarding procedure to each client file, cites the clause
behind every decision, and **hands the file to a human when it isn't confident**.

Everything runs locally. No API key, no external service, no data leaving the machine.

```
npm start          # the review queue, on localhost:4500
npm run mesurer    # the trade-off table below
npm test
```

> Every case is **synthetic and generated**, deliberately. A real onboarding file cannot
> leave a bank, and a demonstration nobody can run proves nothing.

---

## The problem this is really about

Automating a compliance decision is easy. Automating it in a way that survives a
regulator's question eighteen months later is the actual job.

Three things have to hold at once:

1. Every decision **cites the clause** it rests on. A decision without a reason is
   indefensible, whoever made it.
2. The agent **decides only where it is confident**, and says so out loud when it isn't.
3. The cost of that boundary is **measured**, not asserted — because moving it trades
   analyst hours against regulatory exposure, and that trade belongs to the business.

I spent six years on the receiving end of this work: 30,000+ profiles reviewed, 6,000+
high-risk escalations. The false positive rate was never a number on a slide. It was the
size of the pile on my desk.

---

## What it looks like

![The review queue](images/queue.png)

The queue is sorted **least confident first** — that's where a human opinion is worth the
most. Each file shows what the agent saw, which rules fired, the clause behind each one,
and how sharp the observation was. The interface runs in French or English.

No action is visually promoted. An early version filled *Approve* in green, which made
approval the reflex click on a compliance queue — precisely backwards. Now only the
agent's own proposal is marked, and quietly: it informs, it doesn't invite.

When a human overrides, the disagreement is recorded. That's the only material that will
ever support the sentence "the agent is systematically wrong here" instead of "the
analysts are complaining". The agreement rate stays hidden until ten decisions exist —
a rate over two samples is noise wearing a percentage sign.

The slider carries its own honesty check. Most escalations come from rules that are
*certain*, and no amount of dragging will move those; the screen says how many of the
current escalations the setting actually governs. A control that appears to do nothing
teaches people the tool is broken.

---

## What was measured

400 synthetic files, each carrying the decision an experienced analyst would have made.
Two errors share the word "mistake" and do not share a price:

- **an unnecessary escalation** — a file sent to a human for nothing: *operational cost*
- **a breach** — decided alone when it should have been escalated: *regulatory cost*

Counting them together hides the only one that matters.

| Confidence bar | Handled without a human | Correct | Breaches | Unnecessary escalations |
|---|---|---|---|---|
| 0.50 | 39.3 % | 99.4 % | 1 | 146 |
| 0.70 | 39.3 % | 99.4 % | 1 | 146 |
| 0.90 | 17.5 % | 100 % | 0 | 232 |

### Then the interesting part

Notice that 0.50 and 0.70 produce **identical results**. A week spent tuning that bar
would have bought nothing.

The 146 unnecessary escalations weren't caused by a rule firing wrongly. They were caused
by **low confidence** — and tracing which rule capped it gave a single answer: 125 of 146
came from the volume rule. The agent was applying one flat ceiling of €1.5M to every
sector. An import-export business at €3M is ordinary; a consultancy at €3M is not. The
agent didn't know the difference, so it stopped.

Giving it the sector reference it was missing:

| | Handled without a human | Unnecessary escalations | Breaches |
|---|---|---|---|
| Without sector context | 39.3 % | 146 | 1 |
| **With sector context** | **54.5 %** | **85** | 1 |

**+39 % relative automation, −42 % wasted analyst time, identical regulatory safety** —
and none of it came from the threshold.

> You don't tune your way out of a missing-context problem.

The mechanism worked exactly as designed: the agent's ignorance surfaced as *low
confidence* rather than as a *wrong decision*. It flagged its own weakest rule. That is
the whole argument for making confidence a first-class output instead of a hidden number.

---

## How it's built

```
src/
  cas.ts         synthetic case generator + ground truth (seeded, reproducible)
  agent.ts       rules, decision trace, confidence, escalation boundary
  referentiel.ts the sector context the agent was missing
  mesurer.ts     scoring: automation rate, breaches, wasted escalations
  file.ts        the review queue and recorded human overrides
  serveur.ts     local server
  ui.html        one screen
```

Node 26 with native TypeScript, `node:test`, no build step, no dependencies.

**Confidence** combines two things: how sharp each observation was, and whether any rule
left doubt behind. A sanctions match at 0.97 and one at 0.58 fire the same rule and do
not deserve the same confidence — conflating them is what makes an automation dangerous.

**The most severe decision wins.** Asking someone flagged against a sanctions list to
send a missing utility bill would tip them off.

**The case generator is seeded.** Without a fixed seed, two measurements aren't
comparable and you end up crediting a code change for what was just a different sample.

**The agent is deliberately not a copy of the ground truth.** An agent that reimplements
its own marking scheme scores 100 % and demonstrates nothing.

---

## What it doesn't do

- **No LLM.** Every decision here is a rule with a citation. That's a deliberate choice
  for this domain, not a limitation I worked around — and it means the confidence number
  is something I can explain rather than something I hope for.
- **No document reading.** Cases arrive structured. Extracting them from PDFs is a
  separate problem, which I solved separately in
  [compliance-document-search](https://github.com/ArslaneSempai-ui/compliance-document-search).
- **No learning from overrides.** They're recorded, not yet used. Closing that loop needs
  far more human decisions than a demonstration produces.
- **No pagination.** The queue shows the 25 least-confident files of however many are
  waiting, and says so.
- **Synthetic data.** Every conclusion above holds for this generator. On a real book of
  business, all of it must be re-measured — which is the first finding of the previous
  project, and the reason the measurement harness ships with the tool.

---

**Arslane Chaouche Ramdane** — six years in AML/KYC and financial crime operations,
moving into AI transformation work.
