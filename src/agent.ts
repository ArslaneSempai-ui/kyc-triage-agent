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
import type { Referentiel } from "./referentiel.ts";
import type { Cas, Decision } from "./cas.ts";

/** Un texte dans les deux langues. Le moteur ne produit pas d'affichage : il produit
 *  les deux versions, et l'écran choisit. Une phrase fabriquée côté serveur dans une
 *  seule langue est un défaut d'architecture, pas un oubli de traduction. */
export type Bilingue = { fr: string; en: string };

export type Regle = {
  code: string;
  /** La clause de procédure appliquée. Sans elle, la décision est indéfendable. */
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

const SEUIL_SANCTION_CERTAIN = 0.85;
const SEUIL_SANCTION_DOUTE = 0.55;
/** L'agent ne connaît pas les usages par secteur. Il applique un plafond unique. */
const VOLUME_ELEVE = 1_500_000;

const RANG: Record<Decision, number> = { approuver: 0, complement: 1, escalader: 2 };

function appliquer(c: Cas, referentiel?: Referentiel): Regle[] {
  const regles: Regle[] = [];

  const s = c.criblage.correspondanceSanction;
  if (s >= SEUIL_SANCTION_DOUTE) {
    regles.push({
      code: "R-SANCT",
      clause: { fr: "PR-415 §2 — toute correspondance avec une liste de sanctions est revue avant entrée en relation",
                en: "PR-415 §2 — every sanctions-list match is reviewed before onboarding" },
      constat: { fr: `Correspondance liste de sanctions à ${s.toFixed(2)}`,
                 en: `Sanctions-list match at ${s.toFixed(2)}` },
      impose: "escalader",
      // Nette aux extrêmes, floue au milieu : c'est la zone des homonymes.
      nettete: s >= SEUIL_SANCTION_CERTAIN ? 0.95 : (s - SEUIL_SANCTION_DOUTE) / (SEUIL_SANCTION_CERTAIN - SEUIL_SANCTION_DOUTE) * 0.5 + 0.2,
    });
  }

  const p = c.criblage.correspondancePep;
  if (p >= SEUIL_SANCTION_CERTAIN) {
    regles.push({
      code: "R-PEP",
      clause: { fr: "PR-415 §5 — une personne politiquement exposée relève de la vigilance renforcée",
                en: "PR-415 §5 — a politically exposed person requires enhanced due diligence" },
      constat: { fr: `Correspondance PPE à ${p.toFixed(2)}`, en: `PEP match at ${p.toFixed(2)}` },
      impose: "escalader",
      nettete: 0.9,
    });
  }

  if (PAYS_A_RISQUE.has(c.paysResidence)) {
    regles.push({
      code: "R-PAYS",
      clause: { fr: "PR-101 §7 — résidence dans une juridiction à haut risque",
                en: "PR-101 §7 — residence in a high-risk jurisdiction" },
      constat: { fr: `Pays de résidence : ${c.paysResidence}`, en: `Country of residence: ${c.paysResidence}` },
      impose: "escalader",
      nettete: 1,
    });
  }

  const risque = c.activite.paysOperation.filter((x) => PAYS_A_RISQUE.has(x));
  if (risque.length > 0) {
    regles.push({
      code: "R-FLUX",
      clause: { fr: "PR-101 §7 — flux déclarés vers une juridiction à haut risque",
                en: "PR-101 §7 — declared flows to a high-risk jurisdiction" },
      constat: { fr: `Pays d'opération : ${risque.join(", ")}`, en: `Countries of operation: ${risque.join(", ")}` },
      impose: "escalader",
      nettete: 1,
    });
  }

  for (const attendue of piecesRequises(c.type)) {
    const piece = c.pieces.find((x) => x.type === attendue);
    if (!piece || !piece.fournie) {
      regles.push({
        code: "R-PIECE",
        clause: { fr: "PR-101 §2 — le dossier est complet avant toute décision",
                  en: "PR-101 §2 — the file is complete before any decision" },
        constat: { fr: `Pièce absente : ${attendue}`, en: `Missing document: ${attendue}` },
        impose: "complement", nettete: 1,
      });
      continue;
    }
    if (!piece.lisible) {
      regles.push({
        code: "R-LISIB", clause: { fr: "PR-101 §2 — une pièce illisible est réputée non fournie",
                  en: "PR-101 §2 — an unreadable document counts as not provided" },
        constat: { fr: `Pièce illisible : ${attendue}`, en: `Unreadable document: ${attendue}` }, impose: "complement",
        // L'agent ne voit qu'un indicateur binaire ; le caractère lisible est un jugement.
        nettete: 0.7,
      });
    }
    if (piece.expireDans !== null && piece.expireDans <= 0) {
      regles.push({
        code: "R-EXPIR", clause: { fr: "PR-101 §2 — une pièce d'identité expirée n'est pas recevable",
                  en: "PR-101 §2 — an expired identity document is not acceptable" },
        constat: { fr: `${attendue} expirée depuis ${Math.abs(piece.expireDans)} mois`,
                   en: `${attendue} expired ${Math.abs(piece.expireDans)} months ago` },
        impose: "complement", nettete: 1,
      });
    }
    if (!piece.nomConcorde) {
      regles.push({
        code: "R-NOM", clause: { fr: "PR-101 §3 — le nom porté par la pièce correspond au nom déclaré",
                  en: "PR-101 §3 — the name on the document matches the declared name" },
        constat: { fr: `Nom discordant sur : ${attendue}`, en: `Name mismatch on: ${attendue}` }, impose: "complement", nettete: 0.85,
      });
    }
  }

  if (c.type === "societe") {
    const couvert = c.beneficiaires.filter((b) => b.identifie).reduce((s2, b) => s2 + b.part, 0);
    const gros = c.beneficiaires.filter((b) => b.part >= 25 && !b.identifie);
    if (gros.length > 0) {
      regles.push({
        code: "R-BE25", clause: { fr: "PR-101 §5 — tout bénéficiaire détenant plus de 25 % est identifié",
                  en: "PR-101 §5 — every beneficial owner above 25 % is identified" },
        constat: { fr: `${gros.length} bénéficiaire(s) au-dessus de 25 % non identifié(s)`,
                   en: `${gros.length} beneficial owner(s) above 25 % not identified` },
        impose: "complement", nettete: 1,
      });
    } else if (couvert < 75) {
      regles.push({
        code: "R-BECOUV", clause: { fr: "PR-101 §5 — la chaîne de détention est reconstituée",
                  en: "PR-101 §5 — the ownership chain is reconstructed" },
        constat: { fr: `Détention identifiée : ${couvert} %`, en: `Ownership identified: ${couvert} %` },
        impose: "complement", nettete: 0.8,
      });
    }
  }

  const volume = c.activite.volumeAnnuelDeclare;
  // Every comparison against the reference takes the margin: the table is known to be
  // wrong in both directions, and only one of them is cheap.
  const normeBrute = referentiel?.get(c.activite.secteur);
  const norme = normeBrute === undefined ? undefined : normeBrute * PRUDENCE;
  if (norme === undefined) {
    // Sans référentiel, l'agent ne sait pas si ce volume est anormal ou banal pour ce
    // métier. Il le signale quand même, et le dit avec une netteté faible : c'est la
    // confiance qui doit porter l'ignorance, pas la décision.
    if (volume > VOLUME_ELEVE) {
      regles.push({
        code: "R-VOL",
        clause: { fr: "PR-204 §1 — un volume déclaré sans rapport avec l'activité justifie un examen",
                  en: "PR-204 §1 — a declared volume unrelated to the activity warrants review" },
        constat: { fr: `Volume annuel déclaré : ${volume.toLocaleString("fr-FR")} €`,
                   en: `Declared annual volume: €${volume.toLocaleString("en-GB")}` },
        impose: "escalader", nettete: 0.35,
      });
    }
  } else {
    const rapport = volume / norme;
    if (rapport >= MULTIPLE_ANORMAL) {
      regles.push({
        code: "R-VOL",
        clause: { fr: "PR-204 §1 — un volume déclaré sans rapport avec l'activité justifie un examen",
                  en: "PR-204 §1 — a declared volume unrelated to the activity warrants review" },
        constat: { fr: `${volume.toLocaleString("fr-FR")} € déclarés, soit ${rapport.toFixed(1)}× l'usage du secteur « ${c.activite.secteur} »`,
                   en: `€${volume.toLocaleString("en-GB")} declared, ${rapport.toFixed(1)}× the norm for “${c.activite.secteur}”` },
        impose: "escalader", nettete: netteteVolume(rapport),
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
  const normeSecteur = normeBrute === undefined ? undefined : normeBrute * PRUDENCE;
  const volumeSignificatif = normeSecteur !== undefined
    ? c.activite.volumeAnnuelDeclare > normeSecteur * 2
    : c.activite.volumeAnnuelDeclare > VOLUME_ELEVE / 2;

  if (surveilles.length > 0 && volumeSignificatif) {
    regles.push({
      code: "R-JURID", clause: { fr: "PR-415 §9 — juridiction sous surveillance combinée à un volume significatif",
                en: "PR-415 §9 — monitored jurisdiction combined with a significant volume" },
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
export function trier(c: Cas, seuil = 0.7, referentiel?: Referentiel): Verdict {
  const regles = appliquer(c, referentiel);

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
