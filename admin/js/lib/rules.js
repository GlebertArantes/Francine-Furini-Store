// Regras puras de formulário do painel. Espelham as constraints do banco (UX), mas o banco decide.
import { parseReaisToCents } from "./money.js";

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const LOW_STOCK_MAX = 2; // apenas visual; não altera regra do banco

export function slugify(s) {
  return String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

const trim = (v) => String(v ?? "").trim();
const orNull = (v) => { const t = trim(v); return t === "" ? null : t; };
const done = (errors, payload) => ({ ok: Object.keys(errors).length === 0, errors, payload });

export function validateCategory(f) {
  const errors = {};
  const name = trim(f.name), slug = trim(f.slug) || slugify(name);
  if (name.length < 1 || name.length > 80) errors.name = "Informe o nome (até 80 caracteres).";
  if (!SLUG_RE.test(slug)) errors.slug = "Slug inválido: use letras minúsculas, números e hífens.";
  const so = trim(f.sort_order) === "" ? 0 : Number(f.sort_order);
  if (!Number.isInteger(so) || Math.abs(so) > 100000) errors.sort_order = "Ordem deve ser um número inteiro.";
  return done(errors, { name, slug, sort_order: so, active: !!f.active });
}

export function validateProduct(f) {
  const errors = {};
  const name = trim(f.name), slug = trim(f.slug) || slugify(name);
  if (name.length < 1 || name.length > 160) errors.name = "Informe o nome (até 160 caracteres).";
  if (!SLUG_RE.test(slug)) errors.slug = "Slug inválido: use letras minúsculas, números e hífens.";
  const price = parseReaisToCents(f.price);
  if (!price.ok) errors.price = "Informe um preço válido maior que R$ 0,00 (ex.: 249,90).";
  let compare = null;
  if (trim(f.compare_at) !== "") {
    const c = parseReaisToCents(f.compare_at);
    if (!c.ok) errors.compare_at = "Preço anterior inválido (ex.: 299,90).";
    else if (price.ok && c.cents < price.cents) errors.compare_at = "O preço anterior deve ser maior ou igual ao preço atual.";
    else compare = c.cents;
  }
  let published_at = null;
  if (trim(f.published_at) !== "") {
    const d = new Date(f.published_at);
    if (Number.isNaN(d.getTime())) errors.published_at = "Data de publicação inválida.";
    else published_at = d.toISOString();
  }
  return done(errors, {
    category_id: orNull(f.category_id), sku: orNull(f.sku), name, slug,
    description: orNull(f.description), fabric: orNull(f.fabric),
    price_cents: price.ok ? price.cents : null, compare_at_price_cents: compare,
    featured: !!f.featured, active: !!f.active, published_at,
  });
}

export function validateVariant(f) {
  const errors = {};
  const color = trim(f.color), size = trim(f.size);
  if (color.length < 1 || color.length > 80) errors.color = "Informe a cor (até 80 caracteres).";
  if (size.length < 1 || size.length > 40) errors.size = "Informe o tamanho (até 40 caracteres).";
  const q = trim(f.quantity);
  const quantity = /^\d{1,7}$/.test(q) ? Number(q) : NaN;
  if (!Number.isInteger(quantity)) errors.quantity = "Quantidade deve ser um número inteiro maior ou igual a 0.";
  return done(errors, { color, size, sku: orNull(f.sku), quantity, active: !!f.active });
}

export function validateSettings(f) {
  const errors = {};
  const store_name = trim(f.store_name);
  if (store_name.length < 1 || store_name.length > 120) errors.store_name = "Informe o nome da loja.";
  let instagram_url = orNull(f.instagram_url);
  if (instagram_url && !/^https:\/\/[^\s/]+\.[^\s/]+\S*$/i.test(instagram_url)) errors.instagram_url = "Use um link completo começando com https://";
  let whatsapp_number = orNull(f.whatsapp_number);
  if (whatsapp_number) {
    let d = whatsapp_number.replace(/\D/g, "");
    if (d.length === 10 || d.length === 11) d = `55${d}`;
    if (!/^\d{12,13}$/.test(d)) errors.whatsapp_number = "WhatsApp com DDD (ex.: 31 99999-9999).";
    else whatsapp_number = d;
  }
  const announcement_text = orNull(f.announcement_text);
  if (announcement_text && announcement_text.length > 200) errors.announcement_text = "Aviso com até 200 caracteres.";
  // Somente colunas existentes em store_settings (sem CMS genérico).
  return done(errors, { store_name, instagram_url, whatsapp_number, announcement_text });
}

export const stockLevel = (v) => (v.quantity <= 0 ? "out" : v.quantity <= LOW_STOCK_MAX ? "low" : "ok");

// --- imagens -----------------------------------------------------------------
export const IMAGE_BUCKET = "product-images";
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // = file_size_limit do bucket (8388608)
export const IMAGE_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/avif": "avif" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateImageFile(file) {
  if (!file || !(file.type in IMAGE_TYPES)) return { ok: false, error: "Formato não permitido. Use JPEG, PNG, WebP ou AVIF." };
  if (!(file.size > 0)) return { ok: false, error: "Arquivo vazio." };
  if (file.size > MAX_IMAGE_BYTES) return { ok: false, error: "Arquivo maior que 8 MB." };
  return { ok: true };
}

/** products/<product-id>/<timestamp>-<aleatório>.<ext> — extensão vem do MIME, nunca do nome do arquivo. */
export function buildStoragePath(productId, mime, { now = Date.now(), rand = () => Math.random().toString(36).slice(2, 10) } = {}) {
  if (!UUID.test(productId)) throw new Error("invalid_product_id");
  const ext = IMAGE_TYPES[mime];
  if (!ext) throw new Error("invalid_mime");
  return `products/${productId.toLowerCase()}/${now.toString(36)}-${rand()}.${ext}`;
}

export const isOwnStoragePath = (path, productId) =>
  typeof path === "string" && UUID.test(productId) && path.startsWith(`products/${productId.toLowerCase()}/`) && !path.includes("..") && !path.includes("//");

/** Move uma foto para cima/baixo e devolve só as linhas cujo sort_order mudou. */
export function reorderImages(images, id, dir) {
  const list = [...images].sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id));
  const i = list.findIndex((x) => x.id === id), j = i + (dir === "up" ? -1 : 1);
  if (i < 0 || j < 0 || j >= list.length) return [];
  [list[i], list[j]] = [list[j], list[i]];
  return list.map((x, idx) => ({ id: x.id, sort_order: idx })).filter((u) => images.find((x) => x.id === u.id).sort_order !== u.sort_order);
}
