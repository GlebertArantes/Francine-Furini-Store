import { h } from "../lib/dom.js";
import { formatBRL, centsToInput } from "../lib/money.js";
import { validateProduct, validateVariant, slugify, stockLevel, reorderImages, isoToLocalInput, NEW_PRODUCT_DEFAULTS, visibilityInfo, publishWarnings } from "../lib/rules.js";
import { shouldShrink, shrinkImage } from "../lib/image-resize.js";
import { loadInto, guard, toast, field, showFieldErrors, confirmDialog, stateBox } from "../lib/ui.js";
import { createPhotoQueue, uploadPhotos, createProductWithPhotos, summarizeUpload } from "../lib/photos.js";

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
  // Em "novo", as fotos ficam só na memória do navegador até o produto existir (o picker sobrevive aos redraws).
  const newPhotos = isNew ? photoPicker() : null;
  const draw = () => loadInto(ctx, root,
    async () => ({ categories: await ctx.api.listCategories(), product: isNew ? null : await ctx.api.getProduct(id) }),
    ({ categories, product }) => {
      if (!isNew && !product) { root.replaceChildren(stateBox("Produto não encontrado", "", h("a", { class: "btn secondary", href: "#/produtos" }, "Voltar"))); return; }
      root.replaceChildren(...[
        h("p", { class: "crumbs" }, h("a", { href: "#/produtos" }, "Produtos"), " / ", product?.name ?? "Novo"),
        h("h1", {}, product ? product.name : "Novo produto"),
        ctx.flash ? flashNotice(ctx) : null,
        productForm(ctx, categories, product, draw, newPhotos),
        product ? variantsSection(ctx, product, draw) : h("p", { class: "notice" }, "Depois de criar o produto, você cadastra as cores, tamanhos e o estoque."),
        product ? imagesSection(ctx, product, draw) : null].filter(Boolean));
    });
  draw();
  return root;
}

function productForm(ctx, categories, p, redraw, photos) {
  const val = (v) => v ?? "";
  const inp = (name, v, attrs = {}) => h("input", { name, value: val(v), type: "text", autocomplete: "off", ...attrs });
  const name = inp("name", p?.name, { maxlength: 160, required: true, autocapitalize: "sentences", enterkeyhint: "next" });
  const slug = inp("slug", p?.slug, { maxlength: 80, autocapitalize: "off", spellcheck: "false" });
  if (!p) name.addEventListener("input", () => { if (!slug.dataset.touched) slug.value = slugify(name.value); });
  slug.addEventListener("input", () => { slug.dataset.touched = "1"; });
  const cat = h("select", { name: "category_id" }, h("option", { value: "" }, "Sem categoria"),
    categories.map((c) => h("option", { value: c.id, selected: c.id === p?.category_id }, c.active ? c.name : `${c.name} (inativa)`)));
  const price = inp("price", p ? centsToInput(p.price_cents) : "", { inputmode: "decimal", placeholder: "249,90", enterkeyhint: "next" });
  const compare = inp("compare_at", p ? centsToInput(p.compare_at_price_cents) : "", { inputmode: "decimal", placeholder: "opcional", enterkeyhint: "next" });
  const sku = inp("sku", p?.sku, { maxlength: 60, autocapitalize: "characters" });
  const fabric = inp("fabric", p?.fabric, { maxlength: 120, autocapitalize: "sentences" });
  const desc = h("textarea", { name: "description", rows: 5, autocapitalize: "sentences" }, val(p?.description));
  const pub = h("input", { name: "published_at", type: "datetime-local", value: isoToLocalInput(p?.published_at) });
  const featured = h("input", { name: "featured", type: "checkbox", checked: !!p?.featured });
  // Produto novo nasce OCULTO (rascunho): publicar é decisão explícita.
  const active = h("input", { name: "active", type: "checkbox", checked: p ? p.active : NEW_PRODUCT_DEFAULTS.active });
  const vis = h("div", { class: "vis", role: "status", "aria-live": "polite" });
  const updateVis = () => {
    let iso = null; try { iso = pub.value ? new Date(pub.value).toISOString() : null; } catch { /* data inválida: validada ao salvar */ }
    const i = visibilityInfo({ active: active.checked, published_at: iso });
    vis.className = `vis vis-${i.state}`; // vis-hidden (não usar a classe 'hidden': é utilidade display:none)
    vis.replaceChildren(h("strong", {}, i.label), h("span", {}, ` — ${i.detail}`));
  };
  active.addEventListener("change", updateVis); pub.addEventListener("input", updateVis); updateVis();
  const btn = h("button", { type: "submit", class: "btn" }, p ? "Salvar alterações" : "Criar produto");

  const form = h("form", { class: "panel", novalidate: true },
    h("div", { class: "grid2" },
      field("name", "Nome do produto", name), field("category_id", "Categoria", cat),
      field("price", "Preço atual (R$)", price),
      field("compare_at", "Preço anterior (R$) — opcional", compare, "Para promoção: a loja mostra o preço anterior riscado. Deve ser maior ou igual ao preço atual."),
      field("fabric", "Tecido", fabric)),
    field("description", "Descrição", desc),
    !p ? h("section", { class: "subpanel" }, h("h2", {}, "Fotos do produto"),
      h("p", { class: "muted small" }, "Opcional. As fotos só são enviadas quando você tocar em “Criar produto”."), photos.el) : null,
    h("div", { class: "checks" }, h("label", { class: "check" }, featured, "Destaque na home"), h("label", { class: "check" }, active, "Ativo (visível na loja)")),
    vis,
    h("details", { class: "more" }, h("summary", {}, "Mais opções (endereço da página, SKU, agendar publicação)"),
      h("div", { class: "grid2" }, field("slug", "Endereço da página (slug)", slug, "Gerado do nome; só minúsculas, números e hífens."), field("sku", "SKU (opcional)", sku),
        field("published_at", "Publicar em (opcional)", pub, "Vazio = visível assim que estiver ativo."))),
    btn);
  const save = guard(btn, async () => {
    const v = validateProduct({ name: name.value, slug: slug.value, category_id: cat.value, sku: sku.value, price: price.value, compare_at: compare.value,
      fabric: fabric.value, description: desc.value, published_at: pub.value, featured: featured.checked, active: active.checked });
    showFieldErrors(form, v.errors);
    if (!v.ok) return;
    // Proteção contra publicação acidental: ao PUBLICAR (novo ativo ou rascunho -> ativo) pede confirmação e avisa o que falta.
    if (v.payload.active && (!p || !p.active)) {
      const warnings = publishWarnings(p ? { photos: (p.product_images ?? []).length, variants: p.product_variants ?? [] } : { photos: photos.queue.valid().length, variants: null });
      const ok = await confirmDialog({ title: "Publicar na loja agora?", text: `As clientes poderão ver e comprar este produto assim que você confirmar.${warnings.length ? ` Atenção: ${warnings.join(" ")}` : ""}`, confirmLabel: "Publicar" });
      if (!ok) return;
    }
    try {
      if (p) { await ctx.api.updateProduct(p.id, v.payload); toast(v.payload.active ? "Produto salvo." : "Produto salvo (oculto da loja)."); redraw(); }
      else {
        // 1) cria o produto (falhou => nada é enviado e a seleção de fotos permanece); 2) envia as fotos com o ID retornado.
        const r = await createProductWithPhotos(ctx.api, v.payload, photos.queue, { onProgress: ({ done, total }) => { btn.textContent = `Enviando foto ${done + 1} de ${total}…`; } });
        if (r.sessionExpired) { ctx.fail({ code: "session_expired" }); return; }
        const sum = summarizeUpload(r);
        ctx.flash = sum.hasProblem ? { type: "error", text: `Produto criado, mas houve problemas com as fotos. ${sum.text}` } : null;
        toast(sum.hasProblem ? "Produto criado, mas algumas fotos falharam." : `Produto criado${v.payload.active ? "" : " (oculto da loja)"}.${sum.text ? " " + sum.text : ""} Agora cadastre as variantes.`, sum.hasProblem ? "error" : "ok");
        photos.reset();
        ctx.navigate(`#/produtos/${r.product.id}`);
      }
    } catch (e) {
      if (ctx.fail(e)) return;
      if (e.status === 409) showFieldErrors(form, /sku/i.test(e.details ?? e.message ?? "") ? { sku: "Já existe um produto com esse SKU." } : { slug: "Já existe um produto com esse endereço (slug). Altere em “Mais opções”." });
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
  const color = h("input", { name: "color", value: v?.color ?? "", maxlength: 80, placeholder: "Ex.: Terra", autocomplete: "off", autocapitalize: "sentences", enterkeyhint: "next" });
  const size = h("input", { name: "size", value: v?.size ?? "", maxlength: 40, placeholder: "P, M, 38, Único…", autocomplete: "off", autocapitalize: "characters", enterkeyhint: "next" });
  const sku = h("input", { name: "sku", value: v?.sku ?? "", maxlength: 60, placeholder: "opcional", autocomplete: "off", autocapitalize: "characters" });
  const qty = h("input", { name: "quantity", value: String(v?.quantity ?? 0), inputmode: "numeric", pattern: "[0-9]*", enterkeyhint: "done", autocomplete: "off" });
  const active = h("input", { name: "active", type: "checkbox", checked: v ? v.active : true });
  const mini = (text, input) => h("label", { class: "mini" }, h("span", {}, text), input);
  const err = h("p", { class: "err", role: "alert" });
  const level = v ? stockLevel(v) : null;
  const saveBtn = h("button", { type: "submit", class: "btn small" }, v ? "Salvar" : "Adicionar");
  const form = h("form", { class: "variant-form", novalidate: true }, mini("Cor", color), mini("Tamanho", size), mini("Quantidade em estoque", qty), mini("SKU", sku),
    h("div", { class: "vstate" }, h("label", { class: "check" }, active, "Ativa (visível na loja)"),
      v && level !== "ok" ? h("span", { class: `pill ${level === "out" ? "off" : "warn"}` }, level === "out" ? "Esgotada" : "Estoque baixo") : null),
    h("div", { class: "vactions" }, saveBtn), err);
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
    form.querySelector(".vactions").append(delBtn);
  }
  return li;
}

// ---------------------------------------------------------------- imagens
function imagesSection(ctx, p, redraw) {
  const images = [...(p.product_images ?? [])].sort((a, b) => a.sort_order - b.sort_order);
  const uploadBtn = h("button", { type: "button", class: "btn", disabled: true }, "Enviar fotos");
  const pk = photoPicker({ onChange: (has) => { uploadBtn.disabled = !has; } });
  let moving = false;

  const upload = guard(uploadBtn, async () => {
    const start = images.reduce((m, i) => Math.max(m, i.sort_order), -1) + 1;
    const r = await uploadPhotos(ctx.api, p.id, pk.queue.valid(), start, { onProgress: ({ done, total }) => { uploadBtn.textContent = `Enviando foto ${done + 1} de ${total}…`; } });
    if (r.sessionExpired) { ctx.fail({ code: "session_expired" }); return; }
    const sum = summarizeUpload(r);
    if (sum.text) toast(sum.text, sum.hasProblem ? "error" : "ok");
    pk.reset();
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
    h("div", { class: "upload" }, pk.el, uploadBtn));
}

function flashNotice(ctx) {
  const f = ctx.flash; ctx.flash = null;
  return h("div", { class: `notice${f.type === "error" ? " error" : ""}`, role: "alert" }, f.text);
}

/**
 * Seletor de fotos reutilizável (criação e edição): várias fotos, preview, texto alternativo e remoção
 * da seleção. Mantém tudo em memória (File + URL local); nenhuma requisição é feita aqui.
 */
function photoPicker({ onChange } = {}) {
  const queue = createPhotoQueue();
  const urls = new Map();
  const id = `pick-${Math.random().toString(36).slice(2, 6)}`;
  // O input nativo fica oculto (porém focável); o botão em português abre a galeria do celular.
  const input = h("input", { type: "file", id, class: "file-input", accept: "image/jpeg,image/png,image/webp,image/avif", multiple: true });
  const pick = h("label", { class: "btn secondary", for: id }, "Escolher fotos da galeria");
  const status = h("p", { class: "muted small", role: "status", "aria-live": "polite" });
  const list = h("div", { class: "previews" });
  const info = h("p", { class: "muted small" }, "JPEG, PNG, WebP ou AVIF, até 8 MB cada (fotos maiores são reduzidas automaticamente). A ordem de seleção é a ordem das fotos: a primeira é a principal.");
  let note = "";

  const draw = () => {
    list.replaceChildren(...queue.items.map((it, i) => {
      if (it.check.ok && !urls.has(it.key)) urls.set(it.key, URL.createObjectURL(it.file));
      const alt = h("input", { value: it.alt, maxlength: 200, placeholder: "Texto alternativo (opcional)", "aria-label": `Texto alternativo de ${it.file.name}`, oninput: (e) => queue.setAlt(it.key, e.target.value) });
      const rm = h("button", { type: "button", class: "link-btn danger", "aria-label": `Remover ${it.file.name} da seleção`, onclick: () => { const u = urls.get(it.key); if (u) { URL.revokeObjectURL(u); urls.delete(it.key); } queue.remove(it.key); draw(); } }, "Remover da seleção");
      return h("figure", { class: `preview${it.check.ok ? "" : " bad"}`, "data-photo": it.file.name },
        urls.has(it.key) ? h("img", { src: urls.get(it.key), alt: "Pré-visualização" }) : null,
        h("figcaption", {}, it.check.ok ? `${i === 0 ? "Principal · " : ""}${it.file.name}` : it.file.name),
        it.check.ok ? alt : h("p", { class: "err" }, it.check.error), rm);
    }));
    const n = queue.valid().length;
    status.textContent = `${n ? `${n} foto(s) pronta(s) para enviar.` : "Nenhuma foto selecionada."}${note ? ` ${note}` : ""}`;
    onChange?.(n > 0);
  };
  input.addEventListener("change", async () => {
    const files = [...input.files]; input.value = "";
    const prepared = []; let shrunk = 0;
    for (const f of files) {
      if (shouldShrink(f)) {
        status.textContent = `Reduzindo a foto grande “${f.name}”…`;
        try { prepared.push(await shrinkImage(f)); shrunk++; continue; } catch { /* mantém o original: será sinalizado como grande demais */ }
      }
      prepared.push(f);
    }
    note = shrunk ? `${shrunk} foto(s) grande(s) reduzida(s) automaticamente.` : "";
    queue.add(prepared); draw();
  });
  draw();

  return {
    queue,
    el: h("div", { class: "photo-picker" }, input, pick, status, info, list),
    reset() { for (const u of urls.values()) URL.revokeObjectURL(u); urls.clear(); queue.clear(); note = ""; draw(); },
  };
}
