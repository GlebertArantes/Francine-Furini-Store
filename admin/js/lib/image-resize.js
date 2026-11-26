// Redução automática de fotos grandes (celulares modernos geram JPEG/PNG acima de 8 MB).
// Só atua em arquivos ACIMA do limite do bucket; arquivos normais seguem intactos.
import { MAX_IMAGE_BYTES, IMAGE_TYPES } from "./rules.js";
import { loadPhoto } from "./photo-transform.js";

export const MAX_SIDE = 2400;       // lado maior após reduzir (boa qualidade para a vitrine)
export const SHRINK_QUALITY = 0.86;
const SHRINKABLE = new Set(Object.keys(IMAGE_TYPES));

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
export async function shrinkImage(file, env = globalThis, timeoutMs = 20000) {
  const image = await loadPhoto(file, env, timeoutMs);
  let canvas;
  try {
    if (!(image.width > 0 && image.height > 0)) throw new Error("invalid_image_size");
    canvas = env.document.createElement("canvas");
    // A primeira tentativa preserva a qualidade anterior. Só reduz mais se necessário.
    for (const maxSide of [MAX_SIDE, 1920, 1600]) {
      const { width, height } = targetSize(image.width, image.height, maxSide);
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("canvas_unavailable");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, width, height);
      ctx.drawImage(image, 0, 0, width, height);
      for (const quality of [SHRINK_QUALITY, .78, .68]) {
        const blob = await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("image_encode_timeout")), timeoutMs);
          try { canvas.toBlob((result) => { clearTimeout(timer); resolve(result); }, "image/jpeg", quality); }
          catch (error) { clearTimeout(timer); reject(error); }
        });
        if (blob?.size > 0 && blob.size <= MAX_IMAGE_BYTES) {
          return new env.File([blob], shrunkName(file.name), { type: "image/jpeg", lastModified: Date.now() });
        }
      }
    }
    throw new Error("shrink_failed");
  } finally {
    image.close?.();
    if (canvas) { canvas.width = 0; canvas.height = 0; }
  }
}
