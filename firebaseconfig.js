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
  apiKey: "PASTE_YOUR_API_KEY",
  authDomain: "PASTE_YOUR_PROJECT.firebaseapp.com",
  projectId: "PASTE_YOUR_PROJECT_ID",
  storageBucket: "PASTE_YOUR_PROJECT.appspot.com",
  messagingSenderId: "PASTE_YOUR_SENDER_ID",
  appId: "PASTE_YOUR_APP_ID"
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
