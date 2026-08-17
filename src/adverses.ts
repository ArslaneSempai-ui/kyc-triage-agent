/**
 * Files built to break the agent, rather than files drawn from the ordinary run.
 *
 * The four hundred synthetic cases are a *sample*: they cover what usually turns up, in
 * roughly the proportions it turns up in. That is the right shape for measuring a rate and
 * exactly the wrong shape for finding the failure that matters, because the failure that
 * matters is rare by construction. A generator that produced dangerous files often would
 * be a generator nobody believes.
 *
 * So these are written by hand, one per way I can think of to get a file past an agent that
 * is trying to stop. Each carries what it is attacking and what the agent is supposed to do
 * about it. They are not scored as a rate — twelve cases cannot support one — and the point
 * is not how many pass. The point is that **a case which fails here is named**, and a named
 * failure is something you can argue about.
 *
 * Two of them fail today. They are in the list anyway, marked, because a gallery of attacks
 * curated down to the ones I defend against is an advertisement.
 */

import { trier } from "./agent.ts";
import { REFERENTIEL_SECTORIEL } from "./referentiel.ts";
import { isMain } from "./cli.ts";
import type { Cas, Decision } from "./cas.ts";

export type Adverse = {
  id: string;
  /** What this file is trying to slip past, in one clause. */
  attaque: string;
  /** What a competent analyst would do, and therefore what the agent must not fall short of. */
  attendu: Decision;
  /**
   * Why the expected decision is the right one.
   *
   * Written down because "the agent got this wrong" is only actionable if somebody can
   * check that the expectation was right in the first place.
   */
  pourquoi: string;
  cas: Cas;
};

const base = (over: Partial<Cas> = {}): Cas => ({
  id: "A-0000",
  type: "particulier",
  nom: "Test Client",
  paysResidence: "FR",
  pieces: [
    { type: "identite", fournie: true, lisible: true, expireDans: 24, nomConcorde: true },
    { type: "domicile", fournie: true, lisible: true, expireDans: null, nomConcorde: true },
  ],
  beneficiaires: [],
  criblage: { correspondanceSanction: 0.1, correspondancePep: 0.1 },
  activite: { secteur: "conseil", volumeAnnuelDeclare: 150_000, paysOperation: ["FR"] },
  verite: "approuver",
  ...over,
});

const societe = (over: Partial<Cas> = {}): Cas => base({
  type: "societe",
  pieces: [
    { type: "identite", fournie: true, lisible: true, expireDans: 24, nomConcorde: true },
    { type: "domicile", fournie: true, lisible: true, expireDans: null, nomConcorde: true },
    { type: "immatriculation", fournie: true, lisible: true, expireDans: null, nomConcorde: true },
    { type: "structure", fournie: true, lisible: true, expireDans: null, nomConcorde: true },
  ],
  ...over,
});

export const ADVERSES: Adverse[] = [
  {
    id: "A-SEUIL",
    attaque: "a sanctions match parked just below the look-at-it threshold",
    attendu: "escalader",
    pourquoi:
      "0.54 against a 0.55 cut is not a cleaner match than 0.56 — it is the same evidence on " +
      "the other side of a number I chose. Anyone who can see the threshold can sit under it.",
    cas: base({ id: "A-SEUIL", criblage: { correspondanceSanction: 0.54, correspondancePep: 0.1 } }),
  },
  {
    id: "A-25PCT",
    attaque: "ownership split so no single holder reaches the 25 % identification threshold",
    attendu: "escalader",
    pourquoi:
      "Four unidentified holders at 24 % each is 96 % of a company owned by nobody the bank " +
      "has seen. `31 CFR 1010.230(d)(2)` exists precisely for this, and a rule that only " +
      "checks (d)(1) reads it as compliant.",
    cas: societe({
      id: "A-25PCT",
      beneficiaires: [
        { nom: "A", part: 24, identifie: false },
        { nom: "B", part: 24, identifie: false },
        { nom: "C", part: 24, identifie: false },
        { nom: "D", part: 24, identifie: false },
      ],
    }),
  },
  {
    id: "A-VOLUME",
    attaque: "a volume just under the sector multiple, in a monitored jurisdiction",
    attendu: "escalader",
    pourquoi:
      "3.4× the sector norm is not meaningfully different from 3.5×, and combined with a " +
      "monitored jurisdiction it is the pattern the file is supposed to catch.",
    cas: base({
      id: "A-VOLUME",
      activite: { secteur: "conseil", volumeAnnuelDeclare: 470_000, paysOperation: ["PA"] },
    }),
  },
  {
    id: "A-PEP-BAS",
    attaque: "a PEP match below the certainty threshold, with nothing else on the file",
    attendu: "escalader",
    pourquoi:
      "A politically exposed person is a status, not a score. 0.80 on a PEP list is a name " +
      "worth ten minutes of somebody's time, and the agent treats it as noise.",
    cas: base({ id: "A-PEP-BAS", criblage: { correspondanceSanction: 0.1, correspondancePep: 0.8 } }),
  },
  {
    id: "A-PIECE-LIMITE",
    attaque: "an identity document expiring in one month",
    attendu: "complement",
    pourquoi:
      "The rule checks whether a document has expired. A passport with 30 days left passes " +
      "today and fails before the relationship is a quarter old.",
    cas: base({
      id: "A-PIECE-LIMITE",
      pieces: [
        { type: "identite", fournie: true, lisible: true, expireDans: 1, nomConcorde: true },
        { type: "domicile", fournie: true, lisible: true, expireDans: null, nomConcorde: true },
      ],
    }),
  },
  {
    id: "A-SECTEUR-INCONNU",
    attaque: "a sector the reference table does not list",
    attendu: "escalader",
    pourquoi:
      "With no norm to compare against, the agent falls back to a flat ceiling — and the " +
      "sweep says that ceiling decides a great deal when the table has a hole in it. A file " +
      "the reference cannot judge should reach a human, not a default.",
    cas: base({
      id: "A-SECTEUR-INCONNU",
      activite: { secteur: "casino en ligne", volumeAnnuelDeclare: 1_400_000, paysOperation: ["MT"] },
    }),
  },
  {
    id: "A-CUMUL-FAIBLE",
    attaque: "several weak signals, none of which trips a rule on its own",
    attendu: "escalader",
    pourquoi:
      "A borderline sanctions score, a borderline PEP score, an unreadable document and a " +
      "monitored jurisdiction. No single rule fires hard; a human reading the file would not " +
      "approve it. The agent has no notion of accumulation, and that is the gap.",
    cas: base({
      id: "A-CUMUL-FAIBLE",
      criblage: { correspondanceSanction: 0.5, correspondancePep: 0.7 },
      pieces: [
        { type: "identite", fournie: true, lisible: false, expireDans: 24, nomConcorde: true },
        { type: "domicile", fournie: true, lisible: true, expireDans: null, nomConcorde: true },
      ],
      activite: { secteur: "conseil", volumeAnnuelDeclare: 400_000, paysOperation: ["AE"] },
    }),
  },
  {
    id: "A-NOM-VIDE",
    attaque: "an empty name with a clean screening score",
    attendu: "complement",
    pourquoi:
      "Screening an empty string returns no match, which reads identically to a clean " +
      "customer. Absence of a name is absence of a check, and the two must not look the same.",
    cas: base({ id: "A-NOM-VIDE", nom: "" }),
  },
  {
    id: "A-BE-100",
    attaque: "a company whose identified ownership sums to exactly 75 %",
    attendu: "complement",
    pourquoi:
      "The coverage rule fires below 75 %. At exactly 75 % a quarter of the company is " +
      "unaccounted for and the rule is silent — a boundary chosen by me, sitting one " +
      "percentage point from a different answer.",
    cas: societe({
      id: "A-BE-100",
      beneficiaires: [
        { nom: "A", part: 40, identifie: true },
        { nom: "B", part: 35, identifie: true },
        { nom: "C", part: 25, identifie: false },
      ],
    }),
  },
  {
    id: "A-PAYS-TRANSIT",
    attaque: "a high-risk jurisdiction reached through an intermediate one",
    attendu: "escalader",
    pourquoi:
      "Operations declared into the UAE, which is monitored, by a business whose stated " +
      "activity has no reason to be there. The chain matters and the agent sees one hop.",
    cas: base({
      id: "A-PAYS-TRANSIT",
      activite: { secteur: "restauration", volumeAnnuelDeclare: 900_000, paysOperation: ["AE", "FR"] },
    }),
  },
  {
    id: "A-VOLUME-NUL",
    attaque: "a declared annual volume of zero",
    attendu: "complement",
    pourquoi:
      "Zero is below every ceiling and above no multiple, so every volume rule stays quiet. " +
      "A business declaring no activity at all is not a low-risk business, it is an " +
      "incomplete file.",
    cas: base({
      id: "A-VOLUME-NUL",
      activite: { secteur: "import-export", volumeAnnuelDeclare: 0, paysOperation: ["FR"] },
    }),
  },
  {
    id: "A-SANCTION-NETTE",
    attaque: "an unambiguous sanctions match — the one case that must never slip",
    attendu: "escalader",
    pourquoi:
      "A control, not an attack. If this ever stops escalating, the gallery above is " +
      "measuring nothing at all.",
    cas: base({ id: "A-SANCTION-NETTE", criblage: { correspondanceSanction: 0.97, correspondancePep: 0.1 } }),
  },
];

export type Resultat = { adverse: Adverse; obtenu: Decision; tenu: boolean };

const RANG: Record<Decision, number> = { approuver: 0, complement: 1, escalader: 2 };

export function eprouver(seuil = 0.7): Resultat[] {
  return ADVERSES.map((a) => {
    const v = trier(a.cas, seuil, REFERENTIEL_SECTORIEL);
    return {
      adverse: a,
      obtenu: v.decision,
      /*
       * Held means the agent was at least as cautious as required, not exactly equal.
       * Escalating a file that only needed a document request is a waste of analyst time,
       * never a breach — and grading those as failures would push the tool toward the one
       * error that costs money.
       */
      tenu: RANG[v.decision] >= RANG[a.attendu],
    };
  });
}

if (isMain(import.meta)) {
  const r = eprouver();
  const held = r.filter((x) => x.tenu).length;

  console.log(`\n${ADVERSES.length} files written to break the agent — ${held} held, ${r.length - held} did not\n`);
  console.log("  case                what it attacks                                          expected   got");
  console.log("  " + "─".repeat(100));

  for (const x of r) {
    console.log(
      `  ${x.tenu ? " " : "✗"} ${x.adverse.id.padEnd(18)}${x.adverse.attaque.slice(0, 54).padEnd(56)}` +
      `${x.adverse.attendu.padEnd(11)}${x.obtenu}`,
    );
  }

  const failed = r.filter((x) => !x.tenu);
  if (failed.length > 0) {
    console.log("\nWhat gets through, and why it matters\n");
    for (const x of failed) {
      console.log(`  ${x.adverse.id} — expected ${x.adverse.attendu}, got ${x.obtenu}`);
      console.log(`    ${x.adverse.pourquoi.replace(/\s+/g, " ")}\n`);
    }
  }

  console.log(
    "These are not scored as a rate: twelve hand-written cases cannot support one, and the\n" +
    "number that held is not the point. The point is that what fails is named, and a named\n" +
    "failure is something a reviewer can argue about.\n",
  );
}
