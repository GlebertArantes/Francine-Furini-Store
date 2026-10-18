// Fila de fotos em memória + envio ordenado. Nada é enviado antes de existir product_id:
// na criação, o produto é criado primeiro e só depois as fotos sobem com o ID retornado.
import { validateImageFile } from "./rules.js";

export const MAX_PHOTOS_PER_SELECTION = 20;

/** Motivo do erro de upload em português simples (nunca expõe detalhes internos). */
export function describeUploadError(e) {
  const code = e?.code, status = e?.status, msg = String(e?.message ?? "").toLowerCase();
  if (code === "session_expired") return "sessão expirada — entre novamente";
  if (code === "network" || status === 0) return "sem conexão com a internet";
  if (status === 413 || /too large|exceed|maximum allowed|payload/.test(msg)) return "arquivo grande demais (limite de 8 MB)";
  if (status === 415 || /mime|not supported|invalid.*type|formato/.test(msg)) return "formato não aceito (use JPEG, PNG, WebP ou AVIF)";
  if (status === 401 || status === 403 || /row-level|unauthorized|permission/.test(msg)) return "sem permissão para enviar";
  if (status === 409 || /duplicate|already exists/.test(msg)) return "arquivo já existe, tente novamente";
  return "erro no envio — tente novamente";
}

/** Fila local (somente memória do navegador). Itens inválidos ficam visíveis com o erro, mas nunca são enviados. */
export function createPhotoQueue() {
  let seq = 0;
  let items = [];
  return {
    get items() { return items; },
    /** Acrescenta arquivos mantendo a ordem de seleção. */
    add(files) {
      for (const file of files) {
        const check = items.length >= MAX_PHOTOS_PER_SELECTION
          ? { ok: false, error: `Máximo de ${MAX_PHOTOS_PER_SELECTION} fotos por vez.` }
          : validateImageFile(file);
        items = [...items, { key: `p${++seq}`, file, alt: "", check }];
      }
      return items;
    },
    remove(key) { items = items.filter((i) => i.key !== key); return items; },
    setAlt(key, alt) { items = items.map((i) => (i.key === key ? { ...i, alt } : i)); },
    clear() { items = []; },
    /** Apenas arquivos válidos, na ordem em que foram selecionados. */
    valid: () => items.filter((i) => i.check.ok),
    invalid: () => items.filter((i) => !i.check.ok),
  };
}

/**
 * Envia as fotos válidas, em sequência, com sort_order = startOrder + posição. Falha em uma foto não
 * interrompe as demais (exceto sessão expirada). Revalida cada arquivo antes de enviar.
 * Retorna { uploaded, failed:[{name,error}], skipped:[{name,error}], sessionExpired }.
 */
export async function uploadPhotos(api, productId, items, startOrder = 0, { onProgress } = {}) {
  const uploaded = [], failed = [], skipped = [];
  let sessionExpired = false;
  let order = startOrder;
  let done = 0;
  for (const it of items) {
    onProgress?.({ done, total: items.length, name: it.file.name });
    const check = validateImageFile(it.file);
    if (!check.ok) { skipped.push({ name: it.file.name, error: check.error }); continue; }
    if (sessionExpired) { failed.push({ name: it.file.name, error: "session_expired", reason: describeUploadError({ code: "session_expired" }) }); continue; }
    try {
      uploaded.push(await api.uploadImage(productId, it.file, { altText: (it.alt ?? "").trim(), sortOrder: order }));
    } catch (e) {
      failed.push({ name: it.file.name, error: e?.message ?? "upload_failed", reason: describeUploadError(e) });
      if (e?.code === "session_expired") sessionExpired = true;
    }
    order++; // mantém a posição relativa mesmo quando uma foto falha
    done++;
  }
  return { uploaded, failed, skipped, sessionExpired };
}

/**
 * Criação de produto + fotos. 1) cria o produto; se falhar, lança e NÃO envia nada (fila intacta).
 * 2) com o ID retornado, envia as fotos. Falha de foto nunca remove o produto.
 */
export async function createProductWithPhotos(api, payload, queue, opts = {}) {
  const product = await api.createProduct(payload); // lança => nenhum upload
  const result = await uploadPhotos(api, product.id, queue.items.filter((i) => i.check.ok) /* só válidas */, 0, opts);
  const skipped = [...result.skipped, ...queue.invalid().map((i) => ({ name: i.file.name, error: i.check.error }))];
  return { product, ...result, skipped };
}

export function summarizeUpload({ uploaded, failed, skipped }) {
  const parts = [];
  if (uploaded.length) parts.push(`${uploaded.length} foto(s) enviada(s).`);
  if (failed.length) parts.push(`Não foi possível enviar: ${failed.map((f) => (f.reason ? `${f.name} (${f.reason})` : f.name)).join("; ")}. Envie novamente abaixo.`);
  if (skipped.length) parts.push(`Ignorada(s) por formato/tamanho: ${skipped.map((f) => f.name).join(", ")}.`);
  return { text: parts.join(" "), hasProblem: failed.length > 0 || skipped.length > 0 };
}
