function createEpisodeNavigator({loadEpisodes,isWatched}) {
  return {async next(item,{skipWatched=false}={}) {
    if(item.type !== 'Episode' || !item.seriesId || !(item.parentIndexNumber>0) || !(item.indexNumber>0)) return null;
    const episodes=(await loadEpisodes(item.seriesId)).filter(e=>e.type === 'Episode' && e.seriesId === item.seriesId && e.parentIndexNumber>0 && e.indexNumber>0 && !e.missing && !e.folder)
      .sort((a,b)=>a.parentIndexNumber-b.parentIndexNumber || a.indexNumber-b.indexNumber);
    const seen=new Set();
    for(const e of episodes) {
      const key=`${e.parentIndexNumber}:${e.indexNumber}`;
      if(seen.has(key)) continue; seen.add(key);
      if(e.parentIndexNumber<item.parentIndexNumber || (e.parentIndexNumber===item.parentIndexNumber && e.indexNumber <= (item.indexNumberEnd || item.indexNumber))) continue;
      if(skipWatched && await isWatched(e)) continue;
      return e;
    }
    return null;
  }};
}
// Sources arrive in the existing quality ranking order. Never select a transcoded variant.
function chooseNextSource(sources,previous={}) {
  const direct=sources.filter(s=>s.direct);
  return direct.find(s=>s.height===previous.height && s.range===previous.range && s.videoCodec===previous.videoCodec) || direct.find(s=>s.height===previous.height && s.range===previous.range) || direct[0] || null;
}
module.exports={createEpisodeNavigator,chooseNextSource};
