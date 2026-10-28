import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = new URL("../../", import.meta.url).pathname;
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const OFFICIAL = "https://francinefurinistore.com.br/";

const metaTags = (html) => [...html.matchAll(/<(?:meta|link)\b[^>]*>/gi)].map((m) => m[0]);
const attr = (tag, name) => new RegExp(`${name}\\s*=\\s*"([^"]*)"`, "i").exec(tag)?.[1] ?? null;

test("canonical absoluto aponta para o domínio oficial (um único canonical)", () => {
  const links = metaTags(read("storefront/index.html")).filter((t) => attr(t, "rel") === "canonical");
  assert.equal(links.length, 1, "exatamente um canonical");
  assert.equal(attr(links[0], "href"), OFFICIAL);
});

test("og:url é igual ao canonical e é absoluto https (sem hash/rota)", () => {
  const html = read("storefront/index.html");
  const og = metaTags(html).filter((t) => attr(t, "property") === "og:url");
  assert.equal(og.length, 1, "exatamente um og:url");
  const url = attr(og[0], "content");
  assert.equal(url, OFFICIAL);
  assert.ok(!url.includes("#") && !url.includes("pages.dev") && !url.includes("www."));
  const canonical = attr(metaTags(html).find((t) => attr(t, "rel") === "canonical"), "href");
  assert.equal(url, canonical);
});

test("metatags de compartilhamento presentes, com og:image absoluta da marca oficial", () => {
  const html = read("storefront/index.html");
  for (const p of ["og:type", "og:title", "og:description", "og:site_name", "og:locale"]) assert.match(html, new RegExp(`property="${p}"`));
  assert.match(html, /name="description"/);
  assert.match(html, /name="twitter:card" content="summary_large_image"/);
  assert.match(html, /property="og:image" content="https:\/\/francinefurinistore\.com\.br\/assets\/brand\/og-image\.v1\.jpg"/);
  assert.ok(fs.existsSync(path.join(root, "storefront/assets/brand/og-image.v1.jpg")), "arquivo og:image publicado com a loja");
});

test("roteamento por hash preservado: nenhuma <base>, nenhum redirecionamento próprio e rotas '#/'", () => {
  const html = read("storefront/index.html");
  assert.ok(!/<base\b/i.test(html));
  assert.ok(!/http-equiv\s*=\s*"refresh"/i.test(html));
  assert.match(read("storefront/js/app.js"), /location\.hash/);
  assert.ok(!fs.existsSync(path.join(root, "storefront/_redirects")), "redirect do www é da Cloudflare, não do repositório");
});

test("nenhuma referência ao domínio antigo (francinefurini.com.br) nem a domínio próprio para o admin", () => {
  const files = ["README.md", "CLAUDE.md", "docs", "storefront", "admin", "supabase/functions"].flatMap((p) => {
    const abs = path.join(root, p);
    if (!fs.existsSync(abs)) return [];
    const walk = (d) => (fs.statSync(d).isDirectory() ? fs.readdirSync(d).flatMap((f) => walk(path.join(d, f))) : [d]);
    return walk(abs).filter((f) => /\.(md|html|js|ts|json|css)$|_headers$/.test(f) && !f.endsWith("config.js"));
  });
  for (const f of files) {
    const text = fs.readFileSync(f, "utf8");
    const rel = path.relative(root, f);
    assert.ok(!/francinefurini\.com\.br/i.test(text), `${rel}: domínio antigo`);
    assert.ok(!/admin\.francinefurini/i.test(text), `${rel}: domínio próprio do admin`);
    assert.ok(!/admin\.francinefurinistore/i.test(text), `${rel}: o admin permanece em pages.dev`);
  }
});

test("CSP: o domínio próprio é coberto por 'self' — não precisa de host novo nem de curinga", () => {
  for (const f of ["storefront/_headers", "admin/_headers"]) {
    const csp = /Content-Security-Policy:\s*(.+)/.exec(read(f))[1];
    const d = Object.fromEntries(csp.split(";").map((s) => s.trim()).filter(Boolean).map((s) => { const [k, ...v] = s.split(/\s+/); return [k, v]; }));
    assert.ok(d["connect-src"].includes("'self'"), `${f}: connect-src 'self'`);
    assert.ok(!/francinefurinistore|francine-furini/.test(csp), `${f}: nenhum host da loja hardcoded`);
    for (const k of ["default-src", "script-src", "connect-src", "img-src"]) assert.ok(!d[k].includes("*"), `${f}: ${k} sem curinga`);
    // Vitrine: Supabase do projeto + ViaCEP (checkout). Admin: somente Supabase.
    const extra = f.startsWith("storefront") ? ["https://viacep.com.br"] : [];
    assert.ok(d["connect-src"].every((s) => s === "'self'" || extra.includes(s) || /^(https|wss):\/\/[a-z0-9]+\.supabase\.co$/.test(s)), `${f}: conexões só para o Supabase do projeto${extra.length ? " e ViaCEP" : ""}`);
    assert.deepEqual(d["frame-ancestors"], ["'none'"]);
    assert.ok(d["upgrade-insecure-requests"]);
  }
});
