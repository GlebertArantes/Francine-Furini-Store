// Construção de DOM segura: texto sempre via textContent (nunca innerHTML com dados).
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === false || v == null) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, v);
  }
  append(el, children);
  return el;
}
function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}
/**
 * Substitui os filhos de `el` descartando null/undefined/false. O replaceChildren() nativo converte esses
 * valores em TEXTO ("null"), então qualquer lista com filhos condicionais deve passar por aqui.
 */
export function setChildren(el, ...children) {
  el.replaceChildren(...children.flat(Infinity).filter((c) => c != null && c !== false));
  return el;
}
export const clear = (el) => { el.replaceChildren(); return el; };
