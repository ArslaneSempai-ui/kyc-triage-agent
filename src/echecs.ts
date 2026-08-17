/**
 * What the agent gets wrong, and why.
 *
 * The README has been reporting one breach and eighty-five wasted escalations for weeks
 * without ever showing which files those were. A count is a claim; a named case with the
 * rules that fired beside the decision an analyst would have made is something a reader
 * can check — and something a compliance officer can argue with.
 *
 * The breach is the one that matters. It is a single file out of four hundred, and until
 * now nobody could see what the agent missed about it.
 */

import { genererCas } from "./cas.ts";
import { trier } from "./agent.ts";
import { REFERENTIEL_SECTORIEL } from "./referentiel.ts";
import type { Cas, Decision } from "./cas.ts";
import type { Verdict } from "./agent.ts";

export type Echec = {
  cas: Cas;
  verdict: Verdict;
  attendu: Decision;
  /**
   * Which kind of wrong.
   *
   * A breach and a wasted escalation share the word "error" and not the price. Counting
   * them together hides the only one that carries a regulatory cost.
   */
  genre: "manquement" | "escalade evitable" | "complement rate";
};

export function collecter(seuil = 0.7, combien = 400): Echec[] {
  const cas = genererCas(combien);
  const echecs: Echec[] = [];

  for (const c of cas) {
    const v = trier(c, seuil, REFERENTIEL_SECTORIEL);
    if (v.decision === c.verite) continue;

    const genre: Echec["genre"] =
      // Decided alone when the file had to go up: the error with a fine attached.
      c.verite === "escalader" && v.decision !== "escalader" ? "manquement"
      // Sent to a human who had nothing to add.
      : v.decision === "escalader" ? "escalade evitable"
      : "complement rate";

    echecs.push({ cas: c, verdict: v, attendu: c.verite, genre });
  }
  return echecs;
}

/** The shape of the problem, before any example. */
export function forme(echecs: Echec[]) {
  const compte: Record<string, number> = {};
  for (const e of echecs) {
    const regles = e.verdict.regles.map((r) => r.code).sort().join("+") || "aucune regle";
    compte[`${e.genre} · ${regles}`] = (compte[`${e.genre} · ${regles}`] ?? 0) + 1;
  }
  return Object.entries(compte).sort((a, b) => b[1] - a[1]);
}

/** Reads a case out loud, the way an analyst would describe it. */
export function decrire(e: Echec, langue: "fr" | "en" = "en"): string {
  const c = e.cas;
  const lignes = [
    `${c.id} · ${c.nom} · ${c.type} · ${c.paysResidence}`,
    `  sector      ${c.activite.secteur}, ${c.activite.volumeAnnuelDeclare.toLocaleString("en-GB")} EUR declared`,
    `  screening   sanctions ${c.criblage.correspondanceSanction.toFixed(2)} · PEP ${c.criblage.correspondancePep.toFixed(2)}`,
    `  agent said  ${e.verdict.decision} (confidence ${e.verdict.confiance.toFixed(2)})`,
    `  should be   ${e.attendu}`,
  ];
  for (const r of e.verdict.regles) {
    lignes.push(`  ${r.code.padEnd(9)} ${r.constat[langue]}  [sharpness ${r.nettete.toFixed(2)}]`);
  }
  if (e.verdict.regles.length === 0) lignes.push("  no rule fired — the decision rested on an absence of grounds");
  return lignes.join("\n");
}

if (import.meta.filename === process.argv[1]) {
  const echecs = collecter();
  console.log(`\n${echecs.length} wrong decisions out of 400\n`);

  console.log("WHAT KIND OF WRONG\n");
  for (const [cle, n] of forme(echecs).slice(0, 8)) console.log(`  ${String(n).padStart(4)}  ${cle}`);

  const manquements = echecs.filter((e) => e.genre === "manquement");
  console.log(`\n\nTHE BREACH${manquements.length > 1 ? "ES" : ""} — decided alone, should have gone up\n`);
  for (const e of manquements) console.log(decrire(e) + "\n");

  const evitables = echecs.filter((e) => e.genre === "escalade evitable");
  console.log(`\nTHREE OF THE ${evitables.length} WASTED ESCALATIONS\n`);
  for (const e of evitables.slice(0, 3)) console.log(decrire(e) + "\n");
}
