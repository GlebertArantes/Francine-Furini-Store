// Painel administrativo — Francine Furini Store. Supabase Auth + public.is_admin(); a RLS é a autoridade.
import { h } from "./lib/dom.js";
import { resolveAdminConfig } from "./lib/config.js";
import { createAuth } from "./lib/auth.js";
import { createAdminApi } from "./lib/api.js";
import { toast } from "./lib/ui.js";
import { loginView, deniedView } from "./views/login.js";
import { dashboardView } from "./views/dashboard.js";
import { categoriesView } from "./views/categories.js";
import { productsListView, productEditView } from "./views/products.js";
import { ordersListView, orderDetailView } from "./views/orders.js";
import { settingsView } from "./views/settings.js";

const appEl = document.getElementById("app");

function boot() {
  let cfg;
  try { cfg = resolveAdminConfig(window.FF_CONFIG); } catch (e) {
    appEl.replaceChildren(h("main", { id: "main", class: "login" }, h("div", { class: "login-card" }, h("h1", {}, "Painel indisponível"),
      h("p", {}, e.message === "config_secret_key_refused"
        ? "A configuração contém uma chave secreta. Use apenas a chave publishable (veja o README)."
        : "Configuração do Supabase ausente. Rode npm run storefront:config (veja o README)."))));
    return;
  }
  let storage = null;
  try { storage = window.localStorage; } catch { /* sem storage */ }
  const fetchFn = (u, i) => fetch(u, i);
  const auth = createAuth({ url: cfg.supabaseUrl, key: cfg.key, fetchFn, storage });
  const api = createAdminApi({ url: cfg.supabaseUrl, key: cfg.key, auth, fetchFn });
  let mode = "login"; // login | denied | panel

  const ctx = {
    auth, api,
    navigate(hash) { if (location.hash === hash) renderRoute(); else location.hash = hash; },
    /** Erros de sessão levam ao login; retorna true quando tratou. */
    fail(e) {
      if (e?.code === "session_expired") { showLogin("Sua sessão expirou. Entre novamente."); return true; }
      return false;
    },
    async enter() {
      let admin = false;
      try { admin = await api.isAdmin(); } catch (e) { if (ctx.fail(e)) return; toast("Não foi possível verificar o acesso. Tente novamente.", "error"); await auth.signOut(); return showLogin(); }
      if (!admin) { mode = "denied"; appEl.replaceChildren(deniedView(ctx)); return; }
      mode = "panel"; renderShell(); renderRoute();
    },
    async logout() { await auth.signOut(); showLogin(); },
  };

  function showLogin(notice) { mode = "login"; appEl.replaceChildren(loginView(ctx, notice)); }

  const main = h("main", { id: "main", tabindex: "-1" });
  const links = [["#/", "Painel"], ["#/pedidos", "Pedidos"], ["#/produtos", "Produtos"], ["#/categorias", "Categorias"], ["#/configuracoes", "Loja"]];
  const nav = h("nav", { class: "nav", "aria-label": "Principal" }, links.map(([href, label]) => h("a", { href, "data-href": href }, label)));
  const who = h("span", { class: "who muted small" });
  const shell = h("div", { class: "shell" },
    h("header", { class: "topbar" }, h("div", { class: "bar" }, h("a", { class: "brand", href: "#/" }, "Francine Furini", h("small", {}, "Painel")), who,
      h("button", { type: "button", class: "link-btn", onclick: () => ctx.logout() }, "Sair")), nav), main);

  function renderShell() { who.textContent = auth.user?.email ?? ""; appEl.replaceChildren(shell); }

  function renderRoute() {
    if (mode !== "panel") return;
    const raw = location.hash.replace(/^#/, "") || "/";
    const [path, qs] = raw.split("?");
    const query = new URLSearchParams(qs ?? "");
    const p = path.split("/").filter(Boolean);
    let view;
    if (p[0] === "pedidos" && p[1]) view = orderDetailView(ctx, p[1]);
    else if (p[0] === "pedidos") view = ordersListView(ctx, query);
    else if (p[0] === "produtos" && p[1]) view = productEditView(ctx, p[1]);
    else if (p[0] === "produtos") view = productsListView(ctx);
    else if (p[0] === "categorias") view = categoriesView(ctx);
    else if (p[0] === "configuracoes") view = settingsView(ctx);
    else view = dashboardView(ctx);
    const base = "#/" + (p[0] ?? "");
    nav.querySelectorAll("a").forEach((a) => a.toggleAttribute("aria-current", (a.dataset.href === base) || (a.dataset.href === "#/" && !p[0])));
    main.replaceChildren(view);
    window.scrollTo(0, 0);
  }
  window.addEventListener("hashchange", renderRoute);
  // Sessão removida (expirada/refresh falhou) enquanto o painel está aberto: volta ao login.
  auth.onChange((s) => { if (!s && mode === "panel") showLogin("Sua sessão expirou. Entre novamente."); });

  if (auth.session) ctx.enter(); else showLogin();
}

boot();
