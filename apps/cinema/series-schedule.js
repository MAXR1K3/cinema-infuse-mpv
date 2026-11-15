const {seriesStatus}=require('./series-status');
const normalize=s=>String(s || '').normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
function createSeriesScheduleService({request=fetch,now=Date.now}={}){
 const cache=new Map(),waiting=[];let active=0;
 async function limited(task){if(active>=2){if(waiting.length>=30)throw Error('busy');await new Promise(r=>waiting.push(r));}else active++;try{return await task();}finally{const next=waiting.shift();if(next)next();else active--;}}
 async function lookup(raw){const deadline=Date.now()+6000;
  async function json(route,redirects=0){
   const response=await request(new URL(route,'https://api.tvmaze.com'),{redirect:'manual',headers:{Accept:'application/json','User-Agent':'CinemaInfuse/1.0 (series schedule)'},signal:AbortSignal.timeout(Math.max(1,Math.min(3500,deadline-Date.now())))});
   if(response.status===301 && redirects<1){const location=new URL(response.headers.get('location') || '', 'https://api.tvmaze.com');await response.body?.cancel();if(location.origin!=='https://api.tvmaze.com'||!/^\/shows\/\d+$/.test(location.pathname))throw Error('redirect');return json(location.pathname+'?embed=nextepisode',redirects+1);}
   if(response.status===404){await response.body?.cancel();return null;}if(!response.ok){await response.body?.cancel();throw Error('unavailable');}
   const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>524288)throw Error('oversized');chunks.push(chunk);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
  const ids=Object.fromEntries(Object.entries(raw.ProviderIds || {}).map(([k,v])=>[k.toLowerCase(),String(v)]));let show,matchedBy='';
  if(/^\d{1,12}$/.test(ids.tvmaze || '')){show=await json('/shows/'+ids.tvmaze+'?embed=nextepisode');if(String(show?.id)!==ids.tvmaze)show=null;matchedBy='平台 ID';}
  else if(/^tt\d{5,12}$/.test(ids.imdb || '') || /^\d{1,12}$/.test(ids.tvdb || '')){
   const key=/^tt\d{5,12}$/.test(ids.imdb || '')?'imdb':'thetvdb',id=key==='imdb'?ids.imdb:ids.tvdb;
   show=await json('/lookup/shows?'+new URLSearchParams({[key]:id}));if(String(show?.externals?.[key])!==id)show=null;matchedBy='平台 ID';
  }else{
   const title=String(raw.OriginalTitle || raw.Name || '').trim(),year=String(raw.ProductionYear || raw.PremiereDate?.slice(0,4) || '');
   if(title.length<2 || title.length>150 || !/^(18|19|20|21)\d{2}$/.test(year))return {code:'unmatched'};
   const rows=await json('/search/shows?'+new URLSearchParams({q:title}));const matches=(Array.isArray(rows)?rows:[]).map(x=>x.show).filter(x=>x&&normalize(x.name)===normalize(title)&&String(x.premiered || '').slice(0,4)===year&&Number.isInteger(x.id)&&x.id>0);
   if(matches.length!==1)return {code:'unmatched'};
   const candidate=matches[0];show=await json('/shows/'+candidate.id+'?embed=nextepisode');
   if(show?.id!==candidate.id || normalize(show.name)!==normalize(title) || String(show.premiered || '').slice(0,4)!==year)return {code:'unmatched'};matchedBy='原名与首播年匹配';
  }
  if(!show || !Number.isInteger(show.id) || show.id<=0)return {code:'unmatched'};
  return {code:'ok',show,matchedBy};
 }
 return {async get(raw){
  const base=seriesStatus(raw,now());if(!base)return null;
  if(base.availability==='scheduled')return base;
  const key=JSON.stringify([raw.ProviderIds,raw.OriginalTitle,raw.Name,raw.ProductionYear,raw.PremiereDate]);let record=cache.get(key);
  if(!record || record.expires<now()){
   record={expires:now()+3600000};cache.set(key,record);const current=record;
   record.promise=limited(()=>lookup(raw)).catch(()=>({code:'unavailable'})).then(result=>{current.expires=now()+(result.code==='ok'?3600000:60000);return result;});while(cache.size>400)cache.delete(cache.keys().next().value);
  }
  const result=await record.promise;
  if(result.code!=='ok')return {...base,availability:result.code,schedule:base.kind==='ended'?'已完结；外部排期资料'+(result.code==='unavailable'?'暂时不可用':'未能匹配'):'Emby 未提供排期；'+(result.code==='unavailable'?'TVmaze 查询暂时失败，可稍后重试':'未匹配到唯一的 TVmaze 剧集资料')};
  const {show,matchedBy}=result,ended=['Ended','Canceled','Cancelled'].includes(show.status),running=show.status==='Running';
  const format=seriesStatus({Type:'Series',Status:ended?'Ended':running?'Continuing':'',AirDays:show.schedule?.days,AirTime:show.schedule?.time},now());
  const zone=show.network?.country?.timezone || show.webChannel?.country?.timezone;
  let schedule=format.availability==='missing'?'':format.schedule;if(schedule && zone)schedule=schedule.replace('播出地时间',zone);if(schedule)schedule='常规播出：'+schedule;
  const episode=show._embedded?.nextepisode;let nextAirDate='',precision='date';
  if(!ended && episode){if(/^\d{2}:\d{2}$/.test(episode.airtime || '') && episode.airstamp && Number.isFinite(Date.parse(episode.airstamp)) && Date.parse(episode.airstamp)>now()){nextAirDate=new Date(episode.airstamp).toISOString();precision='time';}else if(/^\d{4}-\d{2}-\d{2}$/.test(episode.airdate || '') && episode.airdate>=new Date(now()).toISOString().slice(0,10))nextAirDate=episode.airdate;}
  const availability=ended?'ended':nextAirDate?'scheduled':'no_next_episode';
  if(!schedule)schedule=ended?'全剧已完结，无后续播出安排':nextAirDate?'':'TVmaze 暂未公布下一集日期（不代表已完结）';
  else if(!nextAirDate&&!ended)schedule+=' · 尚无下一集确切日期';
  const sourceUrl=typeof show.url==='string'&&new RegExp('^https://www\\.tvmaze\\.com/shows/'+show.id+'(?:/|$)').test(show.url)?show.url:'https://www.tvmaze.com/shows/'+show.id;
  return {...base,label:ended?'已完结':running?'连载中':show.status==='To Be Determined'?'待续订':'状态待补充',kind:ended?'ended':running?'airing':'unknown',schedule,nextAirDate,nextAirDatePrecision:precision,nextEpisodeLabel:nextAirDate&&Number.isInteger(episode?.season)&&Number.isInteger(episode?.number)?'S'+String(episode.season).padStart(2,'0')+'E'+String(episode.number).padStart(2,'0'):'',availability,source:'TVmaze · '+matchedBy,sourceUrl,checkedAt:new Date(now()).toISOString(),statusConflict:base.label!==format.label?'Emby：'+base.label+'；TVmaze：'+format.label:''};
 }};
}
module.exports={createSeriesScheduleService};
