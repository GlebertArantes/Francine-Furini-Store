import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const root = new URL("../../backups/catalogo/", import.meta.url);
const dirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();

test("há cópias datadas do catálogo público e todas passam na verificação de integridade", () => {
  assert.ok(dirs.length >= 2, "cópias históricas preservadas + a nova");
  for (const d of dirs) {
    const out = execFileSync("python3", ["scripts/archive-public-catalog.py", "--verify", "--dir", `backups/catalogo/${d}`], { cwd: new URL("../../", import.meta.url), encoding: "utf8" });
    assert.match(out, /fotos originais/);
  }
});

test("cópias públicas não contêm pedidos nem dados pessoais", () => {
  for (const d of dirs) {
    for (const f of ["catalogo.json", "manifest.json"]) {
      const txt = fs.readFileSync(new URL(`${d}/${f}`, root), "utf8");
      assert.ok(!/customer_|"phone"|address_|postal_code|display_code|order_items|service_role|sb_secret_|eyJ[A-Za-z0-9_-]{20,}/.test(txt), `${d}/${f}`);
    }
  }
});
