import { test } from "node:test";
import assert from "node:assert/strict";
import { saleLines, addSaleItem, changeSaleQty, removeSaleItem, salePayload, saleTotal, saleError, channelLabel } from "../../admin/js/lib/quick-sale.js";
import { readFileSync } from "node:fs";

const variantA = "10000000-0000-0000-0000-000000000001";
const variantB = "10000000-0000-0000-0000-000000000002";
const source = [
  { id: "p", name: "Conjunto", active: true, price_cents: 23990,
    product_variants: [
      { id: variantA, color: "Off", size: "M", active: true, quantity: 2 },
      { id: variantB, color: "Preto", size: "G", active: true, quantity: 1 },
      { id: "off", color: "Azul", size: "P", active: false, quantity: 5 },
    ] },
];
const lines = saleLines(source);

test("venda rapida lista somente variantes ativas com cor, tamanho e estoque", () => {
  assert.equal(lines.length, 2);
  assert.deepEqual(lines.map((l) => [l.color, l.size, l.stock]), [["Off","M",2],["Preto","G",1]]);
});
test("Vendi 1 adiciona uma unidade; outra adiciona a mesma variante sem duplicar linha", () => {
  const a = addSaleItem([], lines[0]); assert.equal(a.ok, true);
  const b = addSaleItem(a.cart, lines[0]); assert.deepEqual(b.cart.map(x => x.quantity), [2]);
  assert.equal(addSaleItem(b.cart, lines[0]).code, "insufficient_stock");
  assert.equal(saleTotal(b.cart), 47980);
});
test("minicarrinho permite mais de uma variante e rejeita estoque insuficiente", () => {
  const a=addSaleItem([],lines[0]), b=addSaleItem(a.cart,lines[1]);
  assert.equal(b.cart.length, 2);
  assert.equal(changeSaleQty(b.cart, variantB, 2).ok, false);
  assert.equal(changeSaleQty(b.cart, variantA, 2).ok, true);
  assert.equal(removeSaleItem(b.cart, variantA).length, 1);
});
test("payload envia somente variant_id e quantity, sem preco manipulavel", () => {
  const a=addSaleItem(addSaleItem([],lines[1]).cart, lines[0]);
  assert.deepEqual(salePayload(a.cart), [
    {variant_id:variantA,quantity:1},{variant_id:variantB,quantity:1},
  ]);
  assert.equal(JSON.stringify(salePayload(a.cart)).includes("price_cents"), false);
  assert.equal(salePayload([]), null);
  assert.equal(salePayload([{...lines[0],quantity:5}]), null);
  assert.equal(salePayload([{...lines[0],quantity:0}]), null);
});
test("falhas devolvem mensagens controladas, sem detalhes internos", () => {
  for(const msg of ["insufficient_stock: Conjunto","variant_unavailable","request_conflict","invalid_external_sale","network","unknown"]) {
    assert.ok(saleError({message:msg}).length>10);
    assert.equal(/supabase|sql|stack|postgres/i.test(saleError({message:msg})),false);
  }
  assert.equal(channelLabel("instagram"), "Instagram");
});
test("UI so solicita RPC apos confirmacao; tem acoes de busca, historico e retry estavel", () => {
  const view = readFileSync(new URL("../../admin/js/views/quick-sale.js", import.meta.url), "utf8");
  const api = readFileSync(new URL("../../admin/js/lib/api.js", import.meta.url), "utf8");
  assert.match(view, /confirmDialog/);
  assert.match(view, /ctx\.api\.registerExternalSale\(request, channel\.value, items\)/);
  assert.match(view, /requestKey !== key/);
  assert.match(view, /Vendi 1/);
  assert.match(view, /listExternalSales/);
  assert.match(api, /admin_register_external_sale/);
  assert.ok(!/updateVariant\(|\.quantity\s*[-+]=/.test(view), "baixa nao pode ocorrer no frontend");
});
