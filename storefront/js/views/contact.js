import { h } from "../lib/dom.js";
import { icon } from "../lib/icons.js";

export const VIP_GROUP_URL = "https://chat.whatsapp.com/BTfFPclRbd8GpZSt9MuiaJ";

// Usa exclusivamente o contato configurado da Francine, sem copiar números de outra loja.
export function contactUrl(number) {
  const digits = String(number ?? "").replace(/\D/g, "");
  if (!/^\d{10,15}$/.test(digits)) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent("Olá, Fran! Vim pelo site e gostaria de tirar uma dúvida.")}`;
}

export function floatingContactView() {
  const root = h("div", { class: "contact-float hidden" });
  return {
    root,
    update(settings, route = "/") {
      const url = contactUrl(settings?.whatsapp_number);
      // A finalização já tem seu caminho próprio para a conversa sobre o pedido.
      const visible = !!url && !/^\/(carrinho|checkout|pedido)(\/|$)/.test(route);
      root.className = `contact-float${visible ? "" : " hidden"}`;
      root.replaceChildren();
      if (!visible) return;
      root.append(h("a", { class: "contact-float-link", href: url, target: "_blank", rel: "noopener noreferrer",
        "aria-label": "Falar com a Fran pelo WhatsApp (abre em nova aba)", title: "Falar com a Fran pelo WhatsApp" },
        h("span", { class: "contact-float-label", "aria-hidden": "true" }, "Fale com a Fran"),
        h("span", { class: "contact-float-icon", "aria-hidden": "true" }, icon("whatsapp"))));
    },
  };
}

export function vipInviteSection() {
  return h("section", { class: "wrap vip-invite", "aria-labelledby": "vip-invite-title" },
    h("div", { class: "vip-invite-panel" },
      h("div", { class: "vip-invite-emblem", "aria-hidden": "true" }, icon("whatsapp"), h("span", { class: "vip-invite-lock" }, icon("lock"))),
      h("div", { class: "vip-invite-copy" },
        h("p", { class: "vip-invite-eyebrow" }, "UM CONVITE DA FRAN"),
        h("h2", { id: "vip-invite-title" }, "As novidades da Fran, direto no seu WhatsApp."),
        h("p", {}, "Entre no nosso grupo VIP para acompanhar os lançamentos e as peças que chegam à loja."),
        h("ul", { class: "vip-invite-benefits", "aria-label": "No grupo VIP" },
          h("li", {}, "Novidades da loja"), h("li", {}, "Lançamentos"), h("li", {}, "Mais perto da Fran"))),
      h("div", { class: "vip-invite-action" },
        h("a", { class: "vip-invite-button", href: VIP_GROUP_URL, target: "_blank", rel: "noopener noreferrer" },
          icon("lock"), "entre no GRUPO VIP", h("span", { "aria-hidden": "true" }, "↗"), h("span", { class: "sr-only" }, " (abre em nova aba)")),
        h("small", {}, "Toque para abrir o convite no WhatsApp."))));
}
