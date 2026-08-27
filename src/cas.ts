/**
 * The onboarding files, and their ground truth.
 *
 * Everything is synthetic and says so. A real set cannot leave a bank, and learning to
 * measure on files nobody can publish amounts to having nothing
 * pouvoir montrer.
 *
 * The draw is deterministic: without a fixed seed two measurements cannot be compared,
 * and you end up crediting a code change for what was only a different sample.
 */

export type Decision = "approuver" | "complement" | "escalader";

export type Piece = {
  type: "identite" | "domicile" | "immatriculation" | "structure";
  fournie: boolean;
  lisible: boolean;
  /** Months until expiry. Negative means already expired. */
  expireDans: number | null;
  /** Does the name on the document match the declared name? */
  nomConcorde: boolean;
};

export type Beneficiaire = { nom: string; part: number; identifie: boolean };

export type Cas = {
  id: string;
  type: "particulier" | "societe";
  nom: string;
  paysResidence: string;
  pieces: Piece[];
  beneficiaires: Beneficiaire[];
  criblage: {
    /**
     * Strength of the match against a list, 0 to 1. The point that matters in practice:
     * une correspondance n'est jamais binaire. « Mohamed Ali » contre une liste de
     * sanctions list returns dozens of near-namesakes, and that is where the
     * travail — pas sur les cas nets.
     */
    correspondanceSanction: number;
    correspondancePep: number;
  };
  activite: { secteur: string; volumeAnnuelDeclare: number; paysOperation: string[] };
  /*
   * L'UNITÉ DE `volumeAnnuelDeclare`, DÉCLARÉE UNE FOIS, À CÔTÉ DU CHAMP QU'ELLE QUALIFIE.
   *
   * Le champ est un nombre nu ; sa devise vivait tapée à la main sur cinq sites de rendu —
   * quatre « € » dans les constats de l'agent et un « EUR » dans la lecture d'un échec.
   * Cinq copies d'une même affirmation ne valent pas cinq fois plus sûr : ce sont cinq
   * occasions de diverger, et c'est déjà arrivé dans un dépôt voisin, où le même chiffre
   * sortait en dollars dans le README et en euros dans une autre commande.
   *
   * Les seuils réglementaires, eux, ne se lisent PAS ici : ils sont en dollars, ils sont
   * cités d'un texte de loi, et ils vivent dans `regulations.ts` avec leur source et leur
   * date de relevé. Une devise de rendu et un seuil cité ne sont pas la même chose.
   */
  /** What an experienced analyst would have decided. Used only to score the agent. */
  verite: Decision;
};

/* piege:ok devise-tapee — c'est ICI que la devise est déclarée, et c'est précisément le
   remède de la règle : « lire la devise dans la table qui déclare les unités des montants ».
   Une table déclarante contient forcément le symbole qu'elle déclare ; la signaler
   reviendrait à interdire le seul endroit où il a le droit d'être écrit. Ce que la règle
   traque, ce sont les COPIES de cette affirmation dans les sites de rendu — il n'y en a plus. */
/** The unit every `volumeAnnuelDeclare` is expressed in. Rendering reads it here. */
export const MONTANTS = { symbole: "€", code: "EUR" } as const;

const PAYS_RISQUE = new Set(["IR", "KP", "SY", "MM", "AF"]);
const PAYS_SURVEILLES = new Set(["PA", "AE", "KY", "VG", "SC"]);
const PAYS_STANDARD = ["FR", "GR", "DE", "ES", "IT", "BE", "NL", "PT", "US", "GB"];

const SECTEURS = [
  { nom: "conseil", volumeTypique: 180_000 },
  { nom: "commerce de detail", volumeTypique: 450_000 },
  { nom: "restauration", volumeTypique: 320_000 },
  { nom: "immobilier", volumeTypique: 2_400_000 },
  { nom: "crypto-actifs", volumeTypique: 1_100_000 },
  { nom: "import-export", volumeTypique: 3_800_000 },
  { nom: "art et antiquites", volumeTypique: 900_000 },
];

const PRENOMS = ["Amel", "Julien", "Sofia", "Marcus", "Leila", "Tomas", "Nadia", "Piotr", "Ines", "Karim"];
const NOMS = ["Berger", "Okonkwo", "Vasquez", "Lindqvist", "Haddad", "Novak", "Ferreira", "Mbeki", "Rossi", "Chen"];
const SUFFIXES = ["Trading", "Holdings", "Consulting", "Partners", "Logistics", "Ventures"];

/**
 * A linear congruential generator. Thirty years old and perfectly sufficient: what is
 * wanted is a reproducible sample, not cryptography.
 */
function tirage(graine: number) {
  let etat = graine >>> 0;
  return () => {
    etat = (etat * 1_664_525 + 1_013_904_223) >>> 0;
    return etat / 4_294_967_296;
  };
}

const parmi = <T,>(r: () => number, liste: T[]): T => liste[Math.floor(r() * liste.length)];
const entre = (r: () => number, a: number, b: number) => a + r() * (b - a);

function piecesAttendues(type: Cas["type"]): Piece["type"][] {
  return type === "societe"
    ? ["identite", "domicile", "immatriculation", "structure"]
    : ["identite", "domicile"];
}

/**
 * The ground truth follows the procedure, in the order an analyst applies it.
 *
 * L'ordre compte et n'est pas arbitraire : une correspondance de sanction l'emporte sur
 * a missing document. Asking someone who appears on a list for a proof of address is
 * tipping them off.
 */
function decisionAttendue(c: Omit<Cas, "verite">): Decision {
  if (c.criblage.correspondanceSanction >= 0.85) return "escalader";
  if (PAYS_RISQUE.has(c.paysResidence)) return "escalader";
  if (c.activite.paysOperation.some((p) => PAYS_RISQUE.has(p))) return "escalader";
  if (c.criblage.correspondancePep >= 0.85) return "escalader";

  // Une correspondance ambiguë n'est ni un blanchiment ni un homonyme : c'est
  // exactement le dossier qui doit atterrir chez un humain.
  if (c.criblage.correspondanceSanction >= 0.55) return "escalader";

  const attendues = piecesAttendues(c.type);
  const manquante = attendues.some((t) => {
    const p = c.pieces.find((x) => x.type === t);
    return !p || !p.fournie || !p.lisible || !p.nomConcorde ||
      (p.expireDans !== null && p.expireDans <= 0);
  });
  if (manquante) return "complement";

  if (c.type === "societe") {
    const couvert = c.beneficiaires.filter((b) => b.identifie).reduce((s, b) => s + b.part, 0);
    // The usual regulatory threshold: any holder above 25 % must be identified.
    if (couvert < 75) return "complement";
    if (c.beneficiaires.some((b) => b.part >= 25 && !b.identifie)) return "complement";
  }

  /*
   * The second test used `secteur!` — a non-null assertion on the very value the line above
   * it admits may be absent. The `&&` on the first test is the author saying "this can be
   * undefined"; the `!` on the second is the same author telling the compiler it cannot.
   * One of the two is wrong, and it is the one that throws: any file whose sector is not in
   * `SECTEURS` crashes here with `Cannot read properties of undefined`.
   *
   * Nothing reaches it today — the generator only ever draws a sector from this list — so
   * this is a trap rather than a failure. It is a baited one: the agent has a whole rule for
   * the sector-not-in-the-table case (`R-SECT`), the adversarial gallery has a case built on
   * it (`A-SECTEUR-INCONNU`, sector "casino en ligne"), and that case only escapes because
   * `adverses.ts` writes its ground truth by hand instead of deriving it. The first person to
   * derive it gets the crash.
   *
   * Without a sector norm there is nothing to be a multiple of, so the rule cannot fire —
   * which is the same answer the line above already gives.
   */
  const secteur = SECTEURS.find((s) => s.nom === c.activite.secteur);
  if (secteur === undefined) return "approuver";
  if (c.activite.volumeAnnuelDeclare > secteur.volumeTypique * 4) return "escalader";
  if (c.activite.paysOperation.some((p) => PAYS_SURVEILLES.has(p)) &&
      c.activite.volumeAnnuelDeclare > secteur.volumeTypique * 2) return "escalader";

  return "approuver";
}

function unCas(r: () => number, n: number): Cas {
  const type: Cas["type"] = r() < 0.45 ? "societe" : "particulier";
  const nom = type === "societe"
    ? `${parmi(r, NOMS)} ${parmi(r, SUFFIXES)}`
    : `${parmi(r, PRENOMS)} ${parmi(r, NOMS)}`;

  const paysResidence = r() < 0.06
    ? parmi(r, [...PAYS_RISQUE])
    : r() < 0.16 ? parmi(r, [...PAYS_SURVEILLES]) : parmi(r, PAYS_STANDARD);

  const pieces: Piece[] = piecesAttendues(type).map((t) => {
    const fournie = r() > 0.12;
    return {
      type: t,
      fournie,
      lisible: fournie && r() > 0.08,
      expireDans: t === "identite" ? Math.round(entre(r, -8, 60)) : null,
      nomConcorde: fournie && r() > 0.07,
    };
  });

  const beneficiaires: Beneficiaire[] = [];
  if (type === "societe") {
    let reste = 100;
    const combien = 1 + Math.floor(r() * 3);
    for (let i = 0; i < combien; i++) {
      const part = i === combien - 1 ? reste : Math.round(entre(r, 15, reste - 10));
      reste -= part;
      if (part <= 0) break;
      beneficiaires.push({ nom: `${parmi(r, PRENOMS)} ${parmi(r, NOMS)}`, part, identifie: r() > 0.22 });
    }
  }

  const secteur = parmi(r, SECTEURS);
  const exagere = r() < 0.14;
  const paysOperation = [paysResidence];
  if (r() < 0.3) paysOperation.push(parmi(r, [...PAYS_SURVEILLES]));
  if (r() < 0.05) paysOperation.push(parmi(r, [...PAYS_RISQUE]));

  const brut = {
    id: `C-${String(n).padStart(4, "0")}`,
    type, nom, paysResidence, pieces, beneficiaires,
    criblage: {
      // The bulk of files look like nothing at all. A minority look a little like
      // something, and that minority is what costs money.
      correspondanceSanction: r() < 0.08 ? entre(r, 0.5, 0.99) : entre(r, 0, 0.35),
      correspondancePep: r() < 0.1 ? entre(r, 0.5, 0.99) : entre(r, 0, 0.35),
    },
    activite: {
      secteur: secteur.nom,
      volumeAnnuelDeclare: Math.round(secteur.volumeTypique * (exagere ? entre(r, 4.2, 9) : entre(r, 0.3, 2.2))),
      paysOperation,
    },
  };

  return { ...brut, verite: decisionAttendue(brut) };
}

export function genererCas(combien = 400, graine = 20260817): Cas[] {
  const r = tirage(graine);
  return Array.from({ length: combien }, (_, i) => unCas(r, i + 1));
}

export const PAYS_A_RISQUE = PAYS_RISQUE;
export const PAYS_SOUS_SURVEILLANCE = PAYS_SURVEILLES;
export const SECTEURS_CONNUS = SECTEURS;
export const piecesRequises = piecesAttendues;
/** The ground truth, reachable so that a case the generator never draws can still be tried
 *  against it — a sector outside `SECTEURS` used to crash it. */
export const veriteAttendue = decisionAttendue;
