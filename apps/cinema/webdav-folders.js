function createDavFolderService({webdav}){
 const cache=new Map(),waiting=[];let active=0;
 async function limited(task){if(active>=2){if(waiting.length>=120)throw Error('目录识别繁忙，请稍后再试');await new Promise(resolve=>waiting.push(resolve));}else active++;try{return await task();}finally{const next=waiting.shift();if(next)next();else active--;}}
 return {async get(id,path,{refresh=false}={}){
  const folder=await webdav.entry(id,path);if(!folder.directory)throw Error('请选择当前目录中的文件夹');
  const key=JSON.stringify([id,path]);let record=cache.get(key);
  if(refresh || !record || record.expires<Date.now()){
   record={expires:Date.now()+300000};cache.set(key,record);
   record.promise=limited(async()=>{
    const pending=[{path,depth:0}],seen=new Set(),files=new Map(),deadline=Date.now()+8000;let complete=true,reads=0;
    while(pending.length && reads<8 && files.size<120 && Date.now()<deadline){
     const current=pending.shift();if(seen.has(current.path))continue;seen.add(current.path);reads++;
     try{const listing=await webdav.browse(id,current.path,{refresh});
      for(const item of listing.items){
       if(item.video){if(files.size>=120){complete=false;break;}files.set(item.path,item);}
       else if(item.directory && !seen.has(item.path)){if(current.depth<2)pending.push({path:item.path,depth:current.depth+1});else complete=false;}
      }
     }catch{complete=false;}
    }
    if(pending.length)complete=false;
    await webdav.entry(id,path);return {folder,items:[...files.values()],complete};
   }).catch(error=>{if(cache.get(key)===record)cache.delete(key);throw error;});
   while(cache.size>200)cache.delete(cache.keys().next().value);
  }
  const result=await record.promise;await webdav.entry(id,path);return result;
 }};
}
module.exports={createDavFolderService};
