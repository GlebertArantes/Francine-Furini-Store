import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (file) => readFileSync(new URL("../../" + file, import.meta.url), "utf8");

test("painel mostra as cinco abas operacionais incluindo Venda Rápida", () => {
  const app = read("admin/js/app.js");
  assert.match(app, /const links = \[\["#\/", "Painel"\], \["#\/pedidos", "Pedidos"\], \["#\/venda-rapida", "Venda Rápida"\], \["#\/produtos", "Produtos"\], \["#\/categorias", "Categorias"\]\]/);
  assert.doesNotMatch(app, /\["#\/configuracoes", "Loja"\]/);
  assert.doesNotMatch(app, /import\s*\{\s*settingsView\s*\}/);
  assert.match(app, /if \(p\[0\] === "configuracoes"\) \{ ctx\.navigate\("#\/"\); return; \}/);
});

test("configurações persistidas continuam alimentando a vitrine", () => {
  const storefront = read("storefront/js/app.js");
  const api = read("storefront/js/lib/api.js");
  assert.match(storefront, /api\.getSettings\(\)/);
  assert.match(storefront, /s\.whatsapp_number/);
  assert.match(storefront, /s\.instagram_url/);
  assert.match(api, /store_settings/);
});

test("manual acompanha a retirada da aba Loja", () => {
  const manual = read("docs/MANUAL_FRANCINE.md");
  assert.doesNotMatch(manual, /toque em \*\*Loja\*\*/i);
  assert.match(manual, /\*\*Painel\*\*, \*\*Pedidos\*\*, \*\*Produtos\*\* e \*\*Categorias\*\*/);
});
