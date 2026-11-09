const test=require('node:test'),assert=require('node:assert/strict');
const {parseTmdbCast,createCastEnricher}=require('./cast-enrichment');
test('cast parser reads billed actor IDs and order without mixing in crew',()=>{
 const html='<ol class="people credits "><li data-order="0"><a href="/person/11?language=zh-CN">A</a><p class="character"><a>Hero</a><span>(14 集)</span></p></li><li data-order="1"><a href="/person/22">B</a><p class="character">Friend</p></li></ol><ol class="people credits crew"><li><a href="/person/33">Director</a></li></ol>';
 assert.deepEqual(parseTmdbCast(html).map(p=>[p.id,p.order]),[['11',0],['22',1]]);
});
test('ranking joins external person IDs, retains a multi-role person, and applies only sourced Chinese roles',async()=>{
 const source='<ol class="people credits "><li data-order="0"><a href="/person/1156197">A</a></li><li data-order="1"><a href="/person/1613823">B</a></li></ol>';
 const service=createCastEnricher({account:()=> 'a',fetchHtml:async()=>source,person:async id=>({ProviderIds:{Tmdb:id==='a'?'1156197':'1613823'}})});
 const data=await service.enrich([{id:'b',type:'Actor',role:'Han Da-on'},{id:'d',type:'Director',role:'Director'},{id:'a',type:'Actor',role:'Kang Bit-na'},{id:'a',type:'Director',role:'Director'}],{Type:'Series',ProviderIds:{Tmdb:'235577'}});
 assert.equal(data[0].id,'a');assert.equal(data[0].roleZh,'姜光娜');assert.equal(data[1].roleZh,'韩多温');assert.equal(data.filter(p=>p.type==='Director').length,2);
 const other=await service.enrich([{id:'a',type:'Actor',role:'Unrelated character'}],{Type:'Series',ProviderIds:{Tmdb:'999'}});assert.equal(other[0].roleZh,undefined);
});
test('verified billing outranks native guest rank and failed sources retry',async()=>{
 let time=0,calls=0,lookups=0;
 const service=createCastEnricher({now:()=>time,account:()=> 'a',fetchHtml:async()=>{if(++calls===1)throw Error('offline');return '<ol class="people credits"><li><a href="/person/11">A</a></li></ol>';},person:async()=>{if(++lookups===1)throw Error('offline');return {ProviderIds:{Tmdb:'11'}};}});
 const people=[{id:'guest',tmdbId:'99',type:'Actor',billingOrder:0},{id:'lead',type:'Actor'}],meta={Type:'Series',ProviderIds:{Tmdb:'12'}};
 await service.enrich(people,meta);time=31000;await service.enrich(people,meta);time=62000;
 const result=await service.enrich(people,meta);assert.equal(result[0].id,'lead');assert.equal(calls,2);assert.equal(lookups,2);
});
test('deadline stops scheduling remaining actor batches',async()=>{
 let time=0,calls=0;const service=createCastEnricher({now:()=>time,account:()=> 'a',fetchHtml:async()=>'<ol class="people credits"><li><a href="/person/11">A</a></li></ol>',person:async()=>{calls++;time=7000;return {ProviderIds:{Tmdb:'11'}};}});
 await service.enrich(Array.from({length:80},(_,i)=>({id:String(i),type:'Actor'})),{Type:'Movie',ProviderIds:{Tmdb:'1'}});assert.equal(calls,4);
});
test('official role mappings work despite cast source outage and community Chinese roles are attributed separately',async()=>{
 const service=createCastEnricher({account:()=> 'a',fetchHtml:async()=>{throw Error('offline');},person:async()=>({ProviderIds:{Tmdb:'3874251'}})});
 const result=await service.enrich([{id:'native',type:'Actor',role:'Myung Ja-eun'}],{Type:'Series',ProviderIds:{Tmdb:'227192'}});
 assert.equal(result[0].roleZh,'明子恩');assert.match(result[0].roleSource,/gtv.com.tw/);
 const translated=createCastEnricher({account:()=> 'a',fetchHtml:async url=>'<ol class="people credits"><li><a href="/person/1">A</a><p class="character">'+(url.includes('en-US')?'Li Ming':'李明')+'</p></li></ol>',person:async()=>({})});
 const people=await translated.enrich([{tmdbId:'1',type:'Actor',role:'Li Ming'}],{Type:'Movie',ProviderIds:{Tmdb:'123'}});
 assert.equal(people[0].roleZh,'李明');assert.equal(people[0].roleSourceLabel,'TMDB 中文演职资料');const different=await translated.enrich([{tmdbId:'1',type:'Actor',role:'Other character'}],{Type:'Movie',ProviderIds:{Tmdb:'123'}});assert.equal(different[0].roleZh,undefined);
});
