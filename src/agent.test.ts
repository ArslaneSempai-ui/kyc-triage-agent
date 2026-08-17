import { test } from "node:test";
import assert from "node:assert/strict";
import { genererCas } from "./cas.ts";
import { trier } from "./agent.ts";
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
  assert.ok(v.motifEscalade?.includes("Confiance"));
});

test("la décision la plus grave l'emporte — on ne réclame pas une pièce à un profil sous sanction", () => {
  const c = base();
  c.criblage.correspondanceSanction = 0.95;
  c.pieces[0].fournie = false;
  const v = trier(c, 0.7, REFERENTIEL_SECTORIEL);
  assert.equal(v.decisionBrute, "escalader");
});

test("chaque règle déclenchée cite la clause qui la fonde", () => {
  const c = base();
  c.pieces[1].fournie = false;
  const v = trier(c, 0.7, REFERENTIEL_SECTORIEL);
  assert.ok(v.regles.length > 0);
  for (const r of v.regles) {
    assert.ok(r.clause.length > 10, `règle ${r.code} sans clause`);
    assert.ok(r.constat.length > 0, `règle ${r.code} sans constat`);
  }
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
