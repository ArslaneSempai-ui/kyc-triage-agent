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
import { balayerErreur } from "./sensibilite.ts";
import { rate } from "./interval.ts";
import { REGULATIONS, ALL } from "./regulations.ts";
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

const margin = `The reference is used at **${(PRUDENCE * 100).toFixed(0)} %** of its stated values. ` +
  `That margin is derived from the largest overstatement in the table (+14 %, on crypto-assets): ` +
  `1 / 1.14 ≈ 0.88, rounded down. It is not chosen by looking at which value makes the results ` +
  `look best — that would be fitting the answer.`;

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
 */
const citations = table(
  ["Citation", "Requires", "Figure", "Retrieved"],
  ALL.map((r) => [
    `[${r.cite}](${r.source})`, r.says, r.figure ?? "—", r.retrieved,
  ]),
);

emit(new URL("../README.md", import.meta.url).pathname,
  { tradeoff, context, sensitivity, failures, margin, baselines, citations });
