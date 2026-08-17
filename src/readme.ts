/**
 * The figures this README is allowed to state.
 *
 * Written the day the README was found publishing 54.5 % and 85 wasted escalations while
 * the code produced 63.0 % and 50 — a rule had been fixed and the page had not moved.
 * Typing a figure by hand gives it no link to the thing it describes; generating it does.
 */

import { genererCas } from "./cas.ts";
import { balayer, mesurer } from "./mesurer.ts";
import { REFERENTIEL_SECTORIEL, PRUDENCE } from "./referentiel.ts";
import { collecter, forme, decrire } from "./echecs.ts";
import { trier } from "./agent.ts";
import { balayerErreur, bandes, PLAUSIBLE, AVEU, GRAINES, tirages } from "./sensibilite.ts";
import { rate } from "./interval.ts";
import { INVENTORY, CITED } from "./inventory.ts";
import { markdown } from "./provenance.ts";
import { comparer as comparerBases } from "./bases.ts";
import { run as emit, table } from "./figures.ts";

const cas = genererCas(400);
const pc = (x: number) => (x * 100).toFixed(1) + " %";

const tradeoff = table(
  ["Confidence bar", "Handled without a human", "Correct", "Breaches", "Wasted escalations"],
  balayer(cas, undefined, REFERENTIEL_SECTORIEL)
    .filter((b) => [0.5, 0.7, 0.8, 0.9].includes(b.seuil))
    .map((b) => [b.seuil.toFixed(2), pc(b.tauxAutomatisation), pc(b.precisionAutomatisee),
      b.manquements, b.escaladesInutiles]),
);

const sans = mesurer(cas, 0.7);
const avec = mesurer(cas, 0.7, REFERENTIEL_SECTORIEL);

/*
 * The finding, in the first screenful.
 *
 * Generated for the same reason as everything else on the page: a hand-typed headline is
 * the figure most likely to go stale and the one a reader is most likely to quote back.
 * This repository already published 54.5 % against a measured 63.0 % once.
 */
const finding =
  `**The finding.** Moving the confidence bar was never the expensive lever. The escalations ` +
  `came from one badly informed rule — a flat volume ceiling applied to every sector — and ` +
  `giving the agent sector context took automation from **${pc(sans.tauxAutomatisation)}** to ` +
  `**${pc(avec.tauxAutomatisation)}**, wasted escalations from ${sans.escaladesInutiles} to ` +
  `${avec.escaladesInutiles}, and breaches from ${sans.manquements} to **${avec.manquements}**. ` +
  `Dragging the bar had cost breaches for every point it bought.`;
const context = table(
  ["", "Handled without a human", "Wasted escalations", "Breaches"],
  [
    ["Without sector context", pc(sans.tauxAutomatisation), sans.escaladesInutiles, sans.manquements],
    ["**With sector context**", `**${pc(avec.tauxAutomatisation)}**`, `**${avec.escaladesInutiles}**`, `**${avec.manquements}**`],
  ],
);

const sensitivity = table(
  ["Reference error", "Breaches", "Wasted escalations", "Automated"],
  balayerErreur().map((p) => [
    (p.erreur >= 0 ? "+" : "") + (p.erreur * 100).toFixed(0) + " %",
    p.manquements, p.escaladesInutiles, pc(p.tauxAutomatisation),
  ]),
);

const echecs = collecter();
const failures = (() => {
  const counts = table(["Wrong decisions", "Kind · rules that fired"],
    forme(echecs).slice(0, 6).map(([k, n]) => [n, k]));
  const breaches = echecs.filter((e) => e.genre === "manquement");
  const examples = (breaches.length ? breaches : echecs.slice(0, 2))
    .slice(0, 2).map((e) => "```\n" + decrire(e) + "\n```").join("\n\n");
  const r = rate(avec.automatises - avec.manquements, avec.automatises);
  return `${echecs.length} wrong decisions out of ${cas.length}. Automated decisions are correct ` +
    `${pc(r.rate)} of the time, 95 % interval [${(r.low * 100).toFixed(0)}–${(r.high * 100).toFixed(0)}], ` +
    `n=${r.n}.\n\n${counts}\n\n` +
    (breaches.length === 0
      ? "**No breach remains.** Every file that had to go to a human went to a human.\n\n" +
        "The two worst remaining errors are wasted escalations — analyst time, not exposure:\n\n" + examples
      : `The breach${breaches.length > 1 ? "es" : ""}, in full:\n\n` + examples);
})();

/*
 * The five constants that are mine, and what the sweep makes of them.
 *
 * This is the block I would least like a reviewer to write for me, which is the reason it
 * is generated rather than described. Three of the five matter and cannot be located by
 * this measurement; saying so costs nothing except the appearance of rigour I did not
 * have.
 */
const chosen = (() => {
  const bs = bandes(tirages());
  const f = (x: number) => (x < 100 ? x.toFixed(2) : Math.round(x).toLocaleString("en-GB"));
  const verdict: Record<string, string> = {
    "decides the breaches": "**Decides breaches**, and the draws agree where",
    "decides, boundary under the noise": "**Decides breaches**; the boundary is under the noise",
    "costs analyst time only": "Costs analyst time only",
    "dormant behind the reference table": "**Dormant** — inert here, decisive without the sector table",
    "no effect": "No effect on either cost",
  };
  const t = table(
    ["Constant", "In use", "Plausible range", `Breaches per ${800} files, low → high`, "Verdict"],
    bs.map((b) => [
      "`" + b.reglage + "`", f(b.valeur),
      f(PLAUSIBLE[b.reglage][0]) + " – " + f(PLAUSIBLE[b.reglage][1]),
      // A dormant constant's figure in the published configuration is 0.0 → 0.0, which
      // beside the word "decisive" reads as a contradiction. Show the one that makes the
      // verdict legible, marked for what it is.
      b.verdict === "dormant behind the reference table"
        ? b.auxExtremesSansTable[0].toFixed(1) + " → " + b.auxExtremesSansTable[1].toFixed(1) + " †"
        : b.auxExtremes[0].toFixed(1) + " → " + b.auxExtremes[1].toFixed(1),
      verdict[b.verdict],
    ]),
  );
  const solides = bs.filter((b) => b.verdict === "decides the breaches").length;
  const flous = bs.filter((b) => b.verdict === "decides, boundary under the noise").length;
  return `Measured over ${GRAINES.length} independent draws of 800 files. What no source says ` +
    `about each of them:\n\n` +
    bs.map((b) => `- \`${b.reglage}\` — ${AVEU[b.reglage]}`).join("\n") +
    `\n\n${t}\n\n` +
    `† measured with the sector table removed — see the note below.\n\n` +
    `${solides} of ${bs.length} can be defended with this measurement. ${flous} cost breaches at the ` +
    `far end of their range in every draw, and no draw agrees with the others on where that starts — ` +
    `they matter, and this measurement cannot tell you where to set them.`;
})();

const margin = (() => {
  const b = bandes(tirages()).find((x) => x.reglage === "prudence")!;
  return `The reference is used at **${(PRUDENCE * 100).toFixed(0)} %** of its stated values. ` +
    `That margin is derived from the largest overstatement in the table (+14 %, on crypto-assets): ` +
    `1 / 1.14 ≈ 0.88, rounded down. It is not chosen by looking at which value makes the results ` +
    `look best — that would be fitting the answer.\n\n` +
    `The sweep above then checked the derivation against outcomes, which is a different question. ` +
    `No draw loses a file anywhere below **${b.deManquements[1].toFixed(2)}**, and the value in use ` +
    `is ${PRUDENCE.toFixed(2)}. The derivation landed inside the safe band with ` +
    `${(b.deManquements[1] - PRUDENCE).toFixed(2)} to spare out of a range ` +
    `${(PLAUSIBLE.prudence[1] - PLAUSIBLE.prudence[0]).toFixed(2)} wide — and that edge is one only ` +
    `${b.accord} of ${GRAINES.length} draws can see, so the headroom is smaller than the resolution ` +
    `of the thing measuring it. Derived honestly is not the same as derived safely; only the first ` +
    `of those two was ever checked, and the second is closer than the derivation suggested.`;
})();

const baselines = table(
  ["", "Automated", "Breaches", "Files to a human"],
  comparerBases().map((c) => [
    c.nom === "the agent" ? `**${c.nom}**` : c.nom,
    (c.automatise * 100).toFixed(1) + " %",
    c.nom === "the agent" ? `**${c.manquements}**` : c.manquements,
    c.versHumain,
  ]),
);

/*
 * What each decision cites, and where a reader can check it.
 *
 * This table is the defensibility argument made concrete. Every figure in it was
 * retrieved from the source on the date shown — nothing is cited from memory.
 *
 * It lists what *this* tool applies, not everything the shared file contains. The two
 * were the same until a sanctions-reporting section was added for the regression bench,
 * and this table silently grew a citation no rule here has ever applied — a table headed
 * "what every decision cites" listing something no decision cites. Deriving the list from
 * the rules means it cannot drift again.
 */
const citations = table(
  ["Citation", "Requires", "Figure", "Retrieved"],
  CITED.map((r) => [
    `[${r.cite}](${r.source})`, r.says, r.figure ?? "—", r.retrieved,
  ]),
);

/* Where every number on this page came from. Generated, and guarded by a test. */
const provenance = markdown(INVENTORY, table);

emit(new URL("../README.md", import.meta.url).pathname,
  { finding, tradeoff, context, sensitivity, chosen, failures, margin, baselines, provenance, citations });
