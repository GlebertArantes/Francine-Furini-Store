// "Prévia na vitrine": espelha o card e um resumo da página do produto. Só leitura: nenhuma chamada à API.
import { h } from "../lib/dom.js";
import { formatBRL } from "../lib/money.js";
import { previewSummary } from "../lib/preview-model.js";
import { colorsOf, sizesOfColor, inStock, isSoldOut } from "../lib/shared/catalog.js";

const thumb = (url, alt, name) => (url ? h("img", { src: url, alt, decoding: "async" }) : h("div", { class: "noimg", role: "img", "aria-label": name }, name));

function priceLine(sum) {
  if (!sum.price) return h("p", { class: "price" }, h("span", { class: "muted" }, "Preço a definir"));
  return h("p", { class: "price" },
    sum.price.onSale ? h("s", {}, h("span", { class: "sr-only" }, "Preço anterior "), formatBRL(sum.price.compareAt)) : null,
    h("span", { class: "now" }, h("span", { class: "sr-only" }, sum.price.onSale ? "Preço promocional " : "Preço "), formatBRL(sum.price.price)));
}

function cardPreview(sum) {
  const m = sum.card, p = sum.product, more = (n) => (n > 0 ? ` +${n}` : "");
  return h("article", { class: `pcard${m.soldOut ? " is-soldout" : ""}`, "aria-label": "Prévia do card" },
    h("div", { class: "pcard-media" }, thumb(m.imageUrl, m.imageAlt, p.name),
      m.onSale || m.featured ? h("div", { class: "pcard-badges" }, m.onSale ? h("span", { class: "pcard-badge sale" }, "Promoção") : null, m.featured ? h("span", { class: "pcard-badge featured" }, "Destaque") : null) : null,
      m.soldOut ? h("span", { class: "pcard-tag" }, "Esgotado") : null,
      m.showPhotoCount ? h("span", { class: "pcard-count" }, `${m.photoCount} fotos`) : null),
    h("div", { class: "pcard-body" },
      h("div", { class: "pcard-head" }, m.category ? h("p", { class: "pcard-cat" }, m.category) : null, h("h3", { class: "pcard-title" }, p.name)),
      priceLine(sum),
      h("div", { class: "pcard-opts" },
        m.colors.all.length ? h("p", { class: "pcard-line" }, h("span", { class: "pcard-k" }, "Cores"), h("span", { class: "pcard-colors" }, m.colors.shown.join(" · ") + more(m.colors.extra))) : null,
        m.sizes.all.length ? h("div", { class: "pcard-line" }, h("span", { class: "pcard-k" }, "Tam."), h("ul", { class: "pcard-sizes", "aria-label": "Tamanhos disponíveis" }, m.sizes.shown.map((s) => h("li", {}, s)), m.sizes.extra ? h("li", { class: "more" }, `+${m.sizes.extra}`) : null)) : null,
        h("p", { class: `pcard-stock stock-${m.stock.state}` }, m.stock.state === "out" ? "Esgotado no momento" : m.stock.label)),
      h("span", { class: "pcard-cta", "aria-hidden": "true" }, m.ctaLabel)));
}

function pagePreview(sum) {
  const p = sum.product, imgs = p.images;
  const colors = colorsOf(p);
  const sold = isSoldOut(p);
  return h("article", { class: "pv-page", "aria-label": "Prévia da página do produto" },
    h("div", { class: "pv-gallery" }, h("div", { class: "pv-main" }, thumb(imgs[0]?.storage_path, imgs[0]?.alt_text ?? "", p.name)),
      imgs.length > 1 ? h("div", { class: "pv-thumbs" }, imgs.slice(0, 6).map((im, i) => h("div", { class: "pv-thumb" }, thumb(im.storage_path, im.alt_text || `Foto ${i + 1}`, p.name))), imgs.length > 6 ? h("span", { class: "muted small" }, `+${imgs.length - 6}`) : null) : null),
    h("div", { class: "pv-info" },
      sum.card.category ? h("p", { class: "pcard-cat" }, sum.card.category) : null,
      h("h3", { class: "pv-title" }, p.name), priceLine(sum),
      colors.length ? h("div", { class: "pv-opts" }, colors.map((c) => h("div", { class: "pv-optline" }, h("span", { class: "pcard-k" }, c.color),
        h("ul", { class: "pcard-sizes", "aria-label": `Tamanhos de ${c.color}` }, sizesOfColor(p, c.color).map((s) => h("li", { class: inStock(s) ? "" : "out" }, inStock(s) ? s.size : `${s.size} (esgotado)`)))))) : null,
      h("button", { type: "button", class: "pv-buy", disabled: true }, sold ? "Esgotado" : "Adicionar ao carrinho"),
      p.description ? h("p", { class: "pv-desc" }, p.description) : null,
      p.fabric ? h("dl", { class: "pv-dl" }, h("dt", {}, "Tecido"), h("dd", {}, p.fabric)) : null,
      h("p", { class: "muted small" }, "O frete é calculado pela Francine após o pedido, e o pagamento é combinado diretamente com ela.")));
}

/** Painel de prévia. `update({values, existing, images, categories})` redesenha (chamado a cada alteração do formulário). */
export function createPreviewPanel() {
  const status = h("p", { class: "pv-status", role: "status", "aria-live": "polite" });
  const notes = h("ul", { class: "pv-notes" });
  const body = h("div", { class: "pv-body" });
  let tab = "card";
  const tabBtn = (id, label) => h("button", { type: "button", class: "pv-tab", role: "tab", "data-tab": id, onclick: () => { tab = id; sync(); } }, label);
  const tabs = h("div", { class: "pv-tabs", role: "tablist", "aria-label": "Tipo de prévia" }, tabBtn("card", "Card da coleção"), tabBtn("page", "Página do produto"));
  const root = h("section", { class: "pv", "aria-labelledby": "pv-h" }, h("h2", { id: "pv-h", class: "pv-h" }, "Prévia na vitrine"), status, tabs, body, notes,
    h("p", { class: "muted small" }, "Simulação com o visual da loja. Nada é salvo nem publicado por aqui."));
  let last = null;
  const sync = () => {
    for (const b of tabs.children) b.setAttribute("aria-selected", String(b.getAttribute("data-tab") === tab));
    if (!last) return;
    body.replaceChildren(tab === "card" ? cardPreview(last) : pagePreview(last));
  };
  return {
    el: root,
    update(input) {
      last = previewSummary(input);
      status.className = `pv-status${last.dirty ? " dirty" : ""}`;
      status.replaceChildren(h("strong", {}, input.existing ? (last.dirty ? "Alterações ainda não salvas" : "Igual ao que está salvo") : "Rascunho — nada foi salvo"),
        h("span", {}, ` · ${last.visibility.label}`));
      notes.replaceChildren(...last.notes.map((n) => h("li", {}, n)));
      sync();
    },
  };
}
