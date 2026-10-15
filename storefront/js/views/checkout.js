import { h } from "../lib/dom.js";
import { formatBRL, formatCep, formatPhone } from "../lib/format.js";
import { subtotalCents } from "../lib/cart.js";
import { validateCustomer, createOrderPlacer, postOrder, needsCartRefresh, errorMessage, UF_LIST } from "../lib/checkout.js";
import { changesNotice } from "./cart.js";
import { stateBlock, loadingGrid } from "./common.js";

export function checkoutView(ctx) {
  const root = h("div", { class: "wrap page" }, loadingGrid());
  let changes = [];

  const place = createOrderPlacer({
    cartStore: ctx.cart,
    send: (payload) => postOrder({ fetchFn: (u, i) => fetch(u, i), url: ctx.cfg.createOrderUrl, payload }),
  });

  const start = ctx.cart.get().items.length ? ctx.refreshCart().then((c) => { changes = c; }, () => {}) : Promise.resolve();
  start.then(draw);

  function draw(banner, saved) {
    const state = ctx.cart.get();
    if (!state.items.length) {
      root.replaceChildren(h("h1", {}, "Finalizar pedido"), changesNotice(changes),
        stateBlock("Seu carrinho está vazio", "Adicione uma peça para continuar.", h("a", { class: "btn", href: "#/" }, "Ver coleção")));
      return;
    }
    const f = (name, label, attrs = {}, cls = "") => h("div", { class: `field ${cls}` }, h("label", { for: `c-${name}` }, label),
      attrs.tag === "textarea" ? h("textarea", { id: `c-${name}`, name, maxlength: attrs.maxlength, rows: 3 }) :
      h("input", { id: `c-${name}`, name, type: "text", ...attrs }), h("p", { class: "err", id: `e-${name}`, role: "alert" }));

    const submit = h("button", { type: "submit", class: "btn block" }, "Enviar pedido");
    const msg = h("div", { "aria-live": "polite" });
    if (banner) msg.append(banner);
    if (changes.length) msg.append(changesNotice(changes));

    const form = h("form", { novalidate: true, autocomplete: "on" },
      msg,
      h("div", { class: "form-grid" },
        f("name", "Nome completo", { autocomplete: "name", required: true, maxlength: 160 }),
        f("phone", "WhatsApp (com DDD)", { type: "tel", inputmode: "tel", autocomplete: "tel", required: true, maxlength: 20 }, "c3"),
        f("postal_code", "CEP", { inputmode: "numeric", autocomplete: "postal-code", required: true, maxlength: 9 }, "c3"),
        f("address_line", "Endereço", { autocomplete: "address-line1", required: true, maxlength: 220 }, "c4"),
        f("address_number", "Número", { autocomplete: "off", required: true, maxlength: 30 }, "c2"),
        f("address_complement", "Complemento (opcional)", { autocomplete: "address-line2", maxlength: 120 }),
        f("neighborhood", "Bairro", { autocomplete: "address-level3", required: true, maxlength: 120 }, "c3"),
        f("city", "Cidade", { autocomplete: "address-level2", required: true, maxlength: 120 }, "c2"),
        h("div", { class: "field c1", style: "grid-column: span 6" }, h("label", { for: "c-state" }, "Estado"),
          h("select", { id: "c-state", name: "state", required: true, autocomplete: "address-level1" }, h("option", { value: "" }, "Selecione"), UF_LIST.map((u) => h("option", { value: u }, u))),
          h("p", { class: "err", id: "e-state", role: "alert" })),
        f("note", "Observação (opcional)", { tag: "textarea", maxlength: 500 })),
      h("p", { class: "muted", style: "font-size:.875rem" }, "Ao enviar, a Francine calculará o frete e entrará em contato para fechar o pagamento manualmente. Nada é cobrado agora."),
      submit);

    if (saved) for (const [k, v] of Object.entries(saved)) if (form.elements[k]) form.elements[k].value = v;
    form.elements.phone.addEventListener("blur", (e) => { e.target.value = formatPhone(e.target.value); });
    form.elements.postal_code.addEventListener("input", (e) => { e.target.value = formatCep(e.target.value); });

    const showErrors = (errors = {}) => {
      for (const el of form.elements) {
        if (!el.name) continue;
        const p = form.querySelector(`#e-${el.name}`);
        if (p) p.textContent = errors[el.name] ?? "";
        if (errors[el.name]) el.setAttribute("aria-invalid", "true"); else el.removeAttribute("aria-invalid");
      }
    };

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const raw = Object.fromEntries(new FormData(form));
      const v = validateCustomer(raw);
      showErrors(v.errors);
      if (!v.ok) { form.querySelector('[aria-invalid="true"]')?.focus(); return; }
      submit.disabled = true; submit.setAttribute("aria-busy", "true"); submit.textContent = "Enviando…";
      const result = await place(raw);
      if (result.skipped) return;
      if (result.ok) {
        ctx.setOrder(result.order);
        ctx.navigate("#/pedido");
        return;
      }
      if (result.code === "validation") { showErrors(result.errors); }
      if (needsCartRefresh(result.code)) {
        try { changes = await ctx.refreshCart(); } catch { /* mantém aviso */ }
        draw(h("p", { class: "notice error", role: "alert" }, errorMessage(result.code)), raw);
        return;
      }
      submit.disabled = false; submit.removeAttribute("aria-busy"); submit.textContent = "Enviar pedido";
      msg.replaceChildren(h("p", { class: "notice error", role: "alert" }, result.message ?? "Confira os campos destacados.")); if (changes.length) msg.append(changesNotice(changes));
      msg.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });

    root.replaceChildren(h("h1", {}, "Finalizar pedido"),
      h("div", { class: "cart-grid" }, form,
        h("aside", { class: "summary" }, h("h2", {}, "Seu pedido"),
          h("ul", { class: "lines" }, state.items.map((i) => h("li", { class: "line", style: "grid-template-columns:1fr auto;padding:.6rem 0" },
            h("div", {}, h("strong", {}, i.ref.name), h("div", { class: "meta", style: "margin:0" }, `${i.ref.color} · Tam. ${i.ref.size} · ${i.quantity}×`)),
            h("span", {}, formatBRL(i.ref.price_cents * i.quantity))))),
          h("div", { class: "tot" }, h("span", {}, "Subtotal (referência)"), h("strong", {}, formatBRL(subtotalCents(state)))),
          h("p", {}, "Preços e estoque são conferidos pela loja ao receber o pedido. Frete a combinar."),
          h("a", { href: "#/carrinho" }, "Voltar ao carrinho"))));
  }
  return root;
}
