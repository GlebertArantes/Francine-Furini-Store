// Storefront Francine Furini Store — roteador hash + shell. Supabase é a fonte do catálogo.
import { h, setChildren } from "./lib/dom.js";
import { resolveConfig, createApi } from "./lib/api.js";
import { createCartStore, totalQuantity } from "./lib/cart.js";
import { variantIndex } from "./lib/catalog.js";
import { homeView } from "./views/home.js";
import { productView } from "./views/product.js";
import { cartView } from "./views/cart.js";
import { checkoutView } from "./views/checkout.js";
import { successView } from "./views/success.js";
import { legalView } from "./views/legal.js";

const appEl = document.getElementById("app");
const ORDER_KEY = "francine-furini-store:last-order";

function safeStorage(kind) { try { return window[kind]; } catch { return null; } }

function boot() {
  let cfg;
  try { cfg = resolveConfig(window.FF_CONFIG); } catch {
    appEl.replaceChildren(h("main", { class: "wrap state" }, h("h2", {}, "Loja indisponível"),
      h("p", {}, "Configuração do Supabase ausente. Rode npm run storefront:config (veja o README).")));
    return;
  }
  const api = createApi(cfg, (u, i) => fetch(u, i));
  const cart = createCartStore(safeStorage("localStorage"));
  let loading = null;

  const ctx = {
    cfg, api, cart, settings: {}, categories: [], products: [], order: null,
    navigate(hash) { if (location.hash === hash) render(); else location.hash = hash; },
    rerender: () => render(),
    load(force = false) {
      if (loading && !force) return loading;
      loading = Promise.all([
        api.getProducts(),
        api.getCategories().catch(() => []),
        api.getSettings().catch(() => ({})),
      ]).then(([products, categories, settings]) => {
        ctx.products = products; ctx.categories = categories; ctx.settings = settings;
        shell.updateSettings();
      });
      loading.catch(() => { loading = null; });
      return loading;
    },
    async refreshCart() {
      await ctx.load(true);
      return cart.reconcile(variantIndex(ctx.products, (p) => api.imageUrl(p.images[0]?.storage_path)));
    },
    setOrder(o) {
      ctx.order = { display_code: o.display_code };
      try { sessionStorage.setItem(ORDER_KEY, ctx.order.display_code); } catch { /* ok */ }
    },
  };
  try { const c = sessionStorage.getItem(ORDER_KEY); if (c) ctx.order = { display_code: c }; } catch { /* ok */ }

  const shell = buildShell(ctx);
  appEl.replaceChildren(shell.header, shell.main, shell.footer);
  cart.subscribe(() => shell.updateCount());
  shell.updateCount();
  window.addEventListener("hashchange", render);

  function render() {
    const raw = location.hash.replace(/^#/, "") || "/";
    const [path, qs] = raw.split("?");
    const query = new URLSearchParams(qs ?? "");
    const storeName = ctx.settings.store_name || "Francine Furini Store";
    document.title = storeName;
    shell.syncSearch(query.get("q") ?? "");
    let view;
    const parts = path.split("/").filter(Boolean);
    if (parts[0] === "produto" && parts[1]) view = productView(ctx, decodeURIComponent(parts[1]));
    else if (parts[0] === "carrinho") view = cartView(ctx);
    else if (parts[0] === "checkout") view = checkoutView(ctx);
    else if (parts[0] === "pedido") view = successView(ctx);
    else if (parts[0] === "privacidade") { document.title = `Política de Privacidade — ${storeName}`; view = legalView(ctx, "privacidade"); }
    else if (parts[0] === "termos") { document.title = `Termos de Uso e Compra — ${storeName}`; view = legalView(ctx, "termos"); }
    else view = homeView(ctx, query);
    shell.main.replaceChildren(view);
    if (!(parts.length === 0 && query.toString())) window.scrollTo(0, 0);
    shell.main.focus({ preventScroll: true });
  }
  render();
  ctx.load().catch(() => {});
}

function buildShell(ctx) {
  const name = () => ctx.settings.store_name || "Francine Furini Store";
  const count = h("span", { class: "cart-count", "data-n": "0", "aria-hidden": "true" }, "0");
  const countSr = h("span", { class: "sr-only" }, "Carrinho vazio");
  const input = h("input", { type: "search", name: "q", id: "q", placeholder: "Buscar peças", autocomplete: "off", enterkeyhint: "search", "aria-label": "Buscar peças" });
  const wordmark = h("a", { class: "wordmark", href: "#/", "aria-label": "Francine Furini Store — início" }, "Francine Furini", h("small", {}, "Store"));
  const announce = h("div", { class: "announce hidden", role: "region", "aria-label": "Aviso" });
  const header = h("header", { class: "site-header" }, announce,
    h("div", { class: "wrap header-row" }, wordmark,
      h("form", { class: "search", role: "search", onsubmit: (e) => { e.preventDefault(); const q = input.value.trim(); ctx.navigate(q ? `#/?q=${encodeURIComponent(q)}` : "#/"); } },
        input, h("button", { type: "submit", "aria-label": "Buscar" }, "Buscar")),
      h("a", { class: "cart-link", href: "#/carrinho" }, "Carrinho", count, countSr)));
  const main = h("main", { id: "main", tabindex: "-1" });
  const footerLinks = h("ul", { class: "legal-links" });
  const footerName = h("strong", {});
  const footer = h("footer", { class: "site-footer" }, h("div", { class: "wrap" },
    h("div", { class: "cols" }, h("div", {}, footerName, h("p", { style: "margin:.25rem 0 0" }, "Moda feminina com atendimento próximo.")), footerLinks),
    h("small", {}, "Frete e pagamento combinados diretamente com a Francine.")));
  footerName.textContent = name();

  return {
    header, main, footer,
    updateCount() {
      const n = totalQuantity(ctx.cart.get());
      count.textContent = String(n); count.dataset.n = String(n);
      countSr.textContent = n ? `${n} item(ns) no carrinho` : "Carrinho vazio";
    },
    syncSearch(q) { if (document.activeElement !== input) input.value = q; },
    updateSettings() {
      const s = ctx.settings;
      footerName.textContent = name();
      announce.textContent = s.announcement_text || "";
      announce.classList.toggle("hidden", !s.announcement_text);
      setChildren(footerLinks,
        s.instagram_url && /^https:\/\//.test(s.instagram_url) ? h("li", {}, h("a", { href: s.instagram_url, target: "_blank", rel: "noopener noreferrer" }, "Instagram")) : null,
        s.whatsapp_number ? h("li", {}, h("a", { href: `https://wa.me/${String(s.whatsapp_number).replace(/\D/g, "")}`, target: "_blank", rel: "noopener noreferrer" }, "WhatsApp")) : null,
        h("li", {}, h("a", { href: "#/privacidade" }, "Privacidade")),
        h("li", {}, h("a", { href: "#/termos" }, "Termos")));
    },
  };
}

boot();
