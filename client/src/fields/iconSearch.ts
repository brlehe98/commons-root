import { icons } from "lucide-react";
import TAGS from "./iconTags.json";

// Keywords from lucide-static 1.55.0 (tags.json), matching lucide-react 1.55.0.
const tags = TAGS as Record<string, string>;
const NAMES = Object.keys(icons);

// French newsroom words and the English keywords Lucide uses for them.
const FRENCH: Record<string, string[]> = {
  journal: ["newspaper"], nouvelle: ["newspaper"], article: ["file text", "newspaper"], texte: ["text"],
  photo: ["image", "camera"], image: ["image"], video: ["video"], camera: ["camera"], carte: ["map"],
  monde: ["globe", "world"], international: ["globe"], politique: ["landmark", "vote"], election: ["vote"],
  vote: ["vote"], economie: ["dollar", "chart", "money"], argent: ["dollar", "money"], sport: ["sport", "ball", "trophy", "medal", "dumbbell", "bike", "goal", "whistle"],
  sante: ["heart", "health", "medical"], culture: ["palette", "theater"], art: ["palette"], musique: ["music"],
  education: ["graduation", "school"], ecole: ["school"], environnement: ["leaf", "tree", "nature"],
  climat: ["thermometer", "cloud"], meteo: ["cloud", "weather", "sun"], justice: ["scale", "gavel"],
  tribunal: ["gavel"], crime: ["siren", "police"], police: ["shield", "siren"], urgence: ["siren"],
  region: ["map pin"], ville: ["building", "city"], maison: ["home", "house"], quartier: ["map pin"],
  auteur: ["user", "person"], personne: ["user"], equipe: ["users"], groupe: ["users"], calendrier: ["calendar"],
  date: ["calendar"], horloge: ["clock"], heure: ["clock", "time"], idee: ["lightbulb"], crayon: ["pencil"],
  ecrire: ["pencil", "pen"], livre: ["book"], voiture: ["car"], transport: ["bus", "car", "train"],
  avion: ["plane"], drapeau: ["flag"], etoile: ["star"], coeur: ["heart"], feu: ["flame", "fire"],
  eau: ["droplet", "water"], arbre: ["tree"], soleil: ["sun"], lune: ["moon"], telephone: ["phone"],
  courriel: ["mail"], message: ["message"], micro: ["mic"], entrevue: ["mic"], radio: ["radio"],
  television: ["tv"], tele: ["tv"], recherche: ["search"], alerte: ["bell", "alert"], traduction: ["languages", "translate"],
  langue: ["languages"], lien: ["link"], approuve: ["check"], valide: ["check"], refuse: ["x"], attente: ["clock", "hourglass"],
  brouillon: ["file", "pencil"], publie: ["send", "globe"], archive: ["archive"], tableau: ["layout", "kanban"],
  dossier: ["folder"], fichier: ["file"], verrou: ["lock"], cle: ["key"], outil: ["wrench"], reglage: ["settings"],
  cadeau: ["gift"], nourriture: ["utensils", "food"], agriculture: ["wheat", "tractor"], science: ["flask", "atom"],
  technologie: ["cpu", "laptop"], ordinateur: ["laptop", "computer"], securite: ["shield"], guerre: ["sword"],
  paix: ["dove"], religion: ["church"], autochtone: ["feather"], immigration: ["plane", "globe"],
};

/** True when a keyword starts with the term ("sport" finds "sports", not "transport"). */
function hasWord(keywords: string, term: string): boolean {
  return (" " + keywords).includes(" " + term);
}

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/**
 * Lucide icons matching a search, best first: by name, then by Lucide's
 * keywords. French words are also looked up through a small dictionary.
 */
export function searchIcons(query: string): string[] {
  const q = fold(query.trim());
  if (!q) return NAMES;
  const compact = q.replace(/[\s-]/g, "");
  const terms = [q, ...(FRENCH[q] ?? FRENCH[q.replace(/s$/, "")] ?? [])];
  const scored: [string, number][] = [];
  for (const name of NAMES) {
    const lower = name.toLowerCase();
    const keywords = tags[name] ?? "";
    let rank = 0;
    if (lower === compact) rank = 4;
    else if (lower.startsWith(compact)) rank = 3;
    else if (lower.includes(compact)) rank = 2;
    else if (terms.some((t) => hasWord(keywords, t) || lower.includes(t.replace(/\s/g, "")))) rank = 1;
    if (rank) scored.push([name, rank]);
  }
  return scored.sort((a, b) => b[1] - a[1]).map(([name]) => name);
}
