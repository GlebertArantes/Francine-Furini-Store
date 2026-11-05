import { h } from "../lib/dom.js";

/** Modal privado, independente das rotas e dos formulários. */
export function showInauguration() {
  const previousFocus = document.activeElement;
  let timer;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    dialog.close();
    dialog.remove();
    // Sem foco prévio útil (o modal abre depois do painel carregar), devolve o foco ao conteúdo principal.
    const back = previousFocus?.isConnected && previousFocus !== document.body ? previousFocus : document.getElementById("main");
    back?.focus?.({ preventScroll: true });
  };
  const title = h("h2", { id: "inauguration-title" }, "Sua loja está pronta, Fran!");
  const subtitle = h("p", { id: "inauguration-description", class: "inauguration-subtitle" }, "Um novo começo para muitas conquistas.");
  const art = h("div", { class: "inauguration-art", "aria-hidden": "true" },
    h("span", { class: "ribbon ribbon-left" }), h("span", { class: "ribbon ribbon-right" }),
    h("span", { class: "ribbon-bow" }, h("i", {}), h("i", {})),
    h("span", { class: "ribbon-scissors" }, "✂"),
    ...Array.from({ length: 8 }, (_, i) => h("span", { class: `ribbon-confetti confetti-${i}` })));
  const result = h("p", { class: "inauguration-result", role: "status", "aria-live": "polite" });
  const action = h("button", { type: "button", class: "btn inauguration-action", onclick: () => {
    if (dialog.classList.contains("ribbon-cut")) return close();
    dialog.classList.add("ribbon-cut");
    action.disabled = true;
    result.textContent = "Bem-vinda à sua nova loja! Que venham muitas vendas.";
    timer = setTimeout(() => {
      if (closed) return;
      action.textContent = "Vamos começar!";
      action.disabled = false;
      action.focus();
    }, window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 1100);
  } }, "Inaugurar minha loja");
  const dialog = h("dialog", { class: "inauguration-dialog", "aria-labelledby": "inauguration-title", "aria-describedby": "inauguration-description", oncancel: (e) => { e.preventDefault(); close(); } },
    h("button", { type: "button", class: "inauguration-close", "aria-label": "Fechar boas-vindas", onclick: close }, "×"),
    h("p", { class: "inauguration-eyebrow" }, "UM NOVO CAPÍTULO"), title, subtitle, art, result, action,
    h("p", { class: "inauguration-signature" }, "Com carinho, TaskZap"));
  document.body.append(dialog);
  dialog.showModal();
  action.focus();
  return close;
}
