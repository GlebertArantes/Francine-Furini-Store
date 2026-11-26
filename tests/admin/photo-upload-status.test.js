import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPhotoQueue, uploadPhotos } from '../../admin/js/lib/photos.js';

test('cada foto informa envio e resultado; falhar não interrompe a próxima', async () => {
  const queue = createPhotoQueue();
  queue.add(['boa.jpg', 'falha.jpg', 'ultima.jpg'].map(name => ({name, type:'image/jpeg', size:100})));
  const states=[];
  const result=await uploadPhotos({ async uploadImage(_id,file) {
    if(file.name==='falha.jpg') throw {code:'network'};
    return {id:file.name};
  }}, 'produto', queue.valid(), 0, {onState:event=>states.push(event)});
  assert.deepEqual(states.map(x=>[x.name,x.state]), [
    ['boa.jpg','sending'],['boa.jpg','success'],['falha.jpg','sending'],
    ['falha.jpg','error'],['ultima.jpg','sending'],['ultima.jpg','success']]);
  assert.match(states[3].reason,/sem conexão/);
  assert.ok(states.every(x=>x.productId==='produto' && x.key));
  assert.equal(result.uploaded.length,2); assert.equal(result.failed.length,1);
});

test('arquivo inválido e fotos após sessão expirada recebem erro, nunca sucesso', async () => {
  const queue=createPhotoQueue();
  queue.add([{name:'ruim.svg',type:'image/svg+xml',size:10}, ...['a.jpg','b.jpg'].map(name=>({name,type:'image/jpeg',size:100}))]);
  const states=[]; let requests=0;
  await uploadPhotos({async uploadImage(){requests++;throw {code:'session_expired'};}},'produto',queue.items,0,{onState:event=>states.push(event)});
  assert.equal(requests,1);
  assert.deepEqual(states.map(x=>x.state),['error','sending','error','error']);
  assert.match(states.at(-1).reason,/sessão expirada/);
});
