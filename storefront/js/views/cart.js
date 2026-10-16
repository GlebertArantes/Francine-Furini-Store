import { h, setChildren } from "../lib/dom.js";
import { formatBRL } from "../lib/format.js";
import { subtotalCents, describeChange, MAX_QTY_PER_VARIANT } from "../lib/cart.js";
import { imageEl, stateBlock, loadingGrid } from "./common.js";

export function changesNotice(changes) {
  if (!changes.length) return null;
  return h("div", { class: "notice", role: "status" }, "Atualizamos seu carrinho com a disponibilidade atual:",
    h("ul", {}, changes.map((c) => h("li", {}, describeChange(c)))));
}

export function cartView(ctx) {
  const root = h("div", { class: "wrap page" }, loadingGrid());
  let changes = [];
  let loadError = false;
  const sync = ctx.cart.get().items.length ? ctx.refreshCart().then((c) => { changes = c; }, () => { loadError = true; }) : Promise.resolve();
  sync.then(draw);

  function draw() {
    const state = ctx.cart.get();
    if (!state.items.length) {
      setChildren(root, h("h1", {}, "Seu carrinho"), changesNotice(changes),
        stateBlock("Seu carrinho está vazio", "Escolha uma peça para começar.", h("a", { class: "btn", href: "#/" }, "Ver coleção")));
      return;
    }
    setChildren(root, h("h1", {}, "Seu carrinho"),
      loadError ? h("p", { class: "notice error", role: "alert" }, "Não foi possível conferir o estoque agora. Revisaremos novamente ao finalizar.") : null,
      changesNotice(changes),
      h("div", { class: "cart-grid" },
        h("ul", { class: "lines" }, state.items.map((i) => h("li", { class: "line" },
          h("a", { class: "thumb", href: `#/produto/${encodeURIComponent(i.ref.slug)}` }, imageEl(i.ref.image, i.ref.name, i.ref.name)),
          h("div", {}, h("h3", {}, i.ref.name), h("p", { class: "meta" }, `${i.ref.color} · Tam. ${i.ref.size} · ${formatBRL(i.ref.price_cents)}`),
            h("div", { class: "row" },
              h("div", { class: "stepper" },
                h("button", { type: "button", "aria-label": `Diminuir ${i.ref.name}`, onclick: () => { ctx.cart.setQuantity(i.variant_id, i.quantity - 1); draw(); } }, "−"),
                h("output", {}, String(i.quantity)),
                h("button", { type: "button", "aria-label": `Aumentar ${i.ref.name}`, disabled: i.quantity >= Math.min(i.stock, MAX_QTY_PER_VARIANT), onclick: () => { ctx.cart.setQuantity(i.variant_id, i.quantity + 1); draw(); } }, "+")),
              h("button", { type: "button", class: "link-btn", onclick: () => { ctx.cart.remove(i.variant_id); draw(); } }, "Remover")))))),
        h("aside", { class: "summary" }, h("h2", {}, "Resumo"),
          h("div", { class: "tot" }, h("span", {}, "Subtotal"), h("strong", {}, formatBRL(subtotalCents(state)))),
          h("p", {}, "Valores de referência. O frete será calculado pela Francine depois do pedido, e o pagamento é combinado diretamente com ela."),
          h("a", { class: "btn block", href: "#/checkout" }, "Finalizar pedido"),
          h("p", { style: "text-align:center" }, h("a", { href: "#/" }, "Continuar comprando")))));
  }
  return root;
}
