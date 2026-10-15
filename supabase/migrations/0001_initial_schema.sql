-- Francine Furini Store — schema inicial V1
-- Projeto Supabase EXCLUSIVO. Nenhum tenant_id é necessário.

begin;

create extension if not exists pgcrypto;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- Reduz a chance de exposição acidental de novos objetos no Data API.
alter default privileges for role postgres in schema public
  revoke select, insert, update, delete on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke usage, select on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Administração
-- ---------------------------------------------------------------------------

create table private.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from private.admin_users a
    where a.user_id = auth.uid()
  );
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Catálogo
-- ---------------------------------------------------------------------------

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 80),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references public.categories(id) on delete set null,
  sku text unique,
  name text not null check (length(trim(name)) between 1 and 160),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  description text,
  fabric text,
  price_cents integer not null check (price_cents > 0),
  compare_at_price_cents integer,
  featured boolean not null default false,
  active boolean not null default true,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_compare_price_check check (
    compare_at_price_cents is null
    or compare_at_price_cents >= price_cents
  )
);

create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  sku text unique,
  color text not null check (length(trim(color)) between 1 and 80),
  size text not null check (length(trim(size)) between 1 and 40),
  quantity integer not null default 0 check (quantity >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index product_variants_product_color_size_uidx
  on public.product_variants (
    product_id,
    lower(trim(color)),
    lower(trim(size))
  );

create table public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  storage_path text not null unique,
  alt_text text,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index products_category_idx on public.products(category_id);
create index products_active_featured_idx on public.products(active, featured);
create index product_variants_product_idx on public.product_variants(product_id);
create index product_images_product_sort_idx on public.product_images(product_id, sort_order);

-- ---------------------------------------------------------------------------
-- Pedidos / solicitações
-- ---------------------------------------------------------------------------

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  display_code text unique,
  status text not null default 'pending_shipping'
    check (status in ('pending_shipping', 'contacted', 'completed', 'cancelled')),

  customer_name text not null check (length(trim(customer_name)) between 2 and 160),
  customer_phone text not null check (length(trim(customer_phone)) between 10 and 20),
  postal_code text not null check (postal_code ~ '^\d{8}$'),
  address_line text not null check (length(trim(address_line)) between 2 and 220),
  address_number text not null check (length(trim(address_number)) between 1 and 30),
  address_complement text,
  neighborhood text not null check (length(trim(neighborhood)) between 1 and 120),
  city text not null check (length(trim(city)) between 1 and 120),
  state text not null check (state ~ '^[A-Z]{2}$'),
  customer_note text,

  subtotal_cents integer not null check (subtotal_cents >= 0),
  shipping_cents integer check (shipping_cents is null or shipping_cents >= 0),
  final_total_cents integer check (final_total_cents is null or final_total_cents >= 0),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  contacted_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz
);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  variant_id uuid not null references public.product_variants(id) on delete restrict,
  product_name text not null,
  color text not null,
  size text not null,
  quantity integer not null check (quantity > 0),
  unit_price_cents integer not null check (unit_price_cents > 0),
  line_total_cents integer not null check (line_total_cents > 0),
  created_at timestamptz not null default now()
);

create table public.order_status_history (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  from_status text,
  to_status text not null,
  changed_by uuid references auth.users(id) on delete set null,
  note text,
  created_at timestamptz not null default now()
);

create index orders_status_created_idx on public.orders(status, created_at desc);
create index order_items_order_idx on public.order_items(order_id);
create index order_status_history_order_idx on public.order_status_history(order_id, created_at);

-- ---------------------------------------------------------------------------
-- Configurações públicas mínimas
-- ---------------------------------------------------------------------------

create table public.store_settings (
  id boolean primary key default true check (id = true),
  store_name text not null default 'Francine Furini Store',
  instagram_url text,
  whatsapp_number text,
  announcement_text text,
  updated_at timestamptz not null default now()
);

insert into public.store_settings (id)
values (true)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger categories_set_updated_at
before update on public.categories
for each row execute function private.set_updated_at();

create trigger products_set_updated_at
before update on public.products
for each row execute function private.set_updated_at();

create trigger product_variants_set_updated_at
before update on public.product_variants
for each row execute function private.set_updated_at();

create trigger orders_set_updated_at
before update on public.orders
for each row execute function private.set_updated_at();

create trigger store_settings_set_updated_at
before update on public.store_settings
for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.product_variants enable row level security;
alter table public.product_images enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_status_history enable row level security;
alter table public.store_settings enable row level security;

-- Leitura pública somente do catálogo publicado/ativo.
grant select on public.categories, public.products, public.product_variants, public.product_images, public.store_settings to anon, authenticated;

create policy categories_public_read
on public.categories for select
to anon, authenticated
using (active = true);

create policy products_public_read
on public.products for select
to anon, authenticated
using (active = true and (published_at is null or published_at <= now()));

create policy product_variants_public_read
on public.product_variants for select
to anon, authenticated
using (
  active = true
  and exists (
    select 1
    from public.products p
    where p.id = product_variants.product_id
      and p.active = true
      and (p.published_at is null or p.published_at <= now())
  )
);

create policy product_images_public_read
on public.product_images for select
to anon, authenticated
using (
  active = true
  and exists (
    select 1
    from public.products p
    where p.id = product_images.product_id
      and p.active = true
      and (p.published_at is null or p.published_at <= now())
  )
);

create policy store_settings_public_read
on public.store_settings for select
to anon, authenticated
using (true);

-- Admin autenticado: acesso CRUD ao catálogo/configurações.
grant select, insert, update, delete on public.categories, public.products, public.product_variants, public.product_images, public.store_settings to authenticated;
grant select, update on public.orders to authenticated;
grant select on public.order_items, public.order_status_history to authenticated;

create policy categories_admin_all
on public.categories for all
to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

create policy products_admin_all
on public.products for all
to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

create policy product_variants_admin_all
on public.product_variants for all
to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

create policy product_images_admin_all
on public.product_images for all
to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

create policy store_settings_admin_all
on public.store_settings for all
to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

create policy orders_admin_select
on public.orders for select
to authenticated
using ((select public.is_admin()));

create policy orders_admin_update
on public.orders for update
to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

create policy order_items_admin_select
on public.order_items for select
to authenticated
using ((select public.is_admin()));

create policy order_status_history_admin_select
on public.order_status_history for select
to authenticated
using ((select public.is_admin()));

-- Sem INSERT público direto em orders/order_items. A criação será server-side.
-- Sem DELETE direto de pedidos pelo painel nesta primeira versão.

commit;
