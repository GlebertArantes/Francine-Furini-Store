import { h } from "../lib/dom.js";
import { formatBRL } from "../lib/format.js";
import { priceInfo } from "../lib/catalog.js";
import { cardModel } from "../lib/card.js";
import { priceExtras } from "../lib/payment-info.js";

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

/**
 * Card de produto (informativo, sem botões dentro de link): um único link — o título — é "esticado" por CSS
 * sobre o card inteiro, então há UM tab stop por card e a área inteira é clicável. O botão "Escolher cor e
 * tamanho" é visual (aria-hidden): quem clica/toca/teclando no link chega à página do produto.
 * Todos os dados vêm de cardModel() (catálogo real); nada é inventado.
 */
export function productCard(ctx, p) {
  const m = cardModel(p, { categories: ctx.categories, imageUrlOf: (path) => ctx.api.imageUrl(path) });
  const titleId = `pc-${p.id}`;
  const extras = priceExtras(p); // vazio até haver regra comercial aprovada (Pix/parcelas)
  const more = (n) => (n > 0 ? ` +${n}` : "");
  return h("li", { class: "pcard-item" },
    h("article", { class: `pcard${m.soldOut ? " is-soldout" : ""}`, "aria-labelledby": titleId },
      h("div", { class: "pcard-media" },
        imageEl(m.imageUrl, m.imageAlt, p.name),
        m.onSale || m.featured ? h("div", { class: "pcard-badges" },
          m.onSale ? h("span", { class: "pcard-badge sale" }, "Promoção") : null,
          m.featured ? h("span", { class: "pcard-badge featured" }, "Destaque") : null) : null,
        m.soldOut ? h("span", { class: "pcard-tag" }, "Esgotado") : null,
        m.showPhotoCount ? h("span", { class: "pcard-count" }, `${m.photoCount} fotos`) : null),
      h("div", { class: "pcard-body" },
        h("div", { class: "pcard-head" },
          m.category ? h("p", { class: "pcard-cat" }, m.category) : null,
          h("h3", { class: "pcard-title", id: titleId }, h("a", { class: "pcard-link", href: m.href }, p.name))),
        priceEl(p),
        extras.length ? h("div", { class: "pcard-extras" }, extras.map((t) => h("p", {}, t))) : null,
        h("div", { class: "pcard-opts" },
          m.colors.all.length ? h("p", { class: "pcard-line" }, h("span", { class: "pcard-k" }, "Cores"), h("span", { class: "pcard-colors" }, m.colors.shown.join(" · ") + more(m.colors.extra))) : null,
          m.sizes.all.length ? h("div", { class: "pcard-line" }, h("span", { class: "pcard-k" }, "Tam."),
            h("ul", { class: "pcard-sizes", "aria-label": "Tamanhos disponíveis" },
              m.sizes.shown.map((sz) => h("li", {}, sz)), m.sizes.extra ? h("li", { class: "more" }, `+${m.sizes.extra}`) : null)) : null,
          h("p", { class: `pcard-stock stock-${m.stock.state}` }, m.stock.state === "out" ? "Esgotado no momento" : m.stock.label)),
        h("span", { class: "pcard-cta", "aria-hidden": "true" }, m.ctaLabel))));
}

export const loadingGrid = () => h("div", { class: "skeleton", "aria-busy": "true", "aria-label": "Carregando" }, [1, 2, 3, 4].map(() => h("div")));

export function stateBlock(title, text, action) {
  return h("div", { class: "state", role: "status" }, h("h2", {}, title), h("p", {}, text), action ?? null);
}
