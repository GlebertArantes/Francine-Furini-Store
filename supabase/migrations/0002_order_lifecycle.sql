-- Francine Furini Store — ciclo seguro de pedidos (Issue #1)
-- Auditoria + endurecimento do 0001, código comercial e RPCs administrativas.
-- NÃO aplicar em produção sem revisão (ver docs/AUDIT_ORDER_LIFECYCLE.md).

begin;

-- ---------------------------------------------------------------------------
-- 1. Privilégios: pedidos só são lidos pelo painel; toda escrita passa por RPC.
-- ---------------------------------------------------------------------------

revoke all on public.orders, public.order_items, public.order_status_history
  from public, anon, authenticated;
grant select on public.orders, public.order_items, public.order_status_history
  to authenticated;

-- Admin não faz UPDATE direto de pedido (era possível em 0001: status='completed').
drop policy if exists orders_admin_update on public.orders;

-- Revoga privilégios não usados (TRUNCATE/REFERENCES/TRIGGER) das tabelas do catálogo.
revoke all on public.categories, public.products, public.product_variants,
  public.product_images, public.store_settings from public, anon, authenticated;
grant select on public.categories, public.products, public.product_variants,
  public.product_images, public.store_settings to anon, authenticated;
grant insert, update, delete on public.categories, public.products,
  public.product_variants, public.product_images, public.store_settings to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Constraints / índices
-- ---------------------------------------------------------------------------

alter table public.orders
  alter column display_code set not null,
  add constraint orders_display_code_format
    check (display_code ~ '^FF-\d{6}-\d{3,}$'),
  add constraint orders_phone_digits
    check (customer_phone ~ '^\d{10,11}$'),
  add constraint orders_final_total_consistent
    check (
      final_total_cents is null
      or (shipping_cents is not null and final_total_cents = subtotal_cents + shipping_cents)
    ),
  add constraint orders_status_timestamps
    check (
      (status = 'completed') = (completed_at is not null)
      and (status = 'cancelled') = (cancelled_at is not null)
    );

alter table public.order_items
  add constraint order_items_line_total_check
    check (line_total_cents = quantity * unit_price_cents);

create index if not exists order_items_variant_idx on public.order_items(variant_id);
create index if not exists orders_phone_created_idx on public.orders(customer_phone, created_at desc);

-- ---------------------------------------------------------------------------
-- 3. Imutabilidade: itens e histórico são append-only; status só muda via RPC.
-- ---------------------------------------------------------------------------

create or replace function private.forbid_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'immutable_table: % não aceita UPDATE', tg_table_name
    using errcode = '42501';
end;
$$;

create trigger order_items_immutable
before update on public.order_items
for each row execute function private.forbid_update();

create trigger order_status_history_immutable
before update on public.order_status_history
for each row execute function private.forbid_update();

-- Defesa em profundidade (vale também para service_role/owner): campos de ciclo de
-- vida de orders só mudam dentro das RPCs, que ligam a flag transacional abaixo.
create or replace function private.guard_order_lifecycle()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('app.order_rpc', true), '') <> 'on'
     and (new.status is distinct from old.status
          or new.display_code is distinct from old.display_code
          or new.subtotal_cents is distinct from old.subtotal_cents
          or new.contacted_at is distinct from old.contacted_at
          or new.completed_at is distinct from old.completed_at
          or new.cancelled_at is distinct from old.cancelled_at
          or new.shipping_cents is distinct from old.shipping_cents
          or new.final_total_cents is distinct from old.final_total_cents) then
    raise exception 'order_lifecycle_via_rpc_only'
      using errcode = '42501',
            hint = 'Use as RPCs admin_* para alterar o ciclo do pedido.';
  end if;
  return new;
end;
$$;

create trigger orders_guard_lifecycle
before update on public.orders
for each row execute function private.guard_order_lifecycle();

-- ---------------------------------------------------------------------------
-- 4. Código comercial FF-DDMMYY-### (atômico)
-- ---------------------------------------------------------------------------

create table private.order_code_counters (
  day date primary key,
  last_seq integer not null
);

-- O INSERT ... ON CONFLICT DO UPDATE trava a linha do dia até o fim da transação
-- que cria o pedido: duas requisições simultâneas nunca recebem o mesmo número.
-- Rollback desfaz o incremento (sem buracos). Fuso: America/Sao_Paulo.
create or replace function private.next_order_code()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day date := (now() at time zone 'America/Sao_Paulo')::date;
  v_seq integer;
begin
  insert into private.order_code_counters as c (day, last_seq)
  values (v_day, 1)
  on conflict (day) do update set last_seq = c.last_seq + 1
  returning c.last_seq into v_seq;

  return 'FF-' || to_char(v_day, 'DDMMYY') || '-' || lpad(v_seq::text, 3, '0');
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. RPCs administrativas
-- ---------------------------------------------------------------------------

create or replace function private.assert_admin()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
end;
$$;

create or replace function private.lock_order(p_order_id uuid)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'order_not_found' using errcode = 'P0002';
  end if;
  perform set_config('app.order_rpc', 'on', true);
  return v_order;
end;
$$;

create or replace function public.admin_mark_order_contacted(p_order_id uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
begin
  perform private.assert_admin();
  v_order := private.lock_order(p_order_id);

  if v_order.status = 'contacted' then
    return jsonb_build_object('order_id', v_order.id, 'display_code', v_order.display_code,
                              'status', v_order.status, 'already_done', true);
  end if;
  if v_order.status <> 'pending_shipping' then
    raise exception 'invalid_transition: % -> contacted', v_order.status using errcode = 'P0001';
  end if;

  update public.orders set status = 'contacted', contacted_at = now() where id = v_order.id;
  insert into public.order_status_history (order_id, from_status, to_status, changed_by, note)
  values (v_order.id, v_order.status, 'contacted', auth.uid(), left(p_note, 500));

  return jsonb_build_object('order_id', v_order.id, 'display_code', v_order.display_code,
                            'status', 'contacted', 'already_done', false);
end;
$$;

create or replace function public.admin_cancel_order(p_order_id uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
begin
  perform private.assert_admin();
  v_order := private.lock_order(p_order_id);

  if v_order.status = 'cancelled' then
    return jsonb_build_object('order_id', v_order.id, 'display_code', v_order.display_code,
                              'status', v_order.status, 'already_done', true);
  end if;
  -- Venda concluída já baixou estoque; estorno não faz parte da V1.
  if v_order.status = 'completed' then
    raise exception 'invalid_transition: completed -> cancelled' using errcode = 'P0001';
  end if;

  update public.orders set status = 'cancelled', cancelled_at = now() where id = v_order.id;
  insert into public.order_status_history (order_id, from_status, to_status, changed_by, note)
  values (v_order.id, v_order.status, 'cancelled', auth.uid(), left(p_note, 500));

  return jsonb_build_object('order_id', v_order.id, 'display_code', v_order.display_code,
                            'status', 'cancelled', 'already_done', false);
end;
$$;

create or replace function public.admin_set_order_shipping(p_order_id uuid, p_shipping_cents integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
begin
  perform private.assert_admin();
  if p_shipping_cents is null or p_shipping_cents < 0 then
    raise exception 'invalid_shipping' using errcode = 'P0001';
  end if;
  v_order := private.lock_order(p_order_id);
  if v_order.status not in ('pending_shipping', 'contacted') then
    raise exception 'order_not_open: %', v_order.status using errcode = 'P0001';
  end if;

  update public.orders
     set shipping_cents = p_shipping_cents,
         final_total_cents = subtotal_cents + p_shipping_cents
   where id = v_order.id;

  return jsonb_build_object('order_id', v_order.id, 'display_code', v_order.display_code,
                            'shipping_cents', p_shipping_cents,
                            'final_total_cents', v_order.subtotal_cents + p_shipping_cents);
end;
$$;

-- Conclusão transacional e idempotente. Qualquer exceção desfaz TUDO (inclusive
-- baixas já feitas em itens anteriores do mesmo pedido).
create or replace function public.admin_complete_order(p_order_id uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_need record;
  v_stock integer;
  v_short jsonb := '[]'::jsonb;
begin
  perform private.assert_admin();
  v_order := private.lock_order(p_order_id);

  -- Retry/duplo clique: já concluído => não baixa de novo.
  if v_order.status = 'completed' then
    return jsonb_build_object('order_id', v_order.id, 'display_code', v_order.display_code,
                              'status', v_order.status, 'already_done', true);
  end if;
  if v_order.status not in ('pending_shipping', 'contacted') then
    raise exception 'invalid_transition: % -> completed', v_order.status using errcode = 'P0001';
  end if;

  -- Fluxo V1: calcular frete -> definir frete -> concluir. Frete 0 é válido (NOT NULL).
  if v_order.shipping_cents is null or v_order.final_total_cents is null then
    raise exception 'shipping_not_defined'
      using errcode = 'P0001',
            hint = 'Defina o frete com admin_set_order_shipping antes de concluir (R$ 0,00 é válido).';
  end if;

  -- Itens agregados por variante, travados em ordem de id (evita deadlock entre
  -- conclusões concorrentes que compartilham variantes).
  for v_need in
    select oi.variant_id, sum(oi.quantity)::integer as qty, min(oi.product_name) as product_name
      from public.order_items oi
     where oi.order_id = v_order.id
     group by oi.variant_id
     order by oi.variant_id
  loop
    select v.quantity into v_stock
      from public.product_variants v
     where v.id = v_need.variant_id
       for update;

    if not found or v_stock < v_need.qty then
      v_short := v_short || jsonb_build_object(
        'variant_id', v_need.variant_id,
        'product_name', v_need.product_name,
        'requested', v_need.qty,
        'available', coalesce(v_stock, 0));
    end if;
  end loop;

  if jsonb_array_length(v_short) > 0 then
    raise exception 'insufficient_stock' using errcode = 'P0001', detail = v_short::text;
  end if;

  update public.product_variants v
     set quantity = v.quantity - n.qty
    from (
      select oi.variant_id, sum(oi.quantity)::integer as qty
        from public.order_items oi
       where oi.order_id = v_order.id
       group by oi.variant_id
    ) n
   where v.id = n.variant_id;

  update public.orders set status = 'completed', completed_at = now() where id = v_order.id;
  insert into public.order_status_history (order_id, from_status, to_status, changed_by, note)
  values (v_order.id, v_order.status, 'completed', auth.uid(), left(p_note, 500));

  return jsonb_build_object('order_id', v_order.id, 'display_code', v_order.display_code,
                            'status', 'completed', 'already_done', false);
end;
$$;

-- Grants: somente authenticated (e a função valida is_admin internamente).
revoke all on function public.admin_mark_order_contacted(uuid, text),
  public.admin_cancel_order(uuid, text),
  public.admin_set_order_shipping(uuid, integer),
  public.admin_complete_order(uuid, text) from public, anon;
grant execute on function public.admin_mark_order_contacted(uuid, text),
  public.admin_cancel_order(uuid, text),
  public.admin_set_order_shipping(uuid, integer),
  public.admin_complete_order(uuid, text) to authenticated;

commit;
