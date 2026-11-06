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
//  createPost({title,body,url,community,imageData}) -> id   (imageData: JPEG data URL, nije obavezno)
//  loadImages(ids) -> {id: dataUrl|""}
//  deletePost(id), createComment({postId,parentId,body}), deleteComment(id)
//  vote(kind, id, value)              kind: "posts" | "comments", value: -1 | 0 | 1
//  report({targetType,targetId,postId,reason,snippet}), dismissReport(id)
//  subscribeForums(cb, errCb)         forumi koje su napravili moderatori
//  createForum({name,desc,emoji,color,adminOnly}) -> id    (svaki prijavljen korisnik; adminOnly samo admin)
//  updateForum(id, {name,desc,emoji,color,adminOnly})   (autor foruma ili admin; ugrađene forume samo admin)
//  deleteForum(id)                    (autor foruma ili admin; ugrađeni se ne brišu)
//  subscribeNotifications(uid, cb), markNotificationsRead(ids), deleteNotifications(ids), clearNotifications()
//  createComment({postId,parentId,body,postTitle,notify:[{uid,type}]})   type: "comment" | "reply"
//  loadPhotos(imena) -> {ime: dataUrl|""}, setPhoto(dataUrl), removePhoto(ime)   (profilne slike)
//  loadBanner(ime) -> dataUrl|"", setBanner(dataUrl), removeBanner(ime)            (baner na profilu)

import { COMMUNITIES, FORUM_LIMITS, isBuiltin, slugify } from "./communities.js";
import { buildSeed } from "./seed.js";

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

export const IMAGE_MAX = 300000; // najviše znakova u data URL-u slike uz objavu
export const PHOTO_MAX = 20000;
export const BANNER_MAX = 150000; // najviše znakova u data URL-u banera // najviše znakova u data URL-u (oko 15 KB slike)

function validateImageData(dataUrl) {
  if (!dataUrl) return "";
  if (typeof dataUrl !== "string" || !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(dataUrl))
    throw fail("Slika nije ispravna. Izaberi JPG, PNG ili WebP.");
  if (dataUrl.length > IMAGE_MAX) throw fail("Slika je prevelika. Probaj drugu.");
  return dataUrl;
}

function validateBanner(dataUrl) {
  if (typeof dataUrl !== "string" || !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(dataUrl))
    throw fail("Slika nije ispravna. Izaberi JPG, PNG ili WebP.");
  if (dataUrl.length > BANNER_MAX) throw fail("Slika je prevelika. Probaj drugu.");
  return dataUrl;
}

function validatePhoto(dataUrl) {
  if (typeof dataUrl !== "string" || !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(dataUrl))
    throw fail("Slika nije ispravna. Izaberi JPG, PNG ili WebP.");
  if (dataUrl.length > PHOTO_MAX) throw fail("Slika je prevelika. Probaj drugu.");
  return dataUrl;
}

// Zajednička provera polja foruma (naziv, opis, ikonica, boja).
function forumFields({ name, desc, emoji, color }) {
  const n = (name || "").trim().replace(/\s+/g, " ");
  if (n.length < 2) throw fail("Naziv mora imati bar 2 znaka.");
  if (n.length > FORUM_LIMITS.name) throw fail(`Naziv može imati najviše ${FORUM_LIMITS.name} znakova.`);
  const d = (desc || "").trim();
  if (d.length > FORUM_LIMITS.desc) throw fail(`Opis može imati najviše ${FORUM_LIMITS.desc} znakova.`);
  const e = (emoji || "").trim() || "💬";
  if (e.length > 8) throw fail("Za ikonu upiši samo jedan emoji.");
  const col = /^#[0-9A-Fa-f]{6}$/.test(color || "") ? color : "#6D4AFF";
  return { name: n, desc: d, emoji: e, color: col };
}

function validateForum(input, isAdmin) {
  const f = forumFields(input);
  const id = slugify(f.name);
  if (id.length < 2) throw fail("Naziv mora sadržati bar dva slova ili broja.");
  if (isBuiltin(id) || COMMUNITIES.some((c) => c.id === id)) throw fail("Forum sa tim imenom već postoji.");
  return { id, ...f, adminOnly: isAdmin && Boolean(input.adminOnly) };
}

// Pri izmeni naziva proveri da ga ne nosi neki drugi forum.
function checkRename(id, name) {
  const key = name.toLowerCase();
  if (COMMUNITIES.some((c) => c.id !== id && (c.name.toLowerCase() === key || slugify(c.name) === slugify(name))))
    throw fail("Forum sa tim imenom već postoji.");
}

const NOTIF_TYPES = ["comment", "reply"];

function cleanNotify(list, meUid) {
  const seen = new Set();
  return (Array.isArray(list) ? list : []).filter((t) => {
    if (!t || typeof t.uid !== "string" || !NOTIF_TYPES.includes(t.type) || t.uid === meUid || seen.has(t.uid)) return false;
    seen.add(t.uid);
    return true;
  });
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
    doc, collection, getDoc, getDocs, addDoc, setDoc, deleteDoc, updateDoc, query, orderBy, limit, where,
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

    subscribeForums(cb, errCb) {
      return watch(collection(db, "forums"), (s) => s.docs.map(mapDoc), cb, errCb);
    },

    async createForum(input) {
      const me = need();
      const f = validateForum(input, me.isAdmin);
      try {
        await setDoc(doc(db, "forums", f.id), {
          name: f.name,
          desc: f.desc,
          emoji: f.emoji,
          color: f.color,
          adminOnly: f.adminOnly,
          createdBy: me.uid,
          createdAt: serverTimestamp(),
        });
        return f.id;
      } catch (e) {
        if (e && e.code === "permission-denied")
          throw fail("Forum nije napravljen. Proveri da li je ime novo i da li su najnovija pravila objavljena u Firebase konzoli.");
        throw friendlyError(e);
      }
    },

    async updateForum(id, input) {
      const me = need();
      const f = forumFields(input);
      checkRename(id, f.name);
      try {
        const ref = doc(db, "forums", id);
        if (isBuiltin(id)) {
          if (!me.isAdmin) throw fail("Ugrađene forume menjaju samo moderatori.");
          const cur = await getDoc(ref);
          if (cur.exists()) await updateDoc(ref, f);
          else await setDoc(ref, { ...f, adminOnly: false, createdBy: me.uid, createdAt: serverTimestamp() });
        } else {
          const patch = { ...f };
          if (me.isAdmin && typeof input.adminOnly === "boolean") patch.adminOnly = input.adminOnly;
          await updateDoc(ref, patch);
        }
      } catch (e) {
        if (e && e.code === "permission-denied")
          throw fail("Izmena nije sačuvana. Proveri da li su najnovija pravila objavljena u Firebase konzoli.");
        throw friendlyError(e);
      }
    },

    subscribeNotifications(uid, cb) {
      const q = query(collection(db, "users", uid, "notifications"), orderBy("createdAt", "desc"), limit(30));
      return watch(q, (s) => s.docs.map(mapDoc), cb, () => {});
    },

    async markNotificationsRead(ids) {
      const me = need();
      if (!ids.length) return;
      try {
        const batch = writeBatch(db);
        ids.slice(0, 30).forEach((id) => batch.update(doc(db, "users", me.uid, "notifications", id), { read: true }));
        await batch.commit();
      } catch (e) {
        console.error(e);
      }
    },

    async deleteNotifications(ids) {
      const me = need();
      if (!ids.length) return;
      try {
        const batch = writeBatch(db);
        ids.slice(0, 400).forEach((id) => batch.delete(doc(db, "users", me.uid, "notifications", id)));
        await batch.commit();
      } catch (e) {
        throw friendlyError(e);
      }
    },

    async clearNotifications() {
      const me = need();
      try {
        const snap = await getDocs(collection(db, "users", me.uid, "notifications"));
        for (let i = 0; i < snap.docs.length; i += 400) {
          const batch = writeBatch(db);
          snap.docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
          await batch.commit();
        }
      } catch (e) {
        throw friendlyError(e);
      }
    },

    async deleteForum(id) {
      need();
      if (isBuiltin(id)) throw fail("Ugrađeni forumi ne mogu da se obrišu.");
      try {
        await deleteDoc(doc(db, "forums", id));
      } catch (e) {
        throw friendlyError(e);
      }
    },

    async loadPhotos(names) {
      const out = {};
      await Promise.all(
        names.map(async (n) => {
          try {
            const d = await getDoc(doc(db, "profiles", n));
            out[n] = d.exists() && typeof d.data().photo === "string" ? d.data().photo : "";
          } catch (_) {
            out[n] = "";
          }
        })
      );
      return out;
    },

    async setPhoto(dataUrl) {
      const me = need();
      const photo = validatePhoto(dataUrl);
      try {
        await setDoc(doc(db, "profiles", me.username.toLowerCase()), { photo, updatedAt: serverTimestamp() });
      } catch (e) {
        if (e && e.code === "permission-denied")
          throw fail("Slika nije sačuvana. Proveri da li su najnovija pravila objavljena u Firebase konzoli.");
        throw friendlyError(e);
      }
    },

    async removePhoto(name) {
      need();
      try {
        await deleteDoc(doc(db, "profiles", String(name).toLowerCase()));
      } catch (e) {
        throw friendlyError(e);
      }
    },

    async loadBanner(name) {
      try {
        const d = await getDoc(doc(db, "banners", String(name).toLowerCase()));
        return d.exists() && typeof d.data().data === "string" ? d.data().data : "";
      } catch (_) {
        return "";
      }
    },

    async setBanner(dataUrl) {
      const me = need();
      const data = validateBanner(dataUrl);
      try {
        await setDoc(doc(db, "banners", me.username.toLowerCase()), { data, updatedAt: serverTimestamp() });
      } catch (e) {
        if (e && e.code === "permission-denied")
          throw fail("Baner nije sačuvan. Proveri da li su najnovija pravila objavljena u Firebase konzoli.");
        throw friendlyError(e);
      }
    },

    async removeBanner(name) {
      need();
      try {
        await deleteDoc(doc(db, "banners", String(name).toLowerCase()));
      } catch (e) {
        throw friendlyError(e);
      }
    },

    async createPost(input) {
      const me = need();
      const p = validatePost(input, me.isAdmin);
      const image = validateImageData(input.imageData);
      try {
        const postRef = doc(collection(db, "posts"));
        const post = {
          ...p,
          authorId: me.uid,
          authorName: me.username,
          createdAt: serverTimestamp(),
          score: 0,
          commentCount: 0,
        };
        if (!image) {
          await setDoc(postRef, post);
          return postRef.id;
        }
        const imgRef = doc(collection(db, "images"));
        const batch = writeBatch(db);
        batch.set(imgRef, { data: image, authorId: me.uid, createdAt: serverTimestamp() });
        batch.set(postRef, { ...post, imageId: imgRef.id });
        await batch.commit();
        return postRef.id;
      } catch (e) {
        if (e && e.code === "permission-denied" && image)
          throw fail("Slika nije sačuvana. Proveri da li su najnovija pravila objavljena u Firebase konzoli.");
        throw friendlyError(e);
      }
    },

    async loadImages(ids) {
      const out = {};
      await Promise.all(
        ids.map(async (id) => {
          try {
            const d = await getDoc(doc(db, "images", id));
            out[id] = d.exists() && typeof d.data().data === "string" ? d.data().data : "";
          } catch (_) {
            out[id] = "";
          }
        })
      );
      return out;
    },

    async deletePost(id) {
      need();
      try {
        const snap = await getDoc(doc(db, "posts", id));
        const imageId = snap.exists() ? snap.data().imageId : null;
        const batch = writeBatch(db);
        batch.delete(doc(db, "posts", id));
        if (imageId) batch.delete(doc(db, "images", imageId));
        await batch.commit();
      } catch (e) {
        throw friendlyError(e);
      }
    },

    async createComment({ postId, parentId, body, postTitle, notify }) {
      const me = need();
      const text = validateComment(body);
      try {
        const batch = writeBatch(db);
        const ref = doc(collection(db, "comments"));
        cleanNotify(notify, me.uid).forEach((t) => {
          batch.set(doc(collection(db, "users", t.uid, "notifications")), {
            type: t.type,
            fromName: me.username,
            postId,
            postTitle: String(postTitle || "").slice(0, 120),
            commentId: ref.id,
            createdAt: serverTimestamp(),
            read: false,
          });
        });
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
  const KEY = "glas.demo.v2";
  const listeners = new Set();
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const newId = () => "d" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-3);

  let data = load();

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return JSON.parse(raw);
    } catch (_) { /* ignore */ }
    return buildSeed();
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
    subscribeForums(cb) {
      return sub(() => data.forums || [], cb);
    },

    async createForum(input) {
      const m = need();
      const f = validateForum(input, m.isAdmin);
      data.forums = data.forums || [];
      data.forums.push({ ...f, createdBy: m.uid, createdAt: Date.now() });
      save();
      return f.id;
    },

    async updateForum(id, input) {
      const m = need();
      const f = forumFields(input);
      checkRename(id, f.name);
      data.forums = data.forums || [];
      let x = data.forums.find((z) => z.id === id);
      if (isBuiltin(id)) {
        if (!m.isAdmin) throw fail("Ugrađene forume menjaju samo moderatori.");
        if (!x) { x = { id, adminOnly: false, createdBy: m.uid, createdAt: Date.now() }; data.forums.push(x); }
      } else {
        if (!x) throw fail("Forum ne postoji.");
        if (x.createdBy !== m.uid && !m.isAdmin) throw fail("Nemaš dozvolu za ovu radnju.");
        if (m.isAdmin && typeof input.adminOnly === "boolean") x.adminOnly = input.adminOnly;
      }
      Object.assign(x, f);
      save();
    },

    subscribeNotifications(uid, cb) {
      return sub(() => [...((data.notifications || {})[uid] || [])].sort((a, b) => b.createdAt - a.createdAt).slice(0, 30), cb);
    },

    async markNotificationsRead(ids) {
      const m = need();
      ((data.notifications || {})[m.uid] || []).forEach((n) => { if (ids.includes(n.id)) n.read = true; });
      save();
    },

    async deleteNotifications(ids) {
      const m = need();
      data.notifications = data.notifications || {};
      data.notifications[m.uid] = (data.notifications[m.uid] || []).filter((n) => !ids.includes(n.id));
      save();
    },

    async clearNotifications() {
      const m = need();
      data.notifications = data.notifications || {};
      data.notifications[m.uid] = [];
      save();
    },

    async deleteForum(id) {
      const m = need();
      if (isBuiltin(id)) throw fail("Ugrađeni forumi ne mogu da se obrišu.");
      const f = (data.forums || []).find((x) => x.id === id);
      if (f && f.createdBy !== m.uid && !m.isAdmin) throw fail("Nemaš dozvolu za ovu radnju.");
      data.forums = (data.forums || []).filter((x) => x.id !== id);
      save();
    },

    async loadPhotos(names) {
      const out = {};
      names.forEach((n) => (out[n] = (data.profiles && data.profiles[n]) || ""));
      return out;
    },

    async loadImages(ids) {
      const out = {};
      ids.forEach((id) => (out[id] = (data.images && data.images[id]) || ""));
      return out;
    },

    async setPhoto(dataUrl) {
      const m = need();
      const photo = validatePhoto(dataUrl);
      data.profiles = data.profiles || {};
      data.profiles[m.username.toLowerCase()] = photo;
      save();
    },

    async removePhoto(name) {
      const m = need();
      const key = String(name).toLowerCase();
      if (key !== m.username.toLowerCase() && !m.isAdmin) throw fail("Nemaš dozvolu za ovu radnju.");
      if (data.profiles) delete data.profiles[key];
      save();
    },

    async loadBanner(name) {
      return (data.banners && data.banners[String(name).toLowerCase()]) || "";
    },

    async setBanner(dataUrl) {
      const m = need();
      const b = validateBanner(dataUrl);
      data.banners = data.banners || {};
      data.banners[m.username.toLowerCase()] = b;
      save();
    },

    async removeBanner(name) {
      const m = need();
      const key = String(name).toLowerCase();
      if (key !== m.username.toLowerCase() && !m.isAdmin) throw fail("Nemaš dozvolu za ovu radnju.");
      if (data.banners) delete data.banners[key];
      save();
    },

    async createPost(input) {
      const m = need();
      const p = validatePost(input, m.isAdmin);
      const image = validateImageData(input.imageData);
      const post = {
        id: newId(), ...p, authorId: m.uid, authorName: m.username,
        createdAt: Date.now(), score: 0, commentCount: 0,
      };
      if (image) {
        data.images = data.images || {};
        post.imageId = newId();
        data.images[post.imageId] = image;
      }
      data.posts.push(post);
      save();
      return post.id;
    },

    async deletePost(id) {
      const m = need();
      const p = data.posts.find((x) => x.id === id);
      if (!p) return;
      if (p.authorId !== m.uid && !m.isAdmin) throw fail("Nemaš dozvolu za ovu radnju.");
      if (p.imageId && data.images) delete data.images[p.imageId];
      data.posts = data.posts.filter((x) => x.id !== id);
      data.comments = data.comments.filter((c) => c.postId !== id);
      save();
    },

    async createComment({ postId, parentId, body, postTitle, notify }) {
      const m = need();
      const text = validateComment(body);
      const post = data.posts.find((p) => p.id === postId);
      if (!post) throw fail("Objava više ne postoji.");
      const c = {
        id: newId(), postId, parentId: parentId || null, body: text,
        authorId: m.uid, authorName: m.username, createdAt: Date.now(), score: 0, deleted: false,
      };
      data.notifications = data.notifications || {};
      cleanNotify(notify, m.uid).forEach((t) => {
        (data.notifications[t.uid] = data.notifications[t.uid] || []).push({
          id: newId(), type: t.type, fromName: m.username, postId,
          postTitle: String(postTitle || "").slice(0, 120), commentId: c.id, createdAt: Date.now(), read: false,
        });
      });
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

}
