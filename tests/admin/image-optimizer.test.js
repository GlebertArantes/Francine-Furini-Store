import { test } from "node:test";
import assert from "node:assert/strict";
import {
  detectImageKind, fitWithin, optimizeImageForUpload, ImageOptimizeError,
  OPT_MAX_DIMENSION, OPT_QUALITY, MAX_RAW_INPUT_BYTES,
} from "../../admin/js/lib/image-optimizer.js";
import { MAX_IMAGE_BYTES } from "../../admin/js/lib/rules.js";

// ---------------------------------------------------------------- ambiente falso (sem DOM real)
/** Canvas falso: grava toda chamada de toBlob (tipo/qualidade/tamanho no momento da chamada) e
 * simula o bug real de navegadores antigos que ignoram 'image/webp' e devolvem PNG sem compressão. */
function fakeCanvasFactory({ webpSupported = true, blobBytes = {} } = {}) {
  const created = [];
  const createElement = () => {
    const canvas = {
      width: 0, height: 0,
      getContext: () => ({ imageSmoothingQuality: "low", fillStyle: "", fillRect() {}, drawImage() {} }),
      toBlob(cb, type, quality) {
        canvas.calls = canvas.calls ?? [];
        canvas.calls.push({ type, quality, width: canvas.width, height: canvas.height });
        if (type === "image/webp") {
          if (webpSupported) { cb(new Blob([new Uint8Array(blobBytes.webp ?? 40_000)], { type: "image/webp" })); return; }
          // navegador ignora o tipo pedido e devolve PNG gigante sem compressão
          cb(new Blob([new Uint8Array(blobBytes.pngFallback ?? 9_000_000)], { type: "image/png" }));
          return;
        }
        cb(new Blob([new Uint8Array(blobBytes.jpeg ?? 60_000)], { type: "image/jpeg" }));
      },
    };
    created.push(canvas);
    return canvas;
  };
  return { created, document: { createElement } };
}

function fakeEnv({ width, height, webpSupported = true, blobBytes = {}, decodeError = null } = {}) {
  const canvasEnv = fakeCanvasFactory({ webpSupported, blobBytes });
  return {
    ...canvasEnv,
    createImageBitmap: async () => {
      if (decodeError) throw decodeError;
      return { width, height, close() {} };
    },
    URL: { createObjectURL: () => "blob:fake", revokeObjectURL: () => {} },
    // createImageBitmap é sempre tentado primeiro nos testes; o fallback <img> só entra quando ele
    // falha, e aqui simula um navegador que também não decodifica o formato de forma alguma (cenário
    // em que queremos ver o erro final, não um sucesso silencioso pela outra via).
    Image: class { set src(_u) { queueMicrotask(() => this.onerror?.(new Error("img_decode_failed"))); } },
    File: class FakeFile {
      constructor(parts, name, opts) { this.name = name; this.type = opts.type; this.size = parts.reduce((n, p) => n + (p.size ?? p.length ?? 0), 0); }
    },
  };
}

const magicHeic = () => {
  const b = new Uint8Array(20);
  // ftyp box: [size(4)]['ftyp']['heic'][...]
  b.set([0, 0, 0, 20], 0);
  "ftyp".split("").forEach((c, i) => (b[4 + i] = c.charCodeAt(0)));
  "heic".split("").forEach((c, i) => (b[8 + i] = c.charCodeAt(0)));
  return b;
};
const magicPng = () => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const magicJpeg = () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);

// ---------------------------------------------------------------- detectImageKind (bytes mágicos)
test("detecta HEIC pelos bytes mágicos (ftyp + brand heic), nunca só por MIME/extensão", () => {
  assert.equal(detectImageKind(magicHeic()), "heic");
  assert.equal(detectImageKind(magicPng()), "png");
  assert.equal(detectImageKind(magicJpeg()), "jpeg");
  assert.equal(detectImageKind(new Uint8Array([1, 2, 3])), "unknown");
  // outras marcas de HEIC/HEIF reais (iPhone usa heic/heix; vídeos HEVC usam hevc/hevx)
  const heix = magicHeic(); "heix".split("").forEach((c, i) => (heix[8 + i] = c.charCodeAt(0)));
  assert.equal(detectImageKind(heix), "heic");
});

// ---------------------------------------------------------------- fitWithin (nunca amplia)
test("fitWithin: reduz mantendo proporção e nunca amplia foto menor que o limite", () => {
  assert.deepEqual(fitWithin(4000, 3000, 2000), { width: 2000, height: 1500 });
  assert.deepEqual(fitWithin(3000, 4000, 2000), { width: 1500, height: 2000 });
  assert.deepEqual(fitWithin(800, 600, 2000), { width: 800, height: 600 }); // menor: intacto
  assert.deepEqual(fitWithin(2000, 2000, 2000), { width: 2000, height: 2000 }); // exato: intacto
});

// ---------------------------------------------------------------- optimizeImageForUpload
test("reduz o tamanho de um arquivo grande (dimensão > 2000px é reduzida ao otimizar)", async () => {
  const original = new Blob([new Uint8Array(12_000_000)], { type: "image/jpeg" });
  const file = new File([original], "foto-grande.jpg", { type: "image/jpeg" });
  const env = fakeEnv({ width: 4000, height: 3000, blobBytes: { webp: 300_000 } });
  const out = await optimizeImageForUpload(file, env);
  assert.ok(out.size < file.size, `esperado menor que ${file.size}, obtido ${out.size}`);
  assert.equal(out.type, "image/webp");
  assert.equal(out.name, "foto-grande.webp");
  // a primeira tentativa já usa a dimensão máxima (2000px no lado maior); lido no momento da
  // chamada a toBlob (o canvas é liberado — width/height zerados — depois de encodado).
  const firstCall = env.created[0].calls[0];
  assert.equal(Math.max(firstCall.width, firstCall.height), OPT_MAX_DIMENSION);
  assert.equal(firstCall.quality, OPT_QUALITY);
});

test("nunca amplia uma foto já menor que o limite (800x600 permanece 800x600)", async () => {
  const file = new File([new Blob([new Uint8Array(50_000)])], "pequena.jpg", { type: "image/jpeg" });
  const env = fakeEnv({ width: 800, height: 600 });
  await optimizeImageForUpload(file, env);
  const call = env.created[0].calls[0];
  assert.equal(call.width, 800);
  assert.equal(call.height, 600);
});

test("PNG com transparência: preserva o alfa usando WebP (não força fundo branco)", async () => {
  const file = new File([new Blob([new Uint8Array(500_000)])], "logo.png", { type: "image/png" });
  Object.defineProperty(file, "slice", { value: (...a) => Blob.prototype.slice.apply(new Blob([new Uint8Array(500_000)]), a) });
  const env = fakeEnv({ width: 1200, height: 900, webpSupported: true });
  const out = await optimizeImageForUpload(file, env);
  assert.equal(out.type, "image/webp"); // WebP preserva o canal alfa do PNG original
  assert.match(out.name, /\.webp$/);
});

test("fallback para JPEG (fundo branco) quando o navegador não gera WebP de verdade", async () => {
  const file = new File([new Blob([new Uint8Array(500_000)])], "logo.png", { type: "image/png" });
  const env = fakeEnv({ width: 1200, height: 900, webpSupported: false, blobBytes: { jpeg: 80_000 } });
  const out = await optimizeImageForUpload(file, env);
  assert.equal(out.type, "image/jpeg"); // sem alfa: fundo branco já aplicado no canvas de encode
  assert.match(out.name, /\.jpg$/);
  // o canvas opaco (fallback) recebeu fillRect branco antes do drawImage — verificado indiretamente
  // pelo fato de ter sido criado um segundo canvas (o opaco) além do principal
  assert.ok(env.created.length >= 2);
});

test("arquivo vazio ou bruto gigante demais: erro amigável, nunca passa o original silenciosamente", async () => {
  const empty = new File([], "vazia.jpg", { type: "image/jpeg" });
  await assert.rejects(optimizeImageForUpload(empty, fakeEnv({ width: 10, height: 10 })), ImageOptimizeError);
  const hugeBytes = MAX_RAW_INPUT_BYTES + 1;
  const huge = { name: "gigante.jpg", size: hugeBytes, type: "image/jpeg", slice: () => ({ arrayBuffer: async () => new ArrayBuffer(0) }) };
  await assert.rejects(optimizeImageForUpload(huge, fakeEnv({ width: 10, height: 10 })), ImageOptimizeError);
});

test("resultado ainda pesado demais no tamanho máximo: tenta dimensões menores antes de devolver", async () => {
  const file = new File([new Blob([new Uint8Array(1_000_000)])], "pesada.jpg", { type: "image/jpeg" });
  let call = 0;
  const env = fakeEnv({ width: 5000, height: 4000 });
  const baseToBlob = env.document.createElement;
  env.document.createElement = () => {
    const canvas = baseToBlob();
    const realToBlob = canvas.toBlob.bind(canvas);
    canvas.toBlob = (cb, type, quality) => {
      call++;
      // só a 2ª tentativa de WebP (dimensão menor) fica dentro do limite do bucket
      if (type === "image/webp") {
        const big = Math.max(canvas.width, canvas.height) === OPT_MAX_DIMENSION;
        cb(new Blob([new Uint8Array(big ? MAX_IMAGE_BYTES + 1_000_000 : 400_000)], { type: "image/webp" }));
        return;
      }
      realToBlob(cb, type, quality);
    };
    return canvas;
  };
  const out = await optimizeImageForUpload(file, env);
  assert.ok(out.size <= MAX_IMAGE_BYTES);
  assert.ok(call >= 2, "deveria ter tentado mais de uma dimensão");
});

test("decode falha e o arquivo não parece HEIC: erro de decodificação (nunca trava o app)", async () => {
  const file = new File([new Blob([new Uint8Array(1000)])], "corrompida.jpg", { type: "image/jpeg" });
  const env = fakeEnv({ width: 10, height: 10, decodeError: new Error("boom") });
  await assert.rejects(optimizeImageForUpload(file, env), ImageOptimizeError);
});

test("HEIC/HEIF que o navegador não decodifica nativamente é convertido via heic2any antes de otimizar", async () => {
  // Módulo heic2any falso servido por data: URL (sem rede) — simula a conversão para JPEG.
  const fakeHeic2anyModule = `export default async function heic2any({ blob }) {
    return new Blob([new Uint8Array(200_000)], { type: "image/jpeg" });
  }`;
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(fakeHeic2anyModule, "utf8").toString("base64")}`;
  const bytes = magicHeic();
  const file = {
    name: "IMG_0001.heic", type: "image/heic", size: bytes.length,
    slice(start, end, type) {
      const b = new Blob([bytes.slice(start ?? 0, end ?? bytes.length)], { type: type ?? this.type });
      return b;
    },
  };
  let attempt = 0;
  const env = fakeEnv({ width: 1600, height: 1200 });
  const realBitmap = env.createImageBitmap;
  env.createImageBitmap = async (blob) => {
    attempt++;
    if (attempt === 1) throw new Error("navegador não decodifica HEIC nativamente"); // 1ª tentativa: arquivo HEIC original
    return realBitmap(blob); // 2ª tentativa: já é o JPEG convertido pelo heic2any
  };
  const out = await optimizeImageForUpload(file, env, moduleUrl);
  assert.equal(out.type, "image/webp");
  assert.equal(attempt, 2);
});

test("HEIC cuja conversão via heic2any falha: erro claro pedindo JPG/PNG, nunca trava o app", async () => {
  const badModuleUrl = `data:text/javascript;base64,${Buffer.from("export default async function () { throw new Error('conversion_failed'); }", "utf8").toString("base64")}`;
  const bytes = magicHeic();
  const file = {
    name: "IMG_0002.heic", type: "image/heic", size: bytes.length,
    slice(start, end, type) { return new Blob([bytes.slice(start ?? 0, end ?? bytes.length)], { type: type ?? this.type }); },
  };
  const env = fakeEnv({ width: 1600, height: 1200, decodeError: new Error("não decodifica HEIC") });
  await assert.rejects(optimizeImageForUpload(file, env, badModuleUrl), (err) => {
    assert.ok(err instanceof ImageOptimizeError);
    assert.equal(err.code, "heic");
    assert.match(err.message, /HEIC\/HEIF/);
    return true;
  });
});
