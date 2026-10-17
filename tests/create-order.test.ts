import { test } from "node:test";
import assert from "node:assert/strict";
import { validateOrderInput } from "../supabase/functions/create-order/validate.ts";
import { createHandler, memoryRateLimiter } from "../supabase/functions/create-order/handler.ts";

const V1 = "20000000-0000-0000-0000-000000000001";
const customer = { name: " Maria  Silva ", phone: "+55 (34) 99999-1234", postal_code: "38000-000", address_line: "Rua A", address_number: "10", neighborhood: "Centro", city: "Uberaba", state: "mg" };
const good = () => ({ customer: { ...customer }, items: [{ variant_id: V1, quantity: 2 }] });

test("normaliza telefone, CEP, UF e nome", () => {
  const r = validateOrderInput(good());
  assert.ok(r.ok);
  assert.equal(r.value.customer.phone, "34999991234");
  assert.equal(r.value.customer.postal_code, "38000000");
  assert.equal(r.value.customer.state, "MG");
  assert.equal(r.value.customer.name, "Maria Silva");
});

test("preço/nome do navegador são descartados", () => {
  const b = good() as any;
  b.items[0].price_cents = 1; b.items[0].unit_price_cents = 1; b.items[0].name = "Hack"; b.total = 1;
  const r = validateOrderInput(b);
  assert.ok(r.ok);
  assert.deepEqual(r.value.items, [{ variant_id: V1, quantity: 2 }]);
});

test("rejeita carrinho vazio, grande demais e quantidades inválidas", () => {
  for (const items of [[], Array.from({ length: 31 }, () => ({ variant_id: V1, quantity: 1 })),
    [{ variant_id: V1, quantity: 0 }], [{ variant_id: V1, quantity: -1 }], [{ variant_id: V1, quantity: 1.5 }],
    [{ variant_id: V1, quantity: "2" }], [{ variant_id: V1, quantity: 21 }], [{ variant_id: "abc", quantity: 1 }],
    [{ variant_id: V1, quantity: 15 }, { variant_id: V1, quantity: 15 }]]) {
    const r = validateOrderInput({ ...good(), items });
    assert.equal(r.ok, false, JSON.stringify(items).slice(0, 60));
  }
});

test("rejeita cliente inválida", () => {
  for (const patch of [{ phone: "123" }, { postal_code: "123" }, { state: "XX" }, { name: "A" }, { address_line: "" }, { city: "" }]) {
    const b = good(); Object.assign(b.customer, patch);
    assert.equal(validateOrderInput(b).ok, false, JSON.stringify(patch));
  }
  assert.equal(validateOrderInput(null).ok, false);
  assert.equal(validateOrderInput([]).ok, false);
});

test("mescla variantes repetidas", () => {
  const b = good(); b.items = [{ variant_id: V1, quantity: 2 }, { variant_id: V1.toUpperCase(), quantity: 3 }];
  const r = validateOrderInput(b);
  assert.ok(r.ok);
  assert.deepEqual(r.value.items, [{ variant_id: V1, quantity: 5 }]);
});

const mk = (rpc: (url: string, init: any) => Response, opts: Partial<Parameters<typeof createHandler>[0]> = {}) => {
  const calls: any[] = [];
  const handler = createHandler({
    supabaseUrl: "https://example.supabase.co", serviceRoleKey: "TEST-KEY-NOT-REAL",
    allowedOrigins: ["https://loja.example"], rateLimit: () => true,
    fetch: (async (url: string, init: any) => { calls.push({ url, init }); return rpc(url, init); }) as any, ...opts,
  });
  return { handler, calls };
};
const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("https://fn/create-order", { method: "POST", headers: { origin: "https://loja.example", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });

test("handler: sucesso retorna só order_id/display_code/status e não repassa preço do cliente", async () => {
  const { handler, calls } = mk(() => Response.json({ order_id: "o1", display_code: "FF-151026-001", status: "pending_shipping", customer_phone: "vazou" }));
  const b: any = good(); b.items[0].price_cents = 1;
  const res = await handler(post(b));
  assert.equal(res.status, 201);
  assert.deepEqual(await res.json(), { order_id: "o1", display_code: "FF-151026-001", status: "pending_shipping" });
  assert.equal(res.headers.get("access-control-allow-origin"), "https://loja.example");
  const sent = JSON.parse(calls[0].init.body);
  assert.deepEqual(sent.p_items, [{ variant_id: V1, quantity: 2 }]);
  assert.ok(calls[0].url.endsWith("/rest/v1/rpc/create_order_request"));
});

test("handler: payload inválido nem chega ao banco", async () => {
  const { handler, calls } = mk(() => Response.json({}));
  assert.equal((await handler(post({ ...good(), items: [] }))).status, 400);
  assert.equal((await handler(post("{nao-json"))).status, 400);
  assert.equal((await handler(post("x".repeat(20000)))).status, 413);
  assert.equal(calls.length, 0);
});

test("handler: origin não autorizado e método errado", async () => {
  const { handler, calls } = mk(() => Response.json({}));
  assert.equal((await handler(post(good(), { origin: "https://evil.example" }))).status, 403);
  assert.equal((await handler(new Request("https://fn/x", { method: "GET" }))).status, 405);
  assert.equal(calls.length, 0);
});

test("handler: mapeia erros da RPC sem vazar detalhes", async () => {
  for (const [msg, status, code] of [["insufficient_stock", 409, "insufficient_stock"], ["variant_unavailable", 409, "variant_unavailable"], ["rate_limited", 429, "rate_limited"], ["boom: select secret", 500, "internal_error"]] as const) {
    const { handler } = mk(() => Response.json({ message: msg, details: "interno" }, { status: 400 }));
    const res = await handler(post(good()));
    assert.equal(res.status, status);
    assert.deepEqual(await res.json(), { error: code });
  }
});

test("handler: rate limit por IP", async () => {
  const { handler, calls } = mk(() => Response.json({ order_id: "o", display_code: "c", status: "s" }), { rateLimit: memoryRateLimiter(2, 60000) });
  const s = [];
  for (let i = 0; i < 3; i++) s.push((await handler(post(good(), { "cf-connecting-ip": "1.2.3.4" }))).status);
  assert.deepEqual(s, [201, 201, 429]);
  assert.equal(calls.length, 2);
});

// ---- CORS de produção (domínio oficial + pages.dev) ---------------------------------------------
import { parseAllowedOrigins } from "../supabase/functions/create-order/handler.ts";

const OFFICIAL = "https://francinefurinistore.com.br";
const PAGES = "https://francine-furini-store.pages.dev";
const PROD_ENV = `${OFFICIAL},${PAGES}`;
const prodHandler = () => {
  const calls: any[] = [];
  const handler = createHandler({
    supabaseUrl: "https://example.supabase.co", serviceRoleKey: "TEST-KEY-NOT-REAL",
    allowedOrigins: parseAllowedOrigins(PROD_ENV).origins, rateLimit: () => true,
    fetch: (async (url: string, init: any) => { calls.push({ url, init }); return Response.json({ order_id: "o", display_code: "FF-171026-001", status: "pending_shipping" }); }) as any,
  });
  return { handler, calls };
};
const fromOrigin = (origin: string, method = "POST") =>
  new Request("https://fn/create-order", { method, headers: { origin, "content-type": "application/json" }, body: method === "POST" ? JSON.stringify(good()) : undefined });

test("CORS produção: domínio oficial e pages.dev são autorizados (POST e preflight)", async () => {
  for (const origin of [OFFICIAL, PAGES]) {
    const { handler } = prodHandler();
    const res = await handler(fromOrigin(origin));
    assert.equal(res.status, 201, origin);
    assert.equal(res.headers.get("access-control-allow-origin"), origin);
    const pre = await handler(fromOrigin(origin, "OPTIONS"));
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get("access-control-allow-origin"), origin);
    assert.match(pre.headers.get("access-control-allow-methods") ?? "", /POST/);
  }
});

test("CORS produção: origens não autorizadas são recusadas, sem curinga e sem chegar ao banco", async () => {
  const bad = ["https://evil.example", "http://francinefurinistore.com.br", "https://www.francinefurinistore.com.br",
    "https://francinefurinistore.com.br.evil.com", "https://evilfrancinefurinistore.com.br", "https://francine-furini-admin.pages.dev",
    "https://francinefurinistore.com.br:8443", "null", "https://FRANCINEFURINISTORE.COM.BR.evil.com"];
  for (const origin of bad) {
    const { handler, calls } = prodHandler();
    const res = await handler(fromOrigin(origin));
    assert.equal(res.status, 403, origin);
    assert.equal(res.headers.get("access-control-allow-origin"), null, origin);
    const pre = await handler(fromOrigin(origin, "OPTIONS"));
    assert.equal(pre.headers.get("access-control-allow-origin"), null, `preflight ${origin}`);
    assert.equal(calls.length, 0, `nada enviado ao banco para ${origin}`);
  }
});

test("CORS: Access-Control-Allow-Origin nunca é '*' e o admin não é origem autorizada do checkout", async () => {
  const { handler } = prodHandler();
  for (const origin of [OFFICIAL, PAGES, "https://evil.example"]) {
    const res = await handler(fromOrigin(origin));
    assert.notEqual(res.headers.get("access-control-allow-origin"), "*");
    assert.equal(res.headers.get("vary"), "Origin");
  }
});

test("parseAllowedOrigins: valor de produção, normalização e rejeição de curingas/entradas inseguras", () => {
  assert.deepEqual(parseAllowedOrigins(PROD_ENV), { origins: [OFFICIAL, PAGES], rejected: 0 });
  assert.deepEqual(parseAllowedOrigins(` ${OFFICIAL} , ${PAGES},,`).origins, [OFFICIAL, PAGES]); // espaços e vírgulas sobrando
  assert.deepEqual(parseAllowedOrigins(`${OFFICIAL},${OFFICIAL}`).origins, [OFFICIAL]);
  const r = parseAllowedOrigins(`*,https://*.pages.dev,${OFFICIAL}/,http://francinefurinistore.com.br,https://x.com/caminho,javascript:alert(1),${OFFICIAL}`);
  assert.deepEqual(r.origins, [OFFICIAL]);
  assert.equal(r.rejected, 6);
  assert.deepEqual(parseAllowedOrigins(undefined), { origins: [], rejected: 0 });
  assert.deepEqual(parseAllowedOrigins("").origins, []);
  // desenvolvimento local só entra se listado explicitamente
  assert.deepEqual(parseAllowedOrigins("http://localhost:5173").origins, ["http://localhost:5173"]);
  assert.deepEqual(parseAllowedOrigins("http://localhost").origins, []);
});

test("CORS: sem ALLOWED_ORIGINS nenhuma origem de navegador é aceita", async () => {
  const handler = createHandler({ supabaseUrl: "https://x.supabase.co", serviceRoleKey: "k", allowedOrigins: parseAllowedOrigins("").origins, rateLimit: () => true, fetch: (async () => Response.json({})) as any });
  assert.equal((await handler(fromOrigin(OFFICIAL))).status, 403);
});
