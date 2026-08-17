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
import { PAYS_A_RISQUE, PAYS_SOUS_SURVEILLANCE, piecesRequises } from "./cas.js";
import { MULTIPLE_ANORMAL, netteteVolume, PRUDENCE } from "./referentiel.js";
export const CONSTANTES = {
    seuilSanctionCertain: 0.85,
    seuilSanctionDoute: 0.55,
    volumeEleve: 1_500_000,
    multipleAnormal: MULTIPLE_ANORMAL,
    prudence: PRUDENCE,
};
const RANG = { approuver: 0, complement: 1, escalader: 2 };
function appliquer(c, referentiel, k = CONSTANTES) {
    const regles = [];
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
                // The agent sees only a binary flag; legibility is a judgement.
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
        }
        else if (couvert < 75) {
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
    }
    else {
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
function confiance(regles, decision) {
    if (regles.length === 0) {
        // No rule fired: the decision is "approve" for want of grounds. Solid, but never
        // total — it is a conclusion drawn from a silence.
        return 0.8;
    }
    const decisives = regles.filter((r) => r.impose === decision);
    if (decisives.length === 0)
        return 0.3;
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
export function trier(c, seuil = 0.7, referentiel, k = CONSTANTES) {
    const regles = appliquer(c, referentiel, k);
    // The most severe decision wins. Asking someone who came back off a sanctions list for
    // a missing document amounts to tipping them off.
    const brute = regles.length === 0
        ? "approuver"
        : regles.reduce((pire, r) => (RANG[r.impose] > RANG[pire] ? r.impose : pire), "approuver");
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
