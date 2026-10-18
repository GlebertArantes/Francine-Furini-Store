// PONTO DE EXTENSÃO para informações de pagamento nos cards/produto (futuro Mercado Pago híbrido:
// frete manual + link de pagamento gerado no painel + confirmação por webhook).
//
// HOJE NÃO HÁ regras comerciais aprovadas: nenhum Pix promocional, parcelamento ou desconto é exibido.
// Quando houver, defina os valores em PAYMENT_DISPLAY (ou leia do banco/configuração) — o card já chama
// `priceExtras()` e renderiza o que vier, sem mudar a estrutura do componente.
export const PAYMENT_DISPLAY = Object.freeze({
  installments: null, // ex.: { max: 3, minParcelCents: 5000 }   — SOMENTE após aprovação comercial
  pixDiscount: null,  // ex.: { percent: 5 }                    — SOMENTE após aprovação comercial
});

/**
 * Linhas de texto extras abaixo do preço (ex.: "ou 3x de R$ 83,00"). Vazio enquanto não houver regra aprovada.
 * Os valores devem ser sempre calculados a partir do preço real do produto (nunca digitados no código).
 */
export function priceExtras(_product, config = PAYMENT_DISPLAY) {
  const lines = [];
  // Implementação futura: if (config.installments) lines.push(...); if (config.pixDiscount) lines.push(...);
  void config;
  return lines;
}
