// Probni sadržaj za demo režim (koristi se samo dok Firebase nije povezan).

export function buildSeed() {
  const now = Date.now();
  const H = 3600 * 1000;
  const users = {};
  const addUser = (uid, username, email = `${username.toLowerCase()}@demo.rs`, password = "demo123") => {
    users[uid] = { uid, username, email, password, createdAt: now - 40 * 24 * H };
  };
  addUser("u-admin", "admin", "admin@demo.rs", "admin123");
  addUser("u-luka", "luka_g");
  addUser("u-mina", "mina.x");
  addUser("u-dusan", "dusan07");
  addUser("u-jelena", "jelena_k");

  const posts = [];
  const comments = [];
  const P = (id, community, uid, title, body, hoursAgo, score, url = "") =>
    posts.push({
      id, community, title, body, url, authorId: uid, authorName: users[uid].username,
      createdAt: now - hoursAgo * H, score, commentCount: 0,
    });
  const C = (id, postId, parentId, uid, body, hoursAgo, score) =>
    comments.push({
      id, postId, parentId, body, authorId: uid, authorName: users[uid].username,
      createdAt: now - hoursAgo * H, score, deleted: false,
    });

  P("p1", "novosti", "u-admin",
    "Dobro došli na Glas! Pročitaj ovo pre prve objave",
    "Glas je mesto gde mladi pokreću teme o svemu što ih zanima: igrice, muzika, filmovi, sport, mimovi, školske muke.\n\n" +
    "Pravila su kratka:\n" +
    "1. Zezanje da, vređanje ne. Ko se ruga drugima, biva obrisan.\n" +
    "2. Ne deli lične podatke, svoje ni tuđe: adrese, brojeve telefona, tuđe fotografije bez dozvole.\n" +
    "3. Bez mržnje, pretnji i neprimerenog sadržaja.\n" +
    "4. Vidiš nešto sumnjivo? Klikni „Prijavi“, moderatori će to pogledati.\n\n" +
    "Pokreni prvu temu, nema glupih pitanja.",
    70, 31);

  P("p2", "gaming", "u-luka",
    "Koja vam je najbolja igrica ove godine?",
    "Ja se već nedelju dana ne odvajam od jedne igrice. Pišite šta vas je najviše zalepilo i zašto, može bilo koja platforma.",
    4, 14);
  C("c1", "p2", null, "u-mina",
    "Igrala sam jednu indie avanturu i priča me je potpuno pokupila. Kratka je, a pamti se mesecima.", 3.5, 9);
  C("c2", "p2", "c1", "u-luka", "Zvuči odlično, to mi treba za vikend. Koliko traje?", 3, 3);
  C("c3", "p2", "c2", "u-mina", "Oko pet sati, taman za jedno popodne.", 2.5, 4);
  C("c4", "p2", null, "u-dusan",
    "Ja i dalje igram stare igrice sa drugarima. Najbolji deo je smeh, a ne grafika.", 2, 6);

  P("p3", "muzika", "u-jelena",
    "Šta slušate dok učite?",
    "Meni treba nešto što ne odvlači pažnju, ali da ne bude potpuna tišina. Preporuke?",
    8, 19);
  C("c5", "p3", null, "u-dusan", "Instrumentalnu muziku. Uz reči ne mogu da se skoncentrišem.", 7, 8);
  C("c6", "p3", "c5", "u-luka", "Isto, lo-fi mi najbolje ide.", 6, 3);
  C("c7", "p3", null, "u-mina",
    "Ja učim u tišini, ali tek pošto sklonim telefon. Bez toga ništa od učenja.", 5, 7);

  P("p4", "filmovi", "u-mina",
    "Serija koja vas je zalepila za ekran?",
    "Tražim nešto što ću gledati preko vikenda. Samo da nema previše sezona.",
    22, 11);
  C("c8", "p4", null, "u-jelena",
    "Gledala sam celu sezonu u jednom vikendu i posle sam bila umorna kao posle ispita.", 21, 5);

  P("p5", "mimovi", "u-dusan",
    "Kad nastavnik kaže: „ovo neće biti na testu“",
    "A onda je bilo na testu. Podelite svoje najbolje školske trenutke, opisom ili linkom do slike.",
    12, 27);
  C("c9", "p5", null, "u-luka", "Klasik. Bilo je i na kontrolnom i na usmenom.", 11, 10);

  P("p6", "saveti", "u-jelena",
    "Kako da naučim da ustajem rano, bez drame?",
    "Budilnik stavljam na 6, a ustajem u 7:15. Ima li neko ko je uspeo da promeni naviku?",
    30, 9);
  C("c10", "p6", null, "u-luka",
    "Telefon ostavi na drugoj strani sobe, moraćeš da ustaneš da ugasiš budilnik.", 29, 7);
  C("c11", "p6", "c10", "u-dusan", "Radi, ali onda ga ugasim i vratim se u krevet.", 28, 5);
  C("c12", "p6", "c11", "u-luka", "Onda odmah otvori prozor. Hladan vazduh pomaže više nego što misliš.", 27, 4);

  P("p7", "tehnika", "u-dusan",
    "Arduino Uno ili ESP32 za školski projekat?",
    "Pravimo pametnu saksiju koja meri vlažnost zemljišta i šalje podatke na telefon. Razmišljamo između Arduina Uno i ESP32. Šta biste vi uzeli i zašto?",
    20, 18);
  C("c13", "p7", null, "u-jelena",
    "ESP32. Ima ugrađen Wi-Fi i Bluetooth, pa ti ne treba dodatni modul. Pazi samo da radi na 3,3 V, ne na 5 V.", 19, 11);
  C("c14", "p7", "c13", "u-dusan", "Da li senzor vlažnosti radi na 3,3 V?", 18, 2);
  C("c15", "p7", "c14", "u-jelena",
    "Većina kapacitivnih senzora radi od 3,3 V do 5 V, ali proveri u datasheet-u za svoj model.", 17, 5);

  P("p8", "sport", "u-mina",
    "Da li je teretana stvarno vredna vremena?",
    "Razmišljam da krenem, ali ne znam odakle. Neko ko trenira, kakva su vaša iskustva?",
    46, 6);
  C("c16", "p8", null, "u-dusan",
    "Za mene da, ali je bitno da vežbaš pravilno. Pogledaj video ili pitaj nekog ko zna.", 45, 4);

  P("p9", "tehnika", "u-mina",
    "Simulator kola u pregledaču, koristan za vežbe",
    "Radi direktno u pregledaču, ne treba instalacija. Dobar za proveru zadataka iz osnova elektrotehnike.",
    60, 9, "https://www.falstad.com/circuit/");

  P("p10", "skola", "u-luka",
    "Koji vam je predmet neočekivano postao omiljen?",
    "Ja sam mislio da ću mrzeti jedan predmet, a sad jedva čekam čas.",
    52, 8);

  posts.forEach((p) => (p.commentCount = comments.filter((c) => c.postId === p.id).length));

  return { users, posts, comments, votes: {}, reports: [], session: null };
}
