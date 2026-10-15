import { test } from "node:test";
import assert from "node:assert/strict";
import { validateCustomer, buildOrderPayload, postOrder, singleFlight, createOrderPlacer, errorMessage, needsCartRefresh, whatsappUrl, ERROR_MESSAGES } from "../../storefront/js/lib/checkout.js";
import { createCartStore } from "../../storefront/js/lib/cart.js";

const raw = { name: " Maria  Silva ", phone: "+55 (34) 99999-1234", postal_code: "38000-000", address_line: "Rua A", address_number: "10", address_complement: "", neighborhood: "Centro", city: "Uberaba", state: "mg", note: "" };
const mkStore = () => {
  const store = createCartStore(null);
  store.add({ variant_id: "v1", product_id: "p1", stock: 5, ref: { name: "Vestido", slug: "v", color: "Nude", size: "M", price_cents: 29900, image: null } }, 2);
  return store;
};

test("validação cliente normaliza e aponta campos inválidos", () => {
  const ok = validateCustomer(raw);
  assert.ok(ok.ok);
  assert.equal(ok.value.phone, "34999991234");
  assert.equal(ok.value.postal_code, "38000000");
  assert.equal(ok.value.state, "MG");
  const bad = validateCustomer({ ...raw, name: "", phone: "123", postal_code: "1", state: "XX", city: "" });
  assert.deepEqual(Object.keys(bad.errors).sort(), ["city", "name", "phone", "postal_code", "state"]);
});

test("payload do create-order tem só os campos esperados e nenhum preço", () => {
  const store = mkStore();
  const p = buildOrderPayload(validateCustomer(raw).value, store.get());
  assert.deepEqual(Object.keys(p).sort(), ["customer", "items"]);
  assert.deepEqual(Object.keys(p.customer).sort(), ["address_line", "address_number", "city", "name", "neighborhood", "phone", "postal_code", "state"]);
  assert.deepEqual(p.items, [{ variant_id: "v1", quantity: 2 }]);
  assert.ok(!/price|total|subtotal|nome|Vestido|29900/i.test(JSON.stringify(p.items)));
  const withOpt = buildOrderPayload(validateCustomer({ ...raw, address_complement: "Ap 2", note: "Obrigada" }).value, store.get());
  assert.equal(withOpt.customer.address_complement, "Ap 2");
  assert.equal(withOpt.customer.note, "Obrigada");
});

test("single-flight: clique/retry durante envio não dispara segunda submissão", async () => {
  let calls = 0, release;
  const gate = new Promise((r) => (release = r));
  const fn = singleFlight(async () => { calls++; await gate; return "done"; });
  const first = fn();
  assert.equal(fn.isPending(), true);
  assert.deepEqual(await fn(), { skipped: true });
  assert.deepEqual(await fn(), { skipped: true });
  release();
  assert.equal(await first, "done");
  assert.equal(calls, 1);
  await fn(); // liberado após terminar
  assert.equal(calls, 2);
});

test("placer: submissões simultâneas enviam uma única requisição", async () => {
  const store = mkStore();
  let sends = 0;
  const place = createOrderPlacer({ cartStore: store, send: async () => { sends++; await new Promise((r) => setTimeout(r, 10)); return { ok: true, order: { display_code: "FF-151026-001" } }; } });
  const results = await Promise.all([place(raw), place(raw), place(raw)]);
  assert.equal(sends, 1);
  assert.equal(results.filter((r) => r.skipped).length, 2);
});

test("sucesso limpa o carrinho; erro mantém", async () => {
  const store = mkStore();
  const fail = createOrderPlacer({ cartStore: store, send: async () => ({ ok: false, code: "rate_limited", message: "x" }) });
  assert.equal((await fail(raw)).ok, false);
  assert.equal(store.get().items.length, 1);
  const success = createOrderPlacer({ cartStore: store, send: async () => ({ ok: true, order: { display_code: "FF-151026-001" } }) });
  assert.equal((await success(raw)).ok, true);
  assert.equal(store.get().items.length, 0);
});

test("dados inválidos ou carrinho vazio nem chegam ao envio", async () => {
  let sends = 0;
  const send = async () => { sends++; return { ok: true, order: {} }; };
  assert.equal((await createOrderPlacer({ cartStore: mkStore(), send })({ ...raw, name: "" })).code, "validation");
  assert.equal((await createOrderPlacer({ cartStore: createCartStore(null), send })(raw)).code, "empty_cart");
  assert.equal(sends, 0);
});

test("postOrder: sucesso, erros conhecidos, erro genérico e falha de rede", async () => {
  const res = (status, body) => async () => new Response(JSON.stringify(body), { status });
  const args = (fetchFn) => ({ fetchFn, url: "https://x/functions/v1/create-order", payload: {} });
  const ok = await postOrder(args(res(201, { order_id: "o", display_code: "FF-151026-001", status: "pending_shipping" })));
  assert.deepEqual(ok, { ok: true, order: { order_id: "o", display_code: "FF-151026-001", status: "pending_shipping" } });
  for (const [status, code] of [[409, "insufficient_stock"], [409, "variant_unavailable"], [429, "rate_limited"], [400, "invalid_items"]]) {
    const r = await postOrder(args(res(status, { error: code })));
    assert.equal(r.ok, false); assert.equal(r.code, code); assert.equal(r.message, ERROR_MESSAGES[code]);
  }
  assert.equal((await postOrder(args(res(500, { error: "internal_error" })))).code, "generic");
  assert.equal((await postOrder(args(async () => new Response("<html>", { status: 502 })))).code, "generic");
  assert.equal((await postOrder(args(async () => { throw new TypeError("fail"); }))).code, "network");
});

test("mensagens de erro adequadas e refresh de carrinho nos casos de estoque", () => {
  assert.match(errorMessage("insufficient_stock"), /quantidade/i);
  assert.match(errorMessage("variant_unavailable"), /disponível/i);
  assert.match(errorMessage("rate_limited"), /aguarde/i);
  assert.match(errorMessage("qualquer-coisa"), /tente novamente/i);
  assert.ok(needsCartRefresh("insufficient_stock") && needsCartRefresh("variant_unavailable") && !needsCartRefresh("rate_limited"));
});

test("WhatsApp: usa número das configurações e só leva o código do pedido (sem PII)", () => {
  const url = whatsappUrl("+55 (31) 99565-2798", "FF-151026-001");
  assert.ok(url.startsWith("https://wa.me/5531995652798?text="));
  const text = decodeURIComponent(url.split("text=")[1]);
  assert.match(text, /FF-151026-001/);
  assert.ok(!/Maria|38000|Rua|99999/.test(text));
  assert.equal(whatsappUrl("", "FF-1"), null);
});
