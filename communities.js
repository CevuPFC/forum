// Forumi (kao "subreddit"-i). Svaki forum ima emoji i boju.
//
// BUILTIN su forumi koji postoje uvek. Moderator može da pravi nove direktno sa sajta
// ("+ Novi forum"); oni se čuvaju u bazi (kolekcija "forums") i dodaju se ispod ovih.
// Ako menjaš listu BUILTIN foruma ovde, ažuriraj i builtinForum() u firestore.rules.

export const BUILTIN = [
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

// Živa lista: BUILTIN + forumi iz baze. Menja se na licu mesta (isti niz), pa svi koji je uvezu vide izmene.
export const COMMUNITIES = [...BUILTIN];

export const FORUM_LIMITS = { name: 30, desc: 120 };
export const FORUM_COLORS = ["#6D4AFF", "#FF4FA3", "#35E0FF", "#2EF2A0", "#FFB84D", "#FF8A5C", "#FFE14D", "#B26BFF"];
export const FORUM_EMOJIS = ["🎨", "📚", "🐶", "🍕", "🚗", "✈️", "🏀", "📸", "🤖", "🎬", "🧠", "🔥"];
const COLOR_RE = /^#[0-9A-Fa-f]{6}$/;

export const isBuiltin = (id) => BUILTIN.some((c) => c.id === id);

// Naziv -> adresa foruma: "Škola i život!" -> "skola-i-zivot"
export function slugify(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/đ/g, "dj")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24)
    .replace(/-+$/, "");
}

// Postavlja forume iz baze (ne dira ugrađene).
export function setCustomForums(list) {
  const custom = (list || [])
    .filter((f) => f && f.id && !isBuiltin(f.id))
    .map((f) => ({
      id: String(f.id),
      name: String(f.name || f.id),
      desc: String(f.desc || ""),
      emoji: String(f.emoji || "💬"),
      color: COLOR_RE.test(f.color || "") ? f.color : "#8B7CFF",
      adminOnly: f.adminOnly === true,
      custom: true,
      createdBy: f.createdBy || "",
      createdAt: f.createdAt || 0,
    }))
    .sort((a, b) => a.createdAt - b.createdAt);
  COMMUNITIES.length = 0;
  COMMUNITIES.push(...BUILTIN, ...custom);
}

export const ALL_FORUMS = { id: "", name: "Sve objave", emoji: "✨", color: "#8B7CFF" };

export function getCommunity(id) {
  return (
    COMMUNITIES.find((c) => c.id === id) || {
      id,
      name: id ? id.replace(/-/g, " ") : "Nepoznat forum",
      desc: "",
      emoji: "💬",
      color: "#8B7CFF",
    }
  );
}
