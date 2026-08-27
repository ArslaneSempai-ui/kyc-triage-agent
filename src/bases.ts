/**
 * What the agent is worth compared to doing no work at all.
 *
 * "Handles 58 % without a human" — against what? Two constants bracket the problem and
 * both are trivial to implement, which is exactly why the comparison is the first thing
 * anyone technical asks for:
 *
 *   escalate everything  ->  no breach ever, and no automation at all. Safe, unaffordable.
 *   approve everything   ->  total automation, and every escalation missed. Free, indefensible.
 *
 * Beating either one alone is worthless. The only claim worth making is holding most of
 * the automation of the second while keeping the safety of the first, and that claim can
 * only be read beside both numbers.
 */

import { genererCas } from "./cas.ts";
import { isMain } from "./cli.ts";
import { mesurer } from "./mesurer.ts";
import { REFERENTIEL_SECTORIEL } from "./referentiel.ts";
import { constantDecision } from "./baselines.ts";
import type { Decision } from "./cas.ts";

export type Comparaison = {
  nom: string;
  quoi: string;
  automatise: number;
  manquements: number;
  versHumain: number;
};

export function comparer(seuil = 0.7, combien = 400): Comparaison[] {
  const cas = genererCas(combien);
  const verites = cas.map((c) => c.verite);
  const aEscalader = verites.filter((v) => v === "escalader").length;

  const constante = (d: Decision, quoi: string): Comparaison => {
    const b = constantDecision(verites, d, quoi);
    return {
      nom: `always "${d}"`,
      quoi,
      // Anything not escalated is handled without a human, by definition.
      automatise: d === "escalader" ? 0 : 1,
      manquements: d === "escalader" ? 0 : aEscalader,
      versHumain: d === "escalader" ? cas.length : 0,
    };
  };

  const agent = mesurer(cas, seuil, REFERENTIEL_SECTORIEL);

  return [
    constante("escalader", "sends every file to an analyst"),
    constante("approuver", "opens every account without looking"),
    {
      nom: "the agent",
      quoi: "applies the procedure, and stops where it is not confident",
      automatise: agent.tauxAutomatisation,
      manquements: agent.manquements,
      versHumain: cas.length - agent.automatises,
    },
  ];
}

if (isMain(import.meta)) {
  console.log("\nAgainst the two constants that bracket the problem\n");
  console.log("                       automated   breaches   files to a human");
  console.log("─".repeat(68));
  for (const c of comparer()) {
    console.log(
      `${c.nom.padEnd(22)}${(c.automatise * 100).toFixed(1).padStart(8)} %` +
      `${String(c.manquements).padStart(11)}${String(c.versHumain).padStart(19)}`,
    );
    console.log(`  ${c.quoi}`);
  }
  console.log(
    "\nEscalating everything is safe and unaffordable. Approving everything is free and" +
    "\nindefensible. Neither is hard to beat on its own — the claim is holding most of the" +
    "\nautomation of the second while keeping the safety of the first.\n",
  );
}
