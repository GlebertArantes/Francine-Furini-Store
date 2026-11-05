import { test } from "node:test";
import assert from "node:assert/strict";
import { createInaugurationAccess, FRAN_LOGIN, INAUGURATION_KEY } from "../../admin/js/lib/inauguration.js";
const memory = () => { const m = new Map(); return { getItem:k=>m.get(k),setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k) }; };
function setup({ email = FRAN_LOGIN, count = 0, fail = false } = {}) {
  const user = { id:"fran-id", email, user_metadata:{ untouched:"preserve", [INAUGURATION_KEY]:{ views:count } } };
  const calls=[];
  const auth={user:{id:user.id,email},getAccessToken:async()=>"user-token"};
  const fetchFn=async(url,init)=>{
    calls.push({url,init});
    if(fail) throw new TypeError("offline");
    if(init.method==="PUT") {
      assert.deepEqual(Object.keys(JSON.parse(init.body)),["data"]);
      Object.assign(user.user_metadata,JSON.parse(init.body).data);
    }
    return new Response(JSON.stringify(user),{status:200});
  };
  const options={auth,url:"https://example.supabase.co",key:"sb_publishable_test",fetchFn};
  return {options,user,calls,auth};
}
test("inauguração acompanha a conta entre aparelhos e para depois de dez acessos",async()=>{
  const {options,user,calls}=setup();
  for(let i=1;i<=10;i++) assert.equal(await createInaugurationAccess({...options,tabStorage:memory()}).claim(),i);
  assert.equal(await createInaugurationAccess({...options,tabStorage:memory()}).claim(),0);
  assert.equal(user.user_metadata[INAUGURATION_KEY].views,10);
  assert.equal(user.user_metadata.untouched,"preserve");
  assert.equal(calls.filter(c=>c.init.method==="PUT").length,10);
  for(const c of calls) assert.equal(c.init.headers.authorization,"Bearer user-token");
});
test("atualizar a aba não consome acesso; sair e entrar conta novo acesso",async()=>{
  const {options}=setup();const tabStorage=memory();
  const first=createInaugurationAccess({...options,tabStorage});
  assert.equal(await first.claim(),1);assert.equal(await first.claim(),0);
  const reload=createInaugurationAccess({...options,tabStorage});
  assert.equal(await reload.claim(),0);
  reload.reset();assert.equal(await reload.claim(),2);
});
test("outros admins e contas divergentes não recebem a faixa",async()=>{
  const other=setup({email:"outro@exemplo.com"});
  assert.equal(await createInaugurationAccess(other.options).claim(),0);assert.equal(other.calls.length,0);
  const changed=setup();changed.user.id="someone-else";
  assert.equal(await createInaugurationAccess(changed.options).claim(),0);
  assert.equal(changed.calls.length,1);
});
test("falha de rede não bloqueia painel nem mostra convite sem salvar a contagem",async()=>{
  const {options,user}=setup({fail:true});
  assert.equal(await createInaugurationAccess(options).claim(),0);
  assert.equal(user.user_metadata[INAUGURATION_KEY].views,0);
});

test("contagem anterior de três acessos continua até dez, sem reiniciar",async()=>{
  const {options,user}=setup({count:3});
  assert.equal(await createInaugurationAccess(options).claim(),4);
  assert.equal(user.user_metadata[INAUGURATION_KEY].views,4);
});
