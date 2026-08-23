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
import { fileURLToPath } from "node:url";
import { brancherPersistance, demarrer, chiffres, reglerSeuil } from "./file.ts";

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
