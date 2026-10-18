# Storefront — Francine Furini Store (V1)

Loja pública estática (HTML + CSS + JS em módulos ES, **sem framework e sem build pesado**). O catálogo, estoque e
configurações vêm do **Supabase** (PostgREST + Storage público); o pedido é criado pela Edge Function `create-order`.

## Rodar localmente

```bash
export SUPABASE_URL=https://<projeto>.supabase.co
export SUPABASE_PUBLISHABLE_KEY=<chave publishable/anon>   # nunca service_role
# opcional: export CREATE_ORDER_URL=https://<projeto>.supabase.co/functions/v1/create-order
npm run storefront:config   # gera storefront/config.js (ignorado pelo Git)
npm run storefront:serve    # http://localhost:5173
```

`storefront:config` recusa chaves `sb_secret_*` e JWT com `role=service_role`. Em produção (Cloudflare Pages), rode o
mesmo comando como etapa de build com as variáveis do ambiente e publique a pasta `storefront/`.

## Estrutura

```
storefront/
  index.html            shell da página
  config.example.js     exemplo (config.js real é gerado e ignorado pelo Git)
  css/styles.css        identidade visual (creme/areia/nude/chocolate, serifa elegante)
  js/app.js             roteador por hash (#/, #/produto/<slug>, #/carrinho, #/checkout, #/pedido) + header/rodapé
  js/lib/               regras puras, testadas em Node
    cart.js             carrinho por variante, limite por estoque/20, reconciliação, localStorage namespaced
    catalog.js          filtros, busca, tamanhos livres, preço promocional, esgotado
    checkout.js         validação, payload sem preço, erros, single-flight, link do WhatsApp
    api.js              leitura Supabase (chave publishable) e URL pública do bucket product-images
    format.js, dom.js   formatação e DOM seguro (sem innerHTML com dados)
  js/views/             telas: home, product, cart, checkout, success
```

## Decisões

- **Sem catálogo estático**: tudo é lido do Supabase; as policies RLS decidem o que é visível (produtos/variantes ativos).
- **Frontend não é autoridade**: o carrinho guarda preço só como referência visual. O `create-order` recebe dados da cliente +
  `variant_id` + `quantity`; o servidor recalcula tudo. O carrinho é reconciliado com o estoque atual ao abrir carrinho/checkout e após erro de estoque.
- **Configuração única**: nome, Instagram, WhatsApp e anúncio vêm de `store_settings` (nada duplicado no código).
- **WhatsApp**: `wa.me/<número de store_settings>` com mensagem contendo apenas o código do pedido (sem PII).
- **Sem dependências externas em runtime** (sem CDN/fontes remotas): fonte serifada do sistema com fallback.
- Hash routing evita configurar rewrites no Cloudflare Pages.

## Testes

`npm test` cobre as regras JS (`tests/storefront/`). Fluxo no navegador foi verificado manualmente com Chromium contra um mock do Supabase.

## Domínio oficial e SEO

- Domínio oficial: `https://francinefurinistore.com.br`. `index.html` declara `canonical` e `og:url` absolutos para ele; as rotas
  são por hash (`#/produto/...`), então o canonical é sempre a raiz. O `pages.dev` continua no ar e aponta o canonical para o domínio oficial.
- O redirecionamento `www` → domínio principal (301) é feito na Cloudflare; não há `_redirects` nem `<meta refresh>` no código.
- A CSP (`_headers`) usa `'self'` e não cita o host da loja: trocar/adicionar domínio **não exige** alterar a CSP.
- Checkout em um domínio novo exige incluí-lo em `ALLOWED_ORIGINS` da Edge Function (`docs/DOMINIO_E_CORS.md`).
- Sem `og:image` até a marca oficial estar disponível.

## Marca, “Como comprar” e acessibilidade

- Paleta: marrom-terroso `#734335` e bege `#D2C3AE` (tokens em `css/styles.css`); contraste AA verificado por teste.
- Seção “Como comprar” (`js/views/how-to-buy.js`) na home e em `#/como-comprar`, com o aviso de que a solicitação não é pagamento nem reserva de estoque.
- Logo oficial: aguardando o arquivo original. Estrutura pronta em `js/lib/brand.js` e `assets/brand/README.md` (nenhuma logo improvisada, sem `og:image`).
