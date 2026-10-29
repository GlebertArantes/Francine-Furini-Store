-- Entrega Francine: controles aditivos, sem modificar saldos/pedidos existentes.
begin;
alter table public.product_variants add column stock_version bigint not null default 0;
create function private.bump_stock_version() returns trigger language plpgsql set search_path='' as $$
begin
  new.stock_version := old.stock_version + case when new.quantity is distinct from old.quantity then 1 else 0 end;
  return new;
end; $$;
create trigger variants_stock_version before update on public.product_variants for each row execute function private.bump_stock_version();
-- Cadastro não tem autoridade para escrever saldo. RPCs de venda continuam transacionais.
revoke update on public.product_variants from authenticated;
grant update(color,size,sku,active) on public.product_variants to authenticated;
create table public.stock_adjustments (
 id uuid primary key, variant_id uuid not null references public.product_variants(id) on delete restrict,
 previous_quantity integer not null, quantity integer not null check(quantity>=0),
 expected_version bigint not null, reason text not null check(length(btrim(reason)) between 3 and 300),
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now()
);
create index stock_adjustments_variant_idx on public.stock_adjustments(variant_id,created_at desc);
alter table public.stock_adjustments enable row level security;
revoke all on public.stock_adjustments from public, anon, authenticated;
grant select on public.stock_adjustments to authenticated;
create policy stock_adjustments_admin_read on public.stock_adjustments for select to authenticated using ((select public.is_admin()));
create function public.admin_adjust_stock(p_request_id uuid,p_variant_id uuid,p_expected_version bigint,p_quantity integer,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.product_variants; a public.stock_adjustments;
begin
 perform private.assert_admin();
 if p_request_id is null or p_variant_id is null or p_expected_version is null or p_quantity is null or p_quantity<0 or p_quantity>1000000 or p_reason is null or length(btrim(p_reason)) not between 3 and 300 then raise exception 'invalid_stock_adjustment'; end if;
 perform pg_advisory_xact_lock(hashtextextended('ff:stock:'||p_request_id,0));
 select * into a from public.stock_adjustments where id=p_request_id;
 if found then
  if a.variant_id<>p_variant_id or a.quantity<>p_quantity or a.expected_version<>p_expected_version or a.reason<>btrim(p_reason) then raise exception 'request_conflict'; end if;
  return jsonb_build_object('already_done',true);
 end if;
 select * into v from public.product_variants where id=p_variant_id for update;
 if not found then raise exception 'variant_unavailable'; end if;
 if v.stock_version<>p_expected_version then raise exception 'stock_conflict' using errcode='40001'; end if;
 update public.product_variants set quantity=p_quantity where id=p_variant_id;
 insert into public.stock_adjustments(id,variant_id,previous_quantity,quantity,expected_version,reason,created_by)
 values(p_request_id,p_variant_id,v.quantity,p_quantity,p_expected_version,btrim(p_reason),auth.uid());
 return jsonb_build_object('already_done',false);
end; $$;
revoke all on function public.admin_adjust_stock(uuid,uuid,bigint,integer,text) from public,anon,authenticated;
grant execute on function public.admin_adjust_stock(uuid,uuid,bigint,integer,text) to authenticated;

create table private.order_attempts (
 request_id uuid primary key, fingerprint text not null,
 order_id uuid not null references public.orders(id) on delete restrict, created_at timestamptz not null default now()
);
alter table private.order_attempts enable row level security;
revoke all on private.order_attempts from public,anon,authenticated;
create function public.recover_order_request(p_request_id uuid) returns jsonb
language sql security definer set search_path='' as $$
 select jsonb_build_object('order_id',o.id,'display_code',o.display_code,'status',o.status)
 from private.order_attempts a join public.orders o on o.id=a.order_id where a.request_id=p_request_id;
$$;
create function public.create_order_request_idempotent(p_request_id uuid,p_customer jsonb,p_items jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a private.order_attempts; f text; r jsonb; canonical jsonb;
begin
 if p_request_id is null then raise exception 'invalid_request'; end if;
 -- A Edge normaliza a cliente e as linhas; ordenação não muda a tentativa.
 select jsonb_agg(x order by x->>'variant_id') into canonical from jsonb_array_elements(p_items) x;
 f:=md5(jsonb_build_object('customer',p_customer,'items',canonical)::text);
 perform pg_advisory_xact_lock(hashtextextended('ff:order:'||p_request_id,0));
 select * into a from private.order_attempts where request_id=p_request_id;
 if found then
  if a.fingerprint<>f then raise exception 'request_conflict'; end if;
  return public.recover_order_request(p_request_id);
 end if;
 r:=public.create_order_request(p_customer,canonical);
 insert into private.order_attempts(request_id,fingerprint,order_id) values(p_request_id,f,(r->>'order_id')::uuid);
 return r;
end; $$;
revoke all on function public.recover_order_request(uuid),public.create_order_request_idempotent(uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.recover_order_request(uuid),public.create_order_request_idempotent(uuid,jsonb,jsonb) to service_role;

create function public.admin_save_order_note(p_order_id uuid,p_note text,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.orders;
begin
 perform private.assert_admin();
 if p_request_id is null or p_note is null or length(btrim(p_note)) not between 1 and 500 then raise exception 'invalid_note'; end if;
 select * into o from public.orders where id=p_order_id for update;
 if not found then raise exception 'order_not_found'; end if;
 if exists(select 1 from public.order_status_history where id=p_request_id and order_id=p_order_id and note=btrim(p_note)) then return jsonb_build_object('already_done',true); end if;
 insert into public.order_status_history(id,order_id,from_status,to_status,changed_by,note)
 values(p_request_id,o.id,o.status,o.status,auth.uid(),btrim(p_note));
 return jsonb_build_object('already_done',false);
end; $$;
revoke all on function public.admin_save_order_note(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.admin_save_order_note(uuid,text,uuid) to authenticated;
-- Sequência diária pode crescer além de 999 sem truncamento.
create or replace function private.next_order_code() returns text language plpgsql security definer set search_path='' as $$
declare v_day date:=(now() at time zone 'America/Sao_Paulo')::date; v_seq integer;
begin
 insert into private.order_code_counters as c(day,last_seq) values(v_day,1)
 on conflict(day) do update set last_seq=c.last_seq+1 returning last_seq into v_seq;
 return 'FF-'||to_char(v_day,'DDMMYY')||'-'||lpad(v_seq::text,greatest(3,length(v_seq::text)),'0');
end; $$;
-- Mantém links já divulgados após corrigir slugs do catálogo.
alter table public.products add column previous_slugs text[] not null default '{}';
create function private.preserve_product_slug() returns trigger language plpgsql set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('ff:product-slugs',0));
 if exists(select 1 from public.products p where p.id<>new.id and (p.slug=new.slug or new.slug=any(p.previous_slugs))) then raise exception 'slug_in_use' using errcode='23505'; end if;
 if tg_op='INSERT' then new.previous_slugs:='{}';
 else
  new.previous_slugs:=old.previous_slugs;
  if old.slug<>new.slug then new.previous_slugs:=array_append(array_remove(old.previous_slugs,new.slug),old.slug); end if;
 end if;
 return new;
end; $$;
create trigger preserve_product_slug before insert or update on public.products for each row execute function private.preserve_product_slug();
commit;
