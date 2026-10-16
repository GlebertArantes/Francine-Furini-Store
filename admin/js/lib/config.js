// Configuração pública do painel. Recusa chaves secretas/service_role mesmo em runtime:
// o painel usa SOMENTE a chave publishable + sessão do Supabase Auth; a autoridade é a RLS.

function jwtRole(key) {
  const parts = String(key).split(".");
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, "="))).role ?? null;
  } catch { return null; }
}

export function isSecretKey(key) {
  const k = String(key ?? "");
  return /^sb_secret_/.test(k) || jwtRole(k) === "service_role";
}

export function resolveAdminConfig(cfg = {}) {
  const url = String(cfg.supabaseUrl ?? "").replace(/\/+$/, "");
  const key = String(cfg.supabasePublishableKey ?? "");
  if (!/^https:\/\/[^/]+$/.test(url) || !key) throw new Error("config_missing");
  if (isSecretKey(key)) throw new Error("config_secret_key_refused");
  return { supabaseUrl: url, key };
}
