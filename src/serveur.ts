import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import {
  demarrer, fileDAttente, traitees, reprendre, reglerSeuil, basculerReferentiel, chiffres,
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
      if (brut.length > 100_000) rejeter(new Error("requête trop volumineuse"));
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
      // Le fichier change pendant le développement : jamais de copie périmée.
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store, must-revalidate",
      });
      res.end(html);
      return;
    }

    if (url.pathname === "/api/etat") {
      return json(res, { chiffres: chiffres(), file: fileDAttente(), traitees: traitees() });
    }

    if (url.pathname === "/api/reprendre" && req.method === "POST") {
      const { cas, decision, motif } = await corps(req);
      const d = String(decision ?? "") as Decision;
      if (!DECISIONS.has(d)) return json(res, { erreur: `Décision inconnue : ${decision}` }, 400);
      reprendre(String(cas ?? ""), d, String(motif ?? ""));
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

    /** Le compromis complet, pour l'écran comme pour le README. */
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
    // L'erreur remonte à l'écran plutôt que dans un journal que personne ne lit.
    json(res, { erreur: erreur instanceof Error ? erreur.message : String(erreur) }, 500);
  }
});

demarrer(400);
serveur.listen(PORT, () => {
  console.log(`Triage des entrées en relation → http://localhost:${PORT}`);
});
