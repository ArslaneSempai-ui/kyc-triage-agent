import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { eprouver } from "./adverses.ts";
import { INVENTORY, MUST_DECLARE, CITED } from "./inventory.ts";
import { ALL } from "./regulations.ts";
import assert from "node:assert/strict";
import { genererCas, veriteAttendue } from "./cas.ts";
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

test("a clean file is approved without intervention", () => {
  const v = trier(base(), 0.7, REFERENTIEL_SECTORIEL);
  assert.equal(v.decision, "approuver");
  assert.equal(v.escalade, false);
});

test("une correspondance de sanction nette escalade avec une confiance haute", () => {
  const c = base();
  c.criblage.correspondanceSanction = 0.96;
  const v = trier(c, 0.7, REFERENTIEL_SECTORIEL);
  assert.equal(v.decision, "escalader");
  assert.equal(v.escalade, false, "the rule decides — this is not an admission of ignorance");
  assert.ok(v.confiance >= 0.9);
});

test("une correspondance ambiguë escalade PAR manque de confiance", () => {
  const c = base();
  c.criblage.correspondanceSanction = 0.6;
  const v = trier(c, 0.7, REFERENTIEL_SECTORIEL);
  assert.equal(v.decision, "escalader");
  assert.equal(v.escalade, true, "c'est la zone des homonymes : l'agent doit passer la main");
  assert.ok(v.motifEscalade !== null, "the reason carries the numbers that explain the stop");
});

test("the most severe decision wins — you do not ask a sanctioned profile for a document", () => {
  const c = base();
  c.criblage.correspondanceSanction = 0.95;
  c.pieces[0].fournie = false;
  const v = trier(c, 0.7, REFERENTIEL_SECTORIEL);
  assert.equal(v.decisionBrute, "escalader");
});

test("every rule that fires cites the clause behind it, in both languages", () => {
  const c = base();
  c.pieces[1].fournie = false;
  const v = trier(c, 0.7, REFERENTIEL_SECTORIEL);
  assert.ok(v.regles.length > 0);
  for (const r of v.regles) {
    for (const langue of ["fr", "en"] as const) {
      assert.ok(r.clause[langue].length > 10, `rule ${r.code} has no ${langue} clause`);
      assert.ok(r.constat[langue].length > 0, `rule ${r.code} has no ${langue} finding`);
    }
  }
});

test("no rule leaks French into its English version", () => {
  // The engine used to build its sentences in French and the English screen displayed
  // them as-is. This test guards the whole set, not one chosen case.
  const francais = /\b(dossier|décision|seuil|analyste|pièce|bénéficiaire|déclaré|opère)\b/i;
  for (const c of genererCas(400)) {
    for (const r of trier(c, 0.7, REFERENTIEL_SECTORIEL).regles) {
      assert.ok(!francais.test(r.clause.en), `clause ${r.code} is still French: ${r.clause.en}`);
      assert.ok(!francais.test(r.constat.en), `finding ${r.code} is still French: ${r.constat.en}`);
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

test("with no reference table, an ordinary sector volume still raises a fuzzy alert", () => {
  const c = base();
  c.activite.secteur = "import-export";
  c.activite.volumeAnnuelDeclare = 3_000_000;

  const sans = trier(c, 0.7);
  const vol = sans.regles.find((r) => r.code === "R-VOL");
  assert.ok(vol, "l'agent sans contexte signale ce volume");
  assert.ok(vol.nettete < 0.5, "and it must admit it does not know");

  const avec = trier(c, 0.7, REFERENTIEL_SECTORIEL);
  assert.equal(avec.regles.find((r) => r.code === "R-VOL"), undefined,
    "avec le contexte sectoriel, 3 M€ en import-export est banal");
});

test("volume sharpness grows with the distance from the norm", () => {
  assert.ok(netteteVolume(MULTIPLE_ANORMAL) < netteteVolume(6));
  assert.ok(netteteVolume(1) < netteteVolume(MULTIPLE_ANORMAL));
});

test("the reference table raises automation without degrading safety", () => {
  const cas = genererCas(400);
  const sans = mesurer(cas, 0.7);
  const avec = mesurer(cas, 0.7, REFERENTIEL_SECTORIEL);

  assert.ok(avec.tauxAutomatisation > sans.tauxAutomatisation);
  assert.ok(avec.escaladesInutiles < sans.escaladesInutiles);
  assert.ok(avec.manquements <= sans.manquements, "no gain justifies more breaches");
});

test("the file draw is reproducible", () => {
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
        /*
         * AND THE THRESHOLD, NOT ONLY THE REFERENCE.
         *
         * The clause spells out the figure — "$5,000", "$10,000" — because a citation whose
         * amount is computed from our own table has stopped citing the law and started
         * citing us. That is why devise-tapee is exempted on agent.ts, and an exemption
         * closes a signal, not the question underneath it: nothing tied these amounts to
         * the register that holds their source and retrieval date, so the two could drift
         * apart in silence and the decision would cite a threshold no longer in the law.
         *
         * The figure carries a currency and a thousands separator ("$5,000"), and the
         * French clause writes the same amount its own way ("5 000 $"). Comparing digits
         * only is what survives both.
         */
        /* Toutes les entrées ne portent pas de `figure` — une clause de confidentialité
           n'a pas de seuil. `in` plutôt qu'un accès direct : le registre est typé littéral. */
        const reg = REGULATIONS[r.regulation];
        const fig = "figure" in reg ? String(reg.figure) : "";
        /* Les montants seulement — ceux que l'exemption couvre. Une figure comme
           "30 days, 60 maximum" n'est pas recopiée chiffre pour chiffre dans la clause,
           et l'exiger ferait tomber la garde sur un cas qu'elle ne juge pas. */
        if (/^[$€£]/.test(fig)) {
          const attendu = fig.replace(/\D/g, "");
          assert.ok(r.clause[langue].replace(/\D/g, "").includes(attendu),
            `${r.code} cites ${REGULATIONS[r.regulation].cite} but its ${langue} clause does not `
            + `carry the threshold the register holds (${fig}) — one of the two has drifted, `
            + `and the clause is the copy`);
        }
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
  /*
   * `seuilSanctionCertain` no longer decides whether the PEP rule fires — the adversarial
   * gallery showed that a 0.80 PEP match was being treated as noise, so the rule now fires
   * from the doubt threshold like the sanctions one. What the certainty threshold still
   * decides is how *sharp* the finding is, which is what the confidence rests on.
   */
  const nettetePep = (k: Partial<Constantes>) =>
    trier(c, 0.7, REFERENTIEL_SECTORIEL, { ...CONSTANTES, ...k }).regles
      .find((r) => r.code === "R-PEP")?.nettete;
  assert.ok(nettetePep({})! > nettetePep({ seuilSanctionCertain: 0.99 })!,
    "seuilSanctionCertain is not read — it must still decide how sharp a PEP match is");
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

/* ── where every number came from ── */

test("nothing the agent runs on is missing from the inventory", () => {
  /*
   * An inventory of a page's own numbers, typed by hand, goes stale the first time somebody
   * adds a figure — and it goes stale in the flattering direction, because the figure people
   * forget to declare is the one they were least comfortable declaring. So it is checked
   * against the structures it describes.
   */
  const declared = new Set(INVENTORY.map((f) => f.name));
  for (const key of MUST_DECLARE.constants) {
    assert.ok(declared.has(key), `${key} is a constant the agent runs on and the inventory omits it`);
  }
  for (const cite of MUST_DECLARE.regulations) {
    assert.ok(declared.has(cite), `${cite} is cited by a rule and the inventory omits it`);
  }
});

test("every constant I chose is labelled chosen, and every one of them is swept", () => {
  /*
   * The two halves of the promise. A number picked by judgement is only acceptable on a
   * page if the page also says how much rests on it — otherwise "chosen" is a politer word
   * for "made up".
   */
  for (const key of MUST_DECLARE.constants) {
    const f = INVENTORY.find((x) => x.name === key)!;
    assert.equal(f.provenance, "chosen", `${key} is mine and must be labelled as mine`);
    assert.ok(MUST_DECLARE.swept.includes(key), `${key} is declared chosen but no sweep reports on it`);
    assert.ok(f.note && f.note.length > 20, `${key} is chosen and says nothing about why`);
  }
});

test("the citation list is what the rules cite, not what the shared file holds", () => {
  /*
   * The shared regulations file is copied into five repositories. Listing all of it under
   * "what every decision cites" put a sanctions-reporting rule on a page about onboarding,
   * cited by nothing. Caught once by the staleness check; asserted here so it stays caught.
   */
  const firing = new Set(
    genererCas(400).flatMap((c) => trier(c, 0.7, REFERENTIEL_SECTORIEL).regles)
      .map((r) => r.regulation).filter((k) => k !== null),
  );
  assert.equal(CITED.length, firing.size, "the cited list must be exactly the rules that fire");
  assert.ok(CITED.length < ALL.length, "and it must be smaller than the shared file, or nothing was filtered");
});

/* ── files written to break the agent ── */

test("every gap the adversarial gallery closed stays closed", () => {
  /*
   * Eleven of the twelve hand-written attacks are held today. Seven of them were not when
   * they were written — an empty name screened clean, a zero volume sat below every
   * ceiling, a PEP at 0.80 was treated as noise, a passport with thirty days left passed.
   *
   * Closing them cost 4.7 points of automation, which is the honest price and is stated on
   * the page. What must not happen is a later change buying that back by quietly
   * re-opening one, so each case is pinned individually rather than as a count.
   */
  for (const r of eprouver()) {
    if (r.adverse.id === "A-SEUIL") continue; // a limit, not a defect — see below
    assert.ok(r.tenu,
      `${r.adverse.id} regressed: expected at least ${r.adverse.attendu}, got ${r.obtenu} — ${r.adverse.attaque}`);
  }
});

test("the one attack that still works is the one that cannot be fixed by moving a number", () => {
  /*
   * A sanctions match parked just below the threshold gets through, and always will: any
   * cut has an underside, and lowering it moves the underside rather than removing it.
   *
   * The test asserts the failure rather than the fix, so that if somebody "solves" it by
   * dragging the threshold down, this fails and asks them what they think they achieved.
   */
  const seuil = eprouver().find((r) => r.adverse.id === "A-SEUIL")!;
  assert.equal(seuil.tenu, false,
    "if this now holds, check it was not 'fixed' by moving the threshold — the case sits one point under whatever it is");
});

test("the control case escalates, or the gallery is measuring nothing", () => {
  const net = eprouver().find((r) => r.adverse.id === "A-SANCTION-NETTE")!;
  assert.equal(net.obtenu, "escalader");
});

test("no hand-typed automation figure on the page disagrees with the measurement", () => {
  /*
   * The generated blocks cannot go stale — `npm run figures --check` fails first. Prose
   * can, and did: closing the gaps the adversarial gallery found moved automation from
   * 63 % to 58 %, and three sentences elsewhere on the page went on saying 63 % for a
   * commit. Exactly the failure this repository exists to complain about, in its own text.
   *
   * So any percentage written next to the word "automation" — or inside the phrase
   * "N % without a human" — is checked against what the code actually produces.
   */
  /*
   * Le texte tel qu'il sera rendu.
   *
   * Ces affirmations portent désormais leur marque de provenance — `<!--p:clé-->valeur<!--/p-->`,
   * invisible sur GitHub, vérifiée par `prose.ts --check` dans le dépôt vitrine. La marque
   * coupe le nombre du mot qui le suit, donc ce test ne trouvait plus rien à contrôler : il
   * enlève les commentaires avant de lire. Les deux contrôles se recouvrent volontiers —
   * celui-ci vit à côté du modèle, l'autre à côté du registre.
   */
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8")
    .replace(/<!--(?!\s*figures)[\s\S]*?-->/g, "");
  const measured = mesurer(genererCas(400), 0.7, REFERENTIEL_SECTORIEL).tauxAutomatisation * 100;

  const claims = [
    ...readme.matchAll(/(\d{1,3}(?:\.\d)?)\s*%\s*(?:of these files|automation|without a human)/gi),
    ...readme.matchAll(/"Handles\s+(\d{1,3}(?:\.\d)?)\s*%/gi),
  ].map((m) => Number(m[1]));

  assert.ok(claims.length > 0, "the guard matched nothing — it is guarding nothing");
  for (const c of claims) {
    assert.ok(Math.abs(c - measured) < 1,
      `the page claims ${c} % automation; the code measures ${measured.toFixed(1)} %`);
  }
});

/*
 * Le relevé des échecs doit dire ce qu'il ne montre pas.
 *
 * « WHAT KIND OF WRONG » n'imprimait que les huit formes les plus fréquentes — 34 décisions
 * sur 73 au corpus courant. Le lecteur prenait les huit lignes pour la réponse alors que
 * plus de la moitié des échecs vivaient dans des formes jamais nommées ni comptées. La
 * section voisine annonce déjà « THREE OF THE 69 » : celle-ci ne disait rien.
 *
 * Le témoin porte sur l'arithmétique, pas sur la mise en page : la somme de ce qui est
 * montré et de ce qui est annoncé comme reste doit faire le total imprimé en tête. Un
 * relevé qui perd des cas en route échoue ici même s'il a l'air complet.
 */
test("le relevé des échecs rend compte de tous les échecs, montrés ou non", () => {
  const chemin = new URL("./echecs.ts", import.meta.url);
  const sortie = execFileSync(process.execPath, [fileURLToPath(chemin)], { encoding: "utf8" });

  const total = Number(sortie.match(/^\s*(\d+) wrong decisions out of/m)?.[1]);
  assert.ok(total >= 1, `aucun échec relevé : ${total} — le contrôle porterait sur rien`);

  const montrees = [...sortie.matchAll(/^\s{2,}(\d+)\s{2}\S/gm)].map((m) => Number(m[1]));
  assert.ok(montrees.length >= 1, "aucune forme imprimée : le relevé ne montre plus rien");
  const vues = montrees.reduce((a, b) => a + b, 0);

  const reste = Number(sortie.match(/(\d+) decision\(s\) — not listed above/)?.[1] ?? 0);
  assert.equal(vues + reste, total,
    `${vues} montrée(s) + ${reste} annoncée(s) ≠ ${total} au total : des échecs disparaissent du relevé`);

  /* Et zéro manquement se dit en toutes lettres, sinon la meilleure nouvelle de l'outil
     s'affiche comme un titre suivi d'un blanc. */
  if (!/^\s+\S/m.test(sortie.split("THE BREACH")[1]?.split("\n").slice(2, 3).join("") ?? "")) {
    assert.match(sortie, /THE BREACH[^\n]*\n\n\s+\S/, "la section des manquements ne doit jamais être vide sans un mot");
  }
});

/*
 * UN SECTEUR HORS RÉFÉRENTIEL NE FAIT PAS TOMBER LA VÉRITÉ TERRAIN.
 *
 * `decisionAttendue` gardait son premier test par `secteur &&` puis lisait `secteur!` au
 * suivant : l'assertion non-nulle portait exactement sur le cas que la ligne précédente
 * déclarait possible. Tout dossier dont le secteur n'est pas dans `SECTEURS` levait
 * « Cannot read properties of undefined ».
 *
 * Le générateur ne tire ses secteurs que dans cette liste, donc rien ne l'atteignait — mais
 * l'agent a une règle entière pour ce cas (`R-SECT`) et la galerie adverse un dossier bâti
 * dessus (`A-SECTEUR-INCONNU`, secteur « casino en ligne »), qui n'échappe au piège que
 * parce qu'`adverses.ts` écrit sa vérité à la main au lieu de la dériver.
 *
 * Les deux sens : la juridiction surveillée est ce qui déclenchait la lecture fautive, donc
 * elle est présente ici ; et le même dossier avec un secteur CONNU doit, lui, escalader —
 * sans quoi ce contrôle passerait sur une règle qui ne fait plus rien.
 */
test("un secteur absent du référentiel ne fait pas tomber la vérité terrain", () => {
  const inconnu: Cas = { ...base(), verite: "approuver" };
  inconnu.activite = { secteur: "casino en ligne", volumeAnnuelDeclare: 1_400_000, paysOperation: ["PA"] };
  assert.doesNotThrow(() => veriteAttendue(inconnu),
    "un secteur hors liste ne doit pas lever : il n'y a pas de norme, donc pas de multiple");
  assert.equal(veriteAttendue(inconnu), "approuver",
    "sans norme sectorielle, la règle de volume ne peut pas conclure");

  /* Le témoin inverse : même dossier, secteur connu — la règle doit bien mordre, sinon le
     contrôle ci-dessus vaudrait pour une règle morte. */
  const connu: Cas = { ...base(), verite: "approuver" };
  connu.activite = { secteur: "conseil", volumeAnnuelDeclare: 1_400_000, paysOperation: ["PA"] };
  assert.equal(veriteAttendue(connu), "escalader",
    "1,4 M€ en conseil vers une juridiction surveillée doit escalader");
});

/*
 * UNE DIVISION GARDÉE, SA JUMELLE NE L'ÉTAIT PAS.
 *
 * `precisionAutomatisee` traite son dénominateur nul ; `tauxAutomatisation`, une ligne plus
 * haut, ne le traitait pas — un corpus vide publiait `NaN` là où l'autre publiait un
 * nombre. Le témoin exige les deux à la fois : garder l'une seule est le défaut d'origine.
 */
test("un corpus vide rend des nombres, pas des NaN", () => {
  const b = mesurer([], 0.7, REFERENTIEL_SECTORIEL);
  assert.equal(Number.isFinite(b.tauxAutomatisation), true,
    `tauxAutomatisation vaut ${b.tauxAutomatisation} sur un corpus vide`);
  assert.equal(Number.isFinite(b.precisionAutomatisee), true,
    `precisionAutomatisee vaut ${b.precisionAutomatisee} sur un corpus vide`);
  assert.equal(b.tauxAutomatisation, 0, "rien d'automatisé sur rien vaut 0");

  /* Et le sens qui compte : sur un vrai corpus, ces deux nombres bougent encore. Sans ce
     témoin, renvoyer 0 en dur passerait le contrôle ci-dessus. */
  const vrai = mesurer(genererCas(120), 0.7, REFERENTIEL_SECTORIEL);
  assert.ok(vrai.tauxAutomatisation > 0 && vrai.tauxAutomatisation <= 1,
    `taux hors plage sur un vrai corpus : ${vrai.tauxAutomatisation}`);
});
