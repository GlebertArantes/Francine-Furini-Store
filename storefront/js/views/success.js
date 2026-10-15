import { h } from "../lib/dom.js";
import { whatsappUrl } from "../lib/checkout.js";

export function successView(ctx) {
  const order = ctx.order;
  if (!order) { queueMicrotask(() => ctx.navigate("#/")); return h("div"); }
  const wa = whatsappUrl(ctx.settings.whatsapp_number, order.display_code);
  document.title = `Pedido ${order.display_code} — ${ctx.settings.store_name || "Francine Furini Store"}`;
  return h("div", { class: "wrap" }, h("div", { class: "success" },
    h("p", { class: "eyebrow" }, "Pedido recebido"),
    h("h1", {}, "Obrigada pela sua solicitação"),
    h("div", { class: "code", "aria-label": `Código do pedido ${order.display_code}` }, order.display_code),
    h("p", {}, "Guarde este código. ", h("strong", {}, "A Francine calculará o frete e entrará em contato para fechar o pagamento manualmente."), " Nenhum valor foi cobrado."),
    h("div", { class: "actions" },
      wa ? h("a", { class: "btn", href: wa, target: "_blank", rel: "noopener noreferrer" }, "Falar com a Francine no WhatsApp") : null,
      h("a", { class: "btn secondary", href: "#/" }, "Voltar à loja"))));
}
