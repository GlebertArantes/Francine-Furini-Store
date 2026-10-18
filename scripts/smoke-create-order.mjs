// Smoke HTTP NÃO destrutivo da Edge Function `create-order` (nenhum pedido é criado: todos os POSTs são inválidos/recusados).
// Uso: node scripts/smoke-create-order.mjs https://<ref>.supabase.co/functions/v1/create-order
// Sem chaves/segredos. CORS não é autenticação: este smoke só confirma o comportamento esperado do navegador e dos erros.
const url = process.argv[2];
if (!url) { console.error("Informe a URL da função."); process.exit(2); }
const OFFICIAL = "https://francinefurinistore.com.br", BACKUP = "https://francine-furini-store.pages.dev", EVIL = "https://evil.example";
const LEAK = /stack|service_role|apikey|secret|at\s+\S+\s+\(|supabase\.co|postgres|SQLSTATE/i;
let failed = 0;
const check = (name, ok, info) => { if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"}: ${name} ${info}`); };
const call = async (method, origin, body) => {
  const r = await fetch(url, { method, headers: { ...(origin ? { origin } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(method === "OPTIONS" ? { "access-control-request-method": "POST", "access-control-request-headers": "content-type" } : {}) }, body });
  const text = await r.text();
  return { status: r.status, acao: r.headers.get("access-control-allow-origin"), vary: r.headers.get("vary"), ct: r.headers.get("content-type") ?? "", cache: r.headers.get("cache-control"), text };
};
const jsonClean = (r) => { try { JSON.parse(r.text); } catch { return false; } return !LEAK.test(r.text); };

let r = await call("OPTIONS", OFFICIAL);  check("1 OPTIONS origem oficial", [200, 204].includes(r.status) && r.acao === OFFICIAL, `status=${r.status} acao=${r.acao} vary=${r.vary}`);
r = await call("OPTIONS", BACKUP);        check("2 OPTIONS pages.dev", [200, 204].includes(r.status) && r.acao === BACKUP, `status=${r.status} acao=${r.acao}`);
r = await call("OPTIONS", EVIL);          check("3 OPTIONS origem não autorizada sem ACAO", !r.acao, `status=${r.status} acao=${r.acao}`);
r = await call("POST", EVIL, "{}");       check("4 POST origem não autorizada = 403", r.status === 403 && !r.acao && jsonClean(r), `status=${r.status} body=${r.text.slice(0, 80)}`);
r = await call("POST", OFFICIAL, "{}");   check("5 POST payload inválido = 400 JSON", r.status === 400 && r.ct.includes("json") && jsonClean(r) && r.acao === OFFICIAL, `status=${r.status} body=${r.text.slice(0, 80)}`);
r = await call("POST", OFFICIAL, "{not json"); check("5b POST JSON malformado = 400", r.status === 400 && jsonClean(r), `status=${r.status} body=${r.text.slice(0, 80)}`);
r = await call("POST", OFFICIAL, JSON.stringify({ pad: "x".repeat(17 * 1024) })); check("6 POST > 16 KB = 413", r.status === 413 && jsonClean(r), `status=${r.status} body=${r.text.slice(0, 80)}`);
r = await call("GET", OFFICIAL);          check("7 GET = 405 JSON", r.status === 405 && jsonClean(r), `status=${r.status} cache=${r.cache}`);
console.log(failed ? `\n${failed} verificação(ões) FALHARAM` : "\nTodas as verificações passaram");
process.exit(failed ? 1 : 0);
