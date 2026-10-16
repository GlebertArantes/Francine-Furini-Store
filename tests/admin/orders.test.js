import { test } from "node:test";
import assert from "node:assert/strict";
import { createAuth } from "../../admin/js/lib/auth.js";
import { createAdminApi, ApiError } from "../../admin/js/lib/api.js";
import { createOrderActions, availableActions, parseShipping, parseRpcError } from "../../admin/js/lib/orders.js";

const J = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
const OID = "30000000-0000-0000-0000-000000000001";

function setup(rpcHandler) {
  const calls = [];
  const fetchFn = async (url, init = {}) => {
    const body = typeof init.body === "string" ? JSON.parse(init.body) : init.body;
    calls.push({ url, method: init.method ?? "GET", body });
    if (url.includes("/auth/v1/token")) return J({ access_token: "at", refresh_token: "rt", expires_in: 3600, user: { id: "u", email: "e" } });
    const m = /\/rest\/v1\/rpc\/(\w+)/.exec(url);
    return rpcHandler(m?.[1], body);
  };
  const auth = createAuth({ url: "https://x.supabase.co", key: "sb_publishable_x", fetchFn, storage: null });
  const api = createAdminApi({ url: "https://x.supabase.co", key: "sb_publishable_x", auth, fetchFn });
  return { calls, auth, actions: createOrderActions(api.rpc), api };
}
const signedIn = async (s) => { await s.auth.signIn("a@b.c", "pw"); return s; };

test("concluir pedido chama a RPC admin_complete_order — e nunca UPDATE direto em orders", async () => {
  const s = await signedIn(setup((name) => J({ order_id: OID, status: "completed", already_done: false })));
  const r = await s.actions.complete(OID, "pago via pix");
  assert.equal(r.ok, true);
  const rest = s.calls.filter((c) => c.url.includes("/rest/v1/"));
  assert.equal(rest.length, 1);
  assert.ok(rest[0].url.endsWith("/rest/v1/rpc/admin_complete_order"));
  assert.equal(rest[0].method, "POST");
  assert.deepEqual(rest[0].body, { p_order_id: OID, p_note: "pago via pix" });
  assert.equal(s.calls.some((c) => /rest\/v1\/orders/.test(c.url) && c.method !== "GET"), false);
});

test("cada ação usa exclusivamente a RPC correspondente", async () => {
  const s = await signedIn(setup(() => J({ status: "x" })));
  await s.actions.markContacted(OID); await s.actions.cancel(OID, " motivo "); await s.actions.setShipping(OID, "25,50"); await s.actions.complete(OID);
  const used = s.calls.filter((c) => c.url.includes("/rpc/")).map((c) => c.url.split("/rpc/")[1]);
  assert.deepEqual(used, ["admin_mark_order_contacted", "admin_cancel_order", "admin_set_order_shipping", "admin_complete_order"]);
  assert.deepEqual(s.calls.find((c) => c.url.endsWith("admin_set_order_shipping")).body, { p_order_id: OID, p_shipping_cents: 2550 });
  assert.equal(s.calls.find((c) => c.url.endsWith("admin_cancel_order")).body.p_note, "motivo");
  assert.ok(!s.calls.some((c) => ["PATCH", "PUT", "DELETE"].includes(c.method)));
});

test("informar frete aceita R$ 0,00 (envia 0 centavos) e rejeita valores inválidos", async () => {
  assert.deepEqual(parseShipping("0,00"), { ok: true, cents: 0 });
  assert.deepEqual(parseShipping("0"), { ok: true, cents: 0 });
  assert.equal(parseShipping("").ok, false);
  assert.equal(parseShipping("-1").ok, false);
  const s = await signedIn(setup(() => J({ shipping_cents: 0 })));
  assert.equal((await s.actions.setShipping(OID, "0,00")).ok, true);
  assert.equal(s.calls.find((c) => c.url.endsWith("admin_set_order_shipping")).body.p_shipping_cents, 0);
  const calls = s.calls.length;
  const bad = await s.actions.setShipping(OID, "abc");
  assert.equal(bad.ok, false); assert.equal(bad.code, "invalid_shipping");
  assert.equal(s.calls.length, calls); // inválido nem chega ao backend
});

test("erro de estoque na conclusão é exibido, sem estado falso de sucesso", async () => {
  const detail = JSON.stringify([{ variant_id: "v1", product_name: "Vestido", requested: 2, available: 1 }]);
  const s = await signedIn(setup(() => J({ message: "insufficient_stock", details: detail, code: "P0001" }, 400)));
  const r = await s.actions.complete(OID);
  assert.equal(r.ok, false);
  assert.equal(r.code, "insufficient_stock");
  assert.match(r.message, /Nada foi alterado/);
  assert.deepEqual(r.shortages, [{ variant_id: "v1", product_name: "Vestido", requested: 2, available: 1 }]);
  assert.equal(r.result, undefined);
  assert.equal(r.alreadyDone, undefined);
});

test("mensagens para shipping_not_defined, transição inválida, sessão e rede", () => {
  assert.equal(parseRpcError({ message: "shipping_not_defined" }).code, "shipping_not_defined");
  assert.equal(parseRpcError({ message: "invalid_transition: completed -> cancelled" }).code, "invalid_transition");
  assert.equal(parseRpcError({ message: "forbidden" }).code, "forbidden");
  assert.equal(parseRpcError({ code: "session_expired", message: "session_expired" }).code, "session_expired");
  assert.equal(parseRpcError({ message: "boom" }).code, "generic");
});

test("clique duplo não dispara a RPC duas vezes; depois de terminar libera", async () => {
  let release; const gate = new Promise((r) => (release = r));
  const s = await signedIn(setup(async () => { await gate; return J({ status: "completed", already_done: false }); }));
  const first = s.actions.complete(OID);
  const second = await s.actions.complete(OID);
  const third = await s.actions.complete(OID);
  assert.deepEqual([second, third], [{ skipped: true }, { skipped: true }]);
  release(); await first;
  assert.equal(s.calls.filter((c) => c.url.endsWith("admin_complete_order")).length, 1);
  await s.actions.complete(OID); // retry legítimo depois: o backend garante idempotência
  assert.equal(s.calls.filter((c) => c.url.endsWith("admin_complete_order")).length, 2);
});

test("conclusão repetida: backend responde already_done e a UI sinaliza", async () => {
  const s = await signedIn(setup(() => J({ status: "completed", already_done: true })));
  const r = await s.actions.complete(OID);
  assert.equal(r.ok, true); assert.equal(r.alreadyDone, true);
});

test("ações disponíveis: concluir exige frete; concluído/cancelado não cancela nem conclui", () => {
  const o = (status, shipping = null) => ({ status, shipping_cents: shipping, final_total_cents: shipping == null ? null : 1000 + shipping });
  assert.deepEqual(availableActions(o("pending_shipping")), { setShipping: true, markContacted: true, complete: false, cancel: true });
  assert.equal(availableActions(o("pending_shipping", 0)).complete, true); // frete 0 vale
  assert.deepEqual(availableActions(o("contacted", 500)), { setShipping: true, markContacted: false, complete: true, cancel: true });
  assert.deepEqual(availableActions(o("completed", 0)), { setShipping: false, markContacted: false, complete: false, cancel: false });
  assert.deepEqual(availableActions(o("cancelled", 0)), { setShipping: false, markContacted: false, complete: false, cancel: false });
});
