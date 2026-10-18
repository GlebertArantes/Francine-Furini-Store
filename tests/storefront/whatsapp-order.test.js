import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { whatsappOrderMessage, whatsappUrl, validateCustomer } from "../../storefront/js/lib/checkout.js";
import { successView } from "../../storefront/js/views/success.js";
import { installFakeDom, findAll, textOf } from "../helpers/fake-dom.js";

before(() => installFakeDom());
const code = "FF-181026-123";
const customer = validateCustomer({
  name: " Maria  Silva ", phone: "(34) 99999-1234", postal_code: "38000-000",
  address_line: "Rua das Flores", address_number: "15", address_complement: "Apto 2",
  neighborhood: "Centro", city: "Uberaba", state: "MG", note: "Portaria  B",
}).value;
const items = [
  { quantity: 2, ref: { name: "Vestido Aurora", color: "Nude", size: "M", price_cents: 18990 } },
  { quantity: 1, ref: { name: "Blusa", color: "Preto", size: "G", price_cents: 9990 } },
];

test("WhatsApp V1 inclui pedido, contato, peças e endereço completo após registro", () => {
  const msg = whatsappOrderMessage(code, customer, items);
  for (const fragment of [code, "Maria Silva", "(34) 99999-1234", "Vestido Aurora", "Blusa",
    "2×", "Nude", "Tamanho: M", "Preto", "Tamanho: G", "Rua das Flores", "15",
    "Apto 2", "Centro", "Uberaba/MG", "38000-000", "Portaria B",
    "frete", "Pagamento", "referência"]) assert.ok(msg.includes(fragment), fragment);
  assert.match(msg, /479,70/); // 2 x 189,90 + 99,90 = 479,70
  assert.ok(!/undefined|\bnull\b|NaN/.test(msg));
  assert.doesNotMatch(msg, /pagamento confirmado|pago com sucesso/i);
  const url = whatsappUrl("5534984258056", code, msg);
  assert.equal(new URL(url).searchParams.get("text"), msg);
  assert.equal(new URL(url).pathname, "/5534984258056"); // número vem das configurações, sem hardcode na função
});

test("WhatsApp: endereço e observação opcionais não geram campos vazios", () => {
  const c = { ...customer, address_complement: "", note: "" };
  const msg = whatsappOrderMessage(code, c, items.slice(0, 1));
  assert.ok(!msg.includes("Apto 2") && !msg.includes("*Observações:*"));
  assert.match(msg, /379,80/);
  assert.equal(whatsappOrderMessage(code, c, []), null);
  assert.equal(whatsappUrl("", code, msg), null);
});

test("página de sucesso fornece CTA com mensagem completa somente na sessão corrente", () => {
  const msg = whatsappOrderMessage(code, customer, items);
  const ctx = { order: { display_code: code, whatsapp_message: msg }, settings: { whatsapp_number: "5534984258056" } };
  const page = successView(ctx);
  const links = findAll(page, (x) => x.tag === "a" && x.getAttribute("href")?.startsWith("https://wa.me/"));
  assert.equal(links.length, 1);
  assert.match(textOf(links[0]), /Enviar pedido pelo WhatsApp/);
  assert.equal(new URL(links[0].getAttribute("href")).searchParams.get("text"), msg);
  assert.match(textOf(page), /Nenhum valor foi cobrado/);
  assert.doesNotMatch(textOf(page), /confirmado automaticamente/i);
});

test("após reload, link leva só código, sem persistir dados pessoais no browser", () => {
  const page = successView({ order: { display_code: code }, settings: { whatsapp_number: "5534984258056" } });
  const link = findAll(page, (x) => x.tag === "a" && x.getAttribute("href")?.startsWith("https://wa.me/"))[0];
  const query = new URL(link.getAttribute("href")).searchParams.get("text");
  assert.match(query, /FF-181026-123/);
  assert.ok(!/Maria|Rua das Flores|38000-000|99999-1234/.test(query));
  assert.match(textOf(link), /Enviar código pelo WhatsApp/);
  const app = readFileSync(new URL("../../storefront/js/app.js", import.meta.url), "utf8");
  assert.match(app, /sessionStorage\.setItem\(ORDER_KEY, ctx\.order\.display_code\)/);
  assert.ok(!/sessionStorage\.setItem\([^\n]*whatsapp_message/.test(app));
});

test("formulário mantém gravação do pedido ANTES do envio WhatsApp", () => {
  const checkout = readFileSync(new URL("../../storefront/js/views/checkout.js", import.meta.url), "utf8");
  assert.match(checkout, /const result = await place\(raw\)/);
  assert.match(checkout, /if \(result\.ok\) \{\s*ctx\.setOrder/);
  assert.match(checkout, /whatsappOrderMessage\(result\.order\.display_code, v\.value, itemsForWhatsApp\)/);
  assert.doesNotMatch(checkout, /window\.open\(/);
});
