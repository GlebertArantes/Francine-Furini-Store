import { test } from "node:test";
import assert from "node:assert/strict";
import { buildConfig } from "../../scripts/storefront-config.mjs";

const jwt = (role) => `h.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.s`;

test("gera config.js só com valores públicos", () => {
  const js = buildConfig({ SUPABASE_URL: "https://abc.supabase.co/", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x" });
  assert.match(js, /window\.FF_CONFIG = /);
  assert.match(js, /"supabaseUrl": "https:\/\/abc\.supabase\.co"/);
  assert.ok(!js.includes("createOrderUrl"));
  assert.match(buildConfig({ SUPABASE_URL: "https://abc.supabase.co", SUPABASE_PUBLISHABLE_KEY: jwt("anon"), CREATE_ORDER_URL: "https://x.test/fn" }), /createOrderUrl/);
});

test("recusa service_role, chave secreta e entradas inválidas", () => {
  const base = { SUPABASE_URL: "https://abc.supabase.co" };
  assert.throws(() => buildConfig({ ...base, SUPABASE_PUBLISHABLE_KEY: "sb_secret_abc" }), /recusada/);
  assert.throws(() => buildConfig({ ...base, SUPABASE_PUBLISHABLE_KEY: jwt("service_role") }), /recusada/);
  assert.throws(() => buildConfig({ ...base }), /PUBLISHABLE/);
  assert.throws(() => buildConfig({ SUPABASE_URL: "http://abc", SUPABASE_PUBLISHABLE_KEY: "k" }), /SUPABASE_URL/);
});
