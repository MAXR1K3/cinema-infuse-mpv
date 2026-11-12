const {ratingsFromEmby,sortRatingItems}=require('./ratings');
function parseSubfilters(params){
 const genre=params.get('genre') || '',year=params.get('year') || '',status=params.get('status') || '',watched=params.get('watched') || '';
 if(genre && !/^[a-zA-Z0-9_-]{1,80}$/.test(genre))throw Error('类型筛选无效');
 if(year && !/^\d{4}(?:-\d{4})?$/.test(year))throw Error('年份筛选无效');
 const years=year.split('-').map(Number);if(year && (years[0]<1880 || years[0]>2200 || years.length>1 && (years[1]<years[0] || years[1]>2200)))throw Error('年份范围无效');
 if(!['','Continuing','Ended'].includes(status)||!['','played','unplayed'].includes(watched))throw Error('剧集或观看状态无效');
 return {genre,year,status,watched};
}
function filterSubitems(items,filters){return items.filter(x=>{
 if(filters.year){const [from,to=from]=filters.year.split('-').map(Number);if(!(Number(x.ProductionYear)>=from && Number(x.ProductionYear)<=to))return false;}
 if(filters.status && x.Status!==filters.status)return false;
 if(filters.watched && x.UserData?.Played!==(filters.watched==='played'))return false;
 return true;
});}
function compact(x){const keys=['Id','Name','OriginalTitle','Type','IsFolder','ProductionYear','ImageTags','BackdropImageTags','PrimaryImageTag','Status','UserData','CommunityRating','CriticRating','Ratings','ProviderIds','Genres'];return Object.fromEntries(keys.filter(k=>x[k]!==undefined).map(k=>[k,x[k]]));}
function createSubcategoryService({request,account}){
 const cache=new Map();let queue=Promise.resolve(),revision=0;
 async function index(parent,kind,genre){
  const owner=account(),generation=revision,key=JSON.stringify([owner,parent,kind,genre]);let cached=cache.get(key);
  const same=()=>{if(account()!==owner)throw Error('登录状态已变更，请重新筛选');if(generation!==revision)throw Error('观看资料已更新，请重新筛选');};
  if(!cached || cached.expires<Date.now()){
   cached={expires:Date.now()+300000};cache.set(key,cached);
   cached.promise=(queue=queue.catch(()=>{}).then(async()=>{
    same();const page=async(start,limit)=>{same();const q=new URLSearchParams({ParentId:parent,Recursive:'true',IncludeItemTypes:kind,StartIndex:String(start),Limit:String(limit),Fields:'Status,Genres,ProviderIds,OriginalTitle',EnableUserData:'true',EnableImages:'true',SortBy:'SortName',SortOrder:'Ascending'});if(genre)q.set('GenreIds',genre);const data=await request(q);same();return data;};
    const first=await page(0,1000),total=Number(first.TotalRecordCount),raw=first.Items || [];
    if(!Number.isSafeInteger(total)||total<0||total>100000)throw Error('服务器未提供可靠的分类总数，暂时无法精确细分');
    if(total && !raw.length)throw Error('分类索引未完整返回');
    const size=raw.length || 1000,items=raw.map(compact);
    for(let start=size;start<total;start+=size*4){
     const offsets=Array.from({length:4},(_,i)=>start+i*size).filter(x=>x<total);
     const pages=await Promise.all(offsets.map(offset=>page(offset,size)));
     for(let i=0;i<pages.length;i++){const rows=pages[i].Items || [];if(rows.length!==Math.min(size,total-offsets[i]))throw Error('分类分页不完整，请重试');items.push(...rows.map(compact));}
    }
    same();if(items.length!==total || new Set(items.map(x=>x.Id)).size!==total || items.some(x=>!x.Id))throw Error('分类索引有重复或缺失，请重试');
    return items;
   }));
   cached.promise.catch(()=>{if(cache.get(key)===cached)cache.delete(key);});
   while(cache.size>3)cache.delete(cache.keys().next().value);
  }
  const items=await cached.promise;same();return items;
 }
 return {invalidate(){revision++;cache.clear();},async browse({parent,kind,filters,start=0,sort=''}){
  const filtered=filterSubitems(await index(parent,kind,filters.genre),filters);
  const items=['community','critic'].includes(sort)?sortRatingItems(filtered.map(x=>({...x,ratings:ratingsFromEmby(x)})),sort):filtered;
  return {items:items.slice(start,start+100),total:items.length,hasMore:start+100<items.length,indexed:true};
 }};
}
module.exports={parseSubfilters,filterSubitems,createSubcategoryService};
