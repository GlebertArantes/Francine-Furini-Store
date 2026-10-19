import { h } from "../lib/dom.js";
import { guard } from "../lib/ui.js";
import { BRAND, brandMark } from "../lib/brand.js";

const USERNAME_AUTH_DOMAIN = "admin.francine-furini.local";

/**
 * A UI pode receber um login simples (ex.: Fran1010), mas o Supabase Auth
 * continua usando o identificador e-mail internamente. E-mails digitados
 * continuam aceitos para preservar o acesso técnico existente.
 */
export function resolveLoginIdentifier(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (raw.includes("@")) return raw;
  const username = raw.toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) return "";
  return `${username}@${USERNAME_AUTH_DOMAIN}`;
}

export function loginView(ctx, notice) {
  const msg = h("p", { class: `notice${notice ? "" : " hidden"}`, role: "alert" }, notice ?? "");
  const login = h("input", {
    id: "login",
    name: "login",
    type: "text",
    autocomplete: "username",
    autocapitalize: "none",
    spellcheck: "false",
    required: true,
  });
  const pw = h("input", { id: "password", name: "password", type: "password", autocomplete: "current-password", required: true });
  const btn = h("button", { type: "submit", class: "btn block" }, "Entrar");
  const submit = guard(btn, async () => {
    msg.classList.add("hidden");
    const identifier = resolveLoginIdentifier(login.value);
    if (!identifier) {
      msg.textContent = "Informe um login válido.";
      msg.classList.remove("hidden");
      login.focus();
      return;
    }
    try {
      await ctx.auth.signIn(identifier, pw.value);
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
      brandMark(h, "login-mark"),
      h("p", { class: "eyebrow" }, "Painel administrativo"),
      h("h1", {}, BRAND.name),
      msg,
      h("div", { class: "field" }, h("label", { for: "login" }, "Login"), login),
      h("div", { class: "field" }, h("label", { for: "password" }, "Senha"), pw),
      btn,
      h("p", { class: "muted small" }, "Acesso restrito. Use o login fornecido pela administração.")));
}

export function deniedView(ctx) {
  return h("main", { id: "main", class: "login" }, h("div", { class: "login-card" },
    brandMark(h, "login-mark"),
    h("p", { class: "eyebrow" }, "Acesso negado"),
    h("h1", {}, "Sem permissão"),
    h("p", {}, "Esta conta não tem acesso de administrador a este painel."),
    h("button", { type: "button", class: "btn block", onclick: () => ctx.logout() }, "Sair")));
}
