import { validateOrderInput } from "./validate.ts";

export type Deps = {
  supabaseUrl: string;
  serviceRoleKey: string; // vem de env da Edge Function; nunca hardcoded
  allowedOrigins: string[]; // vazio = nenhum origin de navegador autorizado
  fetch: typeof fetch;
  rateLimit: (key: string) => boolean; // true = permitido
};

const MAX_BODY_BYTES = 16 * 1024;

// Origem aceita: https://host[:porta] sem caminho/curinga, ou http://localhost|127.0.0.1:porta (desenvolvimento,
// somente se listado explicitamente). Qualquer outra coisa (ex.: "*", "https://*.x.com", barra final) é descartada.
const ORIGIN_RE = /^(https:\/\/[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?|http:\/\/(localhost|127\.0\.0\.1):\d{1,5})$/i;

/** Lê ALLOWED_ORIGINS (lista separada por vírgulas). Sem curingas: entradas inválidas são rejeitadas, nunca "aceitas por aproximação". */
export function parseAllowedOrigins(raw: string | undefined): { origins: string[]; rejected: number } {
  const origins = new Set<string>();
  let rejected = 0;
  for (const part of (raw ?? "").split(",")) {
    const o = part.trim();
    if (!o) continue;
    if (ORIGIN_RE.test(o)) origins.add(o.toLowerCase()); else rejected++;
  }
  return { origins: [...origins], rejected };
}

// Erros conhecidos da RPC -> HTTP. Nada de detalhes internos vaza para o cliente.
const RPC_ERRORS: Record<string, [number, string]> = {
  insufficient_stock: [409, "insufficient_stock"],
  variant_unavailable: [409, "variant_unavailable"],
  rate_limited: [429, "rate_limited"],
};

export function createHandler(d: Deps) {
  return async (req: Request): Promise<Response> => {
    const origin = req.headers.get("origin") ?? "";
    const cors: Record<string, string> = {
      "Vary": "Origin",
      ...(d.allowedOrigins.includes(origin)
        ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Headers": "content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" }
        : {}),
    };
    const json = (status: number, body: unknown, extra: Record<string, string> = {}) =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...cors, ...extra } });

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
    if (origin && !d.allowedOrigins.includes(origin)) return json(403, { error: "origin_not_allowed" });

    const ip = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
    if (!d.rateLimit(ip)) return json(429, { error: "rate_limited" }, { "retry-after": "60" });

    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return json(413, { error: "payload_too_large" });
    let body: unknown;
    try { body = JSON.parse(raw); } catch { return json(400, { error: "invalid_json" }); }

    const v = validateOrderInput(body);
    if (!v.ok) return json(400, { error: v.error });

    const res = await d.fetch(`${d.supabaseUrl}/rest/v1/rpc/create_order_request`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: d.serviceRoleKey,
        authorization: `Bearer ${d.serviceRoleKey}`,
      },
      body: JSON.stringify({ p_customer: v.value.customer, p_items: v.value.items }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({} as Record<string, string>));
      const key = Object.keys(RPC_ERRORS).find((k) => String(err.message ?? "").startsWith(k));
      if (key) return json(RPC_ERRORS[key][0], { error: RPC_ERRORS[key][1] });
      if (String(err.message ?? "").startsWith("invalid_")) return json(400, { error: "invalid_request" });
      return json(500, { error: "internal_error" });
    }
    const out = await res.json();
    // Resposta mínima: sem PII, sem dados internos.
    return json(201, { order_id: out.order_id, display_code: out.display_code, status: out.status });
  };
}

// Best-effort por isolate (a barreira definitiva por telefone fica na RPC).
export function memoryRateLimiter(max = 10, windowMs = 60_000) {
  const hits = new Map<string, number[]>();
  return (key: string) => {
    const now = Date.now();
    const arr = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (arr.length >= max) { hits.set(key, arr); return false; }
    arr.push(now); hits.set(key, arr);
    if (hits.size > 5000) hits.clear();
    return true;
  };
}
