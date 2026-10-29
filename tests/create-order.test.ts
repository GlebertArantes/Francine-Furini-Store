import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
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

// ---- Auditoria final: robustez, payload adulterado e vazamento ---------------------------------
test("payload adulterado: campos extras (status, total, código, preço) nunca chegam ao banco", async () => {
  const { handler, calls } = mk(() => Response.json({ order_id: "o", display_code: "FF-181026-001", status: "pending_shipping" }));
  const b: any = good();
  Object.assign(b, { status: "completed", subtotal_cents: 1, display_code: "FF-010100-001", shipping_cents: 0, __proto__: { admin: true } });
  Object.assign(b.customer, { status: "completed", is_admin: true, id: "x", created_at: "2000-01-01" });
  b.items[0] = { ...b.items[0], price_cents: 1, unit_price_cents: 1, line_total_cents: 1, product_id: "outro", name: "Hack" };
  const res = await handler(post(b));
  assert.equal(res.status, 201);
  const sent = JSON.parse(calls[0].init.body);
  assert.deepEqual(Object.keys(sent).sort(), ["p_customer", "p_items"]);
  assert.deepEqual(Object.keys(sent.p_customer).sort(), ["address_line", "address_number", "city", "name", "neighborhood", "phone", "postal_code", "state"]);
  assert.deepEqual(sent.p_items, [{ variant_id: V1, quantity: 2 }]);
});

test("texto do cliente: caracteres de controle removidos, tamanhos limitados, HTML tratado só como texto", () => {
  const r = validateOrderInput({ ...good(), customer: { ...good().customer, name: "Ma\u0000ria\n\tSilva", note: "x".repeat(900), address_complement: "<img src=x onerror=alert(1)>" } });
  assert.ok(r.ok);
  assert.equal(r.value.customer.name, "Ma ria Silva");
  assert.equal(r.value.customer.note!.length, 500);
  assert.equal(r.value.customer.address_complement, "<img src=x onerror=alert(1)>"); // armazenado como texto; a interface usa textContent
});

test("corpo acima de 16 KB é recusado por BYTES (multibyte) e pelo Content-Length, sem ler o banco", async () => {
  const { handler, calls } = mk(() => Response.json({}));
  const multibyte = JSON.stringify({ ...good(), customer: { ...good().customer, note: "é".repeat(9000) } }); // ~18 KB em bytes, 9 mil caracteres
  assert.ok(multibyte.length < 16 * 1024 && new TextEncoder().encode(multibyte).length > 16 * 1024);
  assert.equal((await handler(post(multibyte))).status, 413);
  const declared = new Request("https://fn/x", { method: "POST", headers: { origin: "https://loja.example", "content-length": "999999" }, body: "{}" });
  assert.equal((await handler(declared)).status, 413);
  assert.equal(calls.length, 0);
});

test("banco indisponível ou resposta inesperada: JSON controlado com CORS, sem detalhes internos", async () => {
  const down = mk(() => { throw new TypeError("connect ECONNREFUSED 10.0.0.1:5432 secret-host"); });
  const r1 = await down.handler(post(good()));
  assert.equal(r1.status, 503);
  assert.deepEqual(await r1.json(), { error: "unavailable" });
  assert.equal(r1.headers.get("access-control-allow-origin"), "https://loja.example");
  const weird = mk(() => Response.json({ foo: "bar" }));
  const r2 = await weird.handler(post(good()));
  assert.equal(r2.status, 502);
  assert.deepEqual(await r2.json(), { error: "unavailable" });
});

test("erros nunca expõem mensagem/detalhe do banco; sucesso não devolve PII", async () => {
  const leaky = mk(() => Response.json({ message: "duplicate key value violates unique constraint orders_pkey", details: "Key (customer_phone)=(34999991234)", hint: "x" }, { status: 400 }));
  const res = await leaky.handler(post(good()));
  const text = await res.text();
  assert.ok(!/duplicate|constraint|34999991234|orders_pkey/.test(text), text);
  const ok = mk(() => Response.json({ order_id: "o", display_code: "FF-181026-001", status: "pending_shipping", customer_phone: "34999991234", customer_name: "Maria" }));
  const t = await (await ok.handler(post(good()))).text();
  assert.ok(!/34999991234|Maria/.test(t));
});

test("Edge Function não registra payload, PII nem chaves em logs", () => {
  for (const f of ["handler.ts", "index.ts", "validate.ts"]) {
    const src = fs.readFileSync(new URL(`../supabase/functions/create-order/${f}`, import.meta.url), "utf8");
    assert.ok(!/console\.(log|info|debug|error)\(/.test(src), `${f}: sem console.log/error`);
    for (const m of src.matchAll(/console\.warn\(([^;]*)\);/g)) assert.ok(!/serviceRoleKey|SERVICE_ROLE|body|payload|customer|phone/i.test(m[1]), `${f}: warn sem dados sensíveis`);
  }
});

test("handler: ID persistente seleciona RPC idempotente e recuperação não retorna dados pessoais", async()=>{
 const id='80000000-0000-0000-0000-000000000001';
 const {handler,calls}=mk(()=>Response.json({order_id:'o',display_code:'FF-1',status:'pending_shipping',customer_phone:'private'}));
 assert.equal((await handler(post({...good(),request_id:id}))).status,201);
 assert.match(calls[0].url,/create_order_request_idempotent$/);assert.equal(JSON.parse(calls[0].init.body).p_request_id,id);
 const r=await handler(post({request_id:id,recover:true}));assert.match(calls[1].url,/recover_order_request$/);
 assert.deepEqual(await r.json(),{order_id:'o',display_code:'FF-1',status:'pending_shipping'});
 assert.equal((await handler(post({...good(),request_id:'bad'}))).status,400);
});
test("handler: erro JSON null, array ou texto mantém contrato JSON/CORS",async()=>{
 for(const body of [null,[],"erro"]){const {handler}=mk(()=>Response.json(body,{status:400}));const r=await handler(post(good()));assert.equal(r.status,500);assert.equal(r.headers.get('access-control-allow-origin'),'https://loja.example');assert.deepEqual(await r.json(),{error:'internal_error'});}
 const {handler}=mk(()=>Response.json(null));assert.equal((await handler(post({request_id:'80000000-0000-0000-0000-000000000001',recover:true}))).status,404);
});
