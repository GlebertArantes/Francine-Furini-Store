# Arquitetura — Francine Furini Store V1

## 1. Objetivo

A V1 é uma loja virtual com catálogo e estoque online, mas com fechamento comercial manual.

O site termina na criação de uma **solicitação de compra**. Frete e pagamento são tratados pela Francine fora do checkout automático.

## 2. Componentes

### Storefront público

Responsável por:

- home e identidade da marca
- catálogo e categorias
- busca/filtros
- detalhe do produto
- seleção de cor/tamanho
- carrinho persistente
- formulário da cliente
- envio da solicitação de compra

O storefront pode ler somente os dados públicos necessários do Supabase.

### Painel administrativo

Responsável por:

- autenticação
- categorias
- produtos
- imagens
- preços
- variantes
- estoque
- ativar/desativar produto
- consultar solicitações/pedidos
- alterar status
- concluir ou cancelar uma venda

### Supabase exclusivo

Responsável por:

- Postgres
- Auth do painel
- Storage das fotos
- RLS
- funções/RPC transacionais quando necessário
- Edge Functions para operações públicas sensíveis

## 3. Fonte de verdade

O Supabase é a fonte oficial de:

- categorias
- produtos
- preços
- imagens
- variantes
- estoque
- pedidos
- itens dos pedidos
- configurações operacionais

Não manter catálogo operacional duplicado em JSON estático.

## 4. Modelo de catálogo

```text
categories
    ↓
products
    ↓
product_variants
    ↓
quantity

products
    ↓
product_images
```

`product_variants.size` é texto livre para aceitar P/M/G/GG, 34/36/38/40/42/44, Tamanho único e futuras grades.

A combinação produto + cor + tamanho deve ser única.

## 5. Fluxo de pedido V1

```text
Cliente
  ↓
Carrinho
  ↓
Dados de contato/endereço
  ↓
Edge Function create-order
  ↓
Valida produto/variante/preço no banco
  ↓
Cria order + order_items
  ↓
status = pending_shipping
  ↓
Francine recebe/consulta no painel
  ↓
Calcula frete manualmente
  ↓
Contato e pagamento manual
  ↓
Francine marca venda como completed
  ↓
Baixa transacional do estoque
```

## 6. Estratégia de estoque V1

### Regra

**Criar uma solicitação NÃO reserva e NÃO reduz o estoque.**

Motivo: como frete e pagamento são manuais, um pedido pode ser abandonado por tempo indefinido. Reservar estoque na criação poderia bloquear peças sem uma venda real.

Quando a Francine marcar a venda como concluída:

1. backend/RPC lê novamente as variantes;
2. confirma que há quantidade suficiente;
3. reduz o estoque de todos os itens dentro da mesma transação;
4. altera o pedido para `completed`;
5. registra o histórico.

Se faltar estoque, a conclusão deve falhar por inteiro e informar quais itens precisam de conferência.

### Consequência conhecida

Duas clientes podem solicitar a mesma última peça antes do fechamento. A primeira venda efetivamente concluída consome o estoque; a outra precisa ser tratada manualmente. Isso é coerente com o modelo comercial manual da V1.

Uma reserva com expiração poderá ser adicionada futuramente se a operação exigir.

## 7. Status de pedido

Estados iniciais:

- `pending_shipping` — solicitação recebida, aguardando cálculo/contato
- `contacted` — Francine já iniciou o atendimento
- `completed` — venda concluída manualmente e estoque baixado
- `cancelled` — solicitação cancelada

Toda mudança relevante deve gerar registro em `order_status_history`.

## 8. Segurança

### Catálogo público

O público pode consultar somente:

- categorias ativas
- produtos ativos
- imagens de produtos ativos
- variantes necessárias para disponibilidade

O público não recebe acesso de escrita nessas tabelas.

### Pedidos

`orders` e `order_items` não devem aceitar INSERT direto do navegador anônimo.

A criação pública passa por `create-order`, que:

- limita campos aceitos
- normaliza dados
- busca produtos e variantes reais no banco
- ignora preço enviado pelo navegador
- recalcula subtotal no servidor
- valida quantidade pedida
- grava pedido e itens
- devolve somente identificador/código necessário ao cliente

### Administração

Operações administrativas exigem Supabase Auth e autorização explícita via RLS/backend.

Nunca usar `user_metadata` como fonte de autorização.

Secrets/service role nunca vão para o frontend ou Git.

### Storage

Fotos de produtos podem ser publicamente visualizadas, mas upload/update/delete somente por administrador autenticado e autorizado.

## 9. Código comercial do pedido

Usar um código amigável separado do UUID técnico.

Formato sugerido:

```text
FF-151026-001
```

O código deve ser gerado no backend/banco, nunca pelo navegador, com garantia de unicidade/concorrência.

## 10. Dados da cliente

Dados mínimos sugeridos na solicitação:

- nome
- WhatsApp/telefone
- CEP
- endereço
- número
- complemento opcional
- bairro
- cidade
- UF
- observação opcional

Evitar coletar dados que não tenham utilidade operacional na V1.

## 11. Fotos

Usar Supabase Storage.

Bucket planejado: `product-images`.

Estrutura sugerida:

```text
products/<product-id>/<arquivo>.webp
```

A aplicação deve preferir imagens otimizadas para web e mobile.

## 12. Evoluções futuras previstas

A arquitetura deve permitir adicionar sem reescrever o catálogo:

### Mercado Pago

- criação de pagamento
- Pix/cartão
- webhook
- estados de pagamento

### SuperFrete

- peso logístico por produto/categoria
- perfis de embalagem
- cálculo automático
- escolha do frete no checkout

Nenhuma dessas integrações faz parte da V1 atual.

## 13. Deploy

Direção preferida:

- storefront/admin: Cloudflare Pages
- banco/auth/storage/backend sensível: Supabase exclusivo
- GitHub `main` como fonte de deploy de produção

Antes de ativar deploy automático de produção, criar ambiente funcional e testes básicos.

## 14. Princípio de reaproveitamento

Nosso Closet é referência técnica, não template para clonagem integral.

Pode reaproveitar padrões de:

- carrinho
- variantes
- UX de catálogo
- validações
- testes
- comportamento mobile

Não transportar:

- InfinitePay
- campanhas promocionais específicas
- regras de Uberaba
- Telegram
- códigos NC
- tenant compartilhado
- configurações/segredos/dados da Thaty
