const test=require('node:test');
const assert=require('node:assert/strict');
const {createEpisodeNavigator,chooseNextSource}=require('./episode-next');
const episode=(id,season,index,extra={})=>({embyId:id,type:'Episode',seriesId:'show',parentIndexNumber:season,indexNumber:index,...extra});
test('next episode uses numeric order across seasons, excludes specials, missing files and other shows',async()=>{
  const list=[episode('s2e1',2,1),episode('special',0,1),episode('s1e10',1,10),episode('s1e2',1,2),episode('missing',1,3,{missing:true}),episode('alien',1,4,{seriesId:'other'})];
  const nav=createEpisodeNavigator({loadEpisodes:async()=>list,isWatched:async()=>false});
  assert.equal((await nav.next(episode('s1e2',1,2))).embyId,'s1e10');
  assert.equal((await nav.next(episode('s1e10',1,10))).embyId,'s2e1');
  assert.equal(await nav.next(episode('s2e1',2,1)),null);
  assert.equal(await nav.next({type:'Movie'}),null);
});
test('continue watching skips already watched episodes but autoplay follows the actual sequence',async()=>{
  const nav=createEpisodeNavigator({loadEpisodes:async()=>[episode('2',1,2),episode('3',1,3)],isWatched:async x=>x.embyId==='2'});
  assert.equal((await nav.next(episode('1',1,1))).embyId,'2');
  assert.equal((await nav.next(episode('1',1,1),{skipWatched:true})).embyId,'3');
});
test('next source preserves selected resolution and range, with direct best-quality fallback',()=>{
  const list=[{id:'4k',height:2160,range:'HDR10',direct:true},{id:'1080',height:1080,range:'SDR',direct:true},{id:'bad',height:1080,range:'SDR',direct:false}];
  assert.equal(chooseNextSource(list,{height:1080,range:'SDR'}).id,'1080');
  assert.equal(chooseNextSource(list,{height:720,range:'SDR'}).id,'4k');
});
