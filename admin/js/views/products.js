import { h } from "../lib/dom.js";
import { formatBRL, centsToInput } from "../lib/money.js";
import { validateProduct, validateVariant, slugify, stockLevel, validateImageFile, reorderImages, isoToLocalInput } from "../lib/rules.js";
import { loadInto, guard, toast, field, showFieldErrors, confirmDialog, stateBox } from "../lib/ui.js";

// ---------------------------------------------------------------- lista
export function productsListView(ctx) {
  const root = h("div", { class: "page" });
  let q = "", status = "";
  loadInto(ctx, root, () => ctx.api.listProducts(), (products) => {
    const list = h("div", { class: "cards" });
    const draw = () => {
      const t = q.trim().toLowerCase();
      const shown = products.filter((p) => (!t || `${p.name} ${p.sku ?? ""} ${p.slug}`.toLowerCase().includes(t))
        && (!status || (status === "active" ? p.active : !p.active)));
      list.replaceChildren(...(shown.length ? shown.map(card) : [stateBox("Nenhum produto encontrado", "Ajuste a busca ou crie um produto.")]));
    };
    const card = (p) => {
      const vs = p.product_variants ?? [];
      const stock = vs.filter((v) => v.active).reduce((n, v) => n + v.quantity, 0);
      const low = vs.filter((v) => v.active && stockLevel(v) !== "ok").length;
      return h("a", { class: "item", href: `#/produtos/${p.id}` },
        h("div", {}, h("strong", {}, p.name), h("div", { class: "muted small" }, `${p.sku ? p.sku + " · " : ""}${vs.length} variante(s) · ${stock} em estoque${low ? ` · ${low} com estoque baixo/esgotado` : ""} · ${(p.product_images ?? []).length} foto(s)`)),
        h("div", { class: "right" }, h("span", {}, formatBRL(p.price_cents)), h("span", { class: `pill ${p.active ? "ok" : "off"}` }, p.active ? "Ativo" : "Inativo"), p.featured ? h("span", { class: "pill" }, "Destaque") : null));
    };
    root.replaceChildren(
      h("div", { class: "page-head" }, h("h1", {}, "Produtos"), h("a", { class: "btn", href: "#/produtos/novo" }, "Novo produto")),
      h("div", { class: "toolbar" },
        h("input", { type: "search", placeholder: "Buscar por nome, slug ou SKU", "aria-label": "Buscar produtos", oninput: (e) => { q = e.target.value; draw(); } }),
        h("select", { "aria-label": "Status", onchange: (e) => { status = e.target.value; draw(); } }, h("option", { value: "" }, "Todos"), h("option", { value: "active" }, "Ativos"), h("option", { value: "inactive" }, "Inativos"))),
      list);
    draw();
  });
  return root;
}

// ---------------------------------------------------------------- edição
export function productEditView(ctx, id) {
  const root = h("div", { class: "page" });
  const isNew = id === "novo";
  const draw = () => loadInto(ctx, root,
    async () => ({ categories: await ctx.api.listCategories(), product: isNew ? null : await ctx.api.getProduct(id) }),
    ({ categories, product }) => {
      if (!isNew && !product) { root.replaceChildren(stateBox("Produto não encontrado", "", h("a", { class: "btn secondary", href: "#/produtos" }, "Voltar"))); return; }
      root.replaceChildren(
        h("p", { class: "crumbs" }, h("a", { href: "#/produtos" }, "Produtos"), " / ", product?.name ?? "Novo"),
        h("h1", {}, product ? product.name : "Novo produto"),
        productForm(ctx, categories, product, draw),
        product ? variantsSection(ctx, product, draw) : h("p", { class: "notice" }, "Salve o produto para adicionar variantes (cor/tamanho/estoque) e fotos."),
        product ? imagesSection(ctx, product, draw) : null);
    });
  draw();
  return root;
}

function productForm(ctx, categories, p, redraw) {
  const val = (v) => v ?? "";
  const inp = (name, v, attrs = {}) => h("input", { name, value: val(v), type: "text", ...attrs });
  const name = inp("name", p?.name, { maxlength: 160, required: true });
  const slug = inp("slug", p?.slug, { maxlength: 80, autocapitalize: "off" });
  if (!p) name.addEventListener("input", () => { if (!slug.dataset.touched) slug.value = slugify(name.value); });
  slug.addEventListener("input", () => { slug.dataset.touched = "1"; });
  const cat = h("select", { name: "category_id" }, h("option", { value: "" }, "Sem categoria"),
    categories.map((c) => h("option", { value: c.id, selected: c.id === p?.category_id }, c.active ? c.name : `${c.name} (inativa)`)));
  const price = inp("price", p ? centsToInput(p.price_cents) : "", { inputmode: "decimal", placeholder: "249,90" });
  const compare = inp("compare_at", p ? centsToInput(p.compare_at_price_cents) : "", { inputmode: "decimal", placeholder: "opcional" });
  const sku = inp("sku", p?.sku, { maxlength: 60 });
  const fabric = inp("fabric", p?.fabric, { maxlength: 120 });
  const desc = h("textarea", { name: "description", rows: 5 }, val(p?.description));
  const pub = h("input", { name: "published_at", type: "datetime-local", value: isoToLocalInput(p?.published_at) });
  const featured = h("input", { name: "featured", type: "checkbox", checked: !!p?.featured });
  const active = h("input", { name: "active", type: "checkbox", checked: p ? p.active : true });
  const btn = h("button", { type: "submit", class: "btn" }, p ? "Salvar alterações" : "Criar produto");

  const form = h("form", { class: "panel", novalidate: true },
    h("div", { class: "grid2" },
      field("name", "Nome", name), field("slug", "Slug (endereço)", slug, "Gerado do nome; só minúsculas, números e hífens."),
      field("category_id", "Categoria", cat), field("sku", "SKU (opcional)", sku),
      field("price", "Preço atual (R$)", price), field("compare_at", "Preço anterior (R$) — opcional", compare, "Se preenchido, a loja mostra como preço promocional. Deve ser ≥ preço atual."),
      field("fabric", "Tecido", fabric), field("published_at", "Publicar em (opcional)", pub, "Vazio = visível assim que ativo.")),
    field("description", "Descrição", desc),
    h("div", { class: "checks" }, h("label", { class: "check" }, featured, "Destaque na home"), h("label", { class: "check" }, active, "Ativo (visível na loja)")),
    btn);
  const save = guard(btn, async () => {
    const v = validateProduct({ name: name.value, slug: slug.value, category_id: cat.value, sku: sku.value, price: price.value, compare_at: compare.value,
      fabric: fabric.value, description: desc.value, published_at: pub.value, featured: featured.checked, active: active.checked });
    showFieldErrors(form, v.errors);
    if (!v.ok) return;
    try {
      if (p) { await ctx.api.updateProduct(p.id, v.payload); toast("Produto salvo."); redraw(); }
      else { const created = await ctx.api.createProduct(v.payload); toast("Produto criado. Adicione variantes e fotos."); ctx.navigate(`#/produtos/${created.id}`); }
    } catch (e) {
      if (ctx.fail(e)) return;
      if (e.status === 409) showFieldErrors(form, /sku/i.test(e.details ?? e.message ?? "") ? { sku: "Já existe um produto com esse SKU." } : { slug: "Já existe um produto com esse slug." });
      else toast("Não foi possível salvar o produto. Confira os dados e tente novamente.", "error");
    }
  });
  form.addEventListener("submit", (e) => { e.preventDefault(); save(); });
  return form;
}

// ---------------------------------------------------------------- variantes
function variantsSection(ctx, p, redraw) {
  const rows = [...(p.product_variants ?? [])].sort((a, b) => a.color.localeCompare(b.color, "pt-BR") || a.size.localeCompare(b.size, "pt-BR", { numeric: true }));
  return h("section", { class: "panel" },
    h("h2", {}, "Variantes e estoque"),
    h("p", { class: "notice" }, "Alterar a quantidade aqui é um ", h("strong", {}, "ajuste manual de estoque"), ". As vendas só baixam o estoque quando você conclui o pedido."),
    h("ul", { class: "rows" }, rows.map((v) => variantRow(ctx, p, v, redraw)), variantRow(ctx, p, null, redraw)));
}

function variantRow(ctx, p, v, redraw) {
  const color = h("input", { name: "color", value: v?.color ?? "", maxlength: 80, "aria-label": "Cor", placeholder: "Cor" });
  const size = h("input", { name: "size", value: v?.size ?? "", maxlength: 40, "aria-label": "Tamanho", placeholder: "Tamanho (P, 38, Único…)" });
  const sku = h("input", { name: "sku", value: v?.sku ?? "", maxlength: 60, "aria-label": "SKU", placeholder: "SKU" });
  const qty = h("input", { name: "quantity", value: String(v?.quantity ?? 0), inputmode: "numeric", "aria-label": "Quantidade em estoque", size: 5 });
  const active = h("input", { name: "active", type: "checkbox", checked: v ? v.active : true, "aria-label": "Ativa" });
  const err = h("p", { class: "err", role: "alert" });
  const level = v ? stockLevel(v) : null;
  const saveBtn = h("button", { type: "submit", class: "btn small" }, v ? "Salvar" : "Adicionar");
  const form = h("form", { class: "inline-form", novalidate: true }, color, size, sku, qty, h("label", { class: "check" }, active, "Ativa"),
    v && level !== "ok" ? h("span", { class: `pill ${level === "out" ? "off" : "warn"}` }, level === "out" ? "Esgotada" : "Estoque baixo") : null, saveBtn, err);
  const save = guard(saveBtn, async () => {
    const r = validateVariant({ color: color.value, size: size.value, sku: sku.value, quantity: qty.value, active: active.checked });
    err.textContent = Object.values(r.errors)[0] ?? "";
    if (!r.ok) return;
    try {
      if (v) await ctx.api.updateVariant(v.id, r.payload); else await ctx.api.createVariant(p.id, r.payload);
      toast(v ? "Variante salva." : "Variante adicionada."); redraw();
    } catch (e) {
      if (ctx.fail(e)) return;
      err.textContent = e.status === 409 ? "Já existe essa combinação de cor e tamanho (ou o SKU já está em uso)." : "Não foi possível salvar a variante.";
    }
  });
  form.addEventListener("submit", (e) => { e.preventDefault(); save(); });
  const li = h("li", { class: v ? "" : "new" }, form);
  if (v) {
    const delBtn = h("button", { type: "button", class: "link-btn danger" }, "Remover");
    const del = guard(delBtn, async () => {
      if (!(await confirmDialog({ title: "Remover variante?", text: `${v.color} · ${v.size} será removida do produto. Se já apareceu em pedidos, o banco não permite remover: desative-a.`, confirmLabel: "Remover", danger: true }))) return;
      try { await ctx.api.deleteVariant(v.id); toast("Variante removida."); redraw(); }
      catch (e) {
        if (ctx.fail(e)) return;
        err.textContent = e.status === 409 ? "Esta variante já aparece em pedidos e não pode ser removida. Desative-a." : "Não foi possível remover.";
      }
    });
    delBtn.addEventListener("click", del);
    form.append(delBtn);
  }
  return li;
}

// ---------------------------------------------------------------- imagens
function imagesSection(ctx, p, redraw) {
  const images = [...(p.product_images ?? [])].sort((a, b) => a.sort_order - b.sort_order);
  const picker = h("input", { type: "file", id: "pick", accept: "image/jpeg,image/png,image/webp,image/avif", multiple: true });
  const previews = h("div", { class: "previews" });
  const info = h("p", { class: "muted small" }, "JPEG, PNG, WebP ou AVIF, até 8 MB cada.");
  const uploadBtn = h("button", { type: "button", class: "btn", disabled: true }, "Enviar fotos");
  let queue = [];
  let moving = false;
  const urls = [];

  picker.addEventListener("change", () => {
    urls.splice(0).forEach((u) => URL.revokeObjectURL(u));
    queue = [...picker.files].map((file) => ({ file, check: validateImageFile(file), url: null, alt: "" }));
    previews.replaceChildren(...queue.map((it) => {
      if (it.check.ok) { it.url = URL.createObjectURL(it.file); urls.push(it.url); }
      const alt = h("input", { placeholder: "Texto alternativo (descreva a foto)", "aria-label": `Texto alternativo de ${it.file.name}`, oninput: (e) => { it.alt = e.target.value; } });
      return h("figure", { class: `preview${it.check.ok ? "" : " bad"}` }, it.url ? h("img", { src: it.url, alt: "Pré-visualização" }) : null,
        h("figcaption", {}, it.file.name), it.check.ok ? alt : h("p", { class: "err" }, it.check.error));
    }));
    uploadBtn.disabled = !queue.some((i) => i.check.ok);
  });

  const upload = guard(uploadBtn, async () => {
    const ok = queue.filter((i) => i.check.ok);
    let next = images.reduce((m, i) => Math.max(m, i.sort_order), -1) + 1;
    let sent = 0;
    for (const it of ok) {
      try { await ctx.api.uploadImage(p.id, it.file, { altText: it.alt.trim(), sortOrder: next++ }); sent++; }
      catch (e) { if (ctx.fail(e)) return; toast(`Falha ao enviar ${it.file.name}.`, "error"); }
    }
    if (sent) toast(`${sent} foto(s) enviada(s).`);
    urls.splice(0).forEach((u) => URL.revokeObjectURL(u));
    redraw();
  });
  uploadBtn.addEventListener("click", upload);

  const imgRow = (im, i) => {
    const alt = h("input", { value: im.alt_text ?? "", maxlength: 200, "aria-label": "Texto alternativo", placeholder: "Texto alternativo" });
    const altBtn = h("button", { type: "button", class: "btn small secondary" }, "Salvar texto");
    altBtn.addEventListener("click", guard(altBtn, async () => {
      try { await ctx.api.updateImage(im.id, { alt_text: alt.value.trim() || null }); toast("Texto salvo."); } catch (e) { if (!ctx.fail(e)) toast("Não foi possível salvar.", "error"); }
    }));
    const move = async (dir) => {
      if (moving) return;
      moving = true;
      try { for (const u of reorderImages(images, im.id, dir)) await ctx.api.updateImage(u.id, { sort_order: u.sort_order }); redraw(); }
      catch (e) { if (!ctx.fail(e)) toast("Não foi possível reordenar.", "error"); }
      finally { moving = false; }
    };
    const delBtn = h("button", { type: "button", class: "link-btn danger" }, "Remover foto");
    delBtn.addEventListener("click", guard(delBtn, async () => {
      if (!(await confirmDialog({ title: "Remover foto?", text: "A foto sai da loja e o arquivo é apagado do armazenamento.", confirmLabel: "Remover", danger: true }))) return;
      try {
        const r = await ctx.api.deleteImage(im);
        toast(r.orphan ? "Foto removida da loja, mas o arquivo não pôde ser apagado do armazenamento." : "Foto removida.", r.orphan ? "error" : "ok");
        redraw();
      } catch (e) { if (!ctx.fail(e)) toast("Não foi possível remover a foto.", "error"); }
    }));
    return h("li", { class: "img-row" }, h("img", { src: ctx.api.previewUrl(im.storage_path), alt: im.alt_text ?? "", loading: "lazy" }),
      h("div", { class: "grow" }, h("small", { class: "muted" }, i === 0 ? "Foto principal" : `Foto ${i + 1}`), alt,
        h("div", { class: "btn-row" }, altBtn,
          h("button", { type: "button", class: "btn small secondary", disabled: i === 0, "aria-label": "Mover para cima", onclick: () => move("up") }, "↑"),
          h("button", { type: "button", class: "btn small secondary", disabled: i === images.length - 1, "aria-label": "Mover para baixo", onclick: () => move("down") }, "↓"),
          delBtn)));
  };

  return h("section", { class: "panel" }, h("h2", {}, "Fotos"),
    images.length ? h("ul", { class: "rows imgs" }, images.map(imgRow)) : h("p", { class: "muted" }, "Nenhuma foto ainda."),
    h("div", { class: "upload" }, h("label", { for: "pick" }, "Adicionar fotos"), picker, info, previews, uploadBtn));
}
