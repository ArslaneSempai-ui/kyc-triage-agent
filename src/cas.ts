/**
 * Les dossiers d'entrée en relation, et leur vérité terrain.
 *
 * Tout est synthétique et assumé comme tel. Un jeu réel ne peut pas quitter une banque,
 * et s'entraîner à mesurer sur des dossiers qu'on ne peut pas publier revient à ne rien
 * pouvoir montrer.
 *
 * Le tirage est déterministe : sans graine fixe, deux mesures ne se comparent pas et on
 * finit par attribuer à un changement de code ce qui n'était qu'un autre échantillon.
 */

export type Decision = "approuver" | "complement" | "escalader";

export type Piece = {
  type: "identite" | "domicile" | "immatriculation" | "structure";
  fournie: boolean;
  lisible: boolean;
  /** Nombre de mois avant expiration. Négatif = déjà expirée. */
  expireDans: number | null;
  /** Le nom porté par la pièce correspond-il au nom déclaré ? */
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
     * Force de la correspondance avec une liste (0 à 1). Le point important du métier :
     * une correspondance n'est jamais binaire. « Mohamed Ali » contre une liste de
     * sanctions renvoie des dizaines de quasi-homonymes, et c'est là que se joue le
     * travail — pas sur les cas nets.
     */
    correspondanceSanction: number;
    correspondancePep: number;
  };
  activite: { secteur: string; volumeAnnuelDeclare: number; paysOperation: string[] };
  /** Ce qu'un analyste expérimenté aurait décidé. Sert uniquement à noter l'agent. */
  verite: Decision;
};

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
 * Générateur congruentiel. Trente ans d'âge et parfaitement suffisant : on veut un
 * échantillon reproductible, pas de la cryptographie.
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
 * La vérité terrain suit la procédure, dans l'ordre où un analyste l'applique.
 *
 * L'ordre compte et n'est pas arbitraire : une correspondance de sanction l'emporte sur
 * une pièce manquante. Réclamer un justificatif de domicile à quelqu'un qui figure sur
 * une liste, c'est le prévenir.
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
    // Seuil réglementaire usuel : tout détenteur de plus de 25 % doit être identifié.
    if (couvert < 75) return "complement";
    if (c.beneficiaires.some((b) => b.part >= 25 && !b.identifie)) return "complement";
  }

  const secteur = SECTEURS.find((s) => s.nom === c.activite.secteur);
  if (secteur && c.activite.volumeAnnuelDeclare > secteur.volumeTypique * 4) return "escalader";
  if (c.activite.paysOperation.some((p) => PAYS_SURVEILLES.has(p)) &&
      c.activite.volumeAnnuelDeclare > secteur!.volumeTypique * 2) return "escalader";

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
      // Le gros des dossiers ne ressemble à rien. Une minorité ressemble un peu, et
      // c'est cette minorité qui coûte cher.
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
