const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {createProgressStore}=require('./progress-store');
test('continue watching replaces a completed episode with next unwatched across seasons and survives restart',{timeout:20000},async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cinema-nextup-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await fs.mkdir(path.join(root,'movies'));
  const raw=(id,season,index,played=false)=>({Id:id,Name:`Episode ${id}`,Type:'Episode',SeriesId:'s',SeriesName:'Fixture show',ParentIndexNumber:season,IndexNumber:index,RunTimeTicks:900000000,UserData:{Played:played}});
  const all=[raw('1',1,1),{...raw('2',1,2,true),IndexNumberEnd:3},raw('3',1,3),raw('4',2,1)];
  all[0].UserData={PlaybackPositionTicks:90000000,LastPlayedDate:'2026-01-01T00:00:00Z'};
  const mock=http.createServer((req,res)=>{
    const u=new URL(req.url,'http://fixture');let body={};res.setHeader('Content-Type','application/json');
    if(u.pathname==='/emby/Users/AuthenticateByName') body={AccessToken:'fixture',User:{Id:'u',Name:'Fixture'}};
    else if(u.pathname==='/emby/Users/u/Views') body={Items:[]};
    else if(u.pathname==='/emby/Users/u/Items') body={Items:all,TotalRecordCount:4}; // Deliberately ignores IsResumable like this server.
    else if(u.pathname==='/emby/Shows/s/Episodes') body={Items:[all[2],all[3],all[1],all[0]],TotalRecordCount:4};
    else if(u.pathname==='/emby/Shows/NextUp') body={Items:[all[0]]}; // Stale native recommendation must not win.
    else if(u.pathname.startsWith('/emby/Users/u/Items/')) body=all.find(x=>x.Id===u.pathname.split('/').at(-1)) || {};
    else {res.statusCode=404;}
    res.end(JSON.stringify(body));
  });
  await new Promise(resolve=>mock.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>mock.close(resolve)));
  const server=`http://127.0.0.1:${mock.address().port}`,directory=path.join(root,'progress');
  const store=createProgressStore({directory});
  const tracked=await store.startSession({kind:'emby',server,userId:'u',itemId:'2',item:{id:'emby-2',title:'Episode2-3',type:'Episode',seriesId:'s',parentIndexNumber:1,indexNumber:2,indexNumberEnd:3}});
  await fs.writeFile(tracked.file,JSON.stringify({position:86,duration:90,event:'stopped',sequence:1}));await store.poll();
  const portServer=http.createServer();await new Promise(resolve=>portServer.listen(0,'127.0.0.1',resolve));const port=portServer.address().port;await new Promise(resolve=>portServer.close(resolve));
  const child=spawn(process.execPath,['server.js'],{cwd:__dirname,windowsHide:true,stdio:'ignore',env:{...process.env,MPV_LIBRARY_ROOT:path.join(root,'movies'),MPV_LIBRARY_PORT:String(port),MPV_EMBY_URL:server,MPV_PROGRESS_DIR:directory,MPV_LIBRARY_USER_DATA:path.join(root,'user.json'),MPV_EMBY_SESSION_FILE:path.join(root,'session.json'),MPV_WATCH_LATER_DIR:path.join(root,'none')}});
  t.after(()=>child.kill());const local=`http://127.0.0.1:${port}`;
  for(let n=0;n<100;n++){try{if((await fetch(local+'/api/library')).ok)break;}catch{}await new Promise(resolve=>setTimeout(resolve,50));}
  assert.equal((await fetch(local+'/api/emby/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:server,username:'fixture',password:'fixture',remember:false})})).status,200);
  const response=await fetch(local+'/api/resume'),data=await response.json();
  assert.equal(response.status,200,JSON.stringify(data));
  assert.deepEqual(data.items.map(x=>x.id),['emby-4']);
  assert.equal(data.items[0].nextUp,true);
  assert.equal(data.items[0].resumeSeconds,0);
  assert.equal(data.items[0].parentIndexNumber,2);
  const detail=await (await fetch(local+'/api/emby/item/2')).json();
  assert.equal(detail.indexNumberEnd,3,'combined boundary is preserved in the public item persisted into player sessions');
});
