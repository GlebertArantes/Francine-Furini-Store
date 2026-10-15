# Auditoria 0001 e ciclo de pedidos (Issue #1)

Nada foi aplicado em Supabase. Migrations novas: `0002_order_lifecycle.sql` e `0003_create_order_request.sql`.

## Achados em `0001_initial_schema.sql`

| # | Severidade | Achado | Correção |
|---|---|---|---|
| 1 | **Alta** | `grant update on orders to authenticated` + policy `orders_admin_update`: admin podia fazer `UPDATE status='completed'` sem baixar estoque, sem histórico e sem `completed_at`. | UPDATE revogado e policy removida; mudanças só via RPCs. Trigger `guard_order_lifecycle` bloqueia mudança de status/totais/timestamps fora das RPCs (vale até para owner/service_role). |
| 2 | Média | `order_items` / `order_status_history` sem proteção contra UPDATE; `display_code` nullable e sem formato; sem `line_total = qty*price`; sem consistência de status×timestamps; total final sem relação com subtotal+frete. | Triggers append-only, `display_code NOT NULL` + CHECK de formato, CHECKs de consistência, telefone só dígitos (10–11). |
| 3 | Média | Grants amplos herdados do Supabase (TRUNCATE/REFERENCES/TRIGGER) em tabelas do catálogo/pedidos. | `revoke all` + regrant mínimo (anon: SELECT do catálogo; authenticated: SELECT/escrita só do catálogo; pedidos: SELECT). |
| 4 | Baixa | Faltavam índices em `order_items(variant_id)` e `orders(customer_phone, created_at)`. | Criados. |
| 5 | Info | `is_admin()` OK: `SECURITY DEFINER`, `search_path=''`, lê `private.admin_users`, não usa `user_metadata`. Schema `private` sem acesso de anon/authenticated. | Mantido; novas funções seguem o mesmo padrão. |
| 6 | Info (risco aceito) | Leitura pública de `product_variants` expõe a quantidade exata em estoque. Admin pode editar `quantity` direto (ajuste manual legítimo). | Documentado; trocar por view de disponibilidade se a Francine não quiser expor números. |

## Decisões

- **create-order = Edge Function + RPC.** A função faz CORS, limite de corpo, rate limit por IP, validação/normalização; a RPC `create_order_request` (só `service_role`) repete validações, lê preço/nome/cor/tamanho do banco, soma variantes repetidas, confere estoque **sem reservar**, grava order+items+histórico numa transação e retorna só `{order_id, display_code, status}`. Limite por telefone no banco (5/h).
- **Código `FF-DDMMYY-###`:** contador por dia (fuso America/Sao_Paulo) com `INSERT … ON CONFLICT DO UPDATE`; o lock de linha serializa criações concorrentes e o rollback desfaz o incremento.
- **RPCs admin** (`admin_mark_order_contacted`, `admin_cancel_order`, `admin_complete_order`, `admin_set_order_shipping`): `SECURITY DEFINER`, `search_path=''`, checam `auth.uid()` + `is_admin()`, travam o pedido (`FOR UPDATE`), idempotentes.
- **Conclusão:** trava variantes em ordem de id (evita deadlock), valida todos os itens, aborta com `insufficient_stock` (detalhe JSON dos itens), baixa, marca `completed`, `completed_at`, histórico. Retry retorna `already_done` sem nova baixa. `completed` não pode ser cancelado (estorno de estoque fora da V1).

## Testes

`npm run test:all` — `npm test` (Node, validação + handler) e `npm run test:sql` (Postgres 16 descartável com stubs de roles/auth; inclui concorrência real com sessões paralelas).

## Pendências / riscos

- Rate limit da Edge Function é em memória por isolate (best effort); antes de produção avaliar Cloudflare Turnstile/WAF.
- Testes rodam com stubs de `auth`/roles, não no Supabase real: rodar Security Advisors e um smoke test após aplicar.
- Deploy da função exige `--no-verify-jwt` e secrets `ALLOWED_ORIGINS` (SUPABASE_URL/SERVICE_ROLE vêm do ambiente da função).
- Sem proteção contra pedidos repetidos de telefones diferentes (spam distribuído).
- Estoque do mesmo item pode ser pedido por várias clientes (por desenho da V1).
