// SK 항법지도 2.0 — Firebase 초기화 (ES 모듈)
// window.firebaseAuth / window.firebaseDb 로 일반 스크립트(app.js 등)에서 접근한다.
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyDR-nw2KWMbvecnGm8b8tWKGgNbTFGFWVY",
  authDomain: "sk-navmap.firebaseapp.com",
  databaseURL: "https://sk-navmap-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "sk-navmap",
  storageBucket: "sk-navmap.firebasestorage.app",
  messagingSenderId: "830166108680",
  appId: "1:830166108680:web:d7ac24ca40501fe9781fbd"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

window.firebaseAuth = auth;
window.firebaseDb = db;
window.firebaseSignIn = signInWithEmailAndPassword;
window.firebaseSignOut = signOut;

onAuthStateChanged(auth, function (user) {
  window.dispatchEvent(new CustomEvent('sk-auth-changed', { detail: { user: user } }));
});
