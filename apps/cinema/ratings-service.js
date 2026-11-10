const fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {ratingsFromEmby,ratingsFromOmdb,ratingLinks,providerIds}=require('./ratings');
function createRatingsService({file,protect,unprotect,request=fetch,now=Date.now}){
 let loaded,key='',revision=0,write=Promise.resolve(),active=0;const cache=new Map(),waiting=[];
 async function init(){if(!loaded)loaded=(async()=>{const generation=revision;try{const saved=JSON.parse(await fs.readFile(file,'utf8')),restored=await unprotect(saved.protectedKey);if(generation===revision)key=restored;}catch(e){if(e.code!=='ENOENT')throw Error('评分接口配置无法解密，请清除后重新保存');}})();return loaded;}
 async function limited(task){if(active>=3){if(waiting.length>=30)throw Error('busy');await new Promise(r=>waiting.push(r));}else active++;try{return await task();}finally{const next=waiting.shift();if(next)next();else active--;}}
 return {
  async status(){try{await init();return {configured:!!key,provider:'OMDb'};}catch{return {configured:false,provider:'OMDb',error:'无法读取已保存配置，请重新保存或清除'};}},
  configure(input){const operation=write.catch(()=>{}).then(async()=>{
   let next=input.clear===true?'':String(input.apiKey || '').trim();if(input.clear!==true&&!/^[a-zA-Z0-9_-]{1,128}$/.test(next))throw Error('请输入有效的 OMDb API key');
   await fs.mkdir(path.dirname(file),{recursive:true});const temp=file+'.'+randomUUID()+'.tmp';
   try{await fs.writeFile(temp,JSON.stringify({version:1,protectedKey:await protect(next)}),{mode:0o600});await fs.rename(temp,file);}finally{await fs.rm(temp,{force:true});}
   key=next;revision++;cache.clear();loaded=Promise.resolve();return {configured:!!key,provider:'OMDb'};
  });write=operation;return operation;},
  async get(raw){const base=ratingsFromEmby(raw),links=ratingLinks(raw);try{await init();}catch{return {ratings:base,links,message:'评分接口配置无法读取；保留 Emby 评分'};}
   const id=providerIds(raw).imdb,generation=revision;
   if(!key)return {ratings:base,links,message:'未配置 OMDb；IMDb、烂番茄等外部评分暂不补全。豆瓣需服务器提供具名评分。'};
   if(!/^tt\d{5,12}$/.test(id || ''))return {ratings:base,links,message:'Emby 未提供有效 IMDb ID，未按片名猜测匹配外部评分'};
   let record=cache.get(id);if(!record || record.expires<now()){
    const apiKey=key;record={expires:now()+86400000};cache.set(id,record);
    record.promise=limited(async()=>{
     const url=new URL('https://www.omdbapi.com/');url.searchParams.set('apikey',apiKey);url.searchParams.set('i',id);
     const response=await request(url,{redirect:'error',signal:AbortSignal.timeout(6000)});if(!response.ok){await response.body?.cancel();throw Error('unavailable');}
     let size=0;const chunks=[];for await(const chunk of response.body){size+=chunk.length;if(size>262144)throw Error('oversized');chunks.push(chunk);}
     const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));return ratingsFromOmdb(data,id);
    }).catch(()=>{record.expires=now()+60000;return [];});
    while(cache.size>1000)cache.delete(cache.keys().next().value);
   }
   const extra=await record.promise;if(generation!==revision)return {ratings:base,links,message:'评分配置已变更，请重新打开详情'};
   const merged=new Map(base.map(x=>[x.key,x]));for(const rating of extra)merged.set(rating.key,rating);
   return {ratings:[...merged.values()],links,message:extra.length?'具名评分由 OMDb 聚合提供；豆瓣仅使用服务器具名资料':'外部评分未返回匹配结果或暂不可用，保留服务器评分'};
  }
 };
}
module.exports={createRatingsService};
