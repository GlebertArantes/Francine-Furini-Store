# Plano de Implementação — Francine Furini Store V1

Status em 17/10/2026: **pré-entrega**.

O núcleo funcional já foi implementado e validado em produção. Este documento agora funciona como registro de conclusão + checklist do que ainda depende de pré-entrega e aceite da cliente.

## Fase 0 — Base e segurança

Status: **concluída**.

- [x] README com escopo oficial
- [x] CLAUDE.md com regras do projeto
- [x] arquitetura documentada
- [x] `.gitignore`
- [x] `.env.example` sem secrets
- [x] migration inicial de catálogo/pedidos/RLS
- [x] revisão do ciclo seguro de pedidos
- [x] Supabase exclusivo da Francine
- [x] migrations aplicadas em produção
- [x] primeiro usuário administrador criado
- [x] bucket `product-images` e policies de Storage
- [x] Security Advisors revisados

Observação: os avisos de funções `SECURITY DEFINER` administrativas são intencionais; as RPCs verificam `is_admin()` internamente e a suíte SQL cobre usuário autenticado não-admin.

## Fase 1 — Backend mínimo de pedidos

Status: **concluída e validada**.

- [x] código comercial atômico `FF-DDMMYY-###`
- [x] Edge Function `create-order`
- [x] preço e nome calculados/conferidos no servidor
- [x] produto/variante inativos rejeitados
- [x] estoque conferido sem reserva na criação
- [x] `pending_shipping`
- [x] frete manual via operação administrativa
- [x] `contacted`
- [x] cancelamento via RPC administrativa
- [x] `completed` transacional
- [x] baixa de estoque somente na conclusão
- [x] idempotência de conclusão
- [x] histórico de status
- [x] testes de concorrência
- [x] bloqueio de escrita anônima e de usuário não-admin

## Fase 2 — Storefront

Status: **concluída; acabamento final em pré-entrega**.

- [x] home responsiva
- [x] busca e filtros
- [x] categorias dinâmicas
- [x] cards com preço normal/promocional e esgotado
- [x] detalhe do produto
- [x] galeria
- [x] seleção cor/tamanho
- [x] quantidade limitada ao estoque
- [x] carrinho persistente
- [x] checkout com dados de entrega
- [x] tela de pedido recebido
- [x] WhatsApp dinâmico por `store_settings`
- [x] produto inativo oculto da home e da URL direta
- [x] correção estrutural para não renderizar `null`/`undefined`
- [x] Política de Privacidade
- [x] Termos de Uso e Compra
- [x] aviso de privacidade no checkout
- [x] SEO/social básico e favicon

## Fase 3 — Painel administrativo

Status: **concluída e validada**.

- [x] Supabase Auth
- [x] sessão protegida
- [x] dashboard
- [x] categorias
- [x] criar/editar produto
- [x] preço e preço promocional
- [x] ativo/inativo e destaque
- [x] variantes por cor/tamanho/quantidade
- [x] múltiplas imagens
- [x] seleção de fotos já na criação do produto
- [x] alt text e ordenação
- [x] pedidos
- [x] frete manual
- [x] marcar contato
- [x] concluir venda
- [x] cancelar pedido
- [x] histórico

## Fase 4 — Qualidade e publicação

### Já concluído

- [x] testes unitários das regras críticas
- [x] testes SQL do ciclo de pedido/estoque/RLS
- [x] teste de concorrência
- [x] fluxo completo em produção
- [x] tentativa de alterar preço/nome pelo navegador coberta por teste
- [x] tentativa de escrita anônima em catálogo/pedidos coberta por teste
- [x] tentativa de acesso administrativo por não-admin coberta por teste
- [x] smoke de produto ativo/inativo
- [x] smoke do WhatsApp dinâmico
- [x] Supabase `ACTIVE_HEALTHY`
- [x] Cloudflare Pages para storefront e admin

### Pré-entrega sem dependência da Francine

- [ ] auditoria mobile/responsiva em produção (360, 390, 768 e desktop)
- [ ] teste manual de cancelamento em produção
- [ ] smoke de admin sem sessão + exposição de PII
- [ ] validar páginas de Privacidade/Termos após deploy
- [ ] validar metatags/favicon após deploy
- [ ] AVIF manual em navegador real (não bloqueador se inconclusivo)

### Dependências do aceite da Francine

- [ ] Francine cadastrar/testar ao menos um produto real pelo painel
- [ ] validar edição, fotos, variantes e estoque com dados reais
- [ ] criar/entregar usuário administrador da Francine
- [ ] trocar WhatsApp temporário de testes `5534984258056` pelo oficial `5531995652798` (somente na entrega; preservado até lá)
- [ ] confirmar CEP/origem da loja
- [ ] confirmar Instagram oficial
- [x] domínio próprio da loja: `francinefurinistore.com.br` (Cloudflare Pages; `www` → 301 para o principal; `pages.dev` preservado; admin sem domínio próprio, em `francine-furini-admin.pages.dev`)
- [x] canonical e `og:url` do storefront apontam para o domínio oficial
- [ ] `ALLOWED_ORIGINS` da Edge Function `create-order` com o domínio oficial + `pages.dev` (ver `docs/DOMINIO_E_CORS.md`)
- [ ] validação controlada de pedido pelo domínio oficial (frete e pagamento continuam manuais)
- [ ] logo/imagem social (`og:image`) após a marca oficial coletada no Instagram
- [ ] smoke final após dados reais

O checklist operacional rastreável também está no GitHub Issue #9.

## Fora desta entrega

Não implementar sem novo escopo aprovado:

- SuperFrete automático
- Mercado Pago integrado ao checkout
- webhook de pagamento
- reserva temporária de estoque
- cupom complexo
- ERP / emissão de NF
- CRM / fidelidade
- carrinho abandonado

## Regra de entrega por tarefa

Ao concluir qualquer evolução futura, registrar:

- arquivos alterados;
- decisões tomadas;
- testes executados e resultado;
- riscos/pendências;
- commit SHA.
