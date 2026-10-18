import { h } from "../lib/dom.js";
import { whatsappUrl } from "../lib/checkout.js";

export function successView(ctx) {
  const order = ctx.order;
  if (!order) { queueMicrotask(() => ctx.navigate("#/")); return h("div"); }
  // Após recarregar a página, só o código é recuperado; dados pessoais não persistem no navegador.
  const hasDetails = Boolean(order.whatsapp_message);
  const wa = whatsappUrl(ctx.settings.whatsapp_number, order.display_code, order.whatsapp_message);
  document.title = `Pedido ${order.display_code} — ${ctx.settings.store_name || "Francine Furini Store"}`;
  return h("div", { class: "wrap" }, h("div", { class: "success" },
    h("p", { class: "eyebrow" }, "Pedido registrado — pagamento pendente"),
    h("h1", {}, "Seu pedido foi registrado!"),
    h("div", { class: "code", "aria-label": `Código do pedido ${order.display_code}` }, order.display_code),
    h("p", {}, hasDetails
      ? "Agora toque no botão abaixo e envie o resumo à Francine pelo WhatsApp. A mensagem já inclui suas peças, seu contato e endereço. Ela calculará o frete e combinará o pagamento diretamente com você."
      : "Seu pedido permanece registrado. Envie o código à Francine pelo WhatsApp para que ela consulte os itens e o endereço no painel e informe o frete."),
    h("p", { class: "muted" }, "A solicitação não é pagamento nem reserva de estoque. Nenhum valor foi cobrado."),
    h("div", { class: "actions" },
      wa ? h("a", { class: "btn", href: wa, target: "_blank", rel: "noopener noreferrer" }, hasDetails ? "Enviar pedido pelo WhatsApp" : "Enviar código pelo WhatsApp") : null,
      h("a", { class: "btn secondary", href: "#/" }, "Voltar à loja"))));
}
