# Painel administrativo — Francine Furini Store (V1)

HTML + CSS + módulos ES, sem framework e sem dependências em runtime (mesmo padrão do storefront, mas **independente**:
nada é importado de `storefront/`). Autenticação por **Supabase Auth**; a interface aceita **login + senha** e converte logins simples para um identificador técnico interno. A autorização real continua sendo a **RLS** (`public.is_admin()`) e as RPCs administrativas do banco.

## Login da cliente

A tela pública do admin não pede e-mail. Um login como `Fran1010` é normalizado para o identificador técnico interno:

`fran1010@admin.francine-furini.local`

Esse identificador existe apenas para compatibilidade com o Supabase Auth e não precisa ser exibido para a cliente. O acesso técnico legado por e-mail continua aceito para não bloquear a administração da TaskZap.

**Nunca versionar senha no repositório.** A senha deve existir somente no Supabase Auth e ser entregue à cliente por canal adequado.

## Rodar localmente

```bash
export SUPABASE_URL=https://<projeto>.supabase.co
export SUPABASE_PUBLISHABLE_KEY=<chave publishable/anon>   # nunca service_role/secret
npm run storefront:config   # gera storefront/config.js e admin/config.js (ignorados pelo Git)
npm run admin:serve         # http://localhost:5174
```

O painel recusa chave `sb_secret_*` ou JWT `service_role` (no script e novamente no navegador).
O primeiro administrador é criado/associado separadamente no Supabase (`private.admin_users`); não há auto-cadastro nem senha padrão.

## Estrutura

```
admin/
  index.html, css/admin.css, config.example.js, README.md
  js/app.js              login/gate (is_admin) + roteador por hash + shell
  js/lib/                regras puras (testadas em Node)
    config.js            valida config pública; recusa secrets
    auth.js              Supabase Auth REST: login, refresh (single-flight), logout; guarda só tokens/id/e-mail técnico
    api.js               PostgREST + Storage com o JWT do admin; 401 -> refresh -> repete 1x -> volta ao login
    money.js             R$ <-> centavos por string (sem ponto flutuante)
    photos.js            fila de fotos em memória + envio ordenado (criação e edição)
    rules.js             validação/payload de produto, variante, categoria, loja; regras de upload e ordenação de fotos
    orders.js            ações de pedido SOMENTE via RPC + single-flight + mapeamento de erros
    ui.js, dom.js        toasts, modal de confirmação, guarda de duplo clique, DOM seguro
  js/views/              login, dashboard, categories, products (lista/edição/variantes/fotos), orders (lista/detalhe), settings
```

## Decisões

- **Pedidos**: leitura direta; escrita exclusivamente por `admin_mark_order_contacted`, `admin_set_order_shipping`,
  `admin_complete_order` e `admin_cancel_order`. Nenhum `UPDATE` em `orders`; nenhuma lógica de estoque no frontend —
  só a conclusão da venda baixa estoque (no banco). "Concluir" fica desabilitado sem frete (R$ 0,00 vale) e o banco revalida.
  Erro `insufficient_stock` é mostrado com os itens em falta e o pedido é recarregado do servidor (sem sucesso falso).
- **Catálogo**: CRUD direto onde as policies `*_admin_all` permitem. Categorias não têm exclusão (desativar). Variante usada em
  pedidos não pode ser removida (FK do banco) — a tela orienta desativar. Editar quantidade é *ajuste manual*, sem movimento automático.
- **Fotos na criação do produto**: em `#/produtos/novo` a Francine já escolhe as fotos (preview, texto alternativo, remover da seleção). Nada é enviado antes de existir `product_id`: ao clicar em *Criar produto* o produto é criado primeiro e, com o ID retornado, as fotos válidas sobem em ordem. Se a criação falhar, nenhum upload acontece e a seleção é mantida. Se uma foto falhar depois da criação, o produto **não** é removido: a edição abre com um aviso listando as fotos que faltaram para reenviar. Arquivos inválidos (formato/8 MB) ficam sinalizados e nunca são enviados.
- **Fotos**: bucket fixo `product-images`, path `products/<product-id>/<timestamp>-<rand>.<ext>` (extensão vem do MIME), limite 8 MB.
  Upload: arquivo primeiro, depois a linha no banco (se o insert falhar, o arquivo é apagado). Remoção: banco primeiro (a loja
  para de exibir), depois o arquivo; se o Storage falhar, o painel avisa do arquivo órfão — nunca fica foto quebrada na loja.
- **Sessão**: tokens em `localStorage` (como o supabase-js); senha nunca é guardada nem logada. Não admin vê "Acesso negado" e pode sair.
- **Login simples**: a conversão para o identificador técnico é apenas conveniência de UX. Segurança/permissão continuam no Supabase Auth + `private.admin_users`/RLS.
- Nenhuma migration nova foi necessária: policies, grants e RPCs existentes cobrem o painel.

## Testes

`npm test` → `tests/admin/` (auth/não-admin/sessão, login por usuário, config, dinheiro, payloads, upload, ciclo de pedidos). O fluxo no navegador foi
verificado com Chromium contra um mock do Supabase.

## Cadastro de produto (celular) — comportamento atual

- **Produto novo nasce oculto (rascunho)**; caixa “Oculto da loja / Visível na loja / Agendado”. Publicar (novo ativo ou rascunho → ativo) pede confirmação com avisos (sem fotos / sem estoque).
- Fotos dentro do formulário (acima de “Criar produto”), botão “Escolher fotos da galeria”, progresso e erros por arquivo em português.
- Fotos acima de 8 MB (JPEG/PNG/WebP) são reduzidas automaticamente no navegador (JPEG, lado maior 2400 px); AVIF/outros formatos não são recodificados.
- Campos principais primeiro; slug/SKU/agendamento em “Mais opções”; variantes com rótulos visíveis e teclado numérico.
- Manual para a cliente: `docs/MANUAL_FRANCINE.md`. Auditoria: `docs/AUDITORIA_V1.md`.
