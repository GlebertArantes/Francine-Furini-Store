import { test } from "node:test";
import assert from "node:assert/strict";
import { initialPhotoState, photoState, photoRatio, photoOutputSize, fillPhotoZoom, photoLayout, drawPhoto, exportPhoto, loadPhoto } from "../../admin/js/lib/photo-transform.js";
import { createPhotoQueue, uploadPhotos } from "../../admin/js/lib/photos.js";
import { MAX_IMAGE_BYTES } from "../../admin/js/lib/rules.js";

const image = { width: 1600, height: 900 };
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} ≠ ${b}`);
const file = (name, size = 1000) => ({ name, size, type: "image/jpeg" });

test("foto inteira cabe no retrato, enquanto preencher cobre o quadro sem deformar", () => {
  const s = initialPhotoState(), fit = photoLayout(image, s, 300, 400);
  near(fit.scale, 300 / 1600);
  near(fit.scale * image.height, 168.75);
  const fill = photoLayout(image, { ...s, zoom: fillPhotoZoom(image, s) }, 300, 400);
  near(fill.scale * image.height, 400);
  assert.ok(fill.scale * image.width > 300);
});

test("mesmo recorte é proporcional na prévia e no JPEG exportado, inclusive movido e girado", () => {
  for (const rotation of [0, 90, 180, 270]) {
    const s = { ...initialPhotoState(), rotation, zoom: 2.3, panX: .18, panY: -.23 };
    const p = photoLayout(image, s, 300, 400), out = photoLayout(image, s, 1200, 1600);
    near(p.centerX * 4, out.centerX); near(p.centerY * 4, out.centerY); near(p.scale * 4, out.scale);
  }
});

test("formato original acompanha giro; exportação mantém proporção e limita resolução", () => {
  near(photoRatio(image, { ratio: "original", rotation: 90 }), 900 / 1600);
  assert.deepEqual(photoOutputSize(image, { ratio: "portrait" }), { width: 1200, height: 1600 });
  assert.deepEqual(photoOutputSize(image, { ratio: "square" }), { width: 1600, height: 1600 });
  assert.deepEqual(photoOutputSize({ width: 200, height: 300 }, { ratio: "portrait" }), { width: 225, height: 300 });
});

test("estado corrompido é normalizado e arraste extremo mantém parte da imagem visível", () => {
  const s = photoState({ zoom: Infinity, rotation: -90, panX: 300, panY: NaN, background: "javascript:bad", ratio: "__proto__" });
  assert.equal(s.rotation, 270); assert.equal(s.ratio, "portrait"); assert.equal(s.zoom, 1);
  assert.equal(s.background, "#fffdf9"); assert.equal(s.panX, 1); assert.equal(s.panY, 0);
  const l = photoLayout(image, { zoom: .5, panY: 1 }, 300, 400);
  assert.ok(l.centerY - image.height * l.scale / 2 < 400);
});

const fakeContext = () => {
  const calls = [];
  return { calls, save() { calls.push(["save"]); }, fillRect(...v) { calls.push(["fill", ...v]); },
    translate(...v) { calls.push(["translate", ...v]); }, rotate(...v) { calls.push(["rotate", ...v]); },
    drawImage(...v) { calls.push(["image", ...v]); }, restore() { calls.push(["restore"]); } };
};

test("desenho preenche fundo e aplica rotação antes da foto, sem modificar a imagem fonte", () => {
  const ctx = fakeContext(), before = { ...image };
  drawPhoto(ctx, image, { rotation: 90, background: "#ffffff" }, 300, 400);
  assert.deepEqual(ctx.calls.map(x => x[0]), ["save", "fill", "translate", "rotate", "image", "restore"]);
  near(ctx.calls.find(x => x[0] === "rotate")[1], Math.PI / 2);
  assert.equal(ctx.fillStyle, "#ffffff"); assert.deepEqual(image, before);
});

test("exportação gera JPEG com o enquadramento e respeita o limite de 8 MB", async () => {
  const ctx = fakeContext(), attempts = [];
  const canvas = { getContext: () => ctx, toBlob(fn, mime, quality) { attempts.push([mime, quality]); fn({ size: attempts.length === 1 ? MAX_IMAGE_BYTES + 1 : 250_000 }); } };
  class FakeFile { constructor(parts, name, opts) { this.name = name; this.type = opts.type; this.size = parts[0].size; } }
  const out = await exportPhoto(image, { zoom: 1.5 }, "frente.png", { document: { createElement: () => canvas }, File: FakeFile });
  assert.equal(out.name, "frente-ajustada.jpg"); assert.equal(out.type, "image/jpeg");
  assert.equal(out.size, 250_000); assert.equal(canvas.width, 1200); assert.equal(canvas.height, 1600);
  assert.deepEqual(attempts, [["image/jpeg", .9], ["image/jpeg", .8]]);
});

test("falha de exportação não devolve arquivo vazio ou acima do limite", async () => {
  const canvas = { getContext: () => fakeContext(), toBlob: fn => fn(null) };
  await assert.rejects(exportPhoto(image, {}, "a.jpg", { document: { createElement: () => canvas } }), /photo_export_failed/);
});

test("decodificação tenta orientação EXIF e usa fallback liberando a URL local", async () => {
  let revoked = null, orientation;
  const env = {
    createImageBitmap: async (_file, opts) => { orientation = opts.imageOrientation; throw Error("unsupported"); },
    URL: { createObjectURL: () => "blob:synthetic", revokeObjectURL: u => { revoked = u; } },
    Image: class { set src(_u) { queueMicrotask(() => this.onload()); } },
  };
  await loadPhoto(file("a.jpg"), env);
  assert.equal(orientation, "from-image"); assert.equal(revoked, "blob:synthetic");
});

test("fila preserva original, chave, posição e alt; uploader recebe somente a cópia ajustada", async () => {
  const queue = createPhotoQueue(), source = file("original.jpg"), edited = file("original-ajustada.jpg");
  queue.add([source, file("costas.jpg")]); const key = queue.items[0].key;
  queue.setAlt(key, "Frente da peça");
  assert.equal(queue.applyEdit(key, edited, { zoom: 2 }), true);
  assert.equal(queue.items[0].originalFile, source); assert.equal(queue.items[0].file, edited);
  assert.equal(queue.items[0].alt, "Frente da peça"); assert.equal(queue.items[0].key, key);
  const sent = [];
  await uploadPhotos({ uploadImage: async (_id, f) => { sent.push(f); return {}; } }, "p", queue.valid());
  assert.equal(sent[0], edited); assert.equal(sent[1].name, "costas.jpg");
  queue.restore(key); assert.equal(queue.items[0].file, source); assert.equal(queue.items[0].edit, null);
  assert.equal(queue.items[0].alt, "Frente da peça");
});

test("edição inválida ou aplicada depois de limpar a fila não troca o arquivo", () => {
  const queue = createPhotoQueue(), source = file("a.jpg"); queue.add([source]);
  const key = queue.items[0].key;
  assert.equal(queue.applyEdit(key, file("bad.jpg", MAX_IMAGE_BYTES + 1), {}), false);
  assert.equal(queue.items[0].file, source);
  queue.clear(); assert.equal(queue.applyEdit(key, file("ok.jpg"), {}), false); assert.equal(queue.items.length, 0);
});
