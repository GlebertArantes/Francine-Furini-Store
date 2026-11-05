// Preferência visual da conta; nunca participa da autorização (is_admin/RLS).
export const INAUGURATION_KEY = "ff_inauguration_20261105";
export const INAUGURATION_LIMIT = 10;
export const FRAN_LOGIN = "fran1010@admin.francine-furini.local";
const validCount = (value) => Number.isInteger(value) && value >= 0 ? Math.min(value, INAUGURATION_LIMIT) : 0;

export function createInaugurationAccess({ auth, url, key, fetchFn, tabStorage = null }) {
  let attempted = false;
  let tabKey = null;
  return {
    reset() {
      attempted = false;
      try { if (tabKey) tabStorage?.removeItem(tabKey); } catch { /* preferência opcional */ }
    },
    async claim() {
      if (attempted || auth.user?.email?.toLowerCase() !== FRAN_LOGIN) return 0;
      attempted = true;
      const userId = auth.user.id;
      tabKey = `${INAUGURATION_KEY}:${userId}`;
      try { if (tabStorage?.getItem(tabKey)) return 0; } catch { /* sem storage */ }
      // Nenhum bloqueio do painel se Auth estiver indisponível.
      try {
        const token = await auth.getAccessToken();
        if (!token) return 0;
        const headers = { apikey: key, authorization: `Bearer ${token}`, "content-type": "application/json" };
        const current = await fetchFn(`${url}/auth/v1/user`, { headers, signal: AbortSignal.timeout(6000) });
        if (!current.ok) return 0;
        const user = await current.json();
        if (user.id !== userId || user.email?.toLowerCase() !== FRAN_LOGIN) return 0;
        const count = validCount(user.user_metadata?.[INAUGURATION_KEY]?.views);
        if (count >= INAUGURATION_LIMIT || auth.user?.id !== userId) return 0;
        const next = count + 1;
        const saved = await fetchFn(`${url}/auth/v1/user`, {
          method: "PUT", headers, signal: AbortSignal.timeout(6000),
          body: JSON.stringify({ data: { [INAUGURATION_KEY]: { views: next } } }),
        });
        if (!saved.ok || auth.user?.id !== userId) return 0;
        try { tabStorage?.setItem(tabKey, "1"); } catch { /* sem storage */ }
        return next;
      } catch { return 0; }
    },
  };
}
