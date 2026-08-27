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
/*
 * `illisible` is optional and exists because the honest answer to "what did you find?" has
 * three values, not two. `lire()` returning `null` means *nothing was saved yet*; a string
 * that will not parse means *something was saved and I cannot read it*, which is a
 * different situation and the one where starting fresh destroys work. Without a way to say
 * so, the queue answered both with an empty state and the next `sauver()` overwrote the
 * file. Whoever plugs the persistence in decides what to do about it — the queue still
 * knows nothing about filesystems.
 */
export type Persistance = {
  lire(): string | null;
  ecrire(contenu: string): void;
  illisible?(raison: string, contenu: string): void;
};

let persistance: Persistance = { lire: () => null, ecrire: () => {} };

export function brancherPersistance(p: Persistance): void {
  persistance = p;
}

/**
 * WHAT A SETTING MUST LOOK LIKE — ONCE, FOR EVERY DOOR THAT LETS ONE IN.
 *
 * `serveur.ts` carries a long note about why `reglerSeuil(Number(seuil))` validates nothing:
 * the coercion runs first, and `Number(null)`, `Number("")`, `Number([])` and `Number(false)`
 * are all `0`, which the clamp then lifts to the *bottom* of the range — the least cautious
 * setting the tool offers, reached by every spelling of "no value", silently, with a success.
 * `Boolean("false")` is `true`, so the string a form field gives you switches the reference on.
 *
 * That note describes a fix that was applied to exactly one of the three doors. The browser
 * shim in `pages.ts` — which is what a visitor to the hosted demo actually runs — still had
 * `reglerSeuil(Number(corps.seuil))` and `basculerReferentiel(Boolean(corps.actif))`, and no
 * check at all on the decision or the file id that the server answers with a 400. The saved
 * state on disk was a third door, closed just above.
 *
 * A guard written out once per door is a guard that will be fixed once per door. These live
 * here because `file.ts` is the one module all three already import — the server, the shim
 * (`tsconfig.web.json` compiles this file to `docs/js/file.js`), and the queue itself.
 *
 * They answer `undefined` rather than a default. A validator with a fallback is the same
 * defect wearing a different hat: it still turns "no value" into a value.
 */
export const nombreRecu = (x: unknown): number | undefined =>
  (typeof x === "number" && Number.isFinite(x)) ? x : undefined;

export const booleenRecu = (x: unknown): boolean | undefined =>
  (typeof x === "boolean" ? x : undefined);

export const DECISIONS: ReadonlySet<Decision> = new Set<Decision>(["approuver", "complement", "escalader"]);

export const decisionRecue = (x: unknown): Decision | undefined =>
  (typeof x === "string" && DECISIONS.has(x as Decision)) ? (x as Decision) : undefined;

/**
 * Une fonction, pas une constante.
 *
 * A shared object gets modified by the first caller and the next one inherits the damage.
 * That trap already cost a whole session on the previous project.
 */
const vide = (): Etat => ({ seuil: 0.7, referentielActif: true, reprises: [] });

/**
 * The range the threshold may take, in one place.
 *
 * It was written out twice — once in `reglerSeuil`, once nowhere at all, which is how a
 * value from disk got to sit outside it. A bound copied into two branches asserts that both
 * branches are asking the same question; here they are, so they read the same pair.
 */
export const SEUIL_MIN = 0.3;
export const SEUIL_MAX = 0.99;
const borner = (v: number) => Math.min(SEUIL_MAX, Math.max(SEUIL_MIN, v));

/**
 * A FOURTH SITUATION — AND THE GUARD WAS ON THE OTHER DOOR.
 *
 * `demarrer` distinguished three cases: nothing saved, saved and unreadable, saved and
 * fine. There is a fourth, and it is the quiet one: saved, *parses*, and holds the wrong
 * types. `{ ...vide(), ...JSON.parse(brut) }` spreads whatever came back over the defaults
 * without looking at it.
 *
 * Measured on this repository, 400 files, before the fix — every one of these was accepted
 * in silence, with `illisible` never called:
 *
 *   {"seuil":"abc"}                → threshold escalation switched OFF entirely: 167 files
 *                                    still escalate by rule, `parLeSeuil` drops to 0, and
 *                                    the screen shows a threshold of "abc". Every `c < seuil`
 *                                    against a non-numeric string is false, so the one
 *                                    mechanism this tool is about stops running, silently.
 *   {"seuil":5}                    → outside [0.3, 0.99]; all 400 files escalate.
 *   {"referentielActif":"false"}   → a truthy string: the reference stays ON while the
 *                                    saved state says off.
 *   {"reprises":null}              → throws on every route, 500 across the board.
 *
 * The sharp part: the HTTP routes reject all four of these with a 400, and say why — see
 * the `nombre`/`booleen` block in `serveur.ts`. The same values arriving from disk went
 * straight in. One door was bolted and the other left open, in the same tool, for the same
 * four spellings.
 *
 * A state we cannot read is a state we cannot read, whichever way it fails to parse. This
 * routes the wrong-shaped one through `illisible` too, so the operator's file is copied
 * aside before anything overwrites it — the machinery for that already exists.
 */
function reproche(x: unknown): string | null {
  if (x === null || typeof x !== "object" || Array.isArray(x)) {
    return `l'état enregistré n'est pas un objet : ${JSON.stringify(x)}`;
  }
  const e = x as Record<string, unknown>;
  if ("seuil" in e && !(typeof e.seuil === "number" && Number.isFinite(e.seuil))) {
    return `seuil n'est pas un nombre : ${JSON.stringify(e.seuil)}`;
  }
  if ("referentielActif" in e && typeof e.referentielActif !== "boolean") {
    return `referentielActif n'est pas un booléen : ${JSON.stringify(e.referentielActif)}`;
  }
  if ("reprises" in e && !Array.isArray(e.reprises)) {
    return `reprises n'est pas une liste : ${JSON.stringify(e.reprises)}`;
  }
  /* An entry that is not an object is read as `undefined` everywhere it is used, except
     `null`, which throws. Neither is a human decision; both mean the file is not what it
     claims to be. */
  if (Array.isArray(e.reprises)) {
    const i = e.reprises.findIndex((r) => r === null || typeof r !== "object" || Array.isArray(r));
    if (i !== -1) return `reprises[${i}] n'est pas une décision : ${JSON.stringify(e.reprises[i])}`;
  }
  return null;
}

let etat: Etat = vide();
let cas: Cas[] = [];

export function demarrer(combien = 400): void {
  cas = genererCas(combien);
  const brut = persistance.lire();
  if (brut === null) { etat = vide(); return; }
  try {
    const lu: unknown = JSON.parse(brut);
    const grief = reproche(lu);
    if (grief !== null) {
      /* Parsed, and still not readable. Same answer as unparseable: name it, keep it. */
      persistance.illisible?.(grief, brut);
      etat = vide();
      return;
    }
    etat = { ...vide(), ...(lu as Partial<Etat>) };
    /* A number out of range is a number: it is clamped, exactly as `reglerSeuil` clamps it.
       What is refused above is a value that is not a number at all. */
    etat.seuil = borner(etat.seuil);
  } catch (e) {
    /* Saved, and unreadable. Not the same as never saved — say which one it was. */
    persistance.illisible?.((e as Error).message, brut);
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
  etat.seuil = borner(valeur);
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

  /*
   * La distribution des confiances, et ce que le seuil y découpe.
   *
   * L'écran disait « 400 dossiers » sans jamais les montrer. Le curseur bougeait, deux
   * nombres changeaient, et rien ne disait *lesquels* traversaient. Surtout, rien ne
   * montrait ce que le curseur ne peut pas déplacer : les escalades imposées par une règle
   * certaine, qui restent là quel que soit le seuil. C'est la seule figure de cet écran où
   * ça se voit — et c'est précisément ce qui empêche de conclure « l'outil est cassé »
   * quand on tire le curseur d'un bout à l'autre sans grand effet.
   *
   * Les bandes sont calculées au seuil courant, donc recalculées à chaque appel : c'est
   * le déplacement de la partie hachurée qui porte la démonstration.
   */
  const PAS = 0.05, BAS = 0.30;
  const nBandes = Math.round((1 - BAS) / PAS);
  const distribution = Array.from({ length: nBandes }, (_, i) => ({
    de: Number((BAS + i * PAS).toFixed(2)),
    a: Number((BAS + (i + 1) * PAS).toFixed(2)),
    total: 0, escalades: 0,
  }));
  for (const l of lignes) {
    /*
     * La bande se trouve par comparaison, pas par division.
     *
     * `Math.floor((0.70 - 0.30) / 0.05)` vaut 7 et non 8 : la soustraction donne
     * 0.39999999999999997. Les treize dossiers dont la confiance vaut exactement le seuil
     * se rangeaient donc *sous* la ligne tout en n'étant pas escaladés — la figure aurait
     * montré, à gauche du seuil, des dossiers que l'agent décide seul. Exactement ce
     * qu'elle est là pour démentir.
     */
    const b = distribution.find((d) => l.verdict.confiance < d.a) ?? distribution[nBandes - 1]!;
    b.total++;
    if (l.verdict.decision === "escalader") b.escalades++;
  }

  return {
    seuil: etat.seuil,
    referentielActif: etat.referentielActif,
    distribution,
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
