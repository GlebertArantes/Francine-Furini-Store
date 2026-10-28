\set QUIET on
\ir helpers.sql
set client_min_messages = notice;

-- Fixtures exclusivas de teste. O banco descartavel do CI e isolado de producao.
insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000e5'),
  ('00000000-0000-0000-0000-0000000000f6');
insert into private.admin_users (user_id) values ('00000000-0000-0000-0000-0000000000e5');
insert into public.products (id,name,slug,price_cents) values
  ('10000000-0000-0000-0000-000000000031','Camisa Teste','camisa-teste-venda-rapida',10000),
  ('10000000-0000-0000-0000-000000000032','Conjunto Teste','conjunto-teste-venda-rapida',20000);
insert into public.product_variants (id,product_id,color,size,quantity) values
  ('20000000-0000-0000-0000-000000000031','10000000-0000-0000-0000-000000000031','Branco','M',3),
  ('20000000-0000-0000-0000-000000000032','10000000-0000-0000-0000-000000000032','Preto','G',2);
insert into public.product_variants (id,product_id,color,size,quantity,active) values
  ('20000000-0000-0000-0000-000000000033','10000000-0000-0000-0000-000000000032','Azul','P',5,false);

do $$
declare
  adm uuid := '00000000-0000-0000-0000-0000000000e5';
  outsider uuid := '00000000-0000-0000-0000-0000000000f6';
  rid uuid := '30000000-0000-0000-0000-000000000031';
  r jsonb;
  err text;
begin
  perform pg_temp.ok('sem INSERT direto para anon',
    not has_table_privilege('anon','public.external_sales','INSERT'));
  perform pg_temp.ok('sem INSERT direto para authenticated',
    not has_table_privilege('authenticated','public.external_sales','INSERT'));
  perform pg_temp.ok('sem UPDATE direto de vendas',
    not has_table_privilege('authenticated','public.external_sales','UPDATE'));
  perform pg_temp.ok('RLS habilitada nas duas tabelas',
    (select relrowsecurity from pg_class where oid='public.external_sales'::regclass)
    and (select relrowsecurity from pg_class where oid='public.external_sale_items'::regclass));

  err := pg_temp.try_as('anon',null,$q$select public.admin_register_external_sale(
    '30000000-0000-0000-0000-000000000041','whatsapp',
    '[{"variant_id":"20000000-0000-0000-0000-000000000031","quantity":1}]')$q$);
  perform pg_temp.ok('anon nao pode registrar venda',err like 'permission denied%');
  err := pg_temp.try_as('authenticated',outsider,$q$select public.admin_register_external_sale(
    '30000000-0000-0000-0000-000000000042','instagram',
    '[{"variant_id":"20000000-0000-0000-0000-000000000031","quantity":1}]')$q$);
  perform pg_temp.ok('autenticado nao-admin nao pode registrar',err = 'forbidden');

  perform set_config('request.jwt.claims',json_build_object('sub',adm)::text,true);
  r := public.admin_register_external_sale(rid,'whatsapp',
    '[{"variant_id":"20000000-0000-0000-0000-000000000032","quantity":1},
      {"variant_id":"20000000-0000-0000-0000-000000000031","quantity":1},
      {"variant_id":"20000000-0000-0000-0000-000000000031","quantity":1}]');
  perform pg_temp.ok('registrou venda',r ? 'sale_id' and (r->>'already_done')::boolean = false);
  perform pg_temp.ok('soma variantes repetidas e valores do banco',(r->>'total_cents')::bigint=40000);
  perform pg_temp.ok('estoque baixado 2 e 1',(select quantity from public.product_variants where id='20000000-0000-0000-0000-000000000031')=1
    and (select quantity from public.product_variants where id='20000000-0000-0000-0000-000000000032')=1);
  perform pg_temp.ok('historico auditavel com snapshot',(select count(*) from public.external_sale_items where sale_id=(r->>'sale_id')::uuid)=2
    and (select sum(quantity) from public.external_sale_items where sale_id=(r->>'sale_id')::uuid)=3);

  r := public.admin_register_external_sale(rid,'whatsapp',
    '[{"variant_id":"20000000-0000-0000-0000-000000000031","quantity":2},
      {"variant_id":"20000000-0000-0000-0000-000000000032","quantity":1}]');
  perform pg_temp.ok('retry idempotente apos retorno incerto',(r->>'already_done')::boolean = true);
  perform pg_temp.ok('retry nao duplica estoque nem historico',(select count(*) from public.external_sales)=1
    and (select quantity from public.product_variants where id='20000000-0000-0000-0000-000000000031')=1);

  begin
    perform public.admin_register_external_sale(rid,'instagram',
      '[{"variant_id":"20000000-0000-0000-0000-000000000031","quantity":1}]');
    raise exception 'FAIL expected request_conflict';
  exception when others then err:=sqlerrm; end;
  perform pg_temp.ok('mesmo request_id com payload diferente rejeitado',err='request_conflict');

  begin
    perform public.admin_register_external_sale('30000000-0000-0000-0000-000000000034','presencial',
      '[{"variant_id":"20000000-0000-0000-0000-000000000031","quantity":2},
        {"variant_id":"20000000-0000-0000-0000-000000000032","quantity":1}]');
    raise exception 'FAIL expected insufficient_stock';
  exception when others then err:=sqlerrm; end;
  perform pg_temp.ok('estoque insuficiente aborta TUDO',err like 'insufficient_stock%'
    and (select count(*) from public.external_sales)=1
    and (select quantity from public.product_variants where id='20000000-0000-0000-0000-000000000032')=1);

  begin
    perform public.admin_register_external_sale('30000000-0000-0000-0000-000000000035','presencial',
      '[{"variant_id":"20000000-0000-0000-0000-000000000033","quantity":1}]');
    raise exception 'FAIL expected variant_unavailable';
  exception when others then err:=sqlerrm; end;
  perform pg_temp.ok('variante inativa bloqueada',err='variant_unavailable');

  begin
    perform public.admin_register_external_sale('30000000-0000-0000-0000-000000000036','presencial',
      '[{"variant_id":"20000000-0000-0000-0000-000000000031","quantity":0}]');
    raise exception 'FAIL expected invalid_external_sale';
  exception when others then err:=sqlerrm; end;
  perform pg_temp.ok('quantidade zero rejeitada',err='invalid_external_sale');

  begin
    perform public.admin_register_external_sale('30000000-0000-0000-0000-000000000038','presencial',
      '[{"variant_id":"20000000-0000-0000-0000-000000000031","quantity":"abc"}]');
    raise exception 'FAIL expected invalid_external_sale';
  exception when others then err:=sqlerrm; end;
  perform pg_temp.ok('quantidade malformada rejeitada com erro controlado',err='invalid_external_sale');

  r:=public.admin_register_external_sale('30000000-0000-0000-0000-000000000037','presencial',
    '[{"variant_id":"20000000-0000-0000-0000-000000000031","quantity":1}]');
  perform pg_temp.ok('segunda venda legitima baixa ultima unidade',
    (r->>'already_done')::boolean=false
    and (select quantity from public.product_variants where id='20000000-0000-0000-0000-000000000031')=0);
  perform pg_temp.ok('nao criou pedido ficticio',(select count(*) from public.external_sales)=2
    and (select count(*) from public.orders where customer_name='Camisa Teste')=0);
end $$;
