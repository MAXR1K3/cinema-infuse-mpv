const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

async function freePort() {
  const server = http.createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}

test('series exposes ordered seasons, while selected season returns numbered episodes instead of a flat cross-season list', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mpv-seasons-'));
  const movies = path.join(root, 'movies'); await fs.mkdir(movies);
  t.after(() => fs.rm(root, {recursive:true,force:true}));
  const requests = [];
  const seasonSorts = [];
  const mock = http.createServer((req,res) => {
    const url = new URL(req.url,'http://127.0.0.1'); requests.push(url.pathname);
    res.setHeader('Content-Type','application/json');
    let body;
    if (url.pathname === '/emby/Users/AuthenticateByName') body = {AccessToken:'fixture-token',User:{Id:'u2',Name:'Fixture'}};
    else if (url.pathname === '/emby/Users/u2/Views') body = {Items:[{Id:'v1',Name:'TV'}]};
    else if (url.pathname === '/emby/Users/u2/Items') {
      const parent = url.searchParams.get('ParentId');
      if (parent === 'season1') seasonSorts.push(url.searchParams.get('SortBy'));
      body = parent === 'season1' ? {Items:[
        {Id:'ep1',Name:'开篇',Type:'Episode',SeasonId:'season1',SeriesId:'series1',ParentIndexNumber:1,IndexNumber:1},
        {Id:'ep2',Name:'转折',Type:'Episode',SeasonId:'season1',SeriesId:'series1',ParentIndexNumber:1,IndexNumber:2}
      ],TotalRecordCount:2} : parent === 'season2' ? {Items:Array.from({length:105},(_,i)=>({Id:`s2-ep-${i+1}`,Name:`Episode ${i+1}`,Type:'Episode',SeasonId:'season2',SeriesId:'series1',ParentIndexNumber:2,IndexNumber:i+1})).slice(Number(url.searchParams.get('StartIndex')||0),Number(url.searchParams.get('StartIndex')||0)+100),TotalRecordCount:105} : parent === 'v1' ? {Items:[{Id:'series2',Name:'超长剧',Type:'Series',IsFolder:true}],TotalRecordCount:1} : {Items:[{Id:'ep1',Name:'开篇',Type:'Episode',SeriesId:'series1'}],TotalRecordCount:1};
    } else if (url.pathname === '/emby/Users/u2/Items/ep1') body = {Id:'ep1',Name:'开篇',Type:'Episode',SeriesId:'series1',ParentIndexNumber:1,IndexNumber:1};
    else if (url.pathname === '/emby/Users/u2/Items/series1') body = {Id:'series1',Name:'故事',Type:'Series',IsFolder:true};
    else if (url.pathname === '/emby/Shows/series1/Seasons') body = {Items:[
      {Id:'season2',Name:'Season 2',Type:'Season',IsFolder:true,IndexNumber:2},
      {Id:'specials',Name:'Specials',Type:'Season',IsFolder:true,IndexNumber:0},
      {Id:'season1',Name:'Season 1',Type:'Season',IsFolder:true,IndexNumber:1}
    ],TotalRecordCount:3};
    else if (url.pathname === '/emby/Shows/series2/Seasons') {
      const start = Number(url.searchParams.get('StartIndex') || 0);
      const limit = Number(url.searchParams.get('Limit') || 100);
      const all = Array.from({length:105},(_,index)=>({Id:`long-season-${index+1}`,Name:`Season ${index+1}`,Type:'Season',IsFolder:true,IndexNumber:index+1}));
      body = {Items:all.slice(start,start+limit),TotalRecordCount:null};
    }
    else {res.statusCode=404;body={};}
    res.end(JSON.stringify(body));
  });
  await new Promise(resolve=>mock.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>mock.close(resolve)));
  const embyUrl=`http://127.0.0.1:${mock.address().port}`;
  const port=await freePort();
  const proc=spawn(process.execPath,['server.js'],{cwd:__dirname,stdio:'ignore',windowsHide:true,env:{...process.env,MPV_LIBRARY_PORT:String(port),MPV_LIBRARY_ROOT:movies,MPV_EMBY_URL:embyUrl,MPV_LIBRARY_USER_DATA:path.join(root,'user.json'),MPV_EMBY_SESSION_FILE:path.join(root,'session.json')}});
  t.after(()=>proc.kill());
  for(let n=0;n<80;n++) {try{if((await fetch(`http://127.0.0.1:${port}/api/library`)).ok)break;}catch{} await new Promise(resolve=>setTimeout(resolve,75));}
  const local=`http://127.0.0.1:${port}`;
  const login=await fetch(local+'/api/emby/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:embyUrl,username:'fixture',password:'fixture',remember:false})});
  assert.equal(login.status,200);
  await fetch(local+'/api/emby/item/ep1'); // Resolve the Series from a real episode relationship.
  const seasonsResponse=await fetch(local+'/api/emby/seasons?series=series1');
  assert.equal(seasonsResponse.status,200);
  const seasons=await seasonsResponse.json();
  assert.deepEqual(seasons.items.map(x=>x.indexNumber),[1,2,0]);
  assert.deepEqual(seasons.items.map(x=>x.type),['Season','Season','Season']);
  assert.equal(seasons.total,3);
  const episodesResponse=await fetch(local+'/api/emby/items?parent=season1');
  assert.equal(episodesResponse.status,200);
  const episodes=await episodesResponse.json();
  assert.equal(episodes.total,2);
  assert.deepEqual(episodes.items.map(x=>[x.seasonId,x.parentIndexNumber,x.indexNumber]),[['season1',1,1],['season1',1,2]]);
  assert.deepEqual(seasonSorts,['IndexNumber']);
  const s2first = await (await fetch(local+'/api/emby/items?parent=season2')).json();
  const s2last = await (await fetch(local+'/api/emby/items?parent=season2&start=100')).json();
  assert.equal(s2first.total,105);
  assert.equal(s2first.hasMore,true);
  assert.equal(s2first.items.length,100);
  assert.equal(s2last.items.length,5);
  assert.equal(s2last.hasMore,false);
  assert.equal(new Set([...s2first.items,...s2last.items].map(x=>x.id)).size,105);
  assert.deepEqual([...s2first.items,...s2last.items].map(x=>x.indexNumber),Array.from({length:105},(_,i)=>i+1));
  assert.equal(requests.filter(x=>x==='/emby/Shows/series1/Seasons').length,1);
  assert.equal((await fetch(local+'/api/emby/seasons?series=not-registered')).status,404);
  await fetch(local+'/api/emby/items?parent=v1'); // Cache another accessible Series.
  const longSeasons = await (await fetch(local+'/api/emby/seasons?series=series2')).json();
  assert.equal(longSeasons.total,105);
  assert.equal(longSeasons.items.length,105);
  assert.equal(new Set(longSeasons.items.map(x=>x.id)).size,105);
  assert.equal(longSeasons.items.at(-1).indexNumber,105);
  assert.equal(requests.filter(x=>x==='/emby/Shows/series2/Seasons').length,2);
});
