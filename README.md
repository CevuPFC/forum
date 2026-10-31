# ETŠ forum

Forum za učenike Elektrotehničke škole „Stari grad“, u stilu Redita: forumi po temama, objave (tekst ili link), komentari u nitima, glasanje, pretraga, tamna tema i moderacija.

Sajt je običan HTML/CSS/JS bez build koraka, pa može direktno na GitHub Pages. Podaci se čuvaju u Firebase-u (Authentication + Firestore).

## Šta forum ima

- 7 foruma (Obaveštenja, Opšte, Pitanja i pomoć, Elektronika i hardver, Programiranje, Projekti i takmičenja, Zezanje). Lista je u `communities.js`.
- Objave sa naslovom, tekstom i opcionim linkom
- Komentari u nitima (odgovor na odgovor), sakrivanje niti
- Glasanje za objave i komentare, po jedan glas po učeniku
- Redosled: Popularno, Novo, Najbolje ocenjeno
- Pretraga po naslovu, tekstu i autoru
- Registracija i prijava (email + lozinka), jedinstveno korisničko ime
- Prijavljivanje neprimerenog sadržaja i stranica „Prijave“ za administratore
- Brisanje sopstvenih objava i komentara; administrator briše sve
- Forum „Obaveštenja“ je samo za administratore
- Svetla i tamna tema, radi na telefonu

## Isprobaj odmah (demo režim)

Dok je `firebase-config.js` prazan, forum radi u demo režimu: podaci se čuvaju samo u tvom pregledaču. Demo nalozi:

- `admin@demo.rs` / `admin123` (administrator)
- `marko_p@demo.rs` / `demo123`

Moduli ne rade sa `file://`, pa fajl ne otvaraj dvoklikom. Pokreni ga preko Live Server-a u VS Code-u (desni klik na `index.html`, „Open with Live Server“).

## Povezivanje sa Firebase-om

1. U [Firebase konzoli](https://console.firebase.google.com) otvori svoj projekat.
2. **Authentication > Sign-in method**: uključi **Email/Password**.
3. **Firestore Database**: napravi bazu (Create database), izaberi lokaciju blizu (npr. `eur3`).
4. **Firestore Database > Rules**: obriši postojeći sadržaj, nalepi ceo `firestore.rules` i klikni **Publish**.
5. **Project settings > Your apps > Web app**: kopiraj `firebaseConfig` i nalepi vrednosti u `firebase-config.js`.
6. Osveži stranicu. Žuta traka „Demo režim“ nestaje.

### Prvi administrator

1. Registruj nalog na forumu (to bude tvoj nalog).
2. U Firebase konzoli: **Authentication > Users**, kopiraj **User UID** tog naloga.
3. **Firestore Database > Start collection**: ID kolekcije `admins`, ID dokumenta je taj UID, dodaj bilo koje polje (npr. `role` = `admin`).
4. Odjavi se pa se prijavi ponovo. U levom meniju pojaviće se „Prijave“, a na forumu „Obaveštenja“ možeš da objavljuješ.

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
- Nema slika i upload-a (Firebase Storage zahteva plaćeni plan). Link ka slici može da se stavi u polje „Link“.
- Nema zaštite od spama (ograničenja učestalosti objava). Za to treba Cloud Functions ili Firebase App Check.
- Kad se obriše objava, njeni komentari ostaju u bazi, ali se više ne prikazuju.
- Ocene se čuvaju na samoj objavi i proverava ih pravilo u bazi, pa jedan nalog ne može da glasa dvaput. Ko napravi više naloga ipak može.

## Fajlovi

| Fajl | Čemu služi |
| --- | --- |
| `index.html`, `style.css` | Stranica i izgled |
| `app.js` | Ceo interfejs foruma |
| `db.js` | Veza sa Firebase-om i demo režim |
| `communities.js` | Lista foruma i boje otpornika |
| `firebase-config.js` | Tvoja Firebase konfiguracija |
| `firestore.rules` | Pravila baze (ko sme šta) |
