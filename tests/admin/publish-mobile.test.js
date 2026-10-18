import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { NEW_PRODUCT_DEFAULTS, visibilityInfo, publishWarnings, validateProduct } from "../../admin/js/lib/rules.js";
import { describeUploadError, uploadPhotos, createPhotoQueue, summarizeUpload, createProductWithPhotos } from "../../admin/js/lib/photos.js";
import { shouldShrink, targetSize, shrunkName, MAX_SIDE } from "../../admin/js/lib/image-resize.js";
import { MAX_IMAGE_BYTES } from "../../admin/js/lib/rules.js";

const file = (name, type = "image/jpeg", size = 1000) => ({ name, type, size });

test("produto novo nasce OCULTO (rascunho): ativo e destaque desligados por padrão", () => {
  assert.equal(NEW_PRODUCT_DEFAULTS.active, false);
  assert.equal(NEW_PRODUCT_DEFAULTS.featured, false);
  assert.ok(Object.isFrozen(NEW_PRODUCT_DEFAULTS));
  // o formulário usa o padrão seguro e não o antigo "ativo por padrão"
  const src = fs.readFileSync(new URL("../../admin/js/views/products.js", import.meta.url), "utf8");
  assert.match(src, /checked: p \? p\.active : NEW_PRODUCT_DEFAULTS\.active/);
  assert.ok(!/checked: p \? p\.active : true/.test(src));
  // o payload respeita a escolha explícita
  assert.equal(validateProduct({ name: "A", slug: "a", price: "1", active: false }).payload.active, false);
  assert.equal(validateProduct({ name: "A", slug: "a", price: "1", active: true }).payload.active, true);
});

test("indicador de visibilidade: oculto, visível e agendado, em linguagem simples", () => {
  const now = Date.parse("2026-10-18T12:00:00Z");
  const hidden = visibilityInfo({ active: false }, now);
  assert.equal(hidden.state, "hidden");
  assert.match(hidden.label, /Oculto da loja/);
  assert.match(hidden.detail, /NÃO aparece/);
  assert.equal(visibilityInfo({ active: true }, now).state, "visible");
  assert.equal(visibilityInfo({ active: true, published_at: "2026-10-01T00:00:00Z" }, now).state, "visible");
  const sch = visibilityInfo({ active: true, published_at: "2026-12-01T10:00:00Z" }, now);
  assert.equal(sch.state, "scheduled");
  assert.match(sch.detail, /a partir de/);
  assert.equal(visibilityInfo({ active: false, published_at: "2026-12-01T10:00:00Z" }, now).state, "hidden"); // inativo vence agendamento
});

test("avisos antes de publicar: sem fotos e sem estoque", () => {
  assert.equal(publishWarnings({ photos: 2, variants: [{ active: true, quantity: 3 }] }).length, 0);
  assert.match(publishWarnings({ photos: 0, variants: [{ active: true, quantity: 3 }] })[0], /não tem fotos/);
  assert.match(publishWarnings({ photos: 1, variants: [] })[0], /Nenhuma variante ativa com estoque/);
  assert.match(publishWarnings({ photos: 1, variants: [{ active: false, quantity: 9 }, { active: true, quantity: 0 }] })[0], /esgotado/);
  const creating = publishWarnings({ photos: 0, variants: null }); // criação: variantes ainda não existem
  assert.equal(creating.length, 2);
  assert.match(creating[1], /aparecerá como esgotado/);
});

test("mensagens de erro de upload em português, sem detalhes internos", () => {
  assert.match(describeUploadError({ code: "network", status: 0 }), /sem conexão/);
  assert.match(describeUploadError({ status: 413 }), /grande demais/);
  assert.match(describeUploadError({ message: "The object exceeded the maximum allowed size" }), /grande demais/);
  assert.match(describeUploadError({ status: 415 }), /formato não aceito/);
  assert.match(describeUploadError({ message: "mime type image/gif is not supported" }), /formato não aceito/);
  assert.match(describeUploadError({ status: 403, message: "new row violates row-level security policy" }), /sem permissão/);
  assert.match(describeUploadError({ code: "session_expired" }), /sessão expirada/);
  const generic = describeUploadError({ status: 500, message: "select * from storage.objects where secret" });
  assert.match(generic, /tente novamente/);
  assert.ok(!/select|storage|secret/.test(generic));
});

test("falha de foto: relatório lista o arquivo e o motivo; progresso é informado", async () => {
  const api = { uploadImage: async (_id, f) => { if (f.name === "b.jpg") throw Object.assign(new Error("x"), { status: 413 }); return { id: f.name }; } };
  const q = createPhotoQueue(); q.add([file("a.jpg"), file("b.jpg"), file("c.jpg")]);
  const steps = [];
  const r = await uploadPhotos(api, "10000000-0000-0000-0000-000000000001", q.valid(), 0, { onProgress: (p) => steps.push(`${p.done}/${p.total}`) });
  assert.deepEqual(steps, ["0/3", "1/3", "2/3"]);
  assert.equal(r.failed[0].name, "b.jpg");
  assert.match(r.failed[0].reason, /grande demais/);
  const s = summarizeUpload(r);
  assert.match(s.text, /b\.jpg \(arquivo grande demais/);
  assert.match(s.text, /Envie novamente/);
});

test("criar produto com foto encaminha o progresso e mantém criar-antes-de-enviar", async () => {
  const calls = [];
  const api = { createProduct: async (p) => { calls.push("create"); return { id: "10000000-0000-0000-0000-0000000000aa", ...p }; }, uploadImage: async (_i, f) => { calls.push(`up:${f.name}`); return {}; } };
  const q = createPhotoQueue(); q.add([file("a.jpg"), file("b.jpg")]);
  const seen = [];
  await createProductWithPhotos(api, { name: "X" }, q, { onProgress: (p) => seen.push(p.done) });
  assert.deepEqual(calls, ["create", "up:a.jpg", "up:b.jpg"]);
  assert.deepEqual(seen, [0, 1]);
});

test("foto grande de celular: só arquivos > 8 MB (JPEG/PNG/WebP) são reduzidos; proporção mantida e nunca amplia", () => {
  assert.equal(shouldShrink(file("a.jpg", "image/jpeg", MAX_IMAGE_BYTES + 1)), true);
  assert.equal(shouldShrink(file("a.png", "image/png", 20 * 1024 * 1024)), true);
  assert.equal(shouldShrink(file("a.jpg", "image/jpeg", MAX_IMAGE_BYTES)), false); // no limite: intacto
  assert.equal(shouldShrink(file("a.jpg", "image/jpeg", 3_000_000)), false);
  assert.equal(shouldShrink(file("a.avif", "image/avif", 20_000_000)), false);      // AVIF não é recodificado
  assert.equal(shouldShrink(file("a.gif", "image/gif", 20_000_000)), false);
  assert.deepEqual(targetSize(8000, 6000), { width: MAX_SIDE, height: 1800 });
  assert.deepEqual(targetSize(6000, 8000), { width: 1800, height: MAX_SIDE });
  assert.deepEqual(targetSize(1200, 900), { width: 1200, height: 900 });
  assert.equal(shrunkName("IMG_2031.HEIC.png"), "IMG_2031.HEIC.jpg");
  assert.equal(shrunkName("sem-ext"), "sem-ext.jpg");
});

test("campos do celular: teclado numérico em preço/quantidade, rótulos visíveis nas variantes e alvos de toque", () => {
  const src = fs.readFileSync(new URL("../../admin/js/views/products.js", import.meta.url), "utf8");
  assert.match(src, /name: "price"[^)]*|inp\("price"[^;]*inputmode: "decimal"/);
  assert.match(src, /inp\("price"[^;]*inputmode: "decimal"/);
  assert.match(src, /inp\("compare_at"[^;]*inputmode: "decimal"/);
  assert.match(src, /name: "quantity"[^;]*inputmode: "numeric"[^;]*pattern: "\[0-9\]\*"/);
  assert.match(src, /mini\("Quantidade em estoque", qty\)/);
  assert.match(src, /mini\("Tamanho", size\)/);
  const css = fs.readFileSync(new URL("../../admin/css/admin.css", import.meta.url), "utf8");
  assert.match(css, /pointer: coarse[^{]*\{[^}]*\.btn\.small \{ min-height: 44px/s);
});

test("indicador de visibilidade: classes de estado não colidem com a utilidade .hidden (display:none)", () => {
  const src = fs.readFileSync(new URL("../../admin/js/views/products.js", import.meta.url), "utf8");
  const css = fs.readFileSync(new URL("../../admin/css/admin.css", import.meta.url), "utf8");
  assert.match(css, /\.hidden \{ display: none !important; \}/);
  assert.match(src, /vis\.className = `vis vis-\$\{i\.state\}`/);
  for (const state of ["hidden", "visible", "scheduled"]) assert.match(css, new RegExp(`\\.vis-${state} \\{`), `CSS .vis-${state}`);
  assert.ok(!/\.vis\.hidden/.test(css), "seletor antigo (.vis.hidden) removido");
});
