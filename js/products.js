import { database } from './firebase.js';
import { get, push, ref, remove, serverTimestamp, update, query, orderByChild, equalTo } from 'https://www.gstatic.com/firebasejs/12.10.0/firebase-database.js';

export const productStatuses = ['PUBLISHED', 'SUSPENDED', 'ARCHIVED'];
export async function ownedProducts(uid) { const snapshot = await get(query(ref(database, 'products'), orderByChild('ownerUid'), equalTo(uid))); if (!snapshot.exists()) return []; return Object.entries(snapshot.val()).map(([id, product]) => ({ id, ...product })).filter((product) => product.ownerUid === uid); }
export async function saveProduct(id, data) { const productRef = id ? ref(database, `products/${id}`) : push(ref(database, 'products')); await update(productRef, { ...data, updatedAt: serverTimestamp() }); return productRef.key; }
export async function deleteProduct(id) { await remove(ref(database, `products/${id}`)); }
export { formatPrice } from './marketplace.js';
import { compressImage } from './image-compress.js';
export async function processProductImage(file) {
  if (!file || !file.type.startsWith('image/')) throw new Error('Please choose an image file (JPEG, PNG or WebP).');
  if (file.size > 12 * 1024 * 1024) throw new Error('Images must be under 12 MB.');
  return compressImage(file);
}
export function removeProductImage() { return Promise.resolve(); }
