import { firebaseConfig, settings } from "./firebase-config.js";
import { COMMUNITIES, ALL_FORUMS, getCommunity } from "./communities.js";
import { createBackend, LIMITS } from "./db.js";

/* ------------------------------------------------------------------ */
/* Stanje                                                              */
/* ------------------------------------------------------------------ */

let backend = null;

const state = {
  user: null,
  authReady: false,
  posts: [],
  postsLoaded: false,
  postsError: null,
  myVotes: {},
  route: { name: "feed" },
  sort: "hot",
  commentSort: "best",
  query: "",
  post: undefined, // undefined = učitava se, null = ne postoji
  comments: [],
  commentsLoaded: false,
  reports: [],
  collapsed: new Set(),
  reply: null, // { id, text }
  draftComment: "",
  draft: { community: "", title: "", body: "", url: "" },
  busy: new Set(),
};

let unsubPosts = null;
let unsubVotes = null;
let unsubReports = null;
let routeSubs = [];

/* ------------------------------------------------------------------ */
/* Pomoćne funkcije                                                    */
/* ------------------------------------------------------------------ */

const $ = (sel, root = document) => root.querySelector(sel);
const enc = encodeURIComponent;

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function ago(ms) {
  const s = Math.max(1, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return "upravo sada";
  const m = Math.floor(s / 60);
  if (m < 60) return `pre ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `pre ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `pre ${d} ${d === 1 ? "dan" : "dana"}`;
  return new Date(ms).toLocaleDateString("sr-Latn-RS");
}

const pluralComments = (n) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? "komentar" : "komentara"}`;
const pluralPosts = (n) =>
  `${n} ${n % 10 === 1 && n % 100 !== 11 ? "objava" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? "objave" : "objava"}`;

function formatBody(text) {
  return esc(text).replace(/(https?:\/\/[^\s<]+)/g, (m) => {
    const trail = (m.match(/[.,;:!?)]+$/) || [""])[0];
    const url = trail ? m.slice(0, -trail.length) : m;
    return `<a href="${url}" target="_blank" rel="noopener noreferrer nofollow">${url}</a>${trail}`;
  });
}

function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch (_) {
    return url;
  }
}

function isImageUrl(url) {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) && /\.(png|jpe?g|gif|webp|avif)$/i.test(u.pathname);
  } catch (_) {
    return false;
  }
}

function snippet(text, n = 220) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n).trimEnd() + "…" : t;
}

let toastTimer = null;
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3200);
}

const svg = (path, size = 16, extra = "") =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${path}</svg>`;

const icon = {
  up: svg('<path d="M12 4l8 10h-5v6H9v-6H4z"/>', 18),
  down: svg('<path d="M12 20L4 10h5V4h6v6h5z"/>', 18),
  comment: svg('<path d="M4 5h16v11H9l-5 4z"/>'),
  flag: svg('<path d="M5 21V4h12l-2 4 2 4H5"/>'),
  trash: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  reply: svg('<path d="M9 14L4 9l5-5M4 9h9a7 7 0 017 7v3"/>'),
  link: svg('<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/>', 15),
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>', 18),
  moon: svg('<path d="M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z"/>', 18),
  home: svg('<path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z"/>', 22),
  grid: svg('<rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/>', 22),
  plus: svg('<path d="M12 5v14M5 12h14"/>', 26, 'stroke-width="2.6"'),
  user: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>', 22),
};

function hue(name) {
  let h = 0;
  for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 360;
}
const avatar = (name, size = "") =>
  `<span class="avatar ${size}" style="background:hsl(${hue(name)} 90% 68%)" aria-hidden="true">${esc(String(name || "?").charAt(0).toUpperCase())}</span>`;
const emo = (c, size = "") =>
  `<span class="emo ${size}" style="--c:${esc(c.color)}" aria-hidden="true">${c.emoji}</span>`;

/* ------------------------------------------------------------------ */
/* Tema                                                                */
/* ------------------------------------------------------------------ */

const currentTheme = () => (document.documentElement.dataset.theme === "light" ? "light" : "dark");

function renderThemeButton() {
  const btn = $("#theme-btn");
  btn.innerHTML = currentTheme() === "dark" ? icon.sun : icon.moon;
  btn.title = currentTheme() === "dark" ? "Svetla tema" : "Tamna tema";
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = currentTheme() === "dark" ? "#0d0b1a" : "#f5f3ff";
}
function toggleTheme() {
  const next = currentTheme() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem("glas.theme", next); } catch (_) { /* ignore */ }
  renderThemeButton();
}

/* ------------------------------------------------------------------ */
/* Ruta                                                                */
/* ------------------------------------------------------------------ */

function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, "").split("/").map((p) => {
    try { return decodeURIComponent(p); } catch (_) { return p; }
  });
  switch (parts[0]) {
    case "f": return { name: "feed", community: parts[1] || "" };
    case "p": return { name: "post", id: parts[1] || "" };
    case "u": return { name: "user", username: parts[1] || "" };
    case "novo": return { name: "new", community: parts[1] || "" };
    case "prijave": return { name: "reports" };
    default: return { name: "feed", community: "" };
  }
}

const readingAllowed = () => !settings.requireLoginToRead || Boolean(state.user);

function clearRouteSubs() {
  routeSubs.forEach((u) => u && u());
  routeSubs = [];
}

function onRoute() {
  const prev = state.route;
  state.route = parseRoute();
  clearRouteSubs();
  state.reply = null;

  if (state.route.name === "post") {
    state.post = undefined;
    state.comments = [];
    state.commentsLoaded = false;
    state.draftComment = "";
    if (backend && readingAllowed()) {
      routeSubs.push(
        backend.subscribePost(state.route.id, (p) => { state.post = p; renderData(); }, () => { state.post = null; renderData(); }),
        backend.subscribeComments(state.route.id, (c) => { state.comments = c; state.commentsLoaded = true; renderData(); })
      );
    }
  }

  if (state.route.name === "new") {
    const wanted = state.route.community;
    const ok = COMMUNITIES.find((c) => c.id === wanted);
    if (prev.name !== "new" || (ok && state.draft.community !== wanted)) {
      state.draft = { community: ok ? wanted : state.draft.community || "", title: "", body: "", url: "" };
    }
  }

  window.scrollTo(0, 0);
  render();
}

/* ------------------------------------------------------------------ */
/* Pretplate na podatke                                                */
/* ------------------------------------------------------------------ */

function syncPostsSub() {
  if (!backend) return;
  if (readingAllowed() && !unsubPosts) {
    unsubPosts = backend.subscribePosts(
      (posts) => { state.posts = posts; state.postsLoaded = true; state.postsError = null; renderData(); },
      (err) => { state.postsError = err; state.postsLoaded = true; renderData(); }
    );
  } else if (!readingAllowed() && unsubPosts) {
    unsubPosts();
    unsubPosts = null;
    state.posts = [];
    state.postsLoaded = false;
  }
}

function syncUserSubs() {
  if (unsubVotes) { unsubVotes(); unsubVotes = null; }
  if (unsubReports) { unsubReports(); unsubReports = null; }
  state.myVotes = {};
  state.reports = [];
  if (state.user) {
    unsubVotes = backend.subscribeMyVotes(state.user.uid, (map) => { state.myVotes = map; renderData(); });
    if (state.user.isAdmin) {
      unsubReports = backend.subscribeReports((r) => { state.reports = r; renderData(); }, () => {});
    }
  }
}

/* ------------------------------------------------------------------ */
/* Iscrtavanje                                                         */
/* ------------------------------------------------------------------ */

let renderScheduled = false;
function renderData() {
  if (renderScheduled) return;
  renderScheduled = true;
  requestAnimationFrame(() => {
    renderScheduled = false;
    // Dok korisnik piše novu objavu, podaci iz baze ne smeju da mu prepišu formu.
    if (state.route.name !== "new") render();
  });
}

function captureFocus() {
  const ae = document.activeElement;
  const main = $("#main");
  if (!ae || !ae.id || !main.contains(ae)) return () => {};
  const id = ae.id;
  const sel = typeof ae.selectionStart === "number" ? [ae.selectionStart, ae.selectionEnd] : null;
  return () => {
    const el = document.getElementById(id);
    if (!el) return;
    el.focus({ preventScroll: true });
    if (sel && el.setSelectionRange) {
      try { el.setSelectionRange(sel[0], sel[1]); } catch (_) { /* ignore */ }
    }
  };
}

function render() {
  const restore = captureFocus();
  renderAuthBox();
  renderSidebar();
  renderAside();
  renderBottomNav();

  let html;
  if (!state.authReady) html = loadingView();
  else if (!readingAllowed()) html = gateView();
  else {
    switch (state.route.name) {
      case "post": html = postView(); break;
      case "new": html = newPostView(); break;
      case "user": html = userView(); break;
      case "reports": html = reportsView(); break;
      default: html = feedView();
    }
  }
  $("#main").innerHTML = html;
  updateTitle();
  restore();
}

function updateTitle() {
  const r = state.route;
  let t = "Glas: mesto za razgovor mladih";
  if (r.name === "feed" && r.community) t = `${getCommunity(r.community).name} | Glas`;
  else if (r.name === "post" && state.post) t = `${state.post.title} | Glas`;
  else if (r.name === "new") t = "Nova objava | Glas";
  else if (r.name === "user") t = `${r.username} | Glas`;
  else if (r.name === "reports") t = "Prijave | Glas";
  document.title = t;
}

const newPostHref = () => `#/novo${state.route.name === "feed" && state.route.community ? "/" + enc(state.route.community) : ""}`;

function renderAuthBox() {
  const box = $("#authbox");
  if (!state.authReady) { box.innerHTML = ""; return; }
  const newBtn = `<a class="btn btn-primary hide-sm" href="${newPostHref()}">Nova objava</a>`;
  if (state.user) {
    box.innerHTML = `${newBtn}
      <a class="user-link" href="#/u/${enc(state.user.username)}">${avatar(state.user.username, "sm")}${esc(state.user.username)}</a>
      <button class="btn hide-sm" type="button" data-action="logout">Odjavi se</button>`;
  } else {
    box.innerHTML = `${newBtn}
      <button class="btn" type="button" data-action="auth" data-value="login">Prijavi se</button>`;
  }
}

function renderSidebar() {
  const r = state.route;
  const cur = (cond) => (cond ? ' aria-current="page"' : "");
  const reportsLink = state.user && state.user.isAdmin
    ? `<li><a class="side-link" href="#/prijave"${cur(r.name === "reports")}>${emo({ emoji: "🚩", color: "#FF4FA3" })}Prijave${state.reports.length ? `<span class="count">${state.reports.length}</span>` : ""}</a></li>`
    : "";
  $("#sidebar").innerHTML = `
    <h2 class="side-h">Forumi</h2>
    <ul>
      <li><a class="side-link" href="#/"${cur(r.name === "feed" && !r.community)}>${emo(ALL_FORUMS)}Sve objave</a></li>
      ${COMMUNITIES.map((c) => `<li><a class="side-link" href="#/f/${c.id}"${cur(r.name === "feed" && r.community === c.id)}>${emo(c)}${esc(c.name)}</a></li>`).join("")}
      ${reportsLink}
    </ul>`;
}

function renderAside() {
  const c = state.route.name === "feed" && state.route.community ? getCommunity(state.route.community) : null;
  $("#aside").innerHTML = `
    <div class="panel">
      <h2>${c ? esc(c.name) : "O Glasu"}</h2>
      <p>${c ? esc(c.desc) : "Mesto gde mladi pokreću teme o igricama, muzici, filmovima, sportu, mimovima i svemu ostalom."}</p>
      <a class="btn btn-primary wide" href="${newPostHref()}">Šta ima novo?</a>
    </div>
    <div class="panel">
      <h2>Pravila Glasa</h2>
      <ol>
        <li>Zezanje da, vređanje ne.</li>
        <li>Ne deli lične podatke, svoje ni tuđe.</li>
        <li>Bez mržnje, pretnji i neprimerenog sadržaja.</li>
        <li>Vidiš nešto sumnjivo? Prijavi.</li>
      </ol>
    </div>`;
}

function renderBottomNav() {
  const r = state.route;
  const cur = (cond) => (cond ? ' aria-current="page"' : "");
  const profile = state.user
    ? `<a class="bn-item" href="#/u/${enc(state.user.username)}"${cur(r.name === "user" && r.username.toLowerCase() === state.user.username.toLowerCase())}>${icon.user}Profil</a>`
    : `<button class="bn-item" type="button" data-action="auth" data-value="login">${icon.user}Prijava</button>`;
  $("#bottom-nav").innerHTML = `
    <a class="bn-item" href="#/"${cur(r.name === "feed")}>${icon.home}Početna</a>
    <button class="bn-item" type="button" data-action="forums">${icon.grid}Forumi</button>
    <a class="bn-plus" href="${newPostHref()}" aria-label="Nova objava">${icon.plus}</a>
    ${profile}`;
}

function renderBanner() {
  const el = $("#banner");
  if (backend.initError) {
    el.innerHTML = `<div class="banner error"><strong>Firebase nije mogao da se učita.</strong> Proveri internet vezu i firebase-config.js. Zasad se prikazuje demo režim: teme se čuvaju samo u ovom pregledaču.</div>`;
  } else if (backend.mode === "demo") {
    el.innerHTML = `<div class="banner"><strong>Demo režim.</strong> Teme se čuvaju samo u ovom pregledaču. Da Glas bude zajednički za sve, popuni firebase-config.js (uputstvo je u README.md).</div>`;
  } else {
    el.innerHTML = "";
  }
}

/* ---------- Pogledi ---------- */

const loadingView = () => `<div class="panel skeleton" aria-busy="true"><span></span><span></span><span></span></div>`;

function gateView() {
  return `<div class="panel empty">
    <h2>Glas je za članove</h2>
    <p>Prijavi se da vidiš teme i da učestvuješ u razgovoru.</p>
    <button class="btn btn-primary" type="button" data-action="auth" data-value="login">Prijavi se</button>
  </div>`;
}

function hotRank(p) {
  const ageH = Math.max(0, (Date.now() - p.createdAt) / 3600000);
  return (p.score + 1) / Math.pow(ageH + 2, 1.4);
}

function sortPosts(list) {
  const arr = [...list];
  if (state.sort === "new") arr.sort((a, b) => b.createdAt - a.createdAt);
  else if (state.sort === "top") arr.sort((a, b) => b.score - a.score || b.createdAt - a.createdAt);
  else arr.sort((a, b) => hotRank(b) - hotRank(a));
  return arr;
}

function votePill(kind, id, score, my, small = false) {
  const cls = score > 0 ? "pos" : score < 0 ? "neg" : "";
  return `<div class="votes ${small ? "sm" : ""}" role="group" aria-label="Glasanje">
    <button class="vote up ${my === 1 ? "on" : ""}" id="vote-${kind}-${esc(id)}-up" type="button" data-action="vote" data-kind="${kind}" data-id="${esc(id)}" data-value="1" aria-pressed="${my === 1}" aria-label="Glasaj za">${icon.up}</button>
    <span class="score ${cls}">${score}</span>
    <button class="vote down ${my === -1 ? "on" : ""}" id="vote-${kind}-${esc(id)}-down" type="button" data-action="vote" data-kind="${kind}" data-id="${esc(id)}" data-value="-1" aria-pressed="${my === -1}" aria-label="Glasaj protiv">${icon.down}</button>
  </div>`;
}

const canDelete = (item) => state.user && (state.user.uid === item.authorId || state.user.isAdmin);
const canReport = (item) => !state.user || state.user.uid !== item.authorId;

function postHead(p) {
  const c = getCommunity(p.community);
  return `<header class="post-head">
    ${avatar(p.authorName)}
    <div class="who">
      <a class="name" href="#/u/${enc(p.authorName)}">${esc(p.authorName)}</a>
      <div class="sub">
        <a class="chip" href="#/f/${esc(c.id)}">${emo(c, "sm")}${esc(c.name)}</a>
        <time datetime="${new Date(p.createdAt).toISOString()}">${ago(p.createdAt)}</time>
      </div>
    </div>
  </header>`;
}

function postMedia(p) {
  if (!p.url) return "";
  const img = isImageUrl(p.url)
    ? `<img class="post-img" src="${esc(p.url)}" alt="Slika uz objavu" loading="lazy" referrerpolicy="no-referrer">`
    : "";
  return `${img}<a class="link-out" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer nofollow">${icon.link}${esc(img ? domainOf(p.url) : p.url.length > 60 ? domainOf(p.url) : p.url)}</a>`;
}

function postFoot(p, full) {
  return `<footer class="post-foot">
    ${votePill("posts", p.id, p.score, state.myVotes[p.id] || 0)}
    ${full
      ? `<span class="pill" aria-label="${pluralComments(p.commentCount || 0)}">${icon.comment} ${p.commentCount || 0}</span>`
      : `<a class="pill" href="#/p/${esc(p.id)}" aria-label="${pluralComments(p.commentCount || 0)}">${icon.comment} ${p.commentCount || 0}</a>`}
    ${canReport(p) ? `<button class="pill ghost" type="button" data-action="report" data-type="post" data-id="${esc(p.id)}">${icon.flag} Prijavi</button>` : ""}
    ${canDelete(p) ? `<button class="pill ghost danger" type="button" data-action="delete-post" data-id="${esc(p.id)}">${icon.trash} Obriši</button>` : ""}
  </footer>`;
}

function postRow(p) {
  return `<article class="post">
    ${postHead(p)}
    <h2 class="post-title"><a href="#/p/${esc(p.id)}">${esc(p.title)}</a></h2>
    ${postMedia(p)}
    ${p.body ? `<p class="post-snippet">${esc(snippet(p.body))}</p>` : ""}
    ${postFoot(p, false)}
  </article>`;
}

function sortBar() {
  const tabs = [["hot", "Popularno"], ["new", "Novo"], ["top", "Najbolje"]];
  return `<div class="toolbar"><div class="seg" role="group" aria-label="Redosled">
    ${tabs.map(([v, l]) => `<button type="button" data-action="sort" data-value="${v}" aria-pressed="${state.sort === v}">${l}</button>`).join("")}
  </div></div>`;
}

function feedView() {
  const r = state.route;
  if (r.community && !COMMUNITIES.some((c) => c.id === r.community)) {
    return `<div class="panel empty"><h2>Ovaj forum ne postoji</h2><p>Izaberi neki od foruma.</p><a class="btn" href="#/">Sve objave</a></div>`;
  }
  const c = r.community ? getCommunity(r.community) : null;
  const q = state.query.trim().toLowerCase();

  let list = state.posts.filter((p) => !c || p.community === c.id);
  if (q) list = list.filter((p) => `${p.title} ${p.body} ${p.authorName}`.toLowerCase().includes(q));
  list = sortPosts(list);

  const head = `<section class="feed-head">
    <div class="feed-title">${emo(c || ALL_FORUMS, "lg")}<h1>${c ? esc(c.name) : "Sve objave"}</h1></div>
    ${c ? `<p class="feed-desc">${esc(c.desc)}</p>` : ""}
  </section>`;

  let body;
  if (state.postsError) {
    body = `<div class="panel empty"><h2>Objave nisu učitane</h2><p>${esc(state.postsError.message)}</p></div>`;
  } else if (!state.postsLoaded) {
    body = loadingView();
  } else if (!list.length) {
    body = q
      ? `<div class="panel empty"><h2>Nema rezultata za „${esc(state.query.trim())}“</h2><p>Probaj drugu reč ili pogledaj sve forume.</p></div>`
      : `<div class="panel empty"><h2>Ovde je još tiho</h2><p>Pokreni prvu temu${c ? ` na forumu ${esc(c.name)}` : ""}.</p><a class="btn btn-primary" href="${newPostHref()}">Šta ima novo?</a></div>`;
  } else {
    body = `<div class="feed">${list.map(postRow).join("")}</div>`;
  }
  return head + sortBar() + body;
}

function userView() {
  const name = state.route.username;
  const list = sortPosts(state.posts.filter((p) => p.authorName.toLowerCase() === name.toLowerCase()));
  const mine = state.user && state.user.username.toLowerCase() === name.toLowerCase();
  const head = `<section class="profile-head">
    ${avatar(name, "xl")}
    <div>
      <h1>${esc(name)}</h1>
      <p class="feed-desc">${pluralPosts(list.length)} među poslednjih 300 na Glasu.</p>
    </div>
    ${mine ? `<button class="btn" type="button" data-action="logout" style="margin-left:auto">Odjavi se</button>` : ""}
  </section>`;
  const body = !state.postsLoaded
    ? loadingView()
    : list.length
      ? `<div class="feed">${list.map(postRow).join("")}</div>`
      : `<div class="panel empty"><h2>Nema objava</h2><p>Ovaj korisnik još nije pokrenuo nijednu temu.</p></div>`;
  return head + sortBar() + body;
}

/* ---------- Objava i komentari ---------- */

function postView() {
  if (state.post === undefined) return loadingView();
  if (state.post === null) {
    return `<div class="panel empty"><h2>Objava ne postoji</h2><p>Možda je obrisana ili je link pogrešan.</p><a class="btn" href="#/">Nazad na sve objave</a></div>`;
  }
  const p = state.post;
  const c = getCommunity(p.community);

  const article = `<article class="post post-full">
    ${postHead(p)}
    <h1 class="post-title">${esc(p.title)}</h1>
    ${postMedia(p)}
    ${p.body ? `<div class="prose">${formatBody(p.body)}</div>` : ""}
    ${postFoot(p, true)}
  </article>`;

  const composer = state.user
    ? `<form class="panel composer" data-form="comment">
        <h2>Dodaj komentar</h2>
        <textarea id="new-comment" name="body" rows="4" maxlength="${LIMITS.comment}" placeholder="Šta ti je na umu?" aria-label="Komentar">${esc(state.draftComment)}</textarea>
        <div class="form-error" role="alert"></div>
        <button class="btn btn-primary" type="submit">Komentariši</button>
      </form>`
    : `<div class="panel composer"><h2>Dodaj komentar</h2><p style="color:var(--ink-2);margin:6px 0 12px">Prijavi se da uđeš u razgovor.</p><button class="btn btn-primary" type="button" data-action="auth" data-value="login">Prijavi se</button></div>`;

  const count = state.comments.length;
  const comments = `<section class="panel comments" aria-label="Komentari">
    <div class="comments-head">
      <h2>${count ? pluralComments(count) : "Komentari"}</h2>
      <div class="seg" role="group" aria-label="Redosled komentara">
        <button type="button" data-action="csort" data-value="best" aria-pressed="${state.commentSort === "best"}">Najbolji</button>
        <button type="button" data-action="csort" data-value="new" aria-pressed="${state.commentSort === "new"}">Najnoviji</button>
      </div>
    </div>
    ${!state.commentsLoaded ? '<div class="skeleton"><span></span><span></span></div>' : count ? buildCommentTree() : `<p style="color:var(--ink-2)">Još nema komentara. Napiši prvi.</p>`}
  </section>`;

  return `<p class="crumbs"><a href="#/f/${esc(c.id)}">Nazad na ${esc(c.name)}</a></p>${article}${composer}${comments}`;
}

function buildCommentTree() {
  const byParent = {};
  const ids = new Set(state.comments.map((c) => c.id));
  state.comments.forEach((c) => {
    const key = c.parentId && ids.has(c.parentId) ? c.parentId : "root";
    (byParent[key] = byParent[key] || []).push(c);
  });
  const cmp = state.commentSort === "new"
    ? (a, b) => b.createdAt - a.createdAt
    : (a, b) => b.score - a.score || a.createdAt - b.createdAt;
  Object.values(byParent).forEach((arr) => arr.sort(cmp));

  const node = (c, depth) => {
    const kids = byParent[c.id] || [];
    const folded = state.collapsed.has(c.id);
    const my = state.myVotes[c.id] || 0;
    const cls = ["comment", kids.length && !folded ? "" : "leaf", depth >= 5 ? "flat" : ""].filter(Boolean).join(" ");
    const author = c.deleted ? "[obrisano]" : `<a class="author" href="#/u/${enc(c.authorName)}">${esc(c.authorName)}</a>`;
    const av = c.deleted ? `<span class="avatar sm" style="background:var(--surface-2)" aria-hidden="true"></span>` : avatar(c.authorName, "sm");

    let content = "";
    if (!folded) {
      const actions = c.deleted ? "" : `<div class="c-actions">
          ${votePill("comments", c.id, c.score, my, true)}
          <button class="pill ghost" type="button" data-action="reply-open" data-id="${esc(c.id)}">${icon.reply} Odgovori</button>
          ${canReport(c) ? `<button class="pill ghost" type="button" data-action="report" data-type="comment" data-id="${esc(c.id)}">${icon.flag} Prijavi</button>` : ""}
          ${canDelete(c) ? `<button class="pill ghost danger" type="button" data-action="delete-comment" data-id="${esc(c.id)}">${icon.trash} Obriši</button>` : ""}
        </div>`;
      const replyForm = state.reply && state.reply.id === c.id
        ? `<form class="reply-form" data-form="reply" data-parent="${esc(c.id)}">
            <textarea id="reply-input" name="body" rows="3" maxlength="${LIMITS.comment}" placeholder="Tvoj odgovor" aria-label="Tvoj odgovor">${esc(state.reply.text)}</textarea>
            <div class="form-error" role="alert"></div>
            <div class="row"><button class="btn btn-primary" type="submit">Odgovori</button><button class="btn" type="button" data-action="reply-cancel">Otkaži</button></div>
          </form>`
        : "";
      content = `<div class="c-body prose ${c.deleted ? "removed" : ""}">${c.deleted ? "[obrisano]" : formatBody(c.body)}</div>
        ${actions}${replyForm}
        <div class="children">${kids.map((k) => node(k, depth + 1)).join("")}</div>`;
    }

    return `<div class="${cls}" id="c-${esc(c.id)}">
      <button class="thread" type="button" data-action="collapse" data-id="${esc(c.id)}" aria-label="${folded ? "Prikaži nit" : "Sakrij nit"}" aria-expanded="${!folded}">${av}</button>
      <div class="c-main">
        <div class="c-head">${author}<time>${ago(c.createdAt)}</time>
          ${folded ? `<button class="collapse-note" type="button" data-action="collapse" data-id="${esc(c.id)}">Prikaži komentar${kids.length ? ` i ${kids.length} ${kids.length === 1 ? "odgovor" : "odgovora"}` : ""}</button>` : ""}
        </div>
        ${content}
      </div>
    </div>`;
  };

  return (byParent.root || []).map((c) => node(c, 0)).join("");
}

/* ---------- Nova objava ---------- */

function newPostView() {
  if (!state.user) {
    return `<div class="panel empty"><h2>Prijavi se da pokreneš temu</h2><p>Nalog se pravi za minut.</p>
      <button class="btn btn-primary" type="button" data-action="auth" data-value="login">Prijavi se</button></div>`;
  }
  const d = state.draft;
  const options = COMMUNITIES.filter((c) => !c.adminOnly || state.user.isAdmin);
  return `<form class="panel new-post" data-form="newpost" novalidate>
    <h1>Šta ima novo?</h1>
    <label class="field"><span>Forum</span>
      <select id="np-community" name="community" data-draft="community" required>
        <option value="" ${d.community ? "" : "selected"} disabled>Izaberi forum</option>
        ${options.map((c) => `<option value="${c.id}" ${d.community === c.id ? "selected" : ""}>${c.emoji} ${esc(c.name)}</option>`).join("")}
      </select>
    </label>
    <label class="field"><span>Naslov</span>
      <input id="np-title" name="title" type="text" maxlength="${LIMITS.title}" data-draft="title" value="${esc(d.title)}" placeholder="O čemu hoćeš da pričaš?" required>
    </label>
    <label class="field"><span>Tekst (nije obavezan)</span>
      <textarea id="np-body" name="body" rows="8" maxlength="${LIMITS.body}" data-draft="body" placeholder="Ovde možeš detaljnije">${esc(d.body)}</textarea>
    </label>
    <label class="field"><span>Link ili slika (nije obavezno)</span>
      <input id="np-url" name="url" type="url" maxlength="${LIMITS.url}" data-draft="url" value="${esc(d.url)}" placeholder="https://">
      <small>Link do slike (.jpg, .png, .gif, .webp) prikazuje se direktno u objavi. Ne objavljuj lične podatke, svoje ni tuđe.</small>
    </label>
    <div class="form-error" role="alert"></div>
    <div class="form-actions">
      <button class="btn btn-primary" type="submit">Objavi</button>
      <a class="btn" href="#/${state.draft.community ? "f/" + state.draft.community : ""}">Otkaži</a>
    </div>
  </form>`;
}

/* ---------- Prijave (admin) ---------- */

function reportsView() {
  if (!state.user || !state.user.isAdmin) {
    return `<div class="panel empty"><h2>Samo za administratore</h2><p>Ovu stranicu mogu da vide samo moderatori.</p><a class="btn" href="#/">Nazad na Glas</a></div>`;
  }
  const head = `<section class="feed-head"><div class="feed-title">${emo({ emoji: "🚩", color: "#FF4FA3" }, "lg")}<h1>Prijave</h1></div>
    <p class="feed-desc">Sadržaj koji su članovi prijavili. Obriši ga ili odbaci prijavu.</p></section>`;
  if (!state.reports.length) {
    return head + `<div class="panel empty"><h2>Nema prijava</h2><p>Kad neko prijavi objavu ili komentar, pojaviće se ovde.</p></div>`;
  }
  return head + `<div class="panel reports-list">${state.reports.map((r) => `
    <div class="report">
      <strong>${r.targetType === "post" ? "Objava" : "Komentar"}</strong> <span style="color:var(--ink-3)">${ago(r.createdAt)}</span>
      <p>Razlog: ${esc(r.reason || "nije naveden")}</p>
      <p class="snippet">${esc(r.snippet)}</p>
      <div class="row">
        <a class="btn" href="#/p/${esc(r.postId)}">Otvori</a>
        <button class="btn btn-danger" type="button" data-action="remove-reported" data-type="${esc(r.targetType)}" data-id="${esc(r.targetId)}" data-report="${esc(r.id)}">Obriši sadržaj</button>
        <button class="btn" type="button" data-action="dismiss-report" data-report="${esc(r.id)}">Odbaci prijavu</button>
      </div>
    </div>`).join("")}</div>`;
}

/* ------------------------------------------------------------------ */
/* Dijalozi                                                            */
/* ------------------------------------------------------------------ */

function openDialog(html) {
  const d = $("#dlg");
  d.innerHTML = `<div class="dlg">${html}</div>`;
  if (!d.open) d.showModal();
  const first = d.querySelector("input, textarea, select");
  if (first) first.focus();
}
function closeDialog() {
  const d = $("#dlg");
  if (d.open) d.close();
}

function forumsDialog() {
  const r = state.route;
  const cur = (cond) => (cond ? ' aria-current="page"' : "");
  openDialog(`<h2>Forumi</h2>
    <ul class="forum-list sidebar-list" style="list-style:none;padding:0;margin:0">
      <li><a class="side-link" href="#/"${cur(r.name === "feed" && !r.community)}>${emo(ALL_FORUMS)}Sve objave</a></li>
      ${COMMUNITIES.map((c) => `<li><a class="side-link" href="#/f/${c.id}"${cur(r.name === "feed" && r.community === c.id)}>${emo(c)}${esc(c.name)}</a></li>`).join("")}
      ${state.user && state.user.isAdmin ? `<li><a class="side-link" href="#/prijave">${emo({ emoji: "🚩", color: "#FF4FA3" })}Prijave</a></li>` : ""}
    </ul>`);
}

function authDialog(mode = "login", note = "") {
  const reg = mode === "register";
  const demoHint = backend.mode === "demo" && !reg
    ? `<p class="demo-hint">Demo nalozi: <code>admin@demo.rs</code> / <code>admin123</code> (administrator) ili <code>luka_g@demo.rs</code> / <code>demo123</code>. Možeš i da napraviš svoj nalog.</p>`
    : "";
  openDialog(`
    <div class="tabs" role="tablist">
      <button class="tab ${reg ? "" : "on"}" type="button" role="tab" aria-selected="${!reg}" data-action="auth" data-value="login">Prijava</button>
      <button class="tab ${reg ? "on" : ""}" type="button" role="tab" aria-selected="${reg}" data-action="auth" data-value="register">Registracija</button>
    </div>
    ${note ? `<p class="note">${esc(note)}</p>` : ""}
    <form data-form="${mode}" novalidate>
      ${reg ? `<label class="field"><span>Korisničko ime</span>
        <input name="username" type="text" autocomplete="username" maxlength="20" required>
        <small>3–20 znakova: slova bez dijakritika, brojevi, tačka i donja crta. Vidljivo je svima, pa ne moraš da koristiš pravo ime.</small></label>` : ""}
      <label class="field"><span>Email</span><input name="email" type="email" autocomplete="email" required></label>
      <label class="field"><span>Lozinka</span><input name="password" type="password" autocomplete="${reg ? "new-password" : "current-password"}" minlength="6" required>${reg ? "<small>Najmanje 6 znakova.</small>" : ""}</label>
      <div class="form-error" role="alert"></div>
      <button class="btn btn-primary wide" type="submit">${reg ? "Napravi nalog" : "Prijavi se"}</button>
    </form>
    ${demoHint}`);
}

function confirmDialog({ title, text, action, data }) {
  openDialog(`<h2>${esc(title)}</h2><p>${esc(text)}</p>
    <div class="row">
      <button class="btn" type="button" data-action="close-dialog">Otkaži</button>
      <button class="btn btn-danger" type="button" data-action="${action}" ${Object.entries(data || {}).map(([k, v]) => `data-${k}="${esc(v)}"`).join(" ")}>Obriši</button>
    </div>`);
}

function reportDialog(type, id) {
  openDialog(`<h2>Prijavi ${type === "post" ? "objavu" : "komentar"}</h2>
    <p>Moderatori će pregledati prijavu. Tvoje ime se ne prikazuje drugim članovima.</p>
    <form data-form="report" data-type="${esc(type)}" data-id="${esc(id)}">
      <label class="field"><span>Razlog</span>
        <select name="reason" required>
          <option>Vređanje ili maltretiranje</option>
          <option>Neprimeren sadržaj</option>
          <option>Lični podaci</option>
          <option>Spam</option>
          <option>Nešto drugo</option>
        </select>
      </label>
      <div class="form-error" role="alert"></div>
      <div class="row">
        <button class="btn" type="button" data-action="close-dialog">Otkaži</button>
        <button class="btn btn-primary" type="submit">Prijavi</button>
      </div>
    </form>`);
}

/* ------------------------------------------------------------------ */
/* Radnje                                                              */
/* ------------------------------------------------------------------ */

function needLogin(note) {
  if (state.user) return false;
  authDialog("login", note);
  return true;
}

async function handleVote(kind, id, value) {
  if (needLogin("Prijavi se da bi glasao.")) return;
  const key = kind + id;
  if (state.busy.has(key)) return;
  const my = state.myVotes[id] || 0;
  const next = my === value ? 0 : value;
  state.busy.add(key);
  try {
    await backend.vote(kind, id, next);
  } catch (e) {
    toast(e.message);
  } finally {
    state.busy.delete(key);
  }
}

function findContent(type, id) {
  if (type === "post") return state.post && state.post.id === id ? state.post : state.posts.find((p) => p.id === id);
  return state.comments.find((c) => c.id === id);
}

async function runAction(el) {
  const a = el.dataset.action;
  const id = el.dataset.id;
  const v = el.dataset.value;

  switch (a) {
    case "auth": return authDialog(v);
    case "forums": return forumsDialog();
    case "close-dialog": return closeDialog();
    case "logout":
      await backend.logout();
      toast("Odjava uspešna");
      if (["new", "reports", "user"].includes(state.route.name)) location.hash = "#/";
      return;
    case "vote": return handleVote(el.dataset.kind, id, Number(v));
    case "sort": state.sort = v; return render();
    case "csort": state.commentSort = v; return render();
    case "collapse":
      if (state.collapsed.has(id)) state.collapsed.delete(id); else state.collapsed.add(id);
      return render();
    case "reply-open":
      if (needLogin("Prijavi se da bi odgovorio.")) return;
      state.reply = { id, text: "" };
      render();
      { const t = document.getElementById("reply-input"); if (t) t.focus(); }
      return;
    case "reply-cancel": state.reply = null; return render();
    case "report":
      if (needLogin("Prijavi se da bi prijavio sadržaj.")) return;
      return reportDialog(el.dataset.type, id);
    case "delete-post":
      return confirmDialog({ title: "Obrisati objavu?", text: "Objava i komentari ispod nje više se neće videti. Ovo ne može da se vrati.", action: "do-delete-post", data: { id } });
    case "delete-comment":
      return confirmDialog({ title: "Obrisati komentar?", text: "Umesto teksta pisaće „[obrisano]“. Odgovori ispod ostaju. Ovo ne može da se vrati.", action: "do-delete-comment", data: { id } });
    case "do-delete-post":
      try {
        await backend.deletePost(id);
        closeDialog();
        toast("Obrisano");
        if (state.route.name === "post") location.hash = "#/";
      } catch (e) { closeDialog(); toast(e.message); }
      return;
    case "do-delete-comment":
      try {
        await backend.deleteComment(id);
        closeDialog();
        toast("Obrisano");
      } catch (e) { closeDialog(); toast(e.message); }
      return;
    case "remove-reported":
      try {
        if (el.dataset.type === "post") await backend.deletePost(id);
        else await backend.deleteComment(id);
        await backend.dismissReport(el.dataset.report);
        toast("Obrisano");
      } catch (e) { toast(e.message); }
      return;
    case "dismiss-report":
      try {
        await backend.dismissReport(el.dataset.report);
        toast("Prijava odbačena");
      } catch (e) { toast(e.message); }
      return;
  }
}

async function submitForm(form) {
  const kind = form.dataset.form;
  const errBox = form.querySelector(".form-error");
  const btn = form.querySelector('button[type="submit"]');
  const setError = (m) => { if (errBox) errBox.textContent = m || ""; };
  const fd = new FormData(form);
  setError("");
  if (btn) btn.disabled = true;

  try {
    switch (kind) {
      case "login":
        await backend.login({ email: String(fd.get("email")).trim(), password: String(fd.get("password")) });
        closeDialog();
        toast("Prijava uspešna");
        break;
      case "register":
        await backend.register({
          username: String(fd.get("username")).trim(),
          email: String(fd.get("email")).trim(),
          password: String(fd.get("password")),
        });
        closeDialog();
        toast("Nalog je napravljen");
        break;
      case "newpost": {
        const id = await backend.createPost({
          title: String(fd.get("title")),
          body: String(fd.get("body")),
          url: String(fd.get("url")),
          community: String(fd.get("community") || ""),
        });
        state.draft = { community: state.draft.community, title: "", body: "", url: "" };
        toast("Objavljeno");
        location.hash = `#/p/${id}`;
        break;
      }
      case "comment":
        await backend.createComment({ postId: state.route.id, parentId: null, body: String(fd.get("body")) });
        state.draftComment = "";
        toast("Komentarisano");
        render();
        break;
      case "reply":
        await backend.createComment({ postId: state.route.id, parentId: form.dataset.parent, body: String(fd.get("body")) });
        state.reply = null;
        toast("Odgovoreno");
        render();
        break;
      case "report": {
        const item = findContent(form.dataset.type, form.dataset.id);
        await backend.report({
          targetType: form.dataset.type,
          targetId: form.dataset.id,
          postId: form.dataset.type === "post" ? form.dataset.id : state.route.id || (item && item.postId) || "",
          reason: String(fd.get("reason")),
          snippet: item ? snippet(item.title ? `${item.title}. ${item.body}` : item.body, 200) : "",
        });
        closeDialog();
        toast("Prijavljeno. Moderator će pregledati.");
        break;
      }
    }
  } catch (e) {
    setError(e.message || "Došlo je do greške.");
    if (btn) btn.disabled = false;
  }
}

/* ------------------------------------------------------------------ */
/* Događaji                                                            */
/* ------------------------------------------------------------------ */

function bindEvents() {
  document.addEventListener("click", (e) => {
    // Linkovi u dijalogu (npr. lista foruma) zatvaraju dijalog i normalno prate adresu.
    if (e.target.closest("#dlg a")) { closeDialog(); return; }
    const el = e.target.closest("[data-action]");
    if (!el) return;
    e.preventDefault();
    runAction(el);
  });

  document.addEventListener("submit", (e) => {
    const form = e.target.closest("form[data-form]");
    if (!form) return;
    e.preventDefault();
    submitForm(form);
  });

  document.addEventListener("input", (e) => {
    const t = e.target;
    if (t.id === "new-comment") state.draftComment = t.value;
    else if (t.id === "reply-input" && state.reply) state.reply.text = t.value;
    else if (t.dataset && t.dataset.draft) state.draft[t.dataset.draft] = t.value;
  });
  document.addEventListener("change", (e) => {
    const t = e.target;
    if (t.dataset && t.dataset.draft) state.draft[t.dataset.draft] = t.value;
  });

  // Slika koja se ne učita ne sme da ostavi prazan okvir.
  document.addEventListener("error", (e) => {
    const t = e.target;
    if (t && t.classList && t.classList.contains("post-img")) t.style.display = "none";
  }, true);

  $("#dlg").addEventListener("click", (e) => {
    if (e.target === $("#dlg")) closeDialog();
  });

  $("#theme-btn").addEventListener("click", toggleTheme);

  $("#search-form").addEventListener("submit", (e) => e.preventDefault());
  $("#q").addEventListener("input", (e) => {
    state.query = e.target.value;
    if (state.route.name !== "feed") location.hash = "#/";
    else render();
  });

  window.addEventListener("hashchange", onRoute);
}

/* ------------------------------------------------------------------ */
/* Pokretanje                                                          */
/* ------------------------------------------------------------------ */

async function init() {
  renderThemeButton();
  bindEvents();
  state.route = parseRoute();
  render();

  backend = await createBackend(firebaseConfig);
  renderBanner();

  backend.onAuth((user) => {
    state.user = user;
    state.authReady = true;
    syncUserSubs();
    syncPostsSub();
    // Nakon prijave ponovo pokreni pretplate vezane za rutu (npr. kad je čitanje dozvoljeno samo prijavljenima).
    if (state.route.name === "post" && !routeSubs.length) onRoute();
    else render();
  });
}

init();
