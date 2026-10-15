#!/usr/bin/env bash
# Concorrência real: várias sessões psql simultâneas. Chamado por run.sh (usa PG* do ambiente).
set -uo pipefail
P() { command psql -X -q -t -A -v ON_ERROR_STOP=0 "$@"; }
ADM=00000000-0000-0000-0000-0000000000a1
CUST='{"name":"Conc","phone":"34%s","postal_code":"38000000","address_line":"Rua X","address_number":"1","neighborhood":"B","city":"C","state":"MG"}'
fail=0
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
for id in $ids; do
  P -c "select set_config('request.jwt.claims','{\"sub\":\"$ADM\"}',false); select public.admin_complete_order('$id')" >>"$out" 2>&1 &
done; wait
check "última peça: exatamente 1 conclusão" "$(grep -c '"status": "completed"' "$out")" 1
check "última peça: 1 recusa por estoque" "$(grep -c insufficient_stock "$out")" 1
check "estoque nunca negativo (=0)" "$(P -c "select quantity from public.product_variants where id='40000000-0000-0000-0000-000000000002'")" 0
check "apenas 1 pedido completed" "$(P -c "select count(*) from public.orders where status='completed'")" 1

# 3) Duplo clique: mesmo pedido concluído 5x em paralelo -> baixa uma única vez
oid=$(P -c "select public.create_order_request('$(printf "$CUST" 933333333)','[{\"variant_id\":\"40000000-0000-0000-0000-000000000001\",\"quantity\":3}]')" | sed 's/.*"order_id": "\([^"]*\)".*/\1/')
before=$(P -c "select quantity from public.product_variants where id='40000000-0000-0000-0000-000000000001'")
for i in 1 2 3 4 5; do
  P -c "select set_config('request.jwt.claims','{\"sub\":\"$ADM\"}',false); select public.admin_complete_order('$oid')" >/dev/null 2>&1 &
done; wait
after=$(P -c "select quantity from public.product_variants where id='40000000-0000-0000-0000-000000000001'")
check "duplo clique baixa 3 unidades uma única vez" "$((before - after))" 3
check "1 histórico completed" "$(P -c "select count(*) from public.order_status_history where order_id='$oid' and to_status='completed'")" 1
rm -f "$out"
exit $fail
