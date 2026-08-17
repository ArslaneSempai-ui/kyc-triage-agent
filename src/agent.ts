/**
 * L'agent de triage.
 *
 * It applies the procedure, records what it did, and — this is the whole point of the
 * project — stops when it is not sure.
 *
 * It is deliberately NOT a copy of the ground truth. An agent that reimplements exactly
 * the rule that scores it gets 100 % and demonstrates nothing. This one works like a real
 * implementation: it knows the procedure, not the judgement of
 * l'analyste. Il ignore les volumes typiques par secteur et se rabat sur un seuil
 * generic ceiling — an ordinary approximation, and a source of measurable errors.
 */

import { PAYS_A_RISQUE, PAYS_SOUS_SURVEILLANCE, piecesRequises } from "./cas.ts";
import { MULTIPLE_ANORMAL, netteteVolume, PRUDENCE } from "./referentiel.ts";
import { REGULATIONS } from "./regulations.ts";
import type { RegulationKey } from "./regulations.ts";
import type { Referentiel } from "./referentiel.ts";
import type { Cas, Decision } from "./cas.ts";

/** Un texte dans les deux langues. Le moteur ne produit pas d'affichage : il produit
 *  both versions, and the screen picks. A sentence built server-side in a single language
 *  is an architecture defect, not a missing translation. */
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
  /** The clause applied. Without it the decision is indefensible. */
  clause: Bilingue;
  constat: Bilingue;
  impose: Decision;
  /**
   * How sharp the trigger is, from 0 to 1.
   *
   * A rule can be formally true while resting on a fuzzy observation. "Sanctions match at
   * 0.58" fires the same rule as "at 0.97" and does not deserve the same confidence.
   * Conflating the two is the error that makes an
   * automatisation dangereuse.
   */
  nettete: number;
};

export type Verdict = {
  cas: string;
  decision: Decision;
  /** What the agent would have decided alone, before the escalation rule. */
  decisionBrute: Decision;
  confiance: number;
  escalade: boolean;
  /** The numbers, not the sentence: the screen phrases it, in its own language. */
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

/**
 * How long before expiry a document stops counting as valid.
 *
 * Three months. Chosen, like the rest — and unlike the rest it is bounded by something
 * real: a review cycle a bank can actually run. Below one month the request arrives after
 * the document has lapsed; above six, every file carries a request.
 */
export const MOIS_AVANT_EXPIRATION = 3;

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

  /*
   * A file the agent cannot check is not a file that passes.
   *
   * Three of these came out of the adversarial gallery and they share one shape: an input
   * that is absent rather than clean, and that every downstream rule therefore reads as
   * clean. Screening an empty name returns no match. A declared volume of zero is below
   * every ceiling and above no multiple. A sector the reference table does not list has no
   * norm to be abnormal against.
   *
   * In each case silence from the rules meant approval, which is the one direction an
   * absence must never resolve in.
   */
  if (c.nom.trim().length === 0) {
    regles.push({
      code: "R-IDENT", regulation: "identificationTiming",
      clause: { fr: "31 CFR 1010.230(a) — l'identification se fait à l'ouverture du compte",
                en: "31 CFR 1010.230(a) — identification is performed at account opening" },
      constat: { fr: "Nom déclaré vide : aucun criblage n'a pu être fait",
                 en: "Declared name is empty: no screening could be performed" },
      impose: "complement", nettete: 1,
    });
  }

  if (c.activite.volumeAnnuelDeclare <= 0) {
    regles.push({
      code: "R-VOL0", regulation: null,
      clause: { fr: "Contrôle interne — une activité déclarée nulle n'est pas une activité à faible risque",
                en: "Internal control — a declared activity of zero is not a low-risk activity" },
      constat: { fr: "Volume annuel déclaré : 0", en: "Declared annual volume: 0" },
      impose: "complement", nettete: 1,
    });
  }

  const s = c.criblage.correspondanceSanction;
  if (s >= k.seuilSanctionDoute) {
    regles.push({
      code: "R-SANCT", regulation: "sarThreshold",
      clause: { fr: "31 CFR 1020.320(a)(2) — une opération suspecte de 5 000 $ ou plus est déclarée",
                en: "31 CFR 1020.320(a)(2) — a suspicious transaction of $5,000 or more must be reported" },
      constat: { fr: `Correspondance liste de sanctions à ${s.toFixed(2)}`,
                 en: `Sanctions-list match at ${s.toFixed(2)}` },
      impose: "escalader",
      // Sharp at the extremes, fuzzy in the middle: that is where the namesakes live.
      nettete: s >= k.seuilSanctionCertain ? 0.95 : (s - k.seuilSanctionDoute) / Math.max(1e-6, k.seuilSanctionCertain - k.seuilSanctionDoute) * 0.5 + 0.2,
    });
  }

  /*
   * A PEP is a status, not a score.
   *
   * The adversarial gallery put a 0.80 PEP match on an otherwise clean file and the agent
   * approved it: the rule only fired above the *certainty* threshold, so anything in the
   * ambiguous band was treated as noise. A sanctions match in that band already escalates
   * — a politically exposed person in it was worth less attention than a namesake, which
   * is backwards.
   */
  const p = c.criblage.correspondancePep;
  if (p >= k.seuilSanctionDoute) {
    regles.push({
      code: "R-PEP", regulation: "identificationTiming",
      clause: { fr: "31 CFR 1010.230(a) — l'identification se fait à l'ouverture du compte",
                en: "31 CFR 1010.230(a) — identification is performed at account opening" },
      constat: { fr: `Correspondance PPE à ${p.toFixed(2)}`, en: `PEP match at ${p.toFixed(2)}` },
      impose: "escalader",
      nettete: p >= k.seuilSanctionCertain ? 0.9 : 0.45,
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
        // The agent sees only a binary flag; legibility is a judgement.
        nettete: 0.7,
      });
    }
    /*
     * Expiring counts, not only expired.
     *
     * The rule asked whether a document had already lapsed. A passport with thirty days
     * left passed today and lapsed before the relationship was a quarter old — which the
     * bank then discovers from the customer, or not at all.
     */
    if (piece.expireDans !== null && piece.expireDans <= MOIS_AVANT_EXPIRATION) {
      regles.push({
        code: "R-EXPIR", regulation: null, clause: { fr: "Contrôle interne — une pièce d'identité expirée n'est pas recevable",
                  en: "Internal control — an expired identity document is not acceptable" },
        constat: piece.expireDans <= 0
          ? { fr: `${attendue} expirée depuis ${Math.abs(piece.expireDans)} mois`,
              en: `${attendue} expired ${Math.abs(piece.expireDans)} months ago` }
          : { fr: `${attendue} expire dans ${piece.expireDans} mois`,
              en: `${attendue} expires in ${piece.expireDans} months` },
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
    /* Unidentified holders sitting in the band just below the threshold. */
    const grappe = c.beneficiaires.filter((b) => !b.identifie && b.part >= 15 && b.part < 25);
    if (gros.length > 0) {
      regles.push({
        code: "R-BE25", regulation: "beneficialOwnership", clause: { fr: "31 CFR 1010.230(d)(1) — tout détenteur de 25 % ou plus du capital est identifié",
                  en: "31 CFR 1010.230(d)(1) — every holder of 25 % or more of the equity is identified" },
        constat: { fr: `${gros.length} bénéficiaire(s) au-dessus de 25 % non identifié(s)`,
                   en: `${gros.length} beneficial owner(s) above 25 % not identified` },
        impose: "complement", nettete: 1,
      });
    } else if (grappe.length >= 3 && grappe.reduce((t, b) => t + b.part, 0) >= 50) {
      /*
       * Several unidentified holders clustered just under the identification threshold.
       *
       * Four holders at 24 % each is 96 % of a company owned by nobody the bank has seen,
       * and no single holder trips `(d)(1)`. The agent used to ask for the documents and
       * move on, which is the right first move for an oversight and the wrong one for a
       * pattern: ownership arranged to sit under a threshold is the same manoeuvre as
       * amounts arranged to sit under a reporting threshold.
       *
       * It cannot tell a deliberate split from four genuine equal partners — and neither
       * can a document request. That is what a human is for.
       */
      regles.push({
        code: "R-BEGRAPPE", regulation: "beneficialOwnership",
        clause: { fr: "31 CFR 1010.230(d)(1) — tout détenteur de 25 % ou plus du capital est identifié",
                  en: "31 CFR 1010.230(d)(1) — every holder of 25 % or more of the equity is identified" },
        constat: { fr: `${grappe.length} détenteurs non identifiés juste sous 25 %, ${grappe.reduce((t, b) => t + b.part, 0)} % au total`,
                   en: `${grappe.length} unidentified holders just under 25 %, ${grappe.reduce((t, b) => t + b.part, 0)} % between them` },
        impose: "escalader", nettete: 0.75,
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

  /*
   * A sector the table does not list is a gap in the data, and the sweep already said the
   * flat ceiling decides a great deal whenever that happens. Rather than fall back to it
   * silently, the agent says it has no basis for judging — at low sharpness, so the
   * confidence carries the ignorance rather than the decision.
   */
  if (referentiel !== undefined && normeBrute === undefined) {
    regles.push({
      code: "R-SECT", regulation: null,
      clause: { fr: "Contrôle interne — un secteur absent du référentiel ne peut pas être jugé sur son volume",
                en: "Internal control — a sector missing from the reference cannot be judged on volume" },
      constat: { fr: `Secteur hors référentiel : « ${c.activite.secteur} »`,
                 en: `Sector not in the reference: “${c.activite.secteur}”` },
      impose: "escalader", nettete: 0.3,
    });
  }
  const norme = normeBrute === undefined ? undefined : normeBrute * k.prudence;
  if (norme === undefined) {
    // With no reference table the agent cannot tell whether this volume is abnormal or
    // ordinary for the trade. It flags it anyway, at low sharpness: it is the confidence
    // that should carry the ignorance, not the decision.
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
 * Two things only, and neither substitutes for the other: how sharp the observation was,
 * and whether any rule left doubt behind it. A file with no rule triggered at all is the
 * most delicate case — the agent has to distinguish "nothing to report" from "I did not
 * know where to look".
 */
function confiance(regles: Regle[], decision: Decision): number {
  if (regles.length === 0) {
    // No rule fired: the decision is "approve" for want of grounds. Solid, but never
    // total — it is a conclusion drawn from a silence.
    return 0.8;
  }
  const decisives = regles.filter((r) => r.impose === decision);
  if (decisives.length === 0) return 0.3;

  // The sharpest rule carries the decision; the others firm it up a little.
  const meilleure = Math.max(...decisives.map((r) => r.nettete));
  const appui = Math.min(0.1, (decisives.length - 1) * 0.04);

  // A fuzzy rule pushing toward a MORE severe decision than the one taken is an internal
  // disagreement, and the confidence has to suffer for it.
  const contradictions = regles.filter((r) => r.impose !== decision && r.nettete < 0.6).length;
  return Math.max(0, Math.min(1, meilleure + appui - contradictions * 0.12));
}

/**
 * Decide — or hand over.
 *
 * `seuil` is the human boundary: below it the agent does not decide. It is the only
 * setting that matters, and it belongs to the business, not to whoever writes the code.
 */
export function trier(c: Cas, seuil = 0.7, referentiel?: Referentiel, k: Constantes = CONSTANTES): Verdict {
  const regles = appliquer(c, referentiel, k);

  // The most severe decision wins. Asking someone who came back off a sanctions list for
  // a missing document amounts to tipping them off.
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
