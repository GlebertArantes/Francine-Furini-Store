# Auditoria pós-entrega — 06/11/2026

Sem dados pessoais, credenciais ou conteúdo de pedidos. O banco estava vazio de produtos e pedidos no momento da auditoria (nada foi criado, alterado ou apagado em produção).

## Corrigido neste PR
| Prioridade | Achado | Evidência | Correção |
|---|---|---|---|
| Médio | A renovação de sessão apagava a sessão em **qualquer** resposta não-OK (inclusive 429/5xx do Auth). | `tests/admin/auth-refresh.test.js` falhava no código anterior | Só encerra a sessão quando o token é recusado (400/401/403). |
| Médio | Duas abas/aparelhos: o `refresh_token` é de uso único e a aba desatualizada o reutilizava, podendo derrubar a sessão. | idem | `auth.js` adota a sessão mais nova do armazenamento antes de renovar e após uma recusa. |
| Baixo | Ao fechar a inauguração o foco se perdia no `<body>`. | Playwright: `document.activeElement === body`; `tests/admin/inauguration-focus.test.js` | Foco volta ao `#main` quando não há foco anterior útil. |
| Baixo | `README.md` de `admin/` e `storefront/` eram publicados na web. | arquivos dentro das pastas publicadas | Movidos para `docs/ADMIN.md` e `docs/STOREFRONT.md`. |
| Baixo | O padrão do script de cópia passou a ser a cópia mais recente; o workflow legado e o README de 29/10 apontavam sem `--dir`. | leitura do workflow | `--dir backups/catalogo/2026-10-29` explícito. |

## Aberto (não corrigido de propósito)
- **Proteção contra senhas vazadas desativada** no Supabase Auth (aviso do advisor). É configuração do painel do Supabase, não código.
- **Corrida na contagem da inauguração**: dois acessos simultâneos leem o mesmo valor e gravam +1 (perda de uma contagem). Efeito apenas visual (até um aviso extra); não concede nem nega acesso. Correção exata exigiria uma função atômica no banco (migration): proposta, não implementada.
- O identificador técnico do login da Fran aparece no JavaScript publicado (`FRAN_LOGIN`). Não é senha; é consequência de a faixa ser exibida só para essa conta. Mitigação: senha forte + proteção de senha vazada.
- Concluir um pedido baixa o estoque e **não pode ser desfeito** pelo sistema (regra da V1); correção de engano é ajuste manual de estoque com motivo.
- As listas da loja e do painel não têm paginação para produtos: o limite padrão do PostgREST (1000 linhas) só importa em catálogos muito maiores que o previsto.
- Backups: cópias públicas no GitHub (catálogo + fotos) e arquivo privado no mesmo banco. Não há backup independente do banco nem rotina automática (o workflow `archive-public-catalog.yml` é legado, de execução única, e só dispara em um branch específico).
- As 10 fotos antigas continuam no Storage sem vínculo (bucket público de leitura) até decisão da Fran.
