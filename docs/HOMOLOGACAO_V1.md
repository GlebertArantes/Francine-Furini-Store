# Homologação V1 — estado em 18/10/2026

Base: `main` @ `871b725` (PR #18). Evidências abaixo são do **repositório e de testes locais**. O acesso ao projeto Supabase `txgatyftvtpkgqlncxju` e ao domínio de produção **não esteve disponível** nesta sessão (ver Bloqueios); nada foi lido nem gravado em produção.

## Bloqueios (AGUARDANDO GL)
| Item | Motivo | O que é necessário |
|---|---|---|
| Consultar/publicar `create-order` (versão 4) | O conector Supabase da sessão enxerga só dois outros projetos (Nosso Closet, Donna Store) e recusa o `txgatyftvtpkgqlncxju`; egress HTTPS para `*.supabase.co` do projeto é bloqueado | Conectar o projeto da Francine ao Supabase MCP **ou** rodar o deploy pelo terminal do GL (comandos abaixo) |
| Auditoria de Auth (política de senha, senhas vazadas, MFA, rate limit, e-mail) | Configuração só no painel/Management API | GL abre Authentication → Settings e envia capturas, ou conecta o projeto |
| Matriz no banco real e acesso `Fran1010` | Sem acesso ao banco/Auth; criação de usuário exige autorização e dados do GL | Ver Frente 4 |

## Frente 1 — `create-order`
**Versão proposta (repo)** = código de `main`. Diferenças desde a primeira versão (`a254b52`), em `handler.ts` e `index.ts` (validate.ts inalterado):
1. `parseAllowedOrigins`: aceita só `https://host[:porta]` exato; rejeita `*`, curingas, barra final e `http://` (exceto localhost listado). Avisos em log. (PR #12)
2. Limite de corpo por **bytes** + recusa antecipada por `Content-Length` (413). (PR #13)
3. Falha de rede do banco → JSON 503; resposta sem `order_id`/`display_code` → 502; erro desconhecido → 500 sem detalhes, sempre com CORS. (PR #13)
4. Não mudam: preço do banco (RPC `create_order_request`), validação de itens/quantidades (≤ 20), mensagens `insufficient_stock`/`variant_unavailable`/`rate_limited`, rate limit por IP (10/min, por isolate) + por telefone na RPC, `verify_jwt=false` (intencional: navegador anônimo; a barreira é CORS + validação + RPC só `service_role`).

**Auditoria do código (read-only):** service role só via `Deno.env` (nunca no Git/front; varredura em `tests/security/guards.test.js`); RPC com `revoke ... from public, anon, authenticated` e `grant` só `service_role`; resposta mínima (sem PII). Observações (baixo risco, sem ação obrigatória): (a) sem cabeçalho de IP todos caem no bucket `unknown` — aceitável atrás do Supabase/Cloudflare; (b) corpo sem `Content-Length` (chunked) é lido inteiro antes da checagem de bytes — limitado pela plataforma; a barreira real é o limite por bytes pós-leitura.

**Testes:** `npm test` 157/157 (+7 da matriz) e `npm run test:sql` sem falhas (≈126 asserts PASS), incluindo payload inválido/oversized, origem não autorizada, falha controlada, estoque insuficiente e pedido válido (mocks; `fetch` real bloqueado).

**Variáveis (apenas nomes):** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (injetadas pelo Supabase) e `ALLOWED_ORIGINS` (= `https://francinefurinistore.com.br,https://francine-furini-store.pages.dev`). Presença **não verificada** (sem acesso).

**Procedimento de deploy (somente após OK do GL):**
```bash
git checkout main && git pull           # @ 871b725
npm test                                 # deve estar 100% verde
supabase functions deploy create-order --no-verify-jwt --project-ref txgatyftvtpkgqlncxju
supabase functions list --project-ref txgatyftvtpkgqlncxju   # conferir versão 5
```
**Smoke controlado (sem pagamento/venda):** (1) preflight `OPTIONS` com `Origin` oficial → 204 com ACAO; com `Origin: https://evil.example` → sem ACAO; (2) `POST` com origem não autorizada → 403; (3) `POST` com corpo > 16 KB → 413; (4) 1 pedido `TESTE` pela vitrine oficial com o Vestido Aurora — TESTE → `201` + código `FF-…`; conferir que o estoque da variante **não** mudou. Registrar o código gerado.
**Rollback:** `supabase functions deploy` do commit/versão anterior (v4 = código de `a254b52`: `git checkout a254b52 -- supabase/functions/create-order`). Sem mudança de banco/secrets, o rollback é só reimplantar. Risco principal: `ALLOWED_ORIGINS` ausente/errado bloqueia o checkout (o parser agora avisa em log); mitigação = o smoke (1).

## Frente 2 — Auth (verificação por código; painel pendente)
| # | Item | Situação (evidência) | Risco | Ação |
|---|---|---|---|---|
| 1–3 | Política de senha, senhas vazadas, MFA | **Não verificado** (painel) — S15 da `AUDITORIA_V1.md` | Recomendação | GL confere/ativa: senha ≥ 10 + leaked-password protection (depende de plano Pro); **não** impor MFA sem aprovação |
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

## Frente 4 — `Fran1010`
- Login `Fran1010` → `fran1010@admin.francine-furini.local` (minúsculas; 3–40 chars `[a-z0-9._-]`). O e-mail é **interno e inexistente** (sem recuperação por e-mail).
- Provisionamento oficial: criar usuário no Auth (Dashboard → Authentication → Add user, *auto-confirm*) com o e-mail interno acima e depois `insert into private.admin_users(user_id) values ('<uuid>')`. Revogação: `delete from private.admin_users where user_id = '<uuid>'` (e remover do Auth).
- Registros afetados na criação: 1 linha em `auth.users`, 1 em `private.admin_users`. Nada mais.
- **Preciso do GL:** confirmar o login `Fran1010`; método seguro de definir a senha (GL digita no painel — nunca por chat/GitHub); confirmar que pode criar agora; confirmar que a ausência de recuperação por e-mail é aceitável (ou fornecer um e-mail real que a Francine controle).
