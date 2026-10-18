import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (f) => readFileSync(new URL("../../" + f, import.meta.url), "utf8");

test("Pages: HTML, JavaScript e CSS sem versao nao ficam 4h no cache do navegador", () => {
  for (const project of ["storefront", "admin"]) {
    const rules = read(project + "/_headers");
    for (const route of ["/", "/index.html", "/*.js", "/*.css"]) {
      const section = rules.split(/\n(?=\/(?:\*\.js|\*\.css|index\.html)?\s*\n)/).find((s) => s.startsWith(route + "\n"));
      assert.ok(section, project + ": falta regra " + route);
      assert.match(section, /^  Cache-Control: no-cache, max-age=0, must-revalidate$/m, project + ": regra de revalidacao " + route);
      assert.doesNotMatch(section, /immutable|max-age=14400/i, project + ": sem cache longo " + route);
    }
    for (const header of ["Strict-Transport-Security", "Content-Security-Policy", "X-Frame-Options", "X-Content-Type-Options"]) {
      assert.match(rules, new RegExp("^  " + header + ":", "m"), project + ": header de seguranca preservado");
    }
    assert.ok(!/no-store/i.test(rules), "revalidacao permite 304 e evita desabilitar o cache por completo");
  }
});

test("Cache da vitrine: imports ES relativos usam URLs sem fingerprint; a politica deve revalidar os modulos", () => {
  const html = read("storefront/index.html");
  const js = read("storefront/js/app.js");
  assert.match(html, /type="module" src="\.\/js\/app\.js"/);
  assert.match(js, /from "\.\/views\/home\.js"/);
  assert.match(read("storefront/_headers"), /\/\*\.js\n  Cache-Control: no-cache, max-age=0, must-revalidate/);
});
