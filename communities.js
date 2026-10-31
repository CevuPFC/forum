// Forumi (kao "subreddit"-i). Svaki forum ima tri boje otpornika kao oznaku.
// Ako dodaš ili izbrišeš forum, ažuriraj i listu u firestore.rules (isValidCommunity).

export const RESISTOR = {
  black: "#222222",
  brown: "#7B4A24",
  red: "#D62F2F",
  orange: "#F28C1B",
  yellow: "#F2C230",
  green: "#2E9E5B",
  blue: "#2F6FDB",
  violet: "#7C4DC4",
  grey: "#8A94A6",
  white: "#F4F4F4",
};

export const COMMUNITIES = [
  {
    id: "skola",
    name: "Obaveštenja",
    desc: "Vesti i obaveštenja iz škole. Ovde objavljuju samo administratori.",
    bands: ["yellow", "violet", "red"],
    adminOnly: true,
  },
  {
    id: "opste",
    name: "Opšte",
    desc: "Razgovor o školi, predmetima i svemu između.",
    bands: ["brown", "black", "red"],
  },
  {
    id: "pitanja",
    name: "Pitanja i pomoć",
    desc: "Zadaci, gradivo i objašnjenja. Pitaj kako se nešto radi.",
    bands: ["orange", "orange", "brown"],
  },
  {
    id: "elektronika",
    name: "Elektronika i hardver",
    desc: "Kola, merenja, lemljenje, mikrokontroleri i sve što se greje.",
    bands: ["green", "blue", "orange"],
  },
  {
    id: "programiranje",
    name: "Programiranje",
    desc: "Kod, alati, greške koje ne razumeš i programi koje si napravio.",
    bands: ["blue", "grey", "red"],
  },
  {
    id: "projekti",
    name: "Projekti i takmičenja",
    desc: "Traži ekipu, pokaži šta si napravio, pripremi se za takmičenje.",
    bands: ["violet", "green", "brown"],
  },
  {
    id: "zezanje",
    name: "Zezanje",
    desc: "Mimovi i šale, uz poštovanje pravila foruma.",
    bands: ["red", "red", "yellow"],
  },
];

export const ALL_BANDS = ["red", "green", "blue"];

export function getCommunity(id) {
  return (
    COMMUNITIES.find((c) => c.id === id) || {
      id,
      name: id || "Nepoznat forum",
      desc: "",
      bands: ["grey", "grey", "grey"],
    }
  );
}
