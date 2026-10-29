import {test} from 'node:test';
import assert from 'node:assert/strict';
import {attemptStore} from '../../storefront/js/lib/attempts.js';
import {createOrderPlacer} from '../../storefront/js/lib/checkout.js';
const customer={name:'Teste Seguro',phone:'34999991234',postal_code:'38010000',address_line:'Rua teste',address_number:'1',neighborhood:'Centro',city:'Uberaba',state:'MG'};
const fixture=()=>{
 const data=new Map(); const storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
 let cart={items:[{variant_id:'20000000-0000-0000-0000-000000000001',quantity:1}]};
 return {storage,cartStore:{get:()=>cart,clear:()=>{cart={items:[]}}},attempts:attemptStore(storage,'order'),lock:(_n,fn)=>fn(),data};
};
test('resposta perdida + reload recupera o mesmo pedido e não cria outro',async()=>{
 const f=fixture();let creates=0,stored,id;
 const send=async(p)=>{if(p.recover)return {ok:true,order:stored};creates++;id=p.request_id;stored={display_code:'FF-1',order_id:'o'};return {ok:false,code:'network'};};
 await createOrderPlacer({...f,send})(customer);
 assert.equal(f.attempts.read().id,id);
 const saved=[...f.data.values()].join('');assert.ok(!saved.includes(customer.name));assert.ok(!saved.includes(customer.phone));
 const result=await createOrderPlacer({...f,send}).recover();assert.equal(result.order.display_code,'FF-1');assert.equal(creates,1);assert.equal(f.cartStore.get().items.length,0);
});
test('tentativa não recebida usa o mesmo ID ao reenviar após reload',async()=>{
 const f=fixture();const ids=[];
 const send=async(p)=>{if(p.recover)return {ok:false,notFound:true};ids.push(p.request_id);return ids.length===1?{ok:false,code:'network'}:{ok:true,order:{display_code:'FF-2'}};};
 await createOrderPlacer({...f,send})(customer);await createOrderPlacer({...f,send})(customer);
 assert.equal(ids.length,2);assert.equal(ids[0],ids[1]);
});
test('alterar dados após resultado incerto não gera uma segunda identificação',async()=>{
 const f=fixture();let calls=0;
 const send=async(p)=>{if(p.recover)return {ok:false,notFound:true};calls++;return {ok:false,code:'network'};};
 await createOrderPlacer({...f,send})(customer);
 const r=await createOrderPlacer({...f,send})({...customer,name:'Outra Pessoa'});
 assert.equal(r.code,'request_conflict');assert.equal(calls,1);
});
test('armazenamento indisponível bloqueia o pedido antes da requisição',async()=>{
 const f=fixture();f.attempts.write=()=>{throw new Error('quota')};let calls=0;
 assert.equal((await createOrderPlacer({...f,send:async()=>{calls++}})(customer)).code,'storage');assert.equal(calls,0);
});
