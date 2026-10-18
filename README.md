# Francine Furini Store

Loja virtual da **Francine Furini Store**, desenvolvida pela TaskZap.

## Status

**V1 em pré-entrega.** O núcleo técnico já foi implementado e validado em produção com produto e pedido de teste. Falta a validação operacional da Francine com um produto real, criação efetiva do usuário administrativo dela no Supabase Auth e a configuração dos dados finais de entrega.

## Produção

- Storefront atual: `https://francine-furini-store.pages.dev`
- Admin atual: `https://francine-furini-admin.pages.dev`
- Supabase exclusivo: projeto `txgatyftvtpkgqlncxju`
- Branch de produção: `main`
- **Domínio oficial da loja:** `https://francinefurinistore.com.br` (Cloudflare Pages, HTTPS ativo).
- `https://www.francinefurinistore.com.br` redireciona (301) para o domínio principal — configurado na Cloudflare, sem redirecionamento no código.
- `https://francine-furini-store.pages.dev` continua funcionando e **é preservado** (alternativa e período de migração).
- **O admin não tem domínio próprio:** permanece em `https://francine-furini-admin.pages.dev`.
- Fluxo comercial inalterado: **frete manual** e **pagamento manual**, combinados diretamente pela Francine.
- Checkout em novos domínios: ver [`docs/DOMINIO_E_CORS.md`](docs/DOMINIO_E_CORS.md) (variável `ALLOWED_ORIGINS` da Edge Function).

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
- Painel administrativo protegido por autenticação (produto novo nasce **oculto/rascunho**; publicar pede confirmação)
- Login administrativo por usuário + senha na interface (Supabase Auth permanece como autoridade interna)
- Supabase exclusivo para a Francine Furini Store
- Política de Privacidade e Termos de Uso/Compra
- SEO/social básico e favicon
- Seção “Como comprar” e cabeçalho pronto para a logo oficial (aguardando o arquivo original da Francine)

## Fluxo comercial validado

1. Cliente acessa a loja.
2. Escolhe produto, cor, tamanho e quantidade.
3. Adiciona ao carrinho e informa seus dados.
4. O servidor confere produto, variante, preço e estoque e cria a solicitação.
5. O pedido nasce em `pending_shipping` e **não reserva/não baixa estoque**.
6. A loja calcula e informa o frete manualmente.
7. O pedido pode ser marcado como `contacted`.
8. Após o fechamento manual do pagamento, a loja conclui a venda.
9. A baixa de estoque acontece **somente em `completed`**, de forma transacional.

O fluxo completo foi validado em produção com o pedido de teste `FF-171026-001`.

## Estado de teste antes da entrega

- Produto `Vestido Aurora — TESTE`: inativo.
- Variante de teste: inativa.
- Pedido de teste concluído: preservado para histórico/auditoria.
- Pedido de teste cancelado: preservado para histórico/auditoria.
- WhatsApp temporário de testes: `5534984258056`.
- WhatsApp oficial da Francine para a entrega: `5531995652798`.
- Login planejado para a cliente: `Fran1010` (a senha nunca deve ser versionada no repositório).

Não trocar para o WhatsApp oficial antes do aceite final da cliente.

## Segurança

- RLS habilitado nas tabelas expostas.
- Frontend nunca é autoridade de preço, estoque ou permissão.
- Criação pública de pedido passa por backend; não há escrita anônima direta em pedidos/catálogo.
- Conclusão/cancelamento/contato/frete usam RPCs administrativas protegidas por verificação de admin.
- Estoque é baixado em transação e a conclusão é idempotente.
- Storage de produtos aceita somente os formatos e limites definidos pelo projeto.
- Nunca versionar service role, tokens, senhas ou credenciais privadas.

Os Security Advisors do Supabase podem sinalizar as RPCs `SECURITY DEFINER` administrativas como executáveis por `authenticated`; isso é intencional porque as funções fazem autorização interna via `is_admin()`. O teste SQL cobre usuário autenticado não-admin e confirma retorno `forbidden`/negação de acesso.

## Testes

```bash
npm test
npm run test:sql
npm run test:all
```

A suíte cobre regras de pedido, preço, estoque, permissões, catálogo, storefront, admin, login por usuário e concorrência do ciclo crítico.

## Antes da entrega final

Documentos úteis: [`docs/AUDITORIA_V1.md`](docs/AUDITORIA_V1.md) (auditoria de checkout, riscos de segurança e mobile) e [`docs/MANUAL_FRANCINE.md`](docs/MANUAL_FRANCINE.md) (manual da cliente).

O checklist rastreável está no GitHub Issue **#9 — Pré-entrega V1 — checklist final de lançamento**.

Dependências da cliente no aceite final:

- cadastrar/testar ao menos um produto real pelo painel;
- validar fotos, variantes, estoque e edição;
- criar/entregar efetivamente o usuário administrador da Francine no Supabase Auth;
- confirmar CEP/origem da loja e Instagram;
- validar o checkout de ponta a ponta no domínio oficial (etapa controlada, após a atualização de `ALLOWED_ORIGINS`);
- trocar o WhatsApp temporário de testes pelo oficial somente na entrega (preservado até lá);
- rodar smoke final de produção.

## Fora da V1

Não fazem parte desta entrega sem novo escopo aprovado:

- SuperFrete automático
- Mercado Pago integrado ao checkout
- webhook de pagamento
- reserva temporária de estoque
- ERP / emissão fiscal
- CRM / fidelidade / carrinho abandonado

Essas funcionalidades podem ser implementadas depois como evoluções independentes.
