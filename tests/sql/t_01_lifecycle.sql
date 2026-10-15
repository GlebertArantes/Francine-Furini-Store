\set QUIET on
\ir helpers.sql
set client_min_messages = notice;

-- Fixtures -------------------------------------------------------------------
insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000a1'),  -- admin
  ('00000000-0000-0000-0000-0000000000b2');  -- cliente logada, não-admin
insert into private.admin_users (user_id) values ('00000000-0000-0000-0000-0000000000a1');

insert into public.products (id, name, slug, price_cents) values
  ('10000000-0000-0000-0000-000000000001', 'Vestido Seda', 'vestido-seda', 29900),
  ('10000000-0000-0000-0000-000000000002', 'Blusa Linho', 'blusa-linho', 15000),
  ('10000000-0000-0000-0000-000000000003', 'Inativo', 'inativo', 10000);
update public.products set active = false where slug = 'inativo';
insert into public.product_variants (id, product_id, color, size, quantity) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Nude', 'M', 3),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'Off-white', '38', 1),
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000003', 'Preto', 'P', 5);
insert into public.product_variants (id, product_id, color, size, quantity, active) values
  ('20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', 'Nude', 'G', 5, false);


-- Criação --------------------------------------------------------------------
do $$
declare r jsonb; o public.orders; it public.order_items; e text;
  cust jsonb := '{"name":"  Maria   Silva ","phone":"(34) 99999-1234","postal_code":"38000-000","address_line":"Rua A","address_number":"10","neighborhood":"Centro","city":"Uberaba","state":"mg"}';
begin
  -- preço/nome falsos do navegador são ignorados
  r := public.create_order_request(cust, '[{"variant_id":"20000000-0000-0000-0000-000000000001","quantity":2,"price_cents":1,"unit_price_cents":1,"name":"Hack","product_name":"Hack"}]');
  select * into o from public.orders where id = (r->>'order_id')::uuid;
  select * into it from public.order_items where order_id = o.id;
  perform pg_temp.ok('resposta só tem order_id/display_code/status', (select array_agg(k order by k) from jsonb_object_keys(r) k) = array['display_code','order_id','status']);
  perform pg_temp.ok('status inicial pending_shipping', o.status = 'pending_shipping' and r->>'status' = 'pending_shipping');
  perform pg_temp.ok('preço falso ignorado (usa preço do banco)', it.unit_price_cents = 29900 and it.product_name = 'Vestido Seda');
  perform pg_temp.ok('subtotal recalculado no servidor', o.subtotal_cents = 59800 and it.line_total_cents = 59800);
  perform pg_temp.ok('código no formato FF-DDMMYY-###', o.display_code ~ ('^FF-' || to_char((now() at time zone 'America/Sao_Paulo')::date, 'DDMMYY') || '-001$'));
  perform pg_temp.ok('telefone/CEP/UF normalizados', o.customer_phone = '34999991234' and o.postal_code = '38000000' and o.state = 'MG' and o.customer_name = 'Maria Silva');
  perform pg_temp.ok('histórico inicial registrado', (select count(*) from public.order_status_history where order_id = o.id and from_status is null and to_status = 'pending_shipping') = 1);
  perform pg_temp.ok('criar pedido NÃO baixa estoque', (select quantity from public.product_variants where id = '20000000-0000-0000-0000-000000000001') = 3);

  -- variantes repetidas são somadas e validadas contra o estoque
  e := pg_temp.try_as('service_role', null, $q$select public.create_order_request('{"name":"Ana","phone":"34988887777","postal_code":"38000000","address_line":"Rua","address_number":"1","neighborhood":"B","city":"C","state":"MG"}', '[{"variant_id":"20000000-0000-0000-0000-000000000002","quantity":1},{"variant_id":"20000000-0000-0000-0000-000000000002","quantity":1}]')$q$);
  perform pg_temp.ok('variantes repetidas somadas -> estoque insuficiente', e = 'insufficient_stock');

  -- rejeições
  e := pg_temp.try_as('service_role', null, $q$select public.create_order_request('{"name":"Ana","phone":"34988887777","postal_code":"38000000","address_line":"Rua","address_number":"1","neighborhood":"B","city":"C","state":"MG"}', '[{"variant_id":"20000000-0000-0000-0000-00000000ffff","quantity":1}]')$q$);
  perform pg_temp.ok('variante inexistente rejeitada', e = 'variant_unavailable');
  e := pg_temp.try_as('service_role', null, $q$select public.create_order_request('{"name":"Ana","phone":"34988887777","postal_code":"38000000","address_line":"Rua","address_number":"1","neighborhood":"B","city":"C","state":"MG"}', '[{"variant_id":"20000000-0000-0000-0000-000000000003","quantity":1}]')$q$);
  perform pg_temp.ok('produto inativo rejeitado', e = 'variant_unavailable');
  e := pg_temp.try_as('service_role', null, $q$select public.create_order_request('{"name":"Ana","phone":"34988887777","postal_code":"38000000","address_line":"Rua","address_number":"1","neighborhood":"B","city":"C","state":"MG"}', '[{"variant_id":"20000000-0000-0000-0000-000000000004","quantity":1}]')$q$);
  perform pg_temp.ok('variante inativa rejeitada', e = 'variant_unavailable');
  e := pg_temp.try_as('service_role', null, $q$select public.create_order_request('{"name":"Ana","phone":"34988887777","postal_code":"38000000","address_line":"Rua","address_number":"1","neighborhood":"B","city":"C","state":"MG"}', '[{"variant_id":"20000000-0000-0000-0000-000000000001","quantity":4}]')$q$);
  perform pg_temp.ok('quantidade acima do estoque rejeitada', e = 'insufficient_stock');
  foreach e in array array['0','-1','21','1.5','"x"','null'] loop
    perform pg_temp.ok('quantidade inválida ' || e || ' rejeitada',
      pg_temp.try_as('service_role', null, format($q$select public.create_order_request('{"name":"Ana","phone":"34988887777","postal_code":"38000000","address_line":"Rua","address_number":"1","neighborhood":"B","city":"C","state":"MG"}', '[{"variant_id":"20000000-0000-0000-0000-000000000001","quantity":%s}]')$q$, e)) like 'invalid_items%');
  end loop;
  -- quantidade agregada: 15 + 15 = 30 > 20, mesmo com linhas individualmente válidas e estoque alto
  update public.product_variants set quantity = 100 where id = '20000000-0000-0000-0000-000000000001';
  perform pg_temp.ok('15+15 da mesma variante rejeitado (total 30 > 20)', pg_temp.try_as('service_role', null, $q$select public.create_order_request('{"name":"Ana","phone":"34988887777","postal_code":"38000000","address_line":"Rua X","address_number":"1","neighborhood":"B","city":"C","state":"MG"}', '[{"variant_id":"20000000-0000-0000-0000-000000000001","quantity":15},{"variant_id":"20000000-0000-0000-0000-000000000001","quantity":15}]')$q$) = 'invalid_items: quantity');
  perform pg_temp.ok('10+10 da mesma variante (total 20) é aceito', pg_temp.try_as('service_role', null, $q$select public.create_order_request('{"name":"Ana","phone":"34988887777","postal_code":"38000000","address_line":"Rua X","address_number":"1","neighborhood":"B","city":"C","state":"MG"}', '[{"variant_id":"20000000-0000-0000-0000-000000000001","quantity":10},{"variant_id":"20000000-0000-0000-0000-000000000001","quantity":10}]')$q$) is null);
  update public.product_variants set quantity = 3 where id = '20000000-0000-0000-0000-000000000001';
  delete from public.order_status_history where order_id in (select id from public.orders where customer_phone = '34988887777' and subtotal_cents = 598000);
  perform set_config('app.order_rpc', 'on', true);
  delete from public.orders where customer_phone = '34988887777';
  perform pg_temp.ok('carrinho vazio rejeitado', pg_temp.try_as('service_role', null, $q$select public.create_order_request('{"name":"Ana","phone":"34988887777","postal_code":"38000000","address_line":"Rua","address_number":"1","neighborhood":"B","city":"C","state":"MG"}', '[]')$q$) = 'invalid_items');
  perform pg_temp.ok('variant_id malformado rejeitado', pg_temp.try_as('service_role', null, $q$select public.create_order_request('{"name":"Ana","phone":"34988887777","postal_code":"38000000","address_line":"Rua","address_number":"1","neighborhood":"B","city":"C","state":"MG"}', '[{"variant_id":"abc","quantity":1}]')$q$) = 'invalid_items');
  perform pg_temp.ok('telefone inválido rejeitado', pg_temp.try_as('service_role', null, $q$select public.create_order_request('{"name":"Ana","phone":"123","postal_code":"38000000","address_line":"Rua","address_number":"1","neighborhood":"B","city":"C","state":"MG"}', '[{"variant_id":"20000000-0000-0000-0000-000000000001","quantity":1}]')$q$) like 'invalid_customer%');
  perform pg_temp.ok('nenhum pedido extra foi criado pelas rejeições', (select count(*) from public.orders) = 1);
end $$;

-- Permissões: anon/authenticated não criam pedido nem escrevem direto ---------
do $$
declare
  adm uuid := '00000000-0000-0000-0000-0000000000a1';
  usr uuid := '00000000-0000-0000-0000-0000000000b2';
  oid uuid := (select id from public.orders limit 1);
begin
  perform pg_temp.ok('anon não executa create_order_request', pg_temp.try_as('anon', null, $q$select public.create_order_request('{}','[]')$q$) like 'permission denied%');
  perform pg_temp.ok('authenticated não executa create_order_request', pg_temp.try_as('authenticated', usr, $q$select public.create_order_request('{}','[]')$q$) like 'permission denied%');
  perform pg_temp.ok('anon não faz INSERT em orders', pg_temp.try_as('anon', null, $q$insert into public.orders(display_code,customer_name,customer_phone,postal_code,address_line,address_number,neighborhood,city,state,subtotal_cents) values ('FF-010125-001','Xx','34999999999','38000000','R','1','B','C','MG',1)$q$) like 'permission denied%');
  perform pg_temp.ok('anon não lê orders', pg_temp.try_as('anon', null, 'select * from public.orders') like 'permission denied%');
  perform pg_temp.ok('anon não altera catálogo', pg_temp.try_as('anon', null, $q$update public.products set price_cents = 1$q$) like 'permission denied%');
  perform pg_temp.ok('não-admin: UPDATE em orders negado', pg_temp.try_as('authenticated', usr, format($q$update public.orders set status='completed' where id='%s'$q$, oid)) like 'permission denied%');
  perform pg_temp.ok('ADMIN: UPDATE direto status=completed negado', pg_temp.try_as('authenticated', adm, format($q$update public.orders set status='completed', completed_at=now() where id='%s'$q$, oid)) like 'permission denied%');
  perform pg_temp.ok('não-admin não lê pedidos (RLS)', pg_temp.try_as('authenticated', usr, $q$select 1 / (case when (select count(*) from public.orders) = 0 then 1 else 0 end)$q$) is null);
  perform pg_temp.ok('não-admin não altera catálogo (RLS)', pg_temp.try_as('authenticated', usr, $q$update public.products set price_cents = 1$q$) is null
    and (select price_cents from public.products where slug='vestido-seda') = 29900);
  perform pg_temp.ok('não-admin: contacted negado', pg_temp.try_as('authenticated', usr, format($q$select public.admin_mark_order_contacted('%s')$q$, oid)) = 'forbidden');
  perform pg_temp.ok('não-admin: cancel negado', pg_temp.try_as('authenticated', usr, format($q$select public.admin_cancel_order('%s')$q$, oid)) = 'forbidden');
  perform pg_temp.ok('não-admin: complete negado', pg_temp.try_as('authenticated', usr, format($q$select public.admin_complete_order('%s')$q$, oid)) = 'forbidden');
  perform pg_temp.ok('não-admin: shipping negado', pg_temp.try_as('authenticated', usr, format($q$select public.admin_set_order_shipping('%s', 100)$q$, oid)) = 'forbidden');
  perform pg_temp.ok('anon: RPCs admin sem EXECUTE', pg_temp.try_as('anon', null, format($q$select public.admin_complete_order('%s')$q$, oid)) like 'permission denied%');
  perform pg_temp.ok('pedido intacto após tentativas', (select status from public.orders where id = oid) = 'pending_shipping'
    and (select quantity from public.product_variants where id='20000000-0000-0000-0000-000000000001') = 3);
  -- mesmo owner/service_role não muda status sem RPC (trigger)
  perform pg_temp.ok('trigger bloqueia status via owner', (select pg_temp.try_as('postgres', null, format($q$update public.orders set status='contacted', contacted_at=now() where id='%s'$q$, oid))) = 'order_lifecycle_via_rpc_only');
  perform pg_temp.ok('histórico é imutável', pg_temp.try_as('postgres', null, $q$update public.order_status_history set note='x'$q$) like 'immutable_table%');
end $$;

-- Ciclo administrativo --------------------------------------------------------
do $$
declare
  adm uuid := '00000000-0000-0000-0000-0000000000a1';
  oid uuid := (select id from public.orders limit 1);
  r jsonb; e text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', adm)::text, true);

  -- contacted (idempotente)
  r := public.admin_mark_order_contacted(oid, 'chamei no zap');
  perform pg_temp.ok('marcar contacted', r->>'status' = 'contacted' and (r->>'already_done')::boolean = false);
  r := public.admin_mark_order_contacted(oid);
  perform pg_temp.ok('contacted repetido é no-op', (r->>'already_done')::boolean);
  perform pg_temp.ok('contacted gerou 1 histórico', (select count(*) from public.order_status_history where order_id = oid and to_status = 'contacted') = 1);

  r := public.admin_set_order_shipping(oid, 2500);
  perform pg_temp.ok('frete manual recalcula total', (select final_total_cents from public.orders where id = oid) = 62300);
end $$;

-- Conclusão: estoque insuficiente falha sem baixar nada -----------------------
do $$
declare
  adm uuid := '00000000-0000-0000-0000-0000000000a1';
  r jsonb; o2 uuid; e text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', adm)::text, true);
  -- pedido com 2 itens: A (ok) e B (vai faltar após outro pedido consumir)
  r := public.create_order_request('{"name":"Bia","phone":"34977776666","postal_code":"38000000","address_line":"Rua X","address_number":"1","neighborhood":"B","city":"C","state":"MG"}',
    '[{"variant_id":"20000000-0000-0000-0000-000000000001","quantity":1},{"variant_id":"20000000-0000-0000-0000-000000000002","quantity":1}]');
  o2 := (r->>'order_id')::uuid;
  -- estoque de B some (ajuste manual do admin)
  update public.product_variants set quantity = 0 where id = '20000000-0000-0000-0000-000000000002';
  -- sem frete definido: bloqueia ANTES de qualquer baixa
  begin
    perform public.admin_complete_order(o2);
    raise exception 'FAIL: deveria exigir frete';
  exception when others then e := sqlerrm; end;
  perform pg_temp.ok('concluir sem frete falha (shipping_not_defined)', e = 'shipping_not_defined');
  perform pg_temp.ok('sem frete: nada baixado e pedido aberto', (select quantity from public.product_variants where id='20000000-0000-0000-0000-000000000001') = 3
     and (select status from public.orders where id = o2) = 'pending_shipping');
  perform public.admin_set_order_shipping(o2, 0);
  begin
    perform public.admin_complete_order(o2);
    raise exception 'FAIL: deveria falhar';
  exception when others then e := sqlerrm; end;
  perform pg_temp.ok('estoque insuficiente aborta conclusão', e = 'insufficient_stock');
  perform pg_temp.ok('nenhum item foi baixado (A intacto)', (select quantity from public.product_variants where id='20000000-0000-0000-0000-000000000001') = 3);
  perform pg_temp.ok('pedido continua aberto', (select status from public.orders where id = o2) = 'pending_shipping' and (select completed_at from public.orders where id=o2) is null);
  perform pg_temp.ok('sem histórico de completed', not exists (select 1 from public.order_status_history where order_id = o2 and to_status='completed'));
  update public.product_variants set quantity = 1 where id = '20000000-0000-0000-0000-000000000002';

  -- conclusão válida
  r := public.admin_complete_order(o2, 'pago via pix');
  perform pg_temp.ok('frete R$ 0,00 é válido para concluir', (select shipping_cents = 0 and final_total_cents = subtotal_cents from public.orders where id = o2));
  perform pg_temp.ok('conclusão válida', r->>'status' = 'completed' and not (r->>'already_done')::boolean);
  perform pg_temp.ok('estoque baixado exatamente', (select quantity from public.product_variants where id='20000000-0000-0000-0000-000000000001') = 2
     and (select quantity from public.product_variants where id='20000000-0000-0000-0000-000000000002') = 0);
  perform pg_temp.ok('completed_at preenchido + histórico', (select completed_at is not null from public.orders where id=o2)
     and (select count(*) from public.order_status_history where order_id=o2 and to_status='completed' and changed_by = adm) = 1);

  -- retry não baixa de novo
  r := public.admin_complete_order(o2);
  perform pg_temp.ok('retry é idempotente', (r->>'already_done')::boolean
     and (select quantity from public.product_variants where id='20000000-0000-0000-0000-000000000001') = 2
     and (select count(*) from public.order_status_history where order_id=o2 and to_status='completed') = 1);

  -- transições inválidas
  perform pg_temp.ok('completed não pode ser cancelado', pg_temp.try_as('authenticated', adm, format($q$select public.admin_cancel_order('%s')$q$, o2)) like 'invalid_transition%');
  perform pg_temp.ok('completed não vira contacted', pg_temp.try_as('authenticated', adm, format($q$select public.admin_mark_order_contacted('%s')$q$, o2)) like 'invalid_transition%');
  perform pg_temp.ok('pedido inexistente', pg_temp.try_as('authenticated', adm, $q$select public.admin_complete_order(gen_random_uuid())$q$) = 'order_not_found');

  -- cancelamento: sem mexer em estoque; cancelado não conclui
  r := public.create_order_request('{"name":"Cris","phone":"34966665555","postal_code":"38000000","address_line":"Rua X","address_number":"1","neighborhood":"B","city":"C","state":"MG"}',
    '[{"variant_id":"20000000-0000-0000-0000-000000000001","quantity":1}]');
  o2 := (r->>'order_id')::uuid;
  r := public.admin_cancel_order(o2, 'desistiu');
  perform pg_temp.ok('cancelar pedido', r->>'status' = 'cancelled' and (select cancelled_at is not null from public.orders where id=o2));
  perform pg_temp.ok('cancel repetido é no-op', (public.admin_cancel_order(o2)->>'already_done')::boolean);
  perform pg_temp.ok('cancelado não conclui', pg_temp.try_as('authenticated', adm, format($q$select public.admin_complete_order('%s')$q$, o2)) like 'invalid_transition%');
  perform pg_temp.ok('cancelar não altera estoque', (select quantity from public.product_variants where id='20000000-0000-0000-0000-000000000001') = 2);
end $$;

-- Rate limit por telefone ------------------------------------------------------
do $$
declare i int; e text;
begin
  for i in 1..5 loop
    perform public.create_order_request('{"name":"Spam","phone":"34900000000","postal_code":"38000000","address_line":"Rua X","address_number":"1","neighborhood":"B","city":"C","state":"MG"}',
      '[{"variant_id":"20000000-0000-0000-0000-000000000001","quantity":1}]');
  end loop;
  e := pg_temp.try_as('service_role', null, $q$select public.create_order_request('{"name":"Spam","phone":"34900000000","postal_code":"38000000","address_line":"Rua X","address_number":"1","neighborhood":"B","city":"C","state":"MG"}','[{"variant_id":"20000000-0000-0000-0000-000000000001","quantity":1}]')$q$);
  perform pg_temp.ok('6º pedido do mesmo telefone na hora é limitado', e = 'rate_limited');
  perform pg_temp.ok('códigos sequenciais únicos no dia', (select count(distinct display_code) = count(*) from public.orders));
end $$;
