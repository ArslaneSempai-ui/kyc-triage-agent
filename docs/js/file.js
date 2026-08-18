/**
 * La file de revue, et ce qu'un humain en fait.
 *
 * Escalation is worthless if the human decision falls into a void. Every override is
 * recorded with its reason: that is the only material which will one day support "the
 * agent is systematically wrong here" rather than "the analysts are complaining".
 *
 * Nothing leaves the machine. The state fits in one file.
 */
import { genererCas } from "./cas.js";
import { trier } from "./agent.js";
import { REFERENTIEL_SECTORIEL } from "./referentiel.js";
import { mesurer } from "./mesurer.js";
let persistance = { lire: () => null, ecrire: () => { } };
export function brancherPersistance(p) {
    persistance = p;
}
/**
 * Une fonction, pas une constante.
 *
 * A shared object gets modified by the first caller and the next one inherits the damage.
 * That trap already cost a whole session on the previous project.
 */
const vide = () => ({ seuil: 0.7, referentielActif: true, reprises: [] });
let etat = vide();
let cas = [];
export function demarrer(combien = 400) {
    cas = genererCas(combien);
    try {
        const brut = persistance.lire();
        etat = brut === null ? vide() : { ...vide(), ...JSON.parse(brut) };
    }
    catch {
        etat = vide();
    }
}
function sauver() {
    persistance.ecrire(JSON.stringify(etat, null, 2));
}
const referentiel = () => (etat.referentielActif ? REFERENTIEL_SECTORIEL : undefined);
function ligne(c) {
    return {
        cas: c,
        verdict: trier(c, etat.seuil, referentiel()),
        reprise: etat.reprises.find((r) => r.cas === c.id) ?? null,
    };
}
/** La file : ce que l'agent n'a pas voulu trancher, et qu'un humain n'a pas encore vu. */
export function fileDAttente(limite = 25) {
    return cas
        .map(ligne)
        .filter((l) => l.verdict.decision === "escalader" && !l.reprise)
        // Least certain first: that is where a human opinion is worth the most.
        .sort((a, b) => a.verdict.confiance - b.verdict.confiance)
        .slice(0, limite);
}
export function traitees(limite = 20) {
    return etat.reprises
        .slice(-limite).reverse()
        .map((r) => cas.find((c) => c.id === r.cas))
        .filter((c) => c !== undefined)
        .map(ligne);
}
export function reprendre(id, retenue, motif) {
    const c = cas.find((x) => x.id === id);
    if (!c)
        throw new Error(`Dossier inconnu : ${id}`);
    const v = trier(c, etat.seuil, referentiel());
    const reprise = {
        cas: id, propose: v.decisionBrute, retenue,
        motif: motif.trim(), le: new Date().toISOString(),
    };
    etat.reprises = etat.reprises.filter((r) => r.cas !== id).concat(reprise);
    sauver();
    return reprise;
}
export function reglerSeuil(valeur) {
    if (!Number.isFinite(valeur))
        return etat.seuil;
    etat.seuil = Math.min(0.99, Math.max(0.3, valeur));
    sauver();
    return etat.seuil;
}
export function basculerReferentiel(actif) {
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
        const b = distribution.find((d) => l.verdict.confiance < d.a) ?? distribution[nBandes - 1];
        b.total++;
        if (l.verdict.decision === "escalader")
            b.escalades++;
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
export function reinitialiser() {
    etat.reprises = [];
    sauver();
}
export const lireCas = () => cas;
