#!/usr/bin/env bash
# Concorrência real: várias sessões psql simultâneas. Chamado por run.sh (usa PG* do ambiente).
set -uo pipefail
P() { command psql -X -q -t -A -v ON_ERROR_STOP=0 "$@"; }
ADM=00000000-0000-0000-0000-0000000000a1
CUST='{"name":"Conc","phone":"34%s","postal_code":"38000000","address_line":"Rua X","address_number":"1","neighborhood":"B","city":"C","state":"MG"}'
fail=0
ship() { P -c "select set_config('request.jwt.claims','{\"sub\":\"$ADM\"}',false); select public.admin_set_order_shipping('$1', ${2:-1500})" >/dev/null; }
check() { if [ "$2" = "$3" ]; then echo "PASS: $1"; else echo "FAIL: $1 (esperado '$3', obtido '$2')"; fail=1; fi; }

P -c "delete from public.order_status_history; delete from public.order_items; delete from public.orders; delete from private.order_code_counters;"
P -c "insert into public.products(id,name,slug,price_cents) values ('30000000-0000-0000-0000-000000000001','Conc','conc',10000) on conflict do nothing;
      insert into public.product_variants(id,product_id,color,size,quantity) values ('40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','Nude','M',1000),
      ('40000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001','Nude','G',1) on conflict do nothing;"

# 1) 30 criações simultâneas (telefones distintos) -> códigos únicos 001..030
for i in $(seq 1 30); do
  ph=$(printf '9%08d' "$i")
  P -c "select public.create_order_request('$(printf "$CUST" "$ph")','[{\"variant_id\":\"40000000-0000-0000-0000-000000000001\",\"quantity\":1}]')" >/dev/null 2>&1 &
done; wait
check "30 criações simultâneas geram 30 pedidos" "$(P -c 'select count(*) from public.orders')" 30
check "30 códigos distintos" "$(P -c 'select count(distinct display_code) from public.orders')" 30
check "sequência contínua 001..030" "$(P -c "select min(right(display_code,3))||'-'||max(right(display_code,3)) from public.orders")" "001-030"

# 2) Dois pedidos disputam a última peça; concluir os dois em paralelo -> só um passa
for ph in 911111111 922222222; do
  P -c "select public.create_order_request('$(printf "$CUST" "$ph")','[{\"variant_id\":\"40000000-0000-0000-0000-000000000002\",\"quantity\":1}]')" >/dev/null
done
ids=$(P -c "select id from public.orders where customer_phone in ('34911111111','34922222222')")
out=$(mktemp)
for id in $ids; do ship "$id"; done
for id in $ids; do
  P -c "select set_config('request.jwt.claims','{\"sub\":\"$ADM\"}',false); select public.admin_complete_order('$id')" >>"$out" 2>&1 &
done; wait
check "última peça: exatamente 1 conclusão" "$(grep -c '"status": "completed"' "$out")" 1
check "última peça: 1 recusa por estoque" "$(grep -c insufficient_stock "$out")" 1
check "estoque nunca negativo (=0)" "$(P -c "select quantity from public.product_variants where id='40000000-0000-0000-0000-000000000002'")" 0
check "apenas 1 pedido completed" "$(P -c "select count(*) from public.orders where status='completed'")" 1

# 3) Duplo clique: mesmo pedido concluído 5x em paralelo -> baixa uma única vez
oid=$(P -c "select public.create_order_request('$(printf "$CUST" 933333333)','[{\"variant_id\":\"40000000-0000-0000-0000-000000000001\",\"quantity\":3}]')" | sed 's/.*"order_id": "\([^"]*\)".*/\1/')
ship "$oid" 0   # frete R$ 0,00 é válido
before=$(P -c "select quantity from public.product_variants where id='40000000-0000-0000-0000-000000000001'")
for i in 1 2 3 4 5; do
  P -c "select set_config('request.jwt.claims','{\"sub\":\"$ADM\"}',false); select public.admin_complete_order('$oid')" >/dev/null 2>&1 &
done; wait
after=$(P -c "select quantity from public.product_variants where id='40000000-0000-0000-0000-000000000001'")
check "duplo clique baixa 3 unidades uma única vez" "$((before - after))" 3
check "1 histórico completed" "$(P -c "select count(*) from public.order_status_history where order_id='$oid' and to_status='completed'")" 1

# 4) Rate limit por telefone sob corrida: 12 criações simultâneas do MESMO telefone -> no máximo 5
out2=$(mktemp)
for i in $(seq 1 12); do
  P -c "select public.create_order_request('$(printf "$CUST" 944444444)','[{\"variant_id\":\"40000000-0000-0000-0000-000000000001\",\"quantity\":1}]')" >>"$out2" 2>&1 &
done; wait
check "mesmo telefone, 12 simultâneas: exatamente 5 pedidos" "$(P -c "select count(*) from public.orders where customer_phone='34944444444'")" 5
check "as 7 restantes receberam rate_limited" "$(grep -c rate_limited "$out2")" 7
check "códigos continuam únicos" "$(P -c 'select count(*) - count(distinct display_code) from public.orders')" 0
# 5) Duas vendas externas simultaneas disputam a ultima unidade.
P -c "insert into public.product_variants(id,product_id,color,size,quantity) values
 ('40000000-0000-0000-0000-000000000003','30000000-0000-0000-0000-000000000001','Azul','P',1),
 ('40000000-0000-0000-0000-000000000004','30000000-0000-0000-0000-000000000001','Preto','G',5),
 ('40000000-0000-0000-0000-000000000005','30000000-0000-0000-0000-000000000001','Cinza','M',1);"
saleout=$(mktemp)
for rid in 30000000-0000-0000-0000-000000000081 30000000-0000-0000-0000-000000000082; do
  P -c "select set_config('request.jwt.claims','{\"sub\":\"$ADM\"}',false);
    select public.admin_register_external_sale('$rid','whatsapp',
    '[{\"variant_id\":\"40000000-0000-0000-0000-000000000003\",\"quantity\":1}]')" >>"$saleout" 2>&1 &
done; wait
check "venda externa concorrente: apenas um registro" "$(P -c "select count(*) from public.external_sales where request_id in ('30000000-0000-0000-0000-000000000081','30000000-0000-0000-0000-000000000082')")" 1
check "venda externa concorrente: 1 rejeicao por estoque" "$(grep -c insufficient_stock "$saleout")" 1
check "venda externa concorrente: estoque zero" "$(P -c "select quantity from public.product_variants where id='40000000-0000-0000-0000-000000000003'")" 0

# 6) Cinco retries paralelos com o MESMO request_id: uma unica baixa de 3.
same=30000000-0000-0000-0000-000000000083
for i in 1 2 3 4 5; do
  P -c "select set_config('request.jwt.claims','{\"sub\":\"$ADM\"}',false);
    select public.admin_register_external_sale('$same','instagram',
    '[{\"variant_id\":\"40000000-0000-0000-0000-000000000004\",\"quantity\":3}]')" >/dev/null 2>&1 &
done; wait
check "retry paralelo: um unico registro" "$(P -c "select count(*) from public.external_sales where request_id='$same'")" 1
check "retry paralelo: baixa somente 3" "$(P -c "select quantity from public.product_variants where id='40000000-0000-0000-0000-000000000004'")" 2

# 7) Conclusao de pedido e venda externa disputam a mesma ultima unidade.
oid=$(P -c "select public.create_order_request('$(printf "$CUST" 955555555)',
 '[{\"variant_id\":\"40000000-0000-0000-0000-000000000005\",\"quantity\":1}]')" | sed 's/.*"order_id": "\([^"]*\)".*/\1/')
ship "$oid" 0
raceout=$(mktemp)
P -c "select set_config('request.jwt.claims','{\"sub\":\"$ADM\"}',false);
 select public.admin_complete_order('$oid')" >>"$raceout" 2>&1 &
P -c "select set_config('request.jwt.claims','{\"sub\":\"$ADM\"}',false);
 select public.admin_register_external_sale('30000000-0000-0000-0000-000000000084','presencial',
 '[{\"variant_id\":\"40000000-0000-0000-0000-000000000005\",\"quantity\":1}]')" >>"$raceout" 2>&1 &
wait
check "pedido vs venda externa: estoque zerado" "$(P -c "select quantity from public.product_variants where id='40000000-0000-0000-0000-000000000005'")" 0
check "pedido vs venda externa: so um vencedor" "$(P -c "select
 (select count(*) from public.orders where id='$oid' and status='completed')
 + (select count(*) from public.external_sale_items where variant_id='40000000-0000-0000-0000-000000000005')")" 1

rm -f "$out" "$out2" "$saleout" "$raceout"
exit $fail
