import { visibilityInfo } from "./rules.js";
import { productUrl, copyProductUrl } from "./shared/product-link.js";
export { productUrl, STORE_URL } from "./shared/product-link.js";

export function productShareInfo(product, now = Date.now()) {
  const url = productUrl(product);
  if (!url) return { url: null, enabled: false, note: "Salve o produto e seu endereço da página para gerar o link." };
  const visibility = visibilityInfo(product, now);
  if (visibility.state === "hidden") return { url, enabled: false, note: "Produto oculto: publique antes de divulgar o link." };
  if (visibility.state === "scheduled") return { url, enabled: false, note: "Publicação agendada: o link ficará disponível para copiar quando a peça estiver visível na loja. Atualize a página após esse horário." };
  return { url, enabled: true, note: "Cole este link no adesivo Link dos Stories para abrir a peça diretamente na loja." };
}

export async function copyProductLink(product, env = globalThis, now = Date.now()) {
  const info = productShareInfo(product, now);
  if (!info.enabled) return { ...info, copied: false };
  return { ...info, copied: (await copyProductUrl(product, env)).copied };
}
