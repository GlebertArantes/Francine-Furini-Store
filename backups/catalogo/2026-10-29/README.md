# Cópia pública do catálogo — 29/10/2026

Esta pasta conserva os dados publicados dos quatro produtos e as dez fotos originais. `manifest.json` registra tamanho e SHA-256 de cada imagem e do catálogo.

## Conferência
Execute, na raiz do repositório:

```sh
python3 scripts/archive-public-catalog.py --verify
```

Sem `--verify`, o script baixa novamente somente arquivos ausentes e verifica os mesmos hashes. Falhas de download ou divergências interrompem a execução. Não sobrescreve uma cópia existente divergente.

## Recuperação
As imagens estão em `images/`, mantendo o caminho original de cada arquivo no Storage. `catalogo.json` contém nomes, descrições, categorias, preços, opções e referências das fotos. Para recuperar, usar primeiro um ambiente isolado e conferir os arquivos com o manifesto. As pastas de site e painel continuam versionadas normalmente no repositório.

Esta é uma fotografia datada dos dados que já eram públicos. Não contém pedidos, contatos, endereços de clientes, credenciais ou contas administrativas. Quantidades são uma referência histórica: nunca reaplicar esses saldos sobre o estoque atual sem conciliação.

Não é backup completo do banco nem uma rotina diária. Alterações posteriores no Supabase não são copiadas automaticamente. O Supabase continua como fonte de verdade do catálogo em produção; o site não lê esta pasta.
