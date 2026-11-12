const fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {ratingsFromEmby,ratingsFromOmdb,ratingLinks,providerIds}=require('./ratings');
function createRatingsService({file,protect,unprotect,request=fetch,now=Date.now}){
 let loaded,key='',revision=0,verification=null,write=Promise.resolve(),active=0;const cache=new Map(),waiting=[];
 async function init(){if(!loaded)loaded=(async()=>{const generation=revision;try{const saved=JSON.parse(await fs.readFile(file,'utf8')),restored=await unprotect(saved.protectedKey);if(generation===revision)key=restored;}catch(e){if(e.code!=='ENOENT')throw Error('评分接口配置无法解密，请清除后重新保存');}})();return loaded;}
 async function limited(task){if(active>=3){if(waiting.length>=30)throw Error('busy');await new Promise(r=>waiting.push(r));}else active++;try{return await task();}finally{const next=waiting.shift();if(next)next();else active--;}}
 const messages={invalid_key:'OMDb 拒绝此 key（Invalid API key）：请核对邮件中的 API key，并确认激活的是同一个 key。',quota:'OMDb 今日请求额度已用完，请稍后再试。',unavailable:'OMDb 服务或网络暂不可用，请稍后测试连接。',no_match:'OMDb 未返回匹配此 IMDb ID 的评分，保留服务器评分。'};
 async function lookup(selector,apiKey){try{
  const byId=typeof selector==='string';const url=new URL('https://www.omdbapi.com/');url.searchParams.set('apikey',apiKey);
  if(byId)url.searchParams.set('i',selector);else{url.searchParams.set('t',selector.title);url.searchParams.set('y',selector.year);url.searchParams.set('type',selector.type);}
  const response=await request(url,{redirect:'error',signal:AbortSignal.timeout(6000)});
  let size=0;const chunks=[];for await(const chunk of response.body){size+=chunk.length;if(size>262144)throw Error('oversized');chunks.push(chunk);}
  const data=JSON.parse(Buffer.concat(chunks).toString('utf8')),error=String(data.Error || '');
  const code=/limit|too many/i.test(error)?'quota':response.status===401 || /invalid api key|not activated/i.test(error)?'invalid_key':!response.ok?'unavailable':data.Response==='False'?'no_match':'';
  if(code)return {ratings:[],code,message:messages[code]};
  const normalize=value=>String(value || '').normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
  if(!byId && (normalize(data.Title)!==normalize(selector.title) || String(data.Year).slice(0,4)!==selector.year || data.Type!==selector.type || !/^tt\d{5,12}$/.test(data.imdbID || '')))return {ratings:[],code:'no_match',message:'原名、年份或类型不一致，未采用候选评分。'};
  const ratings=ratingsFromOmdb(data,byId?selector:data.imdbID);if(!byId)for(const score of ratings)score.via='OMDb 原名、年份、类型严格匹配；非平台 ID 核验';
  return ratings.length?{ratings,code:'ok',matchedBy:byId?'imdb_id':'original_title_year_type',imdbId:data.imdbID,message:'OMDb 连接已验证，评分返回正常。'}:{ratings:[],code:'no_match',message:messages.no_match};
 }catch{return {ratings:[],code:'unavailable',message:messages.unavailable};}}
 return {
  async status(){try{await init();return {configured:!!key,provider:'OMDb',verification};}catch{return {configured:false,provider:'OMDb',error:'无法读取已保存配置，请重新保存或清除'};}},
  async validate(){try{await init();}catch{return {ok:false,code:'configuration',message:'配置无法读取，请重新保存 key。'};}if(!key)return {ok:false,code:'missing_key',message:'尚未保存 OMDb key。'};
   const generation=revision,result=await limited(()=>lookup('tt0111161',key));if(generation!==revision)return {ok:false,code:'changed',message:'配置已改变，请重新测试。'};
   verification={ok:result.code==='ok',code:result.code,message:result.message,checkedAt:new Date(now()).toISOString()};cache.clear();return verification;
  },
  configure(input){const operation=write.catch(()=>{}).then(async()=>{
   let next=input.clear===true?'':String(input.apiKey || '').trim();if(input.clear!==true&&!/^[a-zA-Z0-9_-]{1,128}$/.test(next))throw Error('请输入有效的 OMDb API key');
   await fs.mkdir(path.dirname(file),{recursive:true});const temp=file+'.'+randomUUID()+'.tmp';
   try{await fs.writeFile(temp,JSON.stringify({version:1,protectedKey:await protect(next)}),{mode:0o600});await fs.rename(temp,file);}finally{await fs.rm(temp,{force:true});}
   key=next;revision++;verification=null;cache.clear();loaded=Promise.resolve();return {configured:!!key,provider:'OMDb'};
  });write=operation;return operation;},
  async get(raw){const base=ratingsFromEmby(raw),links=ratingLinks(raw);try{await init();}catch{return {ratings:base,links,message:'评分接口配置无法读取；保留 Emby 评分'};}
   const id=providerIds(raw).imdb,generation=revision;
   if(!key)return {ratings:base,links,message:'未配置 OMDb；IMDb、烂番茄等外部评分暂不补全。豆瓣需服务器提供具名评分。'};
   let selector=id;const title=String(raw.OriginalTitle || '').trim(),year=String(raw.ProductionYear || ''),type={Movie:'movie',Series:'series'}[raw.Type];
   if(!/^tt\d{5,12}$/.test(id || '')){
    if(!type || !/^[\p{Script=Latin}\p{N}\p{P}\p{Z}\p{M}\p{S}]+$/u.test(title) || !/\p{Script=Latin}/u.test(title) || !/^(18|19|20|21)\d{2}$/.test(year))return {ratings:base,links,code:'missing_identity',message:'Emby 缺少 IMDb ID；也没有可核对的原名、年份与电影/剧集类型，未采用猜测评分。'};
    selector={title,year,type};
   }
   const cacheKey=JSON.stringify(selector);let record=cache.get(cacheKey);if(!record || record.expires<now()){
    const apiKey=key;record={expires:now()+86400000};cache.set(cacheKey,record);
    record.promise=limited(()=>lookup(selector,apiKey)).catch(()=>({ratings:[],code:'unavailable',message:messages.unavailable})).then(result=>{if(result.code!=='ok')record.expires=now()+60000;return result;});
    while(cache.size>1000)cache.delete(cache.keys().next().value);
   }
   const result=await record.promise,extra=result.ratings;if(generation!==revision)return {ratings:base,links,message:'评分配置已变更，请重新打开详情'};
   const merged=new Map(base.map(x=>[x.key,x]));for(const rating of extra)merged.set(rating.key,rating);
   return {ratings:[...merged.values()],links:extra.length?ratingLinks({...raw,ProviderIds:{...raw.ProviderIds,Imdb:result.imdbId}}):links,code:result.code,matchedBy:result.matchedBy,message:extra.length?(result.matchedBy==='imdb_id'?'具名评分由 OMDb 按 IMDb ID 提供；豆瓣仅使用服务器具名资料':'评分按原名、年份、类型严格匹配；Emby 无 IMDb ID，仍可能存在同名同年作品。豆瓣未补全。'):result.message};
  }
 };
}
module.exports={createRatingsService};
