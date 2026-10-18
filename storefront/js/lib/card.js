// Modelo puro do card de produto: tudo que o card exibe é DERIVADO de dados reais do catálogo
// (Supabase). Nada é inventado: sem desconto Pix, parcelas ou rótulos comerciais.
import { priceInfo, activeVariants, inStock, isSoldOut, compareSizes } from "./catalog.js";
import { fold } from "./format.js";

export const CARD_LOW_STOCK_TOTAL = 3;   // "Restam N" quando o total disponível é <= 3
export const CARD_MAX_COLORS = 3;        // nomes de cor exibidos antes de "+N"
export const CARD_MAX_SIZES = 5;         // tamanhos exibidos antes de "+N"

/** Itera valores únicos (sem diferenciar caixa/acento) preservando o primeiro rótulo. */
function uniqueBy(list, keyFn, labelFn) {
  const map = new Map();
  for (const x of list) { const k = keyFn(x); if (!map.has(k)) map.set(k, labelFn(x)); }
  return [...map.values()];
}

/** Cores e tamanhos DISPONÍVEIS (variante ativa com estoque > 0), com limite de exibição. */
export function cardOptions(product) {
  const avail = activeVariants(product).filter(inStock);
  const colors = uniqueBy(avail, (v) => fold(v.color), (v) => v.color.trim()).sort((a, b) => a.localeCompare(b, "pt-BR"));
  const sizes = uniqueBy(avail, (v) => fold(v.size), (v) => v.size.trim()).sort(compareSizes);
  const cut = (arr, max) => ({ shown: arr.slice(0, max), extra: Math.max(0, arr.length - max), all: arr });
  return { colors: cut(colors, CARD_MAX_COLORS), sizes: cut(sizes, CARD_MAX_SIZES) };
}

/** Estoque real: soma das variantes ATIVAS. Só destaca número quando é baixo (não expõe estoque alto). */
export function stockInfo(product) {
  const total = activeVariants(product).reduce((n, v) => n + Math.max(0, v.quantity || 0), 0);
  if (isSoldOut(product) || total <= 0) return { state: "out", total: 0, label: "Esgotado" };
  if (total <= CARD_LOW_STOCK_TOTAL) return { state: "low", total, label: total === 1 ? "Resta apenas 1 peça" : `Restam apenas ${total} peças` };
  return { state: "ok", total, label: "Disponível" };
}

/**
 * Dados do card. `categories` = lista de {id,name}; `imageUrlOf(storagePath)` monta a URL pública.
 * Categoria só existe se cadastrada e com nome; contador de fotos só com 2+ imagens.
 */
export function cardModel(product, { categories = [], imageUrlOf = () => null } = {}) {
  const price = priceInfo(product);
  const category = categories.find((c) => c.id === product.category_id)?.name?.trim() || null;
  const images = product.images ?? [];
  const first = images[0];
  const opts = cardOptions(product);
  const stock = stockInfo(product);
  return {
    id: product.id,
    name: product.name,
    href: `#/produto/${encodeURIComponent(product.slug)}`,
    category,
    featured: !!product.featured,
    price,
    onSale: price.onSale,
    discountPct: price.discountPct,
    photoCount: images.length,
    showPhotoCount: images.length > 1,
    imageUrl: imageUrlOf(first?.storage_path),
    imageAlt: first?.alt_text?.trim() || product.name,
    colors: opts.colors,
    sizes: opts.sizes,
    stock,
    soldOut: stock.state === "out",
    ctaLabel: stock.state === "out" ? "Ver detalhes" : "Escolher cor e tamanho",
  };
}
