// A media item's own synopsis is not necessarily the synopsis of its parent series.
function detailPresentation(item) {
  const related = item.type === 'Episode' ? item.series : item.type === 'Movie' ? item.collection : null;
  const parent = related?.id && related.title ? related : null;
  const episode = item.type === 'Episode';
  const boxSet = item.type === 'BoxSet';
  return {
    title: parent ? parent.title : item.title,
    context: parent ? `${episode ? '当前单集' : '当前影片'}：${item.title}` : '',
    primaryHeading: parent ? (episode ? '剧集梗概' : '系列梗概') : item.type === 'Series' ? '剧集梗概' : boxSet ? '系列梗概' : episode ? '本集简介' : '影片简介',
    primaryOverview: parent ? parent.overview || 'Emby 暂无该系列的梗概。' : item.overview || '暂无剧情简介。',
    secondaryHeading: parent ? (episode ? '本集简介' : '本片简介') : '',
    secondaryOverview: parent ? item.overview || (episode ? '暂无本集简介。' : '暂无本片简介。') : '',
    browseTarget: parent,
    browseLabel: episode ? '浏览整剧 →' : '浏览系列 →',
    playLabel: episode ? '▶　播放本集' : '▶　播放影片',
    source: item.source !== 'emby' ? '本机影片' : parent ? (episode ? 'EMBY · 剧集单集' : 'EMBY · 系列电影') : item.type === 'Series' ? 'EMBY · 剧集' : boxSet ? 'EMBY · 电影合集' : episode ? 'EMBY · 单集' : 'EMBY · 影片'
  };
}

function enrichDetailItem(item, remote) {
  if (!item.embyId) return { ...item, ...remote, overview: remote.overview || item.overview };
  // Keep local ID, favorite and source: play/save actions must not silently switch to Emby.
  return {
    ...item,
    type: remote.type || item.type,
    seriesName: remote.seriesName || item.seriesName,
    overview: remote.overview || item.overview,
    series: remote.series,
    collection: remote.collection,
    people: remote.people || item.people,
    peopleFromSeries:remote.peopleFromSeries,
    seriesStatus:remote.seriesStatus,
    genres: remote.genres?.length ? remote.genres : item.genres,
    tagline: remote.tagline || item.tagline,
    runtimeMinutes: remote.runtimeMinutes || item.runtimeMinutes,
    poster: !!(item.poster || remote.poster),
    backdrop: !!(item.backdrop || remote.backdrop)
  };
}
if (typeof module !== 'undefined' && module.exports) module.exports = { detailPresentation, enrichDetailItem };
if (typeof window !== 'undefined') { window.detailPresentation = detailPresentation; window.enrichDetailItem = enrichDetailItem; }
