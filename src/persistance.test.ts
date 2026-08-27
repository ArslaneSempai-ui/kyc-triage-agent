/*
 * CE QU'ON A TROUVÉ SUR LE DISQUE, ET CE QU'ON EN A CONCLU.
 *
 * `demarrer` répondait la même chose — une file vide — à trois situations : rien n'a jamais
 * été enregistré, le fichier existe et ne se lit pas, le fichier existe et ne se parse pas.
 * Les deux dernières sont des pannes, et la troisième est celle où repartir de zéro
 * *détruit* : le premier geste de l'opérateur appelle `sauver()`, qui écrase.
 *
 * Mesuré le 23 août 2026 sur une copie : un `etat.json` coupé au milieu d'un objet démarrait
 * un serveur muet qui annonçait `reprises = 0`, et après un seul POST le fichier faisait
 * 64 octets avec `"reprises": []`. La décision humaine qui s'y trouvait était perdue.
 *
 * L'outil pouvait fabriquer cette entrée lui-même : `writeFileSync` tronque avant d'écrire,
 * donc un Ctrl-C au mauvais demi-quart de seconde laisse exactement ce fichier-là.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync, cpSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { brancherPersistance, demarrer, chiffres, reglerSeuil, SEUIL_MIN, SEUIL_MAX } from "./file.ts";
import { SHIM } from "./pages.ts";

const SRC = fileURLToPath(new URL(".", import.meta.url));

test("un état enregistré mais illisible est signalé, pas confondu avec l'absence", () => {
  const dits: string[] = [];
  /* Le témoin d'abord : rien d'enregistré ne doit RIEN signaler. Sans ce sens-là, la
     correction pourrait se contenter de crier à chaque démarrage. */
  brancherPersistance({ lire: () => null, ecrire: () => {}, illisible: (r) => dits.push(r) });
  demarrer(20);
  assert.equal(dits.length, 0, "aucun état enregistré : il n'y a rien à signaler");
  assert.equal(chiffres().reprises, 0);

  /* Et l'autre sens : un contenu qui ne parse pas doit être nommé. */
  brancherPersistance({ lire: () => '{"reprises":[', ecrire: () => {}, illisible: (r) => dits.push(r) });
  demarrer(20);
  assert.equal(dits.length, 1, "un état illisible doit être signalé une fois");
  assert.match(dits[0]!, /JSON/i, "la raison doit dire ce qui n'allait pas");
  assert.equal(chiffres().reprises, 0, "et la file repart quand même : le serveur reste utilisable");
});

/*
 * LA QUATRIÈME SITUATION : enregistré, qui PARSE, et du mauvais type.
 *
 * Les trois cas ci-dessus (rien, illisible, bon) laissaient passer celui-là en silence.
 * Mesuré avant correctif, sur les 400 dossiers : `{"seuil":"abc"}` faisait tomber
 * `parLeSeuil` à 0 — l'escalade par manque de confiance ne tournait plus du tout, et rien
 * ne le disait. `{"reprises":null}` levait sur toutes les routes.
 *
 * Ce qui rend le trou net : le serveur REFUSE ces quatre écritures avec un 400 quand elles
 * arrivent par HTTP (voir `nombre`/`booleen` dans serveur.ts). Elles entraient par le
 * disque. Une couture se traverse : la garde vaut pour les deux portes ou pour aucune.
 */
test("un état qui parse mais n'a pas la bonne forme est signalé, pas gobé", () => {
  const mauvais: [string, RegExp][] = [
    ['{"seuil":"abc","referentielActif":true,"reprises":[]}', /seuil/],
    ['{"seuil":"0.55","referentielActif":true,"reprises":[]}', /seuil/],
    ['{"seuil":0.7,"referentielActif":"false","reprises":[]}', /referentielActif/],
    ['{"seuil":0.7,"referentielActif":true,"reprises":null}', /reprises/],
    ['{"seuil":0.7,"referentielActif":true,"reprises":[null]}', /reprises\[0\]/],
    ['"une chaine"', /objet/],
    ["[]", /objet/],
  ];
  for (const [contenu, raison] of mauvais) {
    const dits: string[] = [];
    brancherPersistance({ lire: () => contenu, ecrire: () => {}, illisible: (r) => dits.push(r) });
    demarrer(20);
    assert.equal(dits.length, 1, `${contenu} doit être signalé une fois`);
    assert.match(dits[0]!, raison, `la raison doit nommer le champ fautif : ${contenu}`);
    /* Et l'outil repart d'un état SAIN — pas d'un seuil qui n'est pas un nombre. */
    const ch = chiffres();
    assert.equal(typeof ch.seuil, "number", `${contenu} : le seuil doit rester un nombre`);
    assert.equal(typeof ch.referentielActif, "boolean", `${contenu} : le drapeau doit rester booléen`);
  }

  /* Le sens inverse, sans lequel le contrôle ci-dessus passerait en criant à chaque
     démarrage : une forme correcte ne doit RIEN signaler. */
  const dits: string[] = [];
  brancherPersistance({
    lire: () => '{"seuil":0.62,"referentielActif":false,"reprises":[]}',
    ecrire: () => {}, illisible: (r) => dits.push(r),
  });
  demarrer(20);
  assert.deepEqual(dits, [], "un état bien formé n'a rien à signaler");
  assert.equal(chiffres().seuil, 0.62);
});

/*
 * UN SEUIL VENU DU DISQUE OBÉIT AUX MÊMES BORNES QUE CELUI VENU DE L'ÉCRAN.
 *
 * `reglerSeuil` ramène toute valeur dans [0,3 ; 0,99]. Le chargement ne le faisait pas :
 * un `{"seuil":5}` enregistré escaladait les 400 dossiers, et un `{"seuil":0}` aurait fait
 * l'inverse. Un nombre reste un nombre — il est borné, pas refusé.
 */
test("un seuil enregistré hors bornes est ramené dans la plage, comme celui de l'écran", () => {
  for (const [ecrit, attendu] of [[5, SEUIL_MAX], [0, SEUIL_MIN], [-3, SEUIL_MIN], [0.62, 0.62]] as const) {
    brancherPersistance({ lire: () => `{"seuil":${ecrit},"referentielActif":true,"reprises":[]}`, ecrire: () => {} });
    demarrer(20);
    assert.equal(chiffres().seuil, attendu, `seuil enregistré ${ecrit}`);
  }
});

test("un état lisible est chargé, sinon le contrôle voisin ne prouve rien", () => {
  brancherPersistance({
    lire: () => JSON.stringify({ seuil: 0.55, referentielActif: false, reprises: [] }),
    ecrire: () => {},
  });
  demarrer(20);
  assert.equal(chiffres().seuil, 0.55);
  assert.equal(chiffres().referentielActif, false);
});

test("l'écriture ne laisse jamais un fichier à moitié écrit derrière elle", () => {
  const dossier = mkdtempSync(`${tmpdir()}/triage-`);
  try {
    brancherPersistance({
      lire: () => null,
      ecrire: (c) => writeFileSync(`${dossier}/etat.json`, c),
    });
    demarrer(20);
    reglerSeuil(0.62);
    /* Le serveur écrit par un nom temporaire puis renomme ; ce cas-ci vérifie la propriété
       observable côté disque — aucun résidu, et un fichier qui parse. */
    /* Le témoin avant le verdict : un dossier vide n'a pas de résidu non plus, et ce cas-là
       passerait pour un succès. On exige d'abord que l'écriture ait eu lieu. */
    const tout = readdirSync(dossier);
    assert.ok(tout.length >= 1, "rien n'a été écrit : le contrôle des résidus ne prouverait rien");
    const restes = tout.filter((n) => n !== "etat.json");
    assert.deepEqual(restes, [], `résidus d'écriture : ${restes.join(", ")}`);
    assert.equal(JSON.parse(readFileSync(`${dossier}/etat.json`, "utf8")).seuil, 0.62);
  } finally {
    rmSync(dossier, { recursive: true, force: true });
  }
});

/* ─────────────── le serveur, de bout en bout ─────────────── */

function demarrerServeur(racine: string, port: number): Promise<{ fils: ChildProcess; dit: string[] }> {
  const dit: string[] = [];
  const fils = spawn(process.execPath, [`${racine}/src/serveur.ts`], {
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  fils.stderr.on("data", (b) => dit.push(String(b)));
  return new Promise((resoudre, rejeter) => {
    const minuteur = setTimeout(() => rejeter(new Error("le serveur n'a pas démarré en 20 s")), 20_000);
    fils.stdout.on("data", (b) => {
      if (String(b).includes("http://localhost")) { clearTimeout(minuteur); resoudre({ fils, dit }); }
    });
    fils.on("exit", (c) => { clearTimeout(minuteur); rejeter(new Error(`serveur mort au démarrage (${c})`)); });
  });
}

/** Une copie du dépôt, avec l'état qu'on lui donne. */
function copie(etat: string | null): string {
  const base = mkdtempSync(`${tmpdir()}/triage-serveur-`);
  mkdirSync(`${base}/src`, { recursive: true });
  cpSync(SRC, `${base}/src`, { recursive: true });
  if (etat !== null) { mkdirSync(`${base}/data`, { recursive: true }); writeFileSync(`${base}/data/etat.json`, etat); }
  return base;
}

test("un état coupé en deux est gardé de côté avant que quoi que ce soit ne l'écrase", async () => {
  const APERDRE = "decision humaine a ne pas perdre";
  const tronque = `{"seuil":0.75,"referentielActif":true,"reprises":[{"cas":"C-0001","motif":"${APERDRE}"`;
  const racine = copie(tronque);
  let fils: ChildProcess | undefined;
  try {
    const d = await demarrerServeur(racine, 4713);
    fils = d.fils;
    await fetch("http://127.0.0.1:4713/api/seuil",
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ seuil: 0.8 }) });

    assert.match(d.dit.join(""), /illisible/, "le serveur doit le dire, pas repartir en silence");
    const gardes = readdirSync(`${racine}/data`).filter((n) => n.includes("illisible"));
    assert.equal(gardes.length, 1, "une copie et une seule doit être gardée");
    assert.ok(readFileSync(`${racine}/data/${gardes[0]}`, "utf8").includes(APERDRE),
      "la décision humaine doit survivre à l'écrasement");
    /* Et le fichier courant a bien été réécrit : c'est ce qui rend la copie nécessaire. */
    assert.ok(!readFileSync(`${racine}/data/etat.json`, "utf8").includes(APERDRE));
  } finally {
    fils?.kill();
    rmSync(racine, { recursive: true, force: true });
  }
});

test("un réglage qui n'est pas du bon type est refusé, et un bon réglage passe", async () => {
  const racine = copie(null);
  let fils: ChildProcess | undefined;
  const poste = (route: string, corps: string) => fetch(`http://127.0.0.1:4714${route}`,
    { method: "POST", headers: { "content-type": "application/json" }, body: corps });
  const seuil = async () => ((await (await fetch("http://127.0.0.1:4714/api/etat")).json()) as
    { chiffres: { seuil: number; referentielActif: boolean } }).chiffres;
  try {
    fils = (await demarrerServeur(racine, 4714)).fils;
    assert.equal((await poste("/api/seuil", JSON.stringify({ seuil: 0.8 }))).status, 200);
    assert.equal((await seuil()).seuil, 0.8, "un vrai nombre doit passer");

    /* `Number(null)` vaut 0, que la borne remonte à 0,30 — le réglage le PLUS permissif de
     * l'outil. Toutes ces écritures de « pas de valeur » y menaient, avec un 200. */
    for (const vide of ["null", '""', "[]", "false", '"0.55"']) {
      assert.equal((await poste("/api/seuil", `{"seuil":${vide}}`)).status, 400, `${vide} doit être refusé`);
      assert.equal((await seuil()).seuil, 0.8, `${vide} ne doit rien avoir changé`);
    }

    /* `Boolean("false")` vaut `true` : la chaîne allumait le référentiel. */
    assert.equal((await poste("/api/referentiel", '{"actif":"false"}')).status, 400);
    assert.equal((await poste("/api/referentiel", '{"actif":false}')).status, 200);
    assert.equal((await seuil()).referentielActif, false, "un vrai booléen doit passer");

    /* Un identifiant inventé est une erreur du client, pas du serveur. */
    assert.equal((await poste("/api/reprendre", '{"cas":"C-9999","decision":"approuver"}')).status, 400);
  } finally {
    fils?.kill();
    rmSync(racine, { recursive: true, force: true });
  }
});

/*
 * LA TROISIÈME PORTE : LE SHIM DE LA DÉMO PUBLIÉE.
 *
 * Les deux cas ci-dessus éprouvent le serveur (HTTP) et le disque. Il existe une troisième
 * entrée pour les mêmes réglages, et c'est celle que les visiteurs utilisent réellement :
 * `window.LOCAL`, le shim que `pages.ts` injecte dans `docs/index.html`. Il portait encore
 * `reglerSeuil(Number(corps.seuil))` et `basculerReferentiel(Boolean(corps.actif))` — la
 * coercition AVANT la garde, exactement ce que l'en-tête de `serveur.ts` explique longuement
 * avoir corrigé, et aucun contrôle ne l'exécutait.
 *
 * Ce cas EXÉCUTE le shim au lieu de le lire : le gabarit est extrait, ses imports sont
 * repointés vers les sources, et les routes sont appelées. Un témoin qui n'éprouverait que
 * `nombreRecu` prouverait la fonction et pas la route — trois routes supprimées passeraient.
 *
 * Il vient en dernier dans ce fichier : il rebranche la persistance et relance `demarrer`.
 */
test("le shim de la démo publiée refuse ce que le serveur refuse", async () => {
  const OUVRE = '<script type="module">';
  const corpsShim = SHIM.slice(SHIM.indexOf(OUVRE) + OUVRE.length);
  const code = corpsShim
    .slice(0, corpsShim.lastIndexOf("</" + "script>"))
    .replaceAll('"./js/file.js"', JSON.stringify(new URL("./file.ts", import.meta.url).href))
    .replaceAll('"./js/mesurer.js"', JSON.stringify(new URL("./mesurer.ts", import.meta.url).href))
    .replaceAll('"./js/referentiel.js"', JSON.stringify(new URL("./referentiel.ts", import.meta.url).href));

  /* Le témoin de l'extraction : sans lui, un gabarit remanié donnerait un code vide, le
     shim ne poserait aucune route, et les refus attendus « passeraient » pour de bonnes
     raisons qui n'ont rien à voir. */
  assert.match(code, /window\.LOCAL\s*=/, "le shim extrait ne pose pas window.LOCAL — l'extraction a raté");
  assert.equal(code.includes("./js/"), false, "un import du shim n'a pas été repointé");

  brancherPersistance({ lire: () => null, ecrire: () => {} });
  const faux: Record<string, unknown> = { LOCAL_POSE: () => {} };
  (globalThis as unknown as { window: unknown }).window = faux;

  const dossier = mkdtempSync(`${tmpdir()}/triage-shim-`);
  try {
    const fichier = `${dossier}/shim.mjs`;
    writeFileSync(fichier, code);
    await import(pathToFileURL(fichier).href);
    const LOCAL = faux.LOCAL as (chemin: string, corps?: unknown) => Promise<Record<string, unknown>>;
    assert.equal(typeof LOCAL, "function", "le shim n'a pas posé window.LOCAL");

    const seuilCourant = async () =>
      ((await LOCAL("/api/etat")).chiffres as { seuil: number; referentielActif: boolean });

    assert.equal((await LOCAL("/api/seuil", { seuil: 0.8 })).erreur, undefined, "un vrai nombre doit passer");
    assert.equal((await seuilCourant()).seuil, 0.8);

    /* Les quatre écritures de « pas de valeur » que `Number` amène à 0, donc au seuil le
       PLUS permissif — et la chaîne, que le serveur refuse aussi. */
    for (const vide of [null, "", [], false, "0.55"]) {
      const r = await LOCAL("/api/seuil", { seuil: vide });
      assert.ok(typeof r.erreur === "string", `${JSON.stringify(vide)} doit être refusé par le shim`);
      assert.equal((await seuilCourant()).seuil, 0.8, `${JSON.stringify(vide)} ne doit rien avoir changé`);
    }

    /* `Boolean("false")` vaut `true` : la chaîne allumait le référentiel sur la page publiée. */
    assert.ok(typeof (await LOCAL("/api/referentiel", { actif: "false" })).erreur === "string");
    assert.equal((await LOCAL("/api/referentiel", { actif: false })).erreur, undefined);
    assert.equal((await seuilCourant()).referentielActif, false, "un vrai booléen doit passer");

    /* Et les deux contrôles que le serveur fait sur une reprise, absents du shim. */
    assert.ok(typeof (await LOCAL("/api/reprendre", { cas: "C-0001", decision: "n'importe quoi" })).erreur === "string",
      "une décision inventée doit être refusée");
    assert.ok(typeof (await LOCAL("/api/reprendre", { cas: "C-9999", decision: "approuver" })).erreur === "string",
      "un dossier inconnu doit être refusé");
  } finally {
    delete (globalThis as unknown as { window?: unknown }).window;
    rmSync(dossier, { recursive: true, force: true });
  }
});
