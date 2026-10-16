// Conversão R$ <-> centavos SEM ponto flutuante (parse por string).
export const MAX_CENTS = 2147483647; // integer do Postgres

/** Aceita "1234", "1234,5", "1.234,56", "R$ 19,90", "19.90". Rejeita o resto. */
export function parseReaisToCents(input, { allowZero = false } = {}) {
  let s = String(input ?? "").replace(/R\$/gi, "").replace(/\s+/g, "");
  if (!s) return { ok: false, error: "empty" };
  let int, frac = "";
  let m;
  if ((m = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/.exec(s))) {
    int = m[1].replace(/\./g, ""); frac = m[2] ?? "";
  } else if ((m = /^(\d+)\.(\d{1,2})$/.exec(s))) {
    int = m[1]; frac = m[2];
  } else return { ok: false, error: "format" };
  const cents = Number(int) * 100 + Number(frac.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents > MAX_CENTS) return { ok: false, error: "too_large" };
  if (cents === 0 && !allowZero) return { ok: false, error: "zero" };
  return { ok: true, cents };
}

/** Valor para campo de edição: 12990 -> "129,90". */
export function centsToInput(cents) {
  if (cents == null) return "";
  const n = Math.round(Number(cents));
  return `${Math.floor(n / 100)},${String(n % 100).padStart(2, "0")}`;
}

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export const formatBRL = (cents) => BRL.format((Number(cents) || 0) / 100);
