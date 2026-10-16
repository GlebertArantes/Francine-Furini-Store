// Ciclo de pedidos do painel: SOMENTE as RPCs administrativas. Nunca UPDATE direto em orders,
// nem lógica própria de estoque: a baixa acontece exclusivamente em admin_complete_order (banco).
import { parseReaisToCents } from "./money.js";

export const STATUS_LABEL = {
  pending_shipping: "Aguardando frete",
  contacted: "Cliente contatada",
  completed: "Concluído",
  cancelled: "Cancelado",
};

export const hasShipping = (o) => o.shipping_cents != null && o.final_total_cents != null;

/** Quais ações a UI oferece (o backend continua sendo a autoridade). */
export function availableActions(o) {
  const open = o.status === "pending_shipping" || o.status === "contacted";
  return {
    setShipping: open,
    markContacted: o.status === "pending_shipping",
    complete: open && hasShipping(o),
    cancel: open, // venda concluída nunca pode ser cancelada
  };
}

export const ERROR_MESSAGES = {
  insufficient_stock: "Estoque insuficiente para concluir. Nada foi alterado: ajuste o estoque dos itens abaixo e tente de novo.",
  shipping_not_defined: "Informe o frete (pode ser R$ 0,00) antes de concluir a venda.",
  invalid_transition: "Esta ação não é permitida para o status atual do pedido.",
  order_not_open: "O pedido não está mais aberto para alteração de frete.",
  invalid_shipping: "Valor de frete inválido.",
  order_not_found: "Pedido não encontrado.",
  forbidden: "Sem permissão para esta ação.",
  session_expired: "Sua sessão expirou. Entre novamente.",
  network: "Sem conexão. Tente novamente.",
  generic: "Não foi possível concluir a ação. Tente novamente.",
};

/** PostgREST devolve { message, details, hint } do RAISE EXCEPTION da RPC. */
export function parseRpcError(err) {
  const msg = String(err?.message ?? "");
  const code = Object.keys(ERROR_MESSAGES).find((k) => msg === k || msg.startsWith(`${k}:`) || msg.startsWith(k)) ?? (err?.code === "session_expired" ? "session_expired" : err?.code === "network" ? "network" : "generic");
  let shortages = [];
  if (code === "insufficient_stock") {
    try { const d = JSON.parse(err.details); if (Array.isArray(d)) shortages = d; } catch { /* sem detalhe */ }
  }
  return { code, message: ERROR_MESSAGES[code], shortages };
}

/** Frete em reais -> centavos. R$ 0,00 é válido. */
export const parseShipping = (input) => parseReaisToCents(input, { allowZero: true });

/**
 * Executa as ações via RPC. Cada (pedido, ação) é single-flight: clique duplo/retry durante o envio
 * não dispara a RPC de novo. `rpc(name, args)` vem do cliente de API autenticado.
 */
export function createOrderActions(rpc) {
  const inflight = new Set();
  const run = async (key, name, args) => {
    if (inflight.has(key)) return { skipped: true };
    inflight.add(key);
    try {
      const res = await rpc(name, args);
      return { ok: true, result: res, alreadyDone: !!res?.already_done };
    } catch (e) {
      return { ok: false, ...parseRpcError(e) };
    } finally {
      inflight.delete(key);
    }
  };
  const note = (n) => (n && String(n).trim() ? String(n).trim().slice(0, 500) : null);
  return {
    markContacted: (id, n) => run(`${id}:contacted`, "admin_mark_order_contacted", { p_order_id: id, p_note: note(n) }),
    cancel: (id, n) => run(`${id}:cancel`, "admin_cancel_order", { p_order_id: id, p_note: note(n) }),
    complete: (id, n) => run(`${id}:complete`, "admin_complete_order", { p_order_id: id, p_note: note(n) }),
    async setShipping(id, reais) {
      const p = parseShipping(reais);
      if (!p.ok) return { ok: false, code: "invalid_shipping", message: ERROR_MESSAGES.invalid_shipping, shortages: [] };
      return run(`${id}:shipping`, "admin_set_order_shipping", { p_order_id: id, p_shipping_cents: p.cents });
    },
  };
}
