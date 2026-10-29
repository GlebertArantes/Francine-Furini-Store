import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { installFakeDom, textOf, byClass, findAll } from "../helpers/fake-dom.js";
import { previewProduct, previewSummary, isDirty, initialValues } from "../../admin/js/lib/preview-model.js";
import { friendlyLogin } from "../../admin/js/lib/identity.js";
import { resolveLoginIdentifier } from "../../admin/js/views/login.js";
import { BRAND } from "../../admin/js/lib/brand.js";
import { cardModel as storeCard } from "../../storefront/js/lib/card.js";

before(() => installFakeDom());
const read = (f) => fs.readFileSync(new URL(`../../${f}`, import.meta.url), "utf8");
const V = (id, color, size, quantity, active = true) => ({ id, color, size, quantity, active });
const blank = { name: "", category_id: "", price: "", compare_at: "", fabric: "", description: "", featured: false, active: false, published_at: "" };
const saved = { id: "p1", slug: "vestido", name: "Vestido", category_id: "c1", price_cents: 24900, compare_at_price_cents: null, featured: false, active: true, published_at: null, fabric: "Seda", description: "Fluido.",
  product_variants: [V("a", "Bege", "M", 3), V("b", "Preto", "P", 0)], product_images: [{ id: "i1", storage_path: "p1/a.webp", alt_text: "frente", sort_order: 0 }] };
const cats = [{ id: "c1", name: "Vestidos", slug: "vestidos" }];

// ---- identidade ------------------------------------------------------------------------------
test("friendlyLogin: mostra só o login, nunca o e-mail interno/completo", () => {
  assert.equal(friendlyLogin("fran1010@admin.francine-furini.local"), "Fran1010");
  assert.equal(friendlyLogin("sarytta10@admin.francine-furini.local"), "Sarytta10");
  assert.equal(friendlyLogin("gleberteads@hotmail.com"), "Gleberteads");
  for (const e of ["fran1010@admin.francine-furini.local", "gleberteads@hotmail.com"]) assert.ok(!/@|\./.test(friendlyLogin(e)));
  assert.equal(friendlyLogin(""), ""); assert.equal(friendlyLogin(null), ""); assert.equal(friendlyLogin("@x.com"), "");
});
test("friendlyLogin é coerente com o login digitado (ida e volta) e não fixa nenhum usuário", () => {
  for (const l of ["Fran1010", "Sarytta10"]) assert.equal(friendlyLogin(resolveLoginIdentifier(l)), l);
  assert.ok(!/Fran1010/.test(read("admin/js/app.js")), "login não pode ser fixo no app.js");
  assert.match(read("admin/js/app.js"), /friendlyLogin\(auth\.user\?\.email\)/);
  assert.ok(!/who\.textContent = auth\.user\?\.email/.test(read("admin/js/app.js")));
});

// ---- marca -----------------------------------------------------------------------------------
test("logo: arquivo do admin é idêntico ao oficial da vitrine e existe no deploy do admin", () => {
  const a = fs.readFileSync(new URL("../../admin/assets/brand/logo-mark.v1.webp", import.meta.url));
  const s = fs.readFileSync(new URL("../../storefront/assets/brand/logo-mark.v1.webp", import.meta.url));
  assert.ok(a.equals(s));
  assert.equal(BRAND.logo.src, "./assets/brand/logo-mark.v1.webp");
  assert.ok(!/storefront|\.\.\//.test(BRAND.logo.src), "sem caminho para a pasta da vitrine");
});
test("logo no login e no cabeçalho (img decorativa + nome em texto)", async () => {
  const { loginView, deniedView } = await import("../../admin/js/views/login.js");
  const login = loginView({ auth: {}, enter() {} });
  assert.equal(findAll(login, (e) => e.tag === "img" && e.className === "login-mark").length, 1);
  assert.equal(findAll(login, (e) => e.tag === "img")[0].getAttribute("alt"), "");
  assert.ok(textOf(login).includes("Francine Furini Store"));
  assert.equal(findAll(deniedView({ logout() {} }), (e) => e.tag === "img").length, 1);
  const app = read("admin/js/app.js");
  assert.match(app, /brandMark\(h, "brand-mark"\)/);
  assert.match(read("admin/css/admin.css"), /\.brand-mark \{[^}]*width: 2\.25rem/);
});

// ---- cópia compartilhada ---------------------------------------------------------------------
test("regras compartilhadas do admin são cópia byte a byte da vitrine (sem divergência)", () => {
  for (const f of ["catalog.js", "card.js", "format.js", "product-link.js"]) assert.equal(read(`admin/js/lib/shared/${f}`), read(`storefront/js/lib/${f}`), `${f} diverge: rode node scripts/sync-admin-shared.mjs`);
});
test("equivalência: card da prévia = card da vitrine para o mesmo produto", () => {
  const sum = previewSummary({ values: initialValues(saved), existing: saved, images: [{ url: "https://x/a.webp", alt: "frente" }], categories: cats });
  const store = storeCard({ ...sum.product, images: [{ storage_path: "https://x/a.webp", alt_text: "frente" }] }, { categories: cats, imageUrlOf: (x) => x });
  assert.deepEqual(sum.card, store);
});

// ---- prévia ----------------------------------------------------------------------------------
test("produto novo: prévia sem gravação, nasce rascunho e avisa que não há variantes", () => {
  const s = previewSummary({ values: { ...blank, name: "Blusa Lis", price: "129,90" }, images: [], categories: cats });
  assert.equal(s.dirty, true);
  assert.equal(s.visibility.state, "hidden");
  assert.equal(s.card.soldOut, true);
  assert.ok(s.notes.some((n) => /depois de criar o produto/i.test(n)));
  assert.ok(s.notes.some((n) => /Sem fotos/.test(n)));
  assert.equal(s.product.variants.length, 0, "nenhum estoque inventado");
  const src = read("admin/js/lib/preview-model.js") + read("admin/js/views/product-preview.js");
  assert.ok(!/ctx\.api|fetch\(|createProduct|updateProduct|createVariant|updateVariant|uploadImage/.test(src), "prévia é somente leitura");
});
test("nome e preço atualizam em tempo real (e preço inválido não vira R$ 0,00)", () => {
  const a = previewSummary({ values: { ...blank, name: "Blusa", price: "100" }, categories: cats });
  const b = previewSummary({ values: { ...blank, name: "Blusa Lis", price: "129,90" }, categories: cats });
  assert.equal(a.card.name, "Blusa"); assert.equal(b.card.name, "Blusa Lis");
  assert.equal(a.price.price, 10000); assert.equal(b.price.price, 12990);
  const bad = previewSummary({ values: { ...blank, name: "X", price: "abc" }, categories: cats });
  assert.equal(bad.price, null);
  assert.ok(bad.notes.some((n) => /preço válido/.test(n)));
});
test("promoção: preço anterior só quando maior que o atual", () => {
  const promo = previewSummary({ values: { ...blank, name: "X", price: "159,90", compare_at: "200,00" }, categories: cats });
  assert.equal(promo.card.onSale, true); assert.equal(promo.price.compareAt, 20000);
  const none = previewSummary({ values: { ...blank, name: "X", price: "200,00", compare_at: "150,00" }, categories: cats });
  assert.equal(none.card.onSale, false);
  assert.ok(none.notes.some((n) => /não mostrará promoção/.test(n)));
});
test("fotos locais antes de salvar: contador e principal vêm da seleção", () => {
  const imgs = [{ url: "blob:1", alt: "a" }, { url: "blob:2", alt: "" }, { url: "blob:3", alt: "" }];
  const s = previewSummary({ values: { ...blank, name: "X", price: "10" }, images: imgs, categories: cats });
  assert.equal(s.card.photoCount, 3); assert.equal(s.card.showPhotoCount, true); assert.equal(s.card.imageUrl, "blob:1");
});
test("variantes: sem variantes = esgotado; só estoque zero = esgotado; com estoque mostra cores/tamanhos reais", () => {
  const none = previewSummary({ values: initialValues({ ...saved, product_variants: [] }), existing: { ...saved, product_variants: [] }, categories: cats });
  assert.equal(none.card.soldOut, true); assert.ok(none.notes.some((n) => /ainda não tem cores/.test(n)));
  const zero = { ...saved, product_variants: [V("z", "Bege", "M", 0)] };
  assert.equal(previewSummary({ values: initialValues(zero), existing: zero, categories: cats }).card.soldOut, true);
  const ok = previewSummary({ values: initialValues(saved), existing: saved, categories: cats });
  assert.deepEqual(ok.card.colors.all, ["Bege"]); assert.deepEqual(ok.card.sizes.all, ["M"]); assert.equal(ok.card.soldOut, false);
});
test("edição de produto existente: igual ao salvo = sem alteração; mudou = não salvo; variantes não são alteradas", () => {
  const same = previewSummary({ values: initialValues(saved), existing: saved, categories: cats });
  assert.equal(same.dirty, false);
  const changed = previewSummary({ values: { ...initialValues(saved), name: "Vestido Novo", price: "199,90" }, existing: saved, categories: cats });
  assert.equal(changed.dirty, true); assert.equal(changed.card.name, "Vestido Novo");
  assert.deepEqual(previewProduct({ values: initialValues(saved), existing: saved }).variants.map((v) => v.quantity), [3, 0]);
  assert.deepEqual(saved.product_variants.map((v) => v.quantity), [3, 0], "entrada intacta");
  assert.equal(isDirty(initialValues(saved), null), true);
});
test("variante inativa não aparece na prévia (mesma regra da vitrine)", () => {
  const p = { ...saved, product_variants: [V("a", "Bege", "M", 3), V("c", "Azul", "G", 5, false)] };
  assert.deepEqual(previewSummary({ values: initialValues(p), existing: p, categories: cats }).card.colors.all, ["Bege"]);
});

// ---- DOM da prévia ---------------------------------------------------------------------------
test("painel: card e página; atualiza ao vivo; sem texto null/undefined", async () => {
  const { createPreviewPanel } = await import("../../admin/js/views/product-preview.js");
  const panel = createPreviewPanel();
  panel.update({ values: { ...blank, name: "Vestido Aurora", price: "159,90", compare_at: "200,00", featured: true, fabric: "Seda", description: "Fluido." }, existing: null, images: [{ url: "blob:1", alt: "" }, { url: "blob:2", alt: "" }], categories: cats });
  let t = textOf(panel.el);
  for (const w of ["Rascunho — nada foi salvo", "Vestido Aurora", "Promoção", "Destaque", "2 fotos", "Esgotado", "Ver detalhes"]) assert.ok(t.includes(w), w);
  panel.update({ values: { ...blank, name: "Outro nome", price: "10" }, existing: null, images: [], categories: cats });
  t = textOf(panel.el);
  assert.ok(t.includes("Outro nome") && !t.includes("Vestido Aurora"));
  assert.ok(!/null|undefined/.test(t));
  const tabs = findAll(panel.el, (e) => e.className === "pv-tab");
  tabs[1].listeners.find(([ty]) => ty === "click")[1]();
  t = textOf(panel.el);
  assert.ok(t.includes("O frete é calculado pela Francine") && t.includes("Esgotado"), "página do produto sem variantes = esgotado");
  assert.equal(findAll(panel.el, (e) => e.tag === "button" && e.className === "pv-buy")[0].getAttribute("disabled"), "");
});
test("integração: produto novo nasce oculto e regras de publicação/estoque/pedidos permanecem", () => {
  const src = read("admin/js/views/products.js");
  assert.match(src, /NEW_PRODUCT_DEFAULTS\.active/);
  assert.match(src, /Publicar na loja agora\?/);
  assert.match(src, /createProductWithPhotos/);
  assert.match(src, /form\.readValues/);
  assert.match(src, /newPhotos\?\.reset\(\)/, "URLs locais liberadas ao sair da tela");
  assert.match(read("admin/css/admin.css"), /\.edit-split\[data-view="preview"\] \.edit-main \{ display: none/);
  for (const f of ["admin/js/lib/rules.js", "admin/js/lib/api.js", "admin/js/views/orders.js"]) assert.ok(!/preview/i.test(read(f).replace(/previewUrl/g, "")), f);
});
