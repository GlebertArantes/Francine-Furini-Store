// Acesso somente-leitura ao Supabase (PostgREST + Storage público) com a chave PUBLISHABLE.
// As policies RLS decidem o que é visível; aqui nada é filtrado por confiança.

const BUCKET = "product-images";

export function resolveConfig(cfg = {}) {
  const url = String(cfg.supabaseUrl ?? "").replace(/\/+$/, "");
  const key = String(cfg.supabasePublishableKey ?? "");
  if (!/^https:\/\/[^/]+$/.test(url) || !key) throw new Error("config_missing");
  return {
    supabaseUrl: url,
    key,
    createOrderUrl: cfg.createOrderUrl ? String(cfg.createOrderUrl) : `${url}/functions/v1/create-order`,
  };
}

export function createApi(config, fetchFn = fetch) {
  const { supabaseUrl, key } = config;
  const headers = { apikey: key, accept: "application/json" };

  async function get(path) {
    const res = await fetchFn(`${supabaseUrl}/rest/v1/${path}`, { headers });
    if (!res.ok) throw new Error(`api_${res.status}`);
    return res.json();
  }

  const imageUrl = (storagePath) =>
    storagePath ? `${supabaseUrl}/storage/v1/object/public/${BUCKET}/${storagePath.split("/").map(encodeURIComponent).join("/")}` : null;

  return {
    imageUrl,
    async getSettings() {
      const rows = await get("store_settings?select=store_name,instagram_url,whatsapp_number,announcement_text&limit=1");
      return rows[0] ?? {};
    },
    async getCategories() {
      return get("categories?select=id,name,slug,sort_order&order=sort_order.asc,name.asc");
    },
    async getProducts() {
      const rows = await get(
        "products?select=id,category_id,name,slug,previous_slugs,description,fabric,price_cents,compare_at_price_cents,featured,published_at," +
          "product_variants(id,color,size,quantity,active),product_images(storage_path,alt_text,sort_order)" +
          "&order=featured.desc,published_at.desc.nullslast,name.asc"
      );
      return rows.map(normalizeProduct);
    },
  };
}

export function normalizeProduct(row) {
  return {
    previous_slugs: row.previous_slugs ?? [],
    id: row.id, category_id: row.category_id, name: row.name, slug: row.slug,
    description: row.description ?? "", fabric: row.fabric ?? "",
    price_cents: row.price_cents, compare_at_price_cents: row.compare_at_price_cents ?? null,
    featured: !!row.featured,
    variants: (row.product_variants ?? []).map((v) => ({ id: v.id, color: v.color, size: v.size, quantity: v.quantity, active: v.active !== false })),
    images: [...(row.product_images ?? [])].sort((a, b) => a.sort_order - b.sort_order),
  };
}
