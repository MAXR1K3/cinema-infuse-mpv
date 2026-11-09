function normalizeCredits(primary=[],series=[]) {
 const result=[],seen=new Map();
 for(const p of [...primary,...series]) {
  if(!p?.Name)continue;
  const id=p.Id==null?'':String(p.Id),type=String(p.Type || (p.Role?'Actor':'')),key=id?`id:${id}:${type}`:`name:${p.Name}:${type}`;
  const order=[p.SortOrder,p.Order].find(x=>x!=null && Number.isFinite(Number(x)));
  const credit={id,name:String(p.Name),role:String(p.Role || ''),type,imageTag:String(p.PrimaryImageTag || p.ImageTags?.Primary || ''),billingOrder:order==null?null:Number(order),tmdbId:String(p.ProviderIds?.Tmdb || '')};
  if(seen.has(key)){const old=seen.get(key);if(!old.imageTag)old.imageTag=credit.imageTag;if(old.billingOrder==null)old.billingOrder=credit.billingOrder;continue;}
  seen.set(key,credit);result.push(credit);
 }
 return result.slice(0,80);
}
function createCreditsService({request,account}) {
 const cache=new Map();
 async function works(person,start,userId) {
  const owner=account(),same=()=>{if(account()!==owner)throw Error('登录状态已变更，请重试');};
  const q=new URLSearchParams({Recursive:'true',IncludeItemTypes:'Movie,Series',PersonIds:person.id,StartIndex:String(start),Limit:'40',EnableImages:'true',Fields:'People',SortBy:'ProductionYear',SortOrder:'Descending'});
  const data=await (await request(`/Users/${encodeURIComponent(userId)}/Items?${q}`)).json();same();
  const rawItems=data.Items || [],candidates=rawItems.filter(x=>x.Id),verified=[];let incomplete=false;
  for(let offset=0;offset<candidates.length;offset+=4) {
   const batch=await Promise.all(candidates.slice(offset,offset+4).map(async raw=>{
    try {
     let item=raw;
     if(!Array.isArray(item.People) || !item.People.length) {
      const key=JSON.stringify([owner,raw.Id]);let saved=cache.get(key);
      if(!saved || saved.expires<Date.now()){
       const full=await (await request(`/Users/${encodeURIComponent(userId)}/Items/${encodeURIComponent(raw.Id)}`)).json();same();
       if(String(full.Id)!==String(raw.Id))return null;
       saved={item:{...raw,...full},expires:Date.now()+300000};cache.set(key,saved);
       if(cache.size>800)cache.delete(cache.keys().next().value);
      }
      item=saved.item;
     }
     if(!['Movie','Series'].includes(item.Type))return null;
     return item.People?.some(p=>String(p.Id || '')===person.id) ? item : null;
    }catch(error){same();incomplete=true;return null;}
   }));same();verified.push(...batch.filter(Boolean));
  }
  const nextStart=start+rawItems.length;
  return {items:verified,total:verified.length,nextStart,hasMore:rawItems.length>=40 && (!(data.TotalRecordCount>0) || nextStart<data.TotalRecordCount),incomplete};
 }
 return {works};
}
module.exports={normalizeCredits,createCreditsService};
