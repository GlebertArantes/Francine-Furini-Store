import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { installFakeDom, textOf, byClass, findAll, textNodes } from "../helpers/fake-dom.js";
import { h } from "../../storefront/js/lib/dom.js";
import { BRAND, wordmarkContent, wordmarkClass } from "../../storefront/js/lib/brand.js";
import { howToBuySection, howToBuyView, STEPS, NOTICE } from "../../storefront/js/views/how-to-buy.js";
import { createOrderPlacer, postOrder, errorMessage } from "../../storefront/js/lib/checkout.js";
import { createCartStore } from "../../storefront/js/lib/cart.js";

before(() => installFakeDom());
const read = (f) => fs.readFileSync(new URL(`../../${f}`, import.meta.url), "utf8");

// ---- Como comprar --------------------------------------------------------------------------
test("Como comprar: 4 passos do fluxo real, na ordem, e aviso explícito (sem pagamento / sem reserva de estoque)", () => {
  assert.deepEqual(STEPS.map((s) => s[0]), ["Escolha suas peças", "Selecione tamanho e cor", "Registre sua solicitação", "Envie pelo WhatsApp"]);
  const root = howToBuySection();
  const text = textOf(root);
  for (const [t] of STEPS) assert.ok(text.includes(t));
  assert.match(text, /A Francine calcula o frete, combina o pagamento/);
  assert.match(text, /Toque no botão do WhatsApp/);
  assert.match(NOTICE, /não é confirmação de pagamento nem reserva de estoque/);
  assert.ok(text.includes(NOTICE));
  assert.equal(findAll(root, (e) => e.tag === "li").length, 4);
  assert.ok(!textNodes(root).includes("null") && !textNodes(howToBuyView()).includes("undefined"));
});

test("Como comprar: não inventa política de troca, desconto, prazo, garantia nem frete grátis", () => {
  const all = (textOf(howToBuySection()) + read("storefront/js/views/how-to-buy.js")).toLowerCase();
  for (const word of ["troca", "devolu", "desconto", "cupom", "prazo", "dias úteis", "garantia", "frete grátis", "entrega em", "parcel", "pix", "cartão"]) {
    assert.ok(!all.includes(word), `texto inventado: "${word}"`);
  }
});

test("home mostra Como comprar sem filtros; há rota própria e link no rodapé", () => {
  assert.match(read("storefront/js/views/home.js"), /if \(!filtered\) parts\.push\(h\("div", \{ class: "wrap" \}, howToBuySection\(\)\)\)/);
  const app = read("storefront/js/app.js");
  assert.match(app, /parts\[0\] === "como-comprar"/);
  assert.match(app, /href: "#\/como-comprar"/);
});

// ---- Logo: estrutura pronta, sem marca improvisada ------------------------------------------
test("cabeçalho: sem logo configurada usa o wordmark tipográfico", () => {
  const brand = { name: "Francine Furini Store", logo: null };
  assert.equal(wordmarkClass(brand), "wordmark");
  const el = h("a", {}, ...wordmarkContent(h, brand));
  assert.equal(textOf(el), "Francine FuriniStore");
  assert.equal(findAll(el, (e) => e.tag === "img").length, 0);
});

test("cabeçalho: monograma oficial + nome em texto visível (img decorativa, sem duplicar leitura)", () => {
  assert.equal(wordmarkClass(), "wordmark has-logo");
  const el = h("a", {}, ...wordmarkContent(h));
  const img = findAll(el, (e) => e.tag === "img")[0];
  assert.match(img.getAttribute("src"), /^\.\/assets\/brand\/logo-mark\.v1\.webp$/);
  assert.equal(img.getAttribute("alt"), "");
  assert.equal(textOf(el), "Francine FuriniStore");
});

test("cabeçalho: com a logo oficial exibe <img> responsiva e mantém o nome acessível", () => {
  const brand = { name: "Francine Furini Store", logo: { src: "./assets/brand/logo.svg", width: 160, height: 48 } };
  assert.equal(wordmarkClass(brand), "wordmark has-logo");
  const el = h("a", {}, ...wordmarkContent(h, brand));
  const img = findAll(el, (e) => e.tag === "img")[0];
  assert.equal(img.getAttribute("src"), "./assets/brand/logo.svg");
  assert.equal(img.getAttribute("alt"), "");
  assert.equal(img.getAttribute("width"), "160");
  assert.equal(byClass(el, "sr-only").length, 1);
  assert.equal(textOf(byClass(el, "sr-only")[0]), "Francine Furini Store");
});

test("marca: assets oficiais versionados existem e a arte é raster (sem afirmar SVG/transparência)", () => {
  const dir = fs.readdirSync(new URL("../../storefront/assets/brand/", import.meta.url));
  for (const f of ["logo-mark.v1.webp", "favicon-32.v1.png", "favicon-16.v1.png", "apple-touch-icon.v1.png", "og-image.v1.jpg", "README.md"]) assert.ok(dir.includes(f), f);
  assert.match(read("storefront/assets/brand/README.md"), /raster|JPEG/i);
  const html = read("storefront/index.html");
  assert.match(html, /property="og:image" content="https:\/\/francinefurinistore\.com\.br\/assets\/brand\/og-image\.v1\.jpg"/);
  assert.match(html, /og:image:width" content="1200"/);
  assert.match(html, /twitter:image" content="https:\/\/francinefurinistore\.com\.br\//);
  assert.match(html, /rel="canonical" href="https:\/\/francinefurinistore\.com\.br\/"/);
  assert.match(html, /rel="icon"[^>]*favicon-32\.v1\.png/);
  assert.match(html, /rel="apple-touch-icon"[^>]*apple-touch-icon\.v1\.png/);
  assert.ok(!/data:image\/svg\+xml/.test(html), "sem favicon 'FF' improvisado");
  const css = read("storefront/css/styles.css");
  assert.match(css, /\.brand-logo \{[^}]*height: 2\.5rem/);
  assert.match(css, /--nude: #d2c3ae/i);   // bege da marca
  assert.match(css, /--brown: #734335/i);  // marrom-terroso da marca
});

// ---- Acessibilidade de cor (WCAG AA) ---------------------------------------------------------
function lum(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const tokens = () => Object.fromEntries([...read("storefront/css/styles.css").matchAll(/--([a-z]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]));

test("contraste AA (>= 4.5:1) nas combinações de texto da vitrine", () => {
  const t = tokens();
  const pairs = [["cream", "brown", "botão/ aviso (texto creme sobre marrom-terroso)"], ["brown", "cream", "texto/preço sobre creme"], ["choc", "cream", "texto principal"],
    ["choc", "nude", "texto escuro sobre bege da marca"], ["taupe", "cream", "texto secundário (eyebrow, migalhas)"], ["brown", "sand", "texto sobre rodapé/hero"], ["cream", "choc", "hover dos botões"], ["cream", "danger", "erros"]];
  for (const [fg, bg, what] of pairs) assert.ok(ratio(t[fg], t[bg]) >= 4.5, `${what}: ${fg} sobre ${bg} = ${ratio(t[fg], t[bg]).toFixed(2)}`);
});

// ---- Checkout: erro de rede não pode induzir pedido duplicado ----------------------------------
test("falha de rede no envio mantém o carrinho e orienta a conferir antes de reenviar", async () => {
  const store = createCartStore(null);
  store.add({ variant_id: "v1", product_id: "p1", stock: 5, ref: { name: "V", slug: "v", color: "N", size: "M", price_cents: 100, image: null } }, 1);
  const customer = { name: "Maria Silva", phone: "34999991234", postal_code: "38000000", address_line: "Rua A", address_number: "1", neighborhood: "C", city: "Uberaba", state: "MG" };
  const place = createOrderPlacer({ cartStore: store, send: (payload) => postOrder({ fetchFn: async () => { throw new TypeError("Failed to fetch"); }, url: "https://x/fn", payload }) });
  const r = await place(customer);
  assert.equal(r.ok, false);
  assert.equal(r.code, "network");
  assert.equal(store.get().items.length, 1); // carrinho intacto para nova tentativa
  assert.match(r.message, /WhatsApp antes de reenviar/);
  assert.match(errorMessage("network"), /pedido duplicado/);
  const again = await place(customer); // nova tentativa é permitida (single-flight liberado)
  assert.equal(again.code, "network");
});
