// Marca da loja. Enquanto a logo oficial não existe, o cabeçalho usa o wordmark tipográfico.
// Para receber a logo: defina `logo` abaixo (ver storefront/assets/brand/README.md). Nada mais muda.
export const BRAND = Object.freeze({
  name: "Francine Furini Store",
  logo: null, // ex.: { src: "./assets/brand/logo.svg", width: 160, height: 48 }
});

/** Conteúdo do link da marca (cabeçalho). `h` é o construtor de DOM seguro. */
export function wordmarkContent(h, brand = BRAND) {
  if (brand.logo?.src) {
    return [
      h("img", { class: "brand-logo", src: brand.logo.src, alt: "", width: brand.logo.width, height: brand.logo.height, decoding: "async" }),
      h("span", { class: "sr-only" }, brand.name), // o nome continua disponível para leitores de tela
    ];
  }
  return ["Francine Furini", h("small", {}, "Store")];
}

export const wordmarkClass = (brand = BRAND) => `wordmark${brand.logo?.src ? " has-logo" : ""}`;
