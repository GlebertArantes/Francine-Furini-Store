# Cópia pública do catálogo — 04/11/2026 (pós-limpeza de testes)

Fotografia datada do que a loja publica: 4 produtos, 6 variantes, 7 categorias e as 10 fotos originais em uso. `manifest.json` registra tamanho e SHA-256 de cada foto e do catálogo; cada foto também traz o MD5 informado pelo Storage (`storage_etag_md5`), conferido no momento da cópia.

## Conferência
```sh
python3 scripts/archive-public-catalog.py --verify            # a cópia mais recente
python3 scripts/archive-public-catalog.py --verify --dir backups/catalogo/2026-11-04
```
Sem `--verify`, o script baixa de novo apenas arquivos ausentes e confere os mesmos hashes. Para criar uma nova cópia, veja o cabeçalho do script (`--create`); ele recusa sobrescrever uma pasta existente.

## Origem das fotos
Os caminhos e eTags das 10 fotos são idênticos aos da cópia de 29/10 (arquivos do Storage nunca são substituídos). Os arquivos foram reaproveitados de `../2026-10-29/images` depois de conferir SHA-256 e MD5 com o Storage atual. Nesta data o Storage não pôde ser baixado do ambiente de preparação, por isso não houve novo download.

## O que é e o que não é
- Contém apenas dados já públicos: nomes, descrições, categorias, preços, opções (cor/tamanho/quantidade) e fotos. Códigos SKU não fazem parte da cópia.
- Não contém pedidos, clientes, telefones, endereços, credenciais nem contas administrativas.
- **Não é backup completo do banco nem rotina automática.** Alterações posteriores no Supabase não são copiadas.
- As quantidades são referência histórica: nunca reaplicar sobre o estoque atual sem conciliação.
- Cópias anteriores (`2026-10-29`) permanecem intactas.
