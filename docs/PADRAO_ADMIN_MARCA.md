# Padrão TaskZap — marca e prévia no painel administrativo de lojas

Aplicado na Francine Furini Store (referência para novos clientes; outros projetos **não** foram alterados).

1. **Marca no login e no cabeçalho.** Todo painel mostra o monograma/logo do cliente (decorativo, `alt=""`) com o nome da loja em texto, responsivo (≈ 2,25 rem no cabeçalho, 4 rem no login). Como vitrine e painel têm deploys independentes (Cloudflare Pages), o arquivo da logo é **copiado** para `admin/assets/brand/` (nome versionado `.vN`) e a igualdade com a vitrine é testada. Fonte única no painel: `admin/js/lib/brand.js`.
2. **Usuário amigável.** O cabeçalho exibe só o login (`friendlyLogin` em `admin/js/lib/identity.js`): `fran1010@admin.francine-furini.local` → `Fran1010`; e-mail real → parte antes do `@`. Nunca o e-mail completo; nada fixo no código.
3. **Prévia na vitrine no cadastro de produto.** Formulário + prévia lado a lado (≥ 62 rem) ou aba "Ver prévia" no celular, atualizada a cada digitação, sem gravar nada (produto novo usa as fotos locais; produto salvo mostra "alterações não salvas"). Estoque/variantes nunca são inventados: sem variantes, a prévia avisa que a vitrine mostraria "esgotado".
4. **Sem regra duplicada.** O admin não importa `../storefront`; as regras puras (`catalog.js`, `card.js`, `format.js`) são copiadas para `admin/js/lib/shared/` por `node scripts/sync-admin-shared.mjs` e um teste exige cópia idêntica. O CSS da prévia (`.pv`) reproduz o card da loja com os tokens da vitrine.
5. **Diferenças prévia × vitrine real:** a prévia usa uma largura fixa (≈ 18 rem), não reflete a grade/ordem da coleção, nem a seção "Destaques"; o botão de compra é desabilitado; variantes mostradas são as **salvas** (as cadastradas na seção própria), não as digitadas.
