const test=require('node:test'),assert=require('node:assert/strict');
const {normalizeCredits,createCreditsService}=require('./credits');
test('episode guest credits merge with series cast, preserving IDs, roles and portraits without name-based identity merging',()=>{
 const result=normalizeCredits([{Id:'a',Name:'Actor',Role:'Guest',Type:'Actor'}],[{Id:'a',Name:'Actor',Role:'Lead',PrimaryImageTag:'tag',Type:'Actor'},{Id:'b',Name:'Actor',Type:'Actor',PrimaryImageTag:'tag2'}]);
 assert.equal(result.length,2);assert.equal(result[0].role,'Guest');assert.equal(result[0].imageTag,'tag');assert.equal(result[1].id,'b');
});
test('raw upstream cursor survives invalid entries and verification exclusions',async()=>{
 const rows=Array.from({length:40},(_,i)=>i===0?{}:{Id:String(i),Type:'Movie',People:[{Id:'other'}]});
 const service=createCreditsService({account:()=> 'a',request:async()=>({json:async()=>({Items:rows,TotalRecordCount:80})})});
 const page=await service.works({id:'actor'},0,'u');assert.equal(page.nextStart,40);assert.equal(page.hasMore,true);assert.equal(page.items.length,0);
});
test('an account switch rejects stale actor work responses',async()=>{
 let account='a',resolve;
 const service=createCreditsService({account:()=>account,request:()=>new Promise(r=>resolve=r)});
 const request=service.works({id:'actor'},0,'u');account='b';resolve({json:async()=>({Items:[]})});
 await assert.rejects(request,/登录状态已变更/);
});
test('works are verified by exact person ID; an ignored native filter and homonyms cannot leak unrelated titles',async()=>{
 const service=createCreditsService({account:()=> 'account',request:async api=>({json:async()=>api.includes('?') ? {Items:[{Id:'1',Type:'Movie'},{Id:'2',Type:'Movie'},{Id:'3',Type:'Series'}],TotalRecordCount:3} : ({Id:api.split('/').at(-1),Type:'Movie',People:[{Id:api.endsWith('/1')?'actor':'other',Name:'Same name'}]})})});
 const page=await service.works({id:'actor',name:'Same name'},0,'u');assert.deepEqual(page.items.map(x=>x.Id),['1']);assert.equal(page.hasMore,false);assert.equal(page.total,1);
});
