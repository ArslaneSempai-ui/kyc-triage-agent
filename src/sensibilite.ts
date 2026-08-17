/**
 * Which of my own constants decide the outcome.
 *
 * Five numbers in this repository have no authority behind them. No regulation says where
 * a screening match becomes certain, what multiple of a sector norm is abnormal, or how
 * much margin to take against a reference table that is known to be approximate. I chose
 * all five by judgement, and until now the tool published results without ever saying
 * which of those judgements the results rested on.
 *
 * Two costs are tracked separately, because they are not the same cost:
 *
 *   a breach            — decided alone when the file had to go up. Regulatory price.
 *   a wasted escalation — sent to an analyst for nothing. Operational price.
 *
 * A single "accuracy" number averages those two together and hides the only one that
 * carries a fine. So a constant is judged on breaches first.
 *
 * ---
 *
 * The first version of this file swept one draw of files and reported the first value at
 * which the breach count moved. Four constants out of five came back "decides the
 * expensive error", every one of them on a move from 0 breaches to 1 in 1,200 files. That
 * is not a finding, it is a coin landing — a different seed puts the edge somewhere else,
 * and a reader told that everything is decisive has been told nothing.
 *
 * It is the same error caught once already on the other side, where a 2 ms difference was
 * published as "+1416 %": a threshold with only one of the two tests it needs. So the
 * sweep now runs over five independent draws and asks two questions that were previously
 * one:
 *
 *   does it cost?    — how many draws lose files at the far end of the plausible range
 *   where?           — how many draws agree on the value at which the loss starts
 *
 * Three of the five constants answer yes to the first and no to the second. That is a
 * real and awkward result: they matter, and this measurement cannot tell you where to set
 * them. Collapsing the two questions into one verdict would have to lie in one direction
 * or the other, and the comfortable lie is available in both.
 *
 * ---
 *
 * The last verdict is the one nobody gets. A constant can be inert here and decisive
 * elsewhere — `volumeEleve` is only consulted where no sector reference exists, so with a
 * complete table it does nothing at all and without one it moves breaches from 0 to 23 per
 * 800 files. Reporting that as "no effect" would send a reader away from the one number
 * they will need the moment their reference table has a hole in it. It is reported as
 * dormant instead, and the bug that made it read "no effect" for a while is documented at
 * the call site rather than quietly fixed.
 *
 * The reference-error sweep at the bottom is the older idea and is kept: it answers a
 * different question — not "does my constant decide" but "how wrong may the data be".
 */

import { genererCas } from "./cas.ts";
import { mesurer } from "./mesurer.ts";
import { REFERENTIEL_SECTORIEL } from "./referentiel.ts";
import { CONSTANTES } from "./agent.ts";
import type { Constantes } from "./agent.ts";
import type { Cas } from "./cas.ts";
import type { Referentiel } from "./referentiel.ts";

/** The same table, every row multiplied by `facteur`. */
export function fausser(facteur: number): Referentiel {
  const faussé: Referentiel = new Map();
  for (const [secteur, valeur] of REFERENTIEL_SECTORIEL) faussé.set(secteur, valeur * facteur);
  return faussé;
}

/* ── which of my constants decide anything ───────────────────────── */

export type Reglage = keyof Constantes;

/**
 * The range each constant could plausibly take.
 *
 * These are not confidence intervals. They are the range over which a competent person
 * could disagree with me without being wrong, which is the only range worth sweeping.
 */
export const PLAUSIBLE: Record<Reglage, [number, number]> = {
  // Vendors publish match scores on scales that do not agree with each other.
  seuilSanctionCertain: [0.70, 0.98],
  // Below 0.30 every common surname matches something; above 0.80 nothing ambiguous is
  // ever looked at, which is the failure the whole escalation thesis is about.
  seuilSanctionDoute: [0.30, 0.80],
  // A flat ceiling: a small institution might set it at €400k, a large one at €5M.
  volumeEleve: [400_000, 5_000_000],
  multipleAnormal: [2, 8],
  // 1.00 means trusting the table exactly as published. Below 0.70 the margin exceeds the
  // table's own error and the reference stops being a reference.
  prudence: [0.70, 1.00],
};

/** What no source says about each of them. Written down so it cannot be quietly forgotten. */
export const AVEU: Record<Reglage, string> = {
  seuilSanctionCertain: "no regulation says where a screening match becomes certain",
  seuilSanctionDoute: "nor where it becomes worth a second look",
  volumeEleve: "a flat ceiling, used only where no sector reference exists",
  multipleAnormal: "no source defines an abnormal multiple of a sector norm",
  prudence: "derived from the largest observed reference error, not from the outcome",
};

/** Five independent draws. One draw cannot tell a threshold from a coincidence. */
export const GRAINES = [20260817, 771, 4242, 90210, 130767];
const PAR_TIRAGE = 800;

export function tirages(combien = PAR_TIRAGE, graines = GRAINES): Cas[][] {
  return graines.map((g) => genererCas(combien, g));
}

/**
 * Materiality on wasted escalations, in both directions at once.
 *
 * Relative alone is how you end up publishing "+1416 %" on a difference of two files;
 * absolute alone is how a 3-file move in an 800-file sample gets called stable. A move
 * counts only if it clears both.
 */
const MATERIEL_RELATIF = 0.05;
const MATERIEL_ABSOLU = 3;

export function materiel(reference: number, obtenu: number): boolean {
  const ecart = Math.abs(obtenu - reference);
  return ecart > MATERIEL_ABSOLU && ecart > reference * MATERIEL_RELATIF;
}

export type Bande = {
  reglage: Reglage;
  valeur: number;
  /** Breaches per draw at the value in use, averaged. */
  manquements: number;
  escaladesInutiles: number;
  /** The range over which not one draw changes its breach count. */
  deManquements: [number, number];
  /** The range over which no draw changes its wasted escalations materially. */
  dEscalades: [number, number];
  /**
   * How many draws out of five see the breach count move at the first value outside the
   * band. One out of five is a coincidence; five out of five is a threshold.
   */
  accord: number;
  /**
   * How many draws see a different breach count at the worse end of the plausible range.
   *
   * This is a separate question from `accord` and conflating them was the second error in
   * this file. `seuilSanctionDoute` has an edge only one draw in five can locate — and
   * costs 22.8 breaches per 800 files at the top of its range, in every draw. "Where it
   * starts costing is under the noise" and "it does not cost" are opposite statements,
   * and the first version printed the second.
   */
  accordExtreme: number;
  /** Mean breaches per draw at each end of the plausible range — the magnitude, not just the edge. */
  auxExtremes: [number, number];
  /**
   * The same figure with the sector table taken away.
   *
   * A dormant constant reports 0.0 → 0.0 in the published configuration, which on a page
   * sits next to the word "decisive" and reads as a contradiction. It is not: the two
   * numbers answer different questions, and the one that makes the verdict legible is
   * this one.
   */
  auxExtremesSansTable: [number, number];
  verdict:
    | "décide les manquements"
    | "décide, frontière sous le bruit"
    | "ne coûte que du temps analyste"
    | "dormant derrière le référentiel"
    | "sans effet";
};

const moyenne = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

export function bande(
  reglage: Reglage,
  jeux = tirages(),
  seuil = 0.7,
  k: Constantes = CONSTANTES,
  pas = 30,
): Bande {
  const [bas, haut] = PLAUSIBLE[reglage];
  const valeur = k[reglage];

  /*
   * `avecTable` is a boolean rather than an optional `Referentiel`, and that is not a
   * style choice. The first version took the table as an optional parameter defaulting to
   * the real one, and the dormancy check called it as `mesures(v, undefined)` to mean
   * "run without a table" — which in JavaScript selects the default instead of overriding
   * it. Every dormancy check silently ran *with* the table.
   *
   * The symptom was a verdict, not a crash: `volumeEleve` was published as "no effect"
   * when removing the table moves it from 0 breaches to 23 in 800 files. Wrong, and in
   * the comfortable direction — the constant most worth setting was the one the tool told
   * you to ignore. Passing `undefined` to mean something can never be made safe; the
   * parameter has to be unable to express it.
   */
  const mesures = (v: number, avecTable = true) =>
    jeux.map((cas) => mesurer(cas, seuil, avecTable ? REFERENTIEL_SECTORIEL : undefined, { ...k, [reglage]: v }));

  const base = mesures(valeur);
  const baseSans = mesures(valeur, false);

  /** How many draws move, at value v. Zero means every draw agrees nothing changed. */
  const bougentManquements = (v: number) =>
    mesures(v).filter((b, i) => b.manquements !== base[i]!.manquements).length;
  const bougentEscalades = (v: number) =>
    mesures(v).filter((b, i) => materiel(base[i]!.escaladesInutiles, b.escaladesInutiles)).length;

  /* Walk outward from the value in use: what matters is how far I can be wrong, not how
   * some distant corner of the range behaves. */
  const marcher = (vers: number, combienBougent: (v: number) => number): [number, number] => {
    for (let i = 1; i <= pas; i++) {
      const v = valeur + ((vers - valeur) * i) / pas;
      const n = combienBougent(v);
      if (n > 0) return [valeur + ((vers - valeur) * (i - 1)) / pas, n];
    }
    return [vers, 0];
  };

  /* Magnitude, asked separately from location: does the far end of the range cost more
   * breaches than the value in use, in a majority of draws? */
  const pire = mesures(haut).map((b, i) => b.manquements - base[i]!.manquements);
  const pireBas = mesures(bas).map((b, i) => b.manquements - base[i]!.manquements);
  const accordExtreme = Math.max(
    pire.filter((d) => d !== 0).length,
    pireBas.filter((d) => d !== 0).length,
  );

  const [basM, accordBas] = marcher(bas, bougentManquements);
  const [hautM, accordHaut] = marcher(haut, bougentManquements);
  const [basE] = marcher(bas, bougentEscalades);
  const [hautE] = marcher(haut, bougentEscalades);

  const deManquements: [number, number] = [basM, hautM];
  const dEscalades: [number, number] = [basE, hautE];
  const accord = Math.max(accordBas, accordHaut);

  const decideManquements = basM > bas + 1e-9 || hautM < haut - 1e-9;
  const decideEscalades = basE > bas + 1e-9 || hautE < haut - 1e-9;

  /* The dormancy check: does it decide anything once the sector table is taken away?
   * A constant inert with a complete reference and decisive without one is not
   * insensitive — it is waiting for a gap in the data. */
  const dormant = [bas, haut, (bas + haut) / 2].some((v) =>
    mesures(v, false).some((b, i) =>
      b.manquements !== baseSans[i]!.manquements ||
      materiel(baseSans[i]!.escaladesInutiles, b.escaladesInutiles)),
  );

  /* The majority rule. An edge that fewer than half the draws can see is a property of
   * the sample, not of the constant, and saying otherwise is the whole error this file
   * was rewritten to stop making. */
  const solide = accord * 2 >= jeux.length;

  return {
    reglage, valeur,
    manquements: moyenne(base.map((b) => b.manquements)),
    escaladesInutiles: moyenne(base.map((b) => b.escaladesInutiles)),
    deManquements, dEscalades, accord, accordExtreme,
    auxExtremes: [
      moyenne(mesures(bas).map((b) => b.manquements)),
      moyenne(mesures(haut).map((b) => b.manquements)),
    ],
    auxExtremesSansTable: [
      moyenne(mesures(bas, false).map((b) => b.manquements)),
      moyenne(mesures(haut, false).map((b) => b.manquements)),
    ],
    verdict: decideManquements && solide ? "décide les manquements"
      : accordExtreme * 2 >= jeux.length ? "décide, frontière sous le bruit"
      : decideManquements ? "décide, frontière sous le bruit"
      : decideEscalades ? "ne coûte que du temps analyste"
      : dormant ? "dormant derrière le référentiel"
      : "sans effet",
  };
}

export function bandes(jeux = tirages(), seuil = 0.7, k: Constantes = CONSTANTES): Bande[] {
  return (Object.keys(PLAUSIBLE) as Reglage[]).map((r) => bande(r, jeux, seuil, k));
}

/** What to tell someone holding their own figure. */
export function conseil(b: Bande): string {
  const f = (x: number) => (x < 100 ? x.toFixed(2) : Math.round(x).toLocaleString("en-GB"));
  const [bas, haut] = PLAUSIBLE[b.reglage];
  const extremes = `Across the whole range the breach rate runs ${b.auxExtremes[0].toFixed(1)} (at ${f(bas)}) to ${b.auxExtremes[1].toFixed(1)} (at ${f(haut)}) per ${PAR_TIRAGE} files.`;

  switch (b.verdict) {
    case "décide les manquements":
      return `Decides the expensive error, and ${b.accord} of ${GRAINES.length} draws agree on where. No draw changes its breach count between ${f(b.deManquements[0])} and ${f(b.deManquements[1])}. ${extremes} Worth arguing about.`;
    case "décide, frontière sous le bruit":
      return `It costs breaches — ${b.accordExtreme} of ${GRAINES.length} draws lose files at the far end of the range. ${extremes} What this measurement cannot give you is *where* it starts costing: only ${b.accord} of ${GRAINES.length} draws see the edge near ${f(b.deManquements[1])}, so that number belongs to the sample. Set it on the cost, not on this edge.`;
    case "ne coûte que du temps analyste":
      return `No draw loses a file to it anywhere in ${f(bas)}–${f(haut)}; it buys and sells analyst time between ${f(b.dEscalades[0])} and ${f(b.dEscalades[1])}. An operational decision, not a compliance one.`;
    case "dormant derrière le référentiel":
      return `Changes nothing here — but only because the sector reference covers every file. Take the table away and the same sweep runs ${b.auxExtremesSansTable[0].toFixed(1)} to ${b.auxExtremesSansTable[1].toFixed(1)} breaches per ${PAR_TIRAGE} files. Add one sector the table does not list and this constant decides those files. Worth setting before that happens, not after.`;
    default:
      return `Changes nothing across ${f(bas)}–${f(haut)}, on either cost. Not worth defending in a review.`;
  }
}

/* ── how wrong the sector reference may be ───────────────────────── */

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
  const jeux = tirages();
  const f = (x: number) => (x < 100 ? x.toFixed(2) : Math.round(x).toLocaleString("en-GB"));

  console.log(
    `\nWhich of my own constants decide the outcome?` +
    `   (${GRAINES.length} draws of ${PAR_TIRAGE} files, escalation bar 0.70)\n`,
  );
  console.log("constant                in use   no draw moves over     draws   breaches, low → high end");
  console.log("─".repeat(104));

  const resultats = bandes(jeux);
  for (const b of resultats) {
    const [bas, haut] = PLAUSIBLE[b.reglage];
    const bande = b.deManquements[0] <= bas + 1e-9 && b.deManquements[1] >= haut - 1e-9
      ? "the whole range"
      : f(b.deManquements[0]) + " – " + f(b.deManquements[1]);
    console.log(
      `${b.reglage.padEnd(22)}${f(b.valeur).padStart(9)}${bande.padStart(21)}` +
      `${(b.accord + "/" + GRAINES.length).padStart(10)}   ` +
      `${b.auxExtremes[0].toFixed(1)} → ${b.auxExtremes[1].toFixed(1)} per ${PAR_TIRAGE}`,
    );
  }

  console.log("\nWhat no source says about them, and what to do with that\n");
  for (const b of resultats) {
    console.log(`  ${b.reglage} — ${b.verdict}`);
    console.log(`    ${AVEU[b.reglage]}`);
    console.log(`    ${conseil(b)}\n`);
  }

  console.log("\nHow wrong may the sector reference be before it costs something?\n");
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
