/**
 * The business context the agent did not have.
 *
 * First version: the agent applied a single €1.5M ceiling to every sector. The result was
 * 125 perfectly ordinary files sent to an analyst — an import-export business at €3M is
 * unremarkable, a consultancy at €3M is very remarkable indeed.
 *
 * What the measurement showed, and it is the real lesson of the project: what cost money
 * was not the escalation threshold, it was a badly informed rule. You do not fix that by
 * dragging a slider. The low confidence was the correct symptom of a real gap.
 *
 * The values below are approximate, as every real reference table is: they
 * viennent d'une moyenne de place, pas des dossiers qu'on est en train de juger.
 */

export type Referentiel = Map<string, number>;

export const REFERENTIEL_SECTORIEL: Referentiel = new Map([
  ["conseil", 165_000],
  ["commerce de detail", 500_000],
  ["restauration", 295_000],
  ["immobilier", 2_600_000],
  ["crypto-actifs", 1_250_000],
  ["import-export", 3_400_000],
  ["art et antiquites", 820_000],
]);

/** Above this multiple of the sector's usual volume, the amount deserves a look. */
export const MULTIPLE_ANORMAL = 3.5;

/**
 * How sharp the volume finding is.
 *
 * A file at twelve times the sector norm is a sharp finding. At barely three and a half
 * times it is a judgement — and the agent should say so rather than decide.
 */
export function netteteVolume(rapport: number, multiple = MULTIPLE_ANORMAL): number {
  const net = Math.max(multiple + 0.5, 6);
  if (rapport >= net) return 0.95;
  if (rapport >= multiple) return 0.45 + ((rapport - multiple) / (net - multiple)) * 0.45;
  return 0.3;
}

/**
 * The margin taken against the reference being wrong.
 *
 * A reference table is approximate — the one above sits between −11 % and +14 % of the
 * true sector norms, which is ordinary for market averages. The sensitivity sweep showed
 * that the two directions do not cost the same:
 *
 *   understate a norm  ->  the agent escalates work it could have handled.
 *                          Analyst time. Visible. Nobody is harmed.
 *   overstate a norm   ->  files are approved uncontrolled.
 *                          The error with a fine attached.
 *
 * Worse, overstating improves every figure a dashboard shows — more automation, fewer
 * wasted escalations — while producing the only failure that carries a regulatory cost.
 * That is a perverse incentive, and the way out is to build the margin in rather than
 * trust the table.
 *
 * The factor is derived from the largest overstatement observed (+14 %, on crypto-assets):
 * 1 / 1.14 ≈ 0.88, rounded down to 0.85. It is NOT chosen by looking at which value makes
 * the results look best — that would be fitting the answer, which is the error this whole
 * repository exists to catch.
 */
export const PRUDENCE = 0.85;

/*
 * There is deliberately no `referentielPrudent` helper here.
 *
 * There was one, unused, and it was a trap: the agent already multiplies every row it
 * reads by PRUDENCE. Anything passing a pre-discounted table in would have taken the
 * margin twice — 0.72 instead of 0.85 — and the only visible symptom would have been
 * more escalations, which reads like caution rather than like a bug.
 */
