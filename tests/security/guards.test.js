import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { resolveLoginIdentifier } from "../../admin/js/views/login.js";

const root = new URL("../../", import.meta.url).pathname;
const tracked = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
const isText = (f) => /\.(md|html|js|mjs|ts|json|css|sql|yml|yaml|sh|example)$|_headers$|\.gitignore$/.test(f);
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const PROJECT_REF = "txgatyftvtpkgqlncxju";

test("o teste Node não consegue fazer fetch real (nenhum pedido/escrita acidental em produção)", async () => {
  await assert.rejects(() => fetch(`https://${PROJECT_REF}.supabase.co/functions/v1/create-order`, { method: "POST" }), /REDE BLOQUEADA/);
  await assert.rejects(() => fetch("https://francinefurinistore.com.br/"), /REDE BLOQUEADA/);
});

test("nenhum teste aponta para o projeto de produção nem usa rede real", () => {
  for (const f of tracked.filter((x) => x.startsWith("tests/") && isText(x) && !x.startsWith("tests/security/"))) {
    const text = read(f);
    assert.ok(!text.includes(PROJECT_REF), `${f}: referência ao projeto de produção`);
    assert.ok(!/\bfetch\(\s*["'`]https?:/.test(text), `${f}: fetch direto para URL real`);
  }
});

test("nenhum segredo versionado: service_role, sb_secret, JWT, senha ou token", () => {
  const patterns = [
    [/sb_secret_[A-Za-z0-9_-]{8,}/, "chave sb_secret_"],
    [/eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{5,}/, "JWT"],
    [/SERVICE_ROLE_KEY\s*[:=]\s*["']?[A-Za-z0-9._-]{20,}/, "valor de SUPABASE_SERVICE_ROLE_KEY"],
    [/(password|senha)\s*[:=]\s*["'][^"'\s]{4,}["']/i, "senha literal"],
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "chave privada"],
    [/(ghp|gho|ghs|github_pat)_[A-Za-z0-9_]{20,}/, "token do GitHub"],
    [/sk-[A-Za-z0-9]{32,}/, "chave de API"],
  ];
  for (const f of tracked.filter(isText)) {
    if (f.startsWith("tests/security/")) continue; // este próprio arquivo contém os padrões
    const text = read(f);
    for (const [re, label] of patterns) {
      // fixtures de teste explícitas (jwt() falso montado em runtime) não casam por serem geradas; literais reais casariam.
      assert.ok(!re.test(text), `${f}: possível ${label}`);
    }
  }
});

test("arquivos de ambiente reais não são versionados", () => {
  assert.ok(!tracked.some((f) => /(^|\/)\.env($|\.)/.test(f) && !f.endsWith(".env.example")), ".env versionado");
  assert.ok(!tracked.some((f) => /^(storefront|admin)\/config\.js$/.test(f)), "config.js gerado não deve ser versionado");
  const ignore = read(".gitignore");
  assert.match(ignore, /storefront\/config\.js/);
  assert.match(ignore, /admin\/config\.js/);
  assert.match(ignore, /^\.env$/m);
});

test("código do storefront/admin/função não referencia outros clientes/lojas da TaskZap nem outro projeto Supabase", () => {
  const code = tracked.filter((f) => /^(storefront|admin|supabase|scripts)\//.test(f) && isText(f));
  const forbidden = /nosso\s*closet|nossocloset|donna\s*store|donnastore|eb\s*fit|ebfit|infinitepay|telegram|thaty/i;
  for (const f of code) {
    const text = read(f);
    assert.ok(!forbidden.test(text), `${f}: referência a outro cliente/integração`);
    for (const m of text.matchAll(/https:\/\/([a-z0-9]{20})\.supabase\.co/g)) assert.equal(m[1], PROJECT_REF, `${f}: outro projeto Supabase (${m[1]})`);
  }
});

test("headers: HSTS e proteções presentes em loja e admin; admin fora de indexação", () => {
  for (const f of ["storefront/_headers", "admin/_headers"]) {
    const h = read(f);
    assert.match(h, /Strict-Transport-Security:\s*max-age=\d{7,}/, `${f}: HSTS`);
    for (const k of ["X-Content-Type-Options: nosniff", "X-Frame-Options: DENY", "Referrer-Policy:", "Permissions-Policy:", "Content-Security-Policy:"]) assert.ok(h.includes(k), `${f}: ${k}`);
    assert.ok(!/includeSubDomains|preload/i.test(h), `${f}: HSTS sem includeSubDomains/preload (pages.dev e subdomínios de terceiros)`);
  }
  assert.match(read("admin/index.html"), /name="robots" content="noindex, nofollow"/);
});

test("login por usuário: logins simples (incluindo o temporário de teste) e e-mail técnico legado seguem aceitos", () => {
  assert.equal(resolveLoginIdentifier("Sarytta10"), "sarytta10@admin.francine-furini.local");
  assert.equal(resolveLoginIdentifier("Fran1010"), "fran1010@admin.francine-furini.local");
  assert.equal(resolveLoginIdentifier("gleberteads@hotmail.com"), "gleberteads@hotmail.com");
  assert.equal(resolveLoginIdentifier("<script>"), "");
});

test("WhatsApp: loja não tem número fixo no código — vem de store_settings (teste preservado, oficial só na entrega)", () => {
  for (const f of tracked.filter((x) => /^(storefront|admin)\/.*\.(js|html)$/.test(x))) {
    assert.ok(!/5534984258056|5531995652798/.test(read(f)), `${f}: número de WhatsApp hardcoded`);
  }
});

test("domínio oficial e pages.dev previstos; admin segue em pages.dev", () => {
  const readme = read("README.md") + read("docs/DOMINIO_E_CORS.md");
  assert.match(readme, /francinefurinistore\.com\.br/);
  assert.match(readme, /francine-furini-store\.pages\.dev/);
  assert.match(readme, /francine-furini-admin\.pages\.dev/);
  assert.match(read("docs/DOMINIO_E_CORS.md"), /ALLOWED_ORIGINS/);
});
