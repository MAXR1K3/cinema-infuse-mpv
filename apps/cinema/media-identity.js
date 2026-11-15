// Resolve an existing platform ID, never a fuzzy title search. Public structured
// data can change; missing or inconsistent data must leave native metadata intact.
function createMediaIdentityService({request=fetch,now=Date.now}={}){
 const cache=new Map(),waiting=[];let active=0;
 async function limited(task){if(active>=3){if(waiting.length>=30)throw Error('busy');await new Promise(r=>waiting.push(r));}else active++;try{return await task();}finally{const next=waiting.shift();if(next)next();else active--;}}
 async function resolve(raw,kind,id){
  const url=`https://www.themoviedb.org/${kind}/${id}`,allowed=new RegExp('^/'+kind+'/'+id+'(?:-[^/?#"<>]+)?$'),signal=AbortSignal.timeout(4500);let target=url+'?language=en-US',r;
  for(let attempt=0;attempt<3;attempt++){r=await request(target,{redirect:'manual',signal,headers:{Accept:'text/html'}});if(![301,302,307,308].includes(r.status))break;const next=new URL(r.headers.get('location') || '',target);await r.body?.cancel();if(next.origin!=='https://www.themoviedb.org'||!allowed.test(next.pathname)||next.username||next.password)throw Error('redirect');next.search='?language=en-US';target=next.href;}
  if(!r.ok)throw Error('unavailable');let size=0;const chunks=[];for await(const chunk of r.body){size+=chunk.length;if(size>2000000)throw Error('oversized');chunks.push(chunk);}const html=Buffer.concat(chunks).toString('utf8');
  const canonical=html.match(/<link\b[^>]*rel="canonical"[^>]*href="([^"]+)"[^>]*>/)?.[1];
  if(!canonical || !new RegExp('^https://www\\.themoviedb\\.org/'+kind+'/'+id+'(?:-[^/?#"<>]+)?$').test(canonical))return null;
  const docs=[];for(const match of html.matchAll(/<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)){try{const doc=JSON.parse(match[1]);docs.push(...(Array.isArray(doc)?doc:[doc]));}catch{}}
  const matches=docs.filter(x=>x.url===canonical&&x['@type']===(kind==='tv'?'TVSeries':'Movie'));if(matches.length!==1)return null;const doc=matches[0];
  const year=String(doc.startDate || doc.datePublished || '').slice(0,4);if(raw.ProductionYear&&year&&year!==String(raw.ProductionYear))return null;
  const ids=[...new Set((Array.isArray(doc.sameAs)?doc.sameAs:[]).map(x=>String(x).match(/^https:\/\/(?:www\.)?imdb\.com\/title\/(tt\d{5,12})\/?$/)?.[1]).filter(Boolean))];
  const rating=doc.aggregateRating,score=Number(rating?.ratingValue),votes=Number(rating?.ratingCount);
  const status=html.match(/<p>\s*<strong><bdi>Status<\/bdi><\/strong>\s*([^<]+)<\/p>/)?.[1]?.trim();
  return {imdb:ids.length===1?ids[0]:'',title:typeof doc.name==='string'?doc.name:'',source:url,status:['Ended','Canceled'].includes(status)?'Ended':status==='Returning Series'?'Continuing':'',rating:rating&&Number(rating.bestRating)===10&&Number.isFinite(score)&&score>=0&&score<=10&&votes>0?{key:'tmdb',name:'TMDB',score,max:10,display:score.toFixed(1)+'/10',votes,via:'TMDB 官方作品页 · '+votes+' 票',url}:null};
 }
 return {async get(raw){const ids=Object.fromEntries(Object.entries(raw.ProviderIds || {}).map(([k,v])=>[k.toLowerCase(),String(v)])),kind={Movie:'movie',Series:'tv'}[raw.Type],id=ids.tmdb;if(!kind||!/^\d{1,12}$/.test(id || ''))return raw;
  const key=JSON.stringify([kind,id,raw.ProductionYear]);let entry=cache.get(key);if(!entry||entry.expires<=now()){entry={expires:now()+86400000};cache.set(key,entry);entry.promise=limited(()=>resolve(raw,kind,id)).catch(()=>null).then(value=>{if(!value)entry.expires=now()+60000;return value;});while(cache.size>1000)cache.delete(cache.keys().next().value);}const data=await entry.promise;if(!data)return raw;
  return {...raw,ProviderIds:{...raw.ProviderIds,...(!ids.imdb&&data.imdb?{Imdb:data.imdb}:{})},IdentityTitle:data.title,IdentitySource:data.source,TmdbRating:data.rating,TmdbStatus:data.status};
 }};
}
module.exports={createMediaIdentityService};
