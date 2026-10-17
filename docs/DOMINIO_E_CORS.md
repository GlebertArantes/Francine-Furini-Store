# Domínio oficial e CORS do checkout

## Estado

| Item | Valor |
|---|---|
| Domínio oficial da loja | `https://francinefurinistore.com.br` |
| `www` | `https://www.francinefurinistore.com.br` → 301 para o domínio principal (Cloudflare) |
| Loja em `pages.dev` | `https://francine-furini-store.pages.dev` (preservada) |
| Admin | `https://francine-furini-admin.pages.dev` — **sem domínio próprio** |
| Frete / pagamento | manuais, combinados pela Francine |
| WhatsApp de testes | `5534984258056` (preservado até a entrega; oficial: `5531995652798`) |

## CORS da Edge Function `create-order`

A função só devolve `Access-Control-Allow-Origin` para origens **exatamente iguais** às de `ALLOWED_ORIGINS`
(comparação literal; sem `*`, sem curinga de subdomínio). Origem de navegador fora da lista recebe `403 origin_not_allowed` e nada chega ao banco.
O `www` não precisa constar: ele redireciona para o domínio principal antes de qualquer checkout.
CORS **não é autenticação** (chamadas sem navegador não enviam `Origin`); a proteção real continua sendo validação no servidor, rate limit e RPC.

### Valor de produção

```
https://francinefurinistore.com.br,https://francine-furini-store.pages.dev
```

Regras do valor: lista separada por vírgulas; cada item `https://host` **sem barra final, sem caminho e sem `*`**.
Itens inválidos são ignorados e a função registra um aviso nos logs (ver `parseAllowedOrigins` em `supabase/functions/create-order/handler.ts`).

### Operação pendente (executar no painel do Supabase — não exige redeploy da função)

1. Supabase → projeto `txgatyftvtpkgqlncxju` → **Edge Functions → Secrets** (ou *Project Settings → Edge Functions*).
2. Editar o secret `ALLOWED_ORIGINS` e colocar exatamente o valor de produção acima. Salvar.
3. Nada de redeploy é necessário: os secrets são lidos pela função em execução nas próximas invocações (se a instância atual estiver quente, a próxima cold start aplica o valor).
4. Equivalente por CLI: `supabase secrets set ALLOWED_ORIGINS="https://francinefurinistore.com.br,https://francine-furini-store.pages.dev" --project-ref txgatyftvtpkgqlncxju`.
5. Não alterar `SUPABASE_SERVICE_ROLE_KEY`, Auth, banco, migrations ou RLS. Não colar secrets em issues, PRs ou no Git.

> Observação sobre o código: esta PR adiciona `parseAllowedOrigins` (rejeita `*`, barra final, `http://` fora de localhost e entradas com caminho).
> Isso endurece a leitura da variável, mas **não é necessário** para o domínio funcionar: o valor acima já é aceito pelo código atualmente publicado.
> A função só passa a usar o novo parser quando for redeployada (decisão separada, sem urgência).

### Verificação após atualizar o secret (sem criar pedido)

Preflight a partir do domínio oficial (não cria nada):

```bash
curl -si -X OPTIONS "https://txgatyftvtpkgqlncxju.supabase.co/functions/v1/create-order" \
  -H "Origin: https://francinefurinistore.com.br" \
  -H "Access-Control-Request-Method: POST" | grep -i "^HTTP\|access-control"
# esperado: 204 e access-control-allow-origin: https://francinefurinistore.com.br

curl -si -X OPTIONS "https://txgatyftvtpkgqlncxju.supabase.co/functions/v1/create-order" \
  -H "Origin: https://evil.example" -H "Access-Control-Request-Method: POST" | grep -i "^HTTP\|access-control"
# esperado: nenhum access-control-allow-origin
```

A validação completa (criar um pedido real pelo domínio oficial) é uma etapa posterior e controlada.

## Adicionar um novo domínio no futuro

1. Apontar o domínio no Cloudflare Pages.
2. Acrescentar a origem (`https://novo-dominio`) a `ALLOWED_ORIGINS`.
3. Atualizar `canonical` e `og:url` em `storefront/index.html` (teste `tests/storefront/domain-seo.test.js`).
4. A CSP não muda (usa `'self'`).
