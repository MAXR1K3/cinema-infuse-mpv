const {davMetadataLabels,matchDavMetadata}=require('./webdav-posters');
function createDavPosterService({webdav,account,search,artwork}){
 const cache=new Map(),waiting=[];let active=0,bytes=0;
 async function limited(task){if(active>=4){if(waiting.length>=200)return null;await new Promise(resolve=>waiting.push(resolve));}else active++;try{return await task();}finally{const next=waiting.shift();if(next)next();else active--;}}
 return {async get(id,file){
  const entry=await webdav.entry(id,file),owner=account(),key=JSON.stringify([id,file,owner]);let cached=cache.get(key);
  if(!cached || cached.expires<Date.now()){
   if(cached){bytes-=cached.size || 0;cache.delete(key);}
   cached={expires:Date.now()+60000,size:0};cache.set(key,cached);const record=cached;
   record.promise=limited(async()=>{
    let image;try{image=await webdav.artwork(id,file);}catch{/* A missing native cover can fall back to exact metadata matching. */}
    if(!image && owner && account()===owner){
     for(const label of davMetadataLabels(entry))if(label.title.length>=2){try{const candidates=await search(label.title);if(account()!==owner)return null;const match=matchDavMetadata(label,candidates);if(match)image=await artwork(match.Id);}catch{/* Artwork is optional; keep browsing and playback usable. */}}
    }
    if(account()!==owner)return null;await webdav.entry(id,file);
    return image || null;
   }).then(image=>{
    if(cache.get(key)!==record)return image;
    record.expires=Date.now()+(image?300000:60000);record.size=image?.bytes.length || 0;bytes+=record.size;
    while(cache.size>300 || bytes>40*1024*1024){const first=cache.keys().next().value;bytes-=cache.get(first).size || 0;cache.delete(first);}
    return image;
   }).catch(()=>null);
  }
  const image=await cached.promise;if(account()!==owner)return null;await webdav.entry(id,file);return image;
 }};
}
module.exports={createDavPosterService};
