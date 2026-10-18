import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const root = new URL("../../", import.meta.url).pathname;
const read = (f) => fs.readFileSync(`${root}${f}`, "utf8");
const manual = read("docs/MANUAL_FRANCINE.md");
const adminSrc = execFileSync("git", ["ls-files", "admin/js"], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean).map(read).join("\n");

test("manual da Francine: 15 capítulos numerados, na ordem pedida", () => {
  const chapters = [...manual.matchAll(/^## (\d+)\. (.+)$/gm)].map((m) => [Number(m[1]), m[2]]);
  assert.deepEqual(chapters.map((c) => c[0]), Array.from({ length: 15 }, (_, i) => i + 1));
  const titles = chapters.map((c) => c[1].toLowerCase());
  for (const [i, kw] of ["entrar", "categorias", "cadastrar um produto", "fotos", "cores e tamanhos", "estoque", "preços", "desativar", "pedidos", "frete", "contato", "concluir uma venda", "estoque é reduzido", "cancelar", "senha"].entries()) {
    assert.ok(titles[i].includes(kw), `capítulo ${i + 1} deveria tratar de "${kw}" (${titles[i]})`);
  }
});

test("manual para pessoa leiga: sem secrets, e-mails técnicos, nem termos internos", () => {
  const forbidden = /service[_ ]?role|secret|supabase|token|jwt|rls|edge function|migration|api key|\.local\b|@admin|localStorage|sb_|publishable|CORS|postgres/i;
  const m = manual.match(forbidden);
  assert.equal(m, null, `termo técnico no manual: ${m?.[0]}`);
  assert.ok(!/[\w.-]+@[\w.-]+\.\w+/.test(manual), "e-mail no manual");
  assert.ok(!/senha\s*[:=]/i.test(manual) && !/Sarytta|Fran1010/.test(manual), "usuários/senhas fora do manual");
});

test("manual cita só botões e avisos que existem de fato no painel (evita manual desatualizado)", () => {
  const labels = ["Escolher fotos da galeria", "Criar produto", "Salvar alterações", "Enviar fotos", "Remover da seleção", "Remover foto", "Concluir venda", "Salvar frete", "Atualizar frete",
    "Marcar como contatada", "Cancelar pedido", "Abrir WhatsApp", "Copiar WhatsApp", "Publicar na loja agora?", "Oculto da loja (rascunho)", "Quantidade em estoque", "Mais opções",
    "Adicionar", "Todos os status", "Observação interna", "Frete (R$)", "Preço anterior (R$)", "Ativo (visível na loja)", "Destaque na home", "Estoque baixo", "Esgotada", "Aguardando frete", "Cliente contatada", "Concluído", "Cancelado", "Entrar", "Sair"];
  for (const l of labels) {
    assert.ok(manual.includes(l), `manual não menciona “${l}”`);
    assert.ok(adminSrc.includes(l.replace(/\?$/, "").replace(/ \(rascunho\)$/, "")), `painel não tem “${l}”`);
  }
  assert.match(manual, /Total final/);
  assert.match(adminSrc, /Total final/);
});

test("manual reflete as regras comerciais: sem pagamento no site, só concluir baixa estoque, cancelar não baixa, concluída não cancela", () => {
  assert.match(manual, /Ela \*\*não paga no site\*\*/);
  assert.match(manual, /Você \*\*conclui a venda\*\*[\s\S]*\*\*Sim — uma única vez\*\*/);
  assert.match(manual, /Você \*\*cancela\*\* o pedido \| \*\*Não\*\*/);
  assert.match(manual, /Venda já concluída não pode ser cancelada/);
  assert.match(manual, /produto nasce escondido/);
  assert.match(manual, /R\$ 0,00|\*0,00\*/);
});
