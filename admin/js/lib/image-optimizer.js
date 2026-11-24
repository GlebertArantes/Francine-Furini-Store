// TaskZap Image Optimizer — compressão/otimização automática no navegador, ANTES do upload.
// Porta a lógica já provada em donna-store/src/utils/image.ts para JS vanilla (ES module, sem build
// step). A cliente nunca precisa comprimir manualmente: toda foto escolhida passa por aqui.
//
// Resumo do comportamento (igual para todos os projetos TaskZap):
// - Formato preferencial WebP; fallback automático para JPEG quando o navegador não gera WebP de
//   verdade (alguns navegadores antigos ignoram o tipo pedido e devolvem PNG gigante — detectamos
//   isso pelo `blob.type` devolvido por canvas.toBlob, nunca pelo tipo que pedimos).
// - Qualidade inicial 0.85; resolução máxima 2000px no lado maior, sem nunca ampliar.
// - Decodificação via createImageBitmap({ imageOrientation: 'from-image' }), com fallback <img> —
//   ambos resolvem a orientação EXIF automaticamente.
// - HEIC/HEIF: detectado pelos bytes mágicos (nunca só MIME/extensão, que o WhatsApp/apps zeram ou
//   erram); se o navegador não decodificar nativamente, converte via heic2any (CDN, import dinâmico).
// - PNG com transparência preserva o alfa no WebP; o fallback JPEG usa fundo branco (não tem alfa).
// - Nunca aceita silenciosamente o arquivo original gigante se a otimização falhar: lança erro claro.
import { MAX_IMAGE_BYTES } from "./rules.js";

/** Lado maior após otimizar. Fotos menores que isso nunca são ampliadas. */
export const OPT_MAX_DIMENSION = 2000;
/** Qualidade inicial do WebP/JPEG — prioridade é qualidade, não bater um peso exato. */
export const OPT_QUALITY = 0.85;
/** Se o resultado ainda ficar pesado demais para o bucket, tenta de novo em tamanhos menores
 * antes de desistir (nunca reduz agressivamente a qualidade só para caber no teto). */
export const OPT_DIMENSION_STEPS = [OPT_MAX_DIMENSION, 1600, 1200, 900];
/** Foto de origem acima disso é recusada antes de sequer tentar otimizar (evita travar o navegador
 * com um arquivo absurdo; a otimização em si acontece sempre no navegador). */
export const MAX_RAW_INPUT_BYTES = 50 * 1024 * 1024;
/** Resolução de origem acima disso (largura × altura) é recusada: acima disso nenhum navegador
 * decodifica de forma confiável via canvas. */
const MAX_SOURCE_PIXELS = 120_000_000;

/** URL do módulo heic2any (CDN, ESM) — convertido somente quando o navegador não decodifica o
 * HEIC/HEIF nativamente. Função separada para facilitar troca/teste. */
const HEIC2ANY_MODULE_URL = "https://cdn.jsdelivr.net/npm/heic2any@0.0.4/+esm";

function messageFor(code, fileName) {
  const name = `"${fileName}"`;
  switch (code) {
    case "empty": return `O arquivo ${name} está vazio ou não pôde ser lido. Selecione a foto novamente.`;
    case "too_big": return `${name} é grande demais para otimizar automaticamente. Envie uma versão menor.`;
    case "not_image": return `${name} não parece ser uma imagem. Use JPG, PNG, WebP ou HEIC.`;
    case "heic": return `Não foi possível ler o formato HEIC/HEIF de ${name}. Envie uma versão JPG ou PNG.`;
    case "decode": return `Não foi possível abrir ${name}. Escolha outra imagem.`;
    case "dimensions": return `A resolução de ${name} é alta demais para este navegador. Envie uma versão menor.`;
    case "encode": return `Não foi possível otimizar ${name}. Tente outra imagem ou uma versão menor.`;
    default: return `Não foi possível processar ${name}. Tente outra imagem.`;
  }
}

/** Erro de otimização com mensagem já pronta para a cliente (nunca expõe detalhes internos). */
export class ImageOptimizeError extends Error {
  code; fileName;
  constructor(code, fileName, cause) {
    super(messageFor(code, fileName));
    this.name = "ImageOptimizeError";
    this.code = code;
    this.fileName = fileName;
    if (cause !== undefined) this.cause = cause;
  }
}

const KIND_MIME = {
  jpeg: "image/jpeg", png: "image/png", gif: "image/gif",
  webp: "image/webp", bmp: "image/bmp", heic: "image/heic", avif: "image/avif",
};

const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"]);

function ascii(bytes, start, end) {
  return String.fromCharCode(...bytes.slice(start, end));
}

/** Identifica o formato pelos primeiros bytes — o MIME e a extensão informados pelo navegador podem
 * estar vazios ou errados (WhatsApp, prints, apps). Nunca confiar só em file.type/extensão. */
export function detectImageKind(head) {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "jpeg";
  if (head.length >= 8 && head[0] === 0x89 && ascii(head, 1, 4) === "PNG") return "png";
  if (head.length >= 6 && ascii(head, 0, 3) === "GIF") return "gif";
  if (head.length >= 12 && ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 12) === "WEBP") return "webp";
  if (head.length >= 2 && ascii(head, 0, 2) === "BM") return "bmp";
  if (head.length >= 12 && ascii(head, 4, 8) === "ftyp") {
    const brand = ascii(head, 8, 12);
    if (HEIC_BRANDS.has(brand)) return "heic";
    if (brand === "avif" || brand === "avis") return "avif";
  }
  return "unknown";
}

export { HEIC_BRANDS };

async function readHead(file, length = 32) {
  const slice = file.slice(0, length);
  try {
    if (typeof slice.arrayBuffer === "function") return new Uint8Array(await slice.arrayBuffer());
  } catch { /* cai no FileReader */ }
  return new Promise((resolve) => {
    try {
      const reader = new FileReader();
      reader.onload = () => resolve(new Uint8Array(reader.result));
      reader.onerror = () => resolve(new Uint8Array(0));
      reader.readAsArrayBuffer(slice);
    } catch { resolve(new Uint8Array(0)); }
  });
}

function looksHeicByNameOrType(file) {
  if (file.type === "image/heic" || file.type === "image/heif") return true;
  return /\.(heic|heif)$/i.test(file.name ?? "");
}

/** Converte HEIC/HEIF para JPEG via heic2any (CDN). Import dinâmico: só é baixado quando realmente
 * precisa (navegador não decodifica o HEIC nativamente). */
async function convertHeicToJpeg(file, moduleUrl) {
  const mod = await import(/* @vite-ignore */ moduleUrl);
  const heic2any = mod.default ?? mod;
  const result = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.9 });
  return Array.isArray(result) ? result[0] : result;
}

function decodeWithImageElement(blob, env) {
  return new Promise((resolve, reject) => {
    const url = env.URL.createObjectURL(blob);
    const img = new env.Image();
    const dispose = () => env.URL.revokeObjectURL(url);
    img.onload = () => resolve({ source: img, width: img.naturalWidth || img.width, height: img.naturalHeight || img.height, dispose });
    img.onerror = () => { dispose(); reject(new Error("image_decode_failed")); };
    img.src = url;
  });
}

/** Decodifica preferindo createImageBitmap (mais leve, fora da thread principal); cai no <img>
 * quando indisponível ou quando falha (Safari antigo, formatos que só o decoder do <img> entende).
 * Ambos respeitam a orientação EXIF via imageOrientation: 'from-image'. */
async function decodeImage(blob, env) {
  if (typeof env.createImageBitmap === "function") {
    try {
      const bitmap = await env.createImageBitmap(blob, { imageOrientation: "from-image" });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, dispose: () => bitmap.close?.() };
    } catch { /* tenta o <img> */ }
  }
  return decodeWithImageElement(blob, env);
}

async function decodeFile(file, env, moduleUrl) {
  const head = await readHead(file);
  if (head.length === 0 && file.size > 0) throw new ImageOptimizeError("empty", file.name);
  const kind = detectImageKind(head);
  const heicLike = kind === "heic" || (kind === "unknown" && looksHeicByNameOrType(file));
  if (kind === "unknown" && !String(file.type ?? "").startsWith("image/") && !heicLike) {
    // sem assinatura de imagem e sem MIME de imagem: provavelmente não é foto
    throw new ImageOptimizeError("not_image", file.name);
  }

  // Dá ao navegador o MIME certo quando o informado está vazio/errado (sem copiar bytes).
  const mime = kind === "unknown" ? file.type : KIND_MIME[kind];
  const blob = mime && mime !== file.type && typeof file.slice === "function" ? file.slice(0, file.size, mime) : file;

  try {
    return await decodeImage(blob, env);
  } catch (nativeError) {
    if (!heicLike) throw new ImageOptimizeError("decode", file.name, nativeError);
  }

  // HEIC/HEIF que o navegador não lê nativamente (Chrome/Windows/Android): converte.
  let converted;
  try {
    converted = await convertHeicToJpeg(file, moduleUrl);
  } catch (err) {
    throw new ImageOptimizeError("heic", file.name, err);
  }
  try {
    return await decodeImage(converted, env);
  } catch (err) {
    throw new ImageOptimizeError("heic", file.name, err);
  }
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    try { canvas.toBlob((blob) => resolve(blob), type, quality); } catch (err) { reject(err); }
  });
}

function releaseCanvas(canvas) { canvas.width = 0; canvas.height = 0; }

/**
 * Alguns navegadores (ex.: Safari em versões mais antigas) não suportam canvas.toBlob('image/webp').
 * Nesse caso o navegador ignora silenciosamente o tipo pedido e devolve um PNG sem compressão (várias
 * vezes mais pesado). Detectamos isso pelo `blob.type` devolvido e, quando não é WebP de verdade,
 * usamos JPEG (suportado universalmente) em vez de aceitar o PNG gigante. O JPEG é gerado sobre fundo
 * branco (não tem alfa); o WebP preserva a transparência original do PNG.
 */
async function encodeBestEffort(canvas, quality, env) {
  try {
    const webpBlob = await canvasToBlob(canvas, "image/webp", quality);
    if (webpBlob && webpBlob.type === "image/webp" && webpBlob.size > 0) {
      return { blob: webpBlob, mimeType: "image/webp", extension: "webp" };
    }
  } catch { /* segue para JPEG */ }

  const opaque = env.document.createElement("canvas");
  opaque.width = canvas.width;
  opaque.height = canvas.height;
  const ctx = opaque.getContext("2d");
  if (!ctx) throw new Error("canvas_2d_unavailable");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, opaque.width, opaque.height);
  ctx.drawImage(canvas, 0, 0);
  try {
    const jpegBlob = await canvasToBlob(opaque, "image/jpeg", quality);
    if (!jpegBlob || jpegBlob.size === 0) throw new Error("encode_failed");
    return { blob: jpegBlob, mimeType: "image/jpeg", extension: "jpg" };
  } finally {
    releaseCanvas(opaque);
  }
}

/** Dimensões finais mantendo proporção; NUNCA amplia uma foto menor que o limite. */
export function fitWithin(width, height, maxDimension) {
  if (width <= maxDimension && height <= maxDimension) return { width, height };
  if (width >= height) return { width: maxDimension, height: Math.max(1, Math.round((height / width) * maxDimension)) };
  return { width: Math.max(1, Math.round((width / height) * maxDimension)), height: maxDimension };
}

async function renderVariant(decoded, maxDimension, quality, env) {
  const { width, height } = fitWithin(decoded.width, decoded.height, maxDimension);
  const canvas = env.document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  try {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas_2d_unavailable");
    if ("imageSmoothingQuality" in ctx) ctx.imageSmoothingQuality = "high";
    ctx.drawImage(decoded.source, 0, 0, width, height);
    const { blob, mimeType, extension } = await encodeBestEffort(canvas, quality, env);
    return { blob, width, height, mimeType, extension };
  } finally {
    releaseCanvas(canvas);
  }
}

function outputName(originalName, extension) {
  const stem = String(originalName ?? "foto").replace(/\.[^.]+$/, "").trim() || "foto";
  return `${stem}.${extension}`;
}

/**
 * Converte HEIC/HEIF quando necessário e otimiza a foto para upload: WebP quando o navegador
 * suporta de verdade, JPEG como fallback automático quando não suporta. Resolução máxima de
 * OPT_MAX_DIMENSION px no lado maior (nunca amplia), qualidade inicial OPT_QUALITY. Se o resultado
 * ainda ficar pesado demais para o bucket (MAX_IMAGE_BYTES), tenta de novo em tamanhos menores antes
 * de desistir — qualidade tem prioridade sobre bater um peso exato. Devolve um File pronto para
 * substituir o original na fila de fotos. Erros são sempre ImageOptimizeError (mensagem amigável);
 * nunca deixa passar silenciosamente o arquivo original gigante quando a otimização falha.
 */
export async function optimizeImageForUpload(file, env = globalThis, heic2anyUrl = HEIC2ANY_MODULE_URL) {
  if (!file || !(file.size > 0)) throw new ImageOptimizeError("empty", file?.name ?? "arquivo");
  if (file.size > MAX_RAW_INPUT_BYTES) throw new ImageOptimizeError("too_big", file.name);

  const decoded = await decodeFile(file, env, heic2anyUrl);
  try {
    if (!(decoded.width > 0 && decoded.height > 0)) throw new ImageOptimizeError("decode", file.name);
    if (decoded.width * decoded.height > MAX_SOURCE_PIXELS) throw new ImageOptimizeError("dimensions", file.name);

    let lastError;
    for (const step of OPT_DIMENSION_STEPS) {
      try {
        const variant = await renderVariant(decoded, step, OPT_QUALITY, env);
        const isLastStep = step === OPT_DIMENSION_STEPS[OPT_DIMENSION_STEPS.length - 1];
        if (variant.blob.size > MAX_IMAGE_BYTES && !isLastStep) {
          lastError = new Error("variant_too_heavy");
          continue;
        }
        if (variant.blob.size > MAX_IMAGE_BYTES) throw new ImageOptimizeError("encode", file.name);
        const name = outputName(file.name, variant.extension);
        return new env.File([variant.blob], name, { type: variant.mimeType, lastModified: Date.now() });
      } catch (err) {
        if (err instanceof ImageOptimizeError) throw err;
        lastError = err;
      }
    }
    throw new ImageOptimizeError("encode", file.name, lastError);
  } finally {
    decoded.dispose?.();
  }
}
