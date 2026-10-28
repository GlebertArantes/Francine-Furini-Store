// Geometria compartilhada pela prévia e pelo arquivo final. Sem rede ou alteração do original.
import { MAX_IMAGE_BYTES } from "./rules.js";

export const PHOTO_RATIOS = { portrait: 3 / 4, square: 1, landscape: 4 / 3 };
export const initialPhotoState = () => ({ ratio: "portrait", zoom: 1, panX: 0, panY: 0, rotation: 0, background: "#fffdf9" });
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const finite = (n, fallback) => Number.isFinite(Number(n)) ? Number(n) : fallback;

export function photoState(value = {}) {
  const rotation = ((Math.round(finite(value.rotation, 0) / 90) * 90) % 360 + 360) % 360;
  return {
    ratio: value.ratio === "original" || Object.hasOwn(PHOTO_RATIOS, value.ratio) ? value.ratio : "portrait",
    zoom: clamp(finite(value.zoom, 1), 0.5, 32),
    panX: clamp(finite(value.panX, 0), -1, 1), panY: clamp(finite(value.panY, 0), -1, 1), rotation,
    background: ["#fffdf9", "#ffffff", "#111111"].includes(value.background) ? value.background : "#fffdf9",
  };
}

export function rotatedSize(image, rotation) {
  if (!(image.width > 0 && image.height > 0)) throw new Error("invalid_image_size");
  return rotation % 180 ? { width: image.height, height: image.width } : { width: image.width, height: image.height };
}

export function photoRatio(image, value) {
  const s = photoState(value), size = rotatedSize(image, s.rotation);
  return s.ratio === "original" ? size.width / size.height : PHOTO_RATIOS[s.ratio];
}

export function photoOutputSize(image, value, maxSide = 1600) {
  const ratio = photoRatio(image, value);
  const side = Math.max(1, Math.min(maxSide, Math.max(image.width, image.height)));
  return ratio >= 1 ? { width: Math.round(side), height: Math.max(1, Math.round(side / ratio)) }
    : { width: Math.max(1, Math.round(side * ratio)), height: Math.round(side) };
}

export function fillPhotoZoom(image, value) {
  const s = photoState(value), size = rotatedSize(image, s.rotation), ratio = photoRatio(image, s);
  const fit = Math.min(ratio / size.width, 1 / size.height);
  return clamp(Math.max(ratio / size.width, 1 / size.height) / fit, 0.5, 32);
}

export function photoLayout(image, value, width, height) {
  const s = photoState(value), size = rotatedSize(image, s.rotation);
  const scale = Math.min(width / size.width, height / size.height) * s.zoom;
  const w = size.width * scale, h = size.height * scale;
  // Mantém parte da foto no quadro, mesmo ao arrastar até a borda.
  const limitX = (width + w) / 2 - Math.min(width, w) * .2;
  const limitY = (height + h) / 2 - Math.min(height, h) * .2;
  return { scale, centerX: width / 2 + clamp(s.panX * width, -limitX, limitX),
    centerY: height / 2 + clamp(s.panY * height, -limitY, limitY), rotation: s.rotation, background: s.background };
}

export function drawPhoto(ctx, image, value, width, height) {
  const l = photoLayout(image, value, width, height);
  ctx.save();
  ctx.fillStyle = l.background; ctx.fillRect(0, 0, width, height);
  ctx.translate(l.centerX, l.centerY); ctx.rotate(l.rotation * Math.PI / 180);
  ctx.drawImage(image, -image.width * l.scale / 2, -image.height * l.scale / 2, image.width * l.scale, image.height * l.scale);
  ctx.restore();
}

export async function loadPhoto(file, env = globalThis) {
  if (typeof env.createImageBitmap === "function") {
    try { return await env.createImageBitmap(file, { imageOrientation: "from-image" }); } catch { /* fallback para decodificadores do navegador */ }
  }
  const url = env.URL.createObjectURL(file);
  try {
    const image = new env.Image();
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error("image_decode_failed")); image.src = url; });
    return image;
  } finally { env.URL.revokeObjectURL(url); }
}

export async function exportPhoto(image, value, name, env = globalThis) {
  const size = photoOutputSize(image, value);
  const canvas = env.document.createElement("canvas");
  canvas.width = size.width; canvas.height = size.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas_unavailable");
  drawPhoto(ctx, image, value, size.width, size.height);
  for (const quality of [.9, .8, .65]) {
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (blob?.size > 0 && blob.size <= MAX_IMAGE_BYTES) {
      const stem = String(name ?? "foto").replace(/\.[^.]+$/, "") || "foto";
      return new env.File([blob], `${stem}-ajustada.jpg`, { type: "image/jpeg", lastModified: Date.now() });
    }
  }
  throw new Error("photo_export_failed");
}
