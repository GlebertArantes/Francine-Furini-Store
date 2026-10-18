# Marca (logo oficial) — pasta reservada

Aguardando o arquivo ORIGINAL da logo (PNG com fundo transparente ou SVG) enviado pela Francine.

**Não usar** a foto de perfil do Instagram (180×180, com anel) como logo, não redesenhar o monograma e não criar `og:image` improvisada.

Quando o arquivo existir:

1. Salvar como `storefront/assets/brand/logo.svg` (preferido) ou `logo.png` (altura mínima 160 px, fundo transparente).
2. Em `storefront/js/lib/brand.js`, trocar `logo: null` por `logo: { src: "./assets/brand/logo.svg", width: 160, height: 48 }`.
3. O cabeçalho passa a exibir a logo (o nome da loja continua disponível para leitores de tela). Nenhum outro arquivo precisa mudar.
4. Favicon e `og:image` (imagem social 1200×630) são decisões separadas e só depois da aprovação da logo.
