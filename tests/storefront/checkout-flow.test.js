// Homologação do fluxo de compra V1 com fixtures/mocks (nenhum pedido real, nenhuma rede, nenhuma escrita).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeProduct } from "../../storefront/js/lib/api.js";
import { colorsOf, sizesOfColor, cartLine, variantIndex, inStock, filterProducts } from "../../storefront/js/lib/catalog.js";
import { createCartStore, subtotalCents } from "../../storefront/js/lib/cart.js";
import { validateCustomer, buildOrderPayload, createOrderPlacer, postOrder, needsCartRefresh, whatsappOrderMessage, whatsappUrl, errorMessage } from "../../storefront/js/lib/checkout.js";
import { successView } from "../../storefront/js/views/success.js";
import { installFakeDom, findAll } from "../helpers/fake-dom.js";

const read = (f) => readFileSync(new URL(`../../${f}`, import.meta.url), "utf8");
const SETTINGS_NUMBER = "5531995652798"; // fixture: vem de store_settings.whatsapp_number

// 1. Produtos publicados (linhas no formato do PostgREST; a RLS já filtra inativos)
const rows = [
  { id: "p1", category_id: null, name: "Vestido Aurora", slug: "vestido-aurora", description: "d", fabric: "Seda", price_cents: 18990, compare_at_price_cents: 22990, featured: true, published_at: null,
    product_variants: [{ id: "v1", color: "Bege", size: "M", quantity: 2, active: true }, { id: "v2", color: "Bege", size: "G", quantity: 0, active: true }, { id: "v3", color: "Preto", size: "P", quantity: 5, active: true }],
    product_images: [{ storage_path: "p1/a.webp", alt_text: "", sort_order: 0 }] },
];
const products = rows.map(normalizeProduct);
const customerRaw = { name: "Maria Silva", phone: "(34) 99999-1234", postal_code: "38010-000", address_line: "Rua das Flores", address_number: "15", address_complement: "", neighborhood: "Centro", city: "Uberaba", state: "MG", note: "" };
const memStorage = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };
const fetchReturning = (status, body) => async () => ({ ok: status < 400, status, json: async () => body });

function filledCart() {
  const cart = createCartStore(memStorage());
  const p = products[0], v = p.variants[0];
  cart.add(cartLine(p, v, "https://x/a.webp"), 1);
  return cart;
}

test("1–4: catálogo → cor/tamanho/quantidade → carrinho → preço e disponibilidade", () => {
  assert.equal(filterProducts(products, {}).length, 1);
  const p = products[0];
  assert.deepEqual(colorsOf(p).map((c) => c.color), ["Bege", "Preto"]);
  assert.deepEqual(sizesOfColor(p, "Bege").map((s) => [s.size, inStock(s)]), [["M", true], ["G", false]]);
  const cart = createCartStore(memStorage());
  const r = cart.add(cartLine(p, p.variants[0], null), 5); // pede 5, estoque 2
  assert.equal(r.limited, true); assert.equal(cart.get().items[0].quantity, 2);
  assert.equal(subtotalCents(cart.get()), 2 * 18990, "preço atual, não o anterior");
  assert.equal(cart.add(cartLine(p, p.variants[1], null), 1).added, 0, "sem estoque não entra");
});

test("5–6: validação de endereço/CEP e dados obrigatórios", () => {
  assert.equal(validateCustomer(customerRaw).ok, true);
  const bad = validateCustomer({ ...customerRaw, postal_code: "3801", state: "", name: "", address_number: "", phone: "123" });
  for (const k of ["postal_code", "state", "name", "address_number", "phone"]) assert.ok(bad.errors[k], k);
  assert.equal(validateCustomer({ ...customerRaw, address_number: "S/N" }).ok, true);
});

test("7–8: registro simulado → código do pedido; carrinho limpo só no sucesso; payload sem preço", async () => {
  const cart = filledCart(); let sent;
  const place = createOrderPlacer({ cartStore: cart, send: (payload) => { sent = payload; return postOrder({ fetchFn: fetchReturning(201, { order_id: "o1", display_code: "FF-271026-001", status: "pending_shipping" }), url: "https://fn", payload }); } });
  const r = await place(customerRaw);
  assert.equal(r.ok, true); assert.equal(r.order.display_code, "FF-271026-001");
  assert.equal(cart.get().items.length, 0);
  assert.deepEqual(sent.items, [{ variant_id: "v1", quantity: 1 }]);
  assert.ok(!/price|total|name":"Vestido/i.test(JSON.stringify(sent.items)), "nenhum preço/nome de produto enviado");
});

test("9: link do WhatsApp usa o número de store_settings, com resumo completo, e nada abre sozinho", () => {
  const cart = filledCart();
  const items = cart.get().items.map((i) => ({ quantity: i.quantity, ref: i.ref }));
  const msg = whatsappOrderMessage("FF-271026-001", validateCustomer(customerRaw).value, items);
  for (const f of ["FF-271026-001", "Maria Silva", "Vestido Aurora", "Bege", "Tamanho: M", "Rua das Flores", "15", "Centro", "Uberaba/MG", "38010-000", "frete"]) assert.ok(msg.includes(f), f);
  const url = whatsappUrl(SETTINGS_NUMBER, "FF-271026-001", msg);
  assert.ok(url.startsWith(`https://wa.me/${SETTINGS_NUMBER}?text=`));
  assert.ok(url.includes(encodeURIComponent("FF-271026-001")));
  assert.equal(whatsappUrl(undefined, "FF-1", msg), null, "sem número em store_settings: sem link (nada fixo)");
  assert.notEqual(whatsappUrl("5534984258056", "FF-1", msg), url, "muda conforme store_settings");
  installFakeDom();
  const view = successView({ order: { display_code: "FF-271026-001", whatsapp_message: msg }, settings: { whatsapp_number: SETTINGS_NUMBER, store_name: "X" }, navigate() {} });
  const a = findAll(view, (e) => e.tag === "a" && /wa\.me/.test(e.getAttribute("href") ?? ""))[0];
  assert.ok(a, "botão para o WhatsApp existe"); assert.equal(a.getAttribute("rel"), "noopener noreferrer");
  const src = read("storefront/js/views/success.js") + read("storefront/js/views/checkout.js") + read("storefront/js/lib/checkout.js");
  assert.ok(!/window\.open|location\.(href|assign|replace)\s*=|\.click\(\)/.test(src), "nenhuma abertura automática do WhatsApp");
  assert.ok(!/5534984258056|5531995652798/.test(src), "número não é fixo no código");
});

for (const [label, status, body, code, refresh] of [
  ["estoque insuficiente", 409, { error: "insufficient_stock" }, "insufficient_stock", true],
  ["variante indisponível", 409, { error: "variant_unavailable" }, "variant_unavailable", true],
  ["limite de requisições", 429, { error: "rate_limited" }, "rate_limited", false],
  ["banco indisponível", 503, { error: "unavailable" }, "generic", false],
  ["erro interno", 500, { error: "internal_error" }, "generic", false],
]) {
  test(`10: falha — ${label}: carrinho preservado, mensagem controlada${refresh ? ", reconciliação pedida" : ""}`, async () => {
    const cart = filledCart();
    const place = createOrderPlacer({ cartStore: cart, send: (payload) => postOrder({ fetchFn: fetchReturning(status, body), url: "https://fn", payload }) });
    const r = await place(customerRaw);
    assert.equal(r.ok, false); assert.equal(r.code, code); assert.equal(needsCartRefresh(r.code), refresh);
    assert.equal(cart.get().items.length, 1, "carrinho preservado");
    assert.equal(r.message, errorMessage(code));
    assert.ok(!/stack|supabase|SQL|internal_error/i.test(r.message));
  });
}
test("10: falha de rede preserva o carrinho e orienta a conferir antes de reenviar", async () => {
  const cart = filledCart();
  const place = createOrderPlacer({ cartStore: cart, send: (payload) => postOrder({ fetchFn: async () => { throw new TypeError("offline"); }, url: "https://fn", payload }) });
  const r = await place(customerRaw);
  assert.equal(r.code, "network"); assert.match(r.message, /duplicado/); assert.equal(cart.get().items.length, 1);
});
test("estoque insuficiente: a reconciliação do catálogo atual ajusta/remove linhas", () => {
  const cart = filledCart();
  const fresh = products.map((p) => ({ ...p, variants: p.variants.map((v) => (v.id === "v1" ? { ...v, quantity: 0 } : v)) }));
  const changes = cart.reconcile(variantIndex(fresh));
  assert.ok(changes.length >= 1); assert.equal(cart.get().items.length, 0);
});
test("envio duplicado: cliques simultâneos geram uma única chamada ao backend", async () => {
  const cart = filledCart(); let calls = 0;
  const place = createOrderPlacer({ cartStore: cart, send: async () => { calls++; await new Promise((r) => setTimeout(r, 20)); return { ok: true, order: { order_id: "o", display_code: "FF-1", status: "pending_shipping" } }; } });
  const [a, b, c] = await Promise.all([place(customerRaw), place(customerRaw), place(customerRaw)]);
  assert.equal(calls, 1); assert.deepEqual([b.skipped, c.skipped], [true, true]); assert.equal(a.ok, true);
});
test("carrinho vazio e dados inválidos não chamam o backend", async () => {
  let calls = 0;
  const empty = createOrderPlacer({ cartStore: createCartStore(memStorage()), send: async () => { calls++; } });
  assert.equal((await empty(customerRaw)).code, "empty_cart");
  const place = createOrderPlacer({ cartStore: filledCart(), send: async () => { calls++; } });
  assert.equal((await place({ ...customerRaw, postal_code: "1" })).code, "validation");
  assert.equal(calls, 0);
  assert.deepEqual(Object.keys(buildOrderPayload(validateCustomer(customerRaw).value, filledCart().get())), ["customer", "items"]);
});
