const RATING_NAMES={community:'Emby 社区',critic:'Emby 影评',imdb:'IMDb',tomatoes:'烂番茄',douban:'豆瓣',metacritic:'Metacritic'};
function providerIds(raw){return Object.fromEntries(Object.entries(raw.ProviderIds || raw.providerIds || {}).map(([k,v])=>[k.toLowerCase(),String(v)]));}
function ratingLinks(raw){
 const ids=providerIds(raw),title=String(raw.Name || raw.title || '').trim(),original=String(raw.OriginalTitle || raw.originalTitle || '').trim();
 // A Latin-script original is only a search candidate, never a verified match.
 const latin=value=>/[A-Za-z]/.test(value)&&!/[\p{Script=Han}\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Cyrillic}\p{Script=Arabic}]/u.test(value);
 const foreign=latin(original)?original:latin(title)?title:'';
 const year=String(raw.ProductionYear || raw.year || '');
 const query=value=>encodeURIComponent(value+(/^\d{4}$/.test(year)?' '+year:''));
 function link(key,idUrl,searchTitle,searchBase){return {key,name:RATING_NAMES[key],mode:idUrl?'direct':searchTitle?'search':'unavailable',url:idUrl || (searchTitle?searchBase+query(searchTitle):null),reason:idUrl?'平台 ID 直达':searchTitle?'搜索候选，尚未确认对应影片':'缺少平台 ID 或可用的拉丁字母原名，暂不提供搜索跳转'};}
 return [
  link('imdb',/^tt\d{5,12}$/.test(ids.imdb)?`https://www.imdb.com/title/${ids.imdb}/`:null,foreign,'https://www.imdb.com/find/?q='),
  link('tomatoes',/^(m|tv)\/[a-z0-9_/-]+$/i.test(ids.rottentomatoes || '')?'https://www.rottentomatoes.com/'+ids.rottentomatoes:null,foreign,'https://www.rottentomatoes.com/search?search='),
  link('douban',/^\d{1,12}$/.test(ids.douban || '')?`https://movie.douban.com/subject/${ids.douban}/`:null,title || original,'https://search.douban.com/movie/subject_search?search_text=')
 ];}
function makeRating(key,value,via){
 if(value===null || value===undefined || value==='')return null;
 const max=['critic','tomatoes','metacritic'].includes(key)?100:10;
 const match=String(value).trim().match(/^(\d+(?:\.\d+)?)(?:\/(10|100)|(%))?$/);if(!match)return null;
 if(match[2]&&Number(match[2])!==max || match[3]&&max!==100)return null;
 const score=Number(match[1]);if(!Number.isFinite(score)||score<0||score>max)return null;
 return {key,name:RATING_NAMES[key],score,max,display:max===10?score.toFixed(1)+'/10':score+(key==='tomatoes'?'%':'/100'),via};
}
function namedRatings(entries,via){const aliases={'internet movie database':'imdb',imdb:'imdb','rotten tomatoes':'tomatoes',rottentomatoes:'tomatoes',douban:'douban','豆瓣':'douban',metacritic:'metacritic'};const map=new Map();for(const entry of Array.isArray(entries)?entries:[]){const key=aliases[String(entry.Source || entry.source || '').trim().toLowerCase()];if(!key)continue;const rating=makeRating(key,entry.Value ?? entry.value,via);if(rating)map.set(key,rating);}return [...map.values()];}
function ratingsFromEmby(raw){return [makeRating('community',raw.CommunityRating,'Emby 提供；原评分平台未明确'),makeRating('critic',raw.CriticRating,'Emby 提供；影评平台未明确'),...namedRatings(raw.Ratings,'Emby 具名评分字段')].filter(Boolean);}
function ratingsFromOmdb(raw,expectedId){if(raw.Response==='False'||raw.imdbID!==expectedId)return [];const list=namedRatings(raw.Ratings,'OMDb 聚合接口');if(!list.some(x=>x.key==='imdb')){const imdb=makeRating('imdb',raw.imdbRating,'OMDb 聚合接口');if(imdb)list.unshift(imdb);}return list;}
function sortRatingItems(items,key){if(!RATING_NAMES[key])return items.slice();return items.map((item,index)=>({item,index,score:item.ratings?.find(x=>x.key===key)?.score})).sort((a,b)=>(Number.isFinite(b.score)?b.score:-Infinity)-(Number.isFinite(a.score)?a.score:-Infinity) || a.index-b.index).map(x=>x.item);}
if(typeof module!=='undefined')module.exports={RATING_NAMES,providerIds,ratingLinks,ratingsFromEmby,ratingsFromOmdb,sortRatingItems};
if(typeof window!=='undefined')Object.assign(window,{RATING_NAMES,ratingLinks,sortRatingItems});
