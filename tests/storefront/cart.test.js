import { test } from "node:test";
import assert from "node:assert/strict";
import { addItem, setQuantity, removeItem, subtotalCents, toOrderItems, reconcile, emptyCart, parseStored, createCartStore, totalQuantity, MAX_QTY_PER_VARIANT } from "../../storefront/js/lib/cart.js";

const line = (id, stock = 5, extra = {}) => ({
  variant_id: id, product_id: "p1", stock,
  ref: { name: "Vestido", slug: "vestido", color: "Nude", size: "M", price_cents: 29900, image: null, ...extra },
});

test("agrega por variante: adicionar a mesma variante soma quantidade em uma linha", () => {
  let s = addItem(emptyCart(), line("v1"), 1).state;
  s = addItem(s, line("v1"), 2).state;
  assert.equal(s.items.length, 1);
  assert.equal(s.items[0].quantity, 3);
});

test("duas variantes do mesmo produto permanecem separadas", () => {
  let s = addItem(emptyCart(), line("v1", 5, { size: "M" }), 1).state;
  s = addItem(s, line("v2", 5, { size: "G" }), 1).state;
  assert.deepEqual(s.items.map((i) => i.variant_id), ["v1", "v2"]);
  assert.equal(totalQuantity(s), 2);
});

test("quantidade nunca ultrapassa o estoque conhecido", () => {
  const r = addItem(emptyCart(), line("v1", 2), 5);
  assert.equal(r.state.items[0].quantity, 2);
  assert.equal(r.limited, true);
  const r2 = addItem(r.state, line("v1", 2), 1);
  assert.equal(r2.added, 0);
  assert.equal(r2.state.items[0].quantity, 2);
  assert.equal(setQuantity(r2.state, "v1", 99).items[0].quantity, 2);
});

test("limite de 20 por variante (igual ao servidor) mesmo com estoque maior", () => {
  const r = addItem(emptyCart(), line("v1", 100), 50);
  assert.equal(r.state.items[0].quantity, MAX_QTY_PER_VARIANT);
});

test("variante esgotada ou quantidade inválida não entra no carrinho", () => {
  assert.equal(addItem(emptyCart(), line("v1", 0), 1).state.items.length, 0);
  for (const q of [0, -1, 1.5 - 1.5, NaN, "x"]) assert.equal(addItem(emptyCart(), line("v1"), q).state.items.length, 0);
});

test("setQuantity <= 0 remove; remove tira só a variante", () => {
  let s = addItem(addItem(emptyCart(), line("v1"), 1).state, line("v2"), 1).state;
  assert.equal(setQuantity(s, "v1", 0).items.length, 1);
  assert.deepEqual(removeItem(s, "v2").items.map((i) => i.variant_id), ["v1"]);
});

test("subtotal visual é calculado, mas o payload dos itens não leva preço", () => {
  let s = addItem(emptyCart(), line("v1", 5, { price_cents: 29900 }), 2).state;
  s = addItem(s, line("v2", 5, { price_cents: 15000 }), 1).state;
  assert.equal(subtotalCents(s), 2 * 29900 + 15000);
  const items = toOrderItems(s);
  assert.deepEqual(items, [{ variant_id: "v1", quantity: 2 }, { variant_id: "v2", quantity: 1 }]);
  assert.ok(!JSON.stringify(items).includes("price"));
});

test("reconcile remove indisponíveis/esgotados, reduz ao estoque e atualiza referência", () => {
  let s = emptyCart();
  for (const id of ["a", "b", "c", "d"]) s = addItem(s, line(id, 10), 4).state;
  const known = new Map([
    ["a", { product_id: "p1", stock: 10, ref: { ...line("a").ref, price_cents: 25000 } }],
    ["b", { product_id: "p1", stock: 0, ref: line("b").ref }],
    ["c", { product_id: "p1", stock: 2, ref: line("c").ref }],
  ]);
  const { state, changes } = reconcile(s, known);
  assert.deepEqual(state.items.map((i) => [i.variant_id, i.quantity]), [["a", 4], ["c", 2]]);
  assert.equal(state.items[0].ref.price_cents, 25000);
  assert.deepEqual(changes.map((c) => c.type).sort(), ["reduced", "soldout", "unavailable"]);
});

test("persistência: namespaced, recarrega e ignora dado corrompido", () => {
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  const store = createCartStore(storage);
  store.add(line("v1"), 2);
  assert.ok([...mem.keys()][0].startsWith("francine-furini-store:"));
  assert.equal(createCartStore(storage).get().items[0].quantity, 2);
  mem.set([...mem.keys()][0], "{lixo");
  assert.deepEqual(createCartStore(storage).get(), emptyCart());
  assert.deepEqual(parseStored(JSON.stringify({ items: [{ variant_id: "x", quantity: 999, stock: 3 }, { variant_id: 1 }, null] })).items.map((i) => i.quantity), [3]);
});

test("storage indisponível não quebra o carrinho", () => {
  const bad = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  const store = createCartStore(bad);
  store.add(line("v1"), 1);
  assert.equal(store.get().items.length, 1);
});
