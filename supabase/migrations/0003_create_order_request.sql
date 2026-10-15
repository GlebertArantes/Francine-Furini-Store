-- Francine Furini Store — criação de solicitação (RPC interna da Edge Function create-order)
-- Executável SOMENTE por service_role: o navegador nunca chama esta função direto.

begin;

create or replace function public.create_order_request(p_customer jsonb, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_max_lines constant integer := 30;
  c_max_qty constant integer := 20;
  c_max_per_hour constant integer := 5;

  v_phone text;
  v_postal text;
  v_state text;
  v_name text;
  v_req jsonb;
  v_lines jsonb;
  v_unavailable jsonb := '[]'::jsonb;
  v_subtotal bigint := 0;
  v_order_id uuid;
  v_code text;
begin
  if jsonb_typeof(p_customer) is distinct from 'object' then
    raise exception 'invalid_customer' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array'
     or jsonb_array_length(p_items) not between 1 and c_max_lines then
    raise exception 'invalid_items' using errcode = 'P0001';
  end if;

  -- Normalização (a Edge Function também normaliza; aqui é a última barreira).
  v_name := btrim(regexp_replace(coalesce(p_customer->>'name', ''), '\s+', ' ', 'g'));
  v_phone := regexp_replace(coalesce(p_customer->>'phone', ''), '\D', '', 'g');
  if length(v_phone) in (12, 13) and left(v_phone, 2) = '55' then
    v_phone := substr(v_phone, 3);
  end if;
  v_postal := regexp_replace(coalesce(p_customer->>'postal_code', ''), '\D', '', 'g');
  v_state := upper(btrim(coalesce(p_customer->>'state', '')));

  if length(v_name) not between 2 and 160 then raise exception 'invalid_customer: name' using errcode = 'P0001'; end if;
  if v_phone !~ '^\d{10,11}$' then raise exception 'invalid_customer: phone' using errcode = 'P0001'; end if;
  if v_postal !~ '^\d{8}$' then raise exception 'invalid_customer: postal_code' using errcode = 'P0001'; end if;
  if v_state !~ '^[A-Z]{2}$' then raise exception 'invalid_customer: state' using errcode = 'P0001'; end if;

  -- Lê somente variant_id + quantity; qualquer preço/nome enviado é ignorado.
  begin
    select jsonb_agg(jsonb_build_object('variant_id', (e->>'variant_id')::uuid, 'qty', (e->>'quantity')::integer))
      into v_req
      from jsonb_array_elements(p_items) e;
  exception when others then
    raise exception 'invalid_items' using errcode = 'P0001';
  end;

  if exists (
    select 1 from jsonb_to_recordset(v_req) as r(variant_id uuid, qty integer)
     where variant_id is null or qty is null or qty < 1 or qty > c_max_qty
  ) then
    raise exception 'invalid_items: quantity' using errcode = 'P0001';
  end if;

  -- Limite por telefone (barreira de abuso no banco; IP/captcha ficam na Edge Function).
  if (select count(*) from public.orders o
       where o.customer_phone = v_phone and o.created_at > now() - interval '1 hour') >= c_max_per_hour then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  -- Variantes repetidas são somadas; estoque é conferido, NÃO reservado.
  -- Preço, nome, cor e tamanho vêm do banco (snapshot gravado em order_items).
  select coalesce(jsonb_agg(jsonb_build_object(
           'variant_id', v.id, 'qty', r.qty, 'product_id', p.id, 'product_name', p.name,
           'color', v.color, 'size', v.size, 'unit_price', p.price_cents, 'stock', v.quantity)), '[]'::jsonb)
    into v_lines
    from (select variant_id, sum(qty)::integer as qty
            from jsonb_to_recordset(v_req) as q(variant_id uuid, qty integer)
           group by variant_id) r
    join public.product_variants v on v.id = r.variant_id and v.active
    join public.products p on p.id = v.product_id
     and p.active and (p.published_at is null or p.published_at <= now());

  select coalesce(jsonb_agg(jsonb_build_object('variant_id', r.variant_id, 'reason', 'not_found')), '[]'::jsonb)
    into v_unavailable
    from (select distinct variant_id
            from jsonb_to_recordset(v_req) as q(variant_id uuid, qty integer)) r
   where not exists (
     select 1 from jsonb_to_recordset(v_lines) as l(variant_id uuid) where l.variant_id = r.variant_id);
  if jsonb_array_length(v_unavailable) > 0 then
    raise exception 'variant_unavailable' using errcode = 'P0001', detail = v_unavailable::text;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'variant_id', l.variant_id, 'requested', l.qty, 'available', l.stock)), '[]'::jsonb)
    into v_unavailable
    from jsonb_to_recordset(v_lines) as l(variant_id uuid, qty integer, stock integer)
   where l.stock < l.qty;
  if jsonb_array_length(v_unavailable) > 0 then
    raise exception 'insufficient_stock' using errcode = 'P0001', detail = v_unavailable::text;
  end if;

  select sum(l.qty::bigint * l.unit_price) into v_subtotal
    from jsonb_to_recordset(v_lines) as l(qty integer, unit_price integer);
  if v_subtotal > 2000000000 then
    raise exception 'invalid_items: total' using errcode = 'P0001';
  end if;

  v_code := private.next_order_code();
  perform set_config('app.order_rpc', 'on', true);

  insert into public.orders (
    display_code, status, customer_name, customer_phone, postal_code, address_line,
    address_number, address_complement, neighborhood, city, state, customer_note, subtotal_cents
  ) values (
    v_code, 'pending_shipping', v_name, v_phone, v_postal,
    btrim(coalesce(p_customer->>'address_line', '')),
    btrim(coalesce(p_customer->>'address_number', '')),
    nullif(btrim(coalesce(p_customer->>'address_complement', '')), ''),
    btrim(coalesce(p_customer->>'neighborhood', '')),
    btrim(coalesce(p_customer->>'city', '')),
    v_state,
    nullif(left(btrim(coalesce(p_customer->>'note', '')), 500), ''),
    v_subtotal::integer
  ) returning id into v_order_id;

  insert into public.order_items (
    order_id, product_id, variant_id, product_name, color, size, quantity, unit_price_cents, line_total_cents
  )
  select v_order_id, l.product_id, l.variant_id, l.product_name, l.color, l.size, l.qty, l.unit_price, l.qty * l.unit_price
    from jsonb_to_recordset(v_lines) as l(
      variant_id uuid, qty integer, product_id uuid, product_name text, color text, size text, unit_price integer);

  insert into public.order_status_history (order_id, from_status, to_status, changed_by, note)
  values (v_order_id, null, 'pending_shipping', null, 'Solicitação criada pela loja');

  return jsonb_build_object('order_id', v_order_id, 'display_code', v_code, 'status', 'pending_shipping');
end;
$$;

revoke all on function public.create_order_request(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.create_order_request(jsonb, jsonb) to service_role;

commit;
