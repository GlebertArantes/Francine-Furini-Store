// Validação/normalização pura (sem Deno/Node APIs) — testável em ambos.
// Só IDs de variante + quantidade e dados da cliente são aceitos; preço/nome são descartados.

export const MAX_LINES = 30;
export const MAX_QTY = 20;

export type OrderInput = {
  customer: {
    name: string; phone: string; postal_code: string; address_line: string;
    address_number: string; address_complement?: string; neighborhood: string;
    city: string; state: string; note?: string;
  };
  items: { variant_id: string; quantity: number }[];
};

export type Validation = { ok: true; value: OrderInput } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UFS = new Set("AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" "));

const clean = (v: unknown, max: number) =>
  typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";

export function normalizePhone(raw: unknown): string {
  let d = String(raw ?? "").replace(/\D/g, "");
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) d = d.slice(2);
  return d;
}

export function validateOrderInput(body: unknown): Validation {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "invalid_body" };
  const b = body as Record<string, unknown>;
  const c = (b.customer ?? {}) as Record<string, unknown>;
  if (typeof c !== "object" || Array.isArray(c)) return { ok: false, error: "invalid_customer" };

  if (!Array.isArray(b.items) || b.items.length < 1 || b.items.length > MAX_LINES) {
    return { ok: false, error: "invalid_items" };
  }
  const merged = new Map<string, number>();
  for (const it of b.items) {
    if (!it || typeof it !== "object") return { ok: false, error: "invalid_items" };
    const { variant_id, quantity } = it as Record<string, unknown>; // price/name ignorados
    if (typeof variant_id !== "string" || !UUID.test(variant_id)) return { ok: false, error: "invalid_items" };
    if (!Number.isInteger(quantity) || (quantity as number) < 1 || (quantity as number) > MAX_QTY) {
      return { ok: false, error: "invalid_items" };
    }
    const id = variant_id.toLowerCase();
    const total = (merged.get(id) ?? 0) + (quantity as number);
    if (total > MAX_QTY) return { ok: false, error: "invalid_items" };
    merged.set(id, total);
  }

  const name = clean(c.name, 160);
  const phone = normalizePhone(c.phone);
  const postal_code = String(c.postal_code ?? "").replace(/\D/g, "");
  const state = clean(c.state, 2).toUpperCase();
  const address_line = clean(c.address_line, 220);
  const address_number = clean(c.address_number, 30);
  const neighborhood = clean(c.neighborhood, 120);
  const city = clean(c.city, 120);

  if (name.length < 2) return { ok: false, error: "invalid_customer" };
  if (!/^\d{10,11}$/.test(phone)) return { ok: false, error: "invalid_customer" };
  if (!/^\d{8}$/.test(postal_code)) return { ok: false, error: "invalid_customer" };
  if (!UFS.has(state)) return { ok: false, error: "invalid_customer" };
  if (address_line.length < 2 || !address_number || !neighborhood || !city) {
    return { ok: false, error: "invalid_customer" };
  }

  return {
    ok: true,
    value: {
      customer: {
        name, phone, postal_code, address_line, address_number,
        address_complement: clean(c.address_complement, 120) || undefined,
        neighborhood, city, state, note: clean(c.note, 500) || undefined,
      },
      items: [...merged].map(([variant_id, quantity]) => ({ variant_id, quantity })),
    },
  };
}
