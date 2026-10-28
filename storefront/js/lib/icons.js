// Ícones SVG próprios (inline, sem CDN/fontes externas). Decorativos: o texto do link é quem nomeia a ação.
const NS = "http://www.w3.org/2000/svg";
const PATHS = {
  lock: [
    ["rect", { x: "5", y: "10", width: "14", height: "11", rx: "2" }],
    ["path", { d: "M8 10V7a4 4 0 0 1 8 0v3M12 14v3" }],
  ],
  instagram: [
    ["rect", { x: "3.5", y: "3.5", width: "17", height: "17", rx: "5" }],
    ["circle", { cx: "12", cy: "12", r: "4" }],
    ["circle", { cx: "17.2", cy: "6.8", r: ".6" }],
  ],
  whatsapp: [
    ["path", { d: "M20.5 11.6a8.5 8.5 0 0 1-12.6 7.4L3.5 20.5l1.5-4.3A8.5 8.5 0 1 1 20.5 11.6z" }],
    ["path", { d: "M9 8.2c-.4.9-.2 2 .9 3.4 1.2 1.5 2.5 2.3 3.6 2.4.7.1 1.3-.5 1.5-1.1l-1.7-.9-.8.7c-.9-.4-1.7-1.1-2.2-2l.7-.8z" }],
  ],
};

export function icon(name) {
  const mk = (tag) => (document.createElementNS ? document.createElementNS(NS, tag) : document.createElement(tag));
  const svg = mk("svg");
  for (const [k, v] of Object.entries({ class: "ico", viewBox: "0 0 24 24", width: "18", height: "18", fill: "none", stroke: "currentColor",
    "stroke-width": "1.5", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", focusable: "false" })) svg.setAttribute(k, v);
  for (const [tag, attrs] of PATHS[name] ?? []) {
    const el = mk(tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    svg.append(el);
  }
  return svg;
}
