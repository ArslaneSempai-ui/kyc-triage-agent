/**
 * Noter l'agent.
 *
 * Overall accuracy interests nobody here. Two errors share a name and do not share a
 * price:
 *
 *   - escalating a file that could have been handled alone → analyst time wasted;
 *   - approving alone a file that had to go up → an uncontrolled onboarding, which is
 *     the breach.
 *
 * Counting them together hides the only one that costs money.
 */
import { genererCas } from "./cas.js";
import { isMain } from "./cli.js";
import { trier, CONSTANTES } from "./agent.js";
import { REFERENTIEL_SECTORIEL } from "./referentiel.js";
export function mesurer(cas, seuil, referentiel, k = CONSTANTES) {
    const vide = () => ({ attendu: 0, obtenu: 0, justes: 0 });
    const parDecision = {
        approuver: vide(), complement: vide(), escalader: vide(),
    };
    let automatises = 0, justesAutomatises = 0, manquements = 0, escaladesInutiles = 0;
    for (const c of cas) {
        const v = trier(c, seuil, referentiel, k);
        parDecision[c.verite].attendu++;
        parDecision[v.decision].obtenu++;
        if (v.decision === c.verite)
            parDecision[c.verite].justes++;
        if (v.decision === "escalader") {
            if (c.verite !== "escalader")
                escaladesInutiles++;
        }
        else {
            automatises++;
            if (v.decision === c.verite)
                justesAutomatises++;
            if (c.verite === "escalader")
                manquements++;
        }
    }
    return {
        seuil, total: cas.length, automatises,
        tauxAutomatisation: automatises / cas.length,
        justesAutomatises,
        precisionAutomatisee: automatises === 0 ? 1 : justesAutomatises / automatises,
        manquements, escaladesInutiles, parDecision,
    };
}
/** The trade-off, threshold by threshold. The only output worth publishing. */
export function balayer(cas, seuils = [0.5, 0.6, 0.7, 0.8, 0.9, 0.95], referentiel, k = CONSTANTES) {
    return seuils.map((s) => mesurer(cas, s, referentiel, k));
}
if (isMain(import.meta)) {
    const cas = genererCas(400);
    const pc = (x) => (x * 100).toFixed(1).padStart(5) + " %";
    console.log(`\n${cas.length} synthetic files`);
    for (const [titre, ref] of [
        ["WITHOUT the sector reference", undefined],
        ["WITH the sector reference", REFERENTIEL_SECTORIEL],
    ]) {
        console.log(`\n${titre}`);
        console.log("bar     automated    correct    breaches      wasted escalations");
        console.log("─".repeat(68));
        for (const b of balayer(cas, undefined, ref)) {
            console.log(`${b.seuil.toFixed(2)}   ${pc(b.tauxAutomatisation)}    ${pc(b.precisionAutomatisee)}` +
                `   ${String(b.manquements).padStart(9)}   ${String(b.escaladesInutiles).padStart(16)}`);
        }
    }
    console.log("\nbreach            = decided alone when it had to be escalated (the regulatory cost)" +
        "\nwasted escalation = sent to an analyst for no reason (the operational cost)\n");
}
