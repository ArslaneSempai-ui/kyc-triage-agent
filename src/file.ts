/**
 * La file de revue, et ce qu'un humain en fait.
 *
 * Escalation is worthless if the human decision falls into a void. Every override is
 * recorded with its reason: that is the only material which will one day support "the
 * agent is systematically wrong here" rather than "the analysts are complaining".
 *
 * Nothing leaves the machine. The state fits in one file.
 */

import { genererCas } from "./cas.ts";
import { trier } from "./agent.ts";
import { REFERENTIEL_SECTORIEL } from "./referentiel.ts";
import { mesurer } from "./mesurer.ts";
import type { Cas, Decision } from "./cas.ts";
import type { Verdict } from "./agent.ts";

export type Reprise = {
  cas: string;
  /** Ce que l'agent proposait avant la main humaine. */
  propose: Decision;
  retenue: Decision;
  motif: string;
  le: string;
};

type Etat = {
  seuil: number;
  referentielActif: boolean;
  reprises: Reprise[];
};

/**
 * Where the queue is kept, decided by whoever runs it.
 *
 * This module used to import `node:fs` and write one file. That made the review queue —
 * pure in-memory logic apart from two calls — impossible to load anywhere but Node, which
 * is what blocked the browser build of the hosted demo.
 *
 * Injecting the two operations costs six lines and is better design regardless: a review
 * queue has no business knowing what a filesystem is. The default keeps everything in
 * memory, which is exactly right for a demo where each visitor gets their own queue and
 * nothing survives the tab.
 */
export type Persistance = { lire(): string | null; ecrire(contenu: string): void };

let persistance: Persistance = { lire: () => null, ecrire: () => {} };

export function brancherPersistance(p: Persistance): void {
  persistance = p;
}

/**
 * Une fonction, pas une constante.
 *
 * A shared object gets modified by the first caller and the next one inherits the damage.
 * That trap already cost a whole session on the previous project.
 */
const vide = (): Etat => ({ seuil: 0.7, referentielActif: true, reprises: [] });

let etat: Etat = vide();
let cas: Cas[] = [];

export function demarrer(combien = 400): void {
  cas = genererCas(combien);
  try {
    const brut = persistance.lire();
    etat = brut === null ? vide() : { ...vide(), ...JSON.parse(brut) };
  } catch {
    etat = vide();
  }
}

function sauver(): void {
  persistance.ecrire(JSON.stringify(etat, null, 2));
}

const referentiel = () => (etat.referentielActif ? REFERENTIEL_SECTORIEL : undefined);

export type Ligne = { cas: Cas; verdict: Verdict; reprise: Reprise | null };

function ligne(c: Cas): Ligne {
  return {
    cas: c,
    verdict: trier(c, etat.seuil, referentiel()),
    reprise: etat.reprises.find((r) => r.cas === c.id) ?? null,
  };
}

/** La file : ce que l'agent n'a pas voulu trancher, et qu'un humain n'a pas encore vu. */
export function fileDAttente(limite = 25): Ligne[] {
  return cas
    .map(ligne)
    .filter((l) => l.verdict.decision === "escalader" && !l.reprise)
    // Least certain first: that is where a human opinion is worth the most.
    .sort((a, b) => a.verdict.confiance - b.verdict.confiance)
    .slice(0, limite);
}

export function traitees(limite = 20): Ligne[] {
  return etat.reprises
    .slice(-limite).reverse()
    .map((r) => cas.find((c) => c.id === r.cas))
    .filter((c): c is Cas => c !== undefined)
    .map(ligne);
}

export function reprendre(id: string, retenue: Decision, motif: string): Reprise {
  const c = cas.find((x) => x.id === id);
  if (!c) throw new Error(`Dossier inconnu : ${id}`);
  const v = trier(c, etat.seuil, referentiel());

  const reprise: Reprise = {
    cas: id, propose: v.decisionBrute, retenue,
    motif: motif.trim(), le: new Date().toISOString(),
  };
  etat.reprises = etat.reprises.filter((r) => r.cas !== id).concat(reprise);
  sauver();
  return reprise;
}

export function reglerSeuil(valeur: number): number {
  if (!Number.isFinite(valeur)) return etat.seuil;
  etat.seuil = Math.min(0.99, Math.max(0.3, valeur));
  sauver();
  return etat.seuil;
}

export function basculerReferentiel(actif: boolean): boolean {
  etat.referentielActif = actif;
  sauver();
  return etat.referentielActif;
}

/**
 * The headline figures.
 *
 * `accord` counts the times a human confirmed what the agent proposed. Very high agreement
 * on a large queue means the agent is escalating files it knew how to handle — costing
 * time while securing nothing.
 */
/** Below this many human decisions, an agreement rate means nothing. */
export const ASSEZ_DE_REPRISES = 10;

export function chiffres() {
  const b = mesurer(cas, etat.seuil, referentiel());
  const lignes = cas.map(ligne);
  const enFile = lignes.filter((l) => l.verdict.decision === "escalader" && !l.reprise).length;
  const accords = etat.reprises.filter((r) => r.retenue === r.propose).length;

  /*
   * Where the escalations actually come from.
   *
   * The slider moves only the second category. Without that split a user drags it end to
   * end, sees almost nothing move, and concludes the screen is broken — when the answer is
   * that most files are escalated by a rule that is sure of itself.
   */
  const escalades = lignes.filter((l) => l.verdict.decision === "escalader");
  const parLaRegle = escalades.filter((l) => !l.verdict.escalade).length;
  const parLeSeuil = escalades.length - parLaRegle;

  return {
    seuil: etat.seuil,
    referentielActif: etat.referentielActif,
    total: b.total,
    automatises: b.automatises,
    tauxAutomatisation: b.tauxAutomatisation,
    precisionAutomatisee: b.precisionAutomatisee,
    manquements: b.manquements,
    escaladesInutiles: b.escaladesInutiles,
    enFile,
    parLaRegle,
    parLeSeuil,
    reprises: etat.reprises.length,
    accords,
    assezDeReprises: etat.reprises.length >= ASSEZ_DE_REPRISES,
    manquePourConclure: Math.max(0, ASSEZ_DE_REPRISES - etat.reprises.length),
    tauxAccord: etat.reprises.length === 0 ? null : accords / etat.reprises.length,
  };
}

/** Start from an empty queue — useful between demonstrations. */
export function reinitialiser(): void {
  etat.reprises = [];
  sauver();
}

export const lireCas = () => cas;
