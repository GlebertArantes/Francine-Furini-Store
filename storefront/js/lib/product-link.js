// URL pública canônica, independente de onde o painel ou a vitrine estão abertos.
export const STORE_URL = "https://francinefurinistore.com.br";
export function productUrl(product) {
  const slug = String(product?.slug ?? "").trim();
  return product?.id && slug ? `${STORE_URL}/#/produto/${encodeURIComponent(slug)}` : null;
}

export async function copyProductUrl(product, env = globalThis) {
  const url = productUrl(product);
  if (!url) return { url: null, copied: false };
  try {
    if (typeof env.navigator?.clipboard?.writeText !== "function") return { url, copied: false };
    await env.navigator.clipboard.writeText(url);
    return { url, copied: true };
  } catch { return { url, copied: false }; }
}
