import { h } from "../lib/dom.js";
import { loadInto } from "../lib/ui.js";

export function dashboardView(ctx) {
  const root = h("div", { class: "page" });
  loadInto(ctx, root, () => ctx.api.dashboard(), (d) => {
    const card = (n, label, href, tone) => h("a", { class: `stat ${tone ?? ""}`, href }, h("strong", {}, String(n)), h("span", {}, label));
    root.replaceChildren(h("h1", {}, "Painel"),
      h("h2", { class: "sub" }, "Pedidos"),
      h("div", { class: "stats" },
        card(d.pending, "Aguardando frete", "#/pedidos?status=pending_shipping", d.pending ? "attn" : ""),
        card(d.contacted, "Clientes contatadas", "#/pedidos?status=contacted"),
        card(d.completed, "Vendas concluídas", "#/pedidos?status=completed")),
      h("h2", { class: "sub" }, "Catálogo"),
      h("div", { class: "stats" },
        card(d.products, "Produtos ativos", "#/produtos"),
        card(d.low, "Variantes com estoque baixo (≤ 2)", "#/produtos", d.low ? "attn" : ""),
        card(d.out, "Variantes esgotadas", "#/produtos", d.out ? "attn" : "")),
      h("p", { class: "muted small" }, "Estoque baixo e esgotado consideram apenas variantes ativas."));
  });
  return root;
}
