import { h } from "../lib/dom.js";
import { formatBRL } from "../lib/format.js";
import { priceInfo, isSoldOut } from "../lib/catalog.js";

export function priceEl(p) {
  const info = priceInfo(p);
  return h("p", { class: "price" },
    info.onSale ? h("s", {}, h("span", { class: "sr-only" }, "Preço anterior "), formatBRL(info.compareAt)) : null,
    h("span", { class: "now" }, h("span", { class: "sr-only" }, info.onSale ? "Preço promocional " : "Preço "), formatBRL(info.price)));
}

export function imageEl(url, alt = "", fallbackText = "") {
  if (!url) return h("div", { class: "noimg", role: "img", "aria-label": alt || fallbackText }, fallbackText);
  const img = h("img", { src: url, alt, loading: "lazy", decoding: "async" });
  img.addEventListener("error", () => img.replaceWith(h("div", { class: "noimg", role: "img", "aria-label": alt }, fallbackText)), { once: true });
  return img;
}

export function productCard(ctx, p) {
  const sold = isSoldOut(p);
  const first = p.images[0];
  return h("li", {},
    h("a", { class: `card${sold ? " is-soldout" : ""}`, href: `#/produto/${encodeURIComponent(p.slug)}` },
      h("div", { class: "ph" }, imageEl(ctx.api.imageUrl(first?.storage_path), first?.alt_text || p.name, p.name),
        sold ? h("span", { class: "soldout-tag" }, "Esgotado") : null),
      h("h3", {}, p.name), priceEl(p)));
}

export const loadingGrid = () => h("div", { class: "skeleton", "aria-busy": "true", "aria-label": "Carregando" }, [1, 2, 3, 4].map(() => h("div")));

export function stateBlock(title, text, action) {
  return h("div", { class: "state", role: "status" }, h("h2", {}, title), h("p", {}, text), action ?? null);
}
