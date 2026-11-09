const localizations=require('./credit-localizations.json');
const plain=s=>s.replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&').replace(/&#39;|&apos;/g,"'").replace(/&quot;/g,'"').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim();
const roleKey=s=>String(s || '').split('/')[0].normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
function parseTmdbCast(html){
 const lists=[...html.matchAll(/<ol\b[^>]*class="([^"]*)"[^>]*>([\s\S]*?)<\/ol>/gi)];
 const list=lists.find(x=>/\bpeople\b/.test(x[1]) && /\bcredits\b/.test(x[1]) && !/\bcrew\b/.test(x[1]));
 if(!list)return [];
 const found=[];
 for(const li of list[2].matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)){
  const id=li[1].match(/href="\/person\/(\d+)(?:[/?"])/)?.[1];
  if(!id || found.some(p=>p.id===id))continue;
  found.push({id,order:found.length,role:plain(li[1].match(/<p\b[^>]*class="character"[^>]*>([\s\S]*?)<\/p>/i)?.[1]?.replace(/<span\b[\s\S]*?<\/span>/gi,'') || '')});
 }
 return found;
}
function createCastEnricher({person,account,now=Date.now,fetchHtml=async url=>{
 const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(4000)});
 if(!response.ok)throw Error('Cast source unavailable');const html=await response.text();if(html.length>2000000)throw Error('Cast source too large');return html;
}}){
 const castCache=new Map(),personCache=new Map();
 async function enrich(people,metadata,{deadline=now()+6000}={}){
  const kind=metadata.Type==='Series'?'tv':metadata.Type==='Movie'?'movie':null,id=String(metadata.ProviderIds?.Tmdb || '');
  if(!kind || !/^\d+$/.test(id) || !people.some(p=>p.type==='Actor'))return people;
  const owner=account(),same=()=>{if(account()!==owner)throw Error('Account changed');};
  const source=`https://www.themoviedb.org/${kind}/${id}/cast?language=zh-CN`,key=kind+':'+id;
  let cached=castCache.get(key);
  if(!cached || cached.expires<=now()){
   const record={expires:now()+30000};
   record.promise=fetchHtml(source).then(async html=>{
    const list=parseTmdbCast(html);
    if(list.some(p=>/[\u3400-\u9fff]/.test(p.role))){
     try{const original=parseTmdbCast(await fetchHtml(source.replace('language=zh-CN','language=en-US')));const roles=new Map(original.map(p=>[p.id,p.role]));for(const p of list)p.originalRole=roles.get(p.id) || '';}
     catch{/* A translated role without its matching original must not replace native credits. */}
    }
    return list;
   }).catch(()=>[]).then(list=>{record.expires=now()+(list.length?12*3600000:30000);return list;});
   cached=record;castCache.set(key,cached);
   if(castCache.size>128)castCache.delete(castCache.keys().next().value);
  }
  const cast=await cached.promise;same();if(!cast.length && !localizations[key])return people;
  const order=new Map(cast.map(p=>[p.id,p.order])),result=people.map(p=>({...p}));
  const actors=result.filter(p=>p.type==='Actor');
  for(let start=0;start<actors.length && now()<deadline;start+=4){
   await Promise.all(actors.slice(start,start+4).map(async credit=>{
    try{
     let tmdb=credit.tmdbId;
     if(!tmdb && credit.id){
      const pkey=JSON.stringify([owner,credit.id]);let record=personCache.get(pkey);
      if(!record || record.expires<=now()){record={expires:now()+30000};const current=record;current.promise=person(credit.id).then(data=>String(data.ProviderIds?.Tmdb || '')).catch(()=> '').then(value=>{current.expires=now()+(value?12*3600000:30000);return value;});personCache.set(pkey,record);if(personCache.size>1000)personCache.delete(personCache.keys().next().value);}
      tmdb=await record.promise;same();
     }
     if(order.has(tmdb)){credit.billingOrder=order.get(tmdb);credit.orderSource=source;}
     const known=localizations[key],role=known?.roles[tmdb];
     if(role && roleKey(credit.role)===roleKey(role.original)){
      if(role.actorZh && !/[\u3400-\u9fff]/.test(credit.name || ''))credit.nameZh=role.actorZh;credit.roleZh=role.zh;credit.roleSource=known.source;credit.roleSourceLabel=known.label;credit.isLead=!!role.lead;
     }else if(!/[\u3400-\u9fff]/.test(credit.role || '')){
      const matching=cast.find(p=>p.id===tmdb),translated=matching?.role;
      if(translated && matching.originalRole && roleKey(matching.originalRole)===roleKey(credit.role) && /[\u3400-\u9fff]/.test(translated) && !/[\u3040-\u30ff\uac00-\ud7af]/.test(translated)){
       credit.roleZh=translated;credit.roleSource=source;credit.roleSourceLabel='TMDB 中文演职资料';
      }
     }
    }catch{/* Keep native credit data whenever an external identity cannot be confirmed. */}
   }));same();
  }
  return result.map((p,index)=>({p,index})).sort((a,b)=>{
   const group=p=>p.type==='Actor'?0:p.type==='Director'?1:2;
   return group(a.p)-group(b.p) || (a.p.type==='Actor' ? Number(!!b.p.isLead)-Number(!!a.p.isLead) || Number(!!b.p.orderSource)-Number(!!a.p.orderSource) || (a.p.billingOrder ?? Infinity)-(b.p.billingOrder ?? Infinity) : 0) || a.index-b.index;
  }).map(x=>x.p);
 }
 return {enrich};
}
module.exports={parseTmdbCast,createCastEnricher};
