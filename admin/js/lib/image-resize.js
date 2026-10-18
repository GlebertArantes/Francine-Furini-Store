// Redução automática de fotos grandes (celulares modernos geram JPEG/PNG acima de 8 MB).
// Só atua em arquivos ACIMA do limite do bucket; arquivos normais seguem intactos.
import { MAX_IMAGE_BYTES } from "./rules.js";

export const MAX_SIDE = 2400;       // lado maior após reduzir (boa qualidade para a vitrine)
export const SHRINK_QUALITY = 0.86;
const SHRINKABLE = new Set(["image/jpeg", "image/png", "image/webp"]);

export const shouldShrink = (file) => !!file && file.size > MAX_IMAGE_BYTES && SHRINKABLE.has(file.type);

/** Dimensões finais mantendo proporção; nunca amplia. */
export function targetSize(width, height, maxSide = MAX_SIDE) {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export const shrunkName = (name) => `${String(name).replace(/\.[^.]+$/, "") || "foto"}.jpg`;

/**
 * Reduz via canvas (respeita a orientação EXIF). Devolve um File JPEG ou lança se não for possível
 * (nesse caso o arquivo original segue sinalizado como grande demais).
 */
export async function shrinkImage(file, env = globalThis) {
  const bmp = await env.createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const { width, height } = targetSize(bmp.width, bmp.height);
    const canvas = env.document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, width, height); // PNG com transparência -> fundo branco no JPEG
    ctx.drawImage(bmp, 0, 0, width, height);
    const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", SHRINK_QUALITY));
    if (!blob || blob.size === 0 || blob.size > MAX_IMAGE_BYTES) throw new Error("shrink_failed");
    return new env.File([blob], shrunkName(file.name), { type: "image/jpeg", lastModified: Date.now() });
  } finally { bmp.close?.(); }
}
