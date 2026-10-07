// Auth + database. Nothing on the site uses Firebase Storage (product images are
// plain files), so its SDK file is no longer downloaded on every page that signs in.
import { app } from "./firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-database.js";

export const auth = getAuth(app);
export const database = getDatabase(app);
