# Marca (logo oficial)

- Origem: monograma enviado pelo GL, em **JPEG** (símbolo branco fino sobre fundo bege `#B09D7F`). **Não é SVG nem PNG transparente.**
- Uso: recorte quadrado centrado no símbolo, sem redesenhar nem remover fundo (preserva as linhas finas), exibido como "selo" bege no cabeçalho/rodapé.
- Arquivos (nomes versionados `.v1` para evitar cache da marca antiga): `logo-mark.v1.webp` (192 px), `favicon-16/32.v1.png`, `apple-touch-icon.v1.png` (180 px), `icon-192.v1.png`, `og-image.v1.jpg` (1200×630, monograma + nome da loja, sem slogan).
- Fonte única no código: `storefront/js/lib/brand.js`. Ao trocar a arte, subir nova versão (`.v2`) e atualizar `brand.js` e `index.html`.
- Limitação: arte atual raster/JPEG; o ideal é receber SVG ou PNG transparente oficial.
- Não usar a foto de perfil do Instagram (180×180, com anel) como logo.
