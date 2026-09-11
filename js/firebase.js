import { initializeApp } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-database.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-storage.js";

const firebaseConfig = {
    apiKey: "AIzaSyAuwZ93o0EmeWbOc2mN0tRgtfLuS6jKqn8",
    authDomain: "visuamall-a620f.firebaseapp.com",
    projectId: "visuamall-a620f",
    storageBucket: "visuamall-a620f.firebasestorage.app",
    messagingSenderId: "461123816679",
    appId: "1:461123816679:web:0ea647cd96ddd29f586642",
    databaseURL: "https://visuamall-a620f-default-rtdb.firebaseio.com"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const database = getDatabase(app);
export const storage = getStorage(app);