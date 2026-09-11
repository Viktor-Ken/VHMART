import { database } from "./firebase.js";
import { get, ref, query, orderByChild, equalTo } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-database.js";

export const categories = [
    { id: "general", name: "General", image: "Visuamall/general/bg1.avif" },
    { id: "books", name: "Books", image: "Visuamall/general/book_1-removebg-preview.png" },
    { id: "courses", name: "Courses", image: "Visuamall/general/bg1.avif" },
    { id: "hospital-wears", name: "Hospital wears", image: "Visuamall/general/bg1.avif" },
    { id: "wellness", name: "Wellness", image: "Visuamall/general/bg1.avif" },
    { id: "hospital-lab-equipment", name: "Hospital & lab equipment", image: "Visuamall/general/hospital equipments/pink_pulse_oxi-removebg-preview.png" },
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
    const snapshot = await get(ref(database, `products/${id}`));
    if (!snapshot.exists()) return null;
    const product = snapshot.val();
    if (product.status !== "PUBLISHED" || product.availability === "UNAVAILABLE") return null;
    return { id, ...product };
}

export function text(value, fallback = "") {
    return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

export function formatPrice(price) {
    if (typeof price !== "number" || !isFinite(price)) return null;
    return `₦${price.toLocaleString("en-NG", { maximumFractionDigits: 2 })}`;
}

export function productCard(product) {
    const article = document.createElement("article"); article.className = "product-card";
    const image = document.createElement("img"); image.src = text(product.image, "Visuamall/bgg3.avif"); image.alt = text(product.name, "Marketplace product"); image.loading = "lazy";
    const body = document.createElement("div"); body.className = "product-card__body";
    const title = document.createElement("h3"); title.textContent = text(product.name, "Unnamed product");
    const price = document.createElement("p"); price.className = "product-price"; price.textContent = formatPrice(product.price) || "Contact vendor for price";
    const vendor = document.createElement("p"); vendor.textContent = text(product.vendorName, "Verified VHMART vendor");
    const status = document.createElement("span"); status.className = "availability"; status.textContent = text(product.availability, "Contact vendor").replaceAll("_", " ");
    const link = document.createElement("a"); link.className = "button button--quiet"; link.href = `product.html?id=${encodeURIComponent(product.id)}`; link.textContent = "View product";
    body.append(title, price, vendor, status, link); article.append(image, body); return article;
}