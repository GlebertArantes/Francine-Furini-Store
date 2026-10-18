import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { installFakeDom, textOf, textNodes, byClass, findAll } from "../helpers/fake-dom.js";
import { cardModel, cardOptions, stockInfo, CARD_LOW_STOCK_TOTAL } from "../../storefront/js/lib/card.js";
import { priceExtras, PAYMENT_DISPLAY } from "../../storefront/js/lib/payment-info.js";

before(() => installFakeDom());

const V = (id, color, size, quantity, active = true) => ({ id, color, size, quantity, active });
const img = (n) => Array.from({ length: n }, (_, i) => ({ storage_path: `p/${i}.webp`, alt_text: "", sort_order: i }));
const product = (over = {}) => ({
  id: "p1", category_id: "c1", name: "Vestido Aurora", slug: "vestido-aurora", price_cents: 24900, compare_at_price_cents: null,
  featured: false, variants: [V("a", "Nude", "M", 5), V("b", "Preto", "P", 4)], images: img(1), ...over,
});
const cats = [{ id: "c1", name: "Vestidos", slug: "vestidos" }];
const model = (p, c = cats) => cardModel(p, { categories: c, imageUrlOf: (x) => (x ? `https://x/${x}` : null) });
const ctx = (products, categories = cats) => ({ products, categories, api: { imageUrl: (x) => (x ? `https://x/${x}` : null) } });

test("modelo: promoção só quando preço anterior > atual; destaque só quando featured", () => {
  assert.equal(model(product()).onSale, false);
  assert.equal(model(product({ compare_at_price_cents: 24900 })).onSale, false);
  assert.equal(model(product({ compare_at_price_cents: 30000 })).onSale, true);
  assert.equal(model(product({ featured: true })).featured, true);
  assert.equal(model(product()).featured, false);
});

test("modelo: contador de fotos só com 2+; categoria só se cadastrada", () => {
  assert.equal(model(product({ images: img(1) })).showPhotoCount, false);
  assert.equal(model(product({ images: img(0) })).imageUrl, null);
  assert.equal(model(product({ images: img(3) })).showPhotoCount, true);
  assert.equal(model(product({ category_id: null })).category, null);
  assert.equal(model(product(), [{ id: "c1", name: "  ", slug: "x" }]).category, null);
  assert.equal(model(product()).category, "Vestidos");
});

test("cores e tamanhos: só variantes ativas com estoque; limites com +N", () => {
  const p = product({ variants: [V("1", "Nude", "M", 2), V("2", "Preto", "G", 0), V("3", "Azul", "P", 3, false), V("4", "nude", "P", 1)] });
  const o = cardOptions(p);
  assert.deepEqual(o.colors.all, ["Nude"]);
  assert.deepEqual(o.sizes.all, ["P", "M"]);
  const many = product({ variants: ["A", "B", "C", "D", "E"].flatMap((c, i) => ["P", "M", "G", "GG", "34", "36"].map((s, j) => V(`${i}${j}`, c, s, 2))) });
  const m = cardOptions(many);
  assert.equal(m.colors.shown.length, 3); assert.equal(m.colors.extra, 2);
  assert.equal(m.sizes.shown.length, 5); assert.equal(m.sizes.extra, 1);
});

test("estoque: ok / baixo / esgotado ignorando variantes inativas", () => {
  assert.equal(stockInfo(product()).state, "ok");
  assert.equal(stockInfo(product({ variants: [V("a", "N", "M", 1)] })).label, "Resta apenas 1 peça");
  assert.equal(stockInfo(product({ variants: [V("a", "N", "M", CARD_LOW_STOCK_TOTAL)] })).label, `Restam apenas ${CARD_LOW_STOCK_TOTAL} peças`);
  assert.equal(stockInfo(product({ variants: [V("a", "N", "M", 9, false)] })).state, "out");
  assert.equal(stockInfo(product({ variants: [] })).state, "out");
  const so = model(product({ variants: [V("a", "N", "M", 0)] }));
  assert.equal(so.soldOut, true); assert.equal(so.ctaLabel, "Ver detalhes");
  assert.equal(model(product()).ctaLabel, "Escolher cor e tamanho");
});

test("nenhum dado comercial inventado: sem Pix/parcelas por padrão", () => {
  assert.deepEqual(priceExtras(product()), []);
  assert.equal(PAYMENT_DISPLAY.installments, null);
  assert.equal(PAYMENT_DISPLAY.pixDiscount, null);
});

async function render(p, c) {
  const { productCard } = await import("../../storefront/js/views/common.js");
  return productCard(ctx([p], c), p);
}

test("DOM: card completo com promoção, destaque, categoria, fotos, cores e tamanhos", async () => {
  const el = await render(product({ compare_at_price_cents: 30000, featured: true, images: img(3) }));
  const t = textOf(el);
  for (const w of ["Promoção", "Destaque", "3 fotos", "Vestidos", "Vestido Aurora", "Cores", "Tam.", "Escolher cor e tamanho"]) assert.ok(t.includes(w), w);
  assert.equal(findAll(el, (e) => e.tag === "s").length, 1, "preço anterior riscado");
  assert.ok(!/null|undefined|SKU|Pix|x de |parcel|Lançamento/i.test(t), t);
  assert.ok(!textNodes(el).includes("null"));
});

test("DOM: card simples não renderiza rótulos vazios", async () => {
  const el = await render(product({ category_id: null, images: img(0) }));
  assert.equal(byClass(el, "pcard-cat").length, 0);
  assert.equal(byClass(el, "pcard-badges").length, 0);
  assert.equal(byClass(el, "pcard-count").length, 0);
  assert.ok(byClass(el, "noimg").length >= 1);
});

test("DOM: esgotado mostra tag e não oferece escolha", async () => {
  const el = await render(product({ variants: [V("a", "N", "M", 0)] }));
  assert.equal(byClass(el, "pcard-tag").length, 1);
  assert.ok(textOf(el).includes("Ver detalhes"));
  assert.equal(byClass(el, "pcard-colors").length, 0);
});

test("acessibilidade: um único link, sem botões/links aninhados, CTA decorativo", async () => {
  const el = await render(product({ images: img(2) }));
  assert.equal(findAll(el, (e) => e.tag === "a").length, 1);
  assert.equal(findAll(el, (e) => e.tag === "button").length, 0);
  assert.equal(byClass(el, "pcard-cta")[0].getAttribute("aria-hidden"), "true");
  assert.equal(findAll(el, (e) => e.tag === "a")[0].getAttribute("href"), "#/produto/vestido-aurora");
  assert.ok(byClass(el, "pcard")[0].getAttribute("aria-labelledby"));
});

test("home: coleção com 1 produto usa layout is-single sem 'Destaques' duplicado", async () => {
  const { homeView } = await import("../../storefront/js/views/home.js");
  const p = product({ featured: true });
  const c = { ...ctx([p]), settings: {}, load: async () => {}, navigate() {}, cart: { get: () => ({ items: [] }) }, cfg: {}, rerender() {} };
  const root = homeView(c, new URLSearchParams());
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(byClass(root, "grid").filter((g) => g.className.includes("is-single")).length, 1);
  assert.equal(findAll(root, (e) => /^h2$/.test(e.tag) && textOf(e) === "Destaques").length, 0);
  assert.equal(byClass(root, "pcard").length, 1, "produto aparece uma só vez");
});

const css = readFileSync(new URL("../../storefront/css/styles.css", import.meta.url), "utf8");
test("CSS: proporção, alvo de toque, link esticado, sem estilos órfãos do card antigo", () => {
  assert.match(css, /\.pcard-media\s*{[^}]*aspect-ratio:\s*4\s*\/\s*5/);
  assert.match(css, /\.pcard-link::after\s*{[^}]*inset:\s*0/);
  assert.match(css, /\.pcard-cta\s*{[^}]*min-height:\s*44px/);
  assert.match(css, /\.grid\.is-single/);
  assert.match(css, /prefers-reduced-motion[^]*\.pcard/);
  assert.ok(!/(^|[\s,}])\.card[\s.{:,]/m.test(css), "regras .card antigas removidas");
});
