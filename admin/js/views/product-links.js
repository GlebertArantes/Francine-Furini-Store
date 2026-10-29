import { h } from "../lib/dom.js";
import { productShareInfo, copyProductLink } from "../lib/product-link.js";
import { guard, toast } from "../lib/ui.js";

function manualCopyDialog(url) {
  const id = `share-${Math.random().toString(36).slice(2)}`;
  const input = h("input", { type: "url", value: url, readonly: true, "aria-label": "Link do produto", spellcheck: "false" });
  const dlg = h("dialog", { class: "confirm product-link-dialog", "aria-labelledby": id },
    h("h2", { id }, "Copiar link do produto"),
    h("p", {}, "Seu navegador não permitiu copiar automaticamente. Selecione o endereço abaixo e use Copiar."),
    input, h("form", { method: "dialog", class: "actions" }, h("button", { type: "submit", class: "btn secondary" }, "Fechar")));
  return new Promise((resolve) => {
    dlg.addEventListener("close", () => { dlg.remove(); resolve(); }, { once: true });
    document.body.append(dlg); dlg.showModal(); input.focus(); input.select();
  });
}

export function productLinkActions(product) {
  const info = productShareInfo(product);
  const noteId = `product-link-${product.id}`;
  const copy = h("button", { type: "button", class: "btn small secondary", disabled: !info.enabled,
    "aria-label": `Copiar link de ${product.name}`, "aria-describedby": noteId }, "Copiar link");
  copy.addEventListener("click", guard(copy, async () => {
    const result = await copyProductLink(product);
    if (!result.enabled) { toast(result.note, "error"); return; }
    if (result.copied) { toast("Link copiado! Cole no adesivo Link do Instagram ou compartilhe pelo WhatsApp."); return; }
    await manualCopyDialog(result.url);
    if (copy.isConnected) copy.focus();
  }));
  return h("div", { class: "product-link-actions" }, copy,
    info.enabled ? h("a", { class: "btn small secondary", href: info.url, target: "_blank", rel: "noopener noreferrer",
      "aria-label": `Abrir ${product.name} na loja (nova aba)` }, "Abrir na loja") : null,
    h("small", { id: noteId, class: "muted" }, info.note));
}
