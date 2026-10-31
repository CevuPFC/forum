// Podatkovni sloj. Isti interfejs ima dve implementacije:
//  - Firebase (Auth + Firestore) kada je firebase-config.js popunjen
//  - Demo (localStorage) kada nije, da forum može odmah da se isproba
//
// Interfejs:
//  mode, initError
//  onAuth(cb)                         cb({uid, username, isAdmin} | null)
//  register({username,email,password}), login({email,password}), logout()
//  subscribePosts(cb, errCb), subscribePost(id, cb, errCb)
//  subscribeComments(postId, cb, errCb), subscribeMyVotes(uid, cb)
//  subscribeReports(cb, errCb)                          (samo admin)
//  createPost({title,body,url,community}) -> id
//  deletePost(id), createComment({postId,parentId,body}), deleteComment(id)
//  vote(kind, id, value)              kind: "posts" | "comments", value: -1 | 0 | 1
//  report({targetType,targetId,postId,reason,snippet}), dismissReport(id)

import { COMMUNITIES } from "./communities.js";

const FIREBASE_VERSION = "10.12.2";
const CDN = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/`;

export const USERNAME_RE = /^[A-Za-z0-9_.]{3,20}$/;
export const LIMITS = { title: 150, body: 5000, url: 500, comment: 2000, reason: 300 };

export async function createBackend(config) {
  const configured = Boolean(config && config.apiKey && config.projectId);
  if (!configured) return createDemoBackend();
  try {
    return await createFirebaseBackend(config);
  } catch (err) {
    console.error("Firebase nije učitan:", err);
    const demo = createDemoBackend();
    demo.initError = err;
    return demo;
  }
}

/* ------------------------------------------------------------------ */
/* Zajedničke pomoćne funkcije                                         */
/* ------------------------------------------------------------------ */

function fail(message) {
  const e = new Error(message);
  e.userFacing = true;
  return e;
}

function friendlyError(e) {
  if (e && e.userFacing) return e;
  const code = (e && e.code) || "";
  const map = {
    "auth/email-already-in-use": "Ovaj email je već registrovan. Probaj da se prijaviš.",
    "auth/invalid-email": "Email adresa nije ispravna.",
    "auth/weak-password": "Lozinka mora imati bar 6 znakova.",
    "auth/invalid-credential": "Pogrešan email ili lozinka.",
    "auth/wrong-password": "Pogrešan email ili lozinka.",
    "auth/user-not-found": "Pogrešan email ili lozinka.",
    "auth/too-many-requests": "Previše pokušaja. Probaj ponovo za nekoliko minuta.",
    "auth/network-request-failed": "Nema veze sa internetom. Proveri konekciju i probaj ponovo.",
    "auth/operation-not-allowed":
      "Prijava preko emaila nije uključena. U Firebase konzoli uključi Authentication > Email/Password.",
    "permission-denied": "Nemaš dozvolu za ovu radnju.",
    unavailable: "Server trenutno nije dostupan. Probaj ponovo.",
  };
  const err = new Error(map[code] || (e && e.message) || "Došlo je do greške. Probaj ponovo.");
  err.userFacing = true;
  err.code = code;
  return err;
}

function validatePost({ title, body, url, community }, isAdmin) {
  const t = (title || "").trim();
  if (t.length < 3) throw fail("Naslov mora imati bar 3 znaka.");
  if (t.length > LIMITS.title) throw fail(`Naslov može imati najviše ${LIMITS.title} znakova.`);
  if ((body || "").length > LIMITS.body) throw fail(`Tekst može imati najviše ${LIMITS.body} znakova.`);
  const u = (url || "").trim();
  if (u && !/^https?:\/\/.+/i.test(u)) throw fail("Link mora da počinje sa http:// ili https://");
  if (u.length > LIMITS.url) throw fail("Link je predug.");
  const c = COMMUNITIES.find((x) => x.id === community);
  if (!c) throw fail("Izaberi forum.");
  if (c.adminOnly && !isAdmin) throw fail("Na ovom forumu objavljuju samo administratori.");
  return { title: t, body: (body || "").trim(), url: u, community };
}

function validateComment(body) {
  const b = (body || "").trim();
  if (!b) throw fail("Komentar ne može da bude prazan.");
  if (b.length > LIMITS.comment) throw fail(`Komentar može imati najviše ${LIMITS.comment} znakova.`);
  return b;
}

function validateRegistration({ username, email, password }) {
  if (!USERNAME_RE.test(username || ""))
    throw fail("Korisničko ime ima 3–20 znakova: slova bez dijakritika, brojevi, tačka i donja crta.");
  if (!/^\S+@\S+\.\S+$/.test(email || "")) throw fail("Email adresa nije ispravna.");
  if ((password || "").length < 6) throw fail("Lozinka mora imati bar 6 znakova.");
}

/* ------------------------------------------------------------------ */
/* Firebase                                                            */
/* ------------------------------------------------------------------ */

async function createFirebaseBackend(config) {
  const [appMod, authMod, fs] = await Promise.all([
    import(CDN + "firebase-app.js"),
    import(CDN + "firebase-auth.js"),
    import(CDN + "firebase-firestore.js"),
  ]);
  const app = appMod.initializeApp(config);
  const auth = authMod.getAuth(app);
  const db = fs.getFirestore(app);
  const {
    doc, collection, getDoc, addDoc, deleteDoc, updateDoc, query, orderBy, limit, where,
    onSnapshot, writeBatch, runTransaction, serverTimestamp, increment,
  } = fs;

  const toMs = (v) =>
    v && typeof v.toMillis === "function" ? v.toMillis() : typeof v === "number" ? v : Date.now();
  const mapDoc = (d) => {
    const x = d.data({ serverTimestamps: "estimate" });
    return { ...x, id: d.id, createdAt: toMs(x.createdAt) };
  };

  let profile = null;
  let registering = false;
  let authReady = false;
  const authListeners = new Set();
  const emitAuth = () => authListeners.forEach((fn) => fn(profile));

  async function claimUsername(uid, username) {
    const lower = username.toLowerCase();
    const batch = writeBatch(db);
    batch.set(doc(db, "usernames", lower), { uid });
    batch.set(doc(db, "users", uid), { username, usernameLower: lower, createdAt: serverTimestamp() });
    await batch.commit();
  }

  async function loadProfile(user) {
    const [u, a] = await Promise.all([
      getDoc(doc(db, "users", user.uid)),
      getDoc(doc(db, "admins", user.uid)).catch(() => null),
    ]);
    const isAdmin = Boolean(a && a.exists());
    if (u.exists()) return { uid: user.uid, username: u.data().username, isAdmin };
    // Nalog postoji, a profil nije napravljen (npr. prekinuta registracija). Napravi ga automatski.
    const base = (user.email || "ucenik").split("@")[0].replace(/[^A-Za-z0-9_.]/g, "").slice(0, 14) || "ucenik";
    for (let i = 0; i < 4; i++) {
      const name = base.length >= 3 ? base + Math.floor(100 + Math.random() * 900) : "ucenik" + Math.floor(1000 + Math.random() * 9000);
      try {
        await claimUsername(user.uid, name);
        return { uid: user.uid, username: name, isAdmin };
      } catch (_) { /* probaj drugo ime */ }
    }
    return { uid: user.uid, username: "nepoznato", isAdmin };
  }

  authMod.onAuthStateChanged(auth, async (user) => {
    if (registering) return;
    try {
      profile = user ? await loadProfile(user) : null;
    } catch (e) {
      console.error(e);
      profile = null;
    }
    authReady = true;
    emitAuth();
  });

  const watch = (q, mapper, cb, errCb) =>
    onSnapshot(q, (snap) => cb(mapper(snap)), (err) => {
      console.error(err);
      if (errCb) errCb(friendlyError(err));
    });

  const need = () => {
    if (!profile) throw fail("Prijavi se da nastaviš.");
    return profile;
  };

  return {
    mode: "firebase",

    onAuth(cb) {
      authListeners.add(cb);
      if (authReady) queueMicrotask(() => cb(profile));
      return () => authListeners.delete(cb);
    },

    async register(data) {
      validateRegistration(data);
      const { username, email, password } = data;
      try {
        const taken = await getDoc(doc(db, "usernames", username.toLowerCase()));
        if (taken.exists()) throw fail("Korisničko ime je zauzeto.");
        registering = true;
        const cred = await authMod.createUserWithEmailAndPassword(auth, email, password);
        try {
          await claimUsername(cred.user.uid, username);
        } catch (e) {
          await cred.user.delete().catch(() => {});
          throw fail("Korisničko ime je zauzeto ili nije dozvoljeno.");
        }
        profile = { uid: cred.user.uid, username, isAdmin: false };
        authReady = true;
        emitAuth();
      } catch (e) {
        throw friendlyError(e);
      } finally {
        registering = false;
      }
    },

    async login({ email, password }) {
      try {
        await authMod.signInWithEmailAndPassword(auth, email, password);
      } catch (e) {
        throw friendlyError(e);
      }
    },

    async logout() {
      await authMod.signOut(auth);
    },

    subscribePosts(cb, errCb) {
      const q = query(collection(db, "posts"), orderBy("createdAt", "desc"), limit(300));
      return watch(q, (s) => s.docs.map(mapDoc), cb, errCb);
    },

    subscribePost(id, cb, errCb) {
      return onSnapshot(
        doc(db, "posts", id),
        (d) => cb(d.exists() ? mapDoc(d) : null),
        (err) => errCb && errCb(friendlyError(err))
      );
    },

    subscribeComments(postId, cb, errCb) {
      const q = query(collection(db, "comments"), where("postId", "==", postId));
      return watch(q, (s) => s.docs.map(mapDoc), cb, errCb);
    },

    subscribeMyVotes(uid, cb) {
      return onSnapshot(
        collection(db, "users", uid, "votes"),
        (snap) => {
          const map = {};
          snap.docs.forEach((d) => (map[d.id] = d.data().value));
          cb(map);
        },
        (err) => console.error(err)
      );
    },

    subscribeReports(cb, errCb) {
      const q = query(collection(db, "reports"), orderBy("createdAt", "desc"), limit(100));
      return watch(q, (s) => s.docs.map(mapDoc), cb, errCb);
    },

    async createPost(input) {
      const me = need();
      const p = validatePost(input, me.isAdmin);
      try {
        const ref = await addDoc(collection(db, "posts"), {
          ...p,
          authorId: me.uid,
          authorName: me.username,
          createdAt: serverTimestamp(),
          score: 0,
          commentCount: 0,
        });
        return ref.id;
      } catch (e) {
        throw friendlyError(e);
      }
    },

    async deletePost(id) {
      need();
      try {
        await deleteDoc(doc(db, "posts", id));
      } catch (e) {
        throw friendlyError(e);
      }
    },

    async createComment({ postId, parentId, body }) {
      const me = need();
      const text = validateComment(body);
      try {
        const batch = writeBatch(db);
        const ref = doc(collection(db, "comments"));
        batch.set(ref, {
          postId,
          parentId: parentId || null,
          body: text,
          authorId: me.uid,
          authorName: me.username,
          createdAt: serverTimestamp(),
          score: 0,
          deleted: false,
        });
        batch.update(doc(db, "posts", postId), { commentCount: increment(1) });
        await batch.commit();
        return ref.id;
      } catch (e) {
        throw friendlyError(e);
      }
    },

    async deleteComment(id) {
      need();
      try {
        await updateDoc(doc(db, "comments", id), { body: "[obrisano]", deleted: true });
      } catch (e) {
        throw friendlyError(e);
      }
    },

    async vote(kind, id, value) {
      const me = need();
      if (![-1, 0, 1].includes(value) || !["posts", "comments"].includes(kind)) return;
      const targetRef = doc(db, kind, id);
      const voteRef = doc(db, "users", me.uid, "votes", id);
      try {
        await runTransaction(db, async (tx) => {
          const [t, v] = await Promise.all([tx.get(targetRef), tx.get(voteRef)]);
          if (!t.exists()) throw fail("Ova stavka više ne postoji.");
          const old = v.exists() ? v.data().value : 0;
          tx.set(voteRef, { value });
          tx.update(targetRef, { score: (t.data().score || 0) + (value - old) });
        });
      } catch (e) {
        throw friendlyError(e);
      }
    },

    async report({ targetType, targetId, postId, reason, snippet }) {
      const me = need();
      try {
        await addDoc(collection(db, "reports"), {
          targetType,
          targetId,
          postId,
          reason: String(reason || "").slice(0, LIMITS.reason),
          snippet: String(snippet || "").slice(0, 200),
          reporterId: me.uid,
          createdAt: serverTimestamp(),
        });
      } catch (e) {
        throw friendlyError(e);
      }
    },

    async dismissReport(id) {
      need();
      try {
        await deleteDoc(doc(db, "reports", id));
      } catch (e) {
        throw friendlyError(e);
      }
    },
  };
}

/* ------------------------------------------------------------------ */
/* Demo (localStorage)                                                 */
/* ------------------------------------------------------------------ */

function createDemoBackend() {
  const KEY = "etsforum.demo.v1";
  const listeners = new Set();
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const newId = () => "d" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-3);

  let data = load();

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return JSON.parse(raw);
    } catch (_) { /* ignore */ }
    return seed();
  }
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch (_) { /* ignore */ }
    emit();
  }
  function emit() {
    listeners.forEach((fn) => fn());
  }
  window.addEventListener("storage", (e) => {
    if (e.key === KEY) {
      data = load();
      emit();
    }
  });

  function sub(compute, cb) {
    const run = () => cb(clone(compute()));
    listeners.add(run);
    setTimeout(run, 0);
    return () => listeners.delete(run);
  }

  const toProfile = (u) =>
    u ? { uid: u.uid, username: u.username, isAdmin: u.username.toLowerCase() === "admin" } : null;
  const me = () => toProfile(data.session ? data.users[data.session] : null);
  const need = () => {
    const m = me();
    if (!m) throw fail("Prijavi se da nastaviš.");
    return m;
  };
  const sortedPosts = () => [...data.posts].sort((a, b) => b.createdAt - a.createdAt).slice(0, 300);

  return {
    mode: "demo",

    onAuth(cb) {
      return sub(() => me(), cb);
    },

    async register(input) {
      validateRegistration(input);
      const { username, email, password } = input;
      const users = Object.values(data.users);
      if (users.some((u) => u.username.toLowerCase() === username.toLowerCase()))
        throw fail("Korisničko ime je zauzeto.");
      if (users.some((u) => u.email.toLowerCase() === email.toLowerCase()))
        throw fail("Ovaj email je već registrovan. Probaj da se prijaviš.");
      const uid = newId();
      data.users[uid] = { uid, username, email, password, createdAt: Date.now() };
      data.session = uid;
      save();
    },

    async login({ email, password }) {
      const u = Object.values(data.users).find(
        (x) => x.email.toLowerCase() === (email || "").toLowerCase() && x.password === password
      );
      if (!u) throw fail("Pogrešan email ili lozinka.");
      data.session = u.uid;
      save();
    },

    async logout() {
      data.session = null;
      save();
    },

    subscribePosts(cb) {
      return sub(sortedPosts, cb);
    },
    subscribePost(id, cb) {
      return sub(() => data.posts.find((p) => p.id === id) || null, cb);
    },
    subscribeComments(postId, cb) {
      return sub(() => data.comments.filter((c) => c.postId === postId), cb);
    },
    subscribeMyVotes(uid, cb) {
      return sub(() => data.votes[uid] || {}, cb);
    },
    subscribeReports(cb) {
      return sub(() => [...data.reports].sort((a, b) => b.createdAt - a.createdAt), cb);
    },

    async createPost(input) {
      const m = need();
      const p = validatePost(input, m.isAdmin);
      const post = {
        id: newId(), ...p, authorId: m.uid, authorName: m.username,
        createdAt: Date.now(), score: 0, commentCount: 0,
      };
      data.posts.push(post);
      save();
      return post.id;
    },

    async deletePost(id) {
      const m = need();
      const p = data.posts.find((x) => x.id === id);
      if (!p) return;
      if (p.authorId !== m.uid && !m.isAdmin) throw fail("Nemaš dozvolu za ovu radnju.");
      data.posts = data.posts.filter((x) => x.id !== id);
      data.comments = data.comments.filter((c) => c.postId !== id);
      save();
    },

    async createComment({ postId, parentId, body }) {
      const m = need();
      const text = validateComment(body);
      const post = data.posts.find((p) => p.id === postId);
      if (!post) throw fail("Objava više ne postoji.");
      const c = {
        id: newId(), postId, parentId: parentId || null, body: text,
        authorId: m.uid, authorName: m.username, createdAt: Date.now(), score: 0, deleted: false,
      };
      data.comments.push(c);
      post.commentCount += 1;
      save();
      return c.id;
    },

    async deleteComment(id) {
      const m = need();
      const c = data.comments.find((x) => x.id === id);
      if (!c) return;
      if (c.authorId !== m.uid && !m.isAdmin) throw fail("Nemaš dozvolu za ovu radnju.");
      c.body = "[obrisano]";
      c.deleted = true;
      save();
    },

    async vote(kind, id, value) {
      const m = need();
      if (![-1, 0, 1].includes(value)) return;
      const list = kind === "posts" ? data.posts : data.comments;
      const target = list.find((x) => x.id === id);
      if (!target) throw fail("Ova stavka više ne postoji.");
      const votes = (data.votes[m.uid] = data.votes[m.uid] || {});
      const old = votes[id] || 0;
      target.score += value - old;
      votes[id] = value;
      save();
    },

    async report({ targetType, targetId, postId, reason, snippet }) {
      const m = need();
      data.reports.push({
        id: newId(), targetType, targetId, postId,
        reason: String(reason || "").slice(0, LIMITS.reason),
        snippet: String(snippet || "").slice(0, 200),
        reporterId: m.uid, createdAt: Date.now(),
      });
      save();
    },

    async dismissReport(id) {
      const m = need();
      if (!m.isAdmin) throw fail("Nemaš dozvolu za ovu radnju.");
      data.reports = data.reports.filter((r) => r.id !== id);
      save();
    },
  };

  function seed() {
    const now = Date.now();
    const H = 3600 * 1000;
    const users = {};
    const addUser = (uid, username, email = `${username.toLowerCase()}@demo.rs`, password = "demo123") => {
      users[uid] = { uid, username, email, password, createdAt: now - 40 * 24 * H };
    };
    addUser("u-admin", "admin", "admin@demo.rs", "admin123");
    addUser("u-marko", "Marko_P");
    addUser("u-jovana", "jovana.s");
    addUser("u-nikola", "nikola03");
    addUser("u-ana", "ana_k");

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

    P("p1", "skola", "u-admin",
      "Dobrodošli na ETŠ forum: pravila ponašanja",
      "Ovo je mesto za učenike Elektrotehničke škole „Stari grad“. Postavljajte pitanja, delite projekte i pomažite jedni drugima.\n\n" +
      "Pravila:\n" +
      "1. Poštuj sve učenike i nastavnike. Vređanje i maltretiranje se brišu.\n" +
      "2. Ne objavljuj lične podatke, svoje ni tuđe: adrese, brojeve telefona, fotografije drugih bez dozvole.\n" +
      "3. Za domaći i zadatke pitaj kako se nešto radi, ne traži gotova rešenja za ocenjivane radove.\n" +
      "4. Ako vidiš nešto neprimereno, klikni „Prijavi“.\n\n" +
      "Administratori mogu da obrišu sadržaj koji krši pravila.",
      70, 24);

    P("p2", "pitanja", "u-marko",
      "Kako se računa ekvivalentna otpornost kad su tri otpornika vezana paralelno?",
      "Imam R1 = 100 Ω, R2 = 220 Ω i R3 = 470 Ω vezane paralelno. Znam formulu sa recipročnim vrednostima, ali mi ne ispada isto kao u zbirci. Šta radim pogrešno?",
      5, 12);
    C("c1", "p2", null, "u-jovana",
      "Proveri da li si na kraju okrenuo razlomak. Zbir 1/R daje 1/Rekv, pa moraš još jednom da uzmeš recipročnu vrednost. Za tvoje brojeve ispada oko 60 Ω.",
      4.5, 9);
    C("c2", "p2", "c1", "u-marko", "To je to, zaboravio sam poslednji korak. Hvala!", 4, 4);
    C("c3", "p2", null, "u-nikola",
      "Brza provera: ekvivalentna otpornost paralelne veze mora da bude manja od najmanjeg otpornika. Ako ti ispadne više od 100 Ω, negde si pogrešio.",
      3, 6);

    P("p3", "elektronika", "u-nikola",
      "Arduino Uno ili ESP32 za školski projekat?",
      "Pravimo pametnu saksiju koja meri vlažnost zemljišta i šalje podatke na telefon. Razmišljamo između Arduina Uno i ESP32. Šta biste vi uzeli i zašto?",
      20, 18);
    C("c4", "p3", null, "u-ana",
      "ESP32. Ima ugrađen Wi-Fi i Bluetooth, pa ti ne treba dodatni modul. Pazi samo da radi na 3,3 V, ne na 5 V.",
      19, 11);
    C("c5", "p3", "c4", "u-nikola", "Da li senzor vlažnosti radi na 3,3 V?", 18, 2);
    C("c6", "p3", "c5", "u-ana", "Većina kapacitivnih senzora radi od 3,3 V do 5 V, ali proveri u datasheet-u za svoj model.", 17, 5);

    P("p4", "programiranje", "u-jovana",
      "Python ili C++ za početak?",
      "Upisala sam se ove godine i ne znam odakle da krenem sa programiranjem. Da li prvo Python ili odmah C++, kao što se uči u školi?",
      30, 7);
    C("c7", "p4", null, "u-marko",
      "Za početak Python, brže vidiš rezultate. C++ ćeš ionako učiti u školi, a lakše ćeš ga razumeti kad znaš osnove logike.",
      28, 8);

    P("p5", "projekti", "u-ana",
      "Tražimo ekipu za takmičenje iz robotike",
      "Planiramo da se prijavimo na takmičenje iz robotike. Treba nam još dvoje ljudi, jedan za mehaniku i jedan za programiranje. Javite se u komentarima.",
      9, 15);
    C("c8", "p5", null, "u-nikola", "Ja bih za programiranje. Pišem u C++ i Python-u.", 8, 3);

    P("p6", "zezanje", "u-nikola",
      "Lemljenje: kad se kalaj zalepi za sve osim za pločicu",
      "Svako ko je lemio zna ovaj osećaj. Podelite svoje najgore lemilačke greške.",
      46, 21);
    C("c9", "p6", null, "u-marko", "Prvi put sam zalemio elektrolitski kondenzator obrnuto. Nije bilo lepo.", 45, 13);

    P("p7", "elektronika", "u-ana",
      "Simulator kola u pregledaču, koristan za vežbe",
      "Radi direktno u pregledaču, ne treba instalacija. Dobar za proveru zadataka iz osnova elektrotehnike.",
      60, 9, "https://www.falstad.com/circuit/");

    posts.forEach((p) => (p.commentCount = comments.filter((c) => c.postId === p.id).length));

    return { users, posts, comments, votes: {}, reports: [], session: null };
  }
}
