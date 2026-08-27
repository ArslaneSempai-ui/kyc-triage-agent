/**
 * Every number this tool puts on a page, and where it came from.
 *
 * The line that costs the most to write is the one about the case set. "No breach in four
 * hundred files" is **measured** — run it and you get it, the draw is seeded — and the
 * four hundred files are synthetic, built by me, with a ground truth I also wrote. An
 * agent scored against cases whose answers I chose is being marked by its own author.
 *
 * The defences already in the repository are real: the agent deliberately does not
 * reimplement the scoring rule, it is compared against trivial baselines, its failures are
 * published in full, and every rate carries its interval. None of that makes a synthetic
 * case set a real one.
 *
 * What survives is narrower and worth stating exactly: **the discipline is the finding,
 * the score is illustration.** That an automated decision should carry a citation, stop
 * where it is unsure, and be scored on breaches rather than on accuracy — that holds
 * anywhere. That it reaches 58 % automation with no breach holds on my four hundred files.
 *
 * The inventory is checked by a test against the structures it describes, so it cannot
 * quietly fall behind the code.
 */

import { CONSTANTES } from "./agent.ts";
import { PLAUSIBLE } from "./sensibilite.ts";
import { REFERENTIEL_SECTORIEL } from "./referentiel.ts";
import { ALL, REGULATIONS } from "./regulations.ts";
import { genererCas } from "./cas.ts";
import { trier } from "./agent.ts";
import type { Regulation } from "./regulations.ts";
import type { Inventory } from "./provenance.ts";

/**
 * The sections this tool actually applies.
 *
 * Derived from the rules that fire, not from the shared file's contents. The shared file
 * is copied into five repositories and holds everything any of them cites; a table headed
 * "what every decision cites" listing a rule no decision here has ever applied is a small
 * lie that took a staleness check to catch.
 */
export const CITED: Regulation[] = (() => {
  /* `Set<string>` and not the inferred literal union: `as const satisfies` narrows the
   * shared table's entries, so a set built from REGULATIONS refuses a lookup by the plain
   * `string` that `ALL` carries. Same narrowing that made `figure` unreadable when
   * iterating, and the same one-word fix. */
  const cites = new Set<string>(
    genererCas(400).flatMap((c) => trier(c, 0.7, REFERENTIEL_SECTORIEL).regles)
      .map((r) => r.regulation)
      .filter((k): k is NonNullable<typeof k> => k !== null)
      .map((k) => REGULATIONS[k].cite),
  );
  return ALL.filter((r) => cites.has(r.cite));
})();

export const INVENTORY: Inventory = [
  /* ── retrieved ── */
  ...CITED.map((r) => ({
    name: r.cite,
    provenance: "retrieved" as const,
    what: r.says,
    note: `retrieved ${r.retrieved}`,
  })),

  /* ── measured ── */
  {
    name: "tauxAutomatisation",
    provenance: "measured",
    what: "share of files decided without a human",
    note: "measured on the synthetic case set below — see `genererCas`",
  },
  {
    name: "manquements",
    provenance: "measured",
    what: "files decided alone that had to go to a human — the costly error",
    note: "the error with a fine attached, counted separately from wasted analyst time",
  },
  {
    name: "escaladesInutiles",
    provenance: "measured",
    what: "files sent to an analyst for nothing",
    note: "analyst time; visible, and nobody is harmed",
  },
  {
    name: "precisionAutomatisee",
    provenance: "measured",
    what: "how often an automated decision is the right one",
    note: "published with its 95 % interval, because 400 files is not many",
  },
  {
    name: "bande",
    provenance: "measured",
    what: "the range over which each chosen constant changes nothing",
    note: "five independent draws; one draw cannot tell a threshold from a coincidence",
  },

  /* ── assumed ── */
  {
    name: "seuil",
    provenance: "assumed",
    what: "the confidence below which the agent refuses to decide",
    note: "belongs to the business, not to whoever writes the code; the screen edits it",
  },
  {
    name: "REFERENTIEL_SECTORIEL",
    provenance: "assumed",
    what: "typical annual volume by sector",
    note: "a market average, approximate like every reference table; the sweep says how wrong it may be",
  },

  /* ── chosen ── */
  {
    name: "seuilSanctionCertain",
    provenance: "chosen",
    what: "above this, a screening match is treated as unambiguous",
    note: "no regulation says where a match becomes certain; the sweep says this one decides",
  },
  {
    name: "seuilSanctionDoute",
    provenance: "chosen",
    what: "below this, a screening match is not looked at at all",
    note: "it costs breaches at the far end of its range; where it starts is under the sampling noise",
  },
  {
    name: "volumeEleve",
    provenance: "chosen",
    what: "the flat ceiling used only where no sector reference exists",
    note: "dormant with a complete table, decisive without one — not the same as irrelevant",
  },
  {
    name: "multipleAnormal",
    provenance: "chosen",
    what: "multiple of the sector norm above which a volume is examined",
    note: "no source defines an abnormal multiple; it costs breaches at 8×",
  },
  {
    name: "prudence",
    provenance: "chosen",
    what: "the margin taken against the reference table being wrong",
    note: "derived from observed reference error, not from outcomes — and the headroom is thinner than the measurement's resolution",
  },
  {
    name: "nettete",
    provenance: "chosen",
    what: "how sharp each rule's trigger is, from 0 to 1",
    note: "the ordering is defensible — an unreadable document is fuzzier than an expired one; the values are mine",
  },
  {
    name: "genererCas",
    provenance: "chosen",
    what: "the shape of the synthetic case set, and its ground truth",
    note: "an agent scored against cases whose answers I wrote is marked by its own author",
  },
];

/** What the inventory must account for, so a test can check nothing was dropped. */
export const MUST_DECLARE = {
  constants: Object.keys(CONSTANTES),
  swept: Object.keys(PLAUSIBLE),
  regulations: CITED.map((r) => r.cite),
};
