import { test } from "node:test";
import assert from "node:assert/strict";
import { createAuth, SESSION_KEY } from "../../admin/js/lib/auth.js";
import { createAdminApi } from "../../admin/js/lib/api.js";
import { resolveAdminConfig, isSecretKey } from "../../admin/js/lib/config.js";
import { buildConfig } from "../../scripts/storefront-config.mjs";

const URL_ = "https://abc.supabase.co";
const KEY = "sb_publishable_x";
const mem = () => { const m = new Map(); return { m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }; };
const tokenBody = (n = 1, expiresIn = 3600) => ({ access_token: `at${n}`, refresh_token: `rt${n}`, expires_in: expiresIn, user: { id: "u1", email: "f@x.com", user_metadata: { role: "admin" } } });
const J = (b, status = 200, headers = {}) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json", ...headers } });

function setup(handler) {
  const calls = [];
  const fetchFn = async (url, init = {}) => { calls.push({ url, init, body: init.body && typeof init.body === "string" ? JSON.parse(init.body) : init.body }); return handler(url, init, calls); };
  const storage = mem();
  const auth = createAuth({ url: URL_, key: KEY, fetchFn, storage });
  const api = createAdminApi({ url: URL_, key: KEY, auth, fetchFn });
  return { calls, auth, api, storage };
}

test("config: recusa service_role / sb_secret no frontend (runtime e geração)", () => {
  const jwt = (role) => `h.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.s`;
  assert.ok(isSecretKey("sb_secret_abc") && isSecretKey(jwt("service_role")) && !isSecretKey(jwt("anon")) && !isSecretKey(KEY));
  assert.throws(() => resolveAdminConfig({ supabaseUrl: URL_, supabasePublishableKey: "sb_secret_abc" }), /secret_key_refused/);
  assert.throws(() => resolveAdminConfig({ supabaseUrl: URL_, supabasePublishableKey: jwt("service_role") }), /secret_key_refused/);
  assert.throws(() => resolveAdminConfig({}), /config_missing/);
  assert.throws(() => resolveAdminConfig({ supabaseUrl: "http://x", supabasePublishableKey: KEY }), /config_missing/);
  assert.deepEqual(resolveAdminConfig({ supabaseUrl: `${URL_}/`, supabasePublishableKey: KEY }), { supabaseUrl: URL_, key: KEY });
  assert.throws(() => buildConfig({ SUPABASE_URL: URL_, SUPABASE_PUBLISHABLE_KEY: jwt("service_role") }), /recusada/);
});

test("login: guarda só tokens/id/e-mail — nunca a senha nem user_metadata", async () => {
  const { auth, storage, calls } = setup(() => J(tokenBody()));
  await auth.signIn("f@x.com", "SenhaSecreta!");
  const stored = storage.m.get(SESSION_KEY);
  assert.ok(!stored.includes("SenhaSecreta") && !stored.includes("user_metadata"));
  assert.deepEqual(Object.keys(JSON.parse(stored)).sort(), ["access_token", "expires_at", "refresh_token", "user"]);
  assert.ok(calls[0].url.endsWith("/auth/v1/token?grant_type=password"));
  assert.equal(calls[0].init.headers.apikey, KEY);
});

test("login: credenciais inválidas e erros são traduzidos sem vazar detalhes", async () => {
  for (const [status, code] of [[400, "invalid_credentials"], [429, "rate_limited"], [503, "generic"]]) {
    const { auth } = setup(() => J({ error: "x" }, status));
    await assert.rejects(auth.signIn("a@b.c", "p"), (e) => e.code === code);
  }
  const { auth } = setup(() => { throw new TypeError("net"); });
  await assert.rejects(auth.signIn("a@b.c", "p"), (e) => e.code === "network");
});

test("não admin não entra: is_admin=false => acesso negado e dá para sair (sessão limpa)", async () => {
  const { auth, api, storage, calls } = setup((url) => url.includes("/rpc/is_admin") ? J(false) : J(tokenBody()));
  await auth.signIn("cliente@x.com", "pw");
  assert.equal(await api.isAdmin(), false);
  assert.deepEqual(calls.at(-1).body, {});
  await auth.signOut();
  assert.equal(storage.m.has(SESSION_KEY), false);
  assert.ok(calls.at(-1).url.endsWith("/auth/v1/logout"));
  assert.equal(auth.session, null);
});

test("admin: is_admin=true; usa bearer do usuário e a chave publishable (nunca service_role)", async () => {
  const { auth, api, calls } = setup((url) => url.includes("/rpc/is_admin") ? J(true) : J(tokenBody()));
  await auth.signIn("f@x.com", "pw");
  assert.equal(await api.isAdmin(), true);
  const h = calls.at(-1).init.headers;
  assert.equal(h.authorization, "Bearer at1");
  assert.equal(h.apikey, KEY);
});

test("sessão inválida/expirada volta ao login: 401 + refresh falho limpa a sessão", async () => {
  let n = 0;
  const { auth, api, storage } = setup((url) => url.includes("grant_type=password") ? J(tokenBody()) : url.includes("grant_type=refresh_token") ? J({ error: "bad" }, 400) : (n++, J({ message: "JWT expired" }, 401)));
  await auth.signIn("f@x.com", "pw");
  await assert.rejects(api.dashboard(), (e) => e.code === "session_expired");
  assert.equal(auth.session, null);
  assert.equal(storage.m.has(SESSION_KEY), false);
  await assert.rejects(api.listOrders(), (e) => e.code === "session_expired"); // sem sessão: nem chama a API
});

test("401 com refresh válido renova e repete a requisição uma vez", async () => {
  let rest = 0;
  const { auth, api, calls } = setup((url, init) => {
    if (url.includes("grant_type=password")) return J(tokenBody(1));
    if (url.includes("grant_type=refresh_token")) return J(tokenBody(2));
    rest++; return init.headers.authorization === "Bearer at1" ? J({ message: "expired" }, 401) : J([{ id: "o1" }]);
  });
  await auth.signIn("f@x.com", "pw");
  assert.deepEqual(await api.listOrders(), [{ id: "o1" }]);
  assert.equal(rest, 2);
  assert.equal(auth.session.access_token, "at2");
  assert.equal(calls.filter((c) => c.url.includes("refresh_token")).length, 1);
});

test("token perto de expirar é renovado antes da chamada; refreshes concorrentes são um só", async () => {
  let refreshes = 0;
  const { auth, api } = setup((url) => url.includes("grant_type=password") ? J(tokenBody(1, 10)) : url.includes("grant_type=refresh_token") ? (refreshes++, J(tokenBody(2))) : J([]));
  await auth.signIn("f@x.com", "pw");
  await Promise.all([api.listOrders(), api.listOrders(), api.listCategories()]);
  assert.equal(refreshes, 1);
});

test("sessão restaurada do storage; storage corrompido é ignorado", () => {
  const storage = mem();
  storage.setItem(SESSION_KEY, JSON.stringify({ access_token: "a", refresh_token: "r", expires_at: 9999999999, user: { id: "u", email: "e" } }));
  assert.equal(createAuth({ url: URL_, key: KEY, fetchFn: async () => J({}), storage }).session.access_token, "a");
  storage.setItem(SESSION_KEY, "{lixo");
  assert.equal(createAuth({ url: URL_, key: KEY, fetchFn: async () => J({}), storage }).session, null);
});
