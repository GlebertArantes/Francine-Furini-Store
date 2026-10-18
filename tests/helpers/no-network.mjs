// Carregado com `node --import` em todos os testes Node: qualquer fetch real é bloqueado.
// Garante que nenhum teste unitário crie pedido/escreva em produção (Supabase, Cloudflare, etc.) por acidente.
// Os testes usam fetch injetado (fakes); chamadas reais falham de forma explícita.
const blocked = (url) => {
  throw new Error(`REDE BLOQUEADA nos testes: fetch real para ${String(url?.url ?? url)}. Injete um fetch falso.`);
};
globalThis.fetch = async (url) => blocked(url);
