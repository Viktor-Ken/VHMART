// Database only. Pages that just read public data (the vendor profile, the product
// page's vendor name) use this instead of firebase.js, so they do not download the
// authentication SDK they never use.
import { app } from "./firebase-app.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-database.js";

export const database = getDatabase(app);
