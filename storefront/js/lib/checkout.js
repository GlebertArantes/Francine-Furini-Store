// Regras do checkout V1. Validação aqui é só conveniência: o servidor revalida tudo.
import { formatBRL, formatCep, formatPhone, normalizePhone, onlyDigits } from "./format.js";
import { subtotalCents, toOrderItems } from "./cart.js";

const UFS = "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" ");
export const UF_LIST = UFS;

const squash = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

export function validateCustomer(raw = {}) {
  const value = {
    name: squash(raw.name, 160),
    phone: normalizePhone(raw.phone),
    postal_code: onlyDigits(raw.postal_code),
    address_line: squash(raw.address_line, 220),
    address_number: squash(raw.address_number, 30),
    address_complement: squash(raw.address_complement, 120),
    neighborhood: squash(raw.neighborhood, 120),
    city: squash(raw.city, 120),
    state: squash(raw.state, 2).toUpperCase(),
    note: squash(raw.note, 500),
  };
  const errors = {};
  if (value.name.length < 2) errors.name = "Informe seu nome.";
  if (!/^\d{10,11}$/.test(value.phone)) errors.phone = "Informe um WhatsApp com DDD.";
  if (!/^\d{8}$/.test(value.postal_code)) errors.postal_code = "CEP deve ter 8 números.";
  if (value.address_line.length < 2) errors.address_line = "Informe o endereço.";
  if (!value.address_number) errors.address_number = "Informe o número (ou S/N).";
  if (!value.neighborhood) errors.neighborhood = "Informe o bairro.";
  if (!value.city) errors.city = "Informe a cidade.";
  if (!UFS.includes(value.state)) errors.state = "Escolha o estado.";
  return { ok: Object.keys(errors).length === 0, errors, value };
}

/** Payload do create-order: dados da cliente + variant_id/quantity. NUNCA preço, nome ou total. */
export function buildOrderPayload(customer, cartState) {
  const c = {
    name: customer.name, phone: customer.phone, postal_code: customer.postal_code,
    address_line: customer.address_line, address_number: customer.address_number,
    neighborhood: customer.neighborhood, city: customer.city, state: customer.state,
  };
  if (customer.address_complement) c.address_complement = customer.address_complement;
  if (customer.note) c.note = customer.note;
  return { customer: c, items: toOrderItems(cartState) };
}

export const ERROR_MESSAGES = {
  insufficient_stock: "Alguma peça não tem mais a quantidade escolhida. Ajustamos seu carrinho — confira e tente novamente.",
  variant_unavailable: "Alguma peça do carrinho não está mais disponível. Atualizamos seu carrinho — confira e tente novamente.",
  rate_limited: "Recebemos muitas solicitações em pouco tempo. Aguarde alguns minutos e tente de novo.",
  invalid_items: "Não foi possível processar os itens do carrinho. Confira as quantidades.",
  invalid_customer: "Confira seus dados de contato e endereço.",
  invalid_request: "Não foi possível processar o pedido. Confira os dados e tente novamente.",
  payload_too_large: "Os dados enviados ficaram grandes demais. Reduza a observação e tente de novo.",
  network: "Não conseguimos conectar. Verifique sua internet e tente novamente. Se tiver dúvida se o pedido chegou a ser enviado, fale com a Francine pelo WhatsApp antes de reenviar, para evitar pedido duplicado.",
  generic: "Não foi possível enviar seu pedido agora. Tente novamente em instantes ou fale com a Francine pelo WhatsApp.",
};

export const errorMessage = (code) => ERROR_MESSAGES[code] ?? ERROR_MESSAGES.generic;

/** Códigos que indicam que o carrinho local ficou desatualizado. */
export const needsCartRefresh = (code) => code === "insufficient_stock" || code === "variant_unavailable";

/** Envia à Edge Function. Resolve sempre com { ok, ... } (nunca lança). */
export async function postOrder({ fetchFn, url, payload }) {
  let res;
  try {
    res = await fetchFn(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    return { ok: false, code: "network", message: errorMessage("network") };
  }
  let body = null;
  try { body = await res.json(); } catch { /* corpo não-JSON */ }
  if (res.ok && body?.display_code) {
    return { ok: true, order: { order_id: body.order_id, display_code: body.display_code, status: body.status } };
  }
  const code = body?.error && ERROR_MESSAGES[body.error] ? body.error : "generic";
  return { ok: false, code, message: errorMessage(code) };
}

/** Impede submissões simultâneas: chamadas durante uma em andamento são ignoradas. */
export function singleFlight(fn) {
  let pending = false;
  const wrapped = async (...args) => {
    if (pending) return { skipped: true };
    pending = true;
    try { return await fn(...args); } finally { pending = false; }
  };
  wrapped.isPending = () => pending;
  return wrapped;
}

/**
 * Fluxo completo: valida -> monta payload -> envia (single-flight) -> limpa carrinho no sucesso.
 * Em erro, o carrinho permanece (e o chamador reconcilia se `needsCartRefresh`).
 */
export function createOrderPlacer({ cartStore, send }) {
  return singleFlight(async (rawCustomer) => {
    const v = validateCustomer(rawCustomer);
    if (!v.ok) return { ok: false, code: "validation", errors: v.errors };
    const cart = cartStore.get();
    if (cart.items.length === 0) return { ok: false, code: "empty_cart", message: "Seu carrinho está vazio." };
    const result = await send(buildOrderPayload(v.value, cart));
    if (result.ok) cartStore.clear();
    return result;
  });
}

/**
 * Mensagem opcional para a cliente ENVIAR à loja, apenas após o servidor registrar o pedido.
 * Os valores do carrinho são referências visuais; o pedido salvo no backend é a fonte oficial.
 * Chamada pelo checkout com dados validados. Não salvar esta mensagem em localStorage/sessionStorage.
 */
export function whatsappOrderMessage(displayCode, customer, items = []) {
  if (!displayCode || !customer || !Array.isArray(items) || !items.length) return null;
  const clean = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
  const c = customer;
  const lines = [
    "🛍️ *SOLICITAÇÃO DE COMPRA — FRANCINE FURINI STORE*",
    `*Pedido:* ${clean(displayCode)}`,
    `*Cliente:* ${clean(c.name)}`,
    `*WhatsApp:* ${formatPhone(c.phone)}`,
    "",
    "*PEÇAS ESCOLHIDAS*",
  ];
  for (const item of items) {
    lines.push(`• ${item.quantity}× ${clean(item.ref?.name)}`);
    lines.push(`  Cor: ${clean(item.ref?.color)} | Tamanho: ${clean(item.ref?.size)}`);
    lines.push(`  Valor de referência: ${formatBRL(item.quantity * (item.ref?.price_cents || 0))}`);
  }
  lines.push("",
    `*Subtotal de referência:* ${formatBRL(subtotalCents({ items }))}`,
    "*Frete:* aguardando cálculo",
    "*Pagamento:* ainda não realizado",
    "",
    "*ENDEREÇO DE ENTREGA*",
    `${clean(c.address_line)}, ${clean(c.address_number)}${c.address_complement ? ` — ${clean(c.address_complement)}` : ""}`,
    `${clean(c.neighborhood)} — ${clean(c.city)}/${clean(c.state)}`,
    `CEP: ${formatCep(c.postal_code)}`);
  if (c.note) lines.push(`*Observações:* ${clean(c.note)}`);
  lines.push("", "Gostaria de confirmar o frete e combinar o pagamento. Aguardo seu retorno!");
  return lines.join("\n");
}

/**
 * Link do WhatsApp. Sem mensagem detalhada (ex.: página recarregada), leva SOMENTE o código
 * do pedido para proteger dados pessoais de armazenamento persistente no navegador.
 */
export function whatsappUrl(number, displayCode, detailedMessage = null) {
  const n = onlyDigits(number);
  if (!n) return null;
  const text = detailedMessage || (displayCode
    ? `Olá! Acabei de enviar o pedido ${displayCode} na Francine Furini Store.`
    : "Olá! Gostaria de falar sobre a Francine Furini Store.");
  return `https://wa.me/${n}?text=${encodeURIComponent(text)}`;
}
