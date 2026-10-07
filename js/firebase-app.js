// The one Firebase app instance for the whole site, created on first use.
//
// firebase.js (auth + database) and firebase-db.js (database only) both start from
// here, so a page that loads either, or both, never initialises the app twice.
import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-app.js";

const firebaseConfig = {
    apiKey: "AIzaSyAuwZ93o0EmeWbOc2mN0tRgtfLuS6jKqn8",
    authDomain: "visuamall-a620f.firebaseapp.com",
    projectId: "visuamall-a620f",
    storageBucket: "visuamall-a620f.firebasestorage.app",
    messagingSenderId: "461123816679",
    appId: "1:461123816679:web:0ea647cd96ddd29f586642",
    databaseURL: "https://visuamall-a620f-default-rtdb.firebaseio.com"
};

export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
