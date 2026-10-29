import { test } from "node:test";
import assert from "node:assert/strict";
import { productUrl, productShareInfo, copyProductLink } from "../../admin/js/lib/product-link.js";
import { installFakeDom, findAll, flush, textOf } from "../helpers/fake-dom.js";
import { productsListView } from "../../admin/js/views/products.js";

const product = { id: "p1", slug: "camisa-beth", name: "Camisa Beth", active: true, published_at: null,
  price_cents: 12999, product_variants: [{ active: true, quantity: 0 }], product_images: [] };
const now = Date.parse("2026-10-29T12:00:00Z");

test("link aponta para a peça no domínio oficial e codifica o slug sem permitir trocar o destino", () => {
  assert.equal(productUrl(product), "https://francinefurinistore.com.br/#/produto/camisa-beth");
  assert.equal(productUrl({ ...product, slug: "peça #1/?x" }), "https://francinefurinistore.com.br/#/produto/pe%C3%A7a%20%231%2F%3Fx");
  assert.equal(productUrl({ slug: "nao-salvo" }), null);
  assert.equal(productUrl({ ...product, slug: "" }), null);
});

test("oculto e agendado não podem ser divulgados; produto visível esgotado conserva seu link", () => {
  assert.equal(productShareInfo(product, now).enabled, true);
  assert.equal(productShareInfo({ ...product, active: false }, now).enabled, false);
  assert.match(productShareInfo({ ...product, active: false }, now).note, /oculto/);
  assert.equal(productShareInfo({ ...product, published_at: "2026-10-30T12:00:00Z" }, now).enabled, false);
  assert.equal(productShareInfo({ ...product, published_at: "2026-10-29T12:00:00Z" }, now).enabled, true);
});

test("copiar só informa sucesso depois de gravar a URL exata; não tenta copiar rascunho", async () => {
  const copied = [], env = { navigator: { clipboard: { async writeText(value) { copied.push(value); } } } };
  assert.equal((await copyProductLink(product, env, now)).copied, true);
  assert.deepEqual(copied, [productUrl(product)]);
  assert.equal((await copyProductLink({ ...product, active: false }, env, now)).copied, false);
  assert.equal(copied.length, 1);
});

test("clipboard indisponível ou bloqueado devolve o link para cópia manual, sem falso sucesso", async () => {
  assert.deepEqual(await copyProductLink(product, {}, now), { ...productShareInfo(product, now), copied: false });
  const denied = { navigator: { clipboard: { writeText: async () => { throw Error("denied"); } } } };
  const result = await copyProductLink(product, denied, now);
  assert.equal(result.copied, false); assert.equal(result.url, productUrl(product));
});

test("lista inclui um botão por produto sem aninhar controles no link de edição", async () => {
  installFakeDom();
  const root = productsListView({ api: { listProducts: async () => [product, { ...product, id: "p2", active: false }] }, fail: () => false });
  await flush();
  const copies = findAll(root, e => e.tag === "button" && e.textContent === "Copiar link");
  assert.equal(copies.length, 2); assert.equal(copies[1].getAttribute("disabled"), "");
  for (const a of findAll(root, e => e.tag === "a")) assert.equal(findAll(a, e => e.tag === "button").length, 0);
  assert.ok(textOf(root).includes("Produto oculto"));
});
