# Roteiro de teste mobile/admin (executar em celular real)

**Status: NÃO EXECUTADO** — exige celular, sessão de login (`Sarytta10`, mantida até o fim da homologação) e, nos itens com gravação, autorização do GL. Registrar aprovado/falhou + captura de tela por item.

| # | Teste | Grava em produção? | Esperado |
|---|---|---|---|
| 1 | Login no painel pelo celular (também testar senha errada e logout) | Não | Entra; erro genérico com senha errada; logout volta ao login |
| 2 | Novo produto **sem preencher nada**, só tocar "Escolher fotos da galeria" | Não (só seleção) | Fotos aparecem no formulário antes de criar |
| 3 | Preencher produto `TESTE — <data>` com várias fotos, cores, tamanhos, quantidades e preço promocional; criar | **Sim — pedir OK** | Nasce **oculto**; fotos enviadas; variantes corretas |
| 4 | Publicar (confirmação "Publicar na loja agora?") | **Sim — pedir OK** | Pede confirmação; aparece na vitrine com selo Promoção |
| 5 | Editar preço/estoque do produto de teste e reordenar/excluir uma foto | **Sim — pedir OK** | Alterações refletidas na vitrine |
| 6 | Listar pedidos e abrir detalhes | Não | Dados corretos, sem overflow em 360 px |
| 7 | Fluxo do PR #18: checkout na vitrine → botão "Enviar pedido pelo WhatsApp" | **Sim — cria 1 pedido (autorizar)** | Abre `wa.me/5534984258056` (número de TESTE) com resumo completo; **não** enviar ao número oficial; estoque não muda; não concluir venda |

Não modificar produtos reais nem o *Vestido Aurora — TESTE*. Sem limpeza nesta rodada; anotar IDs/códigos criados.
