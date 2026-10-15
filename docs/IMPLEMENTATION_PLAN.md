# Plano de Implementação — Francine Furini Store V1

Este plano deve ser executado em etapas pequenas, testáveis e auditáveis.

## Fase 0 — Base e segurança

Status: quase concluída.

- [x] README com escopo oficial
- [x] CLAUDE.md com regras do projeto
- [x] arquitetura documentada
- [x] `.gitignore`
- [x] `.env.example` sem secrets
- [x] migration inicial de catálogo/pedidos/RLS
- [x] revisar migration inicial antes de aplicar em produção (ver docs/AUDIT_ORDER_LIFECYCLE.md)
- [x] criar Supabase exclusivo da Francine
- [x] aplicar migrations em ambiente novo
- [x] rodar Supabase Security Advisors
- [x] criar bucket `product-images` e policies de Storage
- [ ] cadastrar primeiro usuário administrador

## Fase 1 — Backend mínimo de pedidos

Objetivo: permitir criação segura de solicitação e conclusão transacional da venda.

### 1.1 Código comercial

Implementar geração atômica de código:

`FF-DDMMYY-###`

Requisitos:

- nunca gerar no navegador
- único mesmo com duas requisições simultâneas
- UUID técnico continua sendo a chave real

### 1.2 `create-order`

Implementar Edge Function pública para criação de solicitação.

A função deve:

- aceitar apenas IDs de variante + quantidade e dados mínimos da cliente
- rejeitar carrinho vazio ou exageradamente grande
- normalizar telefone, CEP e UF
- consultar variantes/produtos reais no banco
- exigir produto e variante ativos
- conferir estoque atual, sem reservar
- ignorar completamente preço/nome enviado pelo navegador
- calcular subtotal no servidor
- criar `orders` + `order_items` atomicamente
- registrar primeiro `order_status_history`
- retornar somente `{ order_id, display_code, status }`
- não expor PII desnecessária na resposta
- ter proteção contra abuso/rate limit antes de produção

### 1.3 Ciclo administrativo de pedido

Não permitir que o painel simplesmente faça `UPDATE status='completed'`.

Criar operações seguras:

- marcar como `contacted`
- cancelar pedido
- concluir venda

`complete_order` deve, em uma única transação:

1. confirmar que pedido ainda pode ser concluído;
2. bloquear/ler variantes envolvidas;
3. validar estoque de TODOS os itens;
4. se qualquer item faltar, abortar tudo;
5. baixar estoque;
6. atualizar pedido para `completed`;
7. registrar histórico;
8. ser idempotente contra clique/retry acidental.

## Fase 2 — Storefront

Objetivo: loja pública pronta para navegação e solicitação de compra.

### Estrutura

- `storefront/index.html`
- `storefront/css/`
- `storefront/js/`
- `storefront/assets/`

### Home

- header com marca
- busca
- carrinho
- hero editorial
- categorias
- novidades/destaques
- bloco institucional curto
- Instagram / WhatsApp
- rodapé

### Catálogo

- categorias dinâmicas
- busca textual
- filtro por tamanho
- filtro por cor
- filtro de disponibilidade
- card com foto, nome e preço
- preço promocional quando houver `compare_at_price_cents`
- indicação de esgotado
- mobile first

### Produto

- galeria de imagens
- nome
- descrição
- tecido quando informado
- preço
- preço anterior/promocional
- seleção de cor
- seleção de tamanho
- disponibilidade por variante
- quantidade limitada ao estoque
- adicionar ao carrinho

### Carrinho

- persistência local
- produto/cor/tamanho/quantidade
- atualização de quantidade
- remoção
- subtotal
- não confiar no subtotal para criação real do pedido

### Finalização V1

Campos:

- nome
- WhatsApp
- CEP
- endereço
- número
- complemento opcional
- bairro
- cidade
- UF
- observação opcional

Após sucesso:

- mostrar código do pedido
- explicar que a Francine calculará o frete e entrará em contato
- opção de abrir WhatsApp com mensagem simples contendo o código do pedido

Nunca incluir token administrativo ou informações internas nessa mensagem.

## Fase 3 — Painel administrativo

Objetivo: Francine manter a loja sem alterar código.

### Login

- Supabase Auth
- rota/tela protegida
- sessão validada
- RLS continua sendo autoridade mesmo que o frontend seja manipulado

### Dashboard

Resumo simples:

- pedidos aguardando contato
- pedidos contatados
- vendas concluídas
- produtos ativos
- variantes com estoque baixo/esgotado

### Produtos

- criar/editar produto
- categoria
- nome
- descrição
- tecido
- preço
- preço promocional/anterior
- destaque
- ativo/inativo
- publicação

### Variantes

- cor
- tamanho livre
- quantidade
- ativo/inativo

### Imagens

- upload Supabase Storage
- múltiplas fotos
- ordenar
- remover
- alt text

### Pedidos

- visualizar dados e itens
- copiar WhatsApp
- marcar contato
- informar frete manualmente, se for útil à operação
- concluir venda usando operação transacional
- cancelar
- histórico

## Fase 4 — Qualidade e publicação

- testes unitários das regras críticas
- testes do fluxo completo
- teste mobile
- validação de estoque concorrente
- tentativa de alterar preço pelo navegador
- tentativa de escrita anon em catálogo
- tentativa de acesso admin sem permissão
- Security Advisors sem alertas críticos
- SEO básico
- Open Graph
- favicon
- política de privacidade / termos essenciais
- configurar Cloudflare Pages
- domínio
- smoke test de produção

## Fora desta entrega

Não implementar sem novo escopo aprovado:

- SuperFrete automático
- Mercado Pago integrado
- webhook de pagamento
- reserva temporária de estoque
- cupom complexo
- ERP
- emissão de NF
- CRM/fidelidade
- carrinho abandonado

## Ordem recomendada para Claude

1. Leia `CLAUDE.md`, `README.md` e `docs/ARCHITECTURE.md`.
2. Audite `0001_initial_schema.sql`; não aplique em Supabase ainda.
3. Corrija/complete o ciclo seguro de pedidos em migrations adicionais.
4. Crie testes para as regras de pedido/estoque.
5. Só depois faça o bootstrap do storefront.
6. Depois faça o admin.
7. Aplique banco/credenciais/deploy somente quando o ambiente estiver disponível e autorizado.

## Regra de entrega por tarefa

Ao concluir cada tarefa, informar:

- arquivos alterados
- decisões tomadas
- testes executados e resultado
- riscos/pendências
- commit SHA

Não misturar muitas funcionalidades não relacionadas no mesmo commit.
