// Forumi (kao "subreddit"-i). Svaki forum ima emoji i boju.
// Ako dodaš ili izbrišeš forum, ažuriraj i listu u firestore.rules (isValidCommunity).

export const COMMUNITIES = [
  {
    id: "novosti",
    name: "Novosti",
    desc: "Vesti i pravila od tima Glasa. Ovde objavljuju samo administratori.",
    emoji: "📣",
    color: "#FF4FA3",
    adminOnly: true,
  },
  {
    id: "opste",
    name: "Opšte",
    desc: "Razgovor o svemu što ne staje u druge forume.",
    emoji: "💬",
    color: "#8B7CFF",
  },
  {
    id: "gaming",
    name: "Gaming",
    desc: "Igrice, konzole, PC, turniri i priče sa ekrana.",
    emoji: "🎮",
    color: "#35E0FF",
  },
  {
    id: "muzika",
    name: "Muzika",
    desc: "Šta slušaš, šta preporučuješ i šta ti ne silazi sa repeat-a.",
    emoji: "🎧",
    color: "#B26BFF",
  },
  {
    id: "filmovi",
    name: "Filmovi i serije",
    desc: "Šta gledati, šta preskočiti i šta te je zalepilo za ekran.",
    emoji: "🍿",
    color: "#FFB84D",
  },
  {
    id: "sport",
    name: "Sport",
    desc: "Utakmice, treninzi i sve između.",
    emoji: "⚽",
    color: "#2EF2A0",
  },
  {
    id: "mimovi",
    name: "Mimovi",
    desc: "Šale i mimovi. Dozvoljeno je sve što nije na tuđ račun.",
    emoji: "😂",
    color: "#FFE14D",
  },
  {
    id: "saveti",
    name: "Pitanja i saveti",
    desc: "Pitaj šta god te muči: škola, drugari, navike, život.",
    emoji: "🙋",
    color: "#FF8A5C",
  },
  {
    id: "tehnika",
    name: "Tehnika i kod",
    desc: "Programiranje, elektronika, gedžeti i projekti.",
    emoji: "💻",
    color: "#5CD6FF",
  },
  {
    id: "skola",
    name: "Škola",
    desc: "Predmeti, profesori, ispiti i preživljavanje do raspusta.",
    emoji: "🎒",
    color: "#7CE08A",
  },
];

export const ALL_FORUMS = { id: "", name: "Sve objave", emoji: "✨", color: "#8B7CFF" };

export function getCommunity(id) {
  return (
    COMMUNITIES.find((c) => c.id === id) || {
      id,
      name: id || "Nepoznat forum",
      desc: "",
      emoji: "💬",
      color: "#8B7CFF",
    }
  );
}
