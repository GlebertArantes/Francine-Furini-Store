import {test} from 'node:test';
import assert from 'node:assert/strict';
import {attemptStore} from '../../admin/js/lib/attempts.js';
import {createAdminApi} from '../../admin/js/lib/api.js';
const memory=()=>{const m=new Map();return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)}};
test('venda pendente sobrevive ao reload e fica separada por administradora',()=>{
 const storage=memory(),a=attemptStore(storage,'user-a');
 const sale={id:crypto.randomUUID(),channel:'instagram',items:[{variant_id:crypto.randomUUID(),quantity:2}]};
 a.write(sale);
 assert.deepEqual(attemptStore(storage,'user-a').read(),sale);
 assert.equal(attemptStore(storage,'user-b').read(),null);
 a.clear();assert.equal(a.read(),null);
});
test('armazenamento negado ou adulterado não permite envio silencioso',()=>{
 const a=attemptStore({getItem:()=>null,setItem:()=>{}},'a');assert.throws(()=>a.write({id:'id'}),/unavailable/);
 assert.throws(()=>attemptStore({getItem:()=>'{bad'},'a').read());
});
test('edição cadastral nunca reenvia saldo; ajuste usa RPC com versão, motivo e ID',async()=>{
 const calls=[];const api=createAdminApi({url:'https://test',key:'public',auth:{getAccessToken:async()=>'jwt'},fetchFn:async(url,init)=>{calls.push({url,body:JSON.parse(init.body)});return Response.json([{id:'v'}]);}});
 await api.updateVariant('v',{color:'Preta',size:'M',sku:null,active:true,quantity:99,stock_version:0});
 assert.deepEqual(calls[0].body,{color:'Preta',size:'M',sku:null,active:true});
 const args={p_request_id:crypto.randomUUID(),p_variant_id:'v',p_expected_version:4,p_quantity:3,p_reason:'Contagem'};
 await api.adjustStock(args);assert.match(calls[1].url,/rpc\/admin_adjust_stock$/);assert.deepEqual(calls[1].body,args);
});
test('histórico pagina pedidos e vendas sem ocultar registros antigos',async()=>{
 const urls=[];const api=createAdminApi({url:'https://test',key:'public',auth:{getAccessToken:async()=>'jwt'},fetchFn:async(url)=>{urls.push(url);return Response.json([]);}});
 await api.listOrders('completed',3,'Maria,(status.eq.cancelled)');await api.listExternalSales(2);
 assert.match(urls[0],/limit=50&offset=150/);assert.ok(!urls[0].includes('status.eq.cancelled'));assert.match(urls[1],/limit=30&offset=60/);
});
