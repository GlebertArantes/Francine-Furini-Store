// Carrinho: funções puras sobre o estado + store com persistência em localStorage.
// O carrinho é SOMENTE conveniência visual. Preço/estoque/subtotal aqui nunca são
// autoridade: o pedido enviado ao servidor leva apenas variant_id + quantity.

export const CART_KEY = "francine-furini-store:cart:v1";
export const MAX_QTY_PER_VARIANT = 20; // mesmo limite da Edge Function / RPC

export const emptyCart = () => ({ items: [] });

const limitFor = (stock) => Math.max(0, Math.min(Number(stock) || 0, MAX_QTY_PER_VARIANT));

/**
 * Adiciona uma variante. `line` = { variant_id, product_id, stock, ref:{ name, slug, color, size, price_cents, image } }.
 * A chave lógica é a VARIANTE: mesmo produto com outra cor/tamanho vira outra linha.
 * Retorna { state, added, limited } — `limited` indica que bateu no estoque/limite.
 */
export function addItem(state, line, qty = 1) {
  const want = Math.floor(Number(qty));
  const max = limitFor(line.stock);
  if (!line.variant_id || !(want >= 1) || max < 1) return { state, added: 0, limited: max < 1 };
  const existing = state.items.find((i) => i.variant_id === line.variant_id);
  const current = existing ? existing.quantity : 0;
  const next = Math.min(current + want, max);
  const added = next - current;
  const item = { ...line, stock: Number(line.stock), quantity: next };
  const items = existing
    ? state.items.map((i) => (i.variant_id === line.variant_id ? item : i))
    : [...state.items, item];
  return { state: { items }, added, limited: current + want > max };
}

/** Define a quantidade (0 ou menos remove). Nunca passa do estoque conhecido nem de 20. */
export function setQuantity(state, variantId, qty) {
  const q = Math.floor(Number(qty));
  if (!(q >= 1)) return removeItem(state, variantId);
  return {
    items: state.items.map((i) =>
      i.variant_id === variantId ? { ...i, quantity: Math.min(q, limitFor(i.stock)) } : i
    ),
  };
}

export const removeItem = (state, variantId) => ({
  items: state.items.filter((i) => i.variant_id !== variantId),
});

export const totalQuantity = (state) => state.items.reduce((n, i) => n + i.quantity, 0);

/** Subtotal VISUAL (preço de referência do navegador). Não é enviado ao servidor. */
export const subtotalCents = (state) =>
  state.items.reduce((sum, i) => sum + i.quantity * (i.ref?.price_cents || 0), 0);

/** Itens do pedido: apenas variant_id + quantity. Sem preço, nome ou total. */
export const toOrderItems = (state) =>
  state.items.map((i) => ({ variant_id: i.variant_id, quantity: i.quantity }));

/**
 * Reconcilia o carrinho com o catálogo atual (Supabase). `known` = Map variant_id -> {
 * product_id, stock, ref }. Remove indisponíveis, reduz quantidades acima do estoque e
 * atualiza dados de referência. Retorna { state, changes } com mensagens para a cliente.
 */
export function reconcile(state, known) {
  const changes = [];
  const items = [];
  for (const item of state.items) {
    const label = `${item.ref?.name ?? "Produto"} (${item.ref?.color ?? ""} · ${item.ref?.size ?? ""})`;
    const fresh = known.get(item.variant_id);
    if (!fresh || !(fresh.stock >= 1)) {
      changes.push({ type: fresh ? "soldout" : "unavailable", variant_id: item.variant_id, label });
      continue;
    }
    const max = limitFor(fresh.stock);
    const quantity = Math.min(item.quantity, max);
    if (quantity < item.quantity) {
      changes.push({ type: "reduced", variant_id: item.variant_id, label, from: item.quantity, to: quantity });
    }
    items.push({ variant_id: item.variant_id, product_id: fresh.product_id, stock: fresh.stock, ref: fresh.ref, quantity });
  }
  return { state: { items }, changes };
}

export function describeChange(c) {
  if (c.type === "reduced") return `${c.label}: quantidade ajustada de ${c.from} para ${c.to} (estoque atual).`;
  if (c.type === "soldout") return `${c.label} esgotou e foi removido do carrinho.`;
  return `${c.label} não está mais disponível e foi removido do carrinho.`;
}

// --- persistência ----------------------------------------------------------

/** Valida o JSON salvo: ignora lixo/estado corrompido em vez de quebrar a loja. */
export function parseStored(raw) {
  try {
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.items)) return emptyCart();
    const seen = new Set();
    const items = [];
    for (const i of data.items) {
      if (!i || typeof i.variant_id !== "string" || seen.has(i.variant_id)) continue;
      const stock = Number(i.stock);
      const quantity = Math.floor(Number(i.quantity));
      if (!(quantity >= 1) || !(stock >= 1)) continue;
      seen.add(i.variant_id);
      items.push({
        variant_id: i.variant_id,
        product_id: String(i.product_id ?? ""),
        stock,
        quantity: Math.min(quantity, limitFor(stock)),
        ref: {
          name: String(i.ref?.name ?? ""), slug: String(i.ref?.slug ?? ""), color: String(i.ref?.color ?? ""),
          size: String(i.ref?.size ?? ""), price_cents: Number(i.ref?.price_cents) || 0, image: i.ref?.image ? String(i.ref.image) : null,
        },
      });
    }
    return { items };
  } catch {
    return emptyCart();
  }
}

export function createCartStore(storage, key = CART_KEY) {
  const listeners = new Set();
  let state = emptyCart();
  try {
    const raw = storage?.getItem(key);
    if (raw) state = parseStored(raw);
  } catch { /* storage indisponível: segue em memória */ }

  const persist = () => {
    try { storage?.setItem(key, JSON.stringify(state)); } catch { /* ignora */ }
  };
  const set = (next) => {
    state = next;
    persist();
    listeners.forEach((fn) => fn(state));
  };
  return {
    get: () => state,
    set,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    add(line, qty) { const r = addItem(state, line, qty); set(r.state); return r; },
    setQuantity: (id, q) => set(setQuantity(state, id, q)),
    remove: (id) => set(removeItem(state, id)),
    clear: () => set(emptyCart()),
    reconcile(known) { const r = reconcile(state, known); set(r.state); return r.changes; },
  };
}
