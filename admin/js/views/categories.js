import { h } from "../lib/dom.js";
import { validateCategory, slugify } from "../lib/rules.js";
import { loadInto, guard, toast } from "../lib/ui.js";

export function categoriesView(ctx) {
  const root = h("div", { class: "page" });
  const draw = () => loadInto(ctx, root, () => ctx.api.listCategories(), (cats) => {
    root.replaceChildren(h("h1", {}, "Categorias"),
      h("p", { class: "muted" }, "Para tirar uma categoria da loja, desative-a. A exclusão não é oferecida na V1."),
      h("ul", { class: "rows" }, cats.map((c) => row(c)), row(null)));
  });

  function row(c) {
    const f = h("form", { class: "inline-form", novalidate: true });
    f.dataset.new = c ? "" : "1";
    const name = h("input", { name: "name", value: c?.name ?? "", maxlength: 80, "aria-label": "Nome", placeholder: "Nova categoria" });
    const slug = h("input", { name: "slug", value: c?.slug ?? "", maxlength: 80, "aria-label": "Slug", placeholder: "gerado do nome" });
    const sort = h("input", { name: "sort_order", value: String(c?.sort_order ?? 0), inputmode: "numeric", "aria-label": "Ordem", size: 4 });
    const active = h("input", { name: "active", type: "checkbox", checked: c ? c.active : true, "aria-label": "Ativa" });
    if (!c) name.addEventListener("input", () => { if (!slug.dataset.touched) slug.value = slugify(name.value); });
    slug.addEventListener("input", () => { slug.dataset.touched = "1"; });
    const btn = h("button", { type: "submit", class: "btn small" }, c ? "Salvar" : "Criar");
    const err = h("p", { class: "err", role: "alert" });
    const save = guard(btn, async () => {
      const v = validateCategory({ name: name.value, slug: slug.value, sort_order: sort.value, active: active.checked });
      err.textContent = Object.values(v.errors)[0] ?? "";
      if (!v.ok) return;
      try {
        if (c) await ctx.api.updateCategory(c.id, v.payload); else await ctx.api.createCategory(v.payload);
        toast(c ? "Categoria salva." : "Categoria criada."); draw();
      } catch (e) {
        if (ctx.fail(e)) return;
        err.textContent = e.status === 409 ? "Já existe uma categoria com esse slug." : "Não foi possível salvar. Tente novamente.";
      }
    });
    f.addEventListener("submit", (e) => { e.preventDefault(); save(); });
    f.append(name, slug, sort, h("label", { class: "check" }, active, "Ativa"), btn, err);
    return h("li", { class: c ? "" : "new" }, f);
  }
  draw();
  return root;
}
