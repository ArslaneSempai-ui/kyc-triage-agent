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

<!-- figures:tradeoff -->
| Confidence bar | Handled without a human | Correct | Breaches | Wasted escalations |
|---|---|---|---|---|
| 0.50 | 63.0 % | 100.0 % | 0 | 50 |
| 0.70 | 63.0 % | 100.0 % | 0 | 50 |
| 0.80 | 58.5 % | 100.0 % | 0 | 68 |
| 0.90 | 31.0 % | 100.0 % | 0 | 178 |
<!-- /figures:tradeoff -->

### Then the interesting part

Notice that 0.50 and 0.70 produce **identical results**. A week spent tuning that bar
would have bought nothing.

The 146 unnecessary escalations weren't caused by a rule firing wrongly. They were caused
by **low confidence** — and tracing which rule capped it gave a single answer: 125 of 146
came from the volume rule. The agent was applying one flat ceiling of €1.5M to every
sector. An import-export business at €3M is ordinary; a consultancy at €3M is not. The
agent didn't know the difference, so it stopped.

Giving it the sector reference it was missing:

<!-- figures:context -->
|  | Handled without a human | Wasted escalations | Breaches |
|---|---|---|---|
| Without sector context | 39.3 % | 146 | 1 |
| **With sector context** | **63.0 %** | **50** | **0** |
<!-- /figures:context -->

**+39 % relative automation, −42 % wasted analyst time, identical regulatory safety** —
and none of it came from the threshold.

> You don't tune your way out of a missing-context problem.

The mechanism worked exactly as designed: the agent's ignorance surfaced as *low
confidence* rather than as a *wrong decision*. It flagged its own weakest rule. That is
the whole argument for making confidence a first-class output instead of a hidden number.

---

## What every decision cites

An earlier version of this agent cited clauses I had invented — `PR-101 §5` was a label
chosen so that decisions would reference *something*, and a reader could check none of
them. For a tool whose entire argument is that an automated decision must be defensible,
that was the one thing it could not do.

Each rule now names a section of 31 CFR that was actually retrieved, or says plainly that
it enforces a bank's own control rather than a rule of law. Both are honest. A made-up
citation is not.

<!-- figures:citations -->
| Citation | Requires | Figure | Retrieved |
|---|---|---|---|
| [31 CFR 1020.320(a)(2)](https://www.law.cornell.edu/cfr/text/31/1020.320) | A bank must report a suspicious transaction conducted or attempted by, at or through it once the amount involved or aggregated reaches the threshold. | $5,000 | 2026-08-17 |
| [31 CFR 1010.230(d)(1)](https://www.law.cornell.edu/cfr/text/31/1010.230) | Each individual holding a quarter or more of the equity of a legal entity customer must be identified. | 25 % | 2026-08-17 |
| [31 CFR 1010.230(d)(2)](https://www.law.cornell.edu/cfr/text/31/1010.230) | One individual with significant responsibility to control or direct the entity must be identified, in addition to any owners. | 1 individual | 2026-08-17 |
| [31 CFR 1010.230(a)](https://www.law.cornell.edu/cfr/text/31/1010.230) | Beneficial owners are identified when the account is opened, not afterwards. | — | 2026-08-17 |
| [31 CFR 1010.311](https://www.law.cornell.edu/cfr/text/31/1010.311) | A currency transaction above the threshold is reported by the financial institution. | $10,000 | 2026-08-17 |
<!-- /figures:citations -->

Nothing here is cited from memory. Every figure was fetched from the source on the date
shown, and a test fails if a rule claims a regulation whose citation its clause does not
carry.

The synthetic files remain synthetic — a real onboarding file cannot leave a bank. What is
no longer invented is the law they are judged against.

---

## Against doing no work at all

"Handles 63 % without a human" — against what? Two constants bracket the problem, and
both take a line to implement:

<!-- figures:baselines -->
|  | Automated | Breaches | Files to a human |
|---|---|---|---|
| always "escalader" | 0.0 % | 0 | 400 |
| always "approuver" | 100.0 % | 98 | 0 |
| **the agent** | 63.0 % | **0** | 148 |
<!-- /figures:baselines -->

Escalating everything is safe and unaffordable. Approving everything is free and
indefensible. Beating either one alone is worthless — the claim worth making is holding
most of the automation of the second while keeping the safety of the first, and it can
only be read beside both numbers.

Publishing an accuracy without its baseline invites the one question you cannot answer.

---

## Which of my own numbers decide the outcome

Five constants in this repository have no authority behind them. No regulation says where
a screening match becomes certain, what multiple of a sector norm is abnormal, or how much
margin to take against a reference table known to be approximate. I chose all five by
judgement, and a portfolio piece that publishes results without saying which judgements
they rest on is asking to be taken on trust.

So each one is swept across the range a competent person could disagree with me over, and
judged on **breaches** — files decided alone that had to go to a human. That is the error
with a fine attached; wasted escalations are analyst time.

<!-- figures:chosen -->
Measured over 5 independent draws of 800 files. What no source says about each of them:

- `seuilSanctionCertain` — no regulation says where a screening match becomes certain
- `seuilSanctionDoute` — nor where it becomes worth a second look
- `volumeEleve` — a flat ceiling, used only where no sector reference exists
- `multipleAnormal` — no source defines an abnormal multiple of a sector norm
- `prudence` — derived from the largest observed reference error, not from the outcome

| Constant | In use | Plausible range | Breaches per 800 files, low → high | Verdict |
|---|---|---|---|---|
| `seuilSanctionCertain` | 0.85 | 0.70 – 0.98 | 0.0 → 13.8 | **Decides breaches**, and the draws agree where |
| `seuilSanctionDoute` | 0.55 | 0.30 – 0.80 | 0.0 → 22.8 | **Decides breaches**; the boundary is under the noise |
| `volumeEleve` | 1,500,000 | 400,000 – 5,000,000 | 0.0 → 20.8 † | **Dormant** — inert here, decisive without the sector table |
| `multipleAnormal` | 3.50 | 2.00 – 8.00 | 0.0 → 12.0 | **Decides breaches**; the boundary is under the noise |
| `prudence` | 0.85 | 0.70 – 1.00 | 0.0 → 4.4 | **Decides breaches**; the boundary is under the noise |

† measured with the sector table removed — see the note below.

1 of 5 can be defended with this measurement. 3 cost breaches at the far end of their range in every draw, and no draw agrees with the others on where that starts — they matter, and this measurement cannot tell you where to set them.
<!-- /figures:chosen -->

Two things about the method, both of which I got wrong first.

**One draw cannot tell a threshold from a coincidence.** The first version swept a single
sample and reported four of five constants as decisive — every one of them on a move from
0 breaches to 1 in 1,200 files. A different seed puts that edge somewhere else. Five
independent draws, and the question splits in two: *does it cost?* and *where does it start
costing?* Three constants answer yes and don't know, which is awkward and true.

**Inert is not the same as irrelevant.** `volumeEleve` came back "no effect" because the
check meant to run it without a sector reference passed `undefined` to a parameter whose
default *was* the reference — so every dormancy check silently ran with the table. Removing
the table moves that constant from none to more than twenty breaches per 800 files, the
figure marked † above. The tool was telling a
reader to ignore the one number they would need the moment their reference data had a hole
in it. It is `sensibilite.ts` and a test that guard it now.

---

## How wrong may the reference be?

The failure gallery traced the single remaining breach to one row of the sector reference
table. That is worth generalising, because reference data is always approximate and nobody
asks how approximate it is allowed to be.

<!-- figures:sensitivity -->
| Reference error | Breaches | Wasted escalations | Automated |
|---|---|---|---|
| -30 % | 0 | 106 | 49.0 % |
| -20 % | 0 | 74 | 57.0 % |
| -10 % | 0 | 58 | 61.0 % |
| -5 % | 0 | 53 | 62.3 % |
| +0 % | 0 | 50 | 63.0 % |
| +5 % | 0 | 45 | 64.3 % |
| +10 % | 0 | 41 | 65.3 % |
| +20 % | 2 | 36 | 67.0 % |
| +30 % | 3 | 32 | 68.3 % |
<!-- /figures:sensitivity -->

The table is not symmetric, and neither is the price. Understating a norm makes the agent
escalate work it could have handled: analyst time, visible, nobody harmed. Overstating one
lets files through uncontrolled — and **improves every figure a dashboard shows** while
producing the only error that carries a fine.

<!-- figures:margin -->
The reference is used at **85 %** of its stated values. That margin is derived from the largest overstatement in the table (+14 %, on crypto-assets): 1 / 1.14 ≈ 0.88, rounded down. It is not chosen by looking at which value makes the results look best — that would be fitting the answer.

The sweep above then checked the derivation against outcomes, which is a different question. No draw loses a file anywhere below **0.88**, and the value in use is 0.85. The derivation landed inside the safe band with 0.03 to spare out of a range 0.30 wide — and that edge is one only 1 of 5 draws can see, so the headroom is smaller than the resolution of the thing measuring it. Derived honestly is not the same as derived safely; only the first of those two was ever checked, and the second is closer than the derivation suggested.
<!-- /figures:margin -->

---

## What it gets wrong

<!-- figures:failures -->
50 wrong decisions out of 400. Automated decisions are correct 100.0 % of the time, 95 % interval [98–100], n=252.

| Wrong decisions | Kind · rules that fired |
|---|---|
| 7 | escalade evitable · R-JURID |
| 4 | escalade evitable · R-JURID+R-PIECE+R-VOL |
| 4 | escalade evitable · R-PIECE+R-VOL |
| 2 | escalade evitable · R-JURID+R-PIECE |
| 2 | escalade evitable · R-JURID+R-NOM+R-VOL |
| 2 | escalade evitable · R-LISIB+R-PIECE+R-VOL |

**No breach remains.** Every file that had to go to a human went to a human.

The two worst remaining errors are wasted escalations — analyst time, not exposure:

```
C-0001 · Ferreira Logistics · societe · NL
  sector      import-export, 16,985,718 EUR declared
  screening   sanctions 0.17 · PEP 0.01
  agent said  escalader (confidence 0.88)
  should be   complement
  R-LISIB   Unreadable document: immatriculation  [sharpness 0.70]
  R-LISIB   Unreadable document: structure  [sharpness 0.70]
  R-VOL     €16,985,718 declared, 5.9× the norm for “import-export”  [sharpness 0.88]
```

```
C-0003 · Haddad Ventures · societe · GR
  sector      restauration, 2,183,844 EUR declared
  screening   sanctions 0.14 · PEP 0.07
  agent said  escalader (confidence 0.95)
  should be   complement
  R-LISIB   Unreadable document: domicile  [sharpness 0.70]
  R-BE25    1 beneficial owner(s) above 25 % not identified  [sharpness 1.00]
  R-VOL     €2,183,844 declared, 8.7× the norm for “restauration”  [sharpness 0.95]
```
<!-- /figures:failures -->

A count is a claim a reader takes on trust. A named file with the rules that fired beside
the decision an analyst would have made is something a compliance officer can argue with —
and arguing with it is the point.

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
