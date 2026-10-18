// Shrinks a vendor's product photo in the browser before it is saved, so customers
// download a small picture instead of a phone-camera original.
//
// - Straightens photos that carry a rotation flag (phones often do).
// - Prefers WebP, which is about a third smaller than JPEG; falls back to JPEG on
//   browsers whose canvas cannot write WebP (Safari silently returns PNG, which would
//   be far larger, so the result is checked rather than trusted).
// - Tries a few quality levels, then a smaller size, until the picture fits the budget.

export const MAX_DIMENSION = 800;
export const MIN_DIMENSION = 480;
export const BUDGET_BYTES = 70 * 1024;
const QUALITIES = [0.82, 0.72, 0.62, 0.52];

// Largest size that keeps the aspect ratio and fits inside max x max; never enlarges.
export function fitWithin(width, height, max) {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

// Approximate size in bytes of the file inside a data URL.
export function dataUrlBytes(dataUrl) {
  const comma = dataUrl.indexOf(',');
  const base64 = comma === -1 ? '' : dataUrl.slice(comma + 1);
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { /* fall through */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('The selected file is not a valid image.'));
    });
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function render(source, width, height, type, quality) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.drawImage(source, 0, 0, width, height);
  return canvas.toDataURL(type, quality);
}

export async function compressImage(file, options = {}) {
  const maxDimension = options.maxDimension || MAX_DIMENSION;
  const budget = options.budgetBytes || BUDGET_BYTES;
  const source = await decode(file);
  const sourceWidth = source.naturalWidth || source.width;
  const sourceHeight = source.naturalHeight || source.height;
  if (!sourceWidth || !sourceHeight) throw new Error('The selected file is not a valid image.');

  let max = maxDimension;
  let best = null;
  while (true) {
    const { width, height } = fitWithin(sourceWidth, sourceHeight, max);
    for (const quality of QUALITIES) {
      let type = 'image/webp';
      let dataUrl = render(source, width, height, type, quality);
      if (!dataUrl.startsWith('data:image/webp')) {
        type = 'image/jpeg';
        dataUrl = render(source, width, height, type, quality);
      }
      if (!best || dataUrlBytes(dataUrl) < dataUrlBytes(best)) best = dataUrl;
      if (dataUrlBytes(dataUrl) <= budget) return dataUrl;
    }
    if (max <= MIN_DIMENSION) break;
    max = Math.max(MIN_DIMENSION, Math.round(max * 0.85));
  }
  if (source.close) source.close();
  return best;
}
