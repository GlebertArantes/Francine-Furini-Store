// Formatação e normalização simples (a validação oficial é sempre server-side).

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export const formatBRL = (cents) => BRL.format((Number(cents) || 0) / 100);

export const onlyDigits = (v) => String(v ?? "").replace(/\D/g, "");

// Mesma regra da Edge Function: remove DDI 55 quando o número tem 12/13 dígitos.
export function normalizePhone(v) {
  let d = onlyDigits(v);
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) d = d.slice(2);
  return d;
}

export function formatPhone(v) {
  const d = normalizePhone(v);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return String(v ?? "");
}

export function formatCep(v) {
  const d = onlyDigits(v).slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

// Texto sem acento/caixa para busca.
export const fold = (s) =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
