// Copia as regras PURAS da vitrine usadas na prévia do painel (os deploys são independentes: o admin não pode importar ../storefront).
// A cópia é verificada byte a byte nos testes (tests/admin/preview.test.js): rode `node scripts/sync-admin-shared.mjs` após mudar esses arquivos.
import { copyFileSync } from "node:fs";
const files = ["catalog.js", "card.js", "format.js"];
for (const f of files) copyFileSync(new URL(`../storefront/js/lib/${f}`, import.meta.url), new URL(`../admin/js/lib/shared/${f}`, import.meta.url));
console.log(`copiados: ${files.join(", ")}`);
