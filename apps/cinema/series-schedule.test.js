const test=require('node:test'),assert=require('node:assert/strict');const {createSeriesScheduleService}=require('./series-schedule');
const raw={Type:'Series',Name:'测试剧集',OriginalTitle:'Fixture Series',ProductionYear:2026,Status:'Continuing'};
const show={id:42,name:'Fixture Series',premiered:'2026-02-01',status:'Running',schedule:{days:['Friday'],time:'21:00'},network:{country:{timezone:'America/New_York'}},url:'https://www.tvmaze.com/shows/42/fixture-series',_embedded:{nextepisode:{season:1,number:6,airdate:'2099-01-01',airtime:'21:00',airstamp:'2099-01-02T02:00:00Z'}}};
test('verified TMDB English name can recover a missing TVmaze ID lookup, but conflicting IDs cannot',async()=>{
 const metadata={...raw,OriginalTitle:'กฎหลังเที่ยงคืน',IdentityTitle:'Fixture Series',IdentitySource:'https://www.themoviedb.org/tv/330613',ProviderIds:{Imdb:'tt50252733'},TmdbStatus:'Continuing',Status:'Ended'};
 const service=createSeriesScheduleService({request:async url=>url.pathname==='/lookup/shows'?new Response(null,{status:404}):new Response(JSON.stringify(url.pathname==='/search/shows'?[{show}]:show))});assert.equal((await service.get(metadata)).availability,'scheduled');
 const absent=createSeriesScheduleService({request:async()=>new Response(null,{status:404})});const result=await absent.get(metadata);assert.equal(result.kind,'airing');assert.match(result.source,/TMDB/);assert.equal(result.nextAirDate,'');
 const conflict=createSeriesScheduleService({request:async url=>url.pathname==='/lookup/shows'?new Response(null,{status:404}):new Response(JSON.stringify(url.pathname==='/search/shows'?[{show}]:{...show,externals:{imdb:'tt9999999'}}))});assert.notEqual((await conflict.get(metadata)).availability,'scheduled');
});
test('schedule uses a unique original-name/year match with attribution, timezone and next episode; concurrent work coalesces',async()=>{
 let calls=0;const service=createSeriesScheduleService({now:()=>Date.parse('2026-11-15T12:00:00Z'),request:async url=>{calls++;return new Response(JSON.stringify(url.pathname==='/search/shows'?[{show}]:show));}});
 const [a,b]=await Promise.all([service.get(raw),service.get(raw)]);assert.equal(calls,2);assert.deepEqual(a,b);assert.match(a.schedule,/周五/);assert.match(a.schedule,/America\/New_York/);assert.equal(a.nextEpisodeLabel,'S01E06');assert.equal(a.nextAirDate,'2099-01-02T02:00:00.000Z');assert.match(a.source,/原名/);assert.equal(a.sourceUrl,show.url);
});
test('ambiguous matches, wrong years and network failures preserve native state without inventing a schedule',async()=>{
 for(const response of [[{show},{show:{...show,id:43}}],[{show:{...show,premiered:'2025-01-01'}}]]){const service=createSeriesScheduleService({request:async()=>new Response(JSON.stringify(response))});const result=await service.get(raw);assert.equal(result.nextAirDate,'');assert.equal(result.availability,'unmatched');assert.equal(result.label,'连载中');}
 const service=createSeriesScheduleService({request:async()=>{throw Error('private network detail');}});const result=await service.get(raw);assert.equal(result.availability,'unavailable');assert.ok(!JSON.stringify(result).includes('private'));
});
test('unannounced next episode never means ended, date-only next dates never become invented midnight times',async()=>{
 const service=createSeriesScheduleService({request:async url=>new Response(JSON.stringify(url.pathname==='/search/shows'?[{show}]:{...show,schedule:{days:[],time:''},_embedded:{nextepisode:{season:2,number:1,airdate:'2099-01-01'}}}))});const result=await service.get(raw);assert.equal(result.nextAirDate,'2099-01-01');assert.equal(result.nextAirDatePrecision,'date');
 const absent=createSeriesScheduleService({request:async url=>new Response(JSON.stringify(url.pathname==='/search/shows'?[{show}]:{...show,schedule:{days:[],time:''},_embedded:{}}))});assert.equal((await absent.get(raw)).label,'连载中');assert.equal((await absent.get(raw)).availability,'no_next_episode');
});
test('ID lookup verifies external IDs, rejects foreign redirects and reports stale Emby ended flags',async()=>{
 const idRaw={...raw,Status:'Ended',ProviderIds:{Imdb:'tt1234567'}};let calls=0;
 const service=createSeriesScheduleService({request:async url=>{calls++;return url.pathname==='/lookup/shows'?new Response(null,{status:301,headers:{location:'https://api.tvmaze.com/shows/42'}}):new Response(JSON.stringify({...show,externals:{imdb:'tt1234567'}}));}});
 const result=await service.get(idRaw);assert.equal(calls,2);assert.equal(result.kind,'airing');assert.match(result.statusConflict,/已完结/);assert.match(result.source,/平台 ID/);
 const wrong=createSeriesScheduleService({request:async()=>new Response(JSON.stringify({...show,externals:{imdb:'tt9999999'}}))});assert.equal((await wrong.get(idRaw)).availability,'unmatched');
 let redirects=0;const unsafe=createSeriesScheduleService({request:async()=>{redirects++;return new Response(null,{status:301,headers:{location:'https://foreign.invalid/shows/42'}});}});assert.equal((await unsafe.get(idRaw)).availability,'unavailable');assert.equal(redirects,1);
});
