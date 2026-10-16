// Supabase Auth (GoTrue) por e-mail + senha, via REST oficial (/auth/v1). Sem SDK/CDN.
// A sessão (tokens) fica em localStorage, como no supabase-js. Senha NUNCA é guardada nem logada.

export const SESSION_KEY = "francine-furini-store:admin:session:v1";
const SKEW_SECONDS = 60;

export class AuthError extends Error {
  constructor(code, message) { super(message ?? code); this.code = code; }
}

export function createAuth({ url, key, fetchFn, storage = null, now = () => Math.floor(Date.now() / 1000) }) {
  const listeners = new Set();
  let session = null;
  let refreshing = null;

  const load = () => {
    try { const raw = storage?.getItem(SESSION_KEY); if (raw) { const s = JSON.parse(raw); if (s?.access_token && s?.refresh_token) return s; } } catch { /* ignora */ }
    return null;
  };
  const save = (s) => {
    session = s;
    try { if (s) storage?.setItem(SESSION_KEY, JSON.stringify(s)); else storage?.removeItem(SESSION_KEY); } catch { /* sem storage */ }
    listeners.forEach((fn) => fn(s));
  };
  session = load();

  const post = (path, body, token) => fetchFn(`${url}/auth/v1/${path}`, {
    method: "POST",
    headers: { apikey: key, "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body ?? {}),
  });

  // Só guarda o necessário (tokens + id/e-mail); nunca a resposta completa nem senha.
  const toSession = (b) => ({
    access_token: b.access_token,
    refresh_token: b.refresh_token,
    expires_at: b.expires_at ?? now() + Number(b.expires_in ?? 3600),
    user: { id: b.user?.id ?? null, email: b.user?.email ?? null },
  });

  return {
    get session() { return session; },
    get user() { return session?.user ?? null; },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    async signIn(email, password) {
      const e = String(email ?? "").trim();
      if (!e || !password) throw new AuthError("invalid_credentials", "Informe e-mail e senha.");
      let res;
      try { res = await post("token?grant_type=password", { email: e, password }); }
      catch { throw new AuthError("network", "Sem conexão. Tente novamente."); }
      if (!res.ok) {
        if (res.status === 429) throw new AuthError("rate_limited", "Muitas tentativas. Aguarde um pouco.");
        if (res.status >= 500) throw new AuthError("generic", "Serviço indisponível. Tente novamente.");
        throw new AuthError("invalid_credentials", "E-mail ou senha incorretos.");
      }
      const body = await res.json();
      save(toSession(body));
      return session;
    },

    /** Renova com o refresh_token. Falha => sessão limpa (volta ao login). Chamadas concorrentes compartilham a mesma renovação. */
    refresh() {
      if (!session?.refresh_token) return Promise.resolve(false);
      if (refreshing) return refreshing;
      const rt = session.refresh_token;
      refreshing = (async () => {
        try {
          const res = await post("token?grant_type=refresh_token", { refresh_token: rt });
          if (!res.ok) { save(null); return false; }
          save(toSession(await res.json()));
          return true;
        } catch { return false; } // falha de rede: mantém sessão, tenta depois
        finally { refreshing = null; }
      })();
      return refreshing;
    },

    /** Token válido (renova se faltar pouco). null = sem sessão utilizável. */
    async getAccessToken() {
      if (!session) return null;
      if (session.expires_at - now() <= SKEW_SECONDS) { if (!(await this.refresh()) && (!session || session.expires_at <= now())) return null; }
      return session?.access_token ?? null;
    },

    expire() { save(null); },

    async signOut() {
      const token = session?.access_token;
      save(null);
      if (token) { try { await post("logout", {}, token); } catch { /* sessão local já limpa */ } }
    },
  };
}
