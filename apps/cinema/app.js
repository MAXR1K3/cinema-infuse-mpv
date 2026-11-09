const $ = selector => document.querySelector(selector);
let library = { items: [], embyItems: [], recent: [] };
let view = 'home';
let query = '';
let categoryStack = [];
let subfilters={genre:'',year:'',status:'',watched:''},subgenres=[],subgenreExpanded=false,subfilterEpoch=0;
let categoryItems = [];
let categoryTotal = 0;
let categoryHasMore = false;
let categoryLoading = false;
let categoryError = '';
let categoryRequest = 0;
let seriesSeasons = [];
let activeSeason = null;
let visibleCount = 80;
let searchItems = [];
let searchTotal = 0;
let searchHasMore = false;
let searchRequest = 0;
let detailItem = null;
const selectedSources = new Map();
let browseScroll = 0;
let favorites = [];
let followedSeries = [];
let nextUp = [];
let resumeItems = [];
let recentItems = [];
let recentLoaded = false;
const playbackTime = value => {
  const seconds=Math.max(0,Math.floor(Number(value)||0)),hours=Math.floor(seconds/3600);
  return `${hours ? hours+':' : ''}${String(Math.floor(seconds/60)%60).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
};
let detailProgressRequest=0;
let personItems = [];
let personTotal = 0;
let personHasMore = false;
let person = null;
let personOrigin = null;
let personNextStart=0;
let personLoading=false;
const personLoader=createLatestPersonRequest(params=>getJson(`/api/emby/person?${params}`));
const itemById = id => library.items.find(item => item.id === id);
const isContainer = item => !!(item.folder || ['Series', 'Season', 'Folder', 'CollectionFolder', 'BoxSet'].includes(item.type));
let pageEnterAnimation;
function animatePageIn(element, event) {
  // A rapid keyboard/reduced-motion navigation must also stop a prior pointer transition.
  pageEnterAnimation?.cancel();
  pageEnterAnimation = undefined;
  // Navigating by keyboard or with reduced motion should never wait for an animation.
  if (!event?.detail || matchMedia('(prefers-reduced-motion: reduce)').matches || !element.animate) return;
  pageEnterAnimation = element.animate([
    { opacity: 0.45, transform: 'translate3d(0, 8px, 0)' },
    { opacity: 1, transform: 'translate3d(0, 0, 0)' }
  ], { duration: 180, easing: 'cubic-bezier(.22, 1, .36, 1)' });
}
const seasonLabel = season => season.unclassified ? '全部集数' : season.indexNumber === 0 ? '特别篇' : Number.isInteger(season.indexNumber) ? `第 ${season.indexNumber} 季` : season.title;
function card(item) {
  const episodeInSeason = view === 'emby' && !query && ['Series', 'Season'].includes(categoryStack.at(-1)?.type) && item.type === 'Episode';
  const episodeNumber = item.type === 'Episode' && Number.isInteger(item.indexNumber) ? `${item.parentIndexNumber == null ? '' : `S${String(item.parentIndexNumber).padStart(2,'0')} · `}E${String(item.indexNumber).padStart(2,'0')}` : '';
  const displayTitle = item.type === 'Episode' && !episodeInSeason && item.seriesName ? item.seriesName : item.title;
  const el = document.createElement('article'); el.className = `card${episodeInSeason ? ' episode-card' : ''}`;
  const button = document.createElement('button'); button.className = 'poster';
  button.type = 'button'; button.setAttribute('aria-label', `查看 ${displayTitle}${displayTitle !== item.title ? ` · ${item.title}` : ''} 详情`);
  const fallback = document.createElement('span'); fallback.className = 'fallback'; fallback.textContent = episodeInSeason ? episodeNumber || '单集' : displayTitle;
  button.append(fallback);
  if (item.poster) {
    const image = document.createElement('img'); image.loading = 'lazy'; image.alt = '';
    image.src = `/art/${encodeURIComponent(item.id)}/poster`;
    image.addEventListener('error', () => image.remove());
    button.prepend(image);
  }
  button.addEventListener('click', event => {
    if (item.source === 'emby' && (['Folder', 'CollectionFolder', 'Season'].includes(item.type) || (item.folder && !['Series', 'BoxSet'].includes(item.type)))) {
      if (view !== 'emby' || query) { categoryStack = []; clearSearchState(); }
      view = 'emby'; openFolder(item); window.scrollTo({ top: 0, behavior: 'instant' });
      animatePageIn($('#browse-page'), event);
    } else openDetail(item, event);
  });
  const title = document.createElement('div'); title.className = 'card-title'; title.title = displayTitle; title.textContent = displayTitle;
  const year = document.createElement('div'); year.className = 'card-year';
  year.textContent = [episodeNumber || item.year, item.folder ? '分类' : displayTitle !== item.title ? item.title : item.seriesName || (item.source === 'emby' ? 'Emby' : ''), item.completed ? '已看完' : item.resumeSeconds>3 ? `已看至 ${playbackTime(item.resumeSeconds)}` : item.nextUp ? '接着看下一集' : ''].filter(Boolean).join(' · ') || '影片';
  if (episodeInSeason) {
    const summary = document.createElement('p'); summary.className = 'episode-summary'; summary.textContent = item.overview || '暂无本集简介';
    el.append(button, year, title, summary);
  } else el.append(button, title, year);
  if (item.progress > 0 && item.progress < 100) {
    const progress = document.createElement('div'); progress.className = 'card-progress'; progress.setAttribute('aria-label', `已看 ${Math.round(item.progress)}%`);
    const fill = document.createElement('span'); fill.style.width = `${Math.min(100, Math.max(0, item.progress))}%`; progress.append(fill); el.append(progress);
  }
  return el;
}
function fill(container, items, empty) {
  container.replaceChildren(...(items.length ? items.map(card) : []));
  if (!items.length) { const div = document.createElement('div'); div.className = 'empty'; div.textContent = empty; container.append(div); }
}
function render() {
  if(window.webdavVisible)return;
  renderSubfilters();
  const recent = !recentLoaded ? [] : recentItems.length ? recentItems.map(item => {
    if (item.source === 'emby') return item;
    const local = itemById(item.id);
    return local ? { ...local, ...item } : null;
  }).filter(Boolean)
    : library.recent.map(itemById).filter(Boolean);
  const emby = library.emby || {};
  const currentSeries = view === 'emby' && !query && categoryStack.at(-1)?.type === 'Series' ? categoryStack.at(-1) : null;
  const all = [...(library.items || []), ...(library.embyItems || [])];
  const source = view === 'emby' && !query ? (categoryStack.length ? categoryItems : (library.embyItems || [])) : view === 'all' && !query ? library.items : view === 'favorites' ? favorites : view === 'following' ? followedSeries : view === 'resume' ? resumeItems : view === 'person' ? personItems : all;
  const filtered = query ? [
    ...library.items.filter(item => `${item.title} ${item.year}`.toLocaleLowerCase().includes(query)),
    ...searchItems
  ] : source;
  const featured = recent.find(item => item.backdrop) || all.find(item => item.backdrop) || recent[0] || all[0];
  $('#hero').hidden = view !== 'home' || !!query || !featured;
  $('#recent-section').hidden = view !== 'home' || !!query || !recent.length;
  $('#resume-section').hidden = view !== 'home' || !!query || !resumeItems.length;
  $('#next-section').hidden = !['home','following'].includes(view) || !!query || !nextUp.length;
  if (!$('#resume-section').hidden) fill($('#resume-grid'), resumeItems.slice(0, 6), '暂无观看进度');
  if (!$('#next-section').hidden) fill($('#next-grid'), nextUp.slice(0, 6), '暂无下一集');
  $('#all-title').textContent = query ? '搜索结果' : currentSeries ? `${activeSeason ? seasonLabel(activeSeason) : '选择季'} · 单集` : view === 'recent' ? '最近观看' : view === 'emby' ? (categoryStack.at(-1)?.name || 'Emby 精选') : view === 'home' ? '为你精选' : view === 'favorites' ? '我的收藏' : view === 'following' ? '我追的剧集' : view === 'resume' ? '继续观看' : view === 'person' ? `${person?.name || '演职员'}的作品` : '本地影片';
  $('#heading').textContent = query ? '找到喜欢的影片' : view === 'recent' ? '最近观看' : currentSeries ? currentSeries.name : view === 'emby' ? 'Emby 片库' : view === 'all' ? '全部影片' : view === 'favorites' ? '我的收藏' : view === 'following' ? '接着追剧' : view === 'resume' ? '继续观看' : view === 'person' ? '演职员作品' : '晚上好，来看点什么？';
  const shown = view === 'recent' && !query ? recent : filtered;
  $('#grid').classList.toggle('episodes-grid', view === 'emby' && !query && (currentSeries || categoryStack.at(-1)?.type === 'Season'));
  if (view === 'emby' && categoryStack.length && categoryLoading && !categoryItems.length) {
    $('#grid').replaceChildren(...Array.from({ length: 8 }, () => {
      const tile = document.createElement('div'); tile.className = 'poster-skeleton'; tile.setAttribute('aria-hidden', 'true'); return tile;
    }));
  } else fill($('#grid'), shown.slice(0, visibleCount), query ? '没有找到匹配的影片。' : ['following','resume'].includes(view) && !emby.connected ? '请先连接 Emby。' : view === 'favorites' ? '还没有收藏影片。' : view === 'following' ? '在剧集详情点击“追剧”，这里会显示你关注的剧。' : view === 'resume' ? 'Emby 暂无可继续观看的影片。' : view === 'person' ? (personLoading ? '正在核验演职员作品…' : '没有找到相关影视作品。') : view === 'emby' && !emby.connected ? '连接 Emby 后即可浏览服务器上的影片。' : view === 'emby' && categoryError ? '暂时无法读取该分类，点击上方重试。' : view === 'emby' && emby.error ? `Emby 片库读取失败：${emby.error}` : library.error && !all.length ? '影库暂时无法读取，请检查 Z: 盘连接。' : '这里还没有影片。');
  $('#grid').setAttribute('aria-busy', String(view === 'emby' && categoryLoading));
  $('#more').hidden = categoryLoading || shown.length <= visibleCount && !(query ? searchHasMore : view === 'emby' && categoryStack.length && categoryHasMore || view === 'person' && personHasMore);
  if (view === 'home' && !query) fill($('#recent-grid'), recent.slice(0, 6), '暂无观看记录');
  $('#count').textContent = `${query && library.emby?.connected ? searchTotal + library.items.filter(item => `${item.title} ${item.year}`.toLocaleLowerCase().includes(query)).length : view === 'emby' && categoryStack.length ? categoryTotal : view === 'person' ? personTotal : shown.length} ${currentSeries || view === 'emby' && categoryStack.at(-1)?.type === 'Season' ? '集' : '部'}`;
  if (featured) {
    $('#hero-pill').textContent = featured.id === recent[0]?.id ? '继续欣赏' : '精选影片';
    $('#hero-title').textContent = featured.type === 'Episode' && featured.seriesName ? featured.seriesName : featured.title;
    $('#hero-meta').textContent = [featured.type === 'Episode' && featured.seriesName ? featured.title : featured.year, featured.rating ? `★ ${Number(featured.rating).toFixed(1)}` : '', '使用 mpv 原画质播放'].filter(Boolean).join('  ·  ');
    $('#hero').style.backgroundImage = featured.backdrop ? `url('/art/${featured.id}/backdrop')` : featured.poster ? `linear-gradient(90deg,#0c1725ee,#0c172588),url('/art/${featured.id}/poster')` : '';
    $('#hero-play').textContent = '查看影片详情';
    $('#hero-play').onclick = event => openDetail(featured, event);
  }
  document.querySelectorAll('[data-view]').forEach(el => {
    el.classList.toggle('active', el.dataset.view === view);
    if (el.classList.contains('rail-btn')) {
      if (el.dataset.view === view) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current');
    }
  });
  const hub = $('#emby-hub'); hub.hidden = view !== 'emby' || !!query || !!currentSeries;
  if (!hub.hidden) {
    $('#hub-title').textContent = emby.connected ? `欢迎回来，${emby.user}` : '连接你的 Emby 片库';
    $('#hub-description').textContent = emby.connected ? '按分类浏览完整片库，继续上次的观看，或直接搜索影片。' : emby.error || '将你的 Emby 服务器接入这里，海报、分类与观看进度会按当前账号显示。';
    $('#hub-meta').textContent = emby.connected ? `${emby.url}　·　${(library.embyViews || []).length} 个分类　·　${emby.remembered ? '已记住连接' : '本次会话'}` : `服务器：${emby.url || '尚未设置'}`;
    $('#hub-action').textContent = emby.connected ? '管理连接' : '连接 Emby →';
  }
  const feedback = $('#category-feedback');
  feedback.hidden = view !== 'emby' || !categoryStack.length || !(categoryLoading || categoryError);
  $('#category-message').textContent = categoryLoading ? currentSeries ? activeSeason ? '正在读取本季单集…' : '正在读取分季…' : (Object.values(subfilters).some(Boolean)?'正在从完整分类中筛选，请稍候…':'正在读取分类…') : categoryError;
  $('#category-retry').hidden = !categoryError || categoryLoading;
  $('#season-browser').hidden = !currentSeries;
  if (currentSeries) {
    $('#season-series-title').textContent = '选择季';
    const numberedSeasons = seriesSeasons.filter(season => Number.isInteger(season.indexNumber) && season.indexNumber > 0).length;
    const hasSpecials = seriesSeasons.some(season => season.indexNumber === 0);
    const seasonCount = seriesSeasons[0]?.unclassified ? 'Emby 未提供分季目录' : numberedSeasons ? `共 ${numberedSeasons} 季${hasSpecials ? ' · 特别篇' : ''}` : hasSpecials ? '特别篇' : `共 ${seriesSeasons.length} 季`;
    $('#season-summary').textContent = !seriesSeasons.length ? categoryError ? '分季暂不可用，请重试' : '正在读取分季…' : `${seasonCount} · ${activeSeason ? seasonLabel(activeSeason) : '选择季'} · ${categoryError ? '单集读取失败，请重试' : categoryLoading ? '正在读取单集…' : `${categoryTotal} 集`}`;
    const tabs = $('#season-tabs');
    if (tabs.children.length !== seriesSeasons.length || seriesSeasons.some((season,index)=>tabs.children[index]?.dataset.seasonId !== season.id)) {
      tabs.replaceChildren(...seriesSeasons.map(season => {
        const button = document.createElement('button'); button.type = 'button'; button.dataset.seasonId = season.id;
        button.textContent = seasonLabel(season);
        button.addEventListener('click', () => selectSeason(season));
        return button;
      }));
    }
    [...tabs.children].forEach(button => {
      const selected = button.dataset.seasonId === activeSeason?.id;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    $('#season-detail').hidden = !currentSeries.item;
    $('#season-detail').onclick = event => { if (currentSeries.item) openDetail(currentSeries.item, event); };
  }
  const categories = $('#emby-categories');
  categories.hidden = view !== 'emby' || !emby.connected;
  if (!categories.hidden) {
    categories.replaceChildren();
    const choices = [{ id: '', name: '精选' }, ...(library.embyViews || [])];
    for (const choice of choices) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = choice.name;
      const selected = (categoryStack[0]?.id || '') === choice.id;
      button.classList.toggle('active', selected); button.setAttribute('aria-pressed', String(selected));
      button.addEventListener('click', () => selectCategory(choice)); categories.append(button);
    }
  }
  const crumbs = $('#emby-breadcrumb'); crumbs.hidden = view !== 'emby' || categoryStack.length < 2;
  $('#context-back').hidden = view !== 'person' || !personOrigin;
  crumbs.replaceChildren();
  categoryStack.forEach((part, index) => {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = part.name;
    button.addEventListener('click', () => openStack(index + 1)); crumbs.append(button);
    if (index < categoryStack.length - 1) crumbs.append(document.createTextNode('›'));
  });
  $('#emby-connect').textContent = emby.connected ? `● ${emby.user} · Emby` : '连接 Emby';
  $('#emby-connect').classList.toggle('connected', !!emby.connected);
}
function resetSubfilterContext(){subfilters={genre:'',year:'',status:'',watched:''};subgenres=[];subgenreExpanded=false;subfilterEpoch++;categoryRequest++;categoryStack=[];categoryItems=[];categoryTotal=0;categoryHasMore=false;categoryLoading=false;categoryError='';$('#subfilter-message').textContent='';if(detailItem)closeDetail(false);}
async function load() {
  const priorSubfilterAccount=JSON.stringify([library.emby?.url,library.emby?.user,library.emby?.connected]);
  recentLoaded = false;
  try {
    const response = await fetch('/api/library'); library = await response.json();if(priorSubfilterAccount!==JSON.stringify([library.emby?.url,library.emby?.user,library.emby?.connected]))resetSubfilterContext();
    $('#emby-url').value = library.emby?.url || '';
    $('#status').textContent = library.emby?.connected ? `本地 ${library.items.length} 部 · Emby 已连接${library.emby.error ? ' · ' + library.emby.error : ''}` : library.error ? `本地读取失败：${library.error}` : library.emby?.error || `本地 ${library.items.length} 部 · Emby 尚未连接`;
    $('#status').classList.toggle('error', !!(library.error || library.emby?.error));
  } catch (e) { library = { items: [], recent: [], error: e.message }; $('#status').textContent = `无法连接本机影库：${e.message}`; $('#status').classList.add('error'); }
  render();
  loadExtras();
}
async function getJson(url) {
  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok) throw Error(data.error || '读取失败');
  return data;
}
async function loadExtras() {
  const connected = !!library.emby?.connected;
  const [favoriteResult, followResult, resumeResult, recentResult] = await Promise.allSettled([
    getJson('/api/favorites'),
    connected ? getJson('/api/following') : Promise.resolve({ series: [], nextUp: [] }),
    getJson('/api/resume'),
    getJson('/api/recent')
  ]);
  favorites = favoriteResult.status === 'fulfilled' ? favoriteResult.value.items : [];
  followedSeries = followResult.status === 'fulfilled' ? followResult.value.series : [];
  nextUp = followResult.status === 'fulfilled' ? followResult.value.nextUp : [];
  resumeItems = resumeResult.status === 'fulfilled' ? resumeResult.value.items : [];
  recentItems = recentResult.status === 'fulfilled' ? recentResult.value.items : [];
  recentLoaded = true;
  render();
}
async function play(item, fromBeginning = false) {
  $('#status').textContent = `正在用 mpv 打开《${item.title}》…`;
  $('#detail-status').textContent = `正在用 mpv 打开《${item.title}》…`;
  $('#detail-status').classList.remove('error');
  try {
    const sourceId = item.source === 'emby' ? selectedSources.get(item.id) || item.recommendedSourceId : null;
    const response = await fetch(`/api/play/${item.id}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({...(sourceId ? {sourceId} : {}),fromBeginning})
    });
    const data = await response.json();
    if (!response.ok) throw Error(data.error || '启动失败');
    const message = `已交给 mpv 播放《${item.title}》${data.resumeSeconds>3 ? ` · 从 ${playbackTime(data.resumeSeconds)} 继续` : fromBeginning ? ' · 从头播放' : ''}${data.sourceName ? ` · ${data.sourceName}` : ''}`;
    $('#status').textContent = message;
    $('#detail-status').textContent = message;
  } catch (e) { $('#status').textContent = e.message; $('#status').classList.add('error'); $('#detail-status').textContent = e.message; $('#detail-status').classList.add('error'); }
}
async function loadDetailProgress(item) {
  const ticket=++detailProgressRequest;
  if(isContainer(item)) {$('#detail-progress').hidden=true;$('#detail-restart').hidden=true;return;}
  const source=selectedSources.get(item.id),params=new URLSearchParams(source ? {source} : {});
  try {
    const saved=await getJson(`/api/progress/${encodeURIComponent(item.id)}?${params}`);
    if(ticket !== detailProgressRequest || detailItem?.id !== item.id) return;
    const resumable=saved.resumeSeconds>3 && !saved.completed;
    $('#detail-play').textContent=resumable ? `▶　继续播放 ${playbackTime(saved.resumeSeconds)}` : detailPresentation(item).playLabel;
    $('#detail-restart').hidden=!resumable;
    $('#detail-restart').onclick=()=>play(item,true);
    $('#detail-progress').hidden=!resumable && !saved.completed;
    $('#detail-progress').textContent=saved.completed ? '✓ 已看完 · 再次播放将从头开始' : resumable ? `已保存至 ${playbackTime(saved.resumeSeconds)}${saved.durationSeconds ? ' / '+playbackTime(saved.durationSeconds) : ''} · 播放中自动记忆进度` : '';
  } catch { /* Playback remains available while the optional progress display retries. */ }
}
function showDetail(item, hydrate = true) {
  window.webdavVisible=false;$('#webdav-page').hidden=true;$('#webdav-nav').classList.remove('active');
  detailItem = item;
  $('#detail-back').textContent = view === 'person' ? '← 返回演职员作品' : '← 返回片库';
  if(hydrate) {detailProgressRequest++;$('#detail-progress').hidden=true;$('#detail-restart').hidden=true;}
  showSubtitlePanel(item, hydrate);
  $('#browse-page').hidden = true; $('#detail-page').hidden = false;
  const story = detailPresentation(item);
  const artwork = story.browseTarget || item;
  const poster = $('#detail-poster');
  const posterItem = artwork.poster ? artwork : item;
  const backdropItem = artwork.backdrop || artwork.poster ? artwork : item;
  $('#detail-page').classList.toggle('no-backdrop', !(backdropItem.backdrop || backdropItem.poster));
  poster.style.backgroundImage = posterItem.poster ? `url('/art/${encodeURIComponent(posterItem.id)}/poster')` : '';
  poster.textContent = posterItem.poster ? '' : story.title;
  $('#detail-hero').style.backgroundImage = backdropItem.backdrop ? `url('/art/${encodeURIComponent(backdropItem.id)}/backdrop')` : backdropItem.poster ? `url('/art/${encodeURIComponent(backdropItem.id)}/poster')` : '';
  $('#detail-source').textContent = story.source;
  $('#detail-title').textContent = story.title;
  $('#detail-context').textContent = story.context;
  $('#detail-context').hidden = !story.context;
  const meta = [item.year, item.runtimeMinutes ? `${item.runtimeMinutes} 分钟` : '', item.officialRating, item.seriesName === story.title ? '' : item.seriesName, item.rating ? `★ ${Number(item.rating).toFixed(1)}` : ''].filter(Boolean);
  $('#detail-meta').textContent = meta.join('　·　') || '影片';
  const broadcast=$('#detail-broadcast');broadcast.replaceChildren();broadcast.hidden=!item.seriesStatus;
  if(item.seriesStatus){const info=item.seriesStatus,badge=document.createElement('span');badge.className='broadcast-badge '+info.kind;badge.textContent=info.label;broadcast.append(badge);const schedule=document.createElement('span');schedule.textContent=[info.schedule,info.nextAirDate?'下集预计 '+new Date(info.nextAirDate).toLocaleString('zh-CN'): ''].filter(Boolean).join(' · ');broadcast.append(schedule);broadcast.title=info.source+'；播出排期不代表片库上架时间';}
  $('#detail-tagline').textContent = item.tagline || '';
  $('#detail-tagline').hidden = !item.tagline;
  $('#detail-genres').replaceChildren(...(item.genres || []).map(genre => {
    const chip = document.createElement('span'); chip.textContent = genre; return chip;
  }));
  const showSources = item.source === 'emby' && !isContainer(item);
  $('#detail-sources').hidden = !showSources;
  if (showSources) {
    const sources = item.sources || [];
    const selected = selectedSources.get(item.id);
    if (!sources.some(source => source.id === selected && source.direct)) {
      if (sources.some(source=>source.id === item.resumeSourceId && source.direct)) selectedSources.set(item.id,item.resumeSourceId);
      else if (item.recommendedSourceId) selectedSources.set(item.id, item.recommendedSourceId);
      else selectedSources.delete(item.id);
    }
    $('#detail-source-count').textContent = sources.length ? `${sources.length} 个版本` : '';
    $('#detail-source-options').replaceChildren(...sources.map((source, index) => {
      const label = document.createElement('label'); label.className = 'source-option';
      const input = document.createElement('input'); input.type = 'radio'; input.name = 'media-source'; input.value = source.id;
      input.checked = selectedSources.get(item.id) === source.id; input.disabled = !source.direct;
      input.addEventListener('change', () => {selectedSources.set(item.id, source.id);loadDetailProgress(item)});
      const top = document.createElement('span'); top.className = 'source-option-top';
      const name = document.createElement('span'); name.className = 'source-option-name';
      name.textContent = source.name + (sources.filter(other => other.name === source.name).length > 1 ? ` · 版本 ${index + 1}` : '');
      top.append(name);
      if (source.id === item.recommendedSourceId) {
        const badge = document.createElement('span'); badge.className = 'source-option-badge'; badge.textContent = '推荐'; top.append(badge);
      }
      const meta = document.createElement('span'); meta.className = 'source-option-meta';
      const quality = source.height >= 2160 ? '4K' : source.height >= 1440 ? '1440p' : source.height ? `${source.height}p` : '';
      meta.textContent = [quality, source.range, source.videoCodec, source.bitrate ? `${(source.bitrate / 1e6).toFixed(1)} Mb/s` : '', source.size ? `${(source.size / 1e9).toFixed(1)} GB` : '', source.audioCodec, source.audioChannels ? `${source.audioChannels} 声道` : '', source.direct ? '' : '无法原画直传'].filter(Boolean).join(' · ');
      label.append(input, top, meta); return label;
    }));
    $('#detail-source-note').textContent = item.sourcesError ? `片源读取失败：${item.sourcesError}`
      : !sources.length ? '正在读取 Emby 播放版本…'
      : sources.some(source => source.range === 'Dolby Vision') && sources.some(source => source.range.startsWith('HDR10'))
        ? '默认推荐兼顾画质和兼容性。若杜比视界画面发绿，可手动选 HDR10 版本。'
        : '默认推荐画质较高且可原画播放的版本；也可手动切换。';
  }
  $('#detail-primary-heading').textContent = story.primaryHeading;
  $('#detail-overview').textContent = hydrate && (item.source === 'emby' || item.embyId) && ['Episode', 'Movie'].includes(item.type) ? '正在读取作品与系列资料…' : story.primaryOverview;
  $('#detail-secondary').hidden = !story.secondaryHeading;
  $('#detail-secondary-heading').textContent = story.secondaryHeading;
  $('#detail-secondary-overview').textContent = story.secondaryOverview;
  const people = item.people || [];
  $('#detail-people').hidden = !people.length;
  $('#detail-people h2').textContent=item.peopleFromSeries ? '演职员 · 全剧阵容' : '演职员';
  const jobNames={Actor:'演员',Director:'导演',Writer:'编剧',Screenplay:'编剧',Producer:'制片人',ExecutiveProducer:'执行制片人',Editor:'剪辑',Composer:'配乐',Music:'音乐',Cinematographer:'摄影'};
  const makeCredit=credit=>{
    const button = document.createElement('button'); button.type = 'button'; button.className = 'detail-person';
    const portrait=document.createElement('div');portrait.className='person-portrait';portrait.setAttribute('aria-hidden','true');
    const fallback=document.createElement('div');fallback.className='person-placeholder';fallback.textContent=Array.from(credit.name.trim())[0] || '人';portrait.append(fallback);
    if(credit.id && credit.imageTag){const image=document.createElement('img');image.src=`/art/person/${encodeURIComponent(credit.id)}?v=${encodeURIComponent(credit.imageTag)}`;image.alt='';image.loading='lazy';image.decoding='async';image.addEventListener('error',()=>image.remove());portrait.append(image);}
    const name=document.createElement('div');name.className='person-name';name.textContent=credit.nameZh || credit.name;
    const role=document.createElement('div');role.className='person-role';role.textContent=credit.type==='Actor' ? (credit.roleZh || credit.role ? `饰 ${credit.roleZh || credit.role}` : '演员') : jobNames[credit.role] || (credit.role && credit.role!==credit.type ? credit.role : jobNames[credit.type] || '工作人员');
    if(credit.isLead){const badge=document.createElement('span');badge.className='person-lead';badge.textContent='主演';portrait.append(badge);}
    if(credit.roleZh && credit.role && credit.roleZh!==credit.role){const original=document.createElement('small');original.className='person-role-original';original.textContent=credit.role;role.append(original);}
    button.title=[credit.name,credit.roleZh,credit.role].filter(Boolean).join(' · ');
    button.append(portrait,name,role);button.disabled=!credit.id;
    if(credit.id)button.addEventListener('click', event => openPerson(credit, item, true, event)); return button;
  };
  const groups=[['演员',people.filter(p=>p.type==='Actor').sort((a,b)=>Number(!!b.isLead)-Number(!!a.isLead) || Number(!!b.orderSource)-Number(!!a.orderSource) || (a.billingOrder ?? Infinity)-(b.billingOrder ?? Infinity))],['导演',people.filter(p=>p.type==='Director')],['其他工作人员',people.filter(p=>!['Actor','Director'].includes(p.type))]];
  $('#detail-people-list').replaceChildren(...groups.filter(([,members])=>members.length).map(([label,members])=>{
    const section=document.createElement('section');section.className='credit-group';
    const heading=document.createElement('h3');heading.className='credit-group-title';heading.textContent=label;
    const count=document.createElement('span');count.textContent=String(members.length);heading.append(count);
    const row=document.createElement('div');row.className='detail-people-list credit-row';row.setAttribute('aria-label',label);row.append(...members.map(makeCredit));section.append(heading,row);
    const links=new Map();for(const member of members){if(member.orderSource)links.set(member.orderSource,'演职员资料：TMDB');if(member.roleSource)links.set(member.roleSource,`中文角色名：${member.roleSourceLabel || '资料来源'}`);}
    if(links.size){const note=document.createElement('div');note.className='credit-sources';for(const [url,label] of links){if(!/^https:\/\/(www\.themoviedb\.org|www\.disneyplus\.com|www\.gtv\.com\.tw)\//.test(url))continue;const link=document.createElement('a');link.href=url;link.target='_blank';link.rel='noopener noreferrer';link.textContent=label;note.append(link);}section.append(note);}
    return section;
  }));
  $('#detail-play').hidden = isContainer(item);
  $('#detail-play').disabled = showSources && !selectedSources.has(item.id);
  $('#detail-play').textContent = story.playLabel;
  $('#detail-browse').hidden = !isContainer(item);
  $('#detail-related').hidden = !story.browseTarget;
  $('#detail-related').textContent = story.browseLabel;
  $('#detail-related').onclick = event => browseFromDetail(story.browseTarget, event);
  $('#detail-favorite').textContent = item.favorite ? '♥ 已收藏' : '♡ 收藏';
  $('#detail-favorite').setAttribute('aria-pressed', String(!!item.favorite));
  $('#detail-favorite').onclick = () => toggleFavorite(item);
  $('#detail-follow').hidden = item.source !== 'emby' || item.type !== 'Series';
  $('#detail-follow').textContent = item.following ? '✓ 正在追剧' : '＋ 追剧';
  $('#detail-follow').setAttribute('aria-pressed', String(!!item.following));
  $('#detail-follow').onclick = () => toggleFollow(item);
  $('#detail-play').onclick = () => play(item);
  if(!hydrate || (item.source !== 'emby' && !item.embyId)) loadDetailProgress(item);
  $('#detail-browse').onclick = event => browseFromDetail(item, event);
  $('#detail-status').textContent = '';
  $('#detail-status').classList.remove('error');
  document.title = `${story.title} · 影院`;
  if (hydrate) {
    window.scrollTo({ top: 0, behavior: 'instant' });
    $('#detail-back').focus();
  }
  if (hydrate && (item.source === 'emby' || item.embyId)) {
    fetch(`/api/emby/item/${encodeURIComponent(item.embyId || item.id.slice(5))}`).then(async response => {
      const data = await response.json();
      if (!response.ok) throw Error(data.error || '资料读取失败');
      if (detailItem?.id === item.id) showDetail(enrichDetailItem(item, data), false);
    }).catch(error => {
      if (detailItem?.id === item.id) {
        showSubtitlePanel(item, false);
        loadDetailProgress(item);
        $('#detail-overview').textContent = item.overview || '暂无剧情简介。';
        $('#detail-status').textContent = `详细资料暂不可用：${error.message}`;
        $('#detail-status').classList.add('error');
      }
    });
  }
}
function captureBrowseState() {
  return {view,query,categoryStack,categoryItems,categoryTotal,categoryHasMore,categoryError,seriesSeasons,activeSeason,
    subfilters:{...subfilters},subgenres,subgenreExpanded,visibleCount,searchItems,searchTotal,searchHasMore,
    person,personOrigin,personItems,personTotal,personHasMore,personNextStart,personLoading,
    scroll:detailItem ? browseScroll : window.scrollY};
}
function saveNavigation() {
  const cinemaBrowse=captureBrowseState();
  history.replaceState({...history.state,cinemaBrowse},'',window.location.href);
  return cinemaBrowse;
}
function restoreBrowseState(state={}) {
  // Invalidate work started by a page that the user has already left.
  personLoader.cancel();categoryRequest++;searchRequest++;subfilterEpoch++;detailProgressRequest++;clearTimeout(searchTimer);
  view=state.view || 'home';query=state.query || '';categoryStack=state.categoryStack || [];categoryItems=state.categoryItems || [];
  categoryTotal=state.categoryTotal || 0;categoryHasMore=!!state.categoryHasMore;categoryError=state.categoryError || '';categoryLoading=false;
  seriesSeasons=state.seriesSeasons || [];activeSeason=state.activeSeason || null;
  subfilters=state.subfilters || {genre:'',year:'',status:'',watched:''};subgenres=state.subgenres || [];subgenreExpanded=!!state.subgenreExpanded;
  visibleCount=state.visibleCount || 80;searchItems=state.searchItems || [];searchTotal=state.searchTotal || 0;searchHasMore=!!state.searchHasMore;
  person=state.person || null;personOrigin=state.personOrigin || null;personItems=state.personItems || [];personTotal=state.personTotal || 0;
  personHasMore=!!state.personHasMore;personNextStart=state.personNextStart || 0;personLoading=!!state.personLoading;
  $('#search').value=query;browseScroll=state.scroll || 0;
}
function openDetail(item, event) {
  if (!detailItem) browseScroll = window.scrollY;
  const cinemaBrowse=saveNavigation();
  history.pushState({ cinemaDetail: item,cinemaBrowse }, '', window.location.href);
  showDetail(item);
  animatePageIn($('#detail-page'), event);
}
function closeDetail(restoreScroll = true) {
  if (!detailItem) return;
  detailItem = null;
  $('#detail-page').hidden = true; $('#browse-page').hidden = false;
  document.title = '影院 · mpv 影库';
  if (restoreScroll) requestAnimationFrame(() => window.scrollTo({ top: browseScroll, behavior: 'instant' }));
}
function browseFromDetail(item, event) {
  closeDetail(false);
  history.replaceState(null, '', window.location.href);
  clearSearchState();
  view = 'emby'; categoryStack = [];
  openFolder(item); render();
  window.scrollTo({ top: 0, behavior: 'instant' });
  $('#heading').focus({ preventScroll: true });
  animatePageIn($('#browse-page'), event);
}
async function postJson(url, value) {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
  const data = await response.json();
  if (!response.ok) throw Error(data.error || '保存失败');
  return data;
}
async function toggleFavorite(item) {
  const button = $('#detail-favorite'); button.disabled = true;
  try {
    const data = await postJson(`/api/favorite/${encodeURIComponent(item.id)}`, { favorite: !item.favorite });
    item.favorite = data.favorite;
    const local = library.items.find(entry => entry.id === item.id);
    if (local) local.favorite = data.favorite;
    const remote = library.embyItems?.find(entry => entry.id === item.id);
    if (remote) remote.favorite = data.favorite;
    if (detailItem?.id === item.id) showDetail(item, false);
    await loadExtras();
  } catch (error) { $('#detail-status').textContent = `收藏失败：${error.message}`; $('#detail-status').classList.add('error'); }
  finally { button.disabled = false; }
}
async function toggleFollow(item) {
  const button = $('#detail-follow'); button.disabled = true;
  try {
    const data = await postJson(`/api/follow/${encodeURIComponent(item.id)}`, { following: !item.following });
    item.following = data.following;
    if (detailItem?.id === item.id) showDetail(item, false);
    await loadExtras();
  } catch (error) { $('#detail-status').textContent = `追剧保存失败：${error.message}`; $('#detail-status').classList.add('error'); }
  finally { button.disabled = false; }
}
async function fetchPerson(start = 0) {
  if (!person) return;
  const target=person;
  const q = new URLSearchParams({ start: String(start) });
  q.set('id',target.id);
  await personLoader.load(q,data=>{
    if(person!==target || view!=='person')return;
    personItems=[...new Map((start ? personItems.concat(data.items) : data.items).map(item=>[item.id,item])).values()];
    personLoading=false;personTotal=personItems.length;personHasMore=data.hasMore;personNextStart=data.nextStart;render();
    if(data.incomplete){$('#status').textContent='部分作品暂时无法核验，已展示确认关联的作品';}
  });
}
async function openPerson(credit, origin, push = true, event) {
  if(push)saveNavigation();
  personLoader.cancel();clearSearchState();categoryStack=[];personNextStart=0;
  closeDetail(false); person = credit; personOrigin = origin; personItems = []; personTotal = 0; personHasMore = false; visibleCount = 80;
  view = 'person';personLoading=true; render();
  window.scrollTo({ top: 0, behavior: 'instant' });
  if(push)history.pushState({cinemaPerson:credit,cinemaOrigin:origin,cinemaBrowse:captureBrowseState()},'',window.location.href);
  animatePageIn($('#browse-page'), event);
  try { await fetchPerson(); } catch (error) { if(view==='person' && person===credit){$('#status').textContent = `演职员作品读取失败：${error.message}`; $('#status').classList.add('error');} }
}
let pointerBackPending = false;
$('#context-back').addEventListener('click', event => {
  if (history.state?.cinemaPerson) { pointerBackPending = !!event.detail; history.back(); }
  else if (personOrigin) openDetail(personOrigin, event);
});
$('#detail-back').addEventListener('click', event => {
  if (history.state?.cinemaDetail) { pointerBackPending = !!event.detail; history.back(); }
  else { closeDetail(); animatePageIn($('#browse-page'), event); }
});
window.addEventListener('popstate', event => {
  if(window.webdavVisible){window.webdavVisible=false;$('#webdav-page').hidden=true;$('#browse-page').hidden=false;$('#webdav-nav').classList.remove('active');}
  closeDetail(false);
  restoreBrowseState(event.state?.cinemaBrowse);
  render();
  if (event.state?.cinemaDetail) showDetail(event.state.cinemaDetail);
  else if (event.state?.cinemaPerson && !event.state.cinemaBrowse) openPerson(event.state.cinemaPerson, event.state.cinemaOrigin, false);
  else {
    requestAnimationFrame(()=>window.scrollTo({top:browseScroll,behavior:'instant'}));
    if(view==='person' && person && personLoading)fetchPerson().catch(error=>{if(view==='person')$('#status').textContent=error.message;});
    if(view==='emby' && categoryStack.length && !categoryItems.length)fetchCategory();
    if(query && !searchItems.length)fetchSearch().catch(()=>{});
  }
  if (pointerBackPending) animatePageIn(detailItem ? $('#detail-page') : $('#browse-page'), { detail: 1 });
  pointerBackPending = false;
});
function renderSubfilters(){
 const section=categoryStack[0],show=view==='emby' && !query && categoryStack.length===1 && ['movies','tvshows'].includes(section?.type);$('#emby-subfilters').hidden=!show;if(!show)return;
 $('#subfilter-title').textContent=section.name+' · 继续细分';$('#subfilter-status-label').hidden=section.type!=='tvshows';for(const key of ['year','status','watched'])$('#subfilter-'+key).value=subfilters[key];
 document.querySelectorAll('[data-subgenre]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.subgenre===subfilters.genre)));
 const labels=[subgenres.find(x=>x.id===subfilters.genre)?.name,subfilters.year,subfilters.status==='Ended'?'已完结':subfilters.status?'连载中':'',subfilters.watched==='played'?'已看过':subfilters.watched?'未看过':''].filter(Boolean);$('#subfilter-summary').textContent=labels.length?labels.join(' · '):'在当前 Emby 分类内组合筛选';$('#subfilter-reset').disabled=!labels.length;
}
function drawSubgenres(){const popular=['科幻','悬疑','犯罪','剧情','喜剧','爱情','动作','动画'];let genres=subgenreExpanded?subgenres:subgenres.filter(x=>popular.includes(x.name));const holder=$('#subfilter-genres');holder.replaceChildren(...[{id:'',name:'全部类型'},...genres].map(genre=>{const button=document.createElement('button');button.type='button';button.dataset.subgenre=genre.id;button.textContent=genre.name;button.setAttribute('aria-pressed',String(subfilters.genre===genre.id));button.addEventListener('click',()=>{subfilters.genre=genre.id;applySubfilters();});return button;}));if(subgenres.length>genres.length){const more=document.createElement('button');more.type='button';more.className='subgenre-more';more.textContent='更多类型';more.addEventListener('click',()=>{subgenreExpanded=true;drawSubgenres();});holder.append(more);}}
async function loadSubgenres(choice){const epoch=++subfilterEpoch;drawSubgenres();if(!choice.id)return;$('#subfilter-message').textContent='正在读取可用类型…';try{const data=await getJson('/api/emby/subcategories?'+new URLSearchParams({parent:choice.id}));if(epoch!==subfilterEpoch)return;subgenres=data.genres;drawSubgenres();$('#subfilter-message').textContent='';renderSubfilters();}catch(error){if(epoch===subfilterEpoch)$('#subfilter-message').textContent='类型暂不可用：'+error.message;}}
function applySubfilters(){categoryItems=[];categoryTotal=0;categoryHasMore=false;visibleCount=80;fetchCategory();}
const yearSelect=$('#subfilter-year'),latestYear=new Date().getFullYear()+1;
for(let year=latestYear;year>=latestYear-10;year--){const option=document.createElement('option');option.value=String(year);option.textContent=year+' 年';yearSelect.append(option);}
for(let decade=Math.floor((latestYear-11)/10)*10;decade>=1900;decade-=10){const option=document.createElement('option');option.value=decade+'-'+(decade+9);option.textContent=decade+' 年代';yearSelect.append(option);}
for(const key of ['year','status','watched'])$('#subfilter-'+key).addEventListener('change',event=>{subfilters[key]=event.target.value;applySubfilters();});
$('#subfilter-reset').addEventListener('click',()=>{subfilters={genre:'',year:'',status:'',watched:''};applySubfilters();});
async function fetchCategory(start = 0) {
  const section = categoryStack.at(-1);
  const season = section?.type === 'Series' ? activeSeason?.id : null;
  const parent = season ? season.slice(5) : section?.id;
  if (!parent) return;
  const request = ++categoryRequest;
  categoryLoading = true; categoryError = ''; render();
  try {
  const params=new URLSearchParams({parent,start:String(start)});if(categoryStack.length===1)for(const [key,value]of Object.entries(subfilters))if(value)params.set(key,value);
  const response = await fetch('/api/emby/items?'+params);
  const data = await response.json();
  if (request !== categoryRequest || categoryStack.at(-1)?.id !== section.id || (section.type === 'Series' && activeSeason?.id !== season)) return;
  if (!response.ok) throw Error(data.error || '分类读取失败');
  categoryItems = start ? categoryItems.concat(data.items) : data.items;
  categoryTotal = data.total;
  categoryHasMore = data.hasMore;
  } catch (error) {
    if (request !== categoryRequest) return;
    categoryError = `分类读取失败：${error.message}`;
  } finally { if (request === categoryRequest) { categoryLoading = false; render(); } }
}
async function fetchSeriesSeasons(series) {
  const request = ++categoryRequest;
  categoryLoading = true; categoryError = ''; render();
  try {
    const response = await fetch(`/api/emby/seasons?series=${encodeURIComponent(series.id)}`);
    const data = await response.json();
    if (request !== categoryRequest || view !== 'emby' || categoryStack.at(-1)?.id !== series.id) return;
    if (!response.ok) throw Error(data.error || '分季读取失败');
    seriesSeasons = data.items.length ? data.items : [{ id: `emby-${series.id}`, title: '全部集数', unclassified: true, indexNumber: null }];
    activeSeason = seriesSeasons[0];
    await fetchCategory();
  } catch (error) {
    if (request !== categoryRequest || view !== 'emby' || categoryStack.at(-1)?.id !== series.id) return;
    categoryLoading = false; categoryError = `分季读取失败：${error.message}`; render();
  }
}
function selectSeason(season) {
  if (activeSeason?.id === season.id) return;
  activeSeason = season;
  categoryItems = []; categoryTotal = 0; categoryHasMore = false; visibleCount = 80;
  fetchCategory();
}
async function openStack(length) {
  categoryStack = categoryStack.slice(0, length); categoryItems = []; categoryTotal = 0; categoryHasMore = false; visibleCount = 80;
  const section = categoryStack.at(-1);
  seriesSeasons = []; activeSeason = null;
  if (section?.type === 'Series') await fetchSeriesSeasons(section);
  else await fetchCategory();
}
function selectCategory(choice) {
  subfilters={genre:'',year:'',status:'',watched:''};subgenres=[];subgenreExpanded=false;loadSubgenres(choice);
  if (!choice.id) { categoryRequest++; categoryLoading = false; categoryError = ''; categoryStack = []; categoryItems = []; categoryTotal = 0; categoryHasMore = false; seriesSeasons = []; activeSeason = null; visibleCount = 80; render(); return; }
  categoryStack = [choice]; openStack(1);
}
function openFolder(item) { categoryStack.push({ id: item.id.slice(5), name: item.title, type: item.type, item }); openStack(categoryStack.length); }
async function fetchSearch(start = 0) {
  if (!query || !library.emby?.connected) return;
  const request = ++searchRequest, term = query;
  const response = await fetch(`/api/emby/search?q=${encodeURIComponent(term)}&start=${start}`);
  const data = await response.json();
  if (request !== searchRequest || term !== query) return;
  if (!response.ok) throw Error(data.error || 'Emby 搜索失败');
  searchItems = start ? searchItems.concat(data.items) : data.items;
  searchTotal = data.total; searchHasMore = data.hasMore; render();
}
document.querySelectorAll('[data-view]').forEach(el => el.addEventListener('click', event => {
  const changed = !!detailItem || !!query || view !== el.dataset.view;
  if (detailItem) closeDetail(false);
  view = el.dataset.view; clearSearchState();
  personLoader.cancel();personLoading=false;
  history.replaceState({cinemaBrowse:{...captureBrowseState(),scroll:0}},'',window.location.href);
  render(); window.scrollTo({ top: 0, behavior: 'instant' });
  if (changed) animatePageIn($('#browse-page'), event);
}));
$('#category-retry').addEventListener('click', () => categoryStack.at(-1)?.type === 'Series' && !activeSeason ? fetchSeriesSeasons(categoryStack.at(-1)) : fetchCategory());
$('#hub-action').addEventListener('click', () => $('#emby-connect').click());
$('#more').addEventListener('click', async () => {
  if (query && searchHasMore && visibleCount >= searchItems.length) {
    try { await fetchSearch(searchItems.length); } catch (e) { $('#status').textContent = e.message; }
  } else if (view === 'emby' && categoryStack.length && categoryHasMore && visibleCount >= categoryItems.length) {
    try { await fetchCategory(categoryItems.length); } catch (e) { $('#status').textContent = e.message; }
  } else if (view === 'person' && personHasMore && visibleCount >= personItems.length) {
    const target=person;
    try { await fetchPerson(personNextStart); } catch (e) { if(view==='person' && person===target && !detailItem)$('#status').textContent = e.message; }
    if(view!=='person' || person!==target || detailItem)return;
  }
  visibleCount += 80; render();
});
let searchTimer;
function clearSearchState() {
  clearTimeout(searchTimer);
  query = ''; $('#search').value = ''; searchRequest++; searchItems = []; searchTotal = 0; searchHasMore = false; visibleCount = 80;
}
$('#search').addEventListener('input', e => {
  query = e.target.value.trim().toLocaleLowerCase(); searchRequest++; searchItems = []; searchTotal = 0; searchHasMore = false; visibleCount = 80; render();
  clearTimeout(searchTimer);
  if (query && library.emby?.connected) searchTimer = setTimeout(() => fetchSearch().catch(error => { $('#status').textContent = error.message; }), 300);
});
$('#refresh').addEventListener('click', async () => { $('#status').textContent = '正在刷新影库…'; try { await fetch('/api/refresh', { method: 'POST' }); await load(); } catch (e) { $('#status').textContent = e.message; } });
$('#emby-connect').addEventListener('click', () => {
  $('#emby-logout').hidden = !library.emby?.connected;
  $('#emby-url').value = library.emby?.url || $('#emby-url').value;
  $('#emby-remember').checked = library.emby?.connected ? !!library.emby.remembered : true;
  $('#emby-message').textContent = library.emby?.connected ? `已连接 ${library.emby.user}；${library.emby.remembered ? '重启后自动恢复' : '仅本次会话'}。如需更换服务器，请重新登录。` : library.emby?.error || '';
  $('#emby-dialog').showModal();
});
$('#emby-cancel').addEventListener('click', () => $('#emby-dialog').close());
$('#emby-dialog').addEventListener('close', () => { $('#emby-password').value = ''; $('#emby-connect').focus(); });
$('#emby-form').addEventListener('submit', async e => {
  e.preventDefault();
  const url = $('#emby-url').value.trim(), username = $('#emby-user').value.trim(), password = $('#emby-password').value, remember = $('#emby-remember').checked;
  $('#emby-submit').disabled = true;
  $('#emby-message').textContent = '正在连接 Emby…';
  try {
    const response = await fetch('/api/emby/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, username, password, remember }) });
    const data = await response.json();
    if (!response.ok) throw Error(data.error || '登录失败');
    $('#emby-password').value = '';
    $('#emby-dialog').close();
    resetSubfilterContext();await load();
  } catch (error) { $('#emby-message').textContent = error.message; }
  finally { $('#emby-submit').disabled = false; }
});
$('#emby-logout').addEventListener('click', async () => {
  const button = $('#emby-logout'); button.disabled = true;
  $('#emby-message').textContent = '正在断开连接…';
  try {
    const response = await fetch('/api/emby/logout', { method: 'POST' });
    const data = await response.json();
    if (!response.ok) throw Error(data.error || '断开连接失败');
    categoryRequest++; categoryStack = []; categoryItems = []; categoryLoading = false; categoryError = '';
    $('#emby-dialog').close(); await load();
  } catch (error) { $('#emby-message').textContent = error.message; }
  finally { button.disabled = false; }
});
document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault();if(window.webdavVisible){$('#dav-search').focus();return;} if (detailItem) closeDetail(); $('#search').focus(); } if (e.key === 'Escape' && detailItem) { if (history.state?.cinemaDetail) history.back(); else closeDetail(); } else if (e.key === 'Escape' && document.activeElement === $('#search')) { $('#search').value = ''; query = ''; render(); $('#search').blur(); } });
load();
async function refreshPlaybackProgress() {
  if(document.hidden) return;
  if(detailItem) loadDetailProgress(detailItem);
  try {
    const data=await getJson('/api/resume'),next=data.items || [];
    const changed=JSON.stringify(next) !== JSON.stringify(resumeItems);
    resumeItems=next;
    if(changed && !detailItem && !query && ['home','resume'].includes(view)) render();
  } catch {}
}
window.addEventListener('focus',refreshPlaybackProgress);
document.addEventListener('visibilitychange',()=>{if(!document.hidden) refreshPlaybackProgress()});
setInterval(refreshPlaybackProgress,15000);
