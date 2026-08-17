import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  demarrer, fileDAttente, traitees, reprendre, reglerSeuil, basculerReferentiel, chiffres,
  reinitialiser, brancherPersistance,
} from "./file.ts";
import { balayer, mesurer } from "./mesurer.ts";
import { lireCas } from "./file.ts";
import { REFERENTIEL_SECTORIEL } from "./referentiel.ts";
import type { Decision } from "./cas.ts";

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

const DECISIONS = new Set<Decision>(["approuver", "complement", "escalader"]);

const serveur = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

  try {
    if (url.pathname === "/") {
      const html = readFileSync(new URL("./ui.html", import.meta.url).pathname, "utf8");
      // The file changes during development: never serve a stale copy.
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store, must-revalidate",
      });
      res.end(html);
      return;
    }

    if (url.pathname === "/registre.css") {
      const css = readFileSync(new URL("./registre.css", import.meta.url).pathname, "utf8");
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
      reprendre(String(cas ?? ""), d, String(motif ?? ""));
      return json(res, { chiffres: chiffres(), file: fileDAttente(), traitees: traitees() });
    }

    if (url.pathname === "/api/reinitialiser" && req.method === "POST") {
      reinitialiser();
      return json(res, { chiffres: chiffres(), file: fileDAttente(), traitees: traitees() });
    }

    if (url.pathname === "/api/seuil" && req.method === "POST") {
      const { seuil } = await corps(req);
      reglerSeuil(Number(seuil));
      return json(res, { chiffres: chiffres(), file: fileDAttente(), traitees: traitees() });
    }

    if (url.pathname === "/api/referentiel" && req.method === "POST") {
      const { actif } = await corps(req);
      basculerReferentiel(Boolean(actif));
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
const FICHIER = new URL("../data/etat.json", import.meta.url).pathname;
brancherPersistance({
  lire: () => { try { return readFileSync(FICHIER, "utf8"); } catch { return null; } },
  ecrire: (contenu) => { mkdirSync(dirname(FICHIER), { recursive: true }); writeFileSync(FICHIER, contenu); },
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
