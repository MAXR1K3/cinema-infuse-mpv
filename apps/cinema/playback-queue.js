const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
function createPlaybackQueue({directory,store,resolveNext,prepare}) {
  const pending=new Map();
  const fileFor=id=>/^[a-f0-9-]{36}$/i.test(id || '') ? path.join(directory,`${id}.queue.json`) : null;
  async function write(file,data) {await fs.writeFile(file+'.tmp',JSON.stringify(data),'utf8');await fs.rename(file+'.tmp',file);}
  async function add(data,entry) {
    const context={...entry.context,queueId:data.id,media:entry.media};
    const tracked=await store.startSession(context,{sourceId:entry.sourceId,startSeconds:entry.startSeconds});
    data.entries[entry.media]={...entry,context,file:tracked.file};
    return tracked;
  }
  async function ensureNext(context) {
    const file=fileFor(context.queueId); if(!file || !context.media) return;
    const key=context.queueId+context.media;
    if(pending.has(key)) return pending.get(key);
    const task=(async()=>{
      const data=JSON.parse(await fs.readFile(file,'utf8')),entry=data.entries[context.media];
      if(!entry || entry.resolved) return;
      try {
        const next=await resolveNext(entry.item);
        if(next) {
          const prepared=await prepare(next,entry.source,entry.context);
          await add(data,prepared); entry.next=prepared.media;
        }
        entry.resolved=true;
      } catch(error) {entry.error='下一集暂时无法加载，请回片库重试';console.error(`Next episode: ${error.message}`);}
      await write(file,data);
    })().finally(()=>pending.delete(key));
    pending.set(key,task);return task;
  }
  async function start(entry) {
    await fs.mkdir(directory,{recursive:true});
    const data={id:randomUUID(),entries:{}};
    const tracked=await add(data,entry),file=fileFor(data.id);
    await write(file,data);
    // Prefetch metadata and one stream URL only; no media is downloaded ahead of playback.
    ensureNext(data.entries[entry.media].context).catch(error=>console.error(error.message));
    return {...tracked,queueFile:file};
  }
  return {start,ensureNext};
}
module.exports={createPlaybackQueue};
