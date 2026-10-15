// Gera storefront/config.js a partir de variáveis de ambiente (build mínimo, sem dependências).
// Uso: SUPABASE_URL=... SUPABASE_PUBLISHABLE_KEY=... node scripts/storefront-config.mjs
// Só valores PÚBLICOS entram no arquivo; chaves secretas/service_role são recusadas.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function jwtRole(key) {
  const parts = key.split(".");
  if (parts.length !== 3) return null;
  try { return JSON.parse(Buffer.from(parts[1], "base64url").toString()).role ?? null; } catch { return null; }
}

export function buildConfig(env) {
  const url = String(env.SUPABASE_URL ?? "").trim().replace(/\/+$/, "");
  const key = String(env.SUPABASE_PUBLISHABLE_KEY ?? "").trim();
  const fn = String(env.CREATE_ORDER_URL ?? "").trim();
  if (!/^https:\/\/[a-z0-9.-]+$/i.test(url)) throw new Error("SUPABASE_URL ausente ou inválida (use https://<projeto>.supabase.co).");
  if (!key) throw new Error("SUPABASE_PUBLISHABLE_KEY ausente.");
  if (/^sb_secret_/.test(key) || jwtRole(key) === "service_role") {
    throw new Error("Chave secreta/service_role recusada: use apenas a chave PUBLISHABLE (anon) no storefront.");
  }
  if (fn && !/^https:\/\/\S+$/.test(fn)) throw new Error("CREATE_ORDER_URL inválida.");
  const cfg = { supabaseUrl: url, supabasePublishableKey: key, ...(fn ? { createOrderUrl: fn } : {}) };
  return `// Gerado por scripts/storefront-config.mjs — somente valores públicos. Não versionar.\nwindow.FF_CONFIG = ${JSON.stringify(cfg, null, 2)};\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const out = new URL("../storefront/config.js", import.meta.url);
    writeFileSync(out, buildConfig(process.env));
    console.log("storefront/config.js gerado.");
  } catch (e) {
    console.error(`Erro: ${e.message}`);
    process.exit(1);
  }
}
