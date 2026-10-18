import { h } from "../lib/dom.js";

export const STEPS = [
  ["Escolha suas peças", "Navegue pela coleção e veja os detalhes de cada peça."],
  ["Selecione tamanho e cor", "Escolha a combinação disponível e adicione ao carrinho."],
  ["Registre sua solicitação", "Informe nome, WhatsApp e endereço de entrega. O pedido será registrado na loja."],
  ["Envie pelo WhatsApp", "Após registrar, toque em Enviar pedido pelo WhatsApp. A Francine calcula o frete, combina o pagamento e conclui a venda manualmente."],
];

export const NOTICE = "Importante: enviar a solicitação não é confirmação de pagamento nem reserva de estoque. A venda só é concluída depois que a loja confirmar o pagamento combinado com você.";

/** Bloco compacto "Como comprar" (usado na home e na página própria). */
export function howToBuySection({ asPage = false } = {}) {
  return h(asPage ? "article" : "section", { class: `how${asPage ? " how-page" : ""}`, id: "como-comprar", "aria-labelledby": "how-title" },
    h("p", { class: "eyebrow" }, "Passo a passo"),
    h(asPage ? "h1" : "h2", { id: "how-title" }, "Como comprar"),
    h("ol", { class: "steps" }, STEPS.map(([title, text]) => h("li", {}, h("strong", {}, title), h("span", {}, text)))),
    h("p", { class: "how-note" }, NOTICE));
}

export function howToBuyView() {
  return h("div", { class: "wrap section" }, howToBuySection({ asPage: true }), h("p", {}, h("a", { class: "btn secondary", href: "#/" }, "Ver coleção")));
}
