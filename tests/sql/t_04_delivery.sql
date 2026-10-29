\set QUIET on
\ir helpers.sql
begin;
insert into auth.users(id) values('00000000-0000-0000-0000-0000000000d4');
insert into private.admin_users(user_id) values('00000000-0000-0000-0000-0000000000d4');
insert into public.products(id,name,slug,price_cents) values('10000000-0000-0000-0000-000000000044','Entrega','entrega',10000);
insert into public.product_variants(id,product_id,color,size,quantity) values('20000000-0000-0000-0000-000000000044','10000000-0000-0000-0000-000000000044','Preta','M',5);
do $$
declare e text; r jsonb; first_order jsonb; v bigint; before_qty integer; oid uuid;
 cust jsonb:='{"name":"Cliente Teste","phone":"34988112233","postal_code":"38000000","address_line":"Rua Teste","address_number":"1","neighborhood":"Centro","city":"Uberaba","state":"MG"}';
 items jsonb:='[{"variant_id":"20000000-0000-0000-0000-000000000044","quantity":1}]';
 adm uuid:='00000000-0000-0000-0000-0000000000d4';
 vid uuid:='20000000-0000-0000-0000-000000000044';
 rid uuid:='30000000-0000-0000-0000-000000000044';
begin
 perform pg_temp.ok('admin não pode PATCH quantidade',not has_column_privilege('authenticated','public.product_variants','quantity','update'));
 perform pg_temp.ok('admin pode PATCH tamanho',has_column_privilege('authenticated','public.product_variants','size','update'));
 e:=pg_temp.try_as('authenticated',adm,$q$update public.product_variants set quantity=99 where id='20000000-0000-0000-0000-000000000044'$q$);
 perform pg_temp.ok('backend bloqueia saldo antigo mesmo de cliente antigo',e like 'permission denied%');
 perform set_config('request.jwt.claims',json_build_object('sub',adm)::text,true);
 select stock_version into v from public.product_variants where id=vid;
 r:=public.admin_register_external_sale(rid,'presencial',items);
 e:=pg_temp.try_as('authenticated',adm,format('select public.admin_adjust_stock(%L,%L,%s,5,%L)',gen_random_uuid(),vid,v,'Contagem antiga'));
 perform pg_temp.ok('tela antiga não restaura baixa recente',e='stock_conflict');
 e:=pg_temp.try_as('authenticated',adm,$q$update public.product_variants set size='G' where id='20000000-0000-0000-0000-000000000044'$q$);
 perform pg_temp.ok('edição cadastral preserva baixa',e is null and (select quantity from public.product_variants where id=vid)=4);
 perform set_config('request.jwt.claims',json_build_object('sub',adm)::text,true);
 select stock_version into v from public.product_variants where id=vid;
 r:=public.admin_adjust_stock('30000000-0000-0000-0000-000000000045',vid,v,7,'Entrada conferida');
 r:=public.admin_adjust_stock('30000000-0000-0000-0000-000000000045',vid,v,7,'Entrada conferida');
 perform pg_temp.ok('retry de ajuste é idempotente',(r->>'already_done')::boolean and (select quantity from public.product_variants where id=vid)=7);
 perform pg_temp.ok('ajuste auditável uma vez',(select count(*) from public.stock_adjustments where variant_id=vid)=1);
 e:=pg_temp.try_as('anon',null,format('select public.admin_adjust_stock(%L,%L,0,9,%L)',gen_random_uuid(),vid,'Não autorizado'));
 perform pg_temp.ok('anônimo não ajusta estoque',e like 'permission denied%');
 first_order:=public.create_order_request_idempotent('30000000-0000-0000-0000-000000000046',cust,items);
 oid:=(first_order->>'order_id')::uuid;
 r:=public.create_order_request_idempotent('30000000-0000-0000-0000-000000000046',cust,items);
 perform pg_temp.ok('pedido repetido devolve mesmo registro',r=first_order and (select count(*) from private.order_attempts where order_id=oid)=1);
 r:=public.recover_order_request('30000000-0000-0000-0000-000000000046');
 perform pg_temp.ok('recuperação após resposta perdida só retorna dados mínimos',r=first_order and (select count(*) from jsonb_object_keys(r))=3);
 begin
  perform public.create_order_request_idempotent('30000000-0000-0000-0000-000000000046',cust||'{"name":"Outro Nome"}',items);
  raise exception 'FAIL: conflito não detectado';
 exception when others then perform pg_temp.ok('ID não aceita outros dados',sqlerrm='request_conflict'); end;
 perform set_config('request.jwt.claims',json_build_object('sub',adm)::text,true);
 perform public.admin_set_order_shipping(oid,0);
 perform public.admin_complete_order(oid);
 select quantity into before_qty from public.product_variants where id=vid;
 perform public.admin_save_order_note(oid,'Observação depois de concluído','30000000-0000-0000-0000-000000000047');
 perform public.admin_save_order_note(oid,'Observação depois de concluído','30000000-0000-0000-0000-000000000047');
 perform pg_temp.ok('salvar nota não muda estoque nem status',(select quantity from public.product_variants where id=vid)=before_qty and (select status from public.orders where id=oid)='completed');
 perform pg_temp.ok('retry de nota não duplica histórico',(select count(*) from public.order_status_history where id='30000000-0000-0000-0000-000000000047')=1);
 update public.products set slug='entrega-nova' where id='10000000-0000-0000-0000-000000000044';
 perform pg_temp.ok('slug antigo permanece acessível',(select 'entrega'=any(previous_slugs) from public.products where slug='entrega-nova'));
 insert into private.order_code_counters(day,last_seq) values((now() at time zone 'America/Sao_Paulo')::date,999) on conflict(day) do update set last_seq=999;
 perform pg_temp.ok('código 1000 não trunca',private.next_order_code() like '%-1000');
end; $$;
rollback;
