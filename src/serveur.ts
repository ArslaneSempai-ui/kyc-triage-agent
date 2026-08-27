import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, writeFileSync, mkdirSync, renameSync, copyFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  demarrer, fileDAttente, traitees, reprendre, reglerSeuil, basculerReferentiel, chiffres,
  reinitialiser, brancherPersistance,
  nombreRecu as nombre, booleenRecu as booleen, DECISIONS,
} from "./file.ts";
import { balayer, mesurer } from "./mesurer.ts";
import { lireCas } from "./file.ts";
import { REFERENTIEL_SECTORIEL } from "./referentiel.ts";
import type { Decision } from "./cas.ts";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT ?? 4500);

function json(res: ServerResponse, corps: unknown, code = 200): void {
  const charge = JSON.stringify(corps);
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(charge),
  });
  res.end(charge);
}

function corps(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resoudre, rejeter) => {
    let brut = "";
    req.on("data", (bloc) => {
      brut += bloc;
      if (brut.length > 100_000) rejeter(new Error("request too large"));
    });
    req.on("end", () => {
      try { resoudre(brut ? JSON.parse(brut) : {}); } catch (e) { rejeter(e); }
    });
    req.on("error", rejeter);
  });
}

/*
 * A SETTING THAT WAS NOT SENT MUST NOT BE READ AS THE MOST PERMISSIVE ONE.
 *
 * `reglerSeuil(Number(seuil))` looks like it validates and does not: the coercion runs
 * first, and `Number(null)`, `Number("")`, `Number([])` and `Number(false)` are all `0`,
 * which the clamp then lifts to 0.30 — the bottom of the range. Verified against the
 * running server: one POST of `{"seuil": null}` and the threshold read back 0.30.
 *
 * The direction matters here. 0.30 is the *least* cautious setting this tool offers, so
 * every spelling of "no value" moved a KYC threshold towards escalating less, silently,
 * with a 200. `undefined` was the only one handled correctly, by accident — `Number` maps
 * it to NaN.
 *
 * `Boolean(actif)` has the same shape and a sharper edge: `Boolean("false")` is `true`, so
 * a client sending the *string* "false" — what a form field or a query parameter gives you
 * — switched the sectoral reference on. Measured the same way.
 *
 * JSON has a number type and a boolean type. The screen sends both. Ask for them.
 *
 * The checks themselves moved into `file.ts` — this route was the only door that had them,
 * and the hosted shim and the saved-state loader each let the same four values straight in.
 * A guard written out once per door gets fixed once per door.
 */

const serveur = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

  try {
    if (url.pathname === "/") {
      const html = readFileSync(fileURLToPath(new URL("./ui.html", import.meta.url)), "utf8");
      // The file changes during development: never serve a stale copy.
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store, must-revalidate",
      });
      res.end(html);
      return;
    }

    if (url.pathname === "/graphes.js") {
      const js = readFileSync(fileURLToPath(new URL("./graphes.js", import.meta.url)), "utf8");
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" });
      res.end(js);
      return;
    }

    if (url.pathname === "/registre.css") {
      const css = readFileSync(fileURLToPath(new URL("./registre.css", import.meta.url)), "utf8");
      res.writeHead(200, { "content-type": "text/css; charset=utf-8", "cache-control": "no-store" });
      res.end(css);
      return;
    }

    if (url.pathname === "/api/etat") {
      return json(res, { chiffres: chiffres(), file: fileDAttente(), traitees: traitees() });
    }

    if (url.pathname === "/api/reprendre" && req.method === "POST") {
      const { cas, decision, motif } = await corps(req);
      const d = String(decision ?? "") as Decision;
      if (!DECISIONS.has(d)) return json(res, { erreur: `Unknown decision: ${decision}` }, 400);
      /* An id the client made up is the client's mistake, not the server's: 400, not 500. */
      const id = String(cas ?? "");
      if (!lireCas().some((c) => c.id === id)) return json(res, { erreur: `Unknown file: ${id}` }, 400);
      reprendre(id, d, String(motif ?? ""));
      return json(res, { chiffres: chiffres(), file: fileDAttente(), traitees: traitees() });
    }

    if (url.pathname === "/api/reinitialiser" && req.method === "POST") {
      reinitialiser();
      return json(res, { chiffres: chiffres(), file: fileDAttente(), traitees: traitees() });
    }

    if (url.pathname === "/api/seuil" && req.method === "POST") {
      const { seuil } = await corps(req);
      const v = nombre(seuil);
      if (v === undefined) return json(res, { erreur: `Threshold is not a number: ${JSON.stringify(seuil)}` }, 400);
      reglerSeuil(v);
      return json(res, { chiffres: chiffres(), file: fileDAttente(), traitees: traitees() });
    }

    if (url.pathname === "/api/referentiel" && req.method === "POST") {
      const { actif } = await corps(req);
      const v = booleen(actif);
      if (v === undefined) return json(res, { erreur: `Not a boolean: ${JSON.stringify(actif)}` }, 400);
      basculerReferentiel(v);
      return json(res, { chiffres: chiffres(), file: fileDAttente(), traitees: traitees() });
    }

    /** The full trade-off, for the screen and for the README alike. */
    if (url.pathname === "/api/compromis") {
      const cas = lireCas();
      return json(res, {
        avec: balayer(cas, undefined, REFERENTIEL_SECTORIEL),
        sans: balayer(cas, undefined, undefined),
        actuel: mesurer(cas, chiffres().seuil, chiffres().referentielActif ? REFERENTIEL_SECTORIEL : undefined),
      });
    }

    res.writeHead(404).end("introuvable");
  } catch (erreur) {
    // The error reaches the screen rather than a log nobody reads.
    json(res, { erreur: erreur instanceof Error ? erreur.message : String(erreur) }, 500);
  }
});

/*
 * Running as a server, the queue is kept on disk so a demonstration survives a restart.
 * The queue module itself knows nothing about that — see `brancherPersistance`.
 */
const FICHIER = fileURLToPath(new URL("../data/etat.json", import.meta.url));

/*
 * THREE SITUATIONS THAT WERE ALL ANSWERED WITH `null`.
 *
 * `try { return readFileSync(…) } catch { return null }` treated "no file yet" — normal on
 * a first run — the same as "the file is there and I could not read it". The queue then
 * started empty, and the very next decision called `sauver()`, which overwrote the file.
 * The operator's recorded human decisions were gone, and nothing was printed at any point.
 *
 * Measured on 23 August 2026 on a copy: a state file truncated mid-object started a server
 * that reported `reprises = 0` and the default threshold, said nothing, and after a single
 * POST the file on disk was 64 bytes containing `"reprises": []`. The human decision that
 * had been in it was unrecoverable.
 *
 * The tool could produce that input itself. `writeFileSync` truncates and then writes, so
 * a Ctrl-C in the wrong half-second during a demonstration leaves exactly the file above.
 * Writing through a temporary name and renaming closes that: `rename` is atomic, so a
 * reader sees the old file or the new one, never half of either.
 *
 * What is left is reported, not swallowed. A file we could not understand is copied aside
 * before anything else touches it — nothing is deleted, and the copy is named so the
 * operator can find it.
 */
/** Keep what we could not read, before anything is written over it. Nothing is deleted. */
function garderDeCote(raison: string): void {
  const copie = `${FICHIER}.illisible-${Date.now()}`;
  try { copyFileSync(FICHIER, copie); } catch { /* not copyable either: the message below is what is left */ }
  console.error(`unreadable state (${raison}) — a copy has been kept at ${copie}`);
  console.error("the server restarts from an empty queue and will overwrite the file on the first decision");
}

brancherPersistance({
  lire: () => {
    try {
      return readFileSync(FICHIER, "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; // first run: nothing saved yet
      garderDeCote((e as Error).message);
      return null;
    }
  },
  ecrire: (contenu) => {
    mkdirSync(dirname(FICHIER), { recursive: true });
    const temporaire = `${FICHIER}.en-cours`;
    writeFileSync(temporaire, contenu);
    renameSync(temporaire, FICHIER);
  },
  illisible: (raison) => garderDeCote(raison),
});

demarrer(400);
/*
 * Bind the loopback interface, not every interface.
 *
 * `listen(PORT)` on its own has Node listen on `::` — the tool becomes reachable by
 * anyone on the same network. On a café wifi that exposes a screen which reads
 * des dossiers clients.
 */
serveur.listen(PORT, "127.0.0.1", () => {
  console.log(`Onboarding triage → http://localhost:${PORT}`);
});
