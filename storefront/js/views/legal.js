import { h } from "../lib/dom.js";

const updated = "17 de outubro de 2026";
const cnpj = "31.185.840/0001-08";

function contactBlock(ctx) {
  const phone = String(ctx.settings?.whatsapp_number || "").replace(/\D/g, "");
  const instagram = ctx.settings?.instagram_url;
  const links = [];
  if (phone) links.push(h("a", { href: `https://wa.me/${phone}`, target: "_blank", rel: "noopener noreferrer" }, "WhatsApp da loja"));
  if (instagram && /^https:\/\//.test(instagram)) links.push(h("a", { href: instagram, target: "_blank", rel: "noopener noreferrer" }, "Instagram da loja"));
  return h("p", {}, "Para dúvidas ou solicitações sobre seus dados, fale pelos canais oficiais exibidos no site", links.length ? ": " : ".", ...links.flatMap((a, i) => [i ? " · " : " ", a]), ".");
}

function privacy(ctx) {
  return h("article", { class: "legal-page" },
    h("p", { class: "eyebrow" }, "Informações legais"),
    h("h1", {}, "Política de Privacidade"),
    h("p", { class: "legal-updated" }, `Última atualização: ${updated}.`),
    h("p", {}, `Responsável pelo atendimento: Francine Furini Store — CNPJ ${cnpj}.`),
    h("p", {}, "A Francine Furini Store utiliza os dados informados no checkout principalmente para receber e atender solicitações de compra, calcular o frete manualmente, entrar em contato com a cliente e manter os registros necessários da operação."),
    h("h2", {}, "Dados coletados"),
    h("p", {}, "Podem ser coletados nome, número de WhatsApp, CEP, endereço, número, complemento, bairro, cidade, estado, observações do pedido e informações sobre os itens solicitados."),
    h("h2", {}, "Como usamos os dados"),
    h("ul", {},
      h("li", {}, "identificar a solicitação e os itens escolhidos;"),
      h("li", {}, "calcular e informar o frete;"),
      h("li", {}, "entrar em contato para combinar pagamento e entrega;"),
      h("li", {}, "controlar pedidos, atendimento e estoque;"),
      h("li", {}, "cumprir obrigações legais e manter registros comerciais quando aplicável.")),
    h("h2", {}, "Dados no navegador"),
    h("p", {}, "A loja usa armazenamento local do navegador para manter o carrinho e armazenamento de sessão para lembrar o código do último pedido durante a navegação. Esses dados de interface não substituem o registro oficial do pedido no banco da loja."),
    h("h2", {}, "Armazenamento e segurança"),
    h("p", {}, "Os dados são armazenados em infraestrutura de banco de dados e serviços contratados pela loja. São adotados controles de acesso e medidas técnicas para reduzir acesso, alteração ou divulgação indevidos. Nenhum sistema conectado à internet pode oferecer risco zero."),
    h("h2", {}, "Compartilhamento"),
    h("p", {}, "Os dados não são vendidos. Eles podem ser tratados por prestadores de infraestrutura essenciais ao funcionamento da loja e, quando necessário, por serviços envolvidos na entrega, atendimento ou cumprimento de obrigações legais."),
    h("h2", {}, "Prazo e direitos"),
    h("p", {}, "Os registros são mantidos pelo período necessário para atendimento, segurança da operação e obrigações aplicáveis. Você pode solicitar informações, correção ou exclusão quando cabível, observados os registros que a loja precise manter por obrigação legal ou defesa de direitos."),
    h("h2", {}, "Contato"),
    contactBlock(ctx),
    h("p", { class: "legal-note" }, "Esta página descreve o funcionamento da V1 da loja e pode ser atualizada quando novos recursos ou integrações forem adicionados."));
}

function terms(ctx) {
  return h("article", { class: "legal-page" },
    h("p", { class: "eyebrow" }, "Informações legais"),
    h("h1", {}, "Termos de Uso e Compra"),
    h("p", { class: "legal-updated" }, `Última atualização: ${updated}.`),
    h("p", {}, `Loja: Francine Furini Store — CNPJ ${cnpj}.`),
    h("p", {}, "Este site funciona como uma vitrine digital e canal de solicitação de compra da Francine Furini Store. Na V1, frete e pagamento são combinados manualmente após o envio do pedido."),
    h("h2", {}, "Solicitação de compra"),
    h("p", {}, "Ao enviar o checkout, a cliente registra uma solicitação com os itens selecionados. O envio não realiza cobrança automática e não significa confirmação definitiva de pagamento ou entrega."),
    h("h2", {}, "Estoque"),
    h("p", {}, "A criação da solicitação não reserva estoque. A disponibilidade é conferida novamente durante o atendimento e o estoque é baixado quando a venda é concluída pela loja. Em situações de disputa pela última unidade, a loja entrará em contato para orientar a cliente."),
    h("h2", {}, "Preços e frete"),
    h("p", {}, "Os preços exibidos são conferidos pela loja ao receber a solicitação. O frete é calculado manualmente com base nos dados de entrega e informado antes do fechamento do pagamento."),
    h("h2", {}, "Pagamento"),
    h("p", {}, "A V1 não processa pagamento dentro do site. A cobrança é combinada diretamente com a cliente por canal oficial da Francine Furini Store."),
    h("h2", {}, "Atendimento, cancelamentos e direitos da cliente"),
    h("p", {}, "Pedidos podem ser ajustados ou cancelados durante o atendimento conforme o estágio da compra. Os direitos previstos na legislação aplicável ao consumidor permanecem preservados. Quando necessário, a loja orientará a cliente sobre troca, devolução, arrependimento ou reembolso conforme o caso concreto."),
    h("h2", {}, "Uso do site"),
    h("p", {}, "Não utilize dados falsos, tente manipular preços ou estoque, acessar áreas administrativas sem autorização ou interferir no funcionamento da loja."),
    h("h2", {}, "Contato"),
    contactBlock(ctx),
    h("p", { class: "legal-note" }, "Integrações automáticas de frete e pagamento não fazem parte desta versão e, quando adicionadas, estes termos poderão ser atualizados."));
}

export function legalView(ctx, kind) {
  const content = kind === "termos" ? terms(ctx) : privacy(ctx);
  return h("div", { class: "wrap page legal-wrap" }, content,
    h("p", { class: "legal-back" }, h("a", { href: "#/" }, "← Voltar à loja")));
}
