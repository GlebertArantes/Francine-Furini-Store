import { h } from "../lib/dom.js";
import { productUrl, copyProductUrl } from "../lib/product-link.js";

export function productShareView(product) {
  const url = productUrl(product);
  if (!url) return null;
  const status = h("p", { class: "muted share-status", role: "status", "aria-live": "polite" });
  const input = h("input", { class: "share-url", type: "url", readonly: true, value: url, "aria-label": "Link direto desta peça", spellcheck: "false" });
  const manual = h("div", { hidden: true }, input);
  const button = h("button", { type: "button", class: "btn secondary", "aria-label": `Copiar link de ${product.name}` }, "Copiar link");
  button.addEventListener("click", async () => {
    if (button.disabled) return;
    button.disabled = true; button.setAttribute("aria-busy", "true");
    try {
      const result = await copyProductUrl(product);
      if (result.copied) { status.textContent = "Link copiado! Agora é só colar onde quiser compartilhar."; manual.setAttribute("hidden", ""); }
      else {
        status.textContent = "Seu navegador não permitiu copiar automaticamente. Selecione o endereço abaixo e use Copiar.";
        manual.removeAttribute("hidden"); input.focus(); input.select();
      }
    } finally { button.disabled = false; button.removeAttribute("aria-busy"); }
  });
  return h("div", { class: "product-share" }, button, status, manual);
}
