// Nalepi ovde Firebase konfiguraciju svog projekta:
// Firebase konzola > Project settings > Your apps > Web app > SDK setup and configuration > Config
//
// Dok je apiKey prazan, forum radi u DEMO režimu (podaci se čuvaju samo u tvom pregledaču).
// Ovaj ključ nije tajna: bezbednost obezbeđuju pravila u firestore.rules.

export const firebaseConfig = {
  apiKey: "AIzaSyAuiTkN46vvdis9WADJ3ssKR50Ei3yw4ps",
  authDomain: "forum-f8d36.firebaseapp.com",
  projectId: "forum-f8d36",
  storageBucket: "forum-f8d36.firebasestorage.app",
  messagingSenderId: "3751749610",
  appId: "1:3751749610:web:c7ab68623dbad1110e3493",
};

export const settings = {
  // true = objave može da vidi samo prijavljen učenik.
  // Ako uključiš ovo, u firestore.rules promeni "allow read: if true" u "allow read: if signedIn()"
  // za kolekcije posts i comments.
  requireLoginToRead: false,
};
