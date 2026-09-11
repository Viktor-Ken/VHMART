import { database } from './firebase.js';
import { get, push, ref, remove, serverTimestamp, update, query, orderByChild, equalTo } from 'https://www.gstatic.com/firebasejs/12.10.0/firebase-database.js';

export const productStatuses = ['PUBLISHED', 'SUSPENDED', 'ARCHIVED'];
export async function ownedProducts(uid) { const snapshot = await get(query(ref(database, 'products'), orderByChild('ownerUid'), equalTo(uid))); if (!snapshot.exists()) return []; return Object.entries(snapshot.val()).map(([id, product]) => ({ id, ...product })).filter((product) => product.ownerUid === uid); }
export async function saveProduct(id, data) { const productRef = id ? ref(database, `products/${id}`) : push(ref(database, 'products')); await update(productRef, { ...data, updatedAt: serverTimestamp() }); return productRef.key; }
export async function deleteProduct(id) { await remove(ref(database, `products/${id}`)); }
export function formatPrice(price) { if (typeof price !== 'number' || !isFinite(price)) return null; return `₦${price.toLocaleString('en-NG', { maximumFractionDigits: 2 })}`; }
export function processProductImage(file, maxDimension = 700, quality = 0.75) {
  if (!file || !file.type.startsWith('image/')) throw new Error('Please choose an image file (JPEG, PNG or WebP).');
  if (file.size > 9 * 1024 * 1024) throw new Error('Images must be under 9 MB.');
  return readAsDataUrl(file).then((dataUrl) => {
    const image = new Image();
    image.src = dataUrl;
    return new Promise((resolve, reject) => {
      image.onload = () => {
        try {
          const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(image.width * scale));
          canvas.height = Math.max(1, Math.round(image.height * scale));
          const context = canvas.getContext('2d');
          context.fillStyle = '#ffffff';
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', quality));
        } catch (error) { reject(error); }
      };
      image.onerror = () => reject(new Error('The selected file is not a valid image.'));
    });
  });
}
export function removeProductImage() { return Promise.resolve(); }
function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the selected image.'));
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });
}