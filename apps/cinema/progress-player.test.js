// Uses only a synthetic silent WAV, no user media, configuration or viewing history.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const net=require('node:net');
const {spawn}=require('node:child_process');
const {randomUUID}=require('node:crypto');
const {createProgressStore}=require('./progress-store');
const {launchTrackedPlayer}=require('./tracked-player');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function snapshot(file,predicate) {
  for(let i=0;i<100;i++) {try {const data=JSON.parse(await fs.readFile(file,'utf8'));if(predicate(data)) return data;} catch {} await sleep(60);}
  throw Error('Real mpv progress snapshot timed out');
}
test('real mpv saves a seek, survives quit/reopen, and marks EOF instead of leaving a stale resume', {timeout:25000},async t=>{
  const executable=process.env.MPV_TEST_EXE || path.resolve(__dirname,'../../runtime/windows/mpv.exe');
  try {await fs.access(executable);} catch {t.skip('mpv is not installed on this host');return;}
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cinema-player-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const media=path.join(root,'silent.wav'),rate=8000,seconds=90,data=Buffer.alloc(rate*seconds*2),header=Buffer.alloc(44);
  header.write('RIFF');header.writeUInt32LE(data.length+36,4);header.write('WAVEfmt ',8);header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(1,22);header.writeUInt32LE(rate,24);header.writeUInt32LE(rate*2,28);header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);header.write('data',36);header.writeUInt32LE(data.length,40);
  await fs.writeFile(media,Buffer.concat([header,data]));
  const directory=path.join(root,'state'),context={kind:'local',itemId:'synthetic',item:{id:'synthetic',title:'Synthetic'}};
  let store=createProgressStore({directory});
  async function player(start=0) {
    const pipe=process.platform === 'win32' ? `\\\\.\\pipe\\cinema-proof-${randomUUID()}` : path.join(root,randomUUID()+'.sock');
    const tracked=await launchTrackedPlayer({executable,media,context,store,startSeconds:start,spawnPlayer:(exe,args,options)=>spawn(exe,['--no-config','--vo=null','--ao=null','--terminal=no','--force-window=no','--idle=yes','--pause=yes',`--input-ipc-server=${pipe}`,...args],{...options,windowsHide:true})});
    const child=tracked.child;
    child.ref(); // The test runner must wait for exit even after the launcher detaches it.
    t.after(()=>{if(child.exitCode === null) child.kill()});
    let socket;
    for(let i=0;i<100;i++) {try {socket=await new Promise((resolve,reject)=>{const s=net.connect(pipe,()=>resolve(s));s.once('error',reject)});break;} catch {await sleep(40)}}
    if(!socket) throw Error('Cannot connect to isolated mpv');
    socket.on('error',()=>{});let request=0,buffer='';const pending=new Map();
    socket.on('data',chunk=>{buffer+=chunk;let at;while((at=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,at);buffer=buffer.slice(at+1);try {const r=JSON.parse(line);if(pending.has(r.request_id)){pending.get(r.request_id)(r);pending.delete(r.request_id)}}catch{}}});
    const command=command=>new Promise(resolve=>{const id=++request;pending.set(id,resolve);socket.write(JSON.stringify({command,request_id:id})+'\n')});
    const close=async()=>{socket.write(JSON.stringify({command:['quit']})+'\n');await new Promise(resolve=>child.once('exit',resolve));socket.destroy()};
    await snapshot(tracked.file,s=>s.duration===90);
    return {tracked,command,close,child};
  }
  const first=await player();
  assert.ok(first.tracked.subtitleFile,'subtitle association has a stable state file');
  const subtitle=path.join(root,'manual.zh.srt');await fs.writeFile(subtitle,'1\n00:00:01,000 --> 00:00:30,000\nSubtitle persistence proof\n');
  assert.equal((await first.command(['sub-add',subtitle,'select'])).error,'success');
  await first.command(['set_property','sub-delay',1.25]);
  await snapshot(first.tracked.subtitleFile,s=>s.files?.includes(subtitle)&&s.delay===1.25);
  assert.equal((await first.command(['seek',35.25,'absolute+exact'])).error,'success');
  await snapshot(first.tracked.file,s=>Math.abs(s.position-35.25)<0.1);
  await first.close();
  await snapshot(first.tracked.file,s=>s.event==='stopped');await store.poll();
  assert.ok(Math.abs((await store.get(context)).resumeSeconds-35.25)<0.1);
  store=createProgressStore({directory});
  const saved=await store.get(context),second=await player(saved.resumeSeconds);
  assert.equal(second.tracked.subtitleFile,first.tracked.subtitleFile);
  await snapshot(second.tracked.subtitleFile,s=>s.files?.includes(subtitle));
  assert.ok((await second.command(['get_property','track-list'])).data.some(x=>x.type==='sub'&&x.external&&x.selected));
  assert.equal((await second.command(['get_property','sub-delay'])).data,1.25);
  await second.command(['set_property','sid','no']);
  await snapshot(second.tracked.subtitleFile,s=>s.selected==='no');
  const state=await snapshot(second.tracked.file,s=>Math.abs(s.position-35.25)<0.1);
  assert.ok(Math.abs(state.position-saved.resumeSeconds)<0.1);
  await second.command(['seek',89.7,'absolute+exact']);await second.command(['set_property','pause',false]);
  await snapshot(second.tracked.file,s=>s.event==='stopped' && s.completed);await store.poll();
  assert.equal((await store.get(context)).resumeSeconds,0);
  await second.close();
  const credits=await player();
  assert.equal((await credits.command(['get_property','sid'])).data,false,'explicit subtitle off survives reopen');
  await credits.command(['seek',85.5,'absolute+exact']);
  await snapshot(credits.tracked.file,s=>Math.abs(s.position-85.5)<0.1);
  await credits.close();
  const quitSnapshot=await snapshot(credits.tracked.file,s=>s.event==='stopped');
  assert.equal(quitSnapshot.completed,false,'the player did not reach EOF');
  await store.poll();
  assert.equal((await store.get(context)).completed,true,'quitting during credits at 95 percent is watched');
});
