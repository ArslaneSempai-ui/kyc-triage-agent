/**
 * Noter l'agent.
 *
 * La justesse globale n'intéresse personne ici. Deux erreurs portent le même nom et
 * n'ont pas le même prix :
 *
 *   - escalader un dossier qui aurait pu être traité seul → du temps analyste perdu ;
 *   - approuver seul un dossier qui devait remonter → une entrée en relation non
 *     contrôlée, c'est-à-dire le manquement.
 *
 * Les compter ensemble revient à masquer la seule qui coûte cher.
 */

import { genererCas } from "./cas.ts";
import { trier } from "./agent.ts";
import { REFERENTIEL_SECTORIEL } from "./referentiel.ts";
import type { Referentiel } from "./referentiel.ts";
import type { Cas, Decision } from "./cas.ts";

export type Bilan = {
  seuil: number;
  total: number;
  /** Dossiers tranchés sans intervention humaine. */
  automatises: number;
  tauxAutomatisation: number;
  /** Parmi les dossiers automatisés, ceux dont la décision était la bonne. */
  justesAutomatises: number;
  precisionAutomatisee: number;
  /** L'erreur grave : décidé seul, alors qu'il fallait escalader. */
  manquements: number;
  /** L'erreur coûteuse mais bénigne : envoyé à un humain pour rien. */
  escaladesInutiles: number;
  parDecision: Record<Decision, { attendu: number; obtenu: number; justes: number }>;
};

export function mesurer(cas: Cas[], seuil: number, referentiel?: Referentiel): Bilan {
  const vide = () => ({ attendu: 0, obtenu: 0, justes: 0 });
  const parDecision: Bilan["parDecision"] = {
    approuver: vide(), complement: vide(), escalader: vide(),
  };

  let automatises = 0, justesAutomatises = 0, manquements = 0, escaladesInutiles = 0;

  for (const c of cas) {
    const v = trier(c, seuil, referentiel);
    parDecision[c.verite].attendu++;
    parDecision[v.decision].obtenu++;
    if (v.decision === c.verite) parDecision[c.verite].justes++;

    if (v.decision === "escalader") {
      if (c.verite !== "escalader") escaladesInutiles++;
    } else {
      automatises++;
      if (v.decision === c.verite) justesAutomatises++;
      if (c.verite === "escalader") manquements++;
    }
  }

  return {
    seuil, total: cas.length, automatises,
    tauxAutomatisation: automatises / cas.length,
    justesAutomatises,
    precisionAutomatisee: automatises === 0 ? 1 : justesAutomatises / automatises,
    manquements, escaladesInutiles, parDecision,
  };
}

/** Le compromis, seuil par seuil. C'est la seule sortie qui mérite d'être publiée. */
export function balayer(cas: Cas[], seuils = [0.5, 0.6, 0.7, 0.8, 0.9, 0.95], referentiel?: Referentiel): Bilan[] {
  return seuils.map((s) => mesurer(cas, s, referentiel));
}

if (import.meta.filename === process.argv[1]) {
  const cas = genererCas(400);
  const pc = (x: number) => (x * 100).toFixed(1).padStart(5) + " %";

  console.log(`\n${cas.length} dossiers synthétiques`);

  for (const [titre, ref] of [
    ["SANS référentiel sectoriel", undefined],
    ["AVEC référentiel sectoriel", REFERENTIEL_SECTORIEL],
  ] as const) {
    console.log(`\n${titre}`);
    console.log("seuil   automatisé   justesse   manquements   escalades inutiles");
    console.log("─".repeat(68));
    for (const b of balayer(cas, undefined, ref)) {
      console.log(
        `${b.seuil.toFixed(2)}   ${pc(b.tauxAutomatisation)}    ${pc(b.precisionAutomatisee)}` +
        `   ${String(b.manquements).padStart(9)}   ${String(b.escaladesInutiles).padStart(16)}`,
      );
    }
  }
  console.log(
    "\nmanquement       = décidé seul alors qu'il fallait escalader (le coût réglementaire)" +
    "\nescalade inutile = envoyé à un analyste sans raison (le coût opérationnel)\n",
  );
}
