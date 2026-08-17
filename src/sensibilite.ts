/**
 * How wrong may the reference data be before it costs something?
 *
 * The failure gallery traced both breaches to a single row of the sector reference table:
 * crypto-assets, carried at €1,250,000 against a true norm of €1,100,000. A 14 %
 * overestimate. It moved the jurisdiction threshold from €2.2M to €2.5M, and the two
 * files that slipped through declared €2,361,923 and €2,376,435 — inside the window the
 * error opened, and nowhere else.
 *
 * That is worth generalising, because reference data is always approximate and nobody
 * asks how approximate it is allowed to be. The sweep below distorts every sector norm by
 * a known factor and reports what it costs.
 *
 * The asymmetry is the finding: **the sign of the error decides which kind of damage you
 * get**. Understate the norms and the agent escalates work it could have handled —
 * expensive, visible, and nobody is harmed. Overstate them and files walk through
 * uncontrolled, which is the error with a fine attached.
 */

import { genererCas } from "./cas.ts";
import { REFERENTIEL_SECTORIEL } from "./referentiel.ts";
import { mesurer } from "./mesurer.ts";
import type { Referentiel } from "./referentiel.ts";

/** The same table, every row multiplied by `facteur`. */
export function fausser(facteur: number): Referentiel {
  const faussé: Referentiel = new Map();
  for (const [secteur, valeur] of REFERENTIEL_SECTORIEL) faussé.set(secteur, valeur * facteur);
  return faussé;
}

export type Point = {
  erreur: number;
  manquements: number;
  escaladesInutiles: number;
  tauxAutomatisation: number;
};

export function balayerErreur(
  facteurs = [0.7, 0.8, 0.9, 0.95, 1.0, 1.05, 1.1, 1.2, 1.3],
  seuil = 0.7,
  combien = 400,
): Point[] {
  const cas = genererCas(combien);
  return facteurs.map((f) => {
    const b = mesurer(cas, seuil, fausser(f));
    return {
      erreur: f - 1,
      manquements: b.manquements,
      escaladesInutiles: b.escaladesInutiles,
      tauxAutomatisation: b.tauxAutomatisation,
    };
  });
}

if (import.meta.filename === process.argv[1]) {
  console.log("\nHow much may the sector reference be wrong before it costs something?\n");
  console.log("reference error   breaches   wasted escalations   automated");
  console.log("─".repeat(64));

  for (const p of balayerErreur()) {
    const signe = p.erreur >= 0 ? "+" : "";
    console.log(
      `${(signe + (p.erreur * 100).toFixed(0) + " %").padStart(13)}   ` +
      `${String(p.manquements).padStart(8)}   ${String(p.escaladesInutiles).padStart(18)}   ` +
      `${(p.tauxAutomatisation * 100).toFixed(1).padStart(8)} %`,
    );
  }

  console.log(
    "\nUnderstating the norms costs analyst time and harms nobody." +
    "\nOverstating them lets files through uncontrolled, which is the error with a fine attached." +
    "\nThe table is not symmetric, and neither is the price.\n",
  );
}
