// Provider HTML remains data: never execute it or accept caller-supplied download URLs.
const MAX_HTML = 2 * 1024 * 1024;
const MAX_DOWNLOAD = 32 * 1024 * 1024;
const TTL = 10 * 60 * 1000;
const normalize = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}\s]/gu, '');
function text(html) {
  return String(html || '').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '').replace(/<[^>]*>/g, ' ')
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, code) => { const n = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code); return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ''; })
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/gi, (_, name) => ({ amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ' }[name.toLowerCase()]))
    .replace(/\s+/g, ' ').trim();
}
function parseSubHD(html) {
  const starts = [...html.matchAll(/<div\b[^>]*class=["'][^"']*\bbg-white\b[^"']*\bmb-4\b[^"']*["'][^>]*>/gi)].map(m => m.index);
  const items = [];
  for (let i = 0; i < starts.length; i++) {
    const block = html.slice(starts[i], starts[i + 1] || html.length);
    const link = block.match(/<a\b[^>]*href=["']\/a\/([a-z0-9]+)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!link) continue;
    const release = block.match(/<div\b[^>]*class=["'][^"']*\bview-text\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
    const tags = text(block.match(/<div\b[^>]*class=["'][^"']*\btext-truncate\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1]);
    const language = ['简体','繁体','双语','英语','日语','韩语'].filter(value => tags.includes(value)).join(' · ') || '未标注语言';
    const format = [...new Set(tags.toUpperCase().match(/\b(?:SRT|ASS|SSA|VTT|SUB|SUP|IDX)\b/g) || [])].join(' / ');
    items.push({ id:`subhd-${link[1]}`, provider:'subhd', providerName:'SubHD', title:text(link[2]), release:text(release?.[1]) || text(link[2]), language, format, url:`https://subhd.tv/a/${link[1]}`, updatedAt:block.match(/<time\b[^>]*datetime=["']([^"']+)/i)?.[1] || '' });
  }
  return items;
}
function chineseNumber(value) {
  if (/^\d+$/.test(value)) return Number(value);
  const digits = { '零':0,'〇':0,'一':1,'二':2,'两':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9 };
  if (value.includes('十')) { const [a,b] = value.split('十'); return (digits[a] || 1) * 10 + (digits[b] || 0); }
  return digits[value] ?? null;
}
function coordinates(value) {
  value = value.replace(/_/g,' ');
  const seasons = [...value.matchAll(/\bS(\d{1,2})(?=E|\b|[._ -])/gi)].map(m => Number(m[1]));
  for (const match of value.matchAll(/第([零〇一二两三四五六七八九十\d]+)季/g)) seasons.push(chineseNumber(match[1]));
  const episodes = [], ranges = [];
  for (const m of value.matchAll(/(?:\bS\d{1,2}|\b)E(?:P)?[ ._-]?(\d{1,3})(?:\s*[-~至到]\s*(?:E(?:P)?)?(\d{1,3}))?/gi)) {
    episodes.push(Number(m[1])); if (m[2]) ranges.push([Number(m[1]),Number(m[2])]);
  }
  for (const m of value.matchAll(/第([零〇一二两三四五六七八九十\d]+)(?:\s*[-~至到]\s*第?([零〇一二两三四五六七八九十\d]+))?[集话話]/g)) {
    episodes.push(chineseNumber(m[1])); if (m[2]) ranges.push([chineseNumber(m[1]),chineseNumber(m[2])]);
  }
  return { seasons:seasons.filter(n => n !== null), episodes:episodes.filter(n => n !== null), ranges };
}
function rankSubtitles(candidates, item, sourceName = '', language = 'all', query = '') {
  const aliases = [item.seriesName || item.title, item.originalTitle, query].map(normalize).filter(t => t.length >= 2);
  const expectedEpisode = item.type === 'Episode' && Number.isInteger(item.indexNumber) ? item.indexNumber : null;
  const expectedSeason = Number.isInteger(item.parentIndexNumber) ? item.parentIndexNumber : null;
  const seen = new Set(), results = [];
  for (const candidate of candidates) {
    if (seen.has(candidate.id)) continue; seen.add(candidate.id);
    const title = normalize(`${candidate.title} ${candidate.release}`);
    if (!aliases.some(alias => title.includes(alias))) continue;
    if (language === 'chinese' && !/简体|繁体|双语|中文/.test(candidate.language)) continue;
    if (language === 'bilingual' && !/双语/.test(candidate.language)) continue;
    const at = coordinates(`${candidate.title} ${candidate.release}`), reasons = [];
    if (expectedSeason !== null && at.seasons.length && !at.seasons.includes(expectedSeason)) continue;
    const inRange = at.ranges.some(([start,end]) => expectedEpisode >= start && expectedEpisode <= end);
    if (expectedEpisode !== null && at.episodes.length && !at.episodes.includes(expectedEpisode) && !inRange) continue;
    let score = 20, match = '片名匹配 · 版本待核对';
    if (expectedEpisode !== null) {
      if (at.episodes.includes(expectedEpisode) || inRange) {
        if (expectedSeason !== null && at.seasons.includes(expectedSeason)) { score += 60; match = inRange ? '包含本集' : '本集匹配'; }
        else { score += 25; match = '集数匹配 · 季数待核对'; }
      } else if (expectedSeason !== null && at.seasons.includes(expectedSeason)) { score += 35; match = '本季字幕包 · 请核对集数'; }
      else match = '片名匹配 · 季集待核对';
    }
    for (const [pattern,label] of [[/WEB[ ._-]?DL/i,'WEB-DL'],[/BLU[ ._-]?RAY|BDRIP/i,'BluRay'],[/WEB[ ._-]?RIP/i,'WEBRip'],[/\bNF\b|NETFLIX/i,'Netflix'],[/\bAMZN\b|AMAZON/i,'Amazon']]) {
      if (pattern.test(sourceName) && pattern.test(candidate.release)) { score += 4; reasons.push(`${label} 版本`); }
    }
    if (/简体|双语/.test(candidate.language)) score += 2;
    results.push({ ...candidate, score, match, reasons });
  }
  return results.sort((a,b) => b.score - a.score || b.updatedAt.localeCompare(a.updatedAt)).slice(0,30);
}
async function boundedBody(response, max) {
  if (Number(response.headers.get('content-length')) > max) { await response.body?.cancel(); throw Error('文件超过下载大小限制'); }
  const chunks = []; let size = 0;
  for await (const chunk of response.body || []) {
    size += chunk.length;
    if (size > max) throw Error('文件超过下载大小限制');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
function createSubtitleService({ fetcher = fetch } = {}) {
  const cache = new Map(), matched = new Map();
  async function request(url, options = {}) {
    return fetcher(url, { ...options, redirect:'error', signal:AbortSignal.timeout(15000) });
  }
  async function search(id, item, { query = '', sourceName = '', language = 'all' } = {}) {
    query = String(query || item.seriesName || item.title).trim().slice(0,100);
    if (!query) throw Error('缺少可搜索的剧名');
    const coordinate = item.type === 'Episode' && Number.isInteger(item.indexNumber) ? `${Number.isInteger(item.parentIndexNumber) ? `S${String(item.parentIndexNumber).padStart(2,'0')}` : ''}E${String(item.indexNumber).padStart(2,'0')}` : '';
    const links = [
      { id:'subhd', name:'SubHD', url:`https://subhd.tv/search/${encodeURIComponent(query)}` },
      { id:'zimuku', name:'字幕库', url:`https://zimuku.org/search?q=${encodeURIComponent(query + (coordinate ? ' ' + coordinate : ''))}` }
    ];
    const key = JSON.stringify([id,query,coordinate]);
    let data = cache.get(key);
    if (!data || data.expires < Date.now()) {
      const providers = await Promise.all(links.map(async provider => {
        try {
          if (provider.id === 'zimuku') {
            const response = await request(provider.url);
            const html = (await boundedBody(response, MAX_HTML)).toString('utf8');
            const blocked = /验证码|yunsuo|challenge|captcha|网站防火墙/i.test(text(html));
            return { ...provider, status:blocked ? 'verification' : 'external', message:blocked ? '字幕库需要网站验证，请在原站搜索下载。' : '请在字幕库原站查看并下载匹配结果。', items:[] };
          }
          const queries = [...new Set([query + (coordinate ? ' ' + coordinate : ''), query])];
          const pages = await Promise.all(queries.map(async term => {
            const response = await request(`https://subhd.tv/search/${encodeURIComponent(term)}`);
            if (!response.ok) throw Error(`SubHD 返回 HTTP ${response.status}`);
            const html = (await boundedBody(response, MAX_HTML)).toString('utf8');
            if (/cf-chl-|just a moment|captcha|verify you are human/i.test(html)) throw Error('SubHD 需要在原站完成验证');
            return parseSubHD(html);
          }));
          return { ...provider, status:'ready', message:'', items:pages.flat() };
        } catch (error) { return { ...provider, status:'unavailable', message:error.message, items:[] }; }
      }));
      data = { expires:Date.now() + TTL, providers };
      cache.set(key,data);
      for (const [key,value] of cache) if (value.expires < Date.now()) cache.delete(key);
      if (cache.size > 100) cache.delete(cache.keys().next().value);
    }
    const ranked = rankSubtitles(data.providers.flatMap(p => p.items), item, sourceName, language, query);
    for (const result of ranked) matched.set(`${id}:${result.id}`, { ...result, item, expires:data.expires });
    for (const [key,value] of matched) if (value.expires < Date.now()) matched.delete(key);
    if (matched.size > 3000) matched.delete(matched.keys().next().value);
    return { query, coordinate, items:ranked, providers:data.providers.map(({items,...provider}) => provider) };
  }
  async function download(itemId, resultId) {
    const result = matched.get(`${itemId}:${resultId}`);
    if (!result || result.expires < Date.now() || !/^subhd-[a-z0-9]+$/i.test(resultId)) throw Error('字幕结果已失效，请重新搜索');
    const sid = resultId.slice(6), jar = new Map();
    async function sessionRequest(url, options = {}) {
      const response = await request(url,{ ...options, headers:{ Cookie:[...jar].map(([k,v]) => `${k}=${v}`).join('; '), ...options.headers } });
      for (const cookie of response.headers.getSetCookie()) { const pair = cookie.split(';')[0], at = pair.indexOf('='); jar.set(pair.slice(0,at),pair.slice(at+1)); }
      if (!response.ok) throw Error('字幕站暂时无法下载，请前往原站');
      return response;
    }
    const payload = JSON.stringify({sid}), headers = { 'Content-Type':'application/json', Referer:result.url };
    const prepare = await sessionRequest('https://subhd.tv/api/sub/prepare-download',{method:'POST',headers,body:payload});
    const prepared = JSON.parse((await boundedBody(prepare,MAX_HTML)).toString());
    if (!prepared.success || prepared.url !== `/down/${sid}`) throw Error('字幕站需要验证，请前往原站下载');
    const page = await sessionRequest(`https://subhd.tv/down/${sid}`);
    const html = (await boundedBody(page,MAX_HTML)).toString();
    if (/captcha|turnstile|人机验证|请输入验证码/i.test(html)) throw Error('请前往原站完成验证后下载');
    const down = await sessionRequest('https://subhd.tv/api/sub/down',{method:'POST',headers:{...headers,Referer:`https://subhd.tv/down/${sid}`},body:payload});
    const data = JSON.parse((await boundedBody(down,MAX_HTML)).toString());
    if (!data.success || !data.pass || !data.url) throw Error(data.msg || '字幕站未提供文件，请前往原站下载');
    const url = new URL(data.url);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !/^dl[a-z0-9-]*\.subhd\.(me|tv)$/i.test(url.hostname)) throw Error('字幕下载地址不可信');
    const ext = url.pathname.match(/\.(srt|ass|ssa|vtt|sub|idx|sup|zip|rar|7z)$/i)?.[1]?.toLowerCase();
    if (!ext) throw Error('不支持此字幕下载格式');
    const response = await request(url.href);
    if (!response.ok) throw Error(`字幕文件下载失败（HTTP ${response.status}）`);
    if (/text\/html|application\/json/i.test(response.headers.get('content-type') || '')) throw Error('下载地址未返回字幕文件');
    const bytes = await boundedBody(response,MAX_DOWNLOAD);
    if (!bytes.length || /^\s*<(?:!doctype|html)/i.test(bytes.subarray(0,100).toString())) throw Error('字幕文件为空或暂不可用');
    const item = result.item;
    const episode = item.type === 'Episode' && Number.isInteger(item.indexNumber) ? `.${Number.isInteger(item.parentIndexNumber) ? `S${String(item.parentIndexNumber).padStart(2,'0')}` : ''}E${String(item.indexNumber).padStart(2,'0')}` : '';
    const title = String(item.seriesName || item.title).replace(/[<>:"/\\|?*\x00-\x1f]/g,' ').trim().slice(0,100) || '字幕';
    return { bytes, filename:`${title}${episode}.${sid}.${ext}` };
  }
  return { search, download };
}
module.exports = { parseSubHD, rankSubtitles, createSubtitleService };
