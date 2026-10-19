// Marca no painel (padrão TaskZap: todo painel de loja mostra a marca do cliente no login e no cabeçalho).
// O arquivo é uma CÓPIA do monograma oficial da vitrine (o admin tem deploy independente); a igualdade é testada.
export const BRAND = Object.freeze({
  name: "Francine Furini Store",
  logo: Object.freeze({ src: "./assets/brand/logo-mark.v1.webp", width: 192, height: 192 }),
});

/** Selo do monograma (decorativo: o nome da loja vem em texto ao lado). */
export const brandMark = (h, cls, brand = BRAND) =>
  h("img", { class: cls, src: brand.logo.src, alt: "", width: brand.logo.width, height: brand.logo.height, decoding: "async" });
