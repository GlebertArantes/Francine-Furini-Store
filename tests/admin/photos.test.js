import { test } from "node:test";
import assert from "node:assert/strict";
import { createPhotoQueue, uploadPhotos, createProductWithPhotos, summarizeUpload } from "../../admin/js/lib/photos.js";
import { MAX_IMAGE_BYTES } from "../../admin/js/lib/rules.js";

const file = (name, type = "image/jpeg", size = 1000) => ({ name, type, size });
const NEW_ID = "10000000-0000-0000-0000-0000000000aa";

/** API falsa que registra a ordem exata das chamadas. */
function fakeApi({ failCreate = false, failUploads = [], expireOn = null } = {}) {
  const calls = [];
  return {
    calls,
    async createProduct(payload) { calls.push({ fn: "createProduct", payload }); if (failCreate) throw Object.assign(new Error("boom"), { status: 409 }); return { id: NEW_ID, ...payload }; },
    async uploadImage(productId, f, opts) {
      calls.push({ fn: "uploadImage", productId, name: f.name, ...opts });
      if (expireOn === f.name) throw Object.assign(new Error("session_expired"), { code: "session_expired" });
      if (failUploads.includes(f.name)) throw new Error("upload_failed");
      return { id: `img-${f.name}`, product_id: productId, sort_order: opts.sortOrder };
    },
    async deleteProduct() { calls.push({ fn: "deleteProduct" }); },
    async updateProduct() { calls.push({ fn: "updateProduct" }); },
  };
}

test("novo produto: dá para selecionar fotos ANTES do createProduct, sem nenhuma requisição", () => {
  const api = fakeApi();
  const q = createPhotoQueue();
  q.add([file("a.jpg"), file("b.png", "image/png")]);
  assert.equal(q.items.length, 2);
  assert.equal(q.valid().length, 2);
  assert.deepEqual(api.calls, []); // nada enviado, nem produto criado
});

test("fila: texto alternativo opcional, remover da seleção, acumular seleções e manter a ordem", () => {
  const q = createPhotoQueue();
  q.add([file("1.jpg"), file("2.jpg")]);
  q.add([file("3.webp", "image/webp")]);
  const [a, b] = q.items;
  q.setAlt(a.key, "frente");
  q.remove(b.key);
  assert.deepEqual(q.items.map((i) => i.file.name), ["1.jpg", "3.webp"]);
  assert.equal(q.items[0].alt, "frente");
});

test("createProduct acontece ANTES de uploadImage e o upload usa o ID retornado", async () => {
  const api = fakeApi();
  const q = createPhotoQueue(); q.add([file("a.jpg"), file("b.jpg")]);
  const r = await createProductWithPhotos(api, { name: "Saia" }, q);
  assert.deepEqual(api.calls.map((c) => c.fn), ["createProduct", "uploadImage", "uploadImage"]);
  assert.ok(api.calls.slice(1).every((c) => c.productId === NEW_ID));
  assert.equal(r.product.id, NEW_ID);
  assert.equal(r.uploaded.length, 2);
});

test("várias imagens preservam a ordem (sort_order sequencial) e o alt de cada uma", async () => {
  const api = fakeApi();
  const q = createPhotoQueue(); q.add([file("c.jpg"), file("a.jpg"), file("b.jpg")]);
  q.setAlt(q.items[1].key, "  detalhe ");
  await createProductWithPhotos(api, { name: "X" }, q);
  const ups = api.calls.filter((c) => c.fn === "uploadImage");
  assert.deepEqual(ups.map((u) => u.name), ["c.jpg", "a.jpg", "b.jpg"]);
  assert.deepEqual(ups.map((u) => u.sortOrder), [0, 1, 2]);
  assert.deepEqual(ups.map((u) => u.altText), ["", "detalhe", ""]);
});

test("arquivo inválido (MIME) ou > 8 MB aparece na fila com erro mas NUNCA é enviado", async () => {
  const api = fakeApi();
  const q = createPhotoQueue();
  q.add([file("ok.jpg"), file("gif.gif", "image/gif"), file("grande.jpg", "image/jpeg", MAX_IMAGE_BYTES + 1), file("limite.png", "image/png", MAX_IMAGE_BYTES), file("vazio.jpg", "image/jpeg", 0)]);
  assert.deepEqual(q.valid().map((i) => i.file.name), ["ok.jpg", "limite.png"]);
  assert.deepEqual(q.invalid().map((i) => i.file.name), ["gif.gif", "grande.jpg", "vazio.jpg"]);
  const r = await createProductWithPhotos(api, { name: "X" }, q);
  const sent = api.calls.filter((c) => c.fn === "uploadImage").map((c) => c.name);
  assert.deepEqual(sent, ["ok.jpg", "limite.png"]);
  assert.deepEqual(r.skipped.map((s) => s.name).sort(), ["gif.gif", "grande.jpg", "vazio.jpg"]);
  // mesmo se um item inválido chegar direto ao uploader, é barrado de novo
  const direct = await uploadPhotos(api, NEW_ID, [{ file: file("x.svg", "image/svg+xml"), alt: "" }]);
  assert.equal(direct.skipped.length, 1);
  assert.equal(api.calls.filter((c) => c.name === "x.svg").length, 0);
});

test("falha ao criar o produto: nenhum upload e a seleção de fotos continua intacta", async () => {
  const api = fakeApi({ failCreate: true });
  const q = createPhotoQueue(); q.add([file("a.jpg"), file("b.jpg")]); q.setAlt(q.items[0].key, "alt");
  await assert.rejects(createProductWithPhotos(api, { name: "X" }, q), /boom/);
  assert.deepEqual(api.calls.map((c) => c.fn), ["createProduct"]); // zero uploadImage
  assert.equal(q.items.length, 2);
  assert.equal(q.items[0].alt, "alt");
  // tentar de novo (corrigido) funciona com a mesma fila
  const ok = fakeApi();
  assert.equal((await createProductWithPhotos(ok, { name: "X" }, q)).uploaded.length, 2);
});

test("falha em UMA foto depois da criação: produto NÃO é removido, demais fotos sobem e a falha é informada", async () => {
  const api = fakeApi({ failUploads: ["b.jpg"] });
  const q = createPhotoQueue(); q.add([file("a.jpg"), file("b.jpg"), file("c.jpg")]);
  const r = await createProductWithPhotos(api, { name: "Saia" }, q);
  assert.equal(r.product.id, NEW_ID);
  assert.deepEqual(r.uploaded.map((u) => u.id), ["img-a.jpg", "img-c.jpg"]);
  assert.deepEqual(r.failed.map((f) => f.name), ["b.jpg"]);
  assert.ok(!api.calls.some((c) => c.fn === "deleteProduct"));
  // a posição relativa é mantida (c continua depois de b)
  assert.deepEqual(api.calls.filter((c) => c.fn === "uploadImage").map((c) => c.sortOrder), [0, 1, 2]);
  const s = summarizeUpload(r);
  assert.equal(s.hasProblem, true);
  assert.match(s.text, /b\.jpg/);
  assert.match(s.text, /Envie novamente/);
  assert.ok(!/a\.jpg/.test(s.text.replace("1 foto", ""))); // só a que falhou é listada como falha
});

test("sessão expirada no meio dos uploads interrompe os envios restantes sem apagar nada", async () => {
  const api = fakeApi({ expireOn: "b.jpg" });
  const q = createPhotoQueue(); q.add([file("a.jpg"), file("b.jpg"), file("c.jpg")]);
  const r = await createProductWithPhotos(api, { name: "X" }, q);
  assert.equal(r.sessionExpired, true);
  assert.deepEqual(api.calls.filter((c) => c.fn === "uploadImage").map((c) => c.name), ["a.jpg", "b.jpg"]); // c nem tentou
  assert.deepEqual(r.failed.map((f) => f.name), ["b.jpg", "c.jpg"]);
  assert.ok(!api.calls.some((c) => c.fn === "deleteProduct"));
});

test("sem fotos: cria o produto normalmente, sem uploads; edição continua enviando com startOrder", async () => {
  const api = fakeApi();
  const r = await createProductWithPhotos(api, { name: "X" }, createPhotoQueue());
  assert.deepEqual(api.calls.map((c) => c.fn), ["createProduct"]);
  assert.equal(summarizeUpload(r).hasProblem, false);
  // edição de produto existente: novas fotos continuam a sequência
  const api2 = fakeApi();
  const q = createPhotoQueue(); q.add([file("n1.jpg"), file("n2.jpg")]);
  await uploadPhotos(api2, "10000000-0000-0000-0000-000000000001", q.valid(), 3);
  assert.deepEqual(api2.calls.map((c) => [c.productId, c.sortOrder]), [["10000000-0000-0000-0000-000000000001", 3], ["10000000-0000-0000-0000-000000000001", 4]]);
});
