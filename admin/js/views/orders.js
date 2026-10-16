import { h } from "../lib/dom.js";
import { formatBRL, centsToInput } from "../lib/money.js";
import { STATUS_LABEL, availableActions, hasShipping, createOrderActions } from "../lib/orders.js";
import { loadInto, guard, toast, confirmDialog, fmtDateTime, stateBox } from "../lib/ui.js";

const pill = (s) => h("span", { class: `pill st-${s}` }, STATUS_LABEL[s] ?? s);

// ---------------------------------------------------------------- lista
export function ordersListView(ctx, query) {
  const root = h("div", { class: "page" });
  const status = query.get("status") ?? "";
  loadInto(ctx, root, () => ctx.api.listOrders(status), (orders) => {
    root.replaceChildren(h("h1", {}, "Pedidos"),
      h("div", { class: "toolbar" }, h("label", { class: "sr-only", for: "st" }, "Filtrar por status"),
        h("select", { id: "st", onchange: (e) => ctx.navigate(`#/pedidos${e.target.value ? `?status=${e.target.value}` : ""}`) },
          h("option", { value: "" }, "Todos os status"),
          Object.entries(STATUS_LABEL).map(([k, l]) => h("option", { value: k, selected: k === status }, l)))),
      orders.length ? h("div", { class: "cards" }, orders.map((o) => h("a", { class: "item", href: `#/pedidos/${o.id}` },
        h("div", {}, h("strong", {}, o.display_code), h("div", { class: "muted small" }, `${o.customer_name} · ${fmtDateTime(o.created_at)}`)),
        h("div", { class: "right" }, pill(o.status), h("span", {}, formatBRL(o.subtotal_cents)),
          hasShipping(o) ? h("span", { class: "muted small" }, `Frete ${formatBRL(o.shipping_cents)} · Total ${formatBRL(o.final_total_cents)}`) : h("span", { class: "muted small" }, "Frete a definir")))))
        : stateBox("Nenhum pedido", status ? "Não há pedidos com este status." : "Os pedidos enviados pela loja aparecem aqui."));
  });
  return root;
}

// ---------------------------------------------------------------- detalhe
export function orderDetailView(ctx, id) {
  const root = h("div", { class: "page" });
  const actions = createOrderActions(ctx.api.rpc);
  const draw = (notice) => loadInto(ctx, root, () => ctx.api.getOrder(id), (o) => {
    if (!o) { root.replaceChildren(stateBox("Pedido não encontrado", "", h("a", { class: "btn secondary", href: "#/pedidos" }, "Voltar"))); return; }
    render(o, notice);
  });

  function render(o, notice) {
    const act = availableActions(o);
    const items = [...(o.order_items ?? [])];
    const history = [...(o.order_status_history ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at));
    const phone = String(o.customer_phone ?? "");
    const waNumber = phone.length <= 11 ? `55${phone}` : phone;
    const waUrl = `https://wa.me/${waNumber}?text=${encodeURIComponent(`Olá! Sobre o seu pedido ${o.display_code} na Francine Furini Store.`)}`;
    const noteIn = h("input", { id: "note", maxlength: 500, placeholder: "Observação interna (opcional)" });
    const shipIn = h("input", { id: "ship", inputmode: "decimal", placeholder: "0,00", value: o.shipping_cents != null ? centsToInput(o.shipping_cents) : "", "aria-describedby": "ship-help" });
    const msg = h("div", { "aria-live": "polite" });
    if (notice) msg.append(notice);

    // Executa a ação, mostra o resultado real e recarrega o pedido (sem sucesso falso).
    const run = (btn, fn, okText) => guard(btn, async () => {
      const r = await fn();
      if (r?.skipped) return;
      if (r.ok) { toast(r.alreadyDone ? "Ação já havia sido aplicada." : okText); return draw(); }
      if (ctx.fail({ code: r.code })) return;
      const shortages = r.shortages?.length ? h("ul", {}, r.shortages.map((s) => h("li", {}, `${s.product_name ?? "Item"}: pedido ${s.requested}, disponível ${s.available}`))) : null;
      msg.replaceChildren(h("div", { class: "notice error", role: "alert" }, r.message, shortages));
      msg.scrollIntoView({ block: "nearest" });
      if (r.code === "insufficient_stock") toast("Venda NÃO concluída: estoque insuficiente.", "error");
    });

    const shipBtn = h("button", { type: "button", class: "btn secondary" }, o.shipping_cents != null ? "Atualizar frete" : "Salvar frete");
    shipBtn.addEventListener("click", run(shipBtn, () => actions.setShipping(o.id, shipIn.value), "Frete salvo."));
    const contactBtn = h("button", { type: "button", class: "btn secondary" }, "Marcar como contatada");
    contactBtn.addEventListener("click", run(contactBtn, () => actions.markContacted(o.id, noteIn.value), "Pedido marcado como contatado."));
    const completeBtn = h("button", { type: "button", class: "btn" }, "Concluir venda");
    completeBtn.addEventListener("click", run(completeBtn, async () => {
      if (!(await confirmDialog({ title: "Concluir venda?", text: "Isto baixa o estoque de todos os itens e não pode ser desfeito. Confirme apenas se o pagamento já foi combinado e recebido.", confirmLabel: "Concluir venda" }))) return { skipped: true };
      return actions.complete(o.id, noteIn.value);
    }, "Venda concluída e estoque baixado."));
    const cancelBtn = h("button", { type: "button", class: "btn danger" }, "Cancelar pedido");
    cancelBtn.addEventListener("click", run(cancelBtn, async () => {
      if (!(await confirmDialog({ title: "Cancelar pedido?", text: "O pedido será marcado como cancelado. O estoque não é alterado.", confirmLabel: "Cancelar pedido", danger: true }))) return { skipped: true };
      return actions.cancel(o.id, noteIn.value);
    }, "Pedido cancelado."));
    const copyBtn = h("button", { type: "button", class: "btn small secondary" }, "Copiar WhatsApp");
    copyBtn.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(waNumber); toast("Número copiado."); } catch { toast("Não foi possível copiar.", "error"); }
    });

    const kv = (k, v) => [h("dt", {}, k), h("dd", {}, v || "—")];
    root.replaceChildren(
      h("p", { class: "crumbs" }, h("a", { href: "#/pedidos" }, "Pedidos"), " / ", o.display_code),
      h("div", { class: "page-head" }, h("h1", {}, o.display_code), pill(o.status)),
      msg,
      h("div", { class: "cols" },
        h("div", {},
          h("section", { class: "panel" }, h("h2", {}, "Cliente"),
            h("dl", {}, kv("Nome", o.customer_name), kv("WhatsApp", phone),
              kv("Endereço", `${o.address_line}, ${o.address_number}${o.address_complement ? ` — ${o.address_complement}` : ""}`),
              kv("Bairro", o.neighborhood), kv("Cidade/UF", `${o.city}/${o.state}`), kv("CEP", o.postal_code), kv("Observação", o.customer_note), kv("Recebido em", fmtDateTime(o.created_at))),
            h("div", { class: "btn-row" }, h("a", { class: "btn small", href: waUrl, target: "_blank", rel: "noopener noreferrer" }, "Abrir WhatsApp"), copyBtn)),
          h("section", { class: "panel" }, h("h2", {}, "Itens"),
            h("ul", { class: "rows" }, items.map((i) => h("li", { class: "line" }, h("div", {}, h("strong", {}, i.product_name), h("div", { class: "muted small" }, `${i.color} · Tam. ${i.size} · ${i.quantity}× ${formatBRL(i.unit_price_cents)}`)), h("span", {}, formatBRL(i.line_total_cents))))),
            h("dl", { class: "totals" }, kv("Subtotal", formatBRL(o.subtotal_cents)), kv("Frete", o.shipping_cents != null ? formatBRL(o.shipping_cents) : "a definir"), kv("Total final", o.final_total_cents != null ? formatBRL(o.final_total_cents) : "a definir"))),
          h("section", { class: "panel" }, h("h2", {}, "Histórico"),
            h("ol", { class: "timeline" }, history.map((x) => h("li", {}, h("strong", {}, STATUS_LABEL[x.to_status] ?? x.to_status), ` — ${fmtDateTime(x.created_at)}`, x.note ? h("div", { class: "muted small" }, x.note) : null))))),
        h("aside", { class: "panel sticky" }, h("h2", {}, "Ações"),
          !act.setShipping && !act.cancel ? h("p", { class: "muted" }, o.status === "completed" ? "Venda concluída: o estoque já foi baixado. Nenhuma ação disponível." : "Pedido cancelado. Nenhuma ação disponível.") : [
            act.setShipping ? h("div", { class: "field" }, h("label", { for: "ship" }, "Frete (R$)"), shipIn,
              h("small", { id: "ship-help" }, "Calculado por você fora do sistema. R$ 0,00 é válido (frete grátis)."), shipBtn) : null,
            h("div", { class: "field" }, h("label", { for: "note" }, "Observação interna"), noteIn),
            h("div", { class: "stack" },
              act.markContacted ? contactBtn : null,
              h("div", {}, completeBtn, !act.complete ? h("small", { class: "muted" }, " Defina o frete para concluir.") : null),
              act.cancel ? cancelBtn : null)])));
    if (!act.complete) completeBtn.disabled = true;
    if (!act.complete) completeBtn.setAttribute("aria-disabled", "true");
  }
  draw();
  return root;
}
