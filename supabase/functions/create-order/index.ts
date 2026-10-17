// Edge Function pública `create-order`. Deploy manual futuro, SEM verificação de JWT
// (o navegador é anônimo): supabase functions deploy create-order --no-verify-jwt
// Env (injetadas pelo Supabase / definidas via `supabase secrets set`, nunca no Git):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ALLOWED_ORIGINS (lista separada por vírgula)
import { createHandler, memoryRateLimiter, parseAllowedOrigins } from "./handler.ts";

declare const Deno: { env: { get(k: string): string | undefined }; serve(h: (r: Request) => Promise<Response>): void };

const need = (k: string) => {
  const v = Deno.env.get(k);
  if (!v) throw new Error(`missing env ${k}`);
  return v;
};

// Produção: ALLOWED_ORIGINS=https://francinefurinistore.com.br,https://francine-furini-store.pages.dev
const allowed = parseAllowedOrigins(Deno.env.get("ALLOWED_ORIGINS"));
if (allowed.rejected > 0) console.warn(`ALLOWED_ORIGINS: ${allowed.rejected} entrada(s) inválida(s) ignorada(s) (curingas, barra final ou esquema não permitido).`);
if (allowed.origins.length === 0) console.warn("ALLOWED_ORIGINS vazio: nenhuma origem de navegador autorizada.");

Deno.serve(createHandler({
  supabaseUrl: need("SUPABASE_URL"),
  serviceRoleKey: need("SUPABASE_SERVICE_ROLE_KEY"),
  allowedOrigins: allowed.origins,
  fetch,
  rateLimit: memoryRateLimiter(),
}));
