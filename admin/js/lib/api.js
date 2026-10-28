// Cliente do painel: PostgREST + Storage com o JWT do admin (nunca service_role).
// A RLS/RPCs do banco são a autoridade; aqui só montamos as requisições.
import { IMAGE_BUCKET, isOwnStoragePath, buildStoragePath, validateImageFile } from "./rules.js";

export class ApiError extends Error {
  constructor(status, body = {}) {
    super(body.message ?? `http_${status}`);
    this.status = status; this.code = body.code; this.details = body.details; this.hint = body.hint;
  }
}
const sessionExpired = () => Object.assign(new ApiError(401, { message: "session_expired" }), { code: "session_expired" });

export function createAdminApi({ url, key, auth, fetchFn }) {
  async function send(fullUrl, init = {}, retry = true) {
    const token = await auth.getAccessToken();
    if (!token) { auth.expire(); throw sessionExpired(); }
    let res;
    try {
      res = await fetchFn(fullUrl, { ...init, headers: { apikey: key, authorization: `Bearer ${token}`, ...init.headers } });
    } catch { throw Object.assign(new ApiError(0, { message: "network" }), { code: "network" }); }
    if (res.status === 401 && retry) {
      if (await auth.refresh()) return send(fullUrl, init, false);
      auth.expire(); throw sessionExpired();
    }
    if (res.status === 401) { auth.expire(); throw sessionExpired(); }
    return res;
  }

  async function rest(method, path, { body, prefer, headers } = {}) {
    const res = await send(`${url}/rest/v1/${path}`, {
      method,
      headers: { accept: "application/json", ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(prefer ? { prefer } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => ({})));
    return res;
  }
  const json = async (method, path, opts) => { const r = await rest(method, path, opts); return r.status === 204 ? null : r.json().catch(() => null); };
  const one = async (method, path, body) => { const rows = await json(method, path, { body, prefer: "return=representation" }); return Array.isArray(rows) ? rows[0] : rows; };

  async function count(path) {
    const r = await rest("GET", `${path}${path.includes("?") ? "&" : "?"}select=id`, { prefer: "count=exact", headers: { range: "0-0", "range-unit": "items" } });
    return parseTotal(r.headers.get("content-range"));
  }

  const rpc = (name, args) => json("POST", `rpc/${name}`, { body: args ?? {} });

  return {
    rpc,
    isAdmin: async () => (await rpc("is_admin")) === true,

    async dashboard() {
      const [pending, contacted, completed, products, low, out] = await Promise.all([
        count("orders?status=eq.pending_shipping"), count("orders?status=eq.contacted"), count("orders?status=eq.completed"),
        count("products?active=eq.true"),
        count("product_variants?active=eq.true&quantity=gte.1&quantity=lte.2"),
        count("product_variants?active=eq.true&quantity=eq.0"),
      ]);
      return { pending, contacted, completed, products, low, out };
    },

    // Catálogo (CRUD direto permitido pelas policies *_admin_all)
    listCategories: () => json("GET", "categories?select=*&order=sort_order.asc,name.asc"),
    createCategory: (p) => one("POST", "categories", p),
    updateCategory: (id, p) => one("PATCH", `categories?id=eq.${enc(id)}`, p),

    listProducts: () => json("GET", "products?select=id,name,slug,sku,price_cents,compare_at_price_cents,active,featured,category_id,published_at,created_at,product_variants(id,quantity,active),product_images(id)&order=created_at.desc"),
    async getProduct(id) {
      const rows = await json("GET", `products?id=eq.${enc(id)}&select=*,product_variants(*),product_images(*)`);
      return rows?.[0] ?? null;
    },
    createProduct: (p) => one("POST", "products", p),
    updateProduct: (id, p) => one("PATCH", `products?id=eq.${enc(id)}`, p),

    createVariant: (productId, p) => one("POST", "product_variants", { ...p, product_id: productId }),
    updateVariant: (id, p) => one("PATCH", `product_variants?id=eq.${enc(id)}`, p),
    deleteVariant: (id) => json("DELETE", `product_variants?id=eq.${enc(id)}`),

    // Imagens: bucket fixo `product-images`.
    async uploadImage(productId, file, { altText = "", sortOrder = 0 } = {}) {
      const v = validateImageFile(file);
      if (!v.ok) throw new ApiError(400, { message: v.error });
      const path = buildStoragePath(productId, file.type);
      const up = await send(`${url}/storage/v1/object/${IMAGE_BUCKET}/${path}`, { method: "POST", headers: { "content-type": file.type, "x-upsert": "false", "cache-control": "max-age=31536000" }, body: file });
      if (!up.ok) throw new ApiError(up.status, await up.json().catch(() => ({ message: "upload_failed" })));
      try {
        return await one("POST", "product_images", { product_id: productId, storage_path: path, alt_text: altText || null, sort_order: sortOrder });
      } catch (e) {
        await send(`${url}/storage/v1/object/${IMAGE_BUCKET}/${path}`, { method: "DELETE" }).catch(() => {}); // evita arquivo órfão
        throw e;
      }
    },
    updateImage: (id, p) => one("PATCH", `product_images?id=eq.${enc(id)}`, p),
    /** Banco primeiro (a loja para de exibir), depois o arquivo. Falha no Storage => { orphan: true }, sem foto quebrada. */
    async deleteImage(image) {
      if (!isOwnStoragePath(image.storage_path, image.product_id)) throw new ApiError(400, { message: "invalid_storage_path" });
      await json("DELETE", `product_images?id=eq.${enc(image.id)}`);
      try {
        const r = await send(`${url}/storage/v1/object/${IMAGE_BUCKET}/${image.storage_path}`, { method: "DELETE" });
        return { orphan: !r.ok };
      } catch { return { orphan: true }; }
    },
    previewUrl: (path) => `${url}/storage/v1/object/public/${IMAGE_BUCKET}/${path.split("/").map(encodeURIComponent).join("/")}`,

    // Venda Rapida: leitura administrativa; baixa SOMENTE via RPC atomica e idempotente.
    listQuickSaleProducts: () => json("GET", "products?select=id,name,price_cents,active,product_variants(id,color,size,quantity,active)&order=name.asc"),
    listExternalSales: () => json("GET", "external_sales?select=id,channel,total_cents,created_at,external_sale_items(product_name,color,size,quantity,line_total_cents)&order=created_at.desc&limit=30"),
    registerExternalSale: (requestId, channel, items) => rpc("admin_register_external_sale",
      { p_request_id: requestId, p_channel: channel, p_items: items }),

    // Pedidos: leitura direta; escrita SOMENTE via RPC (ver orders.js).
    listOrders: (status) => json("GET", `orders?select=id,display_code,status,customer_name,created_at,subtotal_cents,shipping_cents,final_total_cents${status ? `&status=eq.${enc(status)}` : ""}&order=created_at.desc&limit=200`),
    async getOrder(id) {
      const rows = await json("GET", `orders?id=eq.${enc(id)}&select=*,order_items(*),order_status_history(*)`);
      return rows?.[0] ?? null;
    },

    getSettings: async () => (await json("GET", "store_settings?id=eq.true&select=*"))?.[0] ?? null,
    updateSettings: (p) => one("PATCH", "store_settings?id=eq.true", p),
  };
}

const enc = encodeURIComponent;
export const parseTotal = (cr) => { const m = /\/(\d+)$/.exec(cr ?? ""); return m ? Number(m[1]) : 0; };
