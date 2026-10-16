// DOM mínimo para testar views sem navegador. Imita o comportamento NATIVO que causou o bug:
// append()/replaceChildren() convertem argumentos que não são Node em texto — null vira "null".
export class Node {}
export class Text extends Node { constructor(data) { super(); this.data = String(data); } }
export class Element extends Node {
  constructor(tag) { super(); this.tag = tag; this.attrs = {}; this.children = []; this.className = ""; this.listeners = []; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  removeAttribute(k) { delete this.attrs[k]; }
  toggleAttribute() {}
  addEventListener(type, fn) { this.listeners.push([type, fn]); }
  append(...args) { this.children.push(...args.map(coerce)); }
  replaceChildren(...args) { this.children = args.map(coerce); }
  replaceWith() {}
  get textContent() { return this.children.map(textOf).join(""); }
  set textContent(v) { this.children = [new Text(v)]; }
}
const coerce = (a) => (a instanceof Node ? a : new Text(a)); // null -> "null", undefined -> "undefined"

export function installFakeDom() {
  globalThis.Node = Node;
  globalThis.document = { title: "", createElement: (t) => new Element(t), createTextNode: (d) => new Text(d), getElementById: () => null };
}
export const textOf = (n) => (n instanceof Text ? n.data : n.children.map(textOf).join(""));
export function findAll(n, pred, out = []) {
  if (n instanceof Element) { if (pred(n)) out.push(n); n.children.forEach((c) => findAll(c, pred, out)); }
  return out;
}
export const byClass = (n, cls) => findAll(n, (e) => e.className.split(/\s+/).includes(cls));
export const flush = () => new Promise((r) => setTimeout(r, 0));
/** Todos os nós de texto da árvore (para achar "null"/"undefined" soltos, mesmo colados a outras palavras). */
export function textNodes(n, out = []) { if (n instanceof Text) out.push(n.data); else n.children.forEach((c) => textNodes(c, out)); return out; }
