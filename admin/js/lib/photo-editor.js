import { h } from "./dom.js";
import { initialPhotoState, photoState, photoRatio, fillPhotoZoom, drawPhoto, loadPhoto, exportPhoto } from "./photo-transform.js";

// Modal local: cancelar não altera a fila. Aplicar gera um novo arquivo antes de resolver.
export async function editPhoto(file, savedState = null) {
  const route = window.location.hash;
  const image = await loadPhoto(file);
  if (window.location.hash !== route) { image.close?.(); return null; }
  return new Promise((resolve, reject) => {
    let state = photoState(savedState ?? initialPhotoState()), busy = false, closed = false;
    const previousFocus = document.activeElement;
    const pointers = new Map();
    const id = `photo-editor-${Math.random().toString(36).slice(2)}`;
    const canvas = h("canvas", { class: "photo-editor-canvas", tabindex: "0", role: "img",
      "aria-label": "Prévia da foto. Arraste para mover ou use as setas do teclado.", "aria-describedby": `${id}-help` });
    const msg = h("p", { class: "err", role: "alert" });
    const zoomValue = h("output", {});
    const zoom = h("input", { type: "range", min: ".5", max: "4", step: ".01", "aria-label": "Zoom da foto" });
    const x = h("input", { type: "range", min: "-100", max: "100", step: "1", "aria-label": "Posição horizontal" });
    const y = h("input", { type: "range", min: "-100", max: "100", step: "1", "aria-label": "Posição vertical" });
    const ratio = h("select", { "aria-label": "Formato da foto" },
      h("option", { value: "portrait" }, "Vitrine · retrato 3:4"), h("option", { value: "square" }, "Quadrada · 1:1"),
      h("option", { value: "landscape" }, "Horizontal · 4:3"), h("option", { value: "original" }, "Proporção original"));
    const background = h("select", { "aria-label": "Fundo da foto" }, h("option", { value: "#fffdf9" }, "Claro da loja"),
      h("option", { value: "#ffffff" }, "Branco"), h("option", { value: "#111111" }, "Preto"));
    const button = (label, fn) => h("button", { type: "button", class: "btn small secondary", onclick: fn }, label);
    const field = (label, el, extra) => h("label", { class: "photo-editor-field" }, h("span", {}, label, extra), el);
    const draw = () => {
      state = photoState(state);
      const aspect = photoRatio(image, state);
      canvas.width = Math.max(1, Math.round(aspect >= .75 ? 480 : 640 * aspect));
      canvas.height = Math.max(1, Math.round(canvas.width / aspect));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("canvas_unavailable");
      drawPhoto(context, image, state, canvas.width, canvas.height);
      zoom.max = String(Math.min(32, Math.max(4, fillPhotoZoom(image, state) * 2, state.zoom)));
      zoom.value = String(state.zoom); x.value = String(Math.round(state.panX * 100)); y.value = String(Math.round(state.panY * 100));
      zoomValue.textContent = ` ${Math.round(state.zoom * 100)}%`;
      zoom.setAttribute("aria-valuetext", `${Math.round(state.zoom * 100)} por cento`);
      ratio.value = state.ratio; background.value = state.background;
    };
    const update = (patch) => { if (!busy) { state = { ...state, ...patch }; draw(); } };
    const center = () => update({ zoom: 1, panX: 0, panY: 0 });
    const save = h("button", { type: "button", class: "btn" }, "Aplicar ajuste");
    const cancel = button("Cancelar", () => { if (!busy) finish(null); });
    const dlg = h("dialog", { class: "photo-editor", "aria-labelledby": `${id}-title`, "aria-describedby": `${id}-help` },
      h("div", { class: "photo-editor-head" }, h("h2", { id: `${id}-title` }, "Ajustar foto"),
        h("p", { id: `${id}-help`, class: "muted small" }, "Arraste a foto para enquadrar. No celular, use dois dedos para ampliar. O ajuste só é enviado quando você salvar o produto ou enviar as fotos.")),
      h("div", { class: "photo-editor-layout" },
        h("div", { class: "photo-editor-stage" }, canvas),
        h("div", { class: "photo-editor-tools" },
          field("Formato", ratio), field("Zoom", zoom, zoomValue),
          h("div", { class: "btn-row" }, button("− Zoom", () => update({ zoom: state.zoom / 1.15 })), button("+ Zoom", () => update({ zoom: state.zoom * 1.15 }))),
          field("Esquerda / direita", x), field("Cima / baixo", y),
          h("div", { class: "btn-row" }, button("Foto inteira", center), button("Preencher quadro", () => update({ zoom: fillPhotoZoom(image, state), panX: 0, panY: 0 }))),
          h("div", { class: "btn-row" }, button("Girar à esquerda", () => update({ rotation: state.rotation - 90, zoom: 1, panX: 0, panY: 0 })),
            button("Girar à direita", () => update({ rotation: state.rotation + 90, zoom: 1, panX: 0, panY: 0 }))),
          field("Fundo nas bordas", background), button("Recomeçar ajuste", () => update(initialPhotoState())),
          h("p", { class: "muted small" }, "Retrato 3:4 segue o formato dos cards da vitrine. Reduzir o zoom mostra a foto inteira com bordas; ampliar recorta as bordas."))),
      msg, h("div", { class: "photo-editor-actions" }, cancel, save));

    function finish(result, error = null) {
      if (closed) return;
      closed = true; window.removeEventListener("hashchange", onNavigate);
      pointers.clear(); image.close?.();
      dlg.close(); dlg.remove();
      if (previousFocus?.isConnected) previousFocus.focus();
      if (error) reject(error); else resolve(result);
    }
    const onNavigate = () => finish(null);
    dlg.addEventListener("cancel", (e) => { e.preventDefault(); if (!busy) finish(null); });
    dlg.addEventListener("close", () => { if (!closed) finish(null); });
    zoom.addEventListener("input", () => update({ zoom: Number(zoom.value) }));
    x.addEventListener("input", () => update({ panX: Number(x.value) / 100 }));
    y.addEventListener("input", () => update({ panY: Number(y.value) / 100 }));
    ratio.addEventListener("change", () => update({ ratio: ratio.value, zoom: 1, panX: 0, panY: 0 }));
    background.addEventListener("change", () => update({ background: background.value }));
    canvas.addEventListener("keydown", (e) => {
      const delta = { ArrowLeft: [-.02, 0], ArrowRight: [.02, 0], ArrowUp: [0, -.02], ArrowDown: [0, .02] }[e.key];
      if (!delta) return;
      e.preventDefault(); update({ panX: state.panX + delta[0], panY: state.panY + delta[1] });
    });
    canvas.addEventListener("pointerdown", (e) => {
      if (busy || (e.pointerType === "mouse" && e.button !== 0)) return;
      e.preventDefault(); canvas.focus(); canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    });
    canvas.addEventListener("pointermove", (e) => {
      if (busy || !pointers.has(e.pointerId)) return;
      const before = [...pointers.values()];
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const after = [...pointers.values()], rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      if (after.length === 1) {
        update({ panX: state.panX + (after[0].x - before[0].x) / rect.width,
          panY: state.panY + (after[0].y - before[0].y) / rect.height });
      } else if (after.length === 2) {
        const distance = (p) => Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
        const oldDistance = distance(before);
        if (oldDistance < 4) return;
        const nextZoom = photoState({ zoom: state.zoom * distance(after) / oldDistance }).zoom;
        const factor = nextZoom / state.zoom;
        const mid = (p, key) => (p[0][key] + p[1][key]) / 2;
        const oldX = (mid(before, "x") - rect.left) / rect.width - .5, newX = (mid(after, "x") - rect.left) / rect.width - .5;
        const oldY = (mid(before, "y") - rect.top) / rect.height - .5, newY = (mid(after, "y") - rect.top) / rect.height - .5;
        update({ zoom: nextZoom, panX: newX - (oldX - state.panX) * factor, panY: newY - (oldY - state.panY) * factor });
      }
    });
    for (const event of ["pointerup", "pointercancel", "lostpointercapture"]) canvas.addEventListener(event, (e) => pointers.delete(e.pointerId));
    save.addEventListener("click", async () => {
      if (busy) return;
      busy = true; msg.textContent = "";
      dlg.querySelectorAll("button, input, select").forEach((el) => { el.disabled = true; });
      save.textContent = "Preparando foto…";
      try {
        const output = await exportPhoto(image, state, file.name);
        finish({ file: output, state: { ...state } });
      } catch {
        if (!closed) msg.textContent = "Não foi possível preparar esta foto. Tente reduzir o zoom ou escolha outra imagem.";
      } finally {
        if (!closed) { busy = false; dlg.querySelectorAll("button, input, select").forEach((el) => { el.disabled = false; }); save.textContent = "Aplicar ajuste"; }
      }
    });
    try {
      document.body.append(dlg); draw(); dlg.showModal();
      window.addEventListener("hashchange", onNavigate);
      canvas.focus({ preventScroll: true }); dlg.scrollTop = 0;
    } catch (e) { finish(null, e); }
  });
}
