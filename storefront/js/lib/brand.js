// Marca da loja (fonte única da logo). O monograma oficial é um JPEG com fundo chapado (#B09D7F): é usado como
// "selo" quadrado, sem remover fundo, ao lado do nome em texto. Se vier SVG/PNG transparente, basta trocar `src`.
export const BRAND = Object.freeze({
  name: "Francine Furini Store",
  logo: Object.freeze({ src: "./assets/brand/logo-mark.v1.webp", width: 192, height: 192, showName: true }),
});

/** Conteúdo do link da marca (cabeçalho). `h` é o construtor de DOM seguro. */
export function wordmarkContent(h, brand = BRAND) {
  const text = ["Francine Furini", h("small", {}, "Store")];
  if (brand.logo?.src) {
    const img = h("img", { class: "brand-logo", src: brand.logo.src, alt: "", width: brand.logo.width, height: brand.logo.height, decoding: "async" });
    if (brand.logo.showName) return [img, h("span", { class: "wordmark-text" }, ...text)];
    return [img, h("span", { class: "sr-only" }, brand.name)]; // só a logo: o nome continua disponível para leitores de tela
  }
  return text;
}

export const wordmarkClass = (brand = BRAND) => `wordmark${brand.logo?.src ? " has-logo" : ""}`;
