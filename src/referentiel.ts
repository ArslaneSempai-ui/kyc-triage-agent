/**
 * Le contexte métier que l'agent n'avait pas.
 *
 * Première version : l'agent appliquait un plafond unique de 1,5 M€ à tous les secteurs.
 * Résultat, il envoyait chez un analyste 125 dossiers parfaitement ordinaires — un
 * import-export à 3 M€ n'a rien d'anormal, un cabinet de conseil à 3 M€ en a beaucoup.
 *
 * Ce que la mesure a montré, et qui est le vrai enseignement du projet : ce n'est pas le
 * seuil d'escalade qui coûtait cher, c'est une règle mal informée. On ne règle pas ça en
 * bougeant un curseur. La confiance basse était le symptôme correct d'un manque réel.
 *
 * Les valeurs ci-dessous sont approximatives, comme l'est tout référentiel réel : elles
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

/** Au-delà de ce multiple du volume habituel du secteur, le montant mérite un examen. */
export const MULTIPLE_ANORMAL = 3.5;

/**
 * Netteté du constat de volume.
 *
 * Un dossier à douze fois la norme du secteur est un constat net. À trois fois et demie
 * tout juste, c'est un jugement — et l'agent doit le dire plutôt que de trancher.
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
