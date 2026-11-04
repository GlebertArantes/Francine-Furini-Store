// Regressão: o formulário de produto precisa MONTAR (novo e edição). Uma linha solta em productForm
// (ReferenceError) derrubava a tela inteira e o painel culpava a "conexão".
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { installFakeDom, textOf, findAll, flush } from "../helpers/fake-dom.js";
import { productEditView } from "../../admin/js/views/products.js";
import { loadInto } from "../../admin/js/lib/ui.js";

before(() => {
  installFakeDom();
  globalThis.window = { addEventListener() {}, scrollTo() {} };
  globalThis.location = { hash: "" };
  globalThis.URL.createObjectURL ??= () => "blob:x";
});

const product = { id: "p1", slug: "vestido", name: "Vestido", category_id: null, price_cents: 24900, compare_at_price_cents: null, featured: false, active: false, published_at: null, fabric: "", description: "",
  product_variants: [{ id: "v1", color: "Bege", size: "M", quantity: 3, active: true, stock_version: 1, sku: null }], product_images: [] };
const mkCtx = (p) => ({ fail: () => false, navigate() {}, flash: null,
  api: { listCategories: async () => [{ id: "c1", name: "Vestidos", active: true }], getProduct: async () => p, previewUrl: (x) => `u/${x}` } });

test("Novo produto: o formulário monta (campos, fotos e botão Criar produto)", async () => {
  const root = productEditView(mkCtx(null), "novo");
  await flush(); await flush();
  const txt = textOf(root);
  assert.ok(!/Não foi possível/.test(txt), txt.slice(0, 200));
  assert.equal(findAll(root, (e) => e.tag === "form").length >= 1, true);
  assert.ok(findAll(root, (e) => e.tag === "input" && e.attrs.name === "name").length === 1 || /Nome do produto/.test(txt));
  assert.match(txt, /Criar produto/);
  assert.match(txt, /Fotos do produto/);
});

test("Editar produto: formulário, variantes e fotos montam", async () => {
  const root = productEditView(mkCtx(product), "p1");
  await flush(); await flush();
  const txt = textOf(root);
  assert.ok(!/Não foi possível/.test(txt), txt.slice(0, 200));
  assert.match(txt, /Salvar alterações/);
  assert.match(txt, /Variantes e estoque/);
});

test("Erro ao MONTAR a tela não é apresentado como falta de conexão", async () => {
  const root = new (globalThis.document.createElement("div").constructor)("div");
  const quiet = console.error; console.error = () => {};
  try {
    await loadInto({ fail: () => false }, root, async () => 1, () => { throw new ReferenceError("boom"); });
  } finally { console.error = quiet; }
  const txt = textOf(root);
  assert.match(txt, /Não foi possível abrir esta tela/);
  assert.ok(!/conexão/.test(txt.replace(/não é a sua internet/, "")) || /não é a sua internet/.test(txt));
  // falha real de carregamento continua apontando a conexão
  await loadInto({ fail: () => false }, root, async () => { throw new Error("net"); }, () => {});
  assert.match(textOf(root), /Verifique sua conexão/);
});
