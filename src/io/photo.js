// Turns a user's image file into an embeddable photo (ADR 0013): decoded, shrunk to
// at most PHOTO_MAX px on the longer side, and re-encoded as JPEG. Re-encoding also
// strips metadata such as GPS location from camera photos.

export const PHOTO_MAX = 256;
export const PHOTO_QUALITY = 0.82;
export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

// Returns { mime, data, width, height }. Throws a readable error for anything that
// isn't a decodable JPEG/PNG/WebP/GIF.
export async function photoFromFile(file, { max = PHOTO_MAX, quality = PHOTO_QUALITY } = {}) {
  if (!ACCEPTED_TYPES.includes(file.type)) {
    throw new Error(`${file.name || 'This file'} isn't a JPEG, PNG, WebP or GIF image`);
  }
  let image;
  try {
    image = await createImageBitmap(file);
  } catch {
    throw new Error(`${file.name || 'This image'} couldn't be read; it may be damaged`);
  }
  const scale = Math.min(1, max / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext('2d');
  g.fillStyle = '#fff'; // JPEG has no transparency
  g.fillRect(0, 0, width, height);
  g.imageSmoothingQuality = 'high';
  g.drawImage(image, 0, 0, width, height);
  image.close?.();
  return { mime: 'image/jpeg', data: canvas.toDataURL('image/jpeg', quality), width, height };
}
