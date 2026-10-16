import { test } from "node:test";
import assert from "node:assert/strict";
import { parseReaisToCents, centsToInput, formatBRL } from "../../admin/js/lib/money.js";
import { validateProduct, validateVariant, validateCategory, validateSettings, slugify, validateImageFile, buildStoragePath, isOwnStoragePath, reorderImages, stockLevel, MAX_IMAGE_BYTES } from "../../admin/js/lib/rules.js";

test("R$ <-> centavos sem erro de ponto flutuante", () => {
  const cases = { "249,90": 24990, "1.234,56": 123456, "4,35": 435, "1,15": 115, "0,29": 29, "19.90": 1990, "R$ 12,5": 1250, "100": 10000, "8,7": 870, "1.000": 100000 };
  for (const [s, c] of Object.entries(cases)) assert.equal(parseReaisToCents(s).cents, c, s);
  assert.notEqual(Math.round(4.35 * 100), 434.99999999999994); // sanidade: float seria perigoso
  for (const bad of ["", "abc", "-5", "1,234", "1e3", "12,345,6", "R$", "0,00", "0", "99999999999"]) assert.equal(parseReaisToCents(bad).ok, false, bad);
  assert.deepEqual(parseReaisToCents("0,00", { allowZero: true }), { ok: true, cents: 0 });
  assert.equal(centsToInput(24990), "249,90");
  assert.equal(centsToInput(5), "0,05");
  assert.equal(parseReaisToCents(centsToInput(123456)).cents, 123456);
  assert.match(formatBRL(24990).replace(/\s/g, " "), /R\$ 249,90/);
});

test("payload de produto: campos corretos e conversão para price_cents", () => {
  const r = validateProduct({ name: " Vestido Seda ", slug: "", price: "249,90", compare_at: "299,90", category_id: "", sku: " ", description: "x", fabric: "", featured: true, active: true, published_at: "" });
  assert.ok(r.ok);
  assert.deepEqual(r.payload, { category_id: null, sku: null, name: "Vestido Seda", slug: "vestido-seda", description: "x", fabric: null, price_cents: 24990, compare_at_price_cents: 29990, featured: true, active: true, published_at: null });
  assert.deepEqual(Object.keys(r.payload).sort(), ["active", "category_id", "compare_at_price_cents", "description", "fabric", "featured", "name", "price_cents", "published_at", "slug", "sku"].sort());
});

test("produto: validações espelham constraints do banco", () => {
  const base = { name: "A", slug: "a", price: "10", active: true };
  assert.equal(validateProduct({ ...base, price: "0" }).errors.price !== undefined, true);
  assert.equal(validateProduct({ ...base, compare_at: "9,99" }).errors.compare_at !== undefined, true);
  assert.equal(validateProduct({ ...base, compare_at: "10,00" }).ok, true);
  assert.equal(validateProduct({ ...base, slug: "Slug Inválido" }).errors.slug !== undefined, true);
  assert.equal(validateProduct({ ...base, name: "" }).errors.name !== undefined, true);
  assert.equal(validateProduct({ ...base, name: "x".repeat(161) }).errors.name !== undefined, true);
  assert.match(validateProduct({ ...base, published_at: "2026-10-20T10:00" }).payload.published_at, /^2026-10-20T/);
  assert.equal(slugify("Calça Pantalona Linho!"), "calca-pantalona-linho");
});

test("payload de variante: tamanho livre, quantidade inteira >= 0", () => {
  const r = validateVariant({ color: " Nude ", size: "Tamanho único", sku: "", quantity: "3", active: true });
  assert.deepEqual(r.payload, { color: "Nude", size: "Tamanho único", sku: null, quantity: 3, active: true });
  assert.ok(validateVariant({ color: "a", size: "38", quantity: "0" }).ok);
  for (const q of ["-1", "1.5", "abc", "", "1e2"]) assert.ok(validateVariant({ color: "a", size: "b", quantity: q }).errors.quantity, q);
  assert.ok(validateVariant({ color: "", size: "", quantity: "1" }).errors.color);
  assert.ok(validateVariant({ color: "a", size: "x".repeat(41), quantity: "1" }).errors.size);
});

test("categoria e configurações: só campos existentes; sem secret", () => {
  assert.deepEqual(validateCategory({ name: "Vestidos", slug: "", sort_order: "2", active: true }).payload, { name: "Vestidos", slug: "vestidos", sort_order: 2, active: true });
  assert.ok(validateCategory({ name: "A", slug: "A B", sort_order: "x" }).errors.sort_order);
  const s = validateSettings({ store_name: "Francine Furini Store", instagram_url: "https://instagram.com/x", whatsapp_number: "(31) 99565-2798", announcement_text: "", extra: "ignorado", service_role: "x" });
  assert.ok(s.ok);
  assert.deepEqual(Object.keys(s.payload).sort(), ["announcement_text", "instagram_url", "store_name", "whatsapp_number"]);
  assert.equal(s.payload.whatsapp_number, "5531995652798");
  assert.equal(validateSettings({ store_name: "x", instagram_url: "javascript:alert(1)" }).errors.instagram_url !== undefined, true);
  assert.equal(validateSettings({ store_name: "" }).ok, false);
});

test("upload só aceita MIME e tamanho permitidos (limite 8 MB)", () => {
  for (const type of ["image/jpeg", "image/png", "image/webp", "image/avif"]) assert.ok(validateImageFile({ type, size: 1000 }).ok, type);
  for (const type of ["image/gif", "image/svg+xml", "application/pdf", "text/html", ""]) assert.equal(validateImageFile({ type, size: 1000 }).ok, false, type);
  assert.ok(validateImageFile({ type: "image/png", size: MAX_IMAGE_BYTES }).ok);
  assert.equal(validateImageFile({ type: "image/png", size: MAX_IMAGE_BYTES + 1 }).ok, false);
  assert.equal(validateImageFile({ type: "image/png", size: 0 }).ok, false);
  assert.equal(MAX_IMAGE_BYTES, 8388608);
});

test("path do Storage: sem colisão, extensão do MIME, preso ao produto", () => {
  const id = "10000000-0000-0000-0000-000000000001";
  const a = buildStoragePath(id, "image/webp", { now: 1000, rand: () => "aaaa" });
  const b = buildStoragePath(id, "image/webp", { now: 1000, rand: () => "bbbb" });
  assert.notEqual(a, b);
  assert.match(a, /^products\/10000000-0000-0000-0000-000000000001\/[a-z0-9]+-aaaa\.webp$/);
  assert.throws(() => buildStoragePath("../x", "image/png"), /invalid_product_id/);
  assert.throws(() => buildStoragePath(id, "text/html"), /invalid_mime/);
  assert.ok(isOwnStoragePath(a, id));
  assert.equal(isOwnStoragePath("products/outro/x.png", id), false);
  assert.equal(isOwnStoragePath(`products/${id}/../../x.png`, id), false);
});

test("ordenação de fotos e nível de estoque", () => {
  const imgs = [{ id: "a", sort_order: 0 }, { id: "b", sort_order: 1 }, { id: "c", sort_order: 2 }];
  assert.deepEqual(reorderImages(imgs, "c", "up"), [{ id: "c", sort_order: 1 }, { id: "b", sort_order: 2 }]);
  assert.deepEqual(reorderImages(imgs, "a", "up"), []);
  assert.deepEqual([0, 1, 2, 3].map((quantity) => stockLevel({ quantity })), ["out", "low", "low", "ok"]);
});
