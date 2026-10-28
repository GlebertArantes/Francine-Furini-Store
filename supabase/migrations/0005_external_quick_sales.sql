-- Francine Furini Store: vendas externas com baixa transacional.
-- Aplicar somente no Supabase exclusivo txgatyftvtpkgqlncxju, apos revisar no PR.
-- Nao cria pedidos, nao altera historico de pedidos nem faz baixa na migracao.
begin;

create table public.external_sales (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  channel text not null check (channel in ('whatsapp','instagram','presencial','outro')),
  request_payload jsonb not null check (jsonb_typeof(request_payload) = 'array'),
  total_cents bigint not null default 0 check (total_cents >= 0),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table public.external_sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.external_sales(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  variant_id uuid not null references public.product_variants(id) on delete restrict,
  product_name text not null,
  color text not null,
  size text not null,
  quantity integer not null check (quantity between 1 and 100),
  unit_price_cents integer not null check (unit_price_cents > 0),
  line_total_cents bigint not null check (line_total_cents = quantity::bigint * unit_price_cents),
  created_at timestamptz not null default now()
);
create index external_sales_created_idx on public.external_sales(created_at desc);
create index external_sale_items_sale_idx on public.external_sale_items(sale_id);
create index external_sale_items_variant_idx on public.external_sale_items(variant_id);

alter table public.external_sales enable row level security;
alter table public.external_sale_items enable row level security;
revoke all on public.external_sales, public.external_sale_items from public, anon, authenticated;
grant select on public.external_sales, public.external_sale_items to authenticated;

create policy external_sales_admin_read on public.external_sales
for select to authenticated using ((select public.is_admin()));
create policy external_sale_items_admin_read on public.external_sale_items
for select to authenticated using ((select public.is_admin()));

-- Registro imutavel; somente o procedimento abaixo pode inserir.
-- Idempotencia por request_id evita baixa dupla ate em retry apos perda da resposta HTTP.
create or replace function public.admin_register_external_sale(
  p_request_id uuid, p_channel text, p_items jsonb
) returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  v_payload jsonb;
  v_sale_id uuid;
  v_existing public.external_sales;
  v_need record;
  v_row record;
  v_total bigint := 0;
  v_count integer;
begin
  perform private.assert_admin();
  if p_request_id is null
     or p_channel is null or p_channel not in ('whatsapp','instagram','presencial','outro')
     or p_items is null or jsonb_typeof(p_items) is distinct from 'array'
     or jsonb_array_length(p_items) not between 1 and 30 then
    raise exception 'invalid_external_sale' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) e(item)
    where jsonb_typeof(e.item) is distinct from 'object'
       or e.item->>'variant_id' is null
       or e.item->>'quantity' is null
       or not (case when (e.item->>'quantity') ~ '^[0-9]{1,3}
  ) then
    raise exception 'invalid_external_sale' using errcode = 'P0001';
  end if;

  -- Canonicaliza: ordem de itens e variantes repetidas nao afetam a idempotencia.
  select jsonb_agg(jsonb_build_object('variant_id', x.variant_id, 'quantity', x.qty)
                   order by x.variant_id)
    into v_payload
    from (
      select j.variant_id, sum(j.quantity)::integer as qty
      from jsonb_to_recordset(p_items) as j(variant_id uuid, quantity integer)
      group by j.variant_id
    ) x;
  if v_payload is null or exists (
    select 1 from jsonb_to_recordset(v_payload) as z(variant_id uuid,quantity integer)
    where z.variant_id is null or z.quantity not between 1 and 100
  ) then
    raise exception 'invalid_external_sale' using errcode = 'P0001';
  end if;

  insert into public.external_sales (request_id, channel, request_payload, created_by)
  values (p_request_id, p_channel, v_payload, auth.uid())
  on conflict (request_id) do nothing
  returning id into v_sale_id;

  if v_sale_id is null then
    select * into v_existing from public.external_sales
     where request_id = p_request_id for update;
    if not found then
      raise exception 'request_conflict' using errcode = 'P0001';
    end if;
    if v_existing.channel <> p_channel or v_existing.request_payload <> v_payload then
      raise exception 'request_conflict' using errcode = 'P0001';
    end if;
    return jsonb_build_object('sale_id', v_existing.id,
      'total_cents', v_existing.total_cents, 'already_done', true);
  end if;

  -- Bloqueia por ordem de UUID, como admin_complete_order: evita corrida e deadlocks.
  for v_need in
    select z.variant_id, z.quantity
    from jsonb_to_recordset(v_payload) as z(variant_id uuid, quantity integer)
    order by z.variant_id
  loop
    select v.id, v.quantity as available, v.active,
           v.product_id, v.color, v.size, p.name, p.price_cents
      into v_row
      from public.product_variants v
      join public.products p on p.id = v.product_id
      where v.id = v_need.variant_id
      for update of v;

    if not found or v_row.active is distinct from true then
      raise exception 'variant_unavailable' using errcode = 'P0001';
    end if;
    if v_row.available < v_need.quantity then
      raise exception 'insufficient_stock: %', v_row.name using errcode = 'P0001';
    end if;

    update public.product_variants
      set quantity = quantity - v_need.quantity
      where id = v_need.variant_id and active = true and quantity >= v_need.quantity;
    get diagnostics v_count = row_count;
    if v_count <> 1 then
      raise exception 'insufficient_stock' using errcode = 'P0001';
    end if;

    insert into public.external_sale_items
      (sale_id, product_id, variant_id, product_name, color, size, quantity,
       unit_price_cents, line_total_cents)
    values (v_sale_id, v_row.product_id, v_need.variant_id, v_row.name,
      v_row.color, v_row.size, v_need.quantity, v_row.price_cents,
      v_row.price_cents::bigint * v_need.quantity);

    v_total := v_total + v_row.price_cents::bigint * v_need.quantity;
  end loop;

  update public.external_sales set total_cents = v_total where id = v_sale_id;
  return jsonb_build_object('sale_id', v_sale_id, 'total_cents', v_total,
                            'already_done', false);
end;
$function$;

revoke all on function public.admin_register_external_sale(uuid,text,jsonb)
from public, anon, authenticated;
grant execute on function public.admin_register_external_sale(uuid,text,jsonb) to authenticated;
commit;

                    then (e.item->>'quantity')::integer between 1 and 100
                    else false end)
  ) then
    raise exception 'invalid_external_sale' using errcode = 'P0001';
  end if;

  -- Canonicaliza: ordem de itens e variantes repetidas nao afetam a idempotencia.
  select jsonb_agg(jsonb_build_object('variant_id', x.variant_id, 'quantity', x.qty)
                   order by x.variant_id)
    into v_payload
    from (
      select j.variant_id, sum(j.quantity)::integer as qty
      from jsonb_to_recordset(p_items) as j(variant_id uuid, quantity integer)
      group by j.variant_id
    ) x;
  if v_payload is null or exists (
    select 1 from jsonb_to_recordset(v_payload) as z(variant_id uuid,quantity integer)
    where z.variant_id is null or z.quantity not between 1 and 100
  ) then
    raise exception 'invalid_external_sale' using errcode = 'P0001';
  end if;

  insert into public.external_sales (request_id, channel, request_payload, created_by)
  values (p_request_id, p_channel, v_payload, auth.uid())
  on conflict (request_id) do nothing
  returning id into v_sale_id;

  if v_sale_id is null then
    select * into v_existing from public.external_sales
     where request_id = p_request_id for update;
    if not found then
      raise exception 'request_conflict' using errcode = 'P0001';
    end if;
    if v_existing.channel <> p_channel or v_existing.request_payload <> v_payload then
      raise exception 'request_conflict' using errcode = 'P0001';
    end if;
    return jsonb_build_object('sale_id', v_existing.id,
      'total_cents', v_existing.total_cents, 'already_done', true);
  end if;

  -- Bloqueia por ordem de UUID, como admin_complete_order: evita corrida e deadlocks.
  for v_need in
    select z.variant_id, z.quantity
    from jsonb_to_recordset(v_payload) as z(variant_id uuid, quantity integer)
    order by z.variant_id
  loop
    select v.id, v.quantity as available, v.active,
           v.product_id, v.color, v.size, p.name, p.price_cents
      into v_row
      from public.product_variants v
      join public.products p on p.id = v.product_id
      where v.id = v_need.variant_id
      for update of v;

    if not found or v_row.active is distinct from true then
      raise exception 'variant_unavailable' using errcode = 'P0001';
    end if;
    if v_row.available < v_need.quantity then
      raise exception 'insufficient_stock: %', v_row.name using errcode = 'P0001';
    end if;

    update public.product_variants
      set quantity = quantity - v_need.quantity
      where id = v_need.variant_id and active = true and quantity >= v_need.quantity;
    get diagnostics v_count = row_count;
    if v_count <> 1 then
      raise exception 'insufficient_stock' using errcode = 'P0001';
    end if;

    insert into public.external_sale_items
      (sale_id, product_id, variant_id, product_name, color, size, quantity,
       unit_price_cents, line_total_cents)
    values (v_sale_id, v_row.product_id, v_need.variant_id, v_row.name,
      v_row.color, v_row.size, v_need.quantity, v_row.price_cents,
      v_row.price_cents::bigint * v_need.quantity);

    v_total := v_total + v_row.price_cents::bigint * v_need.quantity;
  end loop;

  update public.external_sales set total_cents = v_total where id = v_sale_id;
  return jsonb_build_object('sale_id', v_sale_id, 'total_cents', v_total,
                            'already_done', false);
end;
$function$;

revoke all on function public.admin_register_external_sale(uuid,text,jsonb)
from public, anon, authenticated;
grant execute on function public.admin_register_external_sale(uuid,text,jsonb) to authenticated;
commit;
