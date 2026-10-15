# CLAUDE.md — Francine Furini Store

## Projeto

Este repositório é EXCLUSIVO da Francine Furini Store. Não misture dados, regras, nomes, credenciais ou comportamentos de Nosso Closet, Donna Store, EB Fit ou qualquer outro cliente TaskZap.

## Objetivo da V1

Construir uma loja virtual mobile first com:

- catálogo e categorias
- produtos com múltiplas fotos
- variantes por cor e tamanho
- estoque por variante
- busca e filtros
- carrinho persistente
- criação de pedido/solicitação de compra
- painel administrativo protegido
- Supabase exclusivo

## Fluxo comercial V1

O frete e o pagamento são MANUAIS.

Fluxo:

cliente monta carrinho -> informa dados -> cria pedido -> pedido fica aguardando fechamento -> Francine calcula o frete fora do sistema -> Francine conclui pagamento diretamente com a cliente.

NÃO implementar na V1:

- SuperFrete
- Mercado Pago API
- webhook de pagamento
- InfinitePay
- Telegram
- taxa fixa de entrega de outro cliente
- campanhas/cupom/aniversário de outro projeto

## Regras técnicas obrigatórias

1. Não copiar o `_worker.js` inteiro do Nosso Closet.
2. Reutilizar apenas padrões conceituais já validados: produto/variante, carrinho, validação server-side, responsividade e testes.
3. Supabase é a fonte oficial de produtos, categorias, variantes, imagens, estoque e pedidos.
4. O frontend nunca é autoridade para preço, estoque, status ou permissão.
5. Todo banco exposto deve usar RLS com políticas explícitas.
6. Nunca colocar service role, tokens ou secrets no frontend ou no Git.
7. Admin exige autenticação.
8. Alterações de estoque/pedido administrativas precisam ser autorizadas no backend/RLS.
9. Código deve permanecer modular para permitir Mercado Pago e SuperFrete no futuro sem reescrever a loja.
10. Antes de mudanças grandes, inspecionar o estado atual e preservar o que já funciona.

## Identidade visual

Referência aprovada:

- elegante, feminina, minimalista
- off-white / creme / areia / nude / marrom / chocolate
- fotos como protagonistas
- bastante espaço visual
- evitar aparência de marketplace ou template genérico

A marca trabalha com moda feminina, peças sofisticadas e atendimento próximo.

## Produtos

O sistema deve aceitar tamanhos livres, incluindo:

- P / M / G / GG
- 34 / 36 / 38 / 40 / 42 / 44
- Tamanho único

Modelo principal:

produto -> variantes (cor + tamanho + quantidade)

## Pedidos V1

Status mínimos sugeridos:

- pending_shipping — aguardando cálculo/fechamento de frete
- contacted — cliente contatada
- completed — venda concluída manualmente
- cancelled — cancelado

Não dar baixa automática de estoque por simples criação do pedido sem uma regra explícita aprovada. Evitar oversell e definir a estratégia de estoque antes de automatizar qualquer baixa.

## Forma de trabalho

- Faça mudanças pequenas e auditáveis.
- Inclua testes para regras de negócio.
- Não invente integrações ou comportamentos de APIs.
- Não use credenciais reais em exemplos.
- Documente decisões arquiteturais importantes.
