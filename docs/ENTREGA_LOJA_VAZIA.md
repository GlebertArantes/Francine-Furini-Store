# Entrega da loja vazia — 05/11/2026

Por decisão do Glebert, a loja foi entregue à Fran sem produtos, pedidos ou movimentações anteriores ("como um carro novo"). Este registro não contém dados pessoais nem segredos.

## O que foi retirado (banco Supabase, em uma transação)
| Tabela | Antes | Depois |
|---|---|---|
| products | 4 | 0 |
| product_variants | 6 | 0 |
| product_images (vínculos) | 10 | 0 |
| orders | 2 | 0 |
| order_items | 3 | 0 |
| order_status_history | 3 | 0 |
| external_sales / external_sale_items / stock_adjustments / private.order_attempts | 0 | 0 |

Os aliases de endereço antigos (`previous_slugs`) saem junto com os produtos. O estoque não foi restaurado: o catálogo inteiro foi esvaziado.

## Preservado
Categorias padrão (7), `store_settings` (nome, WhatsApp, Instagram), administradores (3), `private.order_code_counters` (contadores não foram reiniciados), funções, políticas, migrations, marca/logo/textos, convite do Grupo VIP e WhatsApp flutuante. Nenhuma sequência técnica foi reiniciada.

## Arquivo privado para recuperação
`private.archived_test_records` (schema `private`, fora da API; RLS ligado; sem permissão para `anon` e `authenticated`). Cada linha traz `batch_id`, `source_table`, `source_id`, `reason` e a linha completa em `row_data` (os vínculos, como `product_id`, `order_id` e `variant_id`, estão dentro dela).
- Lote `2026-11-04-pedidos-de-teste`: 21 registros (5 pedidos de teste, seus itens e históricos).
- Lote `2026-11-05-entrega-loja-zerada`: 28 registros (2 pedidos, 3 itens, 3 históricos, 4 produtos, 6 variantes, 10 vínculos de imagem). A transação conferiu cada linha arquivada contra a original antes de apagar.
Esse arquivo vive no mesmo banco: não é backup independente nem completo. Pedidos e dados de clientes não saem do banco.

## Fotos no Storage
Os 10 arquivos do bucket `product-images` **não foram apagados**: ficam retidos, sem vínculo com nenhum produto, até a Fran confirmar que não precisa deles. Nenhum arquivo de identidade visual está nesse bucket. O bucket é de leitura pública, então quem tiver o endereço exato ainda consegue abrir esses arquivos; as mesmas fotos já constam nas cópias públicas do repositório. A remoção física, quando decidida, deve usar a API oficial do Storage (não SQL em `storage.objects`).

## Cópias do GitHub
`backups/catalogo/2026-10-29` e `2026-11-04` permanecem como fotografias parciais do catálogo público anterior. Não são backup completo do banco.

## Fora do escopo
Pixel da Meta, anúncios e novas funcionalidades.

## Fechamento da entrega — 05/11/2026
Glebert confirmou o administrativo vazio e autorizou a entrega e a inauguração privada. A vitrine publicada foi conferida mostrando “Novidades em breve”.

A faixa de boas-vindas é exclusiva do login da Fran, depois da autorização normal de administrador. A contagem de dez acessos fica na preferência visual da própria conta (Supabase Auth), sem alterar permissões, catálogo ou pedidos. Atualizar a mesma aba não consome outro acesso; sair e entrar novamente ou abrir em outra aba/aparelho conta como novo acesso. A faixa pode ser fechada com o botão ou Escape e respeita movimento reduzido.

A validação visual da animação usa uma página isolada de prévia com dados fictícios, retirada do código final. A sessão real da Fran não é usada nem tem seus acessos de inauguração consumidos pela verificação.
