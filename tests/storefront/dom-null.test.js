import { test, before } from "node:test";
import assert from "node:assert/strict";
import { installFakeDom, textOf, textNodes, byClass, findAll, flush } from "../helpers/fake-dom.js";

before(() => installFakeDom());

const V = (id, color, size, quantity) => ({ id, color, size, quantity });
const product = (over = {}) => ({
  id: "p1", category_id: null, name: "Vestido Aurora", slug: "vestido-aurora", description: "Vestido fluido.", fabric: "Seda",
  price_cents: 24900, compare_at_price_cents: null, featured: false,
  variants: [V("v1", "Nude", "M", 3)], images: [{ storage_path: "products/p1/a.webp", alt_text: "frente", sort_order: 0 }], ...over,
});
const ctxFor = (products, cartItems = []) => ({
  load: async () => {}, products, categories: [], settings: {},
  api: { imageUrl: (p) => (p ? `https://x/${p}` : null) },
  cart: { get: () => ({ items: cartItems }), add: () => ({ limited: false }) },
  cfg: { createOrderUrl: "https://x/fn" },
  navigate() {}, refreshCart: async () => [],
});
const noLiteralNullOrUndefined = (root, msg) => {
  const nodes = textNodes(root);
  assert.ok(!nodes.includes("null"), `${msg}: nó de texto "null" renderizado`);
  assert.ok(!nodes.includes("undefined"), `${msg}: nó de texto "undefined" renderizado`);
  assert.ok(!/null|undefined/.test(textOf(root)), `${msg}: "null"/"undefined" no texto visível`);
};

test("produto com 1 imagem: imagem principal existe e NÃO aparece o texto 'null'", async () => {
  const { productView } = await import("../../storefront/js/views/product.js");
  const root = productView(ctxFor([product()]), "vestido-aurora");
  await flush();
  const gallery = byClass(root, "gallery")[0];
  assert.ok(gallery, "galeria renderizada");
  assert.equal(findAll(byClass(gallery, "main")[0], (e) => e.tag === "img").length, 1, "imagem principal");
  assert.equal(byClass(gallery, "thumbs").length, 0, "sem thumbnails com uma só foto");
  assert.equal(textOf(gallery), "", "galeria não tem texto solto");
  noLiteralNullOrUndefined(root, "1 imagem");
});

test("produto com várias imagens: thumbnails existem, alt preservado e sem 'null'", async () => {
  const { productView } = await import("../../storefront/js/views/product.js");
  const images = [0, 1, 2].map((i) => ({ storage_path: `products/p1/${i}.webp`, alt_text: `foto ${i}`, sort_order: i }));
  const root = productView(ctxFor([product({ images })]), "vestido-aurora");
  await flush();
  const gallery = byClass(root, "gallery")[0];
  const thumbs = byClass(gallery, "thumbs")[0];
  assert.ok(thumbs, "container de thumbnails");
  assert.equal(findAll(thumbs, (e) => e.tag === "button").length, 3, "3 thumbnails");
  assert.equal(findAll(byClass(gallery, "main")[0], (e) => e.tag === "img")[0].getAttribute("alt"), "foto 0", "alt da principal");
  noLiteralNullOrUndefined(root, "várias imagens");
});

test("produto sem imagem, sem descrição e sem tecido: nenhum 'null'/'undefined' (blocos condicionais)", async () => {
  const { productView } = await import("../../storefront/js/views/product.js");
  const root = productView(ctxFor([product({ images: [], description: "", fabric: "" })]), "vestido-aurora");
  await flush();
  assert.ok(byClass(root, "noimg").length >= 1, "placeholder no lugar da foto");
  noLiteralNullOrUndefined(root, "sem imagem/descrição/tecido");
});

test("carrinho vazio e checkout vazio não mostram 'null' (aviso de mudanças ausente)", async () => {
  const { cartView } = await import("../../storefront/js/views/cart.js");
  const { checkoutView } = await import("../../storefront/js/views/checkout.js");
  const cart = cartView(ctxFor([product()], []));
  const checkout = checkoutView(ctxFor([product()], []));
  await flush();
  assert.match(textOf(cart), /vazio/i);
  assert.match(textOf(checkout), /vazio/i);
  noLiteralNullOrUndefined(cart, "carrinho vazio");
  noLiteralNullOrUndefined(checkout, "checkout vazio");
});

test("carrinho com itens (sem erro e sem mudanças) não mostra 'null'", async () => {
  const { cartView } = await import("../../storefront/js/views/cart.js");
  const items = [{ variant_id: "v1", product_id: "p1", stock: 3, quantity: 1, ref: { name: "Vestido Aurora", slug: "vestido-aurora", color: "Nude", size: "M", price_cents: 24900, image: null } }];
  const root = cartView(ctxFor([product()], items));
  await flush();
  assert.match(textOf(root), /Vestido Aurora/);
  noLiteralNullOrUndefined(root, "carrinho com itens");
});
