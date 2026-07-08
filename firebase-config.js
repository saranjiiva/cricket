// ============================================================
// FIREBASE CONFIG
// ------------------------------------------------------------
// 1. Go to https://console.firebase.google.com → Add project
//    (free "Spark" plan is enough — this app only uses Firestore).
// 2. In the project: Build → Firestore Database → Create database
//    → start in TEST MODE for now (see note on rules below).
// 3. Project settings (gear icon) → General → "Your apps" →
//    Add app → Web (</>) → register it → copy the config object
//    Firebase shows you → paste its values below.
// ============================================================

const firebaseConfig = {

   apiKey: "AIzaSyA55Es77rWTL3AOvAko-Obk47yROaItkbs",
    authDomain: "cricket-1b0fa.firebaseapp.com",
    projectId: "cricket-1b0fa",
    storageBucket: "cricket-1b0fa.firebasestorage.app",
    messagingSenderId: "317903649191",
    appId: "1:317903649191:web:a6a91752d03227a0aede82",
    measurementId: "G-CVPMSWKZ0G"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// ------------------------------------------------------------
// FIRESTORE SECURITY RULES — paste this in Firestore → Rules.
// Test mode already does roughly this for 30 days; set this
// explicitly so it doesn't expire and lock the app out.
// Since this app has no login system, everyone can read/write —
// fine for a friendly local session, not for public deployment.
// ------------------------------------------------------------
/*
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;
    }
  }
}
*/
