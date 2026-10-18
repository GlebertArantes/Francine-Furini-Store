import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { installFakeDom, findAll } from "../helpers/fake-dom.js";
import { icon } from "../../storefront/js/lib/icons.js";

before(() => installFakeDom());
const read = (f) => readFileSync(new URL(`../../${f}`, import.meta.url), "utf8");

test("ícones: SVG inline, decorativos (aria-hidden), sem dependências externas", () => {
  for (const n of ["instagram", "whatsapp"]) {
    const el = icon(n);
    assert.equal(el.tag, "svg");
    assert.equal(el.getAttribute("aria-hidden"), "true");
    assert.ok(findAll(el, (e) => e.tag !== "svg").length >= 2);
  }
  const src = read("storefront/js/lib/icons.js");
  assert.ok(!/https?:\/\/(?!www\.w3\.org)/.test(src), "sem CDN");
});

test("rodapé: links vêm de store_settings (sem hardcode), com ícone + texto, rel seguro", () => {
  const app = read("storefront/js/app.js");
  assert.match(app, /icon\("instagram"\), "Instagram"/);
  assert.match(app, /icon\("whatsapp"\), "WhatsApp"/);
  assert.match(app, /s\.whatsapp_number/);
  assert.ok(!/wa\.me\/\d{10,}/.test(app), "número de WhatsApp não pode ser fixo no código");
  for (const t of ["Como comprar", "Privacidade", "Termos"]) assert.ok(app.includes(`"${t}"`), t);
  assert.match(app, /rel: "noopener noreferrer"/);
});
