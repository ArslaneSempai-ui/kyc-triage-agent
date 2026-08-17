import { test } from "node:test";
import assert from "node:assert/strict";
import { genererCas } from "./cas.ts";
import { trier, CONSTANTES } from "./agent.ts";
import { PLAUSIBLE, materiel } from "./sensibilite.ts";
import type { Constantes } from "./agent.ts";
import { REGULATIONS } from "./regulations.ts";
import { REFERENTIEL_SECTORIEL, netteteVolume, MULTIPLE_ANORMAL } from "./referentiel.ts";
import { mesurer } from "./mesurer.ts";
import type { Cas } from "./cas.ts";

const base = (): Cas => ({
  id: "T-0001", type: "particulier", nom: "Test Client", paysResidence: "FR",
  pieces: [
    { type: "identite", fournie: true, lisible: true, expireDans: 24, nomConcorde: true },
    { type: "domicile", fournie: true, lisible: true, expireDans: null, nomConcorde: true },
  ],
  beneficiaires: [],
  criblage: { correspondanceSanction: 0.1, correspondancePep: 0.1 },
  activite: { secteur: "conseil", volumeAnnuelDeclare: 200_000, paysOperation: ["FR"] },
  verite: "approuver",
});

test("un dossier propre est approuvé sans intervention", () => {
  const v = trier(base(), 0.7, REFERENTIEL_SECTORIEL);
  assert.equal(v.decision, "approuver");
  assert.equal(v.escalade, false);
});

test("une correspondance de sanction nette escalade avec une confiance haute", () => {
  const c = base();
  c.criblage.correspondanceSanction = 0.96;
  const v = trier(c, 0.7, REFERENTIEL_SECTORIEL);
  assert.equal(v.decision, "escalader");
  assert.equal(v.escalade, false, "la règle décide, ce n'est pas un aveu d'ignorance");
  assert.ok(v.confiance >= 0.9);
});

test("une correspondance ambiguë escalade PAR manque de confiance", () => {
  const c = base();
  c.criblage.correspondanceSanction = 0.6;
  const v = trier(c, 0.7, REFERENTIEL_SECTORIEL);
  assert.equal(v.decision, "escalader");
  assert.equal(v.escalade, true, "c'est la zone des homonymes : l'agent doit passer la main");
  assert.ok(v.motifEscalade !== null, "le motif porte les nombres qui expliquent l'arrêt");
});

test("la décision la plus grave l'emporte — on ne réclame pas une pièce à un profil sous sanction", () => {
  const c = base();
  c.criblage.correspondanceSanction = 0.95;
  c.pieces[0].fournie = false;
  const v = trier(c, 0.7, REFERENTIEL_SECTORIEL);
  assert.equal(v.decisionBrute, "escalader");
});

test("chaque règle déclenchée cite la clause qui la fonde, dans les deux langues", () => {
  const c = base();
  c.pieces[1].fournie = false;
  const v = trier(c, 0.7, REFERENTIEL_SECTORIEL);
  assert.ok(v.regles.length > 0);
  for (const r of v.regles) {
    for (const langue of ["fr", "en"] as const) {
      assert.ok(r.clause[langue].length > 10, `règle ${r.code} sans clause ${langue}`);
      assert.ok(r.constat[langue].length > 0, `règle ${r.code} sans constat ${langue}`);
    }
  }
});

test("aucune règle ne laisse échapper du français dans la version anglaise", () => {
  // Le moteur produisait ses phrases en français ; l'écran anglais les affichait telles
  // quelles. Ce test empêche la régression sur l'ensemble du jeu, pas sur un cas choisi.
  const francais = /\b(dossier|décision|seuil|analyste|pièce|bénéficiaire|déclaré|opère)\b/i;
  for (const c of genererCas(400)) {
    for (const r of trier(c, 0.7, REFERENTIEL_SECTORIEL).regles) {
      assert.ok(!francais.test(r.clause.en), `clause ${r.code} encore en français : ${r.clause.en}`);
      assert.ok(!francais.test(r.constat.en), `constat ${r.code} encore en français : ${r.constat.en}`);
    }
  }
});

test("le motif d'escalade est un couple de nombres, pas une phrase", () => {
  const c = base();
  c.criblage.correspondanceSanction = 0.6;
  const v = trier(c, 0.7, REFERENTIEL_SECTORIEL);
  assert.equal(typeof v.motifEscalade?.confiance, "number");
  assert.equal(v.motifEscalade?.seuil, 0.7);
});

test("sans référentiel, un volume ordinaire du secteur déclenche quand même une alerte floue", () => {
  const c = base();
  c.activite.secteur = "import-export";
  c.activite.volumeAnnuelDeclare = 3_000_000;

  const sans = trier(c, 0.7);
  const vol = sans.regles.find((r) => r.code === "R-VOL");
  assert.ok(vol, "l'agent sans contexte signale ce volume");
  assert.ok(vol.nettete < 0.5, "et il doit reconnaître qu'il n'en sait rien");

  const avec = trier(c, 0.7, REFERENTIEL_SECTORIEL);
  assert.equal(avec.regles.find((r) => r.code === "R-VOL"), undefined,
    "avec le contexte sectoriel, 3 M€ en import-export est banal");
});

test("la netteté du volume croît avec l'écart à la norme", () => {
  assert.ok(netteteVolume(MULTIPLE_ANORMAL) < netteteVolume(6));
  assert.ok(netteteVolume(1) < netteteVolume(MULTIPLE_ANORMAL));
});

test("le référentiel augmente l'automatisation sans dégrader la sécurité", () => {
  const cas = genererCas(400);
  const sans = mesurer(cas, 0.7);
  const avec = mesurer(cas, 0.7, REFERENTIEL_SECTORIEL);

  assert.ok(avec.tauxAutomatisation > sans.tauxAutomatisation);
  assert.ok(avec.escaladesInutiles < sans.escaladesInutiles);
  assert.ok(avec.manquements <= sans.manquements, "aucun gain ne justifie plus de manquements");
});

test("le tirage des dossiers est reproductible", () => {
  assert.deepEqual(genererCas(20), genererCas(20));
  assert.notDeepEqual(genererCas(20), genererCas(20, 999));
});

/* ── the citations, which are the whole defensibility argument ── */

test("every rule cites a real regulation or declares itself an internal control", () => {
  /*
   * The clauses used to be invented. `PR-101 §5` was a label chosen so decisions would
   * cite something, and a reader could check none of them.
   *
   * A rule now either names a section of 31 CFR that was actually retrieved, or says
   * plainly that it enforces a bank's own control rather than a rule of law. Both are
   * honest; a made-up citation is not.
   */
  const c = base();
  c.criblage.correspondanceSanction = 0.9;
  c.pieces[0].fournie = false;
  c.activite.volumeAnnuelDeclare = 9_000_000;

  const invented = /\bPR-\d+ §\d+/;
  for (const langue of ["fr", "en"] as const) {
    for (const r of trier(c, 0.7, REFERENTIEL_SECTORIEL).regles) {
      assert.ok(!invented.test(r.clause[langue]), `${r.code} still cites an invented clause: ${r.clause[langue]}`);
      if (r.regulation !== null) {
        assert.ok(REGULATIONS[r.regulation], `${r.code} names a regulation that does not exist`);
        assert.ok(r.clause[langue].includes(REGULATIONS[r.regulation].cite),
          `${r.code} claims ${r.regulation} but its clause does not carry the citation`);
      }
    }
  }
});

test("every cited regulation carries its source and the date it was retrieved", () => {
  // A regulation cited without a date is a regulation cited from memory.
  for (const [key, r] of Object.entries(REGULATIONS)) {
    assert.match(r.cite, /^31 CFR \d+\.\d+/, `${key} has no usable citation`);
    assert.match(r.source, /^https:\/\//, `${key} has no source a reader can open`);
    assert.match(r.retrieved, /^\d{4}-\d{2}-\d{2}$/, `${key} has no retrieval date`);
    assert.ok(r.says.length > 30, `${key} does not say what it requires`);
  }
});

/* ── the constants I chose myself, and the sweep that judges them ── */

test("moving a constant actually reaches the rules", () => {
  /*
   * The five constants became a parameter so the sensitivity sweep could move them. If
   * one of them ever stops being read — a refactor closing over the module default
   * instead of the argument — the sweep keeps running and reports "no effect" on a
   * constant it is simply no longer able to move. That failure is silent, and it is
   * flattering, so it gets a test.
   */
  const c = base();
  c.criblage.correspondanceSanction = 0.60;
  c.criblage.correspondancePep = 0.90;
  c.activite.volumeAnnuelDeclare = 9_000_000;

  const codes = (k: Partial<Constantes>) =>
    new Set(trier(c, 0.7, REFERENTIEL_SECTORIEL, { ...CONSTANTES, ...k }).regles.map((r) => r.code));

  assert.ok(codes({}).has("R-SANCT"), "the baseline case must trigger the sanctions rule");
  assert.ok(!codes({ seuilSanctionDoute: 0.95 }).has("R-SANCT"), "seuilSanctionDoute is not read");
  assert.ok(!codes({ seuilSanctionCertain: 0.99 }).has("R-PEP"), "seuilSanctionCertain is not read");
  assert.ok(!codes({ multipleAnormal: 99 }).has("R-VOL"), "multipleAnormal is not read");
  // Prudence multiplies the norm, so a large value raises the bar and silences the rule.
  // Written the other way round first, which asserted the opposite of what prudence does.
  assert.ok(!codes({ prudence: 50 }).has("R-VOL"), "prudence is not read");
  assert.ok(!trier(c, 0.7, undefined, { ...CONSTANTES, volumeEleve: 50_000_000 }).regles
    .some((r) => r.code === "R-VOL"), "volumeEleve is not read");
});

test("volumeEleve is dormant, not inert", () => {
  /*
   * The sweep reported this constant as having no effect for a while, because the check
   * meant to run it without a sector reference passed `undefined` to a parameter whose
   * default *was* the reference. Removing the table moves breaches from none to dozens;
   * the tool said "not worth defending in a review".
   *
   * This test asserts the fact the verdict rests on, so the verdict cannot go quietly
   * wrong again.
   */
  const cas = genererCas(800);
  const bas = mesurer(cas, 0.7, undefined, { ...CONSTANTES, volumeEleve: 400_000 });
  const haut = mesurer(cas, 0.7, undefined, { ...CONSTANTES, volumeEleve: 5_000_000 });

  assert.ok(haut.manquements > bas.manquements + 5,
    "without a sector table, volumeEleve must visibly decide the breaches");

  const avecBas = mesurer(cas, 0.7, REFERENTIEL_SECTORIEL, { ...CONSTANTES, volumeEleve: 400_000 });
  const avecHaut = mesurer(cas, 0.7, REFERENTIEL_SECTORIEL, { ...CONSTANTES, volumeEleve: 5_000_000 });
  assert.equal(avecBas.manquements, avecHaut.manquements, "with a complete table it must be dormant");
});

test("materiality needs both of its tests", () => {
  /*
   * Relative alone published "+1416 %" on a 2 ms difference in another repository.
   * Absolute alone calls a 4-file move in 500 a change. Either test on its own is wrong
   * in a different direction, so both have to hold.
   */
  assert.ok(!materiel(3, 5), "a 2-file move on a base of 3 is a large ratio and nothing else");
  assert.ok(!materiel(500, 504), "a 4-file move on a base of 500 is noise");
  assert.ok(materiel(50, 80), "a move that clears both tests is a change");
});

test("the plausible ranges contain the values actually in use", () => {
  /*
   * A sweep whose range excludes the value being swept walks in one direction only and
   * reports a band that cannot contain the answer. Cheap to get wrong when a constant is
   * retuned and the range is not.
   */
  for (const [nom, [bas, haut]] of Object.entries(PLAUSIBLE)) {
    const v = CONSTANTES[nom as keyof Constantes];
    assert.ok(v >= bas && v <= haut, `${nom} = ${v} sits outside its own plausible range ${bas}–${haut}`);
  }
});
