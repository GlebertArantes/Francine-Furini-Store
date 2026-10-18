\set QUIET on
\ir helpers.sql
set client_min_messages = notice;

-- =====================================================================================
-- A) Auditoria de catálogo do banco: RLS, grants e SECURITY DEFINER (não depende de dados)
-- =====================================================================================
do $$
declare t record; f record; n int;
  catalog_tables text[] := array['categories','products','product_variants','product_images','store_settings'];
  order_tables text[] := array['orders','order_items','order_status_history'];
begin
  -- RLS ligada em TODAS as tabelas do schema public
  select count(*) into n from pg_class c join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
  perform pg_temp.ok('RLS habilitada em todas as tabelas public', n = 0);

  for t in select c.relname from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'public' and c.relkind = 'r' loop
    perform pg_temp.ok('anon sem escrita em ' || t.relname,
      not (has_table_privilege('anon', 'public.' || t.relname, 'insert') or has_table_privilege('anon', 'public.' || t.relname, 'update')
        or has_table_privilege('anon', 'public.' || t.relname, 'delete') or has_table_privilege('anon', 'public.' || t.relname, 'truncate')));
    if t.relname = any(catalog_tables) then
      perform pg_temp.ok('anon lê somente o catálogo: ' || t.relname, has_table_privilege('anon', 'public.' || t.relname, 'select'));
    else
      perform pg_temp.ok('anon NÃO lê ' || t.relname, not has_table_privilege('anon', 'public.' || t.relname, 'select'));
    end if;
  end loop;

  for t in select unnest(order_tables) as relname loop
    perform pg_temp.ok('authenticated só lê ' || t.relname,
      has_table_privilege('authenticated', 'public.' || t.relname, 'select')
      and not (has_table_privilege('authenticated', 'public.' || t.relname, 'insert') or has_table_privilege('authenticated', 'public.' || t.relname, 'update')
            or has_table_privilege('authenticated', 'public.' || t.relname, 'delete') or has_table_privilege('authenticated', 'public.' || t.relname, 'truncate')));
  end loop;

  -- SECURITY DEFINER: ninguém além do necessário pode executar
  for f in select p.oid, p.proname, p.prosecdef from pg_proc p join pg_namespace s on s.oid = p.pronamespace
            where s.nspname = 'public' and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e') /* ignora funções de extensões (pgcrypto) */ loop
    perform pg_temp.ok('anon não executa public.' || f.proname, not has_function_privilege('anon', f.oid, 'execute'));
    if f.proname like 'admin\_%' or f.proname = 'is_admin' then
      perform pg_temp.ok('authenticated executa (e a função valida admin) ' || f.proname, has_function_privilege('authenticated', f.oid, 'execute'));
    else
      perform pg_temp.ok('authenticated NÃO executa public.' || f.proname, not has_function_privilege('authenticated', f.oid, 'execute'));
    end if;
  end loop;
  perform pg_temp.ok('create_order_request só para service_role',
    has_function_privilege('service_role', 'public.create_order_request(jsonb,jsonb)', 'execute')
    and not has_function_privilege('anon', 'public.create_order_request(jsonb,jsonb)', 'execute')
    and not has_function_privilege('authenticated', 'public.create_order_request(jsonb,jsonb)', 'execute'));
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname like 'admin\_%' and not p.prosecdef;
  perform pg_temp.ok('RPCs admin_* são SECURITY DEFINER com search_path fixo', n = 0
    and not exists (select 1 from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.prosecdef
                      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
                      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')));

  -- schema private fechado
  perform pg_temp.ok('private fechado para anon/authenticated', not has_schema_privilege('anon', 'private', 'usage') and not has_schema_privilege('authenticated', 'private', 'usage'));
  perform pg_temp.ok('admin_users inacessível', not has_table_privilege('authenticated', 'private.admin_users', 'select'));

  -- Storage: toda policy de escrita em storage.objects exige admin
  select count(*) into n from pg_policies where schemaname = 'storage' and tablename = 'objects' and cmd in ('INSERT','UPDATE','DELETE') and coalesce(qual,'') || coalesce(with_check,'') not like '%is_admin%';
  perform pg_temp.ok('policies de escrita no Storage exigem is_admin', n = 0 and exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and cmd = 'INSERT'));
  perform pg_temp.ok('bucket product-images público para leitura e restrito a imagens ≤ 8 MB',
    (select public and file_size_limit = 8388608 and allowed_mime_types @> array['image/jpeg','image/png','image/webp','image/avif'] and not ('image/svg+xml' = any(allowed_mime_types)) and not ('text/html' = any(allowed_mime_types))
       from storage.buckets where id = 'product-images'));
end $$;

-- =====================================================================================
-- B) Ciclo de pedidos: cenários críticos adicionais
-- =====================================================================================
insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000c3') on conflict do nothing;
insert into private.admin_users (user_id) values ('00000000-0000-0000-0000-0000000000c3') on conflict do nothing;
insert into public.products (id, name, slug, price_cents, published_at) values
  ('50000000-0000-0000-0000-000000000001', 'Auditoria A', 'auditoria-a', 10000, null),
  ('50000000-0000-0000-0000-000000000002', 'Auditoria B', 'auditoria-b', 20000, null),
  ('50000000-0000-0000-0000-000000000003', 'Auditoria Futura', 'auditoria-futura', 30000, now() + interval '30 days');
insert into public.product_variants (id, product_id, color, size, quantity) values
  ('60000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 'Nude', 'M', 5),
  ('60000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000002', 'Preto', 'G', 5),
  ('60000000-0000-0000-0000-000000000003', '50000000-0000-0000-0000-000000000003', 'Nude', 'P', 5);

do $$
declare
  adm uuid := '00000000-0000-0000-0000-0000000000c3';
  c text := '{"name":"Aud Ita","phone":"%s","postal_code":"38000000","address_line":"Rua X","address_number":"1","neighborhood":"B","city":"C","state":"MG"}';
  r jsonb; o1 uuid; o2 uuid; o3 uuid; e text; d text;
  va uuid := '60000000-0000-0000-0000-000000000001'; vb uuid := '60000000-0000-0000-0000-000000000002';
begin
  perform set_config('request.jwt.claims', json_build_object('sub', adm)::text, true);

  -- produto com publicação futura não pode ser comprado
  perform pg_temp.ok('produto com publicação futura é rejeitado', pg_temp.try_as('service_role', null,
    format($q$select public.create_order_request('%s','[{"variant_id":"60000000-0000-0000-0000-000000000003","quantity":1}]')$q$, format(c, '34911000001'))) = 'variant_unavailable');

  -- snapshot de preço: mudar o preço do produto depois NÃO altera o pedido
  r := public.create_order_request(format(c, '34911000002')::jsonb, format('[{"variant_id":"%s","quantity":2},{"variant_id":"%s","quantity":1}]', va, vb)::jsonb);
  o1 := (r->>'order_id')::uuid;
  update public.products set price_cents = 99900 where id = '50000000-0000-0000-0000-000000000001';
  perform pg_temp.ok('subtotal do pedido é snapshot (2×100 + 1×200 = 400,00)', (select subtotal_cents from public.orders where id = o1) = 40000);
  perform pg_temp.ok('itens guardam preço/nome do momento do pedido', (select unit_price_cents = 10000 and product_name = 'Auditoria A' from public.order_items where order_id = o1 and variant_id = va));
  perform pg_temp.ok('criar pedido não baixa estoque', (select quantity from public.product_variants where id = va) = 5 and (select quantity from public.product_variants where id = vb) = 5);

  -- frete: inválido / repetido recalcula / fora de pedido aberto
  perform pg_temp.ok('frete negativo rejeitado', pg_temp.try_as('authenticated', adm, format($q$select public.admin_set_order_shipping('%s', -1)$q$, o1)) = 'invalid_shipping');
  perform pg_temp.ok('frete nulo rejeitado', pg_temp.try_as('authenticated', adm, format($q$select public.admin_set_order_shipping('%s', null)$q$, o1)) = 'invalid_shipping');
  perform public.admin_set_order_shipping(o1, 3000);
  perform public.admin_set_order_shipping(o1, 0);
  perform pg_temp.ok('frete pode ser atualizado e R$ 0,00 é válido (total = subtotal)', (select shipping_cents = 0 and final_total_cents = subtotal_cents from public.orders where id = o1));
  perform pg_temp.ok('conta de total final = subtotal + frete', (public.admin_set_order_shipping(o1, 1550)->>'final_total_cents')::int = 41550);

  -- contato → cancelar (estoque intacto) → nada mais é permitido
  perform public.admin_mark_order_contacted(o1, 'ligou');
  r := public.admin_cancel_order(o1, 'desistiu');
  perform pg_temp.ok('cancelar pedido contatado não altera estoque', (select quantity from public.product_variants where id = va) = 5 and (select quantity from public.product_variants where id = vb) = 5);
  perform pg_temp.ok('histórico completo do pedido (criado → contatado → cancelado) com autor',
    (select array_agg(to_status order by to_status) from public.order_status_history where order_id = o1) = array['cancelled','contacted','pending_shipping'] /* mesma transação: created_at igual */
    and (select changed_by from public.order_status_history where order_id = o1 and to_status = 'cancelled') = adm
    and (select note from public.order_status_history where order_id = o1 and to_status = 'cancelled') = 'desistiu');
  perform pg_temp.ok('cancelado não volta a contatado', pg_temp.try_as('authenticated', adm, format($q$select public.admin_mark_order_contacted('%s')$q$, o1)) like 'invalid_transition%');
  perform pg_temp.ok('cancelado não aceita frete', pg_temp.try_as('authenticated', adm, format($q$select public.admin_set_order_shipping('%s', 100)$q$, o1)) like 'order_not_open%');

  -- conclusão com falta em MAIS de um item: tudo é informado e nada é baixado
  r := public.create_order_request(format(c, '34911000003')::jsonb, format('[{"variant_id":"%s","quantity":3},{"variant_id":"%s","quantity":3}]', va, vb)::jsonb);
  o2 := (r->>'order_id')::uuid;
  perform public.admin_set_order_shipping(o2, 500);
  update public.product_variants set quantity = 1 where id in (va, vb);
  begin perform public.admin_complete_order(o2); exception when others then e := sqlerrm; get stacked diagnostics d = pg_exception_detail; end;
  perform pg_temp.ok('falta de estoque em 2 itens: erro e detalhe com os 2 itens', e = 'insufficient_stock' and jsonb_array_length(d::jsonb) = 2);
  perform pg_temp.ok('nenhuma baixa parcial e pedido segue aberto', (select sum(quantity) from public.product_variants where id in (va, vb)) = 2 and (select status from public.orders where id = o2) = 'pending_shipping');
  update public.product_variants set quantity = 3 where id in (va, vb);
  perform public.admin_complete_order(o2);
  perform pg_temp.ok('conclusão baixa exatamente 3+3 (3→0)', (select sum(quantity) from public.product_variants where id in (va, vb)) = 0);
  perform pg_temp.ok('após concluir o total financeiro permanece o do momento da criação (preço de A já era 999,00)', (select subtotal_cents = 3*99900 + 3*20000 and final_total_cents = subtotal_cents + 500 from public.orders where id = o2));
  perform pg_temp.ok('concluído: itens e histórico imutáveis', pg_temp.try_as('postgres', null, format($q$update public.order_items set quantity = 99 where order_id = '%s'$q$, o2)) like 'immutable_table%');
  perform pg_temp.ok('concluído não aceita frete nem cancelamento', pg_temp.try_as('authenticated', adm, format($q$select public.admin_set_order_shipping('%s', 1)$q$, o2)) like 'order_not_open%'
    and pg_temp.try_as('authenticated', adm, format($q$select public.admin_cancel_order('%s')$q$, o2)) like 'invalid_transition%');
  perform pg_temp.ok('estoque nunca fica negativo (CHECK)', pg_temp.try_as('postgres', null, format($q$update public.product_variants set quantity = -1 where id = '%s'$q$, va)) like '%product_variants_quantity_check%');
  perform pg_temp.ok('variante usada em pedido não pode ser apagada (FK)', pg_temp.try_as('postgres', null, format($q$delete from public.product_variants where id = '%s'$q$, va)) like '%violates foreign key%');
  perform pg_temp.ok('admin não apaga pedidos', pg_temp.try_as('authenticated', adm, format($q$delete from public.orders where id = '%s'$q$, o2)) like 'permission denied%');
  perform pg_temp.ok('admin lê pedidos e histórico', pg_temp.try_as('authenticated', adm, 'select 1 / (select count(*) from public.orders)') is null);
end $$;
