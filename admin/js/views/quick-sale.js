import { h } from "../lib/dom.js";
import { formatBRL } from "../lib/money.js";
import { loadInto, guard, toast, confirmDialog, fmtDateTime, stateBox } from "../lib/ui.js";
import { CHANNELS, channelLabel, saleLines, addSaleItem, removeSaleItem, changeSaleQty, saleTotal, salePayload, saleError } from "../lib/quick-sale.js";

// Registro de vendas FORA da loja. A baixa real acontece exclusivamente na RPC do banco.
export function quickSaleView(ctx) {
  const root = h("div", { class: "page" });
  const load = () => loadInto(ctx, root, async () => {
    const [products, sales] = await Promise.all([ctx.api.listQuickSaleProducts(), ctx.api.listExternalSales()]);
    return { products, sales };
  }, render);

  function render({ products, sales }) {
    const lines = saleLines(products);
    let cart = [], request = null, requestKey = null;
    const search = h("input", { type: "search", placeholder: "Buscar peca, cor ou tamanho", "aria-label": "Buscar peca" });
    const channel = h("select", { "aria-label": "Origem da venda" },
      CHANNELS.map((c) => h("option", { value: c.value }, c.label)));
    const results = h("div", { class: "quick-results" });
    const selection = h("div", { class: "quick-items" });
    const total = h("strong", {}, formatBRL(0));
    const note = h("p", { class: "muted small", role: "status", "aria-live": "polite" },
      "O estoque so muda depois de confirmar a venda.");
    const confirm = h("button", { type: "button", class: "btn", disabled: true }, "Confirmar venda");
    const invalidate = () => { request = null; requestKey = null; };
    const errToast = (code) => toast(code === "insufficient_stock"
      ? "Quantidade acima do estoque. Confira a peca." : "Nao foi possivel adicionar esta peca.", "error");

    const drawResults = () => {
      const q = search.value.trim().toLocaleLowerCase("pt-BR");
      const match = lines.filter((line) => !q ||
        [line.name, line.color, line.size].join(" ").toLocaleLowerCase("pt-BR").includes(q)).slice(0, 70);
      results.replaceChildren(...(match.length ? match.map((line) => {
        const inCart = cart.find((x) => x.id === line.id)?.quantity ?? 0;
        const available = Math.max(0, line.stock - inCart);
        const btn = h("button", { type: "button", class: "btn small", disabled: available <= 0,
          onclick: () => {
            const r = addSaleItem(cart, line);
            if (!r.ok) return errToast(r.code);
            cart = r.cart; invalidate(); drawResults(); drawSelection();
          } }, available ? "Vendi 1" : "Sem saldo");
        return h("div", { class: "quick-line" },
          h("div", {}, h("strong", {}, line.name),
            h("div", { class: "muted small" }, `${line.color} · ${line.size}${line.published ? "" : " · Produto oculto"}`),
            h("div", { class: "muted small" }, `${formatBRL(line.price_cents)} · ${available} disponivel(is)`)),
          btn);
      }) : [stateBox("Nenhuma peca encontrada", "Confira a busca ou o estoque das variantes.")]));
    };

    const drawSelection = () => {
      selection.replaceChildren(...(cart.length ? cart.map((line) => h("div", { class: "quick-line" },
        h("div", {}, h("strong", {}, line.name),
          h("div", { class: "muted small" }, `${line.color} · ${line.size} · ${formatBRL(line.price_cents)}`)),
        h("div", { class: "quick-qty" },
          h("button", { type: "button", class: "btn small secondary", "aria-label": "Diminuir", onclick: () => setQty(line, line.quantity - 1) }, "−"),
          h("span", { "aria-label": `${line.quantity} peca(s)` }, String(line.quantity)),
          h("button", { type: "button", class: "btn small secondary", "aria-label": "Aumentar", disabled: line.quantity >= line.stock, onclick: () => setQty(line, line.quantity + 1) }, "+"),
          h("button", { type: "button", class: "link-btn danger", onclick: () => {
            cart = removeSaleItem(cart, line.id); invalidate(); drawResults(); drawSelection();
          } }, "Remover")))) : [h("p", { class: "muted" }, "Toque em Vendi 1 para selecionar a peca.")]));
      total.textContent = formatBRL(saleTotal(cart));
      confirm.disabled = cart.length === 0;
    };

    const setQty = (line, qty) => {
      if (qty === 0) cart = removeSaleItem(cart, line.id);
      else {
        const r = changeSaleQty(cart, line.id, qty);
        if (!r.ok) return errToast(r.code);
        cart = r.cart;
      }
      invalidate(); drawResults(); drawSelection();
    };
    search.addEventListener("input", drawResults);
    channel.addEventListener("change", invalidate);
    confirm.addEventListener("click", guard(confirm, async () => {
      const items = salePayload(cart);
      if (!items || !CHANNELS.some((c) => c.value === channel.value)) {
        toast("Confira as pecas e quantidades.", "error"); return;
      }
      const summary = cart.map((x) => `${x.quantity}× ${x.name} (${x.color}/${x.size})`).join("; ");
      if (!(await confirmDialog({ title: "Confirmar venda externa?",
        text: `${summary}. Origem: ${channelLabel(channel.value)}. Total de referencia: ${formatBRL(saleTotal(cart))}. O estoque sera baixado imediatamente.`,
        confirmLabel: "Confirmar e baixar estoque" }))) return;
      const key = JSON.stringify({ channel: channel.value, items });
      if (requestKey !== key) { request = crypto.randomUUID(); requestKey = key; }
      try {
        const result = await ctx.api.registerExternalSale(request, channel.value, items);
        if (!result?.sale_id) throw new Error("invalid_response");
        toast(result.already_done ? "Venda ja registrada; estoque nao foi baixado novamente." : "Venda registrada e estoque atualizado.");
        ctx.navigate("#/venda-rapida"); // recarrega estoque e historico real do banco
      } catch (err) {
        if (ctx.fail(err)) return;
        note.textContent = "Se a conexao caiu depois da confirmacao, confira o historico antes de tentar novamente.";
        toast(saleError(err), "error"); // o request_id e mantido para retry idempotente
      }
    }));

    const history = h("div", { class: "cards" },
      ...(sales.length ? sales.map((s) => h("div", { class: "item" },
        h("div", {}, h("strong", {}, `${fmtDateTime(s.created_at)} · ${channelLabel(s.channel)}`),
          h("div", { class: "muted small" }, (s.external_sale_items ?? [])
            .map((i) => `${i.quantity}× ${i.product_name} (${i.color}/${i.size})`).join("; "))),
        h("strong", {}, formatBRL(s.total_cents)))) :
        [h("p", { class: "muted" }, "Ainda nao ha vendas externas registradas.")]));
    root.replaceChildren(
      h("div", { class: "page-head" }, h("h1", {}, "Venda Rapida"),
        h("p", { class: "muted" }, "Para vendas feitas por fora do site.")),
      h("div", { class: "quick-layout" },
        h("section", { class: "panel" }, h("h2", {}, "Escolha as pecas"), search, results),
        h("section", { class: "panel" }, h("h2", {}, "Nova venda"),
          h("div", { class: "field" }, h("label", {}, "Onde vendeu?"), channel),
          selection,
          h("div", { class: "quick-total" }, h("span", {}, "Total de referencia"), total),
          note, confirm)),
      h("section", { class: "panel" }, h("h2", {}, "Ultimas vendas externas"), history));
    drawResults(); drawSelection();
  }
  load();
  return root;
}
