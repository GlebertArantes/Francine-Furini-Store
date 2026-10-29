// Helpers puros da Venda Rapida; nenhuma baixa ocorre no navegador.
// O banco (admin_register_external_sale) e a fonte da verdade.
export const CHANNELS = [
  { value: "whatsapp", label: "WhatsApp" },
  { value: "instagram", label: "Instagram" },
  { value: "presencial", label: "Presencial" },
  { value: "outro", label: "Outro" },
];
export const channelLabel = (value) => CHANNELS.find((c) => c.value === value)?.label ?? "Outro";

export function saleLines(products = []) {
  return products.flatMap((p) => (p.product_variants ?? [])
    .filter((v) => v.active)
    .map((v) => ({
      id: v.id, productId: p.id, name: p.name, color: v.color, size: v.size,
      stock: v.quantity, price_cents: p.price_cents, published: !!p.active,
    })));
}

export function addSaleItem(cart, line, amount = 1) {
  if (!line || !Number.isInteger(amount) || amount < 1) return { ok: false, code: "invalid" };
  const current = cart.find((x) => x.id === line.id)?.quantity ?? 0;
  if (!Number.isInteger(line.stock) || line.stock < current + amount)
    return { ok: false, code: "insufficient_stock" };
  const next = cart.filter((x) => x.id !== line.id);
  next.push({ ...line, quantity: current + amount });
  return { ok: true, cart: next };
}

export const removeSaleItem = (cart, id) => cart.filter((x) => x.id !== id);
export function changeSaleQty(cart, id, quantity) {
  const line = cart.find((x) => x.id === id);
  if (!line || !Number.isInteger(quantity) || quantity < 1 || quantity > line.stock)
    return { ok: false, code: "insufficient_stock" };
  return { ok: true, cart: cart.map((x) => x.id === id ? { ...x, quantity } : x) };
}
export const saleTotal = (cart) =>
  cart.reduce((n, x) => n + x.price_cents * x.quantity, 0);

export function salePayload(cart) {
  if (!Array.isArray(cart) || cart.length < 1 || cart.length > 30) return null;
  if (!cart.every((x) => /^[0-9a-f-]{36}$/i.test(String(x.id)) &&
      Number.isInteger(x.quantity) && x.quantity >= 1 && x.quantity <= 100 &&
      Number.isInteger(x.stock) && x.quantity <= x.stock)) return null;
  return [...cart].sort((a,b) => a.id.localeCompare(b.id))
    .map((x) => ({ variant_id: x.id, quantity: x.quantity }));
}

export function saleError(err) {
  const msg = String(err?.message ?? "");
  if (/^insufficient_stock/.test(msg)) return "Estoque insuficiente. Confira a quantidade disponivel e tente novamente.";
  if (/^variant_unavailable/.test(msg)) return "Esta cor ou tamanho nao esta mais disponivel. Atualize a lista.";
  if (/^request_conflict/.test(msg)) return "Esta tentativa foi alterada. Confira o historico antes de tentar novamente.";
  if (/^invalid_external_sale/.test(msg)) return "Revise as pecas e quantidades selecionadas.";
  if (err?.code === "session_expired" || msg === "session_expired") return "Sua sessao expirou. Entre novamente.";
  if (err?.code === "network" || msg === "network") return "Falha de conexao. Confira o historico antes de reenviar para evitar baixa duplicada.";
  return "Nao foi possivel registrar agora. Verifique o historico antes de tentar novamente.";
}
