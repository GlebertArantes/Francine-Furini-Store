-- Francine Furini Store — Storage + hardening final da base V1
-- Aplicar após 0001, 0002 e 0003.

begin;

-- ---------------------------------------------------------------------------
-- 1. Índices adicionais sugeridos pelo Supabase Advisor
-- ---------------------------------------------------------------------------

create index if not exists order_items_product_idx
  on public.order_items(product_id);

create index if not exists order_status_history_changed_by_idx
  on public.order_status_history(changed_by)
  where changed_by is not null;

-- ---------------------------------------------------------------------------
-- 2. Evita policies permissivas duplicadas para authenticated
--
-- O storefront V1 é anônimo. Usuários autenticados existem apenas para o painel
-- administrativo, cuja leitura já é coberta pelas policies *_admin_all.
-- ---------------------------------------------------------------------------

alter policy categories_public_read
  on public.categories
  to anon;

alter policy products_public_read
  on public.products
  to anon;

alter policy product_variants_public_read
  on public.product_variants
  to anon;

alter policy product_images_public_read
  on public.product_images
  to anon;

alter policy store_settings_public_read
  on public.store_settings
  to anon;

-- ---------------------------------------------------------------------------
-- 3. Supabase Storage: fotos públicas de produto
-- ---------------------------------------------------------------------------

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'product-images',
  'product-images',
  true,
  8388608,
  array['image/jpeg', 'image/png', 'image/webp', 'image/avif']
)
on conflict (id) do update
set name = excluded.name,
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Metadados do bucket continuam protegidos; escrita só por admin autenticado.
drop policy if exists product_images_admin_select on storage.objects;
drop policy if exists product_images_admin_insert on storage.objects;
drop policy if exists product_images_admin_update on storage.objects;
drop policy if exists product_images_admin_delete on storage.objects;

create policy product_images_admin_select
on storage.objects for select
to authenticated
using (
  bucket_id = 'product-images'
  and (select public.is_admin())
);

create policy product_images_admin_insert
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'product-images'
  and (select public.is_admin())
);

create policy product_images_admin_update
on storage.objects for update
to authenticated
using (
  bucket_id = 'product-images'
  and (select public.is_admin())
)
with check (
  bucket_id = 'product-images'
  and (select public.is_admin())
);

create policy product_images_admin_delete
on storage.objects for delete
to authenticated
using (
  bucket_id = 'product-images'
  and (select public.is_admin())
);

-- ---------------------------------------------------------------------------
-- 4. Configuração pública inicial conhecida da loja
-- ---------------------------------------------------------------------------

update public.store_settings
set instagram_url = 'https://instagram.com/francinefurini_store',
    whatsapp_number = '5531995652798'
where id = true;

commit;
