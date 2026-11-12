(function(){
 const $=s=>document.querySelector(s);let sequence=0,controller;
 function draw(item,data={}){
  const holder=$('#detail-rating-options'),scores=data.ratings || item.ratings || [],links=data.links || item.ratingLinks || ratingLinks(item);holder.replaceChildren();
  const keys=['imdb','tomatoes','douban',...(scores.some(x=>x.key==='metacritic')?['metacritic']:[]),'community','critic'];
  for(const key of keys){const score=scores.find(x=>x.key===key);if(!score && ['community','critic'].includes(key))continue;
   const card=document.createElement('div');card.className='media-rating'+(!score?' missing':'');card.dataset.provider=key;
   const name=document.createElement('span');name.className='media-rating-name';name.textContent=RATING_NAMES[key];
   const value=document.createElement('strong');value.textContent=score?.display || '暂无评分';
   const note=document.createElement('small');note.textContent=score?.via || (key==='douban'?'服务器未提供具名评分':'需具名资料或 OMDb 接口');card.append(name,value,note);
   const link=links.find(x=>x.key===key);if(link?.url){const a=document.createElement('a');a.href=link.url;a.target='_blank';a.rel='noopener noreferrer';a.textContent=(link.mode==='direct'?'影片主页':'搜索候选')+' ↗';a.title=link.reason || '';card.append(a);}else if(link){const hint=document.createElement('small');hint.textContent=link.reason;card.append(hint);}holder.append(card);
  }
  $('#detail-rating-note').textContent=data.message || 'Emby 社区/影评分保留服务器口径；未明确原平台的分数不冒充 IMDb、烂番茄或豆瓣。';
 }
 window.showDetailRatings=function(item,onUpdate){const current=++sequence;controller?.abort();draw(item);const id=item.embyId || (item.source==='emby'?item.id.slice(5):'');if(!id)return;
  controller=new AbortController();fetch('/api/emby/ratings/'+encodeURIComponent(id),{signal:controller.signal}).then(async response=>{const data=await response.json();if(!response.ok)throw Error('评分读取暂不可用');if(current!==sequence)return;draw(item,data);onUpdate?.(data);}).catch(error=>{if(current===sequence&&error.name!=='AbortError')$('#detail-rating-note').textContent='评分补全暂不可用，已保留服务器资料。';});
 };
 window.openRatingSettings=async function(){const dialog=$('#rating-settings-dialog');$('#rating-omdb-key').value='';$('#rating-settings-status').textContent='正在读取配置状态…';dialog.showModal();try{const status=await(await fetch('/api/ratings/settings')).json();$('#rating-settings-status').textContent=status.error || (status.configured?'OMDb 已配置。密钥不会回传到浏览器。':'OMDb 尚未配置；现有 Emby 评分仍可展示和排序。');}catch{$('#rating-settings-status').textContent='无法读取配置状态';}};
 $('#ratings-settings-open').addEventListener('click',window.openRatingSettings);$('#detail-ratings-settings').addEventListener('click',window.openRatingSettings);
 $('#rating-settings-close').addEventListener('click',()=>$('#rating-settings-dialog').close());$('#rating-settings-dialog').addEventListener('close',()=>{$('#rating-omdb-key').value='';});
 async function save(value){$('#rating-settings-save').disabled=true;$('#rating-settings-clear').disabled=true;try{const response=await fetch('/api/ratings/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)}),data=await response.json();if(!response.ok)throw Error(data.error || '配置保存失败');$('#rating-settings-status').textContent=data.configured?'已加密保存；重新打开详情即可补全外部评分。':'已清除接口配置。';}catch(error){$('#rating-settings-status').textContent=error.message;}finally{$('#rating-omdb-key').value='';$('#rating-settings-save').disabled=false;$('#rating-settings-clear').disabled=false;}}
 $('#rating-settings-form').addEventListener('submit',event=>{event.preventDefault();save({apiKey:$('#rating-omdb-key').value});});$('#rating-settings-clear').addEventListener('click',()=>save({clear:true}));
})();
