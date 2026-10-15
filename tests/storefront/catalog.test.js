import { test } from "node:test";
import assert from "node:assert/strict";
import { filterProducts, facets, priceInfo, isSoldOut, compareSizes, colorsOf, sizesOfColor, featuredProducts, variantIndex } from "../../storefront/js/lib/catalog.js";
import { formatBRL } from "../../storefront/js/lib/format.js";
import { normalizeProduct, resolveConfig, createApi } from "../../storefront/js/lib/api.js";

const P = (id, over = {}) => ({ id, category_id: "c1", name: id, slug: id, description: "", fabric: "", price_cents: 10000, compare_at_price_cents: null, featured: false, images: [], variants: [], ...over });
const V = (id, color, size, quantity) => ({ id, color, size, quantity });
const products = [
  P("Vestido Seda", { featured: true, fabric: "Seda", variants: [V("1", "Nude", "M", 2), V("2", "Preto", "G", 0)] }),
  P("Blusa Linho", { category_id: "c2", variants: [V("3", "Off-white", "38", 1)] }),
  P("Saia Esgotada", { variants: [V("4", "Nude", "M", 0)] }),
];

test("preço promocional só quando compare_at > preço", () => {
  assert.deepEqual(priceInfo(P("a", { price_cents: 8000, compare_at_price_cents: 10000 })), { price: 8000, compareAt: 10000, onSale: true, discountPct: 20 });
  assert.equal(priceInfo(P("a", { compare_at_price_cents: 10000 })).onSale, false);
  assert.equal(priceInfo(P("a", { compare_at_price_cents: null })).onSale, false);
  assert.match(formatBRL(29900).replace(/\s/g, " "), /R\$ 299,00/);
});

test("esgotado = nenhuma variante com estoque", () => {
  assert.deepEqual(products.map(isSoldOut), [false, false, true]);
  assert.equal(isSoldOut(P("sem variantes")), true);
});

test("filtros: busca sem acento, categoria, disponibilidade", () => {
  assert.deepEqual(filterProducts(products, { q: "SEDA" }).map((p) => p.id), ["Vestido Seda"]);
  assert.deepEqual(filterProducts(products, { q: "off white" }).map((p) => p.id), ["Blusa Linho"]);
  assert.deepEqual(filterProducts(products, { q: "off-white" }).map((p) => p.id), ["Blusa Linho"]);
  assert.deepEqual(filterProducts(products, { categoryId: "c2" }).map((p) => p.id), ["Blusa Linho"]);
  assert.deepEqual(filterProducts(products, { onlyAvailable: true }).map((p) => p.id), ["Vestido Seda", "Blusa Linho"]);
});

test("tamanho e cor valem para a mesma variante; disponibilidade exige estoque nela", () => {
  assert.deepEqual(filterProducts(products, { size: "G", color: "Preto" }).map((p) => p.id), ["Vestido Seda"]);
  assert.deepEqual(filterProducts(products, { size: "G", color: "Nude" }).map((p) => p.id), []);
  assert.deepEqual(filterProducts(products, { size: "G", onlyAvailable: true }).map((p) => p.id), []);
  assert.deepEqual(filterProducts(products, { color: "nude", onlyAvailable: true }).map((p) => p.id), ["Vestido Seda"]);
});

test("facets e ordenação de tamanhos livres (letra, número, texto)", () => {
  const f = facets([P("x", { variants: [V("a", "Nude", "G", 1), V("b", "Nude", "Tamanho único", 1), V("c", "nude", "40", 1), V("d", "Preto", "P", 1), V("e", "Preto", "36", 1), V("f", "Preto", "GG", 1)] })]);
  assert.deepEqual(f.sizes, ["P", "G", "GG", "36", "40", "Tamanho único"]);
  assert.deepEqual(f.colors, ["Nude", "Preto"]);
  assert.ok(compareSizes("M", "G") < 0);
});

test("cores/tamanhos do produto e destaques", () => {
  assert.deepEqual(colorsOf(products[0]), [{ color: "Nude", available: true }, { color: "Preto", available: false }]);
  assert.deepEqual(sizesOfColor(products[0], "preto").map((v) => v.size), ["G"]);
  assert.deepEqual(featuredProducts(products).map((p) => p.id), ["Vestido Seda"]);
});

test("variantIndex alimenta reconciliação com estoque atual", () => {
  const idx = variantIndex(products);
  assert.equal(idx.get("1").stock, 2);
  assert.equal(idx.get("1").ref.price_cents, 10000);
});

test("api: normaliza produto, ordena imagens, monta URL pública do bucket e valida config", async () => {
  const n = normalizeProduct({ id: "p", name: "N", slug: "n", price_cents: 1, product_variants: [{ id: "v", color: "c", size: "s", quantity: 1, extra: "x" }], product_images: [{ storage_path: "b", sort_order: 2 }, { storage_path: "a", sort_order: 1 }] });
  assert.deepEqual(n.images.map((i) => i.storage_path), ["a", "b"]);
  assert.deepEqual(n.variants, [{ id: "v", color: "c", size: "s", quantity: 1 }]);
  const cfg = resolveConfig({ supabaseUrl: "https://abc.supabase.co/", supabasePublishableKey: "sb_publishable_x" });
  assert.equal(cfg.createOrderUrl, "https://abc.supabase.co/functions/v1/create-order");
  assert.throws(() => resolveConfig({}), /config_missing/);
  assert.throws(() => resolveConfig({ supabaseUrl: "http://insecure", supabasePublishableKey: "k" }), /config_missing/);
  const calls = [];
  const api = createApi(cfg, async (url, init) => { calls.push({ url, init }); return Response.json([{ id: "p", name: "N", slug: "n", price_cents: 1 }]); });
  assert.equal(api.imageUrl("products/p 1/a.webp"), "https://abc.supabase.co/storage/v1/object/public/product-images/products/p%201/a.webp");
  await api.getProducts();
  assert.equal(calls[0].init.headers.apikey, "sb_publishable_x");
  assert.ok(calls[0].url.includes("/rest/v1/products?select="));
});
