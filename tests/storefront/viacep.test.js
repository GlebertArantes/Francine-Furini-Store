import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { lookupCep, createCepController, VIACEP_URL, CEP_MESSAGES } from "../../storefront/js/lib/cep.js";

const read = (f) => readFileSync(new URL(`../../${f}`, import.meta.url), "utf8");
const ok = (body, status = 200) => async () => ({ ok: status < 400, status, json: async () => body });
const VIA = { cep: "38010-000", logradouro: "Rua das Flores", bairro: "Centro", localidade: "Uberaba", uf: "MG" };

test("URL oficial do ViaCEP e somente 8 dígitos disparam consulta", async () => {
  assert.equal(VIACEP_URL("38010000"), "https://viacep.com.br/ws/38010000/json/");
  let calls = 0;
  const r = await lookupCep("3801", { fetchFn: async () => { calls++; } });
  assert.deepEqual([r.ok, r.code, calls], [false, "invalid", 0]);
});
test("CEP válido: preenche rua, bairro, cidade e UF (número/complemento ficam manuais)", async () => {
  let seen;
  const r = await lookupCep("38010-000", { fetchFn: async (u, i) => { seen = [u, i]; return { ok: true, status: 200, json: async () => VIA }; } });
  assert.equal(seen[0], "https://viacep.com.br/ws/38010000/json/");
  assert.equal(seen[1].credentials, "omit");
  assert.deepEqual(r.address, { address_line: "Rua das Flores", neighborhood: "Centro", city: "Uberaba", state: "MG" });
  assert.ok(!("address_number" in r.address) && !("address_complement" in r.address));
});
test("falhas: inexistente (erro:true), 400, 5xx, rede, JSON inválido e timeout", async () => {
  assert.equal((await lookupCep("99999999", { fetchFn: ok({ erro: true }) })).code, "not_found");
  assert.equal((await lookupCep("99999999", { fetchFn: ok({ erro: "true" }) })).code, "not_found");
  assert.equal((await lookupCep("99999999", { fetchFn: ok({}, 400) })).code, "not_found");
  assert.equal((await lookupCep("38010000", { fetchFn: ok({}, 503) })).code, "unavailable");
  assert.equal((await lookupCep("38010000", { fetchFn: async () => { throw new TypeError("net"); } })).code, "unavailable");
  assert.equal((await lookupCep("38010000", { fetchFn: async () => ({ ok: true, status: 200, json: async () => { throw new Error("x"); } }) })).code, "unavailable");
  const hang = (u, { signal }) => new Promise((_, rej) => signal.addEventListener("abort", () => rej(new Error("abort"))));
  assert.equal((await lookupCep("38010000", { fetchFn: hang, timeoutMs: 20 })).code, "unavailable");
});
test("resposta com UF desconhecida ou sem dados úteis não vira endereço", async () => {
  const r = await lookupCep("38010000", { fetchFn: ok({ ...VIA, uf: "ZZ" }) });
  assert.equal(r.address.state, "");
  assert.equal((await lookupCep("38010000", { fetchFn: ok({ cep: "x", logradouro: "", bairro: "", localidade: "" }) })).code, "not_found");
});
test("texto da API é tratado como dado (sem HTML interpretado): só limpeza de espaços/limite", async () => {
  const r = await lookupCep("38010000", { fetchFn: ok({ ...VIA, logradouro: "  <img src=x onerror=1>  Rua  " }) });
  assert.equal(r.address.address_line, "<img src=x onerror=1> Rua"); // preenchido via .value (nunca innerHTML)
  assert.ok(!/innerHTML|insertAdjacentHTML|outerHTML/.test(read("storefront/js/lib/cep.js") + read("storefront/js/views/checkout.js")));
});

function rig(lookup) {
  const log = { status: [], fills: [] };
  const c = createCepController({ lookup, onStatus: (k) => log.status.push(k), fill: (a) => log.fills.push(a) });
  return { c, log };
}
test("controlador: consulta ao completar 8 dígitos, indicação de carregamento e sucesso", async () => {
  const { c, log } = rig(async () => ({ ok: true, address: { address_line: "Rua A", neighborhood: "B", city: "C", state: "MG" } }));
  await c.input("3801"); await c.input("38010-00");
  assert.deepEqual(log.status, [null, null]);
  await c.input("38010-000");
  assert.deepEqual(log.status.slice(2), ["loading", "found"]);
  assert.deepEqual(log.fills[0], { address_line: "Rua A", neighborhood: "B", city: "C", state: "MG" });
  await c.input("38010-000"); assert.equal(log.fills.length, 1, "mesmo CEP não consulta de novo");
});
test("corrida: resposta antiga de outro CEP é descartada", async () => {
  const resolvers = {};
  const { c, log } = rig((cep) => new Promise((res) => { resolvers[cep] = res; }));
  const p1 = c.input("11111-111"), p2 = c.input("22222-222");
  resolvers["22222222"]({ ok: true, address: { city: "Nova", state: "SP" } });
  resolvers["11111111"]({ ok: true, address: { city: "Velha", state: "RJ" } }); // chega depois
  await Promise.all([p1, p2]);
  assert.deepEqual(log.fills, [{ city: "Nova", state: "SP" }]);
});
test("apagar o CEP durante a consulta cancela o preenchimento", async () => {
  let res; const { c, log } = rig(() => new Promise((r) => { res = r; }));
  const p = c.input("38010-000"); c.input("38010-00");
  res({ ok: true, address: { city: "X" } }); await p;
  assert.deepEqual(log.fills, []); assert.equal(log.status.at(-1), null);
});
test("edição manual (antes ou durante a consulta) nunca é sobrescrita; os demais campos são preenchidos", async () => {
  let res; const { c, log } = rig(() => new Promise((r) => { res = r; }));
  const p = c.input("38010-000");
  c.touch("city");                       // cliente digitou a cidade enquanto a consulta estava pendente
  res({ ok: true, address: { address_line: "Rua A", neighborhood: "B", city: "Outra", state: "MG" } }); await p;
  assert.deepEqual(log.fills[0], { address_line: "Rua A", neighborhood: "B", state: "MG" });
});
test("erros: CEP inexistente e API indisponível mostram mensagem e permitem nova tentativa", async () => {
  let mode = "not_found"; const { c, log } = rig(async () => ({ ok: false, code: mode }));
  await c.input("99999-999"); assert.equal(log.status.at(-1), "not_found");
  mode = "unavailable"; await c.input("99999-999"); assert.equal(log.status.at(-1), "unavailable", "mesmo CEP pode ser reconsultado após falha");
  assert.deepEqual(log.fills, []);
  assert.match(CEP_MESSAGES.not_found, /manualmente/); assert.match(CEP_MESSAGES.unavailable, /manualmente/);
});

test("integração no checkout: aria-live, campos editáveis, sem alterar validação/payload", () => {
  const v = read("storefront/js/views/checkout.js");
  assert.match(v, /id: "cep-status"[^)]*role: "status"[^)]*"aria-live": "polite"|role: "status", "aria-live": "polite"/);
  assert.match(v, /createCepController/); assert.match(v, /cep\.touch\(k\)/);
  assert.ok(!/readonly|disabled: true/.test(v.slice(v.indexOf("postal_code"), v.indexOf("address_number"))), "campos continuam editáveis");
  const lib = read("storefront/js/lib/checkout.js");
  assert.match(lib, /postal_code = "CEP deve ter 8 números\./); assert.ok(!/viacep/i.test(lib), "validação/payload não dependem do ViaCEP");
});
test("CSP: ViaCEP só na vitrine; admin e demais diretivas intactos", () => {
  // sem citar o identificador do projeto: Supabase (https + wss, mesmo host) e depois o ViaCEP
  const m = /connect-src 'self' https:\/\/([a-z0-9]+)\.supabase\.co wss:\/\/([a-z0-9]+)\.supabase\.co https:\/\/viacep\.com\.br;/.exec(read("storefront/_headers"));
  assert.ok(m && m[1] === m[2], "connect-src: Supabase do projeto + ViaCEP");
  assert.ok(!/viacep/i.test(read("admin/_headers")));
  assert.ok(!/default-src[^;]*viacep|script-src[^;]*viacep|img-src[^;]*viacep/i.test(read("storefront/_headers")));
});

// ---- mudança de CEP após preenchimento automático ---------------------------------------------
function form(lookup) {
  const f = { address_line: "", neighborhood: "", city: "", state: "", address_number: "" };
  const log = [];
  const c = createCepController({
    lookup, read: (k) => f[k],
    onStatus: (k) => log.push(k),
    fill: (a) => Object.assign(f, a),
    clear: (keys) => { for (const k of keys) f[k] = ""; },
  });
  const type = (k, v) => { f[k] = v; c.touch(k); }; // digitação manual
  return { f, c, log, type };
}
const addrA = { address_line: "Rua A", neighborhood: "Bairro A", city: "Cidade A", state: "MG" };
const addrB = { address_line: "Rua B", neighborhood: "Bairro B", city: "Cidade B", state: "SP" };
const byCep = (map) => async (cep) => map[cep] ?? { ok: false, code: "not_found" };

test("novo CEP válido: endereço automático anterior é substituído (não ficam dados misturados)", async () => {
  const { f, c } = form(byCep({ 11111111: { ok: true, address: addrA }, 22222222: { ok: true, address: addrB } }));
  await c.input("11111-111"); assert.equal(f.address_line, "Rua A");
  await c.input("22222-222"); assert.deepEqual([f.address_line, f.city, f.state], ["Rua B", "Cidade B", "SP"]);
});
test("CEP apagado/incompleto: limpa o que era automático e intacto; número manual permanece", async () => {
  const { f, c, type } = form(byCep({ 11111111: { ok: true, address: addrA } }));
  await c.input("11111-111"); type("address_number", "15");
  c.input("11111-11");
  assert.deepEqual([f.address_line, f.neighborhood, f.city, f.state], ["", "", "", ""]);
  assert.equal(f.address_number, "15");
});
test("CEP inexistente depois de um preenchimento: dados do CEP antigo saem; falha de consulta idem; entrada manual segue possível", async () => {
  for (const code of ["not_found", "unavailable"]) {
    const { f, c, log, type } = form(byCep({ 11111111: { ok: true, address: addrA }, 99999999: { ok: false, code } }));
    await c.input("11111-111"); await c.input("99999-999");
    assert.deepEqual([f.address_line, f.city, f.state], ["", "", ""], code);
    assert.equal(log.at(-1), code);
    type("city", "Digitada"); assert.equal(f.city, "Digitada");
  }
});
test("edição manual é preservada: campo digitado não é apagado nem sobrescrito ao mudar o CEP", async () => {
  const { f, c, type } = form(byCep({ 11111111: { ok: true, address: addrA }, 22222222: { ok: true, address: addrB } }));
  await c.input("11111-111");
  type("city", "Minha Cidade"); // cliente alterou a cidade automática
  await c.input("22222-222");
  assert.equal(f.city, "Minha Cidade");
  assert.deepEqual([f.address_line, f.neighborhood, f.state], ["Rua B", "Bairro B", "SP"], "campos não editados acompanham o novo CEP");
  c.input("2222");
  assert.equal(f.city, "Minha Cidade"); assert.equal(f.address_line, "");
});
test("texto já presente (digitado ou restaurado) nunca é coberto pelo preenchimento automático", async () => {
  const f = { address_line: "Rua que a cliente escreveu", neighborhood: "", city: "", state: "" };
  const c = createCepController({ lookup: byCep({ 11111111: { ok: true, address: addrA } }), read: (k) => f[k], fill: (a) => Object.assign(f, a) });
  await c.input("11111-111");
  assert.equal(f.address_line, "Rua que a cliente escreveu"); assert.equal(f.city, "Cidade A");
});
test("CEP genérico (só cidade/UF): preenche o que veio e remove rua/bairro do CEP anterior", async () => {
  const { f, c } = form(byCep({ 11111111: { ok: true, address: addrA }, 33333333: { ok: true, address: { address_line: "", neighborhood: "", city: "Cidade G", state: "GO" } } }));
  await c.input("11111-111"); await c.input("33333-333");
  assert.deepEqual([f.address_line, f.neighborhood, f.city, f.state], ["", "", "Cidade G", "GO"]);
});
test("digitar o mesmo CEP de novo não apaga nem repete a consulta; resposta atrasada de CEP antigo não reaparece", async () => {
  let calls = 0; const { f, c } = form(async (cep) => { calls++; return { ok: true, address: addrA }; });
  await c.input("11111-111"); await c.input("11111-111"); assert.equal(calls, 1); assert.equal(f.city, "Cidade A");
  const resolvers = {}; const g = form((cep) => new Promise((r) => { resolvers[cep] = r; }));
  const p = g.c.input("44444-444"); g.c.input("44444-44"); resolvers["44444444"]({ ok: true, address: addrB }); await p;
  assert.equal(g.f.city, "", "resposta antiga descartada");
});
test("checkout: leitura/limpeza ligadas ao formulário e valores restaurados tratados como da cliente", () => {
  const v = read("storefront/js/views/checkout.js");
  assert.match(v, /read: \(k\) =>/); assert.match(v, /clear: \(keys\)/); assert.match(v, /if \(saved\?\.\[k\]\) cep\.touch\(k\)/);
});
