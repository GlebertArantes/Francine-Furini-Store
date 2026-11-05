// Regressão: a renovação de sessão não pode derrubar a Fran por falha transitória do Auth
// nem por usar um refresh_token já trocado por outra aba (o token é de uso único).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createAuth, SESSION_KEY } from "../../admin/js/lib/auth.js";

const URL_ = "https://abc.supabase.co", KEY = "sb_publishable_x";
const mem = () => { const m = new Map(); return { m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }; };
const J = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
const sess = (n, expires_at) => ({ access_token: `at${n}`, refresh_token: `rt${n}`, expires_at, user: { id: "u1", email: "f@x.com" } });

test("renovação com 429/5xx NÃO apaga a sessão (falha transitória)", async () => {
  for (const status of [429, 500, 503]) {
    const storage = mem(); storage.setItem(SESSION_KEY, JSON.stringify(sess(1, 1000)));
    const auth = createAuth({ url: URL_, key: KEY, fetchFn: async () => J({ msg: "x" }, status), storage, now: () => 990 });
    assert.equal(await auth.refresh(), false);
    assert.ok(auth.session, `sessão mantida com ${status}`);
    assert.ok(storage.getItem(SESSION_KEY), `storage mantido com ${status}`);
    assert.equal(await auth.getAccessToken(), "at1", "token ainda válido continua utilizável");
  }
});

test("refresh_token recusado de verdade (400/401) encerra a sessão", async () => {
  for (const status of [400, 401]) {
    const storage = mem(); storage.setItem(SESSION_KEY, JSON.stringify(sess(1, 1000)));
    const auth = createAuth({ url: URL_, key: KEY, fetchFn: async () => J({ error: "invalid_grant" }, status), storage, now: () => 990 });
    assert.equal(await auth.refresh(), false);
    assert.equal(auth.session, null); assert.equal(storage.getItem(SESSION_KEY), null);
  }
});

test("outra aba já renovou: adota a sessão nova em vez de reutilizar o refresh_token antigo", async () => {
  const storage = mem(); storage.setItem(SESSION_KEY, JSON.stringify(sess(1, 1000)));
  const calls = [];
  const auth = createAuth({ url: URL_, key: KEY, fetchFn: async (u, i) => { calls.push(JSON.parse(i.body)); return J({}, 400); }, storage, now: () => 990 });
  // a outra aba renova e grava a sessão nova no storage compartilhado
  storage.setItem(SESSION_KEY, JSON.stringify(sess(2, 4600)));
  assert.equal(await auth.getAccessToken(), "at2");
  assert.equal(calls.length, 0, "não chamou o Auth com o refresh_token antigo");
  assert.equal(auth.session.refresh_token, "rt2");
});

test("falha de renovação com sessão mais nova no storage: adota e não apaga", async () => {
  const storage = mem(); storage.setItem(SESSION_KEY, JSON.stringify(sess(1, 1000)));
  const auth = createAuth({ url: URL_, key: KEY, fetchFn: async () => { storage.setItem(SESSION_KEY, JSON.stringify(sess(2, 4600))); return J({ error: "invalid_grant" }, 400); }, storage, now: () => 990 });
  assert.equal(await auth.refresh(), true);
  assert.equal(auth.session.refresh_token, "rt2"); assert.ok(storage.getItem(SESSION_KEY));
});

test("logout em outra aba (storage vazio) não ressuscita a sessão", async () => {
  const storage = mem(); storage.setItem(SESSION_KEY, JSON.stringify(sess(1, 1000)));
  const auth = createAuth({ url: URL_, key: KEY, fetchFn: async () => J({ error: "invalid_grant" }, 400), storage, now: () => 990 });
  storage.removeItem(SESSION_KEY);
  assert.equal(await auth.refresh(), false); assert.equal(auth.session, null);
});
