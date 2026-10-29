import { attemptStore } from "../lib/attempts.js";
import { h, setChildren } from "../lib/dom.js";
import { formatBRL, formatCep, formatPhone } from "../lib/format.js";
import { subtotalCents } from "../lib/cart.js";
import { validateCustomer, createOrderPlacer, postOrder, needsCartRefresh, errorMessage, UF_LIST, whatsappOrderMessage } from "../lib/checkout.js";
import { createCepController, lookupCep, CEP_MESSAGES } from "../lib/cep.js";
import { changesNotice } from "./cart.js";
import { stateBlock, loadingGrid } from "./common.js";

export function checkoutView(ctx) {
  const root = h("div", { class: "wrap page" }, loadingGrid());
  let changes = [];
  let recovered = false;

  const place = createOrderPlacer({
    cartStore: ctx.cart,
    attempts: attemptStore({ getItem:k=>globalThis.localStorage?.getItem(k)??null, setItem:(k,v)=>{if(!globalThis.localStorage) throw new Error("storage");localStorage.setItem(k,v);}, removeItem:k=>globalThis.localStorage?.removeItem(k) }, "ff:order-attempt"),
    send: (payload) => postOrder({ fetchFn: (u, i) => fetch(u, i), url: ctx.cfg.createOrderUrl, payload }),
  });

  const start = place.recover().then(result=> {
    if(result?.ok) { recovered=true; ctx.setOrder(result.order); ctx.navigate("#/pedido"); return false; }
    return true;
  }).then(keep=>keep && ctx.cart.get().items.length ? ctx.refreshCart().then((c) => { changes = c; }, () => {}) : Promise.resolve());
  start.then(()=> { if(recovered) return; draw(); });

  function draw(banner, saved) {
    const state = ctx.cart.get();
    if (!state.items.length) {
      setChildren(root, h("h1", {}, "Finalizar pedido"), changesNotice(changes),
        stateBlock("Seu carrinho está vazio", "Adicione uma peça para continuar.", h("a", { class: "btn", href: "#/" }, "Ver coleção")));
      return;
    }
    const f = (name, label, attrs = {}, cls = "") => h("div", { class: `field ${cls}` }, h("label", { for: `c-${name}` }, label),
      attrs.tag === "textarea" ? h("textarea", { id: `c-${name}`, name, maxlength: attrs.maxlength, rows: 3 }) :
      h("input", { id: `c-${name}`, name, type: "text", ...attrs }), h("p", { class: "err", id: `e-${name}`, role: "alert" }));

    const submit = h("button", { type: "submit", class: "btn block" }, "Registrar pedido e continuar");
    const msg = h("div", { "aria-live": "polite" });
    if (banner) msg.append(banner);
    if (changes.length) msg.append(changesNotice(changes));

    const form = h("form", { novalidate: true, autocomplete: "on" },
      msg,
      h("div", { class: "form-grid" },
        f("name", "Nome completo", { autocomplete: "name", required: true, maxlength: 160 }),
        f("phone", "WhatsApp (com DDD)", { type: "tel", inputmode: "tel", autocomplete: "tel", required: true, maxlength: 20 }, "c3"),
        h("div", { class: "field c3" }, h("label", { for: "c-postal_code" }, "CEP"),
          h("input", { id: "c-postal_code", name: "postal_code", type: "text", inputmode: "numeric", autocomplete: "postal-code", required: true, maxlength: 9, "aria-describedby": "e-postal_code cep-status" }),
          h("p", { class: "cep-status", id: "cep-status", role: "status", "aria-live": "polite" }), h("p", { class: "err", id: "e-postal_code", role: "alert" })),
        f("address_line", "Endereço", { autocomplete: "address-line1", required: true, maxlength: 220 }, "c4"),
        f("address_number", "Número", { autocomplete: "off", required: true, maxlength: 30 }, "c2"),
        f("address_complement", "Complemento (opcional)", { autocomplete: "address-line2", maxlength: 120 }),
        f("neighborhood", "Bairro", { autocomplete: "address-level3", required: true, maxlength: 120 }, "c3"),
        f("city", "Cidade", { autocomplete: "address-level2", required: true, maxlength: 120 }, "c2"),
        h("div", { class: "field c1", style: "grid-column: span 6" }, h("label", { for: "c-state" }, "Estado"),
          h("select", { id: "c-state", name: "state", required: true, autocomplete: "address-level1" }, h("option", { value: "" }, "Selecione"), UF_LIST.map((u) => h("option", { value: u }, u))),
          h("p", { class: "err", id: "e-state", role: "alert" })),
        f("note", "Observação (opcional)", { tag: "textarea", maxlength: 500 })),
      h("p", { class: "muted", style: "font-size:.875rem" }, "Primeiro registramos o pedido. Na próxima tela, envie os detalhes à Francine pelo WhatsApp para que ela calcule o frete e combine o pagamento. Nada é cobrado agora."),
      h("p", { class: "legal-consent" }, "Os dados informados serão usados para atender esta solicitação. Ao continuar, você declara que leu a ",
        h("a", { href: "#/privacidade", target: "_blank", rel: "noopener noreferrer" }, "Política de Privacidade"), " e os ",
        h("a", { href: "#/termos", target: "_blank", rel: "noopener noreferrer" }, "Termos de Uso e Compra"), "."),
      submit);

    if (saved) for (const [k, v] of Object.entries(saved)) if (form.elements[k]) form.elements[k].value = v;
    form.elements.phone.addEventListener("blur", (e) => { e.target.value = formatPhone(e.target.value); });
    function clearValidErrors() {
      const errors=validateCustomer(Object.fromEntries(new FormData(form))).errors;
      for(const el of form.elements) if(el.name && !errors[el.name]) {
        const message=form.querySelector(`#e-${el.name}`); if(message) message.textContent="";
        el.removeAttribute("aria-invalid");
      }
    }
    form.addEventListener("input",clearValidErrors);
    form.addEventListener("change",clearValidErrors);
    // ViaCEP: preenche rua/bairro/cidade/UF ao completar 8 dígitos; nunca sobrescreve o que a cliente digitou.
    const cepStatus = form.querySelector("#cep-status");
    const cep = createCepController({
      lookup: ctx.lookupCep ?? ((c, o) => lookupCep(c, o)),
      onStatus: (k) => { clearValidErrors(); cepStatus.textContent = k ? CEP_MESSAGES[k] : ""; cepStatus.dataset.kind = k ?? ""; if (k) form.elements.postal_code.removeAttribute("aria-invalid"); },
      read: (k) => form.elements[k]?.value ?? "",
      fill: (addr) => { for (const [k, v] of Object.entries(addr)) if (form.elements[k]) form.elements[k].value = v; clearValidErrors(); },
      clear: (keys) => { for (const k of keys) if (form.elements[k]) form.elements[k].value = ""; },
    });
    // Valores já presentes (ex.: formulário redesenhado após ajuste de estoque) pertencem à cliente: nunca são sobrescritos.
    for (const k of ["address_line", "neighborhood", "city", "state"]) if (saved?.[k]) cep.touch(k);
    for (const k of ["address_line", "neighborhood", "city", "state"]) form.elements[k].addEventListener(k === "state" ? "change" : "input", () => cep.touch(k));
    form.elements.postal_code.addEventListener("input", (e) => { e.target.value = formatCep(e.target.value); cep.input(e.target.value); });
    if (saved?.postal_code) cep.input(saved.postal_code);

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
      submit.disabled = true; submit.setAttribute("aria-busy", "true"); submit.textContent = "Registrando…";
      // O placer limpa o carrinho ao registrar o pedido. Guardamos apenas um retrato
      // dos itens desta tentativa para compor a mensagem no WhatsApp depois do sucesso.
      const itemsForWhatsApp = ctx.cart.get().items.map((i) => ({
        quantity: i.quantity,
        ref: { name: i.ref.name, color: i.ref.color, size: i.ref.size, price_cents: i.ref.price_cents },
      }));
      const result = await place(raw);
      if (result.skipped) return;
      if (result.ok) {
        ctx.setOrder({
          ...result.order,
          whatsapp_message: whatsappOrderMessage(result.order.display_code, v.value, itemsForWhatsApp),
        });
        ctx.navigate("#/pedido");
        return;
      }
      if (result.code === "validation") { showErrors(result.errors); }
      if (needsCartRefresh(result.code)) {
        try { changes = await ctx.refreshCart(); } catch { /* mantém aviso */ }
        draw(h("p", { class: "notice error", role: "alert" }, errorMessage(result.code)), raw);
        return;
      }
      submit.disabled = false; submit.removeAttribute("aria-busy"); submit.textContent = "Registrar pedido e continuar";
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
