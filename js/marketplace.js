// Firebase is loaded only when it is needed. The catalogue normally comes from the
// small products.json snapshot, so the home page and marketplace no longer download
// the Firebase SDK (several modules from gstatic) just to draw their first product
// cards, and a blocked or slow SDK request can no longer leave them stuck on
// "Loading products...".
async function loadFirebase() {
    const [{ database }, db] = await Promise.all([
        import("./firebase-db.js"),
        import("https://www.gstatic.com/firebasejs/12.10.0/firebase-database.js")
    ]);
    return { database, ...db };
}

export const categories = [
    { id: "general", name: "General", image: "Visuamall/general/bg1.avif" },
    { id: "books", name: "Books", image: "Visuamall/general/book_1-removebg-preview.webp" },
    { id: "courses", name: "Courses", image: "Visuamall/general/bg1.avif" },
    { id: "hospital-wears", name: "Hospital wears", image: "Visuamall/general/bg1.avif" },
    { id: "wellness", name: "Wellness", image: "Visuamall/general/bg1.avif" },
    { id: "hospital-lab-equipment", name: "Hospital & lab equipment", image: "Visuamall/general/hospital equipments/pink_pulse_oxi-removebg-preview.webp" },
    { id: "health-travel", name: "Health travel", image: "Visuamall/general/bg1.avif" },
    { id: "fitness", name: "Fitness", image: "Visuamall/general/bg1.avif" },
    { id: "men-shoes", name: "Men shoes", image: "Visuamall/bgg3.avif" },
    { id: "women-shoes", name: "Women shoes", image: "Visuamall/bgg3.avif" }
];
export const categoryIds = categories.map((category) => category.id);

let snapshotPromise;

async function loadSnapshot() {
    if (!snapshotPromise) {
        snapshotPromise = (async () => {
            const response = await fetch("products.json", { cache: "default" });
            if (!response.ok) throw new Error(`Snapshot HTTP ${response.status}`);
            const data = await response.json();
            if (!data || !Array.isArray(data.products)) throw new Error("Snapshot has no products");
            return data.products;
        })().catch((error) => {
            snapshotPromise = null;
            throw error;
        });
    }
    return snapshotPromise;
}

async function getPublishedProductsFromDb() {
    const { database, get, ref, query, orderByChild, equalTo } = await loadFirebase();
    const snapshot = await get(query(ref(database, "products"), orderByChild("status"), equalTo("PUBLISHED")));
    if (!snapshot.exists()) return [];
    return Object.entries(snapshot.val()).map(([id, product]) => ({ id, ...product }))
        .filter((product) => product.status === "PUBLISHED" && product.availability !== "UNAVAILABLE");
}

export async function getPublishedProducts() {
    try {
        return await loadSnapshot();
    } catch (error) {
        console.warn("Snapshot unavailable, falling back to live database:", error.message || error);
        return getPublishedProductsFromDb();
    }
}

export async function getProductById(id) {
    try {
        const products = await loadSnapshot();
        const match = products.find((product) => product.id === id);
        if (match) return match;
    } catch (error) {
        console.warn("Snapshot unusable for product lookup, falling back to live database:", error.message || error);
    }
    const { database, get, ref } = await loadFirebase();
    const snapshot = await get(ref(database, `products/${id}`));
    if (!snapshot.exists()) return null;
    const product = snapshot.val();
    if (product.status !== "PUBLISHED" || product.availability === "UNAVAILABLE") return null;
    return { id, ...product };
}

export function text(value, fallback = "") {
    return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

// Plain string formatting, not toLocaleString: building an Intl formatter is one of the
// slowest things the product list does (it showed up as the top application function
// in a CPU profile of the home page), and it ran once per card.
export function formatPrice(price) {
    if (typeof price !== "number" || !isFinite(price)) return null;
    const [whole, fraction] = (Math.round(price * 100) / 100).toFixed(2).split(".");
    const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return `₦${grouped}${fraction === "00" ? "" : `.${fraction}`}`;
}

// Small card thumbnail for a product image, if one was generated (npm run thumbs).
function thumbFor(src) {
    const match = /^(.*\/)(p\d+--[^/]+)\.(?:jpe?g|png|webp|avif)$/i.exec(src || "");
    return match ? `${match[1]}thumb/${match[2]}.webp` : null;
}

// `priority` marks cards that are on screen straight away: their image loads at once
// and first. Every other card keeps lazy loading. Lazy-loading the top cards made the
// biggest image on the page the last thing to arrive.
export function productCard(product, { priority = false } = {}) {
    const article = document.createElement("article"); article.className = "product-card";
    const image = document.createElement("img");
    const full = text(product.image, "Visuamall/bgg3.avif");
    const thumb = thumbFor(full);
    image.alt = text(product.name, "Marketplace product"); image.width = 480; image.height = 360; image.decoding = "async";
    if (priority) { image.loading = "eager"; image.fetchPriority = "high"; } else image.loading = "lazy";
    if (thumb) image.addEventListener("error", () => { image.src = full; }, { once: true });
    image.src = thumb || full;
    const body = document.createElement("div"); body.className = "product-card__body";
    const title = document.createElement("h3"); title.textContent = text(product.name, "Unnamed product");
    const price = document.createElement("p"); price.className = "product-price"; price.textContent = formatPrice(product.price) || "Contact vendor for price";
    const vendor = document.createElement("p"); vendor.textContent = text(product.vendorName, "Verified VHMART vendor");
    const status = document.createElement("span"); status.className = "availability"; status.textContent = text(product.availability, "Contact vendor").replaceAll("_", " ");
    const link = document.createElement("a"); link.className = "button button--quiet"; link.href = `product.html?id=${encodeURIComponent(product.id)}`; link.textContent = "View product";
    body.append(title, price, vendor, status, link); article.append(image, body); return article;
}