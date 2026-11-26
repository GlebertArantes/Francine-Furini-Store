import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldShrink, shrinkImage, targetSize } from '../../admin/js/lib/image-resize.js';
import { MAX_IMAGE_BYTES } from '../../admin/js/lib/rules.js';
import { loadPhoto } from '../../admin/js/lib/photo-transform.js';
const source = { name:'frente.png', type:'image/png', size:MAX_IMAGE_BYTES+1000 };
function environment({ bitmap='ok', sizes=[200000], context=true }={}) {
  const calls=[], revoked=[];let closed=0;
  const ctx={fillRect(){},drawImage(...args){calls.push({draw:args.slice(1)});}};
  const canvas={width:0,height:0,getContext:()=>context?ctx:null,toBlob(fn,mime,quality){calls.push({mime,quality});fn({size:sizes[Math.min(calls.filter(c=>c.mime).length-1,sizes.length-1)]});}};
  const env={
    document:{createElement:()=>canvas},
    URL:{createObjectURL:()=> 'blob:test',revokeObjectURL:u=>revoked.push(u)},
    Image:class {width=6000;height=4000;set src(_v){queueMicrotask(()=>this.onload());}},
    File:class {constructor(parts,name,opts){this.size=parts[0].size;this.name=name;this.type=opts.type;}},
  };
  if(bitmap!=='absent')env.createImageBitmap=async()=>{if(bitmap==='reject')throw Error('decoder_unsupported');return {width:6000,height:4000,close(){closed++;}};};
  return {env,calls,revoked,canvas,closed:()=>closed};
}
test('redução abrange AVIF grande; arquivos pequenos ou formatos proibidos não são processados',()=>{
  assert.equal(shouldShrink({...source,type:'image/avif'}),true);
  assert.equal(shouldShrink({...source,size:MAX_IMAGE_BYTES}),false);
  assert.equal(shouldShrink({...source,type:'image/svg+xml'}),false);
  assert.deepEqual(targetSize(6000,4000),{width:2400,height:1600});
  assert.deepEqual(targetSize(600,400),{width:600,height:400});
});
for(const bitmap of ['absent','reject'])test(`foto grande usa decodificador alternativo quando bitmap está ${bitmap}`,async()=>{
  const e=environment({bitmap});const output=await shrinkImage(source,e.env);
  assert.equal(output.type,'image/jpeg');assert.equal(output.name,'frente.jpg');assert.equal(output.size,200000);
  assert.deepEqual(e.revoked,['blob:test']);
  assert.deepEqual(e.calls.find(c=>c.draw).draw,[0,0,2400,1600]);
});
test('redução tenta outra qualidade quando a primeira ainda excede o limite',async()=>{
  const e=environment({sizes:[MAX_IMAGE_BYTES+1,350000]});
  const out=await shrinkImage(source,e.env);assert.equal(out.size,350000);
  assert.equal(e.calls.filter(c=>c.mime).length,2);assert.equal(e.closed(),1);
});
test('nunca retorna arquivo vazio ou acima de 8 MB e libera o bitmap mesmo na falha',async()=>{
  for(const size of [0,MAX_IMAGE_BYTES+1]){
    const e=environment({sizes:[size]});await assert.rejects(shrinkImage(source,e.env));assert.equal(e.closed(),1);
  }
});
test('bitmap sem resposta usa alternativa e libera o bitmap que chegar atrasado',async()=>{
  const e=environment({bitmap:'absent'});let finish,closed=0;
  e.env.createImageBitmap=()=>new Promise(resolve=>{finish=resolve;});
  const image=await loadPhoto(source,e.env,5);
  assert.equal(image.width,6000);assert.deepEqual(e.revoked,['blob:test']);
  finish({close(){closed++;}});await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(closed,1);
});
test('decodificador e canvas sem resposta terminam com erro e liberam recursos',async()=>{
  const e=environment({bitmap:'absent'});
  e.env.Image=class {set src(_value){}};
  await assert.rejects(shrinkImage(source,e.env,5),/image_decode_timeout/);
  assert.deepEqual(e.revoked,['blob:test']);
  const encoding=environment();encoding.canvas.toBlob=()=>{};
  await assert.rejects(shrinkImage(source,encoding.env,5),/image_encode_timeout/);
  assert.equal(encoding.closed(),1);assert.equal(encoding.canvas.width,0);
});
