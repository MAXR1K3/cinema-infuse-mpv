const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createProgressStore, readWatchLater } = require('./progress-store');

const context = { kind:'emby', server:'https://media.example', userId:'viewer', itemId:'episode1', item:{id:'emby-episode1',title:'本集',type:'Episode'} };
test('subtitle associations survive new sessions but isolate account, episode and source version',async t=>{
 const directory=await fixture(t),store=createProgressStore({directory});
 const first=await store.startSession(context,{sourceId:'4k'}),again=await store.startSession({...context,media:'a-new-signed-url'},{sourceId:'4k'});
 assert.equal(first.subtitleFile,again.subtitleFile);
 for(const [other,sourceId] of [[{...context,userId:'other'},'4k'],[{...context,itemId:'episode2'},'4k'],[context,'1080p']])assert.notEqual((await store.startSession(other,{sourceId})).subtitleFile,first.subtitleFile);
});
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(),'cinema-progress-'));
  t.after(() => fs.rm(directory,{recursive:true,force:true}));
  return directory;
}
async function write(session,position,extra={}) {
  await fs.writeFile(session.file,JSON.stringify({position,duration:3600,paused:false,event:'progress',sequence:Date.now(),...extra}));
}
test('progress survives new playback URLs and a store restart, while servers and accounts remain isolated', async t => {
  const directory = await fixture(t), updates=[];
  let store=createProgressStore({directory,onUpdate:async (...args)=>updates.push(args)});
  const one=await store.startSession(context,{sourceId:'4k',startSeconds:0});
  await write(one,732.5,{event:'start',sequence:1}); await store.poll();
  await write(one,745.2,{event:'stopped',sequence:2}); await store.poll();
  assert.deepEqual(updates.map(u=>u[2]),['start','stopped']);
  store=createProgressStore({directory});
  assert.equal((await store.get(context,'4k')).resumeSeconds,745.2);
  assert.equal((await store.get({...context,userId:'another'},'4k')).resumeSeconds,0);
  assert.equal((await store.get({...context,server:'https://other.example'},'4k')).resumeSeconds,0);
  const two=await store.startSession(context,{sourceId:'4k',startSeconds:745.2});
  assert.notEqual(one.id,two.id);
  await write(two,0,{event:'start',sequence:1}); await store.poll();
  assert.equal((await store.get(context,'4k')).resumeSeconds,745.2,'startup zero must not erase a saved resume position');
  await write(two,750,{sequence:2}); await store.poll();
  await write(two,0,{sequence:3}); await store.poll();
  assert.equal((await store.get(context,'4k')).resumeSeconds,0,'an intentional seek to the start is saved');
});
test('versions keep their own positions; another version can inherit the last position; EOF clears resume', async t => {
  const store=createProgressStore({directory:await fixture(t)});
  const first=await store.startSession(context,{sourceId:'hdr'});
  await write(first,600,{event:'stopped',sequence:1}); await store.poll();
  assert.equal((await store.get(context,'dv')).resumeSeconds,600);
  const second=await store.startSession(context,{sourceId:'dv'});
  await write(second,900,{event:'stopped',sequence:1}); await store.poll();
  assert.equal((await store.get(context,'hdr')).resumeSeconds,600);
  assert.equal((await store.get(context,'dv')).resumeSeconds,900);
  const end=await store.startSession(context,{sourceId:'dv'});
  await write(end,3600,{event:'stopped',completed:true,sequence:1}); await store.poll();
  assert.equal((await store.get(context,'dv')).resumeSeconds,0);
  assert.equal((await store.list(context)).length,0,'a completed item leaves continue-watching');
});
test('invalid snapshots and partial writes cannot destroy a good progress record', async t => {
  const store=createProgressStore({directory:await fixture(t)});
  const session=await store.startSession(context,{sourceId:'main'});
  await write(session,450,{sequence:1}); await store.poll();
  for(const data of ['{',JSON.stringify({position:-1,duration:3600,sequence:2}),JSON.stringify({position:'bad',duration:3600,sequence:3})]) {
    await fs.writeFile(session.file,data); await store.poll();
    assert.equal((await store.get(context,'main')).resumeSeconds,450);
  }
});
test('newer native Emby progress wins; server errors cannot prevent local persistence', async t => {
  const store=createProgressStore({directory:await fixture(t),onUpdate:async()=>{throw Error('offline')}});
  const session=await store.startSession(context,{sourceId:'main'});
  await write(session,450,{event:'stopped',sequence:1}); await store.poll();
  assert.equal((await store.get(context,'main')).resumeSeconds,450);
  const newer={positionSeconds:840,durationSeconds:3600,lastPlayedAt:new Date(Date.now()+10000).toISOString(),completed:false};
  assert.equal((await store.get(context,'main',newer)).resumeSeconds,840);
  assert.equal((await store.get(context,'main',{...newer,positionSeconds:0,completed:true})).resumeSeconds,0);
});
test('legacy watch-later imports the correct episode despite a changing stream token, and matches local paths exactly',async t=>{
  const directory=await fixture(t);
  await fs.writeFile(path.join(directory,'A'),'# http://127.0.0.1:7788/stream/emby-episode1?play=old-token\nstart=712.500000\n');
  await fs.writeFile(path.join(directory,'B'),'# http://127.0.0.1:7788/stream/emby-other?play=another\nstart=999\n');
  await fs.writeFile(path.join(directory,'C'),'# Z:\\Movies\\Test.mkv\nstart=87\n');
  assert.equal((await readWatchLater(directory,{itemId:'episode1',port:7788})).resumeSeconds,712.5);
  assert.equal((await readWatchLater(directory,{path:'Z:\\Movies\\Test.mkv'})).resumeSeconds,87);
  assert.equal(await readWatchLater(directory,{itemId:'absent',port:7788}),null);
});
test('unscoped legacy Emby records are only migrated for the original account, including after restart',async t=>{
  const directory=await fixture(t);
  let store=createProgressStore({directory});
  assert.equal(await store.allowLegacy(context),true);
  assert.equal(await store.allowLegacy({...context,userId:'another'}),false);
  store=createProgressStore({directory});
  assert.equal(await store.allowLegacy({...context,server:'https://other.example'}),false);
  assert.equal(await store.allowLegacy(context),true);
});
test('95 percent is watched even when quitting before EOF; below 95 percent keeps the resume point',async t=>{
  const directory=await fixture(t);let store=createProgressStore({directory});
  const session=await store.startSession(context,{sourceId:'main'});
  await write(session,3419.99,{sequence:1});await store.poll();
  assert.equal((await store.get(context,'main')).completed,false);
  assert.equal((await store.get(context,'main')).resumeSeconds,3419.99);
  await write(session,3420,{sequence:2,event:'stopped',completed:false});await store.poll();
  assert.equal((await store.get(context,'main')).completed,true);
  assert.equal((await store.get(context,'main')).resumeSeconds,0);
  assert.equal((await store.list(context)).length,0);
  store=createProgressStore({directory});
  assert.equal((await store.get(context,'main')).completed,true,'completion survives restart');
});
test('older persisted and native progress above 95 percent is normalized, while a rewatch below the threshold remains resumable',async t=>{
  const directory=await fixture(t);let store=createProgressStore({directory});
  const session=await store.startSession(context,{sourceId:'main'});
  await write(session,3528,{sequence:1,event:'stopped'});await store.poll();
  const file=path.join(directory,'progress.json'),data=JSON.parse(await fs.readFile(file,'utf8'));
  for(const record of Object.values(data.records)){record.latest.completed=false;record.sources.main.completed=false;}
  await fs.writeFile(file,JSON.stringify(data));store=createProgressStore({directory});
  assert.equal((await store.get(context,'main')).completed,true);
  assert.equal((await store.list(context)).length,0);
  const rewatch=await store.startSession(context,{sourceId:'main',startSeconds:0});
  await write(rewatch,60,{sequence:1});await store.poll();
  assert.equal((await store.get(context,'main')).resumeSeconds,60);
  assert.equal((await store.get(context,'main')).completed,false);
  assert.equal((await store.get({...context,itemId:'remote-only'},'',{positionSeconds:960,durationSeconds:1000,completed:false,lastPlayedAt:new Date().toISOString()})).completed,true);
});
test('WebDAV progress is isolated by endpoint and username, and survives reconnection',async t=>{
 const store=createProgressStore({directory:await fixture(t)}),dav={kind:'webdav',server:'https://a.test/dav/',userId:'me',itemId:'/dav/A.mkv'};
 const session=await store.startSession(dav);await write(session,123,{sequence:1});await store.poll();
 assert.equal((await store.get(dav)).resumeSeconds,123);assert.equal((await store.get({...dav,server:'https://b.test/dav/'})).resumeSeconds,0);assert.equal((await store.get({...dav,userId:'other'})).resumeSeconds,0);assert.equal((await store.list({...dav,userId:'other'})).length,0);
});
