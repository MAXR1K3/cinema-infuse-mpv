const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const remoteAccount = context=>['emby','webdav'].includes(context.kind);
const keyFor = context => createHash('sha256').update(JSON.stringify([context.kind,remoteAccount(context) ? context.server : '',remoteAccount(context) ? context.userId : '',context.itemId])).digest('hex');
const sameAccount = (a,b) => a.kind === b.kind && (!remoteAccount(a) || (a.server === b.server && a.userId === b.userId));
const WATCHED_THRESHOLD=0.95;
function isCompleted(record) {
  return !!record && (record.completed === true || (Number.isFinite(record.positionSeconds) && Number.isFinite(record.durationSeconds) && record.durationSeconds>0 && record.positionSeconds/record.durationSeconds>=WATCHED_THRESHOLD));
}
function createProgressStore({ directory, onUpdate = async()=>{} }) {
  let ready, state, polling, writeQueue = Promise.resolve();
  const sessions = new Map();
  const database = path.join(directory,'progress.json');
  async function init() {
    if (!ready) ready = (async()=>{
      await fs.mkdir(directory,{recursive:true});
      try { state=JSON.parse(await fs.readFile(database,'utf8')); }
      catch(error) { if(error.code !== 'ENOENT') throw error; state={records:{},sessions:{}}; }
      state.records ||= {}; state.sessions ||= {};
      for(const name of await fs.readdir(directory)) {
        if(!/^[a-f0-9-]{36}\.session\.json$/i.test(name)) continue;
        try {
          const session=JSON.parse(await fs.readFile(path.join(directory,name),'utf8'));
          if(name !== `${session.id}.session.json` || Date.now()-session.createdAt > 7*86400000) continue;
          session.file=path.join(directory,`${session.id}.json`); sessions.set(session.id,session);
        } catch { /* A partial manifest is retried when a new session is registered. */ }
      }
    })();
    return ready;
  }
  async function persist() {
    const snapshot=JSON.stringify(state);
    writeQueue=writeQueue.catch(()=>{}).then(async()=>{
      const temporary=database+'.tmp'; await fs.writeFile(temporary,snapshot,'utf8'); await fs.rename(temporary,database);
    });
    return writeQueue;
  }
  async function startSession(context,{sourceId='',startSeconds=0}={}) {
    await init();
    const id=randomUUID();
    const session={id,context,sourceId,startSeconds:Number(startSeconds)||0,createdAt:Date.now(),seenPosition:false};
    session.file=path.join(directory,`${id}.json`);
    await fs.writeFile(path.join(directory,`${id}.session.json`),JSON.stringify(session),'utf8');
    sessions.set(id,session); return {id,file:session.file};
  }
  async function poll() {
    if(polling) return polling;
    polling=(async()=>{
      await init(); let changed=false;
      for(const session of sessions.values()) {
        if(state.sessions[session.id]?.stopped) {sessions.delete(session.id);continue;}
        let snapshot;
        try { snapshot=JSON.parse(await fs.readFile(session.file,'utf8')); } catch { continue; }
        if(!Number.isFinite(snapshot.position) || snapshot.position<0 || !Number.isFinite(snapshot.duration) || snapshot.duration<=0 || snapshot.position>snapshot.duration+10 || !Number.isFinite(snapshot.sequence)) continue;
        const previous=state.sessions[session.id];
        if(previous?.stopped || previous?.sequence >= snapshot.sequence) continue;
        if(!session.seenPosition && session.startSeconds>10 && snapshot.position<1 && !snapshot.completed) continue;
        session.seenPosition=true;
        const key=keyFor(session.context), prior=state.records[key] || {context:session.context,sources:{}};
        const updatedAt=(await fs.stat(session.file)).mtime.toISOString();
        const record={positionSeconds:Math.min(snapshot.position,snapshot.duration),durationSeconds:snapshot.duration,completed:snapshot.completed === true,updatedAt,sourceId:session.sourceId,paused:!!snapshot.paused};
        record.completed=isCompleted(record);
        prior.context=session.context;
        if(!prior.latest || record.updatedAt >= prior.latest.updatedAt) prior.latest=record;
        if(!prior.sources[session.sourceId] || record.updatedAt >= prior.sources[session.sourceId].updatedAt) prior.sources[session.sourceId]=record;
        state.records[key]=prior;
        const event=snapshot.event === 'stopped' ? 'stopped' : !previous ? 'start' : snapshot.event === 'pause' || snapshot.event === 'unpause' ? snapshot.event : 'progress';
        state.sessions[session.id]={sequence:snapshot.sequence,stopped:event === 'stopped'};
        if(Object.keys(state.sessions).length>1000) delete state.sessions[Object.keys(state.sessions)[0]];
        changed=true;
        // Persistence never waits for a remote server. The callback serializes native reports.
        Promise.resolve(onUpdate({...session.context,sourceId:session.sourceId,playSessionId:session.context.playSessionId || session.id},record,event)).catch(()=>{});
      }
      if(changed) await persist();
    })().finally(()=>{polling=null});
    return polling;
  }
  function present(record) {
    if(!record) return {resumeSeconds:0,durationSeconds:0,progress:0,resumeSourceId:'',watchedAt:'',completed:false};
    const completed=isCompleted(record),resumeSeconds=completed ? 0 : record.positionSeconds;
    return {resumeSeconds,durationSeconds:record.durationSeconds,progress:completed ? 100 : Math.min(100,record.durationSeconds ? record.positionSeconds/record.durationSeconds*100 : 0),resumeSourceId:record.sourceId || '',watchedAt:record.updatedAt,completed};
  }
  async function get(context,sourceId='',remote=null) {
    await init();
    const entry=state.records[keyFor(context)];
    let record=(sourceId && entry?.sources[sourceId]) || entry?.latest;
    const remoteDate=Date.parse(remote?.lastPlayedAt || '');
    if(remote && Number.isFinite(remote.positionSeconds) && (remote.positionSeconds>0 || remote.completed) && (!record || (Number.isFinite(remoteDate) && remoteDate>Date.parse(record.updatedAt)+1000))) {
      record={...remote,updatedAt:remote.lastPlayedAt,sourceId};
    }
    return {...present(record),resumeBySource:Object.fromEntries(Object.entries(entry?.sources || {}).map(([id,r])=>[id,present(r)]))};
  }
  async function list(account,{includeCompleted=false}={}) {
    await init();
    return Object.values(state.records).filter(entry=>sameAccount(entry.context,account) && (includeCompleted || !isCompleted(entry.latest)) && entry.latest.positionSeconds>3).map(entry=>({...entry.context,...present(entry.latest)})).sort((a,b)=>b.watchedAt.localeCompare(a.watchedAt));
  }
  async function allowLegacy(context) {
    await init();
    if(context.kind !== 'emby') return true;
    if(!state.legacyOwner) {state.legacyOwner={kind:'emby',server:context.server,userId:context.userId};await persist();}
    return sameAccount(state.legacyOwner,context);
  }
  return {startSession,poll,get,list,allowLegacy};
}
const legacyCache=new Map();
async function readWatchLater(directory,match) {
  let cached=legacyCache.get(directory);
  if(!cached || cached.expires<Date.now()) {
    const records=[];
    for(const name of (await fs.readdir(directory).catch(()=>[])).slice(0,2000)) {
      try {
        const file=path.join(directory,name),stat=await fs.stat(file);
        if(!stat.isFile() || stat.size>65536) continue;
        const content=await fs.readFile(file,'utf8'), start=Number(content.match(/^start=([\d.]+)\s*$/m)?.[1]);
        const media=content.match(/^#\s*(.+)\r?$/m)?.[1]?.trim();
        if(media && Number.isFinite(start) && start>0) records.push({media,resumeSeconds:start,watchedAt:stat.mtime.toISOString()});
      } catch { /* Ignore an unrelated or partially written native record. */ }
    }
    cached={expires:Date.now()+60000,records};legacyCache.set(directory,cached);
  }
  return cached.records.filter(record=>{
    if(match.path) return record.media.toLowerCase() === match.path.toLowerCase();
    try {const url=new URL(record.media);return ['127.0.0.1','localhost'].includes(url.hostname) && Number(url.port) === match.port && url.pathname === `/stream/emby-${encodeURIComponent(match.itemId)}`;} catch {return false;}
  }).sort((a,b)=>b.watchedAt.localeCompare(a.watchedAt))[0] || null;
}
module.exports={createProgressStore,readWatchLater,isCompleted};
