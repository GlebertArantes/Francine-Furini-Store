// Regras puras do catálogo (filtros, disponibilidade, preço). Dados vêm do Supabase.
import { fold } from "./format.js";

const LETTER_ORDER = ["PP", "P", "M", "G", "GG", "XG", "XGG"];

/** Ordena tamanhos livres: letras (PP..XGG), depois números, depois texto. */
export function compareSizes(a, b) {
  const rank = (s) => {
    const up = String(s).trim().toUpperCase();
    const li = LETTER_ORDER.indexOf(up);
    if (li >= 0) return [0, li, up];
    if (/^\d+$/.test(up)) return [1, Number(up), up];
    return [2, 0, up];
  };
  const [ga, na, sa] = rank(a);
  const [gb, nb, sb] = rank(b);
  return ga - gb || na - nb || sa.localeCompare(sb, "pt-BR");
}

/** Variante inativa nunca é exibida nem conta como disponível (a RLS já a oculta; aqui é defesa em profundidade). */
export const isActiveVariant = (v) => v?.active !== false;
export const activeVariants = (p) => (p.variants ?? []).filter(isActiveVariant);
export const inStock = (v) => isActiveVariant(v) && (v?.quantity ?? 0) > 0;
export const isSoldOut = (p) => !(p.variants ?? []).some(inStock);

export function priceInfo(p) {
  const price = p.price_cents;
  const compare = p.compare_at_price_cents;
  const onSale = Number.isInteger(compare) && compare > price;
  return {
    price,
    compareAt: onSale ? compare : null,
    onSale,
    discountPct: onSale ? Math.round((1 - price / compare) * 100) : 0,
  };
}

export function facets(products) {
  const sizes = new Set();
  const colors = new Map(); // fold -> label original
  for (const p of products) {
    for (const v of activeVariants(p)) {
      sizes.add(v.size.trim());
      const k = fold(v.color);
      if (!colors.has(k)) colors.set(k, v.color.trim());
    }
  }
  return {
    sizes: [...sizes].sort(compareSizes),
    colors: [...colors.values()].sort((a, b) => a.localeCompare(b, "pt-BR")),
  };
}

/**
 * filtros = { q, categoryId, size, color, onlyAvailable }.
 * Tamanho e cor valem para a MESMA variante; com `onlyAvailable`, só variantes com estoque.
 */
export function filterProducts(products, f = {}, categories = []) {
  const tokens = fold(f.q).split(/\s+/).filter(Boolean);
  const catName = new Map(categories.map((c) => [c.id, c.name]));
  const size = f.size ? fold(f.size) : "";
  const color = f.color ? fold(f.color) : "";
  return products.filter((p) => {
    if (f.categoryId && p.category_id !== f.categoryId) return false;
    if (tokens.length) {
      const hay = fold([p.name, p.description, p.fabric, catName.get(p.category_id), ...(p.variants ?? []).map((v) => v.color)].join(" "));
      if (!tokens.every((t) => hay.includes(t))) return false;
    }
    if (f.onlyAvailable && isSoldOut(p)) return false;
    if (size || color) {
      return activeVariants(p).some(
        (v) =>
          (!size || fold(v.size) === size) &&
          (!color || fold(v.color) === color) &&
          (!f.onlyAvailable || inStock(v))
      );
    }
    return true;
  });
}

export const featuredProducts = (products, limit = 4) =>
  products.filter((p) => p.featured && !isSoldOut(p)).slice(0, limit);

export function colorsOf(p) {
  const seen = new Map();
  for (const v of activeVariants(p)) {
    const k = fold(v.color);
    const cur = seen.get(k) ?? { color: v.color.trim(), available: false };
    cur.available ||= inStock(v);
    seen.set(k, cur);
  }
  return [...seen.values()];
}

export function sizesOfColor(p, color) {
  return activeVariants(p)
    .filter((v) => fold(v.color) === fold(color))
    .sort((a, b) => compareSizes(a.size, b.size));
}

/** Dados de referência de uma variante para o carrinho. */
export function cartLine(product, variant, imageUrl) {
  return {
    variant_id: variant.id,
    product_id: product.id,
    stock: variant.quantity,
    ref: {
      name: product.name, slug: product.slug, color: variant.color, size: variant.size,
      price_cents: product.price_cents, image: imageUrl ?? null,
    },
  };
}

/** Mapa variant_id -> { product_id, stock, ref } para reconciliar o carrinho. */
export function variantIndex(products, imageUrlOf = () => null) {
  const map = new Map();
  for (const p of products) {
    for (const v of activeVariants(p)) {
      const line = cartLine(p, v, imageUrlOf(p));
      map.set(v.id, { product_id: p.id, stock: v.quantity, ref: line.ref });
    }
  }
  return map;
}
