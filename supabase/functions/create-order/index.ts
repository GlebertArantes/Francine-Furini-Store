// Edge Function pública `create-order`. Deploy manual futuro, SEM verificação de JWT
// (o navegador é anônimo): supabase functions deploy create-order --no-verify-jwt
// Env (injetadas pelo Supabase / definidas via `supabase secrets set`, nunca no Git):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ALLOWED_ORIGINS (lista separada por vírgula)
import { createHandler, memoryRateLimiter } from "./handler.ts";

declare const Deno: { env: { get(k: string): string | undefined }; serve(h: (r: Request) => Promise<Response>): void };

const need = (k: string) => {
  const v = Deno.env.get(k);
  if (!v) throw new Error(`missing env ${k}`);
  return v;
};

Deno.serve(createHandler({
  supabaseUrl: need("SUPABASE_URL"),
  serviceRoleKey: need("SUPABASE_SERVICE_ROLE_KEY"),
  allowedOrigins: (Deno.env.get("ALLOWED_ORIGINS") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  fetch,
  rateLimit: memoryRateLimiter(),
}));
