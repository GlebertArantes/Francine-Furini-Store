// Regressão: ao fechar a inauguração sem foco prévio útil, o foco vai para o conteúdo principal (não se perde no <body>).
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { installFakeDom, Element } from "../helpers/fake-dom.js";
import { showInauguration } from "../../admin/js/views/inauguration.js";

let focused = null;
before(() => {
  installFakeDom();
  Object.assign(Element.prototype, { showModal() {}, close() {}, remove() {}, focus() { focused = this; }, classList: { add() {}, contains: () => false }, isConnected: true });
  const body = new Element("body"); const main = new Element("main"); main.id = "main";
  globalThis.document.body = body; globalThis.document.activeElement = body;
  globalThis.document.getElementById = (id) => (id === "main" ? main : null);
  globalThis.window = { matchMedia: () => ({ matches: false }) };
});

test("fechar a inauguração devolve o foco ao #main quando o foco anterior era o body", () => {
  const close = showInauguration();
  focused = null;
  close();
  assert.equal(focused?.id, "main");
});

test("com foco anterior útil, ele é restaurado", () => {
  const btn = new Element("button"); globalThis.document.activeElement = btn;
  const close = showInauguration(); focused = null; close();
  assert.equal(focused, btn);
});
