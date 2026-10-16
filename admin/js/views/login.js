import { h } from "../lib/dom.js";
import { guard } from "../lib/ui.js";

export function loginView(ctx, notice) {
  const msg = h("p", { class: `notice${notice ? "" : " hidden"}`, role: "alert" }, notice ?? "");
  const email = h("input", { id: "email", name: "email", type: "email", autocomplete: "username", required: true, inputmode: "email" });
  const pw = h("input", { id: "password", name: "password", type: "password", autocomplete: "current-password", required: true });
  const btn = h("button", { type: "submit", class: "btn block" }, "Entrar");
  const submit = guard(btn, async () => {
    msg.classList.add("hidden");
    try {
      await ctx.auth.signIn(email.value, pw.value);
      pw.value = "";
      await ctx.enter();
    } catch (e) {
      pw.value = "";
      msg.textContent = e.message || "Não foi possível entrar.";
      msg.classList.remove("hidden");
      pw.focus();
    }
  });
  return h("main", { id: "main", class: "login" },
    h("form", { class: "login-card", onsubmit: (e) => { e.preventDefault(); submit(); } },
      h("p", { class: "eyebrow" }, "Painel administrativo"),
      h("h1", {}, "Francine Furini Store"),
      msg,
      h("div", { class: "field" }, h("label", { for: "email" }, "E-mail"), email),
      h("div", { class: "field" }, h("label", { for: "password" }, "Senha"), pw),
      btn,
      h("p", { class: "muted small" }, "Acesso restrito. Contas são criadas apenas pela administração.")));
}

export function deniedView(ctx) {
  return h("main", { id: "main", class: "login" }, h("div", { class: "login-card" },
    h("p", { class: "eyebrow" }, "Acesso negado"),
    h("h1", {}, "Sem permissão"),
    h("p", {}, `A conta ${ctx.auth.user?.email ?? ""} não tem acesso de administrador a este painel.`),
    h("button", { type: "button", class: "btn block", onclick: () => ctx.logout() }, "Sair")));
}
