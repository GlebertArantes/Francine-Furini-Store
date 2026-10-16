import { h } from "./dom.js";

export function toast(message, type = "ok") {
  const box = document.getElementById("toasts");
  if (!box) return;
  const el = h("div", { class: `toast ${type}`, role: type === "error" ? "alert" : "status" }, message);
  box.append(el);
  setTimeout(() => el.remove(), type === "error" ? 9000 : 4000);
}

/** Confirmação visual (modal) para ações irreversíveis. Resolve true/false. */
export function confirmDialog({ title, text, confirmLabel = "Confirmar", danger = false }) {
  return new Promise((resolve) => {
    if (typeof HTMLDialogElement === "undefined") return resolve(window.confirm(`${title}\n\n${text}`));
    const dlg = h("dialog", { class: "confirm", "aria-labelledby": "dlg-title" },
      h("form", { method: "dialog" },
        h("h2", { id: "dlg-title" }, title),
        h("p", {}, text),
        h("div", { class: "actions" },
          h("button", { type: "submit", value: "cancel", class: "btn secondary", autofocus: true }, "Voltar"),
          h("button", { type: "submit", value: "ok", class: `btn${danger ? " danger" : ""}` }, confirmLabel))));
    dlg.addEventListener("close", () => { const ok = dlg.returnValue === "ok"; dlg.remove(); resolve(ok); });
    document.body.append(dlg);
    dlg.showModal();
  });
}

/** Executa fn uma vez por vez: desabilita o botão e ignora cliques enquanto pendente. */
export function guard(btn, fn) {
  let busy = false;
  return async (...args) => {
    if (busy) return;
    busy = true;
    const label = btn.textContent;
    btn.disabled = true; btn.setAttribute("aria-busy", "true");
    try { return await fn(...args); }
    finally { busy = false; btn.disabled = false; btn.removeAttribute("aria-busy"); btn.textContent = label; }
  };
}

export function showFieldErrors(form, errors = {}) {
  for (const el of form.elements) {
    if (!el.name) continue;
    const p = form.querySelector(`[data-err="${el.name}"]`);
    if (p) p.textContent = errors[el.name] ?? "";
    if (errors[el.name]) el.setAttribute("aria-invalid", "true"); else el.removeAttribute("aria-invalid");
  }
  form.querySelector('[aria-invalid="true"]')?.focus();
}

export function field(name, label, input, hint) {
  const id = `f-${name}-${Math.random().toString(36).slice(2, 6)}`;
  input.id = id;
  return h("div", { class: "field" }, h("label", { for: id }, label), input, hint ? h("small", {}, hint) : null,
    h("p", { class: "err", "data-err": name, role: "alert" }));
}

export const fmtDateTime = (iso) => iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

export function stateBox(title, text, ...actions) {
  return h("div", { class: "state", role: "status" }, h("h2", {}, title), text ? h("p", {}, text) : null, ...actions);
}

/** Carrega dados com estados de loading/erro (com tentar novamente). Erros de sessão vão para o login. */
export async function loadInto(ctx, root, loader, render) {
  root.replaceChildren(h("p", { class: "loading", "aria-busy": "true" }, "Carregando…"));
  try {
    const data = await loader();
    render(data);
  } catch (e) {
    if (ctx.fail(e)) return;
    root.replaceChildren(stateBox("Não foi possível carregar", "Verifique sua conexão e tente novamente.",
      h("button", { type: "button", class: "btn secondary", onclick: () => loadInto(ctx, root, loader, render) }, "Tentar novamente")));
  }
}
