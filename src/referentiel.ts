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
export function netteteVolume(rapport: number): number {
  if (rapport >= 6) return 0.95;
  if (rapport >= MULTIPLE_ANORMAL) return 0.45 + ((rapport - MULTIPLE_ANORMAL) / (6 - MULTIPLE_ANORMAL)) * 0.45;
  return 0.3;
}
