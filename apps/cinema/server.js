// Local-only movie library. Playback always goes through the user's existing mpv.
const http = require('node:http');
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const {spawn}=require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const { normalizeEmbyUrl, createSessionStore,protectSecret,unprotectSecret } = require('./session-store');
const { createSubtitleService } = require('./subtitles');
const { createProgressStore, readWatchLater, isCompleted } = require('./progress-store');
const { launchTrackedPlayer } = require('./tracked-player');
const { createEpisodeNavigator, chooseNextSource } = require('./episode-next');
const { createPlaybackQueue } = require('./playback-queue');
const { normalizeCredits,createCreditsService } = require('./credits');
const {createCastEnricher}=require('./cast-enrichment');
const {seriesStatus}=require('./series-status');
const {createWebDav}=require('./webdav');
const webdav=createWebDav({directory:process.env.MPV_WEBDAV_DIRECTORY || path.join(process.env.APPDATA || __dirname,'mpv-cinema','webdav')});
const {createDavPosterService}=require('./webdav-poster-service');
const {readPosterImage}=require('./poster-image');
const {pipeProxyBody}=require('./proxy-body');
const {ratingsFromEmby,ratingLinks}=require('./ratings');
const {createRatingsService}=require('./ratings-service');
const subtitles = createSubtitleService();

const ROOT = process.env.MPV_LIBRARY_ROOT || path.join(require('node:os').homedir(),'Movies');
const MPV = process.env.MPV_EXE || path.resolve(__dirname,'../../runtime/windows/mpv.exe');
const HISTORY = process.env.MPV_HISTORY || path.join(require('node:os').homedir(),'.cinema-infuse','history.jsonl');
const PORT = Number(process.env.MPV_LIBRARY_PORT || 7788);
const VIDEO = new Set(['.mkv', '.mp4', '.m4v', '.mov', '.avi', '.ts', '.m2ts', '.webm']);
const ART = ['jpg', 'jpeg', 'png', 'webp'];
const DEFAULT_EMBY = normalizeEmbyUrl(process.env.MPV_EMBY_URL || 'https://example.invalid');
const SESSION_FILE = process.env.MPV_EMBY_SESSION_FILE || path.join(process.env.APPDATA || __dirname, 'mpv-cinema', 'emby-session.json');
const sessionStore = createSessionStore(SESSION_FILE);
let embyUrl = DEFAULT_EMBY;
let remembered = false;
let sessionError = null;
const USER_DATA = process.env.MPV_LIBRARY_USER_DATA || path.join(require('node:os').homedir(),'.cinema-infuse','user-data.json');
const ratingsService=createRatingsService({file:process.env.MPV_RATINGS_FILE || path.join(path.dirname(USER_DATA),'ratings-settings.json'),protect:protectSecret,unprotect:unprotectSecret});
const WATCH_LATER=process.env.MPV_WATCH_LATER_DIR || path.join(path.dirname(MPV),'portable_config','cache','watch_later');
const progressDirectory=process.env.MPV_PROGRESS_DIR || path.join(path.dirname(USER_DATA),'playback-progress');
const progressStore = createProgressStore({directory:progressDirectory,onUpdate:reportProgress});
const progressReports = new Map();
let items = [];
let byId = new Map();
let scanError = null;
let scanPromise = null;
let embySession = null;
let embyMatched = 0;
let embyError = null;
let embyCatalog = [];
let embyById = new Map();
let embyViews = [];
const activeStreams = new Map();
const episodePages = new Map();
const knownPeople = new Map();
let creditAccountVersion=0;
const {parseSubfilters,createSubcategoryService}=require('./emby-subcategories');
const subcategories=createSubcategoryService({account:()=>JSON.stringify([embyUrl,embySession?.userId,creditAccountVersion]),request:async q=>(await(await embyRequest(`/Users/${encodeURIComponent(embySession.userId)}/Items?${q}`)).json())});
const creditsService=createCreditsService({request:embyRequest,account:()=>JSON.stringify([embyUrl,embySession?.userId,creditAccountVersion])});
const davPosters=createDavPosterService({webdav,account:()=>embySession?JSON.stringify([embyUrl,embySession.userId,creditAccountVersion]):'',search:async title=>{
 const q=new URLSearchParams({SearchTerm:title,Recursive:'true',IncludeItemTypes:'Movie,Series',Limit:'20',Fields:'OriginalTitle',EnableImages:'true'});
 return (await(await embyRequest(`/Users/${encodeURIComponent(embySession.userId)}/Items?${q}`)).json()).Items || [];
},artwork:async id=>{
 const response=await embyRequest(`/Items/${encodeURIComponent(id)}/Images/Primary?MaxWidth=420&Quality=85`,{headers:{Accept:'image/*'}});
 return readPosterImage(response);
}});
const castEnricher=createCastEnricher({account:()=>JSON.stringify([embyUrl,embySession?.userId,creditAccountVersion]),person:async id=>{
 const response=await embyRequest(`/Users/${encodeURIComponent(embySession.userId)}/Items/${encodeURIComponent(id)}`);return response.json();
}});
const navigator = createEpisodeNavigator({loadEpisodes,isWatched:async item=>(await itemProgress(item)).completed});
const playbackQueue = createPlaybackQueue({directory:progressDirectory,store:progressStore,resolveNext:item=>navigator.next(item),prepare:prepareEpisode});
let userDataPromise;
let userDataWrite = Promise.resolve();

async function userData() {
  if (!userDataPromise) userDataPromise = fsp.readFile(USER_DATA, 'utf8').then(JSON.parse).catch(error => {
    if (error.code === 'ENOENT') return { localFavorites: [], following: {} };
    throw error;
  });
  return userDataPromise;
}

async function saveUserData(data) {
  const snapshot = JSON.stringify(data, null, 2);
  userDataWrite = userDataWrite.catch(() => {}).then(async () => {
    await fsp.mkdir(path.dirname(USER_DATA), { recursive: true });
    const temp = `${USER_DATA}.${process.pid}.tmp`;
    await fsp.writeFile(temp, snapshot, 'utf8');
    await fsp.rename(temp, USER_DATA);
  });
  await userDataWrite;
}

function catalogItem(item) {
  return {
    id: `emby-${item.Id}`, embyId: String(item.Id), title: item.Name || '未命名影片',
    year: item.ProductionYear ? String(item.ProductionYear) : '',
    poster: !!(item.ImageTags?.Primary || item.PrimaryImageTag),
    backdrop: !!item.BackdropImageTags?.length,
    overview: item.Overview || '', genres: item.Genres || [], rating: item.CommunityRating || null,
    originalTitle: item.OriginalTitle || '',
    ratings:ratingsFromEmby(item),ratingLinks:ratingLinks(item),ratingData:{Name:item.Name,Type:item.Type,OriginalTitle:item.OriginalTitle,ProductionYear:item.ProductionYear,ProviderIds:item.ProviderIds,CommunityRating:item.CommunityRating,CriticRating:item.CriticRating,Ratings:item.Ratings},
    mediaSourceId: String(item.MediaSources?.[0]?.Id || item.Id),
    path: item.Path || '', type: item.Type || '', folder: !!item.IsFolder,
    seriesName: item.SeriesName || '', seriesId: item.SeriesId ? String(item.SeriesId) : '',
    seasonId: item.SeasonId ? String(item.SeasonId) : '',
    indexNumber: item.IndexNumber == null ? null : Number(item.IndexNumber),
    indexNumberEnd: item.IndexNumberEnd == null ? null : Number(item.IndexNumberEnd),
    parentIndexNumber: item.ParentIndexNumber == null ? null : Number(item.ParentIndexNumber),
    missing:!!(item.IsMissing || item.IsVirtualItem || item.IsPlaceHolder || item.LocationType === 'Virtual'),
    favorite: !!item.UserData?.IsFavorite,
    positionSeconds: Number(item.UserData?.PlaybackPositionTicks || 0) / 1e7,
    durationSeconds: Number(item.RunTimeTicks || 0) / 1e7,
    lastPlayedAt: item.UserData?.LastPlayedDate || '', completed:!!item.UserData?.Played,
    progress: Number(item.UserData?.PlayedPercentage || 0)
  };
}

function publicEmbyItem({id,title,year,poster,backdrop,overview,genres,rating,ratings,ratingLinks,type,folder,seriesName,seriesId,seasonId,indexNumber,indexNumberEnd,parentIndexNumber,favorite,progress,positionSeconds,durationSeconds,lastPlayedAt,completed}) {
  const watched=isCompleted({positionSeconds,durationSeconds,completed});
  return { id,title,year,poster,backdrop,overview,genres,rating,ratings,ratingLinks,type,folder,seriesName,seriesId,seasonId,indexNumber,indexNumberEnd,parentIndexNumber,favorite,progress:watched ? 100 : progress,resumeSeconds:watched ? 0 : positionSeconds || 0,durationSeconds:durationSeconds || 0,watchedAt:lastPlayedAt || '',completed:watched,source:'emby' };
}

function progressContext(item, local = false) {
  return local ? {kind:'local',itemId:item.id,item:{id:item.id,title:item.title,year:item.year,type:item.embyType || '',poster:!!(item.poster || item.embyPoster),backdrop:!!(item.backdrop || item.embyBackdrop)}}
    : {kind:'emby',server:embyUrl,userId:embySession.userId,itemId:item.embyId,item:publicEmbyItem(item)};
}
async function itemProgress(item, sourceId = '', local = false) {
  const context=progressContext(item,local);
  const saved=await progressStore.get(context,sourceId,local ? null : item);
  const legacy=await progressStore.allowLegacy(context) ? await readWatchLater(WATCH_LATER,local ? {path:item.path} : {itemId:item.embyId,port:PORT}) : null;
  if(legacy && (!saved.watchedAt || legacy.watchedAt>saved.watchedAt) && (!item.durationSeconds || legacy.resumeSeconds<item.durationSeconds)) {
    const durationSeconds=item.durationSeconds || saved.durationSeconds;
    const completed=isCompleted({positionSeconds:legacy.resumeSeconds,durationSeconds});
    return {...saved,resumeSeconds:completed ? 0 : legacy.resumeSeconds,durationSeconds,progress:completed ? 100 : durationSeconds ? Math.min(100,legacy.resumeSeconds/durationSeconds*100) : saved.progress,watchedAt:legacy.watchedAt,completed,legacy:true};
  }
  return saved;
}
async function reportProgress(context, record, event) {
  if(context.kind !== 'emby' || !embySession || context.server !== embyUrl || context.userId !== embySession.userId) return;
  if(event === 'start' && context.queueId) playbackQueue.ensureNext(context).catch(error=>console.error(error.message));
  let report=progressReports.get(context.playSessionId);
  if(!report) { report={queue:Promise.resolve(),started:false,lastTime:0}; progressReports.set(context.playSessionId,report); }
  if(event === 'progress' && Date.now()-report.lastTime<10000) return;
  report.lastTime=Date.now();
  const account={...embySession}, server=embyUrl;
  const headers={'Content-Type':'application/json','X-Emby-Token':account.token,'X-Emby-Authorization':'Emby Client="mpv Cinema", Device="Windows", DeviceId="mpv-cinema-local", Version="1.0.0"'};
  const sameSession=()=>embySession && embyUrl === server && embySession.userId === account.userId && embySession.token === account.token;
  const body={ItemId:context.itemId,MediaSourceId:context.sourceId,PlaySessionId:context.playSessionId,PositionTicks:Math.round(record.positionSeconds*1e7),IsPaused:record.paused,CanSeek:true,PlayMethod:'DirectStream',QueueableMediaTypes:['Video'],EventName:event === 'pause' ? 'Pause' : event === 'unpause' ? 'Unpause' : 'TimeUpdate'};
  const send=async endpoint=>{
    if(!sameSession()) return;
    const response=await fetch(`${server}/emby/Sessions/Playing${endpoint}`,{method:'POST',headers,body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(5000)});
    if(!response.ok) throw Error(`Emby progress HTTP ${response.status}`);
    await response.body?.cancel();
  };
  report.queue=report.queue.catch(()=>{}).then(async()=>{
    if(!report.started) { await send(''); report.started=true; }
    if(event === 'stopped') {
      await send('/Stopped');
      if(record.completed && sameSession()) {
        const userPath=`/Users/${encodeURIComponent(account.userId)}`;
        let alreadyWatched=false;
        try {
          const check=await fetch(`${server}/emby${userPath}/Items/${encodeURIComponent(context.itemId)}`,{headers,redirect:'error',signal:AbortSignal.timeout(5000)});
          if(check.ok) alreadyWatched=!!(await check.json()).UserData?.Played; else await check.body?.cancel();
        } catch { /* The canonical watched action still works when the detail check fails. */ }
        if(!alreadyWatched && sameSession()) {
          const marked=await fetch(`${server}/emby${userPath}/PlayedItems/${encodeURIComponent(context.itemId)}`,{method:'POST',headers,redirect:'error',signal:AbortSignal.timeout(5000)});
          if(!marked.ok) throw Error(`Emby watched HTTP ${marked.status}`);
          await marked.body?.cancel();
        }
      }
    }
    else if(event !== 'start') await send('/Progress');
  }).catch(error=>console.error(error.message)).finally(()=>{if(event === 'stopped'){progressReports.delete(context.playSessionId);if(sameSession())subcategories.invalidate();}});
}
async function launchTracked(media, context, {sourceId='',startSeconds=0}={}) {
  return launchTrackedPlayer({executable:MPV,media,context,store:progressStore,sourceId,startSeconds});
}
function assertAccount(context) {
  if(!embySession || context.server !== embyUrl || context.userId !== embySession.userId) throw Error('播放账户已变更，请重新选择影片');
}
async function loadEpisodes(seriesId) {
  const context={server:embyUrl,userId:embySession?.userId}; assertAccount(context);
  const key=JSON.stringify([context.server,context.userId,seriesId]);
  if(episodePages.get(key)?.expires>Date.now()) return episodePages.get(key).promise;
  const promise=(async()=>{
    const episodes=[],seen=new Set();
    for(let start=0;start<100000;start+=200) {
      const q=new URLSearchParams({UserId:context.userId,StartIndex:String(start),Limit:'200',EnableImages:'true',EnableUserData:'true',Fields:'Overview,MediaSources',SortBy:'ParentIndexNumber,IndexNumber',SortOrder:'Ascending',IsMissing:'false',IsVirtualItem:'false'});
      const response=await embyRequest(`/Shows/${encodeURIComponent(seriesId)}/Episodes?${q}`),data=await response.json(); assertAccount(context);
      const page=(data.Items || []).filter(raw=>raw.Id);
      if(page.length && page.every(raw=>seen.has(String(raw.Id)))) throw Error('Emby 剧集分页没有前进');
      for(const raw of page) if(!seen.has(String(raw.Id))) {
        seen.add(String(raw.Id));const item=catalogItem(raw);
        if(item.seriesId===seriesId) {embyById.set(item.embyId,item);episodes.push(item);}
      }
      if(page.length<200 || (data.TotalRecordCount>0 && start+page.length>=data.TotalRecordCount)) break;
    }
    return episodes;
  })().catch(error=>{episodePages.delete(key);throw error;});
  episodePages.set(key,{expires:Date.now()+60000,promise});
  if(episodePages.size>100) episodePages.delete(episodePages.keys().next().value);
  return promise;
}
function createStream(item,source,playback) {
  const now=Date.now();
  for(const [key,entry] of activeStreams) if(entry.expiresAt<now) activeStreams.delete(key);
  const key=randomUUID();
  activeStreams.set(key,{itemId:item.embyId,userId:embySession.userId,server:embyUrl,source,sessionId:playback.sessionId,expiresAt:now+24*3600*1000});
  return `http://127.0.0.1:${PORT}/stream/emby-${encodeURIComponent(item.embyId)}?play=${key}`;
}
function episodeTitle(item) {
  return [item.seriesName,item.type==='Episode' ? `S${String(item.parentIndexNumber || 1).padStart(2,'0')}E${String(item.indexNumber || 1).padStart(2,'0')}` : '',item.title].filter(Boolean).join(' · ');
}
async function prepareEpisode(item,previous,context) {
  assertAccount(context);
  const playback=await playbackInfo(item);assertAccount(context);
  const source=chooseNextSource(playback.sources,previous);
  if(!source) throw Error('下一集暂无原画直传片源');
  const saved=await itemProgress(item,source.id);assertAccount(context);
  return {item,source,sourceId:source.id,startSeconds:saved.resumeSeconds,title:episodeTitle(item),media:createStream(item,source,playback),context:{...progressContext(item),playSessionId:playback.sessionId}};
}
setInterval(()=>progressStore.poll().catch(error=>console.error(`Progress save: ${error.message}`)),1000).unref();

function sourceSummary(source, index) {
  const video = (source.MediaStreams || []).find(stream => stream.Type === 'Video') || {};
  const audio = (source.MediaStreams || []).find(stream => stream.Type === 'Audio') || {};
  const evidence = [video.VideoRangeType, video.VideoRange, video.VideoDoViTitle, source.Name, video.DisplayTitle].filter(Boolean).join(' ').toLowerCase();
  const range = /dolby.?vision|\bdovi\b|\bdv\b/.test(evidence) ? 'Dolby Vision'
    : /hdr10\+|hdr10plus/.test(evidence) ? 'HDR10+'
    : /hdr10|smpte2084|\bpq\b/.test(evidence) ? 'HDR10'
    : /\bhlg\b/.test(evidence) ? 'HLG'
    : /\bhdr\b/.test(evidence) ? 'HDR' : 'SDR';
  const width = Number(video.Width || source.Width || 0);
  const resolutionLabel = [source.Name, video.DisplayTitle].filter(Boolean).join(' ');
  const explicitHeight = /\b(?:8k|4320p)\b/i.test(resolutionLabel) ? 4320
    : /\b(?:4k|2160p|uhd)\b/i.test(resolutionLabel) ? 2160
    : /\b(?:1440p|2k)\b/i.test(resolutionLabel) ? 1440
    : /\b(?:1080p|fhd)\b/i.test(resolutionLabel) ? 1080
    : /\b720p\b/i.test(resolutionLabel) ? 720 : 0;
  const inferredHeight = width >= 3800 ? 2160 : width >= 2500 ? 1440
    : width >= 1900 ? 1080 : width >= 1200 ? 720 : 0;
  return {
    id: String(source.Id || ''), name: String(source.Name || `版本 ${index + 1}`),
    releaseName: source.Path && !/^[a-z]+:\/\//i.test(source.Path) ? String(source.Path).split(/[\\/]/).pop() : '',
    width, height: explicitHeight || Math.max(Number(video.Height || source.Height || 0), inferredHeight), range,
    bitrate: Number(source.Bitrate || 0), size: Number(source.Size || 0),
    videoCodec: String(video.Codec || '').toUpperCase(), audioCodec: String(audio.Codec || '').toUpperCase(),
    audioChannels: Number(audio.Channels || 0), container: String(source.Container || ''),
    direct: source.SupportsDirectStream !== false
  };
}

function sourceScore(source) {
  const rangeScore = { 'HDR10+': 5, HDR10: 4, 'Dolby Vision': 3, HDR: 2, HLG: 1, SDR: 0 }[source.range] || 0;
  return (source.direct ? 1e12 : 0) + Math.min(source.height, 4320) * 1e7 + rangeScore * 1e6
    + Math.min(source.bitrate, 200e6) / 1000;
}

async function playbackInfo(item) {
  if (item.playback?.userId === embySession?.userId) return item.playback;
  const q = new URLSearchParams({ UserId: embySession.userId });
  const response = await embyRequest(`/Items/${encodeURIComponent(item.embyId)}/PlaybackInfo?${q}`);
  const info = await response.json();
  const sources = (info.MediaSources || []).map(sourceSummary).filter(source => source.id);
  sources.sort((a, b) => sourceScore(b) - sourceScore(a));
  if (!sources.length) throw Error('Emby 未提供可播放片源');
  item.playback = {
    userId: embySession.userId,
    sessionId: String(info.PlaySessionId || randomUUID().replace(/-/g, '')),
    sources,
    recommendedSourceId: sources.find(source => source.direct)?.id || ''
  };
  return item.playback;
}

async function embyRequest(apiPath, options = {}) {
  const headers = { Accept: 'application/json', ...options.headers };
  if (embySession) headers['X-Emby-Token'] = embySession.token;
  const response = await fetch(`${embyUrl}/emby${apiPath}`, { ...options, headers, redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw Error(`Emby HTTP ${response.status}`);
  return response;
}

function clearEmbyCatalog() {
  subcategories.invalidate();
  knownPeople.clear();
  creditAccountVersion++;
  embyMatched = 0; embyError = null; embyCatalog = []; embyById.clear(); embyViews = [];
  activeStreams.clear();
  for (const item of items) for (const key of ['embyId','embyPoster','embyBackdrop','embyOverview','embyGenres','embyRating','embyRatings','embyRatingLinks']) delete item[key];
}

async function restoreEmbySession() {
  try {
    embyUrl = await sessionStore.loadUrl() || DEFAULT_EMBY;
    const saved = await sessionStore.load();
    if (!saved) return;
    embyUrl = saved.url;
    // Do not advertise a restored connection until the protected token works.
    const check = await fetch(`${saved.url}/emby/Users/${encodeURIComponent(saved.userId)}/Views`, {
      headers: { 'X-Emby-Token': saved.token }, redirect: 'error', signal: AbortSignal.timeout(8000)
    });
    if (!check.ok) throw Error(check.status === 401 || check.status === 403 ? '登录已失效，请重新连接' : `服务器返回 HTTP ${check.status}`);
    embySession = { token: saved.token, userId: saved.userId, name: saved.name };
    remembered = true;
  } catch (error) {
    embySession = null;
    sessionError = `已保存的连接暂不可用：${error.message}`;
  }
}

function normalized(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase().replace(/[\p{P}\p{S}\s]/gu, '');
}

function matchScore(local, remote) {
  const remoteFile = String(remote.Path || '').split(/[\\/]/).pop();
  if (remoteFile && remoteFile.toLocaleLowerCase() === path.basename(local.path).toLocaleLowerCase()) return 100;
  if (normalized(local.title) !== normalized(remote.Name)) return 0;
  if (local.year && remote.ProductionYear && Number(local.year) !== Number(remote.ProductionYear)) return 0;
  return local.year && remote.ProductionYear ? 80 : 55;
}

async function enrichFromEmby() {
  if (!embySession) return;
  try {
    const viewsResponse = await embyRequest(`/Users/${encodeURIComponent(embySession.userId)}/Views`);
    const viewsData = await viewsResponse.json();
    embyViews = (viewsData.Items || []).filter(view => view.Id).map(view => ({ id: String(view.Id), name: view.Name || '未命名分类', type: view.CollectionType || '' }));
    // The root query is only a small preview. Emby views are paged on demand;
    // scanning tens of thousands of episodes into memory crashes the local server.
    const q = new URLSearchParams({ Recursive: 'true', IncludeItemTypes: 'Movie,Episode,Video', Fields: 'Path,Overview,Genres,MediaSources,ProviderIds,OriginalTitle', EnableImages: 'true', StartIndex: '0', Limit: '100' });
    const response = await embyRequest(`/Users/${encodeURIComponent(embySession.userId)}/Items?${q}`);
    const data = await response.json();
    const remote = data.Items || [];
    embyCatalog = remote.filter(item => item.Id && !item.IsFolder).map(catalogItem);
    embyById = new Map(embyCatalog.map(item => [item.embyId, item]));
    embyMatched = 0;
    for (const local of items) {
      let best = null, score = 0;
      for (const candidate of remote) {
        const value = matchScore(local, candidate);
        if (value > score) { score = value; best = candidate; }
      }
      if (best && score >= 55) {
        local.embyId = String(best.Id);
        local.embyType = best.Type || '';
        local.embySeriesName = best.SeriesName || '';
        local.embyPoster = !!(best.ImageTags?.Primary || best.PrimaryImageTag);
        local.embyBackdrop = !!best.BackdropImageTags?.length;
        local.embyOverview = best.Overview || '';
        local.embyGenres = best.Genres || [];
        local.embyRating = best.CommunityRating || null;local.embyRatings=ratingsFromEmby(best);local.embyRatingLinks=ratingLinks(best);
        if (best.Name) local.title = best.Name;
        if (best.ProductionYear) local.year = String(best.ProductionYear);
        embyMatched++;
      }
    }
    embyError = null;
  } catch (e) { embyError = e.message; }
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 8192) throw Error('Request too large');
  }
  return JSON.parse(raw || '{}');
}

function titleFromFile(filename) {
  const stem = path.parse(filename).name;
  const year = stem.match(/(?:^|[.\s_-])((?:19|20)\d{2})(?:[.\s_-]|$)/);
  let title = year ? stem.slice(0, year.index) : stem;
  title = title.replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim();
  return { title: title || stem, year: year ? year[1] : '' };
}

function artFor(filename, names, kind, allowGeneric) {
  const stem = path.parse(filename).name.toLowerCase();
  const candidates = [];
  for (const ext of ART) {
    candidates.push(`${stem}-${kind}.${ext}`, `${stem}.${kind}.${ext}`);
  }
  if (allowGeneric && kind === 'poster') for (const ext of ART) candidates.push(`folder.${ext}`, `poster.${ext}`);
  if (allowGeneric && kind === 'backdrop') for (const ext of ART) candidates.push(`backdrop.${ext}`, `fanart.${ext}`);
  for (const candidate of candidates) if (names.has(candidate)) return names.get(candidate);
  return null;
}

async function scan() {
  const found = [];
  const dirs = [{ dir: ROOT, depth: 0 }];
  let visited = 0;
  while (dirs.length && visited < 1500 && found.length < 5000) {
    const { dir, depth } = dirs.shift();
    visited++;
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); }
    catch (e) { if (depth === 0) throw e; else continue; }
    const names = new Map(entries.filter(e => e.isFile()).map(e => [e.name.toLowerCase(), e.name]));
    const videoCount = entries.filter(e => e.isFile() && VIDEO.has(path.extname(e.name).toLowerCase())).length;
    for (const entry of entries) {
      if (entry.isDirectory() && depth < 3 && !/^(#?recycle|\$recycle\.bin|bdmv|certificate|playlist|stream)$/i.test(entry.name)) {
        dirs.push({ dir: path.join(dir, entry.name), depth: depth + 1 });
      } else if (entry.isFile() && VIDEO.has(path.extname(entry.name).toLowerCase())) {
        const full = path.join(dir, entry.name);
        const id = createHash('sha256').update(full.toLowerCase()).digest('hex').slice(0, 20);
        found.push({ id, path: full, ...titleFromFile(entry.name), poster: artFor(entry.name, names, 'poster', videoCount === 1), backdrop: artFor(entry.name, names, 'backdrop', videoCount === 1), dir });
      }
    }
  }
  found.sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'));
  items = found;
  byId = new Map(found.map(item => [item.id, item]));
  scanError = null;
  return found.length;
}

function refresh() {
  if (!scanPromise) scanPromise = scan().then(async count => { await enrichFromEmby(); return count; }).catch(e => { scanError = e.message; return 0; }).finally(() => { scanPromise = null; });
  return scanPromise;
}

async function watchEvents() {
  try {
    const stat = await fsp.stat(HISTORY);
    const fd = await fsp.open(HISTORY, 'r');
    const bytes = Math.min(stat.size, 2 * 1024 * 1024);
    const buffer = Buffer.alloc(bytes);
    await fd.read(buffer, 0, bytes, stat.size - bytes);
    await fd.close();
    const known = new Map(items.map(item => [item.path.toLowerCase(), item.id]));
    const events = [];
    for (const line of buffer.toString('utf8').split(/\r?\n/).reverse()) {
      try {
        const entry = JSON.parse(line);
        const playedAt = Number(entry.time) * 1000;
        if (!Number.isFinite(playedAt) || playedAt <= 0) continue;
        const playedPath = String(entry.path || '');
        let id = known.get(playedPath.toLowerCase());
        if (!id && embySession) {
          const stream = playedPath.match(/^https?:\/\/(?:127\.0\.0\.1|localhost):(\d+)\/stream\/emby-([^/?#]+)/i);
          if (stream && Number(stream[1]) === PORT) id = `emby-${decodeURIComponent(stream[2])}`;
        }
        if (id) events.push({ id, playedAt });
      } catch { /* a partial first line is expected */ }
    }
    events.sort((a, b) => b.playedAt - a.playedAt);
    const seen = new Set();
    return events.filter(event => {
      if (seen.has(event.id)) return false;
      seen.add(event.id); return true;
    }).slice(0, 40);
  } catch { return []; }
}

async function recentIds() {
  return (await watchEvents()).filter(event => byId.has(event.id)).slice(0, 20).map(event => event.id);
}

async function recentItems() {
  const events = await watchEvents();
  if (embySession) {
    const userPath = `/Users/${encodeURIComponent(embySession.userId)}/Items`;
    const missing = [...new Set(events.filter(event => event.id.startsWith('emby-') && !embyById.has(event.id.slice(5))).map(event => event.id.slice(5)))];
    if (missing.length) {
      try {
        const q = new URLSearchParams({ Ids: missing.join(','), Limit: String(missing.length), EnableImages: 'true', EnableUserData: 'true' });
        const response = await embyRequest(`${userPath}?${q}`);
        const data = await response.json();
        for (const raw of data.Items || []) if (raw.Id) {
          const item = catalogItem(raw); embyById.set(item.embyId, item);
        }
      } catch { /* Keep other recent items when an old Emby item is unavailable. */ }
      // Some Emby servers omit episodes from the bulk Ids query, while the
      // single-item endpoint still returns them. Resolve recent mpv streams.
      await Promise.all(missing.filter(id => !embyById.has(id)).slice(0, 20).map(async id => {
        try {
          const response = await embyRequest(`${userPath}/${encodeURIComponent(id)}`);
          const raw = await response.json();
          if (String(raw.Id) === id) embyById.set(id, catalogItem(raw));
        } catch { /* The item may have been removed from Emby. */ }
      }));
    }
    try {
      const q = new URLSearchParams({ Recursive: 'true', IncludeItemTypes: 'Movie,Episode,Video', SortBy: 'DatePlayed', SortOrder: 'Descending', Limit: '40', EnableImages: 'true', EnableUserData: 'true' });
      const response = await embyRequest(`${userPath}?${q}`);
      const data = await response.json();
      for (const raw of data.Items || []) {
        const playedAt = Date.parse(raw.UserData?.LastPlayedDate || '');
        if (!raw.Id || !Number.isFinite(playedAt) || playedAt <= 0) continue;
        const item = catalogItem(raw); embyById.set(item.embyId, item);
        events.push({ id: item.id, playedAt });
      }
    } catch { /* mpv history still shows recent playback while Emby is unavailable. */ }
  }
  events.sort((a, b) => b.playedAt - a.playedAt);
  const seen = new Set(), result = [];
  for (const event of events) {
    const local = byId.get(event.id);
    const remote = event.id.startsWith('emby-') ? embyById.get(event.id.slice(5)) : null;
    if (!local && !remote) continue;
    const identity = local?.embyId ? `emby-${local.embyId}` : event.id;
    if (seen.has(identity)) continue;
    seen.add(identity);
    const watchedAt = new Date(event.playedAt).toISOString();
    result.push(remote ? { ...publicEmbyItem(remote), ...await itemProgress(remote), watchedAt } : { id: local.id, ...await itemProgress(local,'',true), watchedAt });
    if (result.length >= 30) break;
  }
  return result;
}

function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(value));
}

async function main(req, res) {
  if (req.headers.host !== `127.0.0.1:${PORT}` && req.headers.host !== `localhost:${PORT}`) {
    return json(res, 403, { error: 'Local access only' });
  }
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (req.headers['sec-fetch-site'] === 'cross-site') {
    return json(res, 403, { error: 'Local access only' });
  }
  if (req.method === 'POST' && req.headers.origin && req.headers.origin !== `http://127.0.0.1:${PORT}`) {
    return json(res, 403, { error: 'Only the local library can start playback' });
  }
  if(url.pathname==='/api/ratings/settings' && req.method==='GET')return json(res,200,await ratingsService.status());
  if(url.pathname==='/api/ratings/test' && req.method==='POST')return json(res,200,await ratingsService.validate());
  if(url.pathname==='/api/ratings/settings' && req.method==='POST'){
    try{return json(res,200,await ratingsService.configure(await readJson(req)));}catch(error){return json(res,400,{error:error.message});}
  }
  const ratingsItem=url.pathname.match(/^\/api\/emby\/ratings\/([^/]+)$/);
  if(req.method==='GET' && ratingsItem){
    if(!embySession)return json(res,401,{error:'请先登录 Emby'});
    const item=embyById.get(ratingsItem[1]);if(!item)return json(res,404,{error:'影片不在当前影库'});
    const account=embySession,server=embyUrl,result=await ratingsService.get(item.ratingData || {});
    if(account!==embySession || server!==embyUrl)return json(res,409,{error:'登录状态已变更，请重新打开详情'});
    item.ratings=result.ratings;return json(res,200,result);
  }
  if(req.method==='GET' && url.pathname==='/api/webdav/poster'){
    try{const image=await davPosters.get(url.searchParams.get('id'),url.searchParams.get('path'));if(!image)return json(res,404,{error:'暂无匹配封面'});res.writeHead(200,{'Content-Type':image.type,'Content-Length':image.bytes.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(image.bytes);}catch{return json(res,404,{error:'暂无匹配封面'});}
  }
  if(req.method==='GET' && url.pathname==='/api/webdav/connections')return json(res,200,{connections:await webdav.list()});
  if(req.method==='POST' && url.pathname==='/api/webdav/connect'){
    try{return json(res,200,await webdav.connect(await readJson(req)));}catch(error){return json(res,400,{error:error.message});}
  }
  if(req.method==='POST' && url.pathname==='/api/webdav/disconnect'){
    const input=await readJson(req);await webdav.disconnect(input.id);return json(res,200,{ok:true});
  }
  if(req.method==='GET' && url.pathname==='/api/webdav/browse'){
    try{return json(res,200,await webdav.browse(url.searchParams.get('id'),url.searchParams.get('path'),{refresh:url.searchParams.get('refresh')==='1'}));}catch(error){return json(res,400,{error:error.message});}
  }
  if(req.method==='POST' && url.pathname==='/api/webdav/play'){
    try{const input=await readJson(req),prepared=await webdav.prepare(input.id,input.path),saved=await progressStore.get(prepared.context);
      const startSeconds=input.fromBeginning===true?0:saved.resumeSeconds;
      await launchTracked(`http://127.0.0.1:${PORT}/api/webdav/stream/${prepared.key}/${encodeURIComponent(prepared.entry.name)}`,prepared.context,{startSeconds});
      return json(res,200,{ok:true,title:prepared.entry.name,resumeSeconds:startSeconds});
    }catch(error){return json(res,400,{error:error.message});}
  }
  const davStream=url.pathname.match(/^\/api\/webdav\/stream\/([\da-f-]{36})\/[^/]+$/);
  if(['GET','HEAD'].includes(req.method) && davStream){
    const controller=new AbortController();res.once('close',()=>controller.abort());
    let remote;try{remote=await webdav.stream(davStream[1],req.headers.range,req.method,{signal:controller.signal});}catch(error){if(controller.signal.aborted)return;throw error;}
    if(res.destroyed){await remote.body?.cancel();return;}
    const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Type':'application/octet-stream','Content-Disposition':'attachment'};
    for(const name of ['content-length','content-range','accept-ranges','last-modified','etag'])if(remote.headers.has(name))headers[name]=remote.headers.get(name);
    if(![200,206,416].includes(remote.status)){await remote.body?.cancel();return json(res,502,{error:`无法读取影片（HTTP ${remote.status}）`});}
    res.writeHead(remote.status,headers);if(req.method==='HEAD'||!remote.body){await remote.body?.cancel();return res.end();}
    const {Readable}=require('node:stream');const body=Readable.fromWeb(remote.body);body.on('error',()=>res.destroy());res.on('close',()=>body.destroy());body.pipe(res);return;
  }
  if (req.method === 'GET' && url.pathname === '/api/library') {
    if (scanPromise) await scanPromise;
    const recent = await recentIds();
    const saved = await userData();
    return json(res, 200, { root: ROOT, error: scanError, recent,
      emby: { url: embyUrl, connected: !!embySession, user: embySession?.name || '', remembered, matched: embyMatched, previewCount: embyCatalog.length, error: embyError || sessionError },
      embyViews,
      embyItems: embyCatalog.map(publicEmbyItem),
      items: items.map(({id,title,year,poster,backdrop,embyPoster,embyBackdrop,embyOverview,embyGenres,embyRating,embyRatings,embyRatingLinks,embyId,embyType,embySeriesName}) => ({
        id,title,year,poster:!!(poster || embyPoster),backdrop:!!(backdrop || embyBackdrop),overview:embyOverview || '',genres:embyGenres || [],rating:embyRating || null,ratings:embyRatings || [],ratingLinks:embyRatingLinks || [],
        embyId: embySession ? embyId || null : null, type: embySession ? embyType || '' : '', seriesName: embySession ? embySeriesName || '' : '',
        favorite: saved.localFavorites.includes(id)
      })) });
  }
  if (req.method === 'GET' && url.pathname === '/api/recent') {
    return json(res, 200, { items: await recentItems() });
  }
  const progressRoute=url.pathname.match(/^\/api\/progress\/(emby-[a-z0-9_-]+|[a-f0-9]{20})$/i);
  if(req.method === 'GET' && progressRoute) {
    const id=progressRoute[1], local=byId.get(id), remote=id.startsWith('emby-') && embySession ? embyById.get(id.slice(5)) : null;
    const item=local || remote;
    if(!item) return json(res,404,{error:'影片不在当前影库中'});
    await progressStore.poll();
    return json(res,200,await itemProgress(item,url.searchParams.get('source') || '',!!local));
  }
  const subtitleRoute = url.pathname.match(/^\/api\/subtitles\/(emby-[a-z0-9_-]+|[a-f0-9]{20})(?:\/download\/(subhd-[a-z0-9]+))?$/i);
  if (req.method === 'GET' && subtitleRoute) {
    const id = subtitleRoute[1], local = byId.get(id);
    const remote = embySession ? embyById.get(id.startsWith('emby-') ? id.slice(5) : local?.embyId) : null;
    const item = remote || local;
    if (!item) return json(res,404,{error:'影片不在当前影库中'});
    if (item.folder || ['Series','Season','BoxSet','Folder','CollectionFolder'].includes(item.type)) return json(res,400,{error:'请打开具体单集或影片后搜索字幕'});
    try {
      if (subtitleRoute[2]) {
        const file = await subtitles.download(id,subtitleRoute[2]);
        res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Length':file.bytes.length,'Content-Disposition':`attachment; filename="subtitle.${file.filename.split('.').pop()}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
        return res.end(file.bytes);
      }
      const sourceId = url.searchParams.get('source') || '';
      const playback = remote ? await playbackInfo(remote).catch(() => null) : null;
      const source = playback?.sources.find(s => s.id === (sourceId || playback.recommendedSourceId));
      if (sourceId && !source) return json(res,400,{error:'片源已失效，请重新打开详情'});
      const parent = embyById.get(item.seriesId);
      const context = { ...item, originalTitle:parent?.originalTitle || item.originalTitle };
      const language = url.searchParams.get('language') || 'all';
      if (!['all','chinese','bilingual'].includes(language)) return json(res,400,{error:'字幕语言筛选无效'});
      return json(res,200,await subtitles.search(id,context,{query:url.searchParams.get('q') || '',language,sourceName:source ? `${source.name} ${source.releaseName || ''}` : path.basename(local?.path || '')}));
    } catch (error) { return json(res,502,{error:error.message}); }
  }
  if (req.method === 'GET' && url.pathname === '/api/emby/seasons') {
    if (!embySession) return json(res, 401, { error: '请先登录 Emby' });
    const seriesId = url.searchParams.get('series') || '';
    if (embyById.get(seriesId)?.type !== 'Series') return json(res, 404, { error: '剧集不在当前影库中' });
    const raw = [], seen = new Set();
    let expected = null;
    for (let start = 0; start < 1000;) {
      const q = new URLSearchParams({ UserId: embySession.userId, StartIndex: String(start), Limit: '100' });
      const response = await embyRequest(`/Shows/${encodeURIComponent(seriesId)}/Seasons?${q}`);
      const data = await response.json();
      const total = data.TotalRecordCount == null ? null : Number(data.TotalRecordCount);
      if (total !== null && Number.isSafeInteger(total) && total >= 0) expected = total;
      const page = data.Items || [];
      for (const item of page) {
        if (!item.Id || seen.has(String(item.Id))) throw Error('Emby 分季列表重复或缺少编号');
        seen.add(String(item.Id)); raw.push(item);
      }
      if (expected !== null && raw.length >= expected || expected === null && page.length < 100) break;
      if (!page.length) throw Error('Emby 分季列表分页未推进');
      start += page.length;
    }
    if (expected !== null && raw.length !== expected || expected === null && raw.length >= 1000) throw Error('Emby 分季列表未完整加载');
    const seasons = raw.filter(item => item.Type === 'Season').map(catalogItem);
    seasons.sort((a,b) => (a.indexNumber === 0 ? Infinity : a.indexNumber ?? Infinity) - (b.indexNumber === 0 ? Infinity : b.indexNumber ?? Infinity) || a.title.localeCompare(b.title, 'zh-CN'));
    for (const season of seasons) embyById.set(season.embyId, season);
    return json(res, 200, { items: seasons.map(publicEmbyItem), total: seasons.length });
  }
  if(req.method==='GET' && url.pathname==='/api/emby/subcategories'){
    if(!embySession)return json(res,401,{error:'请先登录 Emby'});
    const parent=url.searchParams.get('parent'),section=embyViews.find(x=>x.id===parent);if(!section)return json(res,404,{error:'Emby 分类不存在'});
    const owner=JSON.stringify([embyUrl,embySession.userId,creditAccountVersion]);
    const q=new URLSearchParams({UserId:embySession.userId,ParentId:parent,IncludeItemTypes:section.type==='movies'?'Movie':'Series'});
    const data=await(await embyRequest('/Genres?'+q)).json();
    if(owner!==JSON.stringify([embyUrl,embySession?.userId,creditAccountVersion]))throw Error('登录状态已变更');
    return json(res,200,{genres:(data.Items || []).filter(x=>x.Id && x.Name).map(x=>({id:String(x.Id),name:x.Name})),series:section.type==='tvshows'});
  }
  if (req.method === 'GET' && url.pathname === '/api/emby/items') {
    if (!embySession) return json(res, 401, { error: '请先登录 Emby' });
    const parent = url.searchParams.get('parent') || '';
    if (!embyViews.some(view => view.id === parent) && !embyById.has(parent)) return json(res, 404, { error: 'Emby 分类不存在' });
    const start = Math.max(0, Math.min(100000, Number(url.searchParams.get('start')) || 0));
    const section=embyViews.find(x=>x.id===parent),filters=parseSubfilters(url.searchParams),ratingSort=url.searchParams.get('ratingSort') || '';
    if(!['','community','critic','imdb','tomatoes','douban','metacritic'].includes(ratingSort))return json(res,400,{error:'评分排序无效'});
    if(section && (filters.year || filters.status || filters.watched)){
      if(filters.status && section.type!=='tvshows')return json(res,400,{error:'连载状态仅适用于剧集'});
      const data=await subcategories.browse({parent,kind:section.type==='movies'?'Movie':'Series',filters,start,sort:ratingSort});
      const page=data.items.map(catalogItem);for(const item of page)embyById.set(item.embyId,item);
      return json(res,200,{...data,items:page.map(publicEmbyItem),start});
    }
    const sequential=['Season','Series'].includes(embyById.get(parent)?.type),nativeRatingSort=!sequential && ['community','critic'].includes(ratingSort);
    const sortBy = sequential ? 'IndexNumber' : nativeRatingSort ? (ratingSort==='community'?'CommunityRating':'CriticRating')+',SortName' : 'SortName';
    const q = new URLSearchParams({ ParentId: parent, StartIndex: String(start), Limit: '100', Fields: 'Overview,Genres,MediaSources,ProviderIds,OriginalTitle', EnableImages: 'true', SortBy: sortBy, SortOrder: nativeRatingSort?'Descending':'Ascending' });
    if(section && (filters.genre || nativeRatingSort)){if(filters.genre)q.set('GenreIds',filters.genre);q.set('Recursive','true');q.set('IncludeItemTypes',section.type==='movies'?'Movie':section.type==='tvshows'?'Series':'Movie,Series,Video');}
    const response = await embyRequest(`/Users/${encodeURIComponent(embySession.userId)}/Items?${q}`);
    const data = await response.json();
    const page = (data.Items || []).filter(item => item.Id).map(catalogItem);
    for (const item of page) embyById.set(item.embyId, item);
    return json(res, 200, { items: page.map(publicEmbyItem), total: data.TotalRecordCount || page.length, hasMore: page.length === 100, start });
  }
  if (req.method === 'GET' && url.pathname === '/api/emby/search') {
    if (!embySession) return json(res, 401, { error: '请先登录 Emby' });
    const term = (url.searchParams.get('q') || '').trim().slice(0, 120);
    if (!term) return json(res, 200, { items: [], total: 0, hasMore: false });
    const start = Math.max(0, Math.min(100000, Number(url.searchParams.get('start')) || 0));
    const q = new URLSearchParams({ SearchTerm: term, Recursive: 'true', IncludeItemTypes: 'Movie,Series,Episode,Video', StartIndex: String(start), Limit: '100', Fields: 'Overview,Genres,MediaSources,ProviderIds,OriginalTitle', EnableImages: 'true' });
    const response = await embyRequest(`/Users/${encodeURIComponent(embySession.userId)}/Items?${q}`);
    const data = await response.json();
    const page = (data.Items || []).filter(item => item.Id).map(catalogItem);
    for (const item of page) embyById.set(item.embyId, item);
    return json(res, 200, { items: page.map(publicEmbyItem), total: data.TotalRecordCount || page.length, hasMore: page.length === 100, start });
  }
  const embyDetail = url.pathname.match(/^\/api\/emby\/item\/([^/]+)$/);
  if (req.method === 'GET' && embyDetail) {
    if (!embySession) return json(res, 401, { error: '请先登录 Emby' });
    const id = embyDetail[1];
    const detailSession=embySession,detailServer=embyUrl;
    const ensureDetailAccount=()=>{if(embySession!==detailSession || embyUrl!==detailServer)throw Error('登录状态已变更，请重新打开详情');};
    if (!embyById.has(id)) return json(res, 404, { error: '影片不在当前 Emby 影库中' });
    const response = await embyRequest(`/Users/${encodeURIComponent(embySession.userId)}/Items/${encodeURIComponent(id)}`);
    const full = await response.json();
    ensureDetailAccount();
    const item = catalogItem({ ...full, Id: id });
    embyById.set(id, item);
    const saved = await userData();
    // List responses are deliberately sparse; the full episode has its SeriesId.
    // Only use an explicit Emby relationship, never infer a franchise from a title.
    const relatedId = item.type === 'Episode' ? item.seriesId : item.type === 'Movie' ? String(full.Collections?.[0]?.Id || '') : '';
    const relatedType = item.type === 'Episode' ? 'Series' : 'BoxSet';
    let related = null, seriesPeople=[],creditMetadata=full;
    if (relatedId && relatedId !== id) {
      try {
        const parentResponse = await embyRequest(`/Users/${encodeURIComponent(embySession.userId)}/Items/${encodeURIComponent(relatedId)}`);
        const parent = await parentResponse.json();
        ensureDetailAccount();
        if (String(parent.Id) === relatedId && parent.Type === relatedType) {
          related = catalogItem(parent);
          if(item.type==='Episode'){seriesPeople=parent.People || [];creditMetadata=parent;}
          embyById.set(relatedId, related);
        }
      } catch { /* Keep the playable item detail when related metadata is unavailable. */ }
    }
    let sources = [], recommendedSourceId = '', sourcesError = '';
    if (!item.folder && ['Movie', 'Episode', 'Video'].includes(item.type)) {
      try {
        const playback = await playbackInfo(item);
        sources = playback.sources;
        recommendedSourceId = playback.recommendedSourceId;
      } catch (error) { sourcesError = error.message; }
    }
    const detailProgress=await itemProgress(item);
    ensureDetailAccount();
    const nativePeople=normalizeCredits(full.People || [],seriesPeople);
    let people=nativePeople,castTimer;
    try{people=await Promise.race([castEnricher.enrich(nativePeople,creditMetadata),new Promise(resolve=>{castTimer=setTimeout(()=>resolve(nativePeople),6000);castTimer.unref();})]);}catch{/* Native credits remain usable during a metadata outage. */}finally{clearTimeout(castTimer);}
    ensureDetailAccount();
    for(const person of people)if(person.id)knownPeople.set(person.id,{...knownPeople.get(person.id),...person,imageTag:person.imageTag || knownPeople.get(person.id)?.imageTag || ''});
    return json(res, 200, {
      ...publicEmbyItem(item),
      ...detailProgress,
      sources, recommendedSourceId, sourcesError,
      ...(related && { [item.type === 'Episode' ? 'series' : 'collection']: publicEmbyItem(related) }),
      following: !!saved.following[embySession.userId]?.includes(id),
      runtimeMinutes: full.RunTimeTicks ? Math.round(Number(full.RunTimeTicks) / 600000000) : null,
      officialRating: full.OfficialRating || '',
      tagline: full.Taglines?.[0] || '',
      seriesStatus:seriesStatus(creditMetadata),
      people,peopleFromSeries:item.type==='Episode' && !full.People?.length && seriesPeople.length>0
    });
  }
  if (req.method === 'GET' && url.pathname === '/api/favorites') {
    const saved = await userData();
    const local = saved.localFavorites.map(id => byId.get(id)).filter(Boolean).map(item => ({
      id: item.id, title: item.title, year: item.year,
      poster: !!(item.poster || item.embyPoster), backdrop: !!(item.backdrop || item.embyBackdrop),
      overview: item.embyOverview || '', genres: item.embyGenres || [], rating: item.embyRating || null,ratings:item.embyRatings || [],ratingLinks:item.embyRatingLinks || [],
      favorite: true
    }));
    let remote = [], error = null;
    if (embySession) {
      const favoriteSession=embySession,favoriteServer=embyUrl;
      const checkFavoriteAccount=()=>{if(embySession!==favoriteSession || embyUrl!==favoriteServer)throw Error('登录状态已变更，请重新打开收藏');};
      try {
        const q = new URLSearchParams({ Recursive: 'true', Filters:'IsFavorite', IsFavorite: 'true', IncludeItemTypes: 'Movie,Series,Episode,Video', Limit: '200', EnableImages: 'true', EnableUserData: 'true' });
        for (let start = 0; start < 10000; start += 200) {
          q.set('StartIndex', String(start));
          const response = await embyRequest(`/Users/${encodeURIComponent(embySession.userId)}/Items?${q}`);
          const data = await response.json();
          checkFavoriteAccount();
          const page = data.Items || [];
          remote.push(...page.filter(item => item.Id && item.UserData?.IsFavorite===true).map(catalogItem));
          if (page.length < 200 || start + page.length >= Number(data.TotalRecordCount || Infinity)) break;
        }
        checkFavoriteAccount();
        remote=[...new Map(remote.map(item=>[item.embyId,item])).values()];
        for (const item of remote) embyById.set(item.embyId, item);
      } catch (e) { remote=[];error = e.message; }
    }
    return json(res, 200, { items: [...local, ...remote.map(publicEmbyItem)], error });
  }
  const favoriteAction = url.pathname.match(/^\/api\/favorite\/(emby-[^/]+|[a-f0-9]{20})$/);
  if (req.method === 'POST' && favoriteAction) {
    const { favorite } = await readJson(req);
    if (typeof favorite !== 'boolean') return json(res, 400, { error: '收藏状态无效' });
    const id = favoriteAction[1];
    if (id.startsWith('emby-')) {
      const remoteId = id.slice(5), item = embyById.get(remoteId);
      if (!embySession || !item) return json(res, 404, { error: 'Emby 影片不可用' });
      const base = `/Users/${encodeURIComponent(embySession.userId)}/FavoriteItems/${encodeURIComponent(remoteId)}`;
      if (favorite) await embyRequest(base, { method: 'POST' });
      else {
        try { await embyRequest(base, { method: 'DELETE' }); }
        catch (e) { if (!e.message.includes('HTTP 404')) throw e; await embyRequest(`${base}/Delete`, { method: 'POST' }); }
      }
      item.favorite = favorite;
      subcategories.invalidate();
      const preview = embyCatalog.find(entry => entry.embyId === remoteId);
      if (preview) preview.favorite = favorite;
    } else {
      if (!byId.has(id)) return json(res, 404, { error: '本地影片不可用' });
      const saved = await userData();
      saved.localFavorites = saved.localFavorites.filter(value => value !== id);
      if (favorite) saved.localFavorites.push(id);
      await saveUserData(saved);
    }
    return json(res, 200, { id, favorite });
  }
  const followAction = url.pathname.match(/^\/api\/follow\/emby-([^/]+)$/);
  if (req.method === 'POST' && followAction) {
    const id = followAction[1], item = embyById.get(id);
    if (!embySession || !item) return json(res, 404, { error: 'Emby 剧集不可用' });
    if (item.type !== 'Series') return json(res, 400, { error: '只能追踪剧集' });
    const { following } = await readJson(req);
    if (typeof following !== 'boolean') return json(res, 400, { error: '追剧状态无效' });
    const saved = await userData();
    const list = (saved.following[embySession.userId] || []).filter(value => value !== id);
    if (following) list.push(id);
    saved.following[embySession.userId] = list;
    await saveUserData(saved);
    return json(res, 200, { id: item.id, following });
  }
  if (req.method === 'GET' && url.pathname === '/api/following') {
    if (!embySession) return json(res, 401, { error: '请先登录 Emby' });
    const saved = await userData();
    const ids = (saved.following[embySession.userId] || []).slice(0, 100);
    let series = [], nextUp = [], nextError = null;
    if (ids.length) {
      const q = new URLSearchParams({ Ids: ids.join(','), Limit: String(ids.length), EnableImages: 'true', EnableUserData: 'true' });
      const response = await embyRequest(`/Users/${encodeURIComponent(embySession.userId)}/Items?${q}`);
      const data = await response.json();
      series = (data.Items || []).filter(item => ids.includes(String(item.Id))).map(catalogItem);
      for (const item of series) embyById.set(item.embyId, item);
      try {
        const native=[];
        for(let start=0;start<ids.length;start+=4) {
          const pages=await Promise.all(ids.slice(start,start+4).map(async seriesId=>{
            const qNext=new URLSearchParams({UserId:embySession.userId,SeriesId:seriesId,Limit:'1',EnableImages:'true',EnableUserData:'true'});
            const response=await embyRequest(`/Shows/NextUp?${qNext}`),data=await response.json();
            return (data.Items || []).filter(item=>String(item.SeriesId)===seriesId);
          }));native.push(...pages.flat());
        }
        nextUp=[...new Map(native.map(item=>[String(item.Id),catalogItem(item)])).values()];
        for (const item of nextUp) embyById.set(item.embyId, item);
      } catch (e) { nextError = e.message; }
    }
    return json(res, 200, { series: series.map(publicEmbyItem), nextUp: nextUp.map(publicEmbyItem), error: nextError });
  }
  if (req.method === 'GET' && ['/api/emby/resume','/api/resume'].includes(url.pathname)) {
    const includeLocal=url.pathname === '/api/resume';
    if(!embySession && !includeLocal) return json(res,401,{error:'请先登录 Emby'});
    await progressStore.poll();
    const resume=new Map(); let error='';
    if(embySession) {
      const completedSeries=new Map();
      const rememberCompleted=(item,saved)=>{
        if(item.type !== 'Episode' || !item.seriesId || !saved.completed) return;
        const previous=completedSeries.get(item.seriesId);
        const date=saved.watchedAt || '',priorDate=previous?.saved.watchedAt || '';
        if(!previous || date>priorDate || (date===priorDate && (item.parentIndexNumber>previous.item.parentIndexNumber || (item.parentIndexNumber===previous.item.parentIndexNumber && item.indexNumber>previous.item.indexNumber)))) completedSeries.set(item.seriesId,{item,saved});
      };
      try {
        const q=new URLSearchParams({Recursive:'true',Filters:'IsResumable',IncludeItemTypes:'Movie,Episode,Video',SortBy:'DatePlayed',SortOrder:'Descending',Limit:'30',EnableImages:'true',EnableUserData:'true'});
        const response=await embyRequest(`/Users/${encodeURIComponent(embySession.userId)}/Items?${q}`), data=await response.json();
        for(const raw of data.Items || []) if(raw.Id) {
          const item=catalogItem(raw); embyById.set(item.embyId,item);
          if(!isCompleted(item) && (item.positionSeconds>3 || (item.progress>0 && item.progress<95))) resume.set(item.id,publicEmbyItem(item));
        }
      } catch(e) {error=e.message;}
      for(const entry of await progressStore.list({kind:'emby',server:embyUrl,userId:embySession.userId},{includeCompleted:true})) {
        if(!embyById.has(entry.itemId)) embyById.set(entry.itemId,{...entry.item,embyId:entry.itemId});
        const remote=embyById.get(entry.itemId),saved=await itemProgress(remote);
        rememberCompleted(remote,saved);
        if(!saved.completed) resume.set(entry.item.id,{...entry.item,...saved});
      }
      for(const remote of embyById.values()) if(!remote.folder && !resume.has(remote.id)) {
        const saved=await itemProgress(remote);
        rememberCompleted(remote,saved);
        if(saved.resumeSeconds>3 && !saved.completed) resume.set(remote.id,{...publicEmbyItem(remote),...saved});
      }
      for(const [id,item] of resume) {
        const remote=embyById.get(id.slice(5)), saved=await itemProgress(remote);
        if(saved.completed) resume.delete(id);
        else if(saved.watchedAt || saved.resumeSeconds>0) resume.set(id,{...item,...saved});
      }
      // This server requires SeriesId on /Shows/NextUp. Discover recent native
      // completions directly, then resolve their next unwatched episode by real numbering.
      try {
        const q=new URLSearchParams({Recursive:'true',Filters:'IsPlayed',IncludeItemTypes:'Episode',SortBy:'DatePlayed',SortOrder:'Descending',Limit:'30',EnableImages:'true',EnableUserData:'true'});
        const response=await embyRequest(`/Users/${encodeURIComponent(embySession.userId)}/Items?${q}`),data=await response.json();
        for(const raw of data.Items || []) {
          const item=catalogItem(raw);
          if(item.type!=='Episode' || !item.seriesId || !isCompleted(item)) continue;
          embyById.set(item.embyId,item);rememberCompleted(item,await itemProgress(item));
        }
      } catch(e) {error ||= e.message;}
      for(const [id,item] of resume) {
        const finished=completedSeries.get(item.seriesId);
        if(finished && (finished.saved.watchedAt || '')>(item.watchedAt || '') &&
          (item.parentIndexNumber<finished.item.parentIndexNumber || (item.parentIndexNumber===finished.item.parentIndexNumber && item.indexNumber<=(finished.item.indexNumberEnd || finished.item.indexNumber)))) resume.delete(id);
      }
      // One card per show: the latest partial supersedes older abandoned progress.
      const latestPartial=new Map();
      for(const item of resume.values()) if(item.type==='Episode' && item.seriesId) {
        const prior=latestPartial.get(item.seriesId);
        if(!prior || (item.watchedAt || '')>(prior.watchedAt || '') || (item.watchedAt===prior.watchedAt && (item.parentIndexNumber>prior.parentIndexNumber || (item.parentIndexNumber===prior.parentIndexNumber && item.indexNumber>prior.indexNumber)))) latestPartial.set(item.seriesId,item);
      }
      for(const [id,item] of resume) if(item.type==='Episode' && item.seriesId && latestPartial.get(item.seriesId)?.id!==id) resume.delete(id);
      const inProgress=new Set(latestPartial.keys());
      await Promise.all([...completedSeries.values()].filter(x=>!inProgress.has(x.item.seriesId)).sort((a,b)=>(b.saved.watchedAt || '').localeCompare(a.saved.watchedAt || '')).slice(0,20).map(async({item,saved})=>{
        try {
          const next=await navigator.next(item,{skipWatched:true});
          if(next) {const progress=await itemProgress(next);resume.set(next.id,{...publicEmbyItem(next),...progress,watchedAt:progress.watchedAt || saved.watchedAt,nextUp:true});}
        } catch(e) {error ||= e.message;}
      }));
    }
    if(includeLocal) for(const local of items) {
      const saved=await itemProgress(local,'',true);
      if(saved.resumeSeconds>3 && !saved.completed) resume.set(local.id,{...progressContext(local,true).item,...saved});
    }
    return json(res,200,{items:[...resume.values()].sort((a,b)=>(b.watchedAt || '').localeCompare(a.watchedAt || '')).slice(0,30),error});
  }
  if (req.method === 'GET' && url.pathname === '/api/emby/person') {
    if (!embySession) return json(res, 401, { error: '请先登录 Emby' });
    const personId = (url.searchParams.get('id') || '').trim().slice(0, 80);
    const person=knownPeople.get(personId);
    if (!person) return json(res, 400, { error: '请从影片详情选择演职员，以确认人物身份' });
    const start = Math.max(0, Math.min(100000, Number(url.searchParams.get('start')) || 0));
    const data=await creditsService.works(person,start,embySession.userId);
    const page=data.items.map(catalogItem);
    for (const item of page) embyById.set(item.embyId, item);
    return json(res, 200, { ...data,items:page.map(publicEmbyItem) });
  }
  if (req.method === 'POST' && url.pathname === '/api/emby/login') {
    let address;
    try {
      const { url: requestedUrl, username, password, remember } = await readJson(req);
      if (!username || typeof username !== 'string' || typeof password !== 'string' || typeof remember !== 'boolean') return json(res, 400, { error: '请输入 Emby 地址、用户名和密码，并选择是否记住连接' });
      address = normalizeEmbyUrl(requestedUrl);
      const auth = `Emby Client="mpv Cinema", Device="Windows", DeviceId="mpv-cinema-local", Version="1.0.0"`;
      // Authentication must never carry the token from a previous server.
      const response = await fetch(`${address}/emby/Users/AuthenticateByName`, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Emby-Authorization': auth }, body: JSON.stringify({ Username: username, Pw: password }), redirect: 'error', signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw Error(`Emby HTTP ${response.status}`);
      const data = await response.json();
      if (!data.AccessToken || !data.User?.Id) throw Error('Emby 未返回可用的登录会话');
      const next = { url: address, token: data.AccessToken, userId: String(data.User.Id), name: data.User.Name || username };
      await sessionStore.saveUrl(address);
      if (remember) await sessionStore.save(next);
      else await sessionStore.clear();
      clearEmbyCatalog();
      embyUrl = address;
      embySession = { token: data.AccessToken, userId: String(data.User.Id), name: data.User.Name || username };
      remembered = remember; sessionError = null;
      await enrichFromEmby();
      return json(res, 200, { connected: true, remembered, user: embySession.name, matched: embyMatched, previewCount: embyCatalog.length, error: embyError });
    } catch (e) { return json(res, e.message.includes('地址') ? 400 : 503, { error: `Emby 连接失败：${e.message}` }); }
  }
  if (req.method === 'POST' && url.pathname === '/api/emby/logout') {
    await sessionStore.clear();
    if (embySession) try { await embyRequest('/Sessions/Logout', { method: 'POST' }); } catch { /* Discard the local token even when remote logout is unavailable. */ }
    embySession = null; remembered = false; sessionError = null;
    clearEmbyCatalog();
    return json(res, 200, { connected: false });
  }
  if (req.method === 'POST' && url.pathname === '/api/refresh') {
    subcategories.invalidate();
    await refresh();
    return json(res, 200, { count: items.length, error: scanError });
  }
  const personArt=url.pathname.match(/^\/art\/person\/([^/]+)$/);
  if(req.method==='GET' && personArt) {
    const imageSession=embySession,imageServer=embyUrl;
    const person=knownPeople.get(decodeURIComponent(personArt[1]));
    if(!embySession || !person?.imageTag)return json(res,404,{error:'演员照片暂缺'});
    try {
      const response=await embyRequest(`/Items/${encodeURIComponent(person.id)}/Images/Primary?MaxWidth=280&MaxHeight=360&Quality=85&Tag=${encodeURIComponent(person.imageTag)}`,{headers:{Accept:'image/*'}});
      if(embySession!==imageSession || embyUrl!==imageServer){await response.body?.cancel();return json(res,409,{error:'登录状态已变更'});}
      const type=response.headers.get('content-type') || '';
      if(!/^image\/(jpeg|png|webp|avif)/i.test(type)){await response.body?.cancel();return json(res,404,{error:'演员照片暂缺'});}
      res.writeHead(200,{'Content-Type':type,'Cache-Control':'private, max-age=300','X-Content-Type-Options':'nosniff'});
      const stream=require('node:stream').Readable.fromWeb(response.body);res.on('close',()=>stream.destroy());stream.on('error',()=>res.destroy()).pipe(res);return;
    }catch{return json(res,404,{error:'演员照片暂缺'});}
  }
  const art = url.pathname.match(/^\/art\/([a-f0-9]{20})\/(poster|backdrop)$/);
  const embyArt = url.pathname.match(/^\/art\/emby-([^/]+)\/(poster|backdrop)$/);
  if (req.method === 'GET' && embyArt) {
    const item = embyById.get(embyArt[1]);
    if (!embySession || !item || !item[embyArt[2]]) return json(res, 404, { error: 'Artwork unavailable' });
    const kind = embyArt[2] === 'poster' ? 'Primary' : 'Backdrop/0';
    const width = embyArt[2] === 'poster' ? 420 : 1400;
    const response = await embyRequest(`/Items/${encodeURIComponent(item.embyId)}/Images/${kind}?MaxWidth=${width}&Quality=85`, { headers: { Accept: 'image/*' } });
    res.writeHead(200, { 'Content-Type': response.headers.get('content-type') || 'image/jpeg', 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff' });
    pipeProxyBody(response.body,res);
    return;
  }
  if (req.method === 'GET' && art) {
    const item = byId.get(art[1]);
    if (item?.embyId && embySession && (art[2] === 'poster' ? item.embyPoster : item.embyBackdrop)) {
      try {
        const kind = art[2] === 'poster' ? 'Primary' : 'Backdrop/0';
        const width = art[2] === 'poster' ? 420 : 1400;
        const response = await embyRequest(`/Items/${encodeURIComponent(item.embyId)}/Images/${kind}?MaxWidth=${width}&Quality=85`, { headers: { Accept: 'image/*' } });
        res.writeHead(200, { 'Content-Type': response.headers.get('content-type') || 'image/jpeg', 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff' });
        pipeProxyBody(response.body,res);
        return;
      } catch { /* Use the local poster if the remote server is temporarily unavailable. */ }
    }
    const name = item && item[art[2]];
    if (!name) return json(res, 404, { error: 'Artwork unavailable' });
    const file = path.join(item.dir, name);
    const type = path.extname(name).toLowerCase();
    res.writeHead(200, { 'Content-Type': type === '.png' ? 'image/png' : type === '.webp' ? 'image/webp' : 'image/jpeg', 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' });
    fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
    return;
  }
  const play = url.pathname.match(/^\/api\/play\/([a-f0-9]{20})$/);
  const embyPlay = url.pathname.match(/^\/api\/play\/emby-([^/]+)$/);
  if (req.method === 'POST' && embyPlay) {
    let item = embyById.get(embyPlay[1]);
    if (!embySession || !item) return json(res, 404, { error: '影片不在当前 Emby 影库中' });
    if (item.folder || ['Series', 'Season', 'Folder', 'CollectionFolder', 'BoxSet'].includes(item.type)) return json(res, 400, { error: '请先打开分类并选择具体影片' });
    const requested = await readJson(req);
    try {
      const response=await embyRequest(`/Users/${encodeURIComponent(embySession.userId)}/Items/${encodeURIComponent(item.embyId)}`);
      item=catalogItem(await response.json()); embyById.set(item.embyId,item);
    } catch { /* Local progress can still resume while native metadata is unavailable. */ }
    delete item.playback;
    const playback = await playbackInfo(item);
    const previous=await itemProgress(item);
    const sourceId = requested.sourceId || (playback.sources.some(source=>source.id === previous.resumeSourceId && source.direct) ? previous.resumeSourceId : playback.recommendedSourceId);
    const source = playback.sources.find(entry => entry.id === sourceId);
    if (!source) return json(res, 400, { error: '所选片源已失效，请重新打开影片详情' });
    if (!source.direct) return json(res, 409, { error: '此片源不支持原始画质直传' });
    const stream=createStream(item,source,playback);
    const saved=await itemProgress(item,sourceId);
    const resumeSeconds=requested.fromBeginning === true ? 0 : saved.resumeSeconds;
    const context={...progressContext(item),playSessionId:playback.sessionId};
    const tracked=item.type==='Episode' ? await playbackQueue.start({item,source,sourceId,startSeconds:resumeSeconds,title:episodeTitle(item),media:stream,context}) : undefined;
    await launchTrackedPlayer({executable:MPV,media:stream,context,store:progressStore,sourceId,startSeconds:resumeSeconds,tracked});
    return json(res, 200, { ok: true, title: item.title, sourceId, sourceName: source.name, streamUrl: stream,resumeSeconds });
  }
  const embyStream = url.pathname.match(/^\/stream\/emby-([^/]+)$/);
  if ((req.method === 'GET' || req.method === 'HEAD') && embyStream) {
    const stream = activeStreams.get(url.searchParams.get('play'));
    if (!embySession || !stream || stream.itemId !== embyStream[1] || stream.userId !== embySession.userId || stream.server !== embyUrl || stream.expiresAt < Date.now()) {
      return json(res, 404, { error: '播放会话已失效' });
    }
    stream.expiresAt = Date.now() + 24 * 3600 * 1000;
    const params = new URLSearchParams({ Static: 'true', MediaSourceId: stream.source.id, PlaySessionId: stream.sessionId });
    const headers = { 'X-Emby-Token': embySession.token };
    if (req.headers.range) headers.Range = req.headers.range;
    let upstream;
    const safeContainer = /^[a-z0-9]+$/i.test(stream.source.container) ? stream.source.container : '';
    const paths = [
      `/Videos/${encodeURIComponent(stream.itemId)}/stream${safeContainer ? '.' + safeContainer : ''}?${params}`,
      `/Videos/${encodeURIComponent(stream.itemId)}/stream?${params}`
    ];
    for (const upstreamPath of [...new Set(paths)]) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30000);
      try { upstream = await fetch(`${embyUrl}/emby${upstreamPath}`, { method: req.method, headers, redirect: 'error', signal: controller.signal }); }
      finally { clearTimeout(timer); }
      if (upstream.status !== 404 || upstreamPath === paths.at(-1)) break;
      await upstream.body?.cancel();
    }
    const pass = {};
    for (const key of ['content-type','content-length','content-range','accept-ranges','last-modified','etag']) {
      const value = upstream.headers.get(key); if (value) pass[key] = value;
    }
    res.writeHead(upstream.status, pass);
    if (req.method === 'HEAD' || !upstream.body) return res.end();
    const readable = require('node:stream').Readable.fromWeb(upstream.body);
    res.on('close', () => readable.destroy());
    readable.on('error', () => res.destroy()).pipe(res);
    return;
  }
  if (req.method === 'POST' && play) {
    const item = byId.get(play[1]);
    if (!item) return json(res, 404, { error: '影片不在当前影库中' });
    try {
      await fsp.access(item.path, fs.constants.R_OK);
      const requested=await readJson(req),saved=await itemProgress(item,'',true);
      const resumeSeconds=requested.fromBeginning === true ? 0 : saved.resumeSeconds;
      // Local files already have a stable native watch-later identity, including track selection.
      const child=spawn(MPV,requested.fromBeginning === true ? ['--resume-playback=no','--start=0',item.path] : [item.path],{detached:true,stdio:'ignore',windowsHide:false});
      await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject)});child.unref();
      return json(res, 200, { ok: true, title: item.title,resumeSeconds });
    } catch (e) { return json(res, 503, { error: `无法打开影片：${e.message}` }); }
  }
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });
  const files = { '/ratings.js':'ratings.js','/ratings-ui.js':'ratings-ui.js','/ratings.css':'ratings.css', '/webdav-image-queue.js':'webdav-image-queue.js', '/webdav-posters.js':'webdav-posters.js','/webdav-ui.js':'webdav-ui.js','/webdav.css':'webdav.css','/': 'index.html', '/app.css': 'app.css', '/emby.css': 'emby.css', '/app.js': 'app.js', '/detail-presentation.js': 'detail-presentation.js', '/subtitle-ui.js':'subtitle-ui.js', '/person-results.js':'person-results.js' };
  const name = files[url.pathname];
  if (!name) return json(res, 404, { error: 'Not found' });
  const type = name.endsWith('.css') ? 'text/css' : name.endsWith('.js') ? 'text/javascript' : 'text/html';
  res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  fs.createReadStream(path.join(__dirname, name)).pipe(res);
}

restoreEmbySession().then(() => {
  http.createServer((req, res) => main(req, res).catch(e => {
    if (res.headersSent) res.destroy();
    else json(res, 500, { error: e.message });
  })).listen(PORT, '127.0.0.1', () => {
    console.log(`影库已启动：http://127.0.0.1:${PORT}，扫描 ${ROOT}`);
    refresh();
  });
});
