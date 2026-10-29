import { h, setChildren } from "../lib/dom.js";
import { colorsOf, sizesOfColor, inStock, cartLine, isSoldOut } from "../lib/catalog.js";
import { MAX_QTY_PER_VARIANT } from "../lib/cart.js";
import { imageEl, priceEl, loadingGrid, stateBlock } from "./common.js";
import { productShareView } from "./product-share.js";

export function productView(ctx, slug) {
  const root = h("div", { class: "wrap" }, loadingGrid());
  ctx.load().then(render, () => root.replaceChildren(stateBlock("Não foi possível carregar a peça", "Verifique sua conexão e tente novamente.", h("a", { class: "btn secondary", href: "#/" }, "Voltar à loja"))));

  function render() {
    const p = ctx.products.find((x) => x.slug === slug || x.previous_slugs?.includes(slug));
    if (!p) { root.replaceChildren(stateBlock("Peça não encontrada", "Ela pode ter saído da coleção.", h("a", { class: "btn secondary", href: "#/" }, "Voltar à loja"))); return; }
    document.title = `${p.name} — ${ctx.settings.store_name || "Francine Furini Store"}`;

    const colors = colorsOf(p);
    let color = (colors.find((c) => c.available) ?? colors[0])?.color ?? "";
    let size = "";
    let qty = 1;
    let imgIdx = 0;
    let note = "";

    const pickSize = () => {
      const vs = sizesOfColor(p, color);
      size = vs.find((v) => v.size === size && inStock(v))?.size ?? vs.find(inStock)?.size ?? vs[0]?.size ?? "";
    };
    pickSize();
    const current = () => sizesOfColor(p, color).find((v) => v.size === size);
    const inCart = () => ctx.cart.get().items.find((i) => i.variant_id === current()?.id)?.quantity ?? 0;
    const room = () => Math.max(0, Math.min(current()?.quantity ?? 0, MAX_QTY_PER_VARIANT) - inCart());

    const gallery = h("div", { class: "gallery" });
    const info = h("div", { class: "info" });
    const share = productShareView(p);
    root.replaceChildren(
      h("nav", { class: "crumbs", "aria-label": "Você está em" }, h("a", { href: "#/" }, "Início"), " / ", p.name),
      h("div", { class: "product" }, gallery, info));

    function draw() {
      const v = current();
      const imgs = p.images;
      const cur = imgs[imgIdx];
      setChildren(gallery,
        h("div", { class: "main" }, imageEl(ctx.api.imageUrl(cur?.storage_path), cur?.alt_text || p.name, p.name)),
        imgs.length > 1 ? h("div", { class: "thumbs", role: "group", "aria-label": "Fotos" }, imgs.map((im, i) =>
          h("button", { type: "button", "aria-current": String(i === imgIdx), "aria-label": `Foto ${i + 1} de ${imgs.length}`, onclick: () => { imgIdx = i; draw(); } },
            imageEl(ctx.api.imageUrl(im.storage_path), "", ""))) ) : null);

      const sold = isSoldOut(p);
      const r = room();
      if (qty > Math.max(1, r)) qty = Math.max(1, r);
      let stockText = "";
      if (sold) stockText = "Esta peça está esgotada no momento.";
      else if (!v || !inStock(v)) stockText = "Combinação esgotada. Escolha outro tamanho ou cor.";
      else if (v.quantity <= 3) stockText = `Restam apenas ${v.quantity} unidade(s).`;
      if (note) stockText = note;

      setChildren(info,
        h("p", { class: "eyebrow" }, ctx.categories.find((c) => c.id === p.category_id)?.name ?? ""),
        h("h1", {}, p.name), priceEl(p),
        colors.length > 1 || colors[0] ? h("div", { class: "opt-group" }, h("span", { class: "label", id: "lbl-cor" }, `Cor: ${color}`),
          h("div", { class: "opts", role: "group", "aria-labelledby": "lbl-cor" }, colors.map((c) =>
            h("button", { type: "button", class: "opt", "aria-pressed": String(c.color === color), title: c.available ? "" : "Esgotada",
              onclick: () => { color = c.color; pickSize(); qty = 1; note = ""; draw(); } }, c.color)))) : null,
        h("div", { class: "opt-group" }, h("span", { class: "label", id: "lbl-tam" }, `Tamanho: ${size}`),
          h("div", { class: "opts", role: "group", "aria-labelledby": "lbl-tam" }, sizesOfColor(p, color).map((sv) =>
            h("button", { type: "button", class: "opt", "aria-pressed": String(sv.size === size), disabled: !inStock(sv),
              "aria-label": inStock(sv) ? sv.size : `${sv.size} (esgotado)`,
              onclick: () => { size = sv.size; qty = 1; note = ""; draw(); } }, sv.size)))),
        h("div", { class: "opt-group" }, h("span", { class: "label" }, "Quantidade"),
          h("div", { class: "stepper" },
            h("button", { type: "button", "aria-label": "Diminuir", disabled: qty <= 1, onclick: () => { qty--; draw(); } }, "−"),
            h("output", { "aria-live": "polite" }, String(qty)),
            h("button", { type: "button", "aria-label": "Aumentar", disabled: qty >= r, onclick: () => { qty++; draw(); } }, "+")),
          h("p", { class: "stock-note", role: "status" }, stockText)),
        h("div", { class: "buy-row" },
          h("button", { type: "button", class: "btn block", disabled: r < 1 || !v,
            onclick: () => {
              const res = ctx.cart.add(cartLine(p, v, ctx.api.imageUrl(p.images[0]?.storage_path)), qty);
              note = res.limited ? "Quantidade ajustada ao estoque disponível." : "Adicionado ao carrinho.";
              qty = 1; draw();
            } }, v && inStock(v) ? (r < 1 ? "Máximo no carrinho" : "Adicionar ao carrinho") : "Esgotado"),
          inCart() > 0 ? h("a", { class: "btn secondary block", href: "#/carrinho" }, `Ver carrinho (${inCart()} desta peça)`) : null),
        share,
        p.description ? h("p", { class: "desc" }, p.description) : null,
        h("dl", {}, p.fabric ? [h("dt", {}, "Tecido"), h("dd", {}, p.fabric)] : null),
        h("p", { class: "muted", style: "font-size:.875rem" }, "O frete é calculado pela Francine após o pedido, e o pagamento é combinado diretamente com ela."));
    }
    draw();
  }
  return root;
}
