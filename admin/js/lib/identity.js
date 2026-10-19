// Nome exibido do usuário no painel. O Supabase Auth guarda um e-mail (interno, p.ex. fran1010@admin.francine-furini.local,
// ou real); a interface mostra só o login amigável, sem o endereço completo. Não altera a autenticação.
export function friendlyLogin(email) {
  const raw = String(email ?? "").trim();
  if (!raw) return "";
  const at = raw.lastIndexOf("@");
  const local = (at >= 0 ? raw.slice(0, at) : raw).trim();
  if (!local) return "";
  return local.charAt(0).toUpperCase() + local.slice(1);
}
