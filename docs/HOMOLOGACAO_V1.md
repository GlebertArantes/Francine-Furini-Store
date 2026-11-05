# Homologação V1 — estado em 18/10/2026

Base: `main` @ `871b725` (PR #18). **Origem das evidências — leia antes:**
- *Repositório e testes locais*: verificado pelo Claude nesta documentação.
- *Estado ao vivo do Supabase* (v5 ativa, RLS, grants, advisors, bucket): conferido pelo **Jarvis** com acesso ao projeto correto e **repassado pelo GL**; o Claude **não** reverificou. O "acesso negado" registrado na primeira versão deste documento ocorreu **apenas na sessão original do Claude** (o conector dela só enxergava outros projetos); não é uma restrição do projeto da Francine.
- Testes sintéticos (Node/SQL em Postgres temporário) **não substituem** teste em celular e navegador reais.

## Estado ao vivo informado (Jarvis)
| Item | Situação |
|---|---|
| `create-order` | **Versão 5, ACTIVE**, publicada com autorização do GL (antes: v4). `verify_jwt=false` intencional (checkout público). `index.ts`/`handler.ts`/`validate.ts` conferem com a `main`. Correções S9 (PR #13) implantadas. **Smoke HTTP pós-deploy: PENDENTE** (nenhum resultado registrado ainda). |
| Rollback | Versão anterior (v4) = código do commit `a254b52` (`git checkout a254b52 -- supabase/functions/create-order` e reimplantar). |
| RLS | Oito tabelas de aplicação em `public` com RLS; pedidos/itens/histórico: leitura admin; catálogo: escrita admin e leitura pública filtrada. `private.admin_users` e `private.order_code_counters` sem RLS, mas **sem privilégios** para `anon`/`authenticated` (schema privado não exposto). |
| Funções | `create_order_request`: EXECUTE só `service_role`. `public.is_admin()` consulta `private.admin_users` por `auth.uid()`; RPCs admin validam com `private.assert_admin()`. |
| Storage | Bucket `product-images` público para leitura; INSERT/UPDATE/DELETE só admin; JPEG/PNG/WebP/AVIF, 8 MB. |
| Advisors | 5 avisos `SECURITY DEFINER` executáveis por `authenticated`: **conhecidos e intencionais** (validação admin interna; não alterar permissões só para zerar o linter). **1 aviso real: `auth_leaked_password_protection` DESATIVADO.** MFA e demais configurações de Auth: **não verificados**. |

## Bloqueios que persistem na sessão do Claude (AGUARDANDO GL / Cowork)
| Item | Motivo | O que é necessário |
|---|---|---|
| Smoke HTTP da v5 | Egress da sessão do Claude para `*.supabase.co` do projeto é bloqueado (reconfirmado) | Rodar `node scripts/smoke-create-order.mjs <URL da função>` no Cowork/terminal do GL e enviar a saída |
| Auditoria de Auth no painel | Só painel/Management API | GL envia capturas de Authentication (senha, leaked protection, MFA, rate limits, signup, e-mail) |
| Testes mobile/admin com sessão | Exigem celular e login | Ver `docs/TESTE_MOBILE_ADMIN.md` |
| Conta `Fran1010` | Exige autorização, dados e senha definida pelo GL | Ver Frente 4 |

## Frente 1 — `create-order`
**Versão publicada (v5)** = código de `main` (ver tabela acima). Diferenças desde a primeira versão (`a254b52`), em `handler.ts` e `index.ts` (validate.ts inalterado):
1. `parseAllowedOrigins`: aceita só `https://host[:porta]` exato; rejeita `*`, curingas, barra final e `http://` (exceto localhost listado). Avisos em log. (PR #12)
2. Limite de corpo por **bytes** + recusa antecipada por `Content-Length` (413). (PR #13)
3. Falha de rede do banco → JSON 503; resposta sem `order_id`/`display_code` → 502; erro desconhecido → 500 sem detalhes, sempre com CORS. (PR #13)
4. Não mudam: preço do banco (RPC `create_order_request`), validação de itens/quantidades (≤ 20), mensagens `insufficient_stock`/`variant_unavailable`/`rate_limited`, rate limit por IP (10/min, por isolate) + por telefone na RPC, `verify_jwt=false` (intencional: navegador anônimo; as barreiras são validação + limites + RPC só `service_role`; CORS apenas orienta navegadores).

**Auditoria do código (read-only):** service role só via `Deno.env` (nunca no Git/front; varredura em `tests/security/guards.test.js`); RPC com `revoke ... from public, anon, authenticated` e `grant` só `service_role`; resposta mínima (sem PII). Observações (baixo risco, sem ação obrigatória): (a) sem cabeçalho de IP todos caem no bucket `unknown` — aceitável atrás do Supabase/Cloudflare; (b) corpo sem `Content-Length` (chunked) é lido inteiro antes da checagem de bytes — limitado pela plataforma; a barreira real é o limite por bytes pós-leitura.

**Testes:** `npm test` 157/157 (+7 da matriz) e `npm run test:sql` sem falhas (≈126 asserts PASS), incluindo payload inválido/oversized, origem não autorizada, falha controlada, estoque insuficiente e pedido válido (mocks; `fetch` real bloqueado).

**Variáveis (apenas nomes):** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (injetadas pelo Supabase) e `ALLOWED_ORIGINS` (= `https://francinefurinistore.com.br,https://francine-furini-store.pages.dev`). Presença de `ALLOWED_ORIGINS` na v5 **ainda não confirmada** pelo smoke.

**Smoke pós-deploy (não destrutivo, nenhum pedido é criado):** `scripts/smoke-create-order.mjs` cobre: OPTIONS com origem oficial e `pages.dev` (CORS), OPTIONS com origem estranha (sem `Access-Control-Allow-Origin`), POST de origem não autorizada (403), payload inválido/malformado (400), corpo > 16 KB (413), GET (405) e checagem de que as respostas são JSON sem vazamento (stack, chaves, SQL). O script foi validado localmente contra o `handler.ts` real (8/8), mas **ainda não rodou contra a v5 em produção**. Um pedido válido só deve ser criado com autorização pontual do GL (Vestido Aurora — TESTE, sem concluir venda; conferir que o estoque não muda).

> **CORS não é autenticação.** Ele só instrui o *navegador*; clientes que não são navegadores (curl, scripts) podem omitir `Origin` e a função os aceita. As barreiras reais contra abuso são: validação estrita, limite de corpo, rate limit por IP (por instância, best-effort) e por telefone na RPC, preços/estoque no servidor, e a RPC acessível só por `service_role`. O risco médio de spam distribuído (S1, Turnstile) **continua aberto** e depende de aprovação do GL.

**Rollback:** reimplantar o código de `a254b52` (v4). Sem mudança de banco/secrets, o rollback é só reimplantar. Não executado.

## Frente 2 — Auth (código + estado informado; painel pendente)
| # | Item | Situação (evidência) | Risco | Ação |
|---|---|---|---|---|
| 1–3 | Política de senha, senhas vazadas, MFA | Senhas vazadas: **desativada** (aviso do advisor, informado pelo Jarvis). Política de senha e MFA: **não verificados** | Risco baixo/médio (recomendação) | Confirmar se o plano permite e ativar (aprovação do GL); **não** impor MFA nem mudar política sem aprovação |
| 4 | Limite de tentativas | Padrão do Supabase Auth; não verificado | Recomendação | Conferir *Rate limits* |
| 5 | Confirmação de e-mail/recuperação | Login usa e-mail **interno** `usuario@admin.francine-furini.local` (`admin/js/views/login.js`) → **recuperação por e-mail não funciona** para contas de login simples | Médio (operacional) | Reset de senha só pelo GL/painel; documentar |
| 6 | Permissões admin | `private.admin_users` + `public.is_admin()` (`SECURITY DEFINER`, `search_path=''`), policies `is_admin()` em todas as tabelas; schema `private` sem acesso de anon/authenticated (`0001`) | OK | — |
| 7 | Rotas privadas | Painel exige sessão + `is_admin`; testes `tests/admin/*` | OK | — |
| 8 | Cadastro público de admin | Admin só por inserção em `private.admin_users` (sem endpoint); **signup público do Auth precisa estar desligado** — não verificado | A confirmar | GL: Authentication → Providers → desativar *Allow new users to sign up* |
| 9 | RPC admin para não-admin | Testes SQL (RLS/grants) cobrem anon e authenticated sem vínculo | OK | — |
| 10 | Acessos técnico/temporário | Não verificável sem Auth | — | Manter; não revogar `Sarytta10` |

## Frente 3 — matriz (automática, sintética)
`tests/storefront/matrix-homologacao.test.js` (7 testes, **aprovados**): A simples, B variantes/combinação sem estoque, C promoção (preço do pedido = atual; item enviado só `variant_id`+`quantity`), D galeria (contador/ordem/alt), E esgotado e variante desativada, busca/filtros, carrinho (alterar/remover/reconciliar). Já cobertos por testes existentes: checkout válido/inválido, duplo envio, mensagem WhatsApp, ciclo do pedido (frete, status, cancelamento sem baixa, conclusão baixa 1×) em `tests/sql` e `tests/admin`.
**Não testado (exige banco real/celular):** envio de fotos pelo celular, publicação com confirmação no admin real, pedido real no domínio oficial. Nenhum registro `TESTE` novo foi criado.
**Bugs encontrados:** nenhum.

## Frente 4 — acesso `Fran1010` (plano; conta **não criada**)
Fatos (código): o formulário (`admin/js/views/login.js`) converte um login sem `@` em `<login minúsculo>@admin.francine-furini.local` (3–40 chars `[a-z0-9._-]`) e aceita qualquer e-mail digitado. O painel **não tem tela de "esqueci a senha"** (nenhum fluxo de recuperação no código).

| | A — `Fran1010` (e-mail interno) | B — e-mail real da Francine |
|---|---|---|
| Como entra | Digita `Fran1010` + senha | Digita o e-mail + senha |
| Recuperação por e-mail | **Não** (e-mail inexistente) — reset manual pela TaskZap no painel | Só funcionaria se houver tela/rota de redefinição **e** URL de redirecionamento configurada; **hoje não existe** no painel |
| Mudanças necessárias | Nenhuma | Nenhuma para entrar; recuperação exigiria desenvolvimento + configuração de Auth (fora da V1) |
| Risco | Senha esquecida = chamado à TaskZap | Parece ter recuperação, mas não funciona (falsa sensação) |

**Recomendação:** A para a V1 (já funciona, sem desenvolvimento, sem expor e-mail pessoal), com senha forte definida pelo GL e **procedimento de reset manual documentado**. Migrar para B só junto com uma tela de recuperação testada. As duas formas coexistem no formulário, mas são **contas distintas** — não se assume equivalência.
Provisionamento (somente após autorização): Dashboard → Authentication → Add user (`fran1010@admin.francine-furini.local`, auto-confirm, senha definida pelo GL) → `insert into private.admin_users(user_id) values ('<uuid>')`. Afeta 1 linha em `auth.users` e 1 em `private.admin_users`. Revogação: `delete from private.admin_users where user_id='<uuid>'` + remover do Auth. Contas do GL e `Sarytta10` **não** são tocadas.
**Preciso do GL:** confirmar A (ou B), que a conta pode ser criada agora e a senha (digitada por ele no painel, nunca por chat/GitHub).
