import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeDom, textOf, findAll } from "../helpers/fake-dom.js";
import { photoPicker } from "../../admin/js/views/products.js";

test("seletor mostra carregamento, prévia pronta, envio e X com motivo da falha", async () => {
  installFakeDom();
  const oldCreate = URL.createObjectURL, oldRevoke = URL.revokeObjectURL;
  URL.createObjectURL = () => "blob:photo-status";
  URL.revokeObjectURL = () => {};
  const picker = photoPicker();
  try {
    const input = findAll(picker.el, e => e.tag === "input" && e.type === "file")[0];
    input.files = [{ name: "vestido.jpg", size: 100, type: "image/jpeg" }];
    const changed = input.listeners.find(([type]) => type === "change")[1];
    await changed();
    assert.match(textOf(picker.el), /Carregando prévia/);
    const preview = findAll(picker.el, e => e.tag === "img")[0];
    preview.listeners.find(([type]) => type === "load")[1]();
    assert.match(textOf(picker.el), /Pronta para enviar/);
    picker.setUploadState({ key: picker.queue.items[0].key, state: "sending" });
    assert.match(textOf(picker.el), /Enviando foto/);
    picker.setUploadState({ key: picker.queue.items[0].key, state: "error", reason: "sem conexão" });
    assert.match(textOf(picker.el), /✕.*Falhou: sem conexão/);
    assert.equal(picker.queue.items.length, 1);
  } finally {
    picker.reset(); URL.createObjectURL = oldCreate; URL.revokeObjectURL = oldRevoke;
  }
});
