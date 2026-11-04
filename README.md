# Glas

Glas je mesto gde mladi pokreću teme o igricama, muzici, filmovima, sportu, mimovima i svemu ostalom. Radi kao Redit: forumi po temama, objave (tekst, link ili slika), komentari u nitima, glasanje, pretraga, tamna i svetla tema i moderacija.

Sajt je običan HTML/CSS/JS bez build koraka, pa može direktno na GitHub Pages. Podaci se čuvaju u Firebase-u (Authentication + Firestore). Radi i na telefonu, sa donjom navigacijom.

## Šta Glas ima

- 10 foruma: Novosti (samo administratori), Opšte, Gaming, Muzika, Filmovi i serije, Sport, Mimovi, Pitanja i saveti, Tehnika i kod, Škola. Lista ugrađenih je u `communities.js`. Moderator može da pravi nove forume direktno sa sajta (levo, dugme „+ Novi forum“: naziv, opis, ikonica, boja, opcija „samo moderatori objavljuju“) i da ih briše. Novi forumi se čuvaju u kolekciji `forums`.
- Objave sa naslovom, tekstom i opcionim linkom. Link do slike (.jpg, .png, .gif, .webp) prikazuje se direktno u objavi.
- Komentari u nitima (odgovor na odgovor), sakrivanje niti
- Glasanje za objave i komentare, po jedan glas po članu
- Redosled: Popularno, Novo, Najbolje
- Pretraga po naslovu, tekstu i autoru
- Registracija i prijava (email + lozinka), jedinstveno korisničko ime
- Prijavljivanje neprimerenog sadržaja i stranica „Prijave“ za administratore
- Brisanje sopstvenih objava i komentara; administrator briše sve
- Tamna neon tema (podrazumevana) i svetla tema

## Isprobaj odmah (demo režim)

Dok je `firebase-config.js` prazan, forum radi u demo režimu: podaci se čuvaju samo u tvom pregledaču. Demo nalozi:

- `admin@demo.rs` / `admin123` (administrator)
- `luka_g@demo.rs` / `demo123`

Moduli ne rade sa `file://`, pa fajl ne otvaraj dvoklikom. Pokreni ga preko Live Server-a u VS Code-u (desni klik na `index.html`, „Open with Live Server“).

## Povezivanje sa Firebase-om

1. U [Firebase konzoli](https://console.firebase.google.com) otvori svoj projekat.
2. **Authentication > Sign-in method**: uključi **Email/Password**.
3. **Firestore Database**: napravi bazu (Create database), izaberi lokaciju blizu (npr. `eur3`).
4. **Firestore Database > Rules**: obriši postojeći sadržaj, nalepi ceo `firestore.rules` i klikni **Publish**. Pravila moraš ponovo da objaviš kad god se promene (npr. posle ovog ažuriranja, zbog novih foruma). Ako menjaš ugrađene forume u `communities.js`, ažuriraj i `builtinForum()` u pravilima.
5. **Project settings > Your apps > Web app**: kopiraj `firebaseConfig` i nalepi vrednosti u `firebase-config.js`.
6. Osveži stranicu. Žuta traka „Demo režim“ nestaje.

### Prvi administrator

1. Registruj nalog na forumu (to bude tvoj nalog).
2. U Firebase konzoli: **Authentication > Users**, kopiraj **User UID** tog naloga.
3. **Firestore Database > Start collection**: ID kolekcije `admins`, ID dokumenta je taj UID, dodaj bilo koje polje (npr. `role` = `admin`).
4. Odjavi se pa se prijavi ponovo. U levom meniju pojaviće se „Prijave“, a na forumu „Novosti“ možeš da objavljuješ.

Administratore ne može da doda niko preko sajta, samo ti u konzoli.

## Objava na GitHub Pages

1. Okači sve fajlove iz ovog foldera u GitHub repozitorijum (`index.html` mora biti u korenu).
2. **Settings > Pages**: Source = *Deploy from a branch*, branch `main`, folder `/ (root)`.
3. U Firebase konzoli: **Authentication > Settings > Authorized domains** dodaj `tvojeime.github.io`. Bez ovoga prijava na objavljenom sajtu ne radi.

Firebase `apiKey` u `firebase-config.js` nije tajna i sme da bude javan. Zaštitu daju pravila u `firestore.rules`.

## Moderacija i privatnost

Ovo je forum za maloletne učenike, pa razmisli o ovome pre otvaranja:

- Pošalji pravila foruma učenicima i nastavniku koji će biti moderator. Podesi bar dva administratora.
- Ako želiš da objave vide samo prijavljeni učenici, u `firebase-config.js` postavi `requireLoginToRead: true`, a u `firestore.rules` za `posts` i `comments` promeni `allow read: if true` u `allow read: if signedIn()`.
- Ako želiš da se registruju samo učenici škole, uključi proveru emaila (Firebase šalje link) ili podeli nalog preko nastavnika. Trenutno može da se registruje bilo ko ko zna adresu sajta.
- Forum ne čuva ništa osim korisničkog imena, emaila (u Firebase Authentication) i sadržaja objava.

## Poznata ograničenja

- Prikazuje se poslednjih 300 objava. Za školu je to dovoljno; za više bi trebalo dodati straničenje.
- Nema upload-a slika (Firebase Storage zahteva plaćeni plan). Slike se dodaju kao link, a pregledač svakog posetioca učitava ih direktno sa tog sajta. Zato imaj na umu koje slike linkuješ.
- Nema zaštite od spama (ograničenja učestalosti objava). Za to treba Cloud Functions ili Firebase App Check.
- Kad se obriše objava, njeni komentari ostaju u bazi, ali se više ne prikazuju.
- Ocene se čuvaju na samoj objavi i proverava ih pravilo u bazi, pa jedan nalog ne može da glasa dvaput. Ko napravi više naloga ipak može.

## Fajlovi

| Fajl | Čemu služi |
| --- | --- |
| `index.html`, `style.css` | Stranica i izgled |
| `app.js` | Ceo interfejs foruma |
| `db.js` | Veza sa Firebase-om i demo režim |
| `communities.js` | Lista foruma, emoji i boje |
| `seed.js` | Probne objave za demo režim |
| `firebase-config.js` | Tvoja Firebase konfiguracija |
| `firestore.rules` | Pravila baze (ko sme šta) |
