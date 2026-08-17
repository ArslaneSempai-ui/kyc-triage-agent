/**
 * La file de revue, et ce qu'un humain en fait.
 *
 * L'escalade ne sert à rien si la décision humaine tombe dans le vide. Chaque reprise
 * est enregistrée avec son motif : c'est la seule matière qui permettra un jour de dire
 * « l'agent se trompe systématiquement ici » plutôt que « les analystes râlent ».
 *
 * Rien ne sort de la machine. L'état tient dans un fichier.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { genererCas } from "./cas.ts";
import { trier } from "./agent.ts";
import { REFERENTIEL_SECTORIEL } from "./referentiel.ts";
import { mesurer } from "./mesurer.ts";
import type { Cas, Decision } from "./cas.ts";
import type { Verdict } from "./agent.ts";

const FICHIER = new URL("../data/etat.json", import.meta.url).pathname;

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
 * Une fonction, pas une constante.
 *
 * Un objet partagé se fait modifier par le premier appelant et le suivant hérite des
 * dégâts. Le piège a déjà coûté une session entière sur le projet précédent.
 */
const vide = (): Etat => ({ seuil: 0.7, referentielActif: true, reprises: [] });

let etat: Etat = vide();
let cas: Cas[] = [];

export function demarrer(combien = 400): void {
  cas = genererCas(combien);
  try {
    etat = { ...vide(), ...JSON.parse(readFileSync(FICHIER, "utf8")) };
  } catch {
    etat = vide();
  }
}

function sauver(): void {
  mkdirSync(dirname(FICHIER), { recursive: true });
  writeFileSync(FICHIER, JSON.stringify(etat, null, 2));
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
    // Le plus incertain d'abord : c'est là que l'avis humain vaut le plus cher.
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
 * Les chiffres de tête.
 *
 * `accord` compte les fois où l'humain a confirmé ce que l'agent proposait. Un accord
 * très haut sur une file volumineuse signifie que l'agent escalade des dossiers qu'il
 * savait traiter — c'est-à-dire qu'il coûte du temps sans rien sécuriser.
 */
export function chiffres() {
  const b = mesurer(cas, etat.seuil, referentiel());
  const enFile = cas.map(ligne).filter((l) => l.verdict.decision === "escalader" && !l.reprise).length;
  const accords = etat.reprises.filter((r) => r.retenue === r.propose).length;

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
    reprises: etat.reprises.length,
    accords,
    tauxAccord: etat.reprises.length === 0 ? null : accords / etat.reprises.length,
  };
}

export const lireCas = () => cas;
