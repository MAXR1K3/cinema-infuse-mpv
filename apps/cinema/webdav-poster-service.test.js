const test=require('node:test'),assert=require('node:assert/strict');const {createDavPosterService}=require('./webdav-poster-service');
test('native covers take priority, requests coalesce and metadata account changes invalidate results',async()=>{
 let count=0,owner='a';const image={type:'image/png',bytes:Buffer.from('png')};
 const service=createDavPosterService({webdav:{entry:async()=>({name:'Movie.2024.mkv'}),artwork:async()=>{count++;return image;}},account:()=>owner,search:async()=>{throw Error('Native should win');},artwork:async()=>null});
 const results=await Promise.all([service.get('c','/a'),service.get('c','/a')]);assert.equal(count,1);assert.equal(results[0],image);owner='b';await service.get('c','/a');assert.equal(count,2);
});
test('Emby metadata fallback is exact, and never returns the previous account artwork',async()=>{
 let owner='a',finish;const wait=new Promise(resolve=>finish=resolve);
 const service=createDavPosterService({webdav:{entry:async()=>({name:'Movie.2024.mkv'}),artwork:async()=>null},account:()=>owner,search:async()=>{await wait;return [{Id:'1',Type:'Movie',Name:'Movie',ProductionYear:2024,ImageTags:{Primary:'p'}}];},artwork:async()=>{throw Error('Account guard should stop image request');}});
 const result=service.get('c','/a');await new Promise(resolve=>setImmediate(resolve));owner='b';finish();assert.equal(await result,null);
});
