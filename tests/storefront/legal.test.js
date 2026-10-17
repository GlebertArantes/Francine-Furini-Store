import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { installFakeDom, textOf, findAll } from "../helpers/fake-dom.js";

before(() => installFakeDom());

const ctx = {
  settings: {
    whatsapp_number: "5534984258056",
    instagram_url: "https://instagram.com/francinefurini_store",
  },
};

test("Política de Privacidade identifica a loja, explica dados e usa contatos dinâmicos", async () => {
  const { legalView } = await import("../../storefront/js/views/legal.js");
  const root = legalView(ctx, "privacidade");
  const text = textOf(root);
  assert.match(text, /Política de Privacidade/);
  assert.match(text, /31\.185\.840\/0001-08/);
  assert.match(text, /nome, número de WhatsApp, CEP, endereço/i);
  assert.match(text, /armazenamento local do navegador/i);
  const hrefs = findAll(root, (e) => e.tag === "a").map((e) => e.getAttribute("href"));
  assert.ok(hrefs.includes("https://wa.me/5534984258056"));
  assert.ok(hrefs.includes("https://instagram.com/francinefurini_store"));
});

test("Termos refletem o fluxo manual da V1 e ausência de reserva de estoque", async () => {
  const { legalView } = await import("../../storefront/js/views/legal.js");
  const root = legalView(ctx, "termos");
  const text = textOf(root);
  assert.match(text, /Termos de Uso e Compra/);
  assert.match(text, /não reserva estoque/i);
  assert.match(text, /não processa pagamento dentro do site/i);
  assert.match(text, /frete é calculado manualmente/i);
  assert.match(text, /direitos previstos na legislação aplicável ao consumidor/i);
});

test("index possui SEO social básico, favicon e stylesheet legal", () => {
  const html = fs.readFileSync(new URL("../../storefront/index.html", import.meta.url), "utf8");
  assert.match(html, /property="og:title"/);
  assert.match(html, /property="og:description"/);
  assert.match(html, /name="twitter:card"/);
  assert.match(html, /rel="icon"/);
  assert.match(html, /css\/legal\.css/);
});
