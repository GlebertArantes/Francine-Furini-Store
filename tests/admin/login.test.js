import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveLoginIdentifier } from "../../admin/js/views/login.js";

test("login simples vira identificador técnico do Supabase", () => {
  assert.equal(resolveLoginIdentifier("Fran1010"), "fran1010@admin.francine-furini.local");
  assert.equal(resolveLoginIdentifier(" fran1010 "), "fran1010@admin.francine-furini.local");
});

test("e-mail técnico/legado continua aceito para acesso administrativo", () => {
  assert.equal(resolveLoginIdentifier("gleberteads@hotmail.com"), "gleberteads@hotmail.com");
});

test("login inválido é rejeitado antes de chamar o Auth", () => {
  assert.equal(resolveLoginIdentifier(""), "");
  assert.equal(resolveLoginIdentifier("ab"), "");
  assert.equal(resolveLoginIdentifier("fran 1010"), "");
  assert.equal(resolveLoginIdentifier("fran/1010"), "");
});
