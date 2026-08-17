/**
 * L'agent de triage.
 *
 * Il applique la procédure, trace ce qu'il a fait, et — c'est tout l'objet du projet —
 * s'arrête quand il n'est pas sûr.
 *
 * Il n'est volontairement PAS une copie de la vérité terrain. Un agent qui réimplémente
 * exactement le barème qui le note obtient 100 % et ne démontre rien. Celui-ci travaille
 * comme une implémentation réelle : il connaît la procédure, pas le jugement de
 * l'analyste. Il ignore les volumes typiques par secteur et se rabat sur un seuil
 * générique — approximation banale, et source d'erreurs mesurables.
 */

import { PAYS_A_RISQUE, PAYS_SOUS_SURVEILLANCE, piecesRequises } from "./cas.ts";
import { MULTIPLE_ANORMAL, netteteVolume, PRUDENCE } from "./referentiel.ts";
import { REGULATIONS } from "./regulations.ts";
import type { RegulationKey } from "./regulations.ts";
import type { Referentiel } from "./referentiel.ts";
import type { Cas, Decision } from "./cas.ts";

/** Un texte dans les deux langues. Le moteur ne produit pas d'affichage : il produit
 *  les deux versions, et l'écran choisit. Une phrase fabriquée côté serveur dans une
 *  seule langue est un défaut d'architecture, pas un oubli de traduction. */
export type Bilingue = { fr: string; en: string };

export type Regle = {
  code: string;
  /**
   * The regulation this rule enforces, or `null` where it enforces an internal control
   * rather than a rule of law.
   *
   * The clauses used to be invented — `PR-101 §5` was a label chosen so that decisions
   * would cite *something*. A reader could not check one of them. They are real citations
   * now, and `null` is an honest answer where no regulation is being applied: a file
   * being incomplete is a bank's own control, not a legal requirement.
   */
  regulation: RegulationKey | null;
  /** La clause appliquée. Sans elle, la décision est indéfendable. */
  clause: Bilingue;
  constat: Bilingue;
  impose: Decision;
  /**
   * Netteté du déclenchement, de 0 à 1.
   *
   * Une règle peut être formellement vraie tout en reposant sur une observation floue.
   * « Correspondance sanction à 0,58 » déclenche la même règle que « à 0,97 » et ne
   * mérite pas la même confiance. Confondre les deux est l'erreur qui rend une
   * automatisation dangereuse.
   */
  nettete: number;
};

export type Verdict = {
  cas: string;
  decision: Decision;
  /** Ce que l'agent aurait décidé seul, avant la règle d'escalade. */
  decisionBrute: Decision;
  confiance: number;
  escalade: boolean;
  /** Les nombres, pas la phrase : c'est l'écran qui la formule, dans sa langue. */
  motifEscalade: { confiance: number; seuil: number } | null;
  regles: Regle[];
};

/**
 * The numbers in this agent that are mine and nobody else's.
 *
 * None of them is imposed by any regulation. A sanctions match is a number between 0 and 1
 * produced by whatever screening engine a bank runs, and where to cut it is the bank's
 * decision. What counts as an abnormal multiple of a sector norm is nobody's published
 * figure. I chose all five by judgement.
 *
 * They are a parameter rather than five module constants for one reason: the sweep in
 * `sensibilite.ts` has to be able to move them and report which of them the results
 * actually rest on. A constant chosen by judgement that turns out to decide nothing is
 * fine; one that decides the outcome needs a better reason than my judgement, and until
 * they could be moved there was no way to tell the two apart.
 */
export type Constantes = {
  /** Above this, a screening match is treated as unambiguous. */
  seuilSanctionCertain: number;
  /** Below this, a screening match is not looked at at all. */
  seuilSanctionDoute: number;
  /** The flat ceiling used only where no sector reference is available. */
  volumeEleve: number;
  /** Multiple of the sector norm above which a declared volume is examined. */
  multipleAnormal: number;
  /** The margin taken against the reference table being wrong — see `referentiel.ts`. */
  prudence: number;
};

export const CONSTANTES: Constantes = {
  seuilSanctionCertain: 0.85,
  seuilSanctionDoute: 0.55,
  volumeEleve: 1_500_000,
  multipleAnormal: MULTIPLE_ANORMAL,
  prudence: PRUDENCE,
};

const RANG: Record<Decision, number> = { approuver: 0, complement: 1, escalader: 2 };

function appliquer(c: Cas, referentiel?: Referentiel, k: Constantes = CONSTANTES): Regle[] {
  const regles: Regle[] = [];

  const s = c.criblage.correspondanceSanction;
  if (s >= k.seuilSanctionDoute) {
    regles.push({
      code: "R-SANCT", regulation: "sarThreshold",
      clause: { fr: "31 CFR 1020.320(a)(2) — une opération suspecte de 5 000 $ ou plus est déclarée",
                en: "31 CFR 1020.320(a)(2) — a suspicious transaction of $5,000 or more must be reported" },
      constat: { fr: `Correspondance liste de sanctions à ${s.toFixed(2)}`,
                 en: `Sanctions-list match at ${s.toFixed(2)}` },
      impose: "escalader",
      // Nette aux extrêmes, floue au milieu : c'est la zone des homonymes.
      nettete: s >= k.seuilSanctionCertain ? 0.95 : (s - k.seuilSanctionDoute) / Math.max(1e-6, k.seuilSanctionCertain - k.seuilSanctionDoute) * 0.5 + 0.2,
    });
  }

  const p = c.criblage.correspondancePep;
  if (p >= k.seuilSanctionCertain) {
    regles.push({
      code: "R-PEP", regulation: "identificationTiming",
      clause: { fr: "31 CFR 1010.230(a) — l'identification se fait à l'ouverture du compte",
                en: "31 CFR 1010.230(a) — identification is performed at account opening" },
      constat: { fr: `Correspondance PPE à ${p.toFixed(2)}`, en: `PEP match at ${p.toFixed(2)}` },
      impose: "escalader",
      nettete: 0.9,
    });
  }

  if (PAYS_A_RISQUE.has(c.paysResidence)) {
    regles.push({
      code: "R-PAYS", regulation: null,
      clause: { fr: "Contrôle interne — résidence dans une juridiction à haut risque",
                en: "Internal control — residence in a high-risk jurisdiction" },
      constat: { fr: `Pays de résidence : ${c.paysResidence}`, en: `Country of residence: ${c.paysResidence}` },
      impose: "escalader",
      nettete: 1,
    });
  }

  const risque = c.activite.paysOperation.filter((x) => PAYS_A_RISQUE.has(x));
  if (risque.length > 0) {
    regles.push({
      code: "R-FLUX", regulation: null,
      clause: { fr: "Contrôle interne — flux déclarés vers une juridiction à haut risque",
                en: "Internal control — declared flows to a high-risk jurisdiction" },
      constat: { fr: `Pays d'opération : ${risque.join(", ")}`, en: `Countries of operation: ${risque.join(", ")}` },
      impose: "escalader",
      nettete: 1,
    });
  }

  for (const attendue of piecesRequises(c.type)) {
    const piece = c.pieces.find((x) => x.type === attendue);
    if (!piece || !piece.fournie) {
      regles.push({
        code: "R-PIECE", regulation: null,
        clause: { fr: "Contrôle interne — le dossier est complet avant toute décision",
                  en: "Internal control — the file is complete before any decision" },
        constat: { fr: `Pièce absente : ${attendue}`, en: `Missing document: ${attendue}` },
        impose: "complement", nettete: 1,
      });
      continue;
    }
    if (!piece.lisible) {
      regles.push({
        code: "R-LISIB", regulation: null, clause: { fr: "Contrôle interne — une pièce illisible est réputée non fournie",
                  en: "Internal control — an unreadable document counts as not provided" },
        constat: { fr: `Pièce illisible : ${attendue}`, en: `Unreadable document: ${attendue}` }, impose: "complement",
        // L'agent ne voit qu'un indicateur binaire ; le caractère lisible est un jugement.
        nettete: 0.7,
      });
    }
    if (piece.expireDans !== null && piece.expireDans <= 0) {
      regles.push({
        code: "R-EXPIR", regulation: null, clause: { fr: "Contrôle interne — une pièce d'identité expirée n'est pas recevable",
                  en: "Internal control — an expired identity document is not acceptable" },
        constat: { fr: `${attendue} expirée depuis ${Math.abs(piece.expireDans)} mois`,
                   en: `${attendue} expired ${Math.abs(piece.expireDans)} months ago` },
        impose: "complement", nettete: 1,
      });
    }
    if (!piece.nomConcorde) {
      regles.push({
        code: "R-NOM", regulation: null, clause: { fr: "Contrôle interne — le nom porté par la pièce correspond au nom déclaré",
                  en: "Internal control — the name on the document matches the declared name" },
        constat: { fr: `Nom discordant sur : ${attendue}`, en: `Name mismatch on: ${attendue}` }, impose: "complement", nettete: 0.85,
      });
    }
  }

  if (c.type === "societe") {
    const couvert = c.beneficiaires.filter((b) => b.identifie).reduce((s2, b) => s2 + b.part, 0);
    const gros = c.beneficiaires.filter((b) => b.part >= 25 && !b.identifie);
    if (gros.length > 0) {
      regles.push({
        code: "R-BE25", regulation: "beneficialOwnership", clause: { fr: "31 CFR 1010.230(d)(1) — tout détenteur de 25 % ou plus du capital est identifié",
                  en: "31 CFR 1010.230(d)(1) — every holder of 25 % or more of the equity is identified" },
        constat: { fr: `${gros.length} bénéficiaire(s) au-dessus de 25 % non identifié(s)`,
                   en: `${gros.length} beneficial owner(s) above 25 % not identified` },
        impose: "complement", nettete: 1,
      });
    } else if (couvert < 75) {
      regles.push({
        code: "R-BECOUV", regulation: "controlPerson", clause: { fr: "31 CFR 1010.230(d)(2) — une personne exerçant le contrôle est identifiée en plus des détenteurs",
                  en: "31 CFR 1010.230(d)(2) — one individual exercising control is identified besides the owners" },
        constat: { fr: `Détention identifiée : ${couvert} %`, en: `Ownership identified: ${couvert} %` },
        impose: "complement", nettete: 0.8,
      });
    }
  }

  const volume = c.activite.volumeAnnuelDeclare;
  // Every comparison against the reference takes the margin: the table is known to be
  // wrong in both directions, and only one of them is cheap.
  const normeBrute = referentiel?.get(c.activite.secteur);
  const norme = normeBrute === undefined ? undefined : normeBrute * k.prudence;
  if (norme === undefined) {
    // Sans référentiel, l'agent ne sait pas si ce volume est anormal ou banal pour ce
    // métier. Il le signale quand même, et le dit avec une netteté faible : c'est la
    // confiance qui doit porter l'ignorance, pas la décision.
    if (volume > k.volumeEleve) {
      regles.push({
        code: "R-VOL", regulation: "currencyReport",
        clause: { fr: "31 CFR 1010.311 — les opérations en espèces au-delà de 10 000 $ sont déclarées",
                  en: "31 CFR 1010.311 — currency transactions above $10,000 are reported" },
        constat: { fr: `Volume annuel déclaré : ${volume.toLocaleString("fr-FR")} €`,
                   en: `Declared annual volume: €${volume.toLocaleString("en-GB")}` },
        impose: "escalader", nettete: 0.35,
      });
    }
  } else {
    const rapport = volume / norme;
    if (rapport >= k.multipleAnormal) {
      regles.push({
        code: "R-VOL", regulation: "currencyReport",
        clause: { fr: "31 CFR 1010.311 — les opérations en espèces au-delà de 10 000 $ sont déclarées",
                  en: "31 CFR 1010.311 — currency transactions above $10,000 are reported" },
        constat: { fr: `${volume.toLocaleString("fr-FR")} € déclarés, soit ${rapport.toFixed(1)}× l'usage du secteur « ${c.activite.secteur} »`,
                   en: `€${volume.toLocaleString("en-GB")} declared, ${rapport.toFixed(1)}× the norm for “${c.activite.secteur}”` },
        impose: "escalader", nettete: netteteVolume(rapport, k.multipleAnormal),
      });
    }
  }

  /*
   * The jurisdiction rule reasons in multiples of the sector, not in absolute euros.
   *
   * It used a flat €750,000 floor, and the failure gallery showed what that cost. The
   * single breach in four hundred files — C-0250, a restaurant declaring €694,330 with
   * operations into a monitored jurisdiction — sat just under that floor, so no rule
   * fired at all and the agent approved on an absence of grounds. The same flat floor
   * also made this rule the largest single source of wasted escalations.
   *
   * One rule, both kinds of damage — and it is the defect already fixed once for the
   * volume rule and never carried across. A threshold in absolute currency is wrong in
   * both directions the moment sectors differ.
   */
  const surveilles = c.activite.paysOperation.filter((x) => PAYS_SOUS_SURVEILLANCE.has(x));
  const normeSecteur = normeBrute === undefined ? undefined : normeBrute * k.prudence;
  const volumeSignificatif = normeSecteur !== undefined
    ? c.activite.volumeAnnuelDeclare > normeSecteur * 2
    : c.activite.volumeAnnuelDeclare > k.volumeEleve / 2;

  if (surveilles.length > 0 && volumeSignificatif) {
    regles.push({
      code: "R-JURID", regulation: null, clause: { fr: "Contrôle interne — juridiction sous surveillance combinée à un volume significatif",
                en: "Internal control — monitored jurisdiction combined with a significant volume" },
      constat: { fr: `Opérations vers ${surveilles.join(", ")}`, en: `Operations into ${surveilles.join(", ")}` },
      impose: "escalader", nettete: 0.5,
    });
  }

  return regles;
}

/**
 * La confiance.
 *
 * Deux choses seulement, et elles ne se remplacent pas : la netteté de ce qui a été
 * observé, et le fait qu'aucune règle n'ait laissé de doute derrière elle. Un dossier
 * sans aucune règle déclenchée est le cas le plus délicat — l'agent doit distinguer
 * « rien à signaler » de « je n'ai rien su regarder ».
 */
function confiance(regles: Regle[], decision: Decision): number {
  if (regles.length === 0) {
    // Aucune règle : la décision est « approuver » par absence de motif. Solide, mais
    // jamais totale — c'est une conclusion tirée d'un silence.
    return 0.8;
  }
  const decisives = regles.filter((r) => r.impose === decision);
  if (decisives.length === 0) return 0.3;

  // La règle la plus nette porte la décision ; les autres la confortent un peu.
  const meilleure = Math.max(...decisives.map((r) => r.nettete));
  const appui = Math.min(0.1, (decisives.length - 1) * 0.04);

  // Une règle floue qui pousse vers une décision PLUS grave que celle retenue est un
  // désaccord interne : la confiance doit en souffrir.
  const contradictions = regles.filter((r) => r.impose !== decision && r.nettete < 0.6).length;
  return Math.max(0, Math.min(1, meilleure + appui - contradictions * 0.12));
}

/**
 * Décider — ou passer la main.
 *
 * `seuil` est la frontière humaine : en dessous, l'agent ne tranche pas. C'est le seul
 * réglage qui compte, et il appartient au métier, pas à celui qui écrit le code.
 */
export function trier(c: Cas, seuil = 0.7, referentiel?: Referentiel, k: Constantes = CONSTANTES): Verdict {
  const regles = appliquer(c, referentiel, k);

  // La décision la plus grave l'emporte. Réclamer une pièce à quelqu'un qui ressort
  // d'une liste de sanctions revient à l'avertir.
  const brute: Decision = regles.length === 0
    ? "approuver"
    : regles.reduce((pire, r) => (RANG[r.impose] > RANG[pire] ? r.impose : pire), "approuver" as Decision);

  const c0 = confiance(regles, brute);
  const sousLeSeuil = c0 < seuil;

  return {
    cas: c.id,
    decision: sousLeSeuil ? "escalader" : brute,
    decisionBrute: brute,
    confiance: Number(c0.toFixed(3)),
    escalade: sousLeSeuil,
    motifEscalade: sousLeSeuil ? { confiance: Number(c0.toFixed(2)), seuil } : null,
    regles,
  };
}
