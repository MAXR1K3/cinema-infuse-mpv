// Broadcast metadata is distinct from library import time and playback progress.
function seriesStatus(item={},now=Date.now()) {
 if(item.Type!=='Series')return null;
 const labels={Ended:'已完结',Continuing:'连载中','Returning Series':'连载中',Canceled:'已取消',Cancelled:'已取消','In Production':'制作中',Planned:'筹备中',Pilot:'试播'};
 const endedAt=Date.parse(item.EndDate || ''),ended=Number.isFinite(endedAt) && endedAt<=now;
 const raw=String(item.Status || ''),label=labels[raw] || (!raw && ended?'已完结':'状态待补充');
 const finished=['Ended','Canceled','Cancelled'].includes(raw) || (!raw && ended);
 const days={Sunday:'周日',Monday:'周一',Tuesday:'周二',Wednesday:'周三',Thursday:'周四',Friday:'周五',Saturday:'周六'};
 const names=Object.keys(days),airDays=Array.isArray(item.AirDays)?[...new Set(item.AirDays.map(d=>days[names.find(name=>name.toLowerCase()===String(d).toLowerCase()) || names[/^[0-6]$/.test(String(d))?Number(d):-1]]).filter(Boolean))]:[];
 const time=String(item.AirTime || '').trim().slice(0,40);
 const next=item.NextEpisode?.PremiereDate || item.NextEpisodeAirDate;
 const nextMs=Date.parse(next || '');
 const dateOnly=/^\d{4}-\d{2}-\d{2}$/.test(next || ''),future=Number.isFinite(nextMs)&&(dateOnly?next>=new Date(now).toISOString().slice(0,10):nextMs>now);
 const nextAirDate=!finished && future?(dateOnly?next:new Date(nextMs).toISOString()):'';
 const schedule=finished?'':airDays.length ? '每'+airDays.join('、')+(time?' '+time:'')+'（播出地时间）' : time?'播出时间 '+time+'（播出地时间）':nextAirDate?'':'Emby 未提供播出排期';
 return {label,kind:finished?'ended':label==='连载中'?'airing':'unknown',schedule,nextAirDate,nextAirDatePrecision:dateOnly?'date':'time',availability:finished?'ended':airDays.length||time||nextAirDate?'scheduled':'missing',source:'Emby 播出资料'};
}
module.exports={seriesStatus};
