import { fileURLToPath } from "node:url";
/**
 * Build the hosted demo.
 *
 * "Clone this and run `npm start`" is a request most readers decline. A link they can click
 * is a different artefact — and a *static snapshot* of one is worse than nothing, because
 * the first thing anyone does is drag the confidence line and watch what it does not move.
 *
 * So the demo is not a snapshot. The agent, the case generator and the review queue are
 * pure arithmetic on a seeded draw, with no database and no network, which means the whole
 * thing compiles to ES modules and runs in the browser. Every control works, and the queue
 * each visitor builds is theirs alone — it lives in the tab and dies with it.
 *
 * `src/ui.html` stays the single source. The only difference on the hosted side is a
 * `window.LOCAL` shim answering the same routes with the same shapes. A demo that has
 * drifted from the tool is a liability, so it is built such that it cannot.
 */

import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync } from "node:fs";
import { isMain } from "./cli.ts";

const root = fileURLToPath(new URL("..", import.meta.url));

const SHIM = `<script>window.LOCAL_PRET = new Promise((r) => { window.LOCAL_POSE = r; });</script>\n<script type="module">
import {
  demarrer, fileDAttente, traitees, reprendre, reglerSeuil, basculerReferentiel, chiffres,
  reinitialiser, lireCas,
} from "./js/file.js";
import { balayer, mesurer } from "./js/mesurer.js";
import { REFERENTIEL_SECTORIEL } from "./js/referentiel.js";

demarrer(400);

const etat = () => ({ chiffres: chiffres(), file: fileDAttente(), traitees: traitees() });

window.LOCAL = async (chemin, corps) => {
  if (chemin === "/api/etat") return etat();

  if (chemin === "/api/reprendre") {
    reprendre(String(corps.cas ?? ""), corps.decision, String(corps.motif ?? ""));
    return etat();
  }
  if (chemin === "/api/reinitialiser") { reinitialiser(); return etat(); }
  if (chemin === "/api/seuil") { reglerSeuil(Number(corps.seuil)); return etat(); }
  if (chemin === "/api/referentiel") { basculerReferentiel(Boolean(corps.actif)); return etat(); }

  if (chemin === "/api/compromis") {
    const cas = lireCas();
    return {
      avec: balayer(cas, undefined, REFERENTIEL_SECTORIEL),
      sans: balayer(cas, undefined, undefined),
      actuel: mesurer(cas, chiffres().seuil, chiffres().referentielActif ? REFERENTIEL_SECTORIEL : undefined),
    };
  }
  return {};
};

/* Le shim est en place : l'écran peut partir. La balise classique qui a créé la promesse
 * s'exécute avant tout module, donc personne ne peut la manquer. */
window.LOCAL_POSE && window.LOCAL_POSE();
` + "</" + "script>\n";

/**
 * A banner on the hosted page and nowhere else.
 *
 * Someone arriving from a link has not read the README and does not know the files are
 * synthetic. Saying it on the page costs one line and stops the demo being mistaken for a
 * measurement of real onboarding.
 */
const BANNER = `<p class="renvoi" style="margin-bottom:1.5rem">
This runs entirely in your browser — no server, no data leaves your machine, and the review
queue you build is yours alone. <b>Drag the threshold line</b> across the confidence
distribution and watch what it moves — and what it never will. The 400 client files are
<b>synthetic and seeded</b>; the regulations each decision cites are real and linked.
<a href="https://github.com/ArslaneSempai-ui/kyc-triage-agent">Source and method</a>.
</p>`;

export function build(): void {
  const docs = root + "docs";
  mkdirSync(docs, { recursive: true });

  let html = readFileSync(root + "src/ui.html", "utf8");
  html = html.replace('href="/registre.css"', 'href="registre.css"');
  html = html.replace('from "/graphes.js"', 'from "./graphes.js"');

  /* Under the title, not above it: a note about how the demo works, placed before the page
   * has said what it is, reads as a cookie notice and gets skipped exactly like one. */
  const header = html.indexOf('class="haut"');
  const closes = html.indexOf("\n  </div>", header) + "\n  </div>".length;
  html = html.slice(0, closes) + "\n" + BANNER + html.slice(closes);
  html = html.replace('<script type="module">', SHIM + '<script type="module">');
  writeFileSync(docs + "/index.html", html);

  cpSync(root + "src/registre.css", docs + "/registre.css");
  cpSync(root + "src/graphes.js", docs + "/graphes.js");
  if (existsSync(root + "images")) cpSync(root + "images", docs + "/images", { recursive: true });
  writeFileSync(docs + "/.nojekyll", "");

  console.log("docs/ built — commit it and enable GitHub Pages on the docs folder");
}

if (isMain(import.meta)) build();
