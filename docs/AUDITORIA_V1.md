# Auditoria final da V1 — qualidade, segurança e preparação de entrega

Rodada de 18/10/2026. Escopo: checkout, banco/RLS, Edge Function, painel, mobile e vitrine. Nenhuma migration foi criada ou aplicada;
nada foi escrito em produção. Regras comerciais preservadas (frete e pagamento manuais; pedido **não** reserva nem baixa estoque;
só **concluir a venda** baixa estoque, uma única vez; cancelar não baixa).

Legenda de status: **Corrigido** (alterado nesta rodada) · **Testado** (coberto por teste automatizado) · **Pendente** (decisão/ação técnica) · **Depende da Francine**.

## 1. Auditoria do checkout

Fluxo: Vitrine → Produto → Variante → Carrinho → Checkout → Pedido recebido → Painel.

| Verificação | Resultado | Evidência |
|---|---|---|
| Preço conferido no servidor | OK. O RPC lê preço/nome/cor/tamanho do banco; preço do navegador é descartado. O pedido guarda o *snapshot* (mudar o preço depois não altera pedidos existentes). | Testado: `t_01`, `t_02` (snapshot), `create-order.test.ts` |
| Produto/variante inativos, publicação futura | Bloqueados (`variant_unavailable`). | Testado: `t_01`, `t_02` (publicação futura — novo) |
| Quantidade e estoque | Máx. 20 por variante (soma de linhas repetidas), estoque conferido sem reservar. | Testado |
| Proteção contra envio duplicado | Cliente: *single-flight* + botão desabilitado. Servidor: limite de 5 pedidos/h por telefone com lock consultivo. | Testado (Node + concorrência SQL real) |
| Erro de rede | Carrinho preservado e nova tentativa permitida. **Corrigido:** a mensagem agora orienta a conferir com a Francine antes de reenviar (evita pedido duplicado se o envio chegou a ser feito). | Testado (`polish.test.js`) |
| Estado do carrinho após falha / sucesso | Falha: mantém. Sucesso: limpa e mostra o código. Estoque/indisponibilidade: reconcilia e avisa o que mudou. | Testado |
| Validação dos campos | Cliente (conveniência) + Edge Function + RPC + constraints do banco. Mensagens em português. | Testado |
| Pedido sem frete | Painel: “Concluir venda” bloqueado; banco recusa `shipping_not_defined` (R$ 0,00 vale). Loja informa que a Francine calcula o frete. | Testado |
| Confirmação manual da venda | Modal de confirmação no painel; baixa de estoque transacional. | Testado |
| Idempotência da conclusão | Segunda conclusão retorna `already_done` sem nova baixa; 5 cliques simultâneos baixam 1 vez. | Testado (concorrência SQL) |
| Cancelamento | Pendente/contatado → cancelado sem tocar no estoque; concluído não cancela; cancelado não volta. **Novo teste:** histórico do cancelamento com autor e nota. | Testado |
| Concorrência entre pedidos | Última peça disputada por 2 pedidos: 1 conclui, 1 recebe `insufficient_stock`; estoque nunca negativo (CHECK). | Testado |
| Histórico de alterações | Todo evento grava `order_status_history` (append-only, imutável). **Novo teste:** sequência criado → contatado → cancelado. | Testado |
| Conclusão com falta em vários itens | Falha inteira, sem baixa parcial, detalhando todos os itens em falta. | Testado (novo) |

Observação de comportamento (por desenho da V1, sem reserva): duas clientes podem solicitar a última peça; a primeira venda **concluída** consome o estoque e a outra solicitação precisa de contato manual.

## 2. Segurança — riscos classificados

Método: leitura de migrations, Edge Function, headers/CSP, código do storefront/admin; testes de catálogo do banco (RLS, grants, funções) e varredura estática.
Não foram feitas consultas ao Supabase de produção nem alteradas configurações.

| ID | Sev. | Risco | Situação / ação |
|---|---|---|---|
| S1 | **Médio** | **Spam distribuído / pedidos falsos** pela Edge Function pública (`--no-verify-jwt`). Hoje: 5 pedidos/h por telefone (banco) + limite por IP em memória (best-effort). Telefones variados contornam. Sem efeito em estoque (não há reserva), mas polui a fila do painel. CORS não impede chamadas fora do navegador. | **Pendente — requer aprovação** (novo secret/domínio no CSP/privacidade). Opções e impacto na seção 2.2. Mitigação atual: Francine cancela pedidos falsos; nenhum dado de pedido é público. |
| S2 | **Médio (operacional)** | Conta temporária de teste com acesso administrativo total. | **Pendente / Depende do GL:** revogar vínculo e usuário após o teste do celular (não alterada nesta rodada). |
| S3 | Baixo | **Pedido duplicado** após falha de rede/timeout (sem chave de idempotência no servidor). Sem efeito em estoque; Francine cancela a duplicata. | Mitigado na interface (**Corrigido**: aviso). Solução definitiva (chave de idempotência) exigiria migration → **Pendente, opcional**. |
| S4 | Baixo | Sessão do admin guardada em `localStorage` (exposta somente em caso de XSS). | Mitigado: CSP `script-src 'self'`, nenhum *sink* de HTML (teste novo varre o código), tudo via `textContent`. Aceito. |
| S5 | Baixo | Estoque exato legível por anônimos (`product_variants.quantity` na policy pública). Revela quantidade disponível a concorrentes/curiosos. | **Aceito** (a vitrine usa para limitar quantidade). Alternativa futura: expor só “disponível/esgotado” via view (migration). |
| S6 | Baixo | Limite por IP em memória por instância; `X-Forwarded-For` pode ser forjado se a função for acessada direto. | Aceito enquanto a barreira real é o limite por telefone no banco; resolvido junto com S1. |
| S7 | Baixo | `style-src 'unsafe-inline'` (necessário por atributos `style` usados na interface). | Aceito; `script-src 'self'` e `object-src 'none'` seguem estritos. |
| S8 | Baixo | `address_complement` sem limite de tamanho dentro do RPC (a Edge Function limita a 120). RPC é executável só por `service_role`. | Aceito; ajustar numa futura migration. |
| S9 | Baixo | Corpo da requisição limitado por caracteres (não bytes) e lido antes de recusar; falha do banco gerava erro não tratado (sem CORS). | **Corrigido + Testado** (limite por bytes + `Content-Length`; 503/502 JSON controlado). |
| S10 | Baixo | Links “Política/Termos” do checkout abriam em nova aba sem `rel=noopener`. | **Corrigido + Testado** (teste varre todo `target="_blank"`). |
| S11 | Baixo | Sem `Strict-Transport-Security`. | **Corrigido** (HSTS `max-age=15552000`, sem `includeSubDomains`/`preload` por causa de `pages.dev`). Testado. |
| S12 | Info | **Avisos “SECURITY DEFINER” do Supabase Advisor** — *não são vulnerabilidades comprovadas*, ver 2.1. | Classificado; teste de catálogo impede regressão. |
| S13 | Info | Funções do `pgcrypto` (ex.: `digest`) no schema `public`, executáveis por anônimos. São utilitários de hash sem acesso a dados; o Advisor costuma sinalizar “extension in public”. | Aceito; mover a extensão para o schema `extensions` exigiria migration (baixa prioridade). |
| S14 | Info | Bucket `product-images` é público para leitura (intencional); escrita só admin; MIME restrito (JPEG/PNG/WebP/AVIF, sem SVG/HTML) e 8 MB. | Testado (catálogo do banco). |
| S15 | Info | Proteção de senhas vazadas, política de senha e MFA do Supabase Auth. | **Não verificado** (configuração do painel Supabase). Recomenda-se conferir. |
| — | **Crítico / Alto** | Nenhum encontrado. Anônimos não leem nem escrevem pedidos; não-admin não executa operações administrativas; `create_order_request` só é executável por `service_role`. | Testado (`t_01`, `t_02`). |

### 2.1 Avisos “SECURITY DEFINER” — investigação

- `public.admin_*` (`SECURITY DEFINER`, `search_path` fixo): cada uma chama `private.assert_admin()` (`auth.uid()` + `is_admin()`) **antes** de qualquer efeito; usuário autenticado não-admin recebe `forbidden`; `anon` não tem `EXECUTE`. O aviso do Advisor (“executável por authenticated”) é inerente ao padrão RPC-com-checagem; não há escalonamento.
- `public.create_order_request`: `SECURITY DEFINER`, **sem** `EXECUTE` para `anon`/`authenticated`; apenas `service_role` (usado só pela Edge Function).
- `public.is_admin()`: devolve apenas se o próprio usuário é admin; `private.admin_users` não é legível por clientes.
- Garantia contínua: `tests/sql/t_02_audit.sql` falha se surgir função `SECURITY DEFINER` sem `search_path`, função executável por `anon`, ou RPC não-admin exposta a `authenticated`.

### 2.2 Proteção contra spam distribuído — avaliação (não implementada)

Nada abaixo foi instalado. Para implementar é necessária aprovação do GL, pois envolve novos secrets/ajustes de segurança.

| Opção | Como funciona | Impacto/custo | Observações |
|---|---|---|---|
| **A. Cloudflare Turnstile** (recomendada) | Widget no checkout gera token; a Edge Function valida em `siteverify` com um secret. | Gratuito. Requer: (1) criar o widget na Cloudflare com os hostnames `francinefurinistore.com.br` e `francine-furini-store.pages.dev`; (2) **novo secret** `TURNSTILE_SECRET_KEY` no Supabase; (3) chave pública no `config.js` (nova variável); (4) **CSP**: liberar `https://challenges.cloudflare.com` em `script-src`, `frame-src` e `connect-src`; (5) alterar e **redeployar** a Edge Function; (6) citar a Cloudflare na Política de Privacidade. Sem migration. | Decidir comportamento se a Cloudflare estiver fora (recomendo falhar fechado com mensagem + WhatsApp). Teste: validar token, rejeitar ausente/expirado/reutilizado, CORS inalterado. |
| B. Teto global por hora no banco | RPC recusa novos pedidos acima de N/h no total. | Exige **migration**. Protege o painel de enxurrada, mas também bloqueia clientes reais durante o ataque. | Bom complemento, não substitui A. |
| C. Honeypot / tempo mínimo de preenchimento | Rejeita formulários preenchidos por robôs simples. | Sem secrets. Ineficaz contra quem chama a API diretamente. | Baixo valor; não implementado. |
| D. Proxy pela Cloudflare (WAF/rate limit) | Colocar a função atrás de um domínio proxied. | Muda arquitetura/domínio; mais custo operacional. | Fora do escopo da V1. |

Recomendação: **A**, antes de divulgar a loja em larga escala; opcionalmente **B** depois.

## 3. Experiência mobile

Auditoria no Chromium com viewport 360, 390, 768 e desktop (1280), percorrendo vitrine (home, produto, carrinho, checkout) e admin (login, painel, produtos, novo/edição de produto, pedidos, detalhe do pedido), medindo rolagem horizontal e alvos de toque.

| Verificação | Resultado |
|---|---|
| Rolagem horizontal | **Nenhuma** em todas as telas e tamanhos. |
| Alvos de toque < 44 px (antes) | Links do rodapé (16 px), migalhas, “Sair”, botões pequenos do admin (36 px), seletor de arquivo nativo. **Corrigido** (mínimo 44 px em telas de toque/estreitas). Restam apenas links dentro de frases (exceção aceita). |
| Cadastro de produto no celular | Reorganizado: campos principais primeiro; slug/SKU/agendamento em “Mais opções”; **fotos dentro do formulário, acima de “Criar produto”**; botão “Escolher fotos da galeria”; teclado decimal no preço e numérico na quantidade; variantes com rótulos visíveis (Cor, Tamanho, Quantidade em estoque). |
| Upload | Seleção múltipla, preview, remover da seleção, texto alternativo, progresso (“Enviando foto 2 de 5…”), erros por arquivo com motivo em português. **Novo:** foto acima de 8 MB é reduzida automaticamente (JPEG, lado maior 2400 px, respeita orientação) — arquivos dentro do limite não são alterados; se a redução falhar, o arquivo é sinalizado. |
| Edição posterior | Variantes e fotos editáveis (ordem ↑ ↓, texto alternativo, remover). |

### Publicação acidental — decisão

O formulário marcava novos produtos como **ativos** por padrão (risco de publicar rascunho). Decisão: produto novo nasce **oculto (rascunho)**; caixa colorida “Oculto da loja (rascunho) / Visível na loja / Agendado”; ao **publicar** (novo ativo, ou rascunho → ativo) aparece confirmação “Publicar na loja agora?” com avisos (sem fotos, sem estoque). Salvar outras alterações de um produto já ativo não pede confirmação. Testado (regras puras + navegador).

## 4. Vitrine

- Paleta aproximada do Instagram: marrom-terroso `#734335` (botões, destaques) e bege `#D2C3AE`; `taupe` escurecido porque o antigo tinha contraste 3,0:1 (abaixo do AA); teste de contraste (≥ 4,5:1) nas combinações de texto.
- Seção **Como comprar** (home e `#/como-comprar`): 4 passos do fluxo real + aviso explícito de que a solicitação **não** é confirmação de pagamento nem reserva de estoque. Sem política de troca, descontos ou prazos (teste impede).
- Cabeçalho pronto para a **logo oficial**: `storefront/js/lib/brand.js` (`logo: null` hoje) + `storefront/assets/brand/README.md`. Wordmark atual preservado; **sem** logo improvisada, **sem** `og:image`.
- Rodapé com “Como comprar”, Instagram, WhatsApp, Privacidade e Termos; navegação e espaçamentos ajustados.

## 5. Testes

Ver `npm run test:all` (Node + SQL). Novos grupos: auditoria do banco (`t_02`), robustez/payload adulterado da Edge Function, travas de rede/segredos/outros clientes/XSS (`tests/security`), publicação segura e upload mobile (`tests/admin/publish-mobile.test.js`), vitrine (`tests/storefront/polish.test.js`).
Os testes Node rodam com `fetch` real **bloqueado** (`tests/helpers/no-network.mjs`): nenhum teste consegue criar pedido ou escrever em produção.

## 6. Resumo de pendências

**Corrigido nesta rodada:** limite de corpo por bytes; erro do banco com JSON controlado; HSTS; `rel=noopener`; aviso de pedido duplicado; contraste; alvos de toque; cadastro de produto no celular; rascunho por padrão; redução automática de fotos grandes; “Como comprar”; estrutura da logo.

**Pendente (técnico):** Turnstile (S1, aprovação); idempotência (S3, migration opcional); mover `pgcrypto` (S13); revisar configurações do Supabase Auth (S15); validação de pedido completo no domínio oficial.

**Depende do GL:** revogar a conta temporária após o teste (S2); aprovar a opção de proteção anti-spam.

**Depende da Francine:** arquivo original da logo (segunda-feira); WhatsApp oficial na entrega; CEP/origem; Instagram oficial; cadastro de produtos reais; confirmar frete/atendimento/trocas (não inferir política).
