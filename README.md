# Francine Furini Store

Loja virtual da **Francine Furini Store**, desenvolvida pela TaskZap.

## Status

Projeto iniciado em 15/10/2026. A V1 está em implementação.

## Escopo da V1

- Vitrine responsiva e mobile first
- Catálogo por categorias
- Produtos com fotos, descrição e preços
- Variantes por cor e tamanho
- Controle de estoque por variante
- Busca e filtros
- Carrinho persistente
- Coleta dos dados da cliente
- Geração de pedido/solicitação de compra
- Frete calculado manualmente pela Francine
- Pagamento finalizado manualmente com a cliente
- Painel administrativo protegido por autenticação
- Supabase exclusivo para a Francine Furini Store

## Fora da V1

- Integração automática com SuperFrete
- Mercado Pago integrado ao checkout
- Webhook automático de pagamento
- ERP / emissão fiscal
- CRM / fidelidade / carrinho abandonado

Essas funcionalidades poderão ser implementadas posteriormente como evoluções independentes.

## Arquitetura

A solução será construída como projeto independente. O Nosso Closet é usado apenas como referência de padrões já validados pela TaskZap; regras específicas de outros clientes não devem ser copiadas para este projeto.

Princípios:

- Supabase como fonte oficial de catálogo, variantes e estoque
- Credenciais secretas somente no backend
- RLS habilitado nas tabelas expostas
- Frontend nunca é autoridade de preço, estoque ou permissão
- Código modular e preparado para futuras integrações
- Sem dados ou regras de outros tenants/clientes

## Fluxo comercial da V1

1. Cliente acessa a loja
2. Escolhe produto, cor e tamanho
3. Adiciona ao carrinho
4. Informa seus dados
5. Envia a solicitação de compra
6. O pedido fica aguardando fechamento
7. Francine calcula o frete manualmente
8. Francine combina frete e pagamento diretamente com a cliente

## Estrutura prevista

```text
storefront/   # loja pública (ver storefront/README.md)
admin/        # painel administrativo (ver admin/README.md)
supabase/     # migrations e funções backend
tests/        # testes automatizados
docs/         # documentação técnica
```

## Segurança

Nunca versionar chaves privadas, service role, tokens, senhas ou credenciais de integrações. Arquivos `.env` reais devem permanecer fora do Git.
