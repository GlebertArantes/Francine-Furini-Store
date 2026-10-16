import { h } from "../lib/dom.js";
import { validateSettings } from "../lib/rules.js";
import { loadInto, guard, toast, field, showFieldErrors } from "../lib/ui.js";

export function settingsView(ctx) {
  const root = h("div", { class: "page" });
  loadInto(ctx, root, () => ctx.api.getSettings(), (s) => {
    const v = s ?? {};
    const name = h("input", { name: "store_name", value: v.store_name ?? "", maxlength: 120 });
    const ig = h("input", { name: "instagram_url", value: v.instagram_url ?? "", type: "url", placeholder: "https://instagram.com/..." });
    const wa = h("input", { name: "whatsapp_number", value: v.whatsapp_number ?? "", inputmode: "tel", placeholder: "31 99999-9999" });
    const ann = h("input", { name: "announcement_text", value: v.announcement_text ?? "", maxlength: 200 });
    const btn = h("button", { type: "submit", class: "btn" }, "Salvar configurações");
    const form = h("form", { class: "panel narrow", novalidate: true },
      field("store_name", "Nome da loja", name), field("instagram_url", "Instagram (link)", ig),
      field("whatsapp_number", "WhatsApp da loja", wa, "Com DDD. Usado nos botões de contato da loja."),
      field("announcement_text", "Texto de anúncio (opcional)", ann, "Aparece na faixa no topo da loja. Deixe vazio para ocultar."), btn);
    const save = guard(btn, async () => {
      const r = validateSettings({ store_name: name.value, instagram_url: ig.value, whatsapp_number: wa.value, announcement_text: ann.value });
      showFieldErrors(form, r.errors);
      if (!r.ok) return;
      try { await ctx.api.updateSettings(r.payload); wa.value = r.payload.whatsapp_number ?? ""; toast("Configurações salvas."); }
      catch (e) { if (!ctx.fail(e)) toast("Não foi possível salvar as configurações.", "error"); }
    });
    form.addEventListener("submit", (e) => { e.preventDefault(); save(); });
    root.replaceChildren(h("h1", {}, "Configurações da loja"), form);
  });
  return root;
}
