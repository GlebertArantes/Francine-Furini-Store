// Consulta de CEP pela API pública ViaCEP (somente leitura, sem chave). É só conveniência: a validação oficial é do servidor.
import { onlyDigits } from "./format.js";
import { UF_LIST } from "./checkout.js";

export const VIACEP_URL = (cep) => `https://viacep.com.br/ws/${cep}/json/`;
export const CEP_TIMEOUT_MS = 6000;

export const CEP_MESSAGES = {
  loading: "Buscando endereço…",
  found: "Endereço preenchido. Confira os dados e informe o número.",
  not_found: "CEP não encontrado. Confira o número ou preencha o endereço manualmente.",
  unavailable: "Não foi possível consultar o CEP agora. Preencha o endereço manualmente.",
};

const clean = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** Consulta um CEP de 8 dígitos. Nunca lança: { ok:true, address } | { ok:false, code:"invalid"|"not_found"|"unavailable" }. */
export async function lookupCep(rawCep, { fetchFn = (u, i) => fetch(u, i), signal, timeoutMs = CEP_TIMEOUT_MS } = {}) {
  const cep = onlyDigits(rawCep);
  if (!/^\d{8}$/.test(cep)) return { ok: false, code: "invalid" };
  const ctl = new AbortController();
  const onAbort = () => ctl.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchFn(VIACEP_URL(cep), { signal: ctl.signal, headers: { accept: "application/json" }, credentials: "omit", referrerPolicy: "no-referrer" });
    if (!res.ok) return { ok: false, code: res.status === 400 ? "not_found" : "unavailable" };
    const body = await res.json();
    if (!body || body.erro === true || body.erro === "true") return { ok: false, code: "not_found" };
    const state = clean(body.uf, 2).toUpperCase();
    const address = {
      address_line: clean(body.logradouro, 220),
      neighborhood: clean(body.bairro, 120),
      city: clean(body.localidade, 120),
      state: UF_LIST.includes(state) ? state : "",
    };
    // Resposta sem nenhum dado útil (ex.: CEP genérico sem cidade) não é tratada como sucesso.
    if (!address.city && !address.address_line && !address.neighborhood) return { ok: false, code: "not_found" };
    return { ok: true, cep, address };
  } catch {
    return { ok: false, code: "unavailable" };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

/**
 * Controlador do formulário: dispara a consulta ao completar 8 dígitos, descarta respostas antigas (o último CEP vence)
 * e só preenche campos que a cliente NÃO editou manualmente. Independente de DOM: o chamador fornece os callbacks.
 *   onStatus(kind|null) — "loading" | "found" | "not_found" | "unavailable" | null
 *   fill(address, skip)  — recebe só os campos permitidos
 */
export function createCepController({ lookup = lookupCep, onStatus, fill }) {
  let seq = 0, current = null, lastCep = null;
  const touched = new Set();
  return {
    touch(field) { touched.add(field); },
    /** Chamado a cada digitação no CEP. */
    input(rawCep) {
      const cep = onlyDigits(rawCep);
      if (cep.length !== 8) { seq++; current?.abort(); current = null; lastCep = null; onStatus?.(null); return Promise.resolve(null); }
      if (cep === lastCep) return Promise.resolve(null);
      lastCep = cep;
      current?.abort();
      const my = ++seq, ctl = (current = new AbortController());
      onStatus?.("loading");
      return lookup(cep, { signal: ctl.signal }).then((r) => {
        if (my !== seq) return null; // resposta antiga: ignorada
        current = null;
        if (!r.ok) { if (r.code === "not_found" || r.code === "unavailable") lastCep = null; onStatus?.(r.code === "not_found" ? "not_found" : "unavailable"); return r; }
        const allowed = {};
        for (const [k, v] of Object.entries(r.address)) if (v && !touched.has(k)) allowed[k] = v;
        fill?.(allowed);
        onStatus?.("found");
        return r;
      });
    },
  };
}
