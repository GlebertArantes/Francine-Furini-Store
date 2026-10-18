// Matriz de homologação (dados 100% sintéticos, sem rede): cenários A–E do catálogo ao item de pedido.
import { test } from "node:test";
import assert from "node:assert/strict";
import { filterProducts, priceInfo, colorsOf, sizesOfColor, cartLine, variantIndex, isSoldOut } from "../../storefront/js/lib/catalog.js";
import { cardModel } from "../../storefront/js/lib/card.js";
import { addItem, setQuantity, removeItem, subtotalCents, toOrderItems, reconcile, emptyCart } from "../../storefront/js/lib/cart.js";

const V = (id, color, size, quantity, active = true) => ({ id, color, size, quantity, active });
const img = (n) => Array.from({ length: n }, (_, i) => ({ storage_path: `t/${i}.webp`, alt_text: `foto ${i}`, sort_order: i }));
const P = (id, name, over = {}) => ({ id, name, slug: id, category_id: null, price_cents: 10000, compare_at_price_cents: null, featured: false, images: img(1), variants: [], ...over });

const A = P("a", "TESTE A simples", { variants: [V("a1", "Bege", "M", 3)] });
const B = P("b", "TESTE B variantes", { variants: [V("b1", "Preto", "P", 2), V("b2", "Preto", "M", 0), V("b3", "Bege", "G", 5), V("b4", "Bege", "GG", 1)], images: img(3) });
const C = P("c", "TESTE C promo", { price_cents: 15900, compare_at_price_cents: 20000, variants: [V("c1", "Azul", "M", 4)] });
const D = P("d", "TESTE D galeria", { images: img(5), variants: [V("d1", "Rosa", "34", 2)] });
const E1 = P("e1", "TESTE E esgotado", { variants: [V("e11", "Preto", "M", 0)] });
const E2 = P("e2", "TESTE E variante desativada", { variants: [V("e21", "Preto", "M", 9, false)] });
const all = [A, B, C, D, E1, E2];
const model = (p) => cardModel(p, { categories: [], imageUrlOf: (x) => x });

test("A — produto simples: 1 cor, 1 tamanho, 1 foto, sem selos nem contador", () => {
  const m = model(A);
  assert.deepEqual([m.colors.all, m.sizes.all, m.photoCount, m.showPhotoCount, m.onSale, m.soldOut], [["Bege"], ["M"], 1, false, false, false]);
});

test("B — variantes: estoque independente e combinação sem estoque não é oferecida", () => {
  const m = model(B);
  assert.deepEqual(m.colors.all, ["Bege", "Preto"]);
  assert.deepEqual(m.sizes.all, ["P", "G", "GG"]); // Preto/M (qtd 0) não aparece
  assert.deepEqual(colorsOf(B).length, 2);
  const preto = sizesOfColor(B, "Preto");
  assert.ok(preto.find((s) => s.size === "M")?.quantity === 0 || !preto.some((s) => s.size === "M" && s.quantity > 0));
  let s = addItem(emptyCart(), cartLine(B, B.variants[0]), 5).state; // Preto/P, estoque 2
  assert.equal(s.items[0].quantity, 2);
  s = addItem(s, cartLine(B, B.variants[2]), 1).state;               // Bege/G
  assert.equal(s.items.length, 2, "duas variantes do mesmo produto = duas linhas");
  assert.equal(addItem(s, cartLine(B, B.variants[1]), 1).added, 0, "variante sem estoque não entra");
});

test("C — promoção: selo, preço anterior e preço de referência do pedido = preço atual", () => {
  const m = model(C);
  assert.equal(m.onSale, true);
  assert.equal(priceInfo(C).onSale, true);
  const s = addItem(emptyCart(), cartLine(C, C.variants[0]), 2).state;
  assert.equal(subtotalCents(s), 15900 * 2, "usa o preço atual, nunca o anterior");
  assert.deepEqual(toOrderItems(s), [{ variant_id: "c1", quantity: 2 }], "pedido envia só variante+quantidade (preço vem do banco)");
});

test("D — galeria: contador e primeira foto por sort_order", () => {
  const m = model(D);
  assert.equal(m.photoCount, 5);
  assert.equal(m.showPhotoCount, true);
  assert.equal(m.imageUrl, "t/0.webp");
  assert.equal(m.imageAlt, "foto 0");
});

test("E — esgotado e variante desativada: marcados esgotados, filtro 'disponíveis' os oculta, não vão ao carrinho", () => {
  for (const p of [E1, E2]) { assert.equal(isSoldOut(p), true, p.name); assert.equal(model(p).soldOut, true); assert.equal(model(p).ctaLabel, "Ver detalhes"); }
  const avail = filterProducts(all, { onlyAvailable: true }).map((p) => p.id);
  assert.deepEqual(avail.sort(), ["a", "b", "c", "d"]);
  // A camada do carrinho confia no catálogo (RLS já oculta inativas); se uma linha antiga existir, a reconciliação a remove.
  const stale = addItem(emptyCart(), cartLine(E2, E2.variants[0]), 1).state;
  assert.equal(reconcile(stale, variantIndex([E2])).state.items.length, 0);
});

test("busca e filtros sobre a matriz", () => {
  assert.deepEqual(filterProducts(all, { q: "promo" }).map((p) => p.id), ["c"]);
  assert.deepEqual(filterProducts(all, { size: "GG" }).map((p) => p.id), ["b"]);
  assert.deepEqual(filterProducts(all, { color: "Rosa" }).map((p) => p.id), ["d"]);
});

test("carrinho: alterar, remover e reconciliar com estoque que caiu / variante desativada", () => {
  let s = addItem(emptyCart(), cartLine(A, A.variants[0]), 3).state;
  s = setQuantity(s, "a1", 10);
  assert.ok(s.items[0].quantity <= 3, "nunca acima do estoque");
  const base = emptyCart();
  let cart = addItem(addItem(base, cartLine(A, A.variants[0]), 3).state, cartLine(C, C.variants[0]), 1).state;
  const A2 = { ...A, variants: [V("a1", "Bege", "M", 1)] };           // estoque caiu
  const C2 = { ...C, variants: [V("c1", "Azul", "M", 4, false)] };    // variante desativada
  const r = reconcile(cart, variantIndex([A2, C2].map((p) => ({ ...p, variants: p.variants.filter((v) => v.active) }))));
  assert.equal(r.state.items.length, 1);
  assert.equal(r.state.items[0].quantity, 1);
  assert.ok(r.changes.length >= 2);
  assert.equal(removeItem(r.state, "a1").items.length, 0);
});
