import { h } from "../lib/dom.js";
import { filterProducts, facets, featuredProducts } from "../lib/catalog.js";
import { productCard, loadingGrid, stateBlock } from "./common.js";

export function homeView(ctx, query) {
  const root = h("div", {});
  const q = query.get("q") ?? "";
  const cat = query.get("cat") ?? "";
  const size = query.get("size") ?? "";
  const color = query.get("color") ?? "";
  const disp = query.get("disp") === "1";
  const filtered = !!(q || cat || size || color || disp);

  const go = (patch) => {
    const n = new URLSearchParams(query);
    for (const [k, v] of Object.entries(patch)) (v ? n.set(k, v) : n.delete(k));
    const s = n.toString();
    ctx.navigate(`#/${s ? `?${s}` : ""}`);
  };

  root.append(h("div", { class: "wrap" }, loadingGrid()));
  ctx.load().then(() => render(), () => {
    root.replaceChildren(h("div", { class: "wrap" }, stateBlock("Não foi possível carregar a loja",
      "Verifique sua conexão e tente novamente.", h("button", { class: "btn secondary", onclick: () => { ctx.load(true); ctx.rerender(); } }, "Tentar novamente"))));
  });

  function render() {
    const { products, categories } = ctx;
    const activeCat = categories.find((c) => c.slug === cat);
    const f = facets(products);
    const list = filterProducts(products, { q, categoryId: activeCat?.id, size, color, onlyAvailable: disp }, categories);
    const parts = [];

    if (!filtered) {
      parts.push(h("section", { class: "hero" }, h("div", { class: "wrap" },
        h("p", { class: "eyebrow" }, ctx.settings.store_name || "Francine Furini Store"),
        h("h1", {}, "Moda feminina com elegância e atendimento próximo"),
        h("p", {}, "Peças pensadas para vestir bem, com a atenção de quem escolhe cada detalhe junto com você."),
        h("a", { class: "btn", href: "#catalogo" , onclick: (e) => { e.preventDefault(); document.getElementById("catalogo")?.scrollIntoView({ behavior: "smooth" }); } }, "Ver coleção"))));
    }

    const body = h("div", { class: "wrap section", id: "catalogo" });
    if (categories.length) {
      body.append(h("nav", { class: "chips", "aria-label": "Categorias" },
        h("a", { class: "chip", href: "#/", "aria-current": String(!cat), onclick: (e) => { e.preventDefault(); go({ cat: "" }); } }, "Todas"),
        categories.map((c) => h("a", { class: "chip", href: `#/?cat=${encodeURIComponent(c.slug)}`, "aria-current": String(c.slug === cat),
          onclick: (e) => { e.preventDefault(); go({ cat: c.slug }); } }, c.name))));
    }

    if (products.length) {
      const sel = (id, label, value, options, key) => h("div", { class: "field" }, h("label", { for: id }, label),
        h("select", { id, onchange: (e) => go({ [key]: e.target.value }) }, h("option", { value: "" }, "Todos"),
          options.map((o) => h("option", { value: o, selected: o === value }, o))));
      body.append(h("details", { class: "filters", open: !!(size || color || disp) },
        h("summary", {}, h("span", {}, "Filtrar"), h("span", { "aria-hidden": "true" }, "+")),
        h("div", { class: "filter-grid" }, sel("f-size", "Tamanho", size, f.sizes, "size"), sel("f-color", "Cor", color, f.colors, "color"),
          h("label", { class: "check" }, h("input", { type: "checkbox", checked: disp, onchange: (e) => go({ disp: e.target.checked ? "1" : "" }) }), "Somente disponíveis"))));
    }

    if (q) body.append(h("p", { class: "muted", role: "status" }, `${list.length} resultado(s) para “${q}”. `, h("a", { href: "#/" }, "Limpar busca")));

    if (!products.length) {
      body.append(stateBlock("Novidades em breve", "Estamos preparando a coleção. Volte logo ou fale com a Francine pelo WhatsApp."));
    } else if (!list.length) {
      body.append(stateBlock("Nenhuma peça encontrada", "Tente outros filtros ou limpe a busca.", h("a", { class: "btn secondary", href: "#/" }, "Ver tudo")));
    } else {
      const feat = !filtered ? featuredProducts(products) : [];
      if (feat.length) {
        body.append(h("div", { class: "section-head" }, h("h2", {}, "Destaques")),
          h("ul", { class: "grid" }, feat.map((p) => productCard(ctx, p))),
          h("div", { class: "section-head", style: "margin-top:3.5rem" }, h("h2", {}, "Toda a coleção")));
      } else if (!filtered) {
        body.append(h("div", { class: "section-head" }, h("h2", {}, "Coleção")));
      }
      body.append(h("ul", { class: "grid" }, list.map((p) => productCard(ctx, p))));
    }
    parts.push(body);
    root.replaceChildren(...parts);
  }
  return root;
}
