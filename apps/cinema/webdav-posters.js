// Shared naming rules; never infer a different movie from a partial title match.
function davMediaLabel(name,directory=false){
 const stem=String(name).replace(directory?/$^/:/\.[^.]+$/,'');
 const year=stem.match(/(?:^|[.\s_([\]-])((?:19|20)\d{2})(?=[.\s_)\]-]|$)/);
 let subject=(year?stem.slice(0,year.index):stem).replace(/^[『【\[][^』】\]]*(?:影视站|资源站|下载站|www\.|https?:\/\/)[^』】\]]*[』】\]]\s*/i,'');
 let first;
 while((first=subject.match(/^[\[【]([^\]】]+)[\]】]/))){
  if(/[\p{L}]/u.test(first[1]) && !/(?:字幕|全集|\d{3,4}p|HEVC|BDRip|WEB.?DL|BT下载|Raws|压制组)/i.test(first[1])){subject=first[1];break;}
  subject=subject.slice(first[0].length).trim();
 }
 let title=subject.split(/[\[【]/)[0].replace(/[._]+/g,' ').replace(/\b(?:2160p|1080p|720p|WEB.?DL|BluRay|HEVC)\b.*$/i,'').trim();
 const episode=title.match(/\bS\d{1,2}(?:E\d{1,3})?\b/i);if(episode && episode.index>0)title=title.slice(0,episode.index).trim();
 const chineseSeason=title.match(/第[零一二三四五六七八九十百\d]+季/);if(chineseSeason && chineseSeason.index>0)title=title.slice(0,chineseSeason.index).trim();
 title=title.replace(/[\s([\]-]+$/,'').trim();
 return {title:title || stem,year:year?.[1] || '',episode:episode?.[0]?.toUpperCase() || chineseSeason?.[0] || ''};
}
function chooseDavPoster(entry,siblings){
 const images=siblings.filter(x=>!x.directory && /\.(jpe?g|png|webp)$/i.test(x.name)),stem=(entry.directory?entry.name:entry.name.replace(/\.[^.]+$/,'')).toLowerCase();
 const names=entry.directory?['poster','folder','cover',stem+'-poster',stem+'.poster',stem]:[stem+'-poster',stem+'.poster',stem];
 if(!entry.directory && siblings.filter(x=>x.video).length===1)names.push('poster','folder','cover');
 for(const name of names){const match=images.find(x=>x.name.replace(/\.[^.]+$/,'').toLowerCase()===name);if(match)return match;}
 return null;
}
function davMetadataLabels(entry){
 const label=davMediaLabel(entry.name,entry.directory);
 const generic=value=>!/[\p{L}]/u.test(value) || /^(?:(?:s\d{1,2})?(?:e\d{1,3})?|season\s*\d+|specials|第[零一二三四五六七八九十百\d]+[季集]|ep?\s*\d+)$/i.test(value);
 if(!generic(label.title))return [label];
 if(entry.directory)return [];
 const names=String(entry.path || '').split('/').filter(Boolean).slice(0,-1).reverse().slice(0,3);
 for(const name of names){let decoded;try{decoded=decodeURIComponent(name);}catch{continue;}const parent=davMediaLabel(decoded,true);if(!generic(parent.title))return [parent];}
 return [];
}
function matchDavMetadata(label,candidates){
 const key=s=>String(s || '').normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}\s]/gu,'');
 const matches=candidates.filter(x=>['Movie','Series'].includes(x.Type) && x.ImageTags?.Primary && [x.Name,x.OriginalTitle].some(name=>key(name)===key(label.title)) && (!label.year || String(x.ProductionYear)===label.year || (x.Type==='Series' && label.episode && Number(x.ProductionYear)>0 && Number(x.ProductionYear)<=Number(label.year))));
 return matches.length===1?matches[0]:null;
}
if(typeof module!=='undefined')module.exports={davMediaLabel,chooseDavPoster,matchDavMetadata,davMetadataLabels};
if(typeof window!=='undefined')window.davMediaLabel=davMediaLabel;
