import { test, before } from "node:test";
import assert from "node:assert/strict";
import { installFakeDom, findAll, textOf, flush } from "../helpers/fake-dom.js";
import { contactUrl, floatingContactView, vipInviteSection, VIP_GROUP_URL } from "../../storefront/js/views/contact.js";
import { homeView } from "../../storefront/js/views/home.js";
before(()=>installFakeDom());

test("contato usa o número configurado e mensagem pública, sem abrir ou enviar sozinho",()=>{
 const link=new URL(contactUrl("+55 (34) 99999-0000"));
 assert.equal(link.hostname,"wa.me");assert.equal(link.pathname,"/5534999990000");assert.match(link.searchParams.get("text"),/Olá, Fran!/);
 for(const value of [null,undefined,"","123","abc"])assert.equal(contactUrl(value),null);
 assert.notEqual(contactUrl("5534999990000"),contactUrl("5534999991111"));
});
test("flutuante aparece com configuração válida; checkout, carrinho e pedido preservam o fluxo próprio",()=>{
 const view=floatingContactView();
 view.update({whatsapp_number:"5534999990000"},"/produto/camisa");
 const link=findAll(view.root,e=>e.tag==="a")[0];
 assert.equal(link.getAttribute("href"),contactUrl("5534999990000"));assert.equal(link.getAttribute("rel"),"noopener noreferrer");assert.match(link.getAttribute("aria-label"),/Falar com a Fran/);
 for(const route of ["/checkout","/carrinho","/pedido"]){view.update({whatsapp_number:"5534999990000"},route);assert.equal(view.root.children.length,0);}
 view.update({},"/");assert.equal(view.root.children.length,0);
});
test("convite VIP usa o convite aprovado e é distinto do atendimento individual",()=>{
 const view=vipInviteSection();const link=findAll(view,e=>e.tag==="a")[0];
 assert.equal(link.getAttribute("href"),VIP_GROUP_URL);assert.equal(link.getAttribute("target"),"_blank");assert.equal(link.getAttribute("rel"),"noopener noreferrer");
 assert.match(textOf(view),/entre no GRUPO VIP/);assert.equal(findAll(view,e=>e.tag==="svg").length,3);
 assert.ok(!/cupom|desconto|sorteio|somente hoje/i.test(textOf(view)));
});
test("convite visível na home antes da coleção; busca e categoria continuam focadas nos resultados",async()=>{
 const ctx={load:async()=>{},settings:{},products:[],categories:[]};
 const all=homeView(ctx,new URLSearchParams());await flush();
 assert.equal(findAll(all,e=>e.getAttribute("aria-labelledby")==="vip-invite-title").length,1);
 for(const query of ["q=camisa","cat=camisas"]){const filtered=homeView(ctx,new URLSearchParams(query));await flush();assert.equal(findAll(filtered,e=>e.getAttribute("aria-labelledby")==="vip-invite-title").length,0);}
});
