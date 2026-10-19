// Modelo PURO da "Prévia na vitrine": monta, a partir do formulário (ainda não salvo), um produto no formato que a vitrine usa
// e reaproveita as mesmas regras (cópia verificada em ./shared). Nada é gravado: só leitura de valores.
import { parseReaisToCents, centsToInput } from "./money.js";
import { visibilityInfo, isoToLocalInput } from "./rules.js";
import { priceInfo } from "./shared/catalog.js";
import { cardModel } from "./shared/card.js";

/**
 * values: { name, category_id, price, compare_at, fabric, description, featured, active, published_at(ISO|null) } — strings do formulário.
 * existing: produto salvo (ou null). images: [{ url, alt }] já resolvidos (locais ou do Storage), na ordem de exibição.
 */
export function previewProduct({ values, existing = null, images = [] }) {
  const price = parseReaisToCents(values.price);
  const compare = parseReaisToCents(values.compare_at);
  const variants = (existing?.product_variants ?? []).map((v) => ({ id: v.id, color: v.color, size: v.size, quantity: v.quantity, active: v.active }));
  return {
    id: existing?.id ?? "preview",
    name: String(values.name ?? "").trim() || "Nome do produto",
    slug: existing?.slug ?? "previa",
    category_id: values.category_id || null,
    price_cents: price.ok ? price.cents : 0, // 0 = ainda sem preço válido (a interface mostra "Preço a definir")
    priceValid: price.ok,
    compare_at_price_cents: price.ok && compare.ok ? compare.cents : null,
    featured: !!values.featured,
    description: String(values.description ?? "").trim(),
    fabric: String(values.fabric ?? "").trim(),
    variants,
    images: images.map((im, i) => ({ storage_path: im.url, alt_text: im.alt ?? "", sort_order: i })),
    hasSavedVariants: variants.length > 0,
  };
}

const FIELDS = ["name", "category_id", "price", "compare_at", "fabric", "description", "featured", "active", "published_at"];
const norm = (v) => (typeof v === "boolean" ? v : String(v ?? "").trim());

/** true quando algum campo difere do estado salvo (produto novo: sempre rascunho não salvo). */
export function isDirty(current, initial) {
  if (!initial) return true;
  return FIELDS.some((k) => norm(current[k]) !== norm(initial[k]));
}

/** Resumo para a interface: modelo do card + avisos honestos sobre o que a prévia não sabe. */
export function previewSummary({ values, existing = null, images = [], categories = [] }) {
  const p = previewProduct({ values, existing, images });
  const card = cardModel(p, { categories, imageUrlOf: (x) => x });
  const info = p.priceValid ? priceInfo(p) : null;
  const notes = [];
  if (!p.priceValid) notes.push("Informe um preço válido para ver o valor na vitrine.");
  else if (parseReaisToCents(values.compare_at).ok && !card.onSale) notes.push("O preço anterior é menor que o atual: a vitrine não mostrará promoção.");
  if (!p.images.length) notes.push("Sem fotos: a vitrine mostra um espaço reservado com o nome.");
  if (!p.hasSavedVariants) notes.push(existing ? "Este produto ainda não tem cores/tamanhos cadastrados: na vitrine ele aparece como esgotado." : "Cores, tamanhos e estoque são cadastrados depois de criar o produto. Até lá, a vitrine o mostraria como esgotado.");
  let iso = null; try { iso = values.published_at ? new Date(values.published_at).toISOString() : null; } catch { /* data inválida */ }
  return { product: p, card, price: info, notes, visibility: visibilityInfo({ active: !!values.active, published_at: iso }), dirty: isDirty(values, existing ? initialValues(existing) : null) };
}

/** Valores de formulário equivalentes a um produto salvo (para comparar com o que está digitado). */
export function initialValues(p) {
  if (!p) return null;
  return { name: p.name ?? "", category_id: p.category_id ?? "", price: centsToInput(p.price_cents), compare_at: centsToInput(p.compare_at_price_cents), fabric: p.fabric ?? "", description: p.description ?? "", featured: !!p.featured, active: !!p.active, published_at: isoToLocalInput(p.published_at) };
}
