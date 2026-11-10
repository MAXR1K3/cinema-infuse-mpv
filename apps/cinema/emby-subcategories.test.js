const test=require('node:test'),assert=require('node:assert/strict');const {parseSubfilters,filterSubitems,createSubcategoryService}=require('./emby-subcategories');
test('combined subfilters validate and apply years, actual series status and watched markers',()=>{
 const filters=parseSubfilters(new URLSearchParams('genre=16&year=2020-2024&status=Ended&watched=unplayed'));
 const items=[{ProductionYear:2024,Status:'Ended',UserData:{Played:false}},{ProductionYear:2026,Status:'Ended',UserData:{Played:false}},{ProductionYear:2024,Status:'Continuing',UserData:{Played:false}}];assert.deepEqual(filterSubitems(items,filters),[items[0]]);assert.throws(()=>parseSubfilters(new URLSearchParams('year=2024-2000')));
});
test('complete raw pagination yields correct filtered totals even when server ignores year filtering',async()=>{
 let calls=0;const service=createSubcategoryService({account:()=> 'a',request:async q=>{calls++;const start=Number(q.get('StartIndex'));assert.equal(q.get('GenreIds'),'16');return {Items:Array.from({length:start===0?2:1},(_,i)=>({Id:String(start+i),ProductionYear:start+i===2?2024:2026,Type:'Movie'})),TotalRecordCount:3};}});
 const result=await service.browse({parent:'movies',kind:'Movie',filters:{genre:'16',year:'2024'}});assert.equal(result.total,1);assert.equal(result.items[0].Id,'2');await service.browse({parent:'movies',kind:'Movie',filters:{genre:'16',year:'2026'}});assert.equal(calls,2);
});
test('partial pages and account changes cannot produce a misleading filtered library',async()=>{
 let owner='a';const service=createSubcategoryService({account:()=>owner,request:async()=>{owner='b';return {Items:[],TotalRecordCount:0};}});await assert.rejects(service.browse({parent:'m',kind:'Movie',filters:{}}),/登录状态/);
});
test('watched-state updates invalidate cached user data',async()=>{
 let played=false,calls=0;const service=createSubcategoryService({account:()=> 'a',request:async()=>{calls++;return {Items:[{Id:'1',UserData:{Played:played}}],TotalRecordCount:1};}});
 assert.equal((await service.browse({parent:'m',kind:'Movie',filters:{watched:'unplayed'}})).total,1);played=true;service.invalidate();assert.equal((await service.browse({parent:'m',kind:'Movie',filters:{watched:'unplayed'}})).total,0);assert.equal(calls,2);
});

test('rating order is computed over the complete filtered index before pagination',async()=>{const rows=[{Id:'low',CommunityRating:1,ProductionYear:2024},{Id:'missing',ProductionYear:2024},{Id:'high',CommunityRating:9,ProductionYear:2024,CriticRating:0}];const service=createSubcategoryService({account:()=> 'a',request:async q=>({Items:rows.slice(Number(q.get('StartIndex')),Number(q.get('StartIndex'))+Number(q.get('Limit'))),TotalRecordCount:rows.length})});const page=await service.browse({parent:'m',kind:'Movie',filters:{year:'2024'},sort:'community'});assert.deepEqual(page.items.map(x=>x.Id),['high','low','missing']);assert.equal(page.items[0].CriticRating,0);});
