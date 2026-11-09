let subtitleItemId = '', subtitleRequest = 0;
let subtitleBusy = false;
function subtitleLinks(query, coordinate = '') {
  const providers = $('#subtitle-providers'); providers.replaceChildren();
  for (const [name,url] of [['SubHD',`https://subhd.tv/search/${encodeURIComponent(query)}`],['字幕库',`https://zimuku.org/search?q=${encodeURIComponent(`${query} ${coordinate}`.trim())}`]]) {
    const a = document.createElement('a'); a.textContent = `${name} 原站搜索 ↗`; a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; providers.append(a);
  }
}
function showSubtitlePanel(item, hydrate) {
  const panel = $('#detail-subtitles'); panel.hidden = isContainer(item);
  if (panel.hidden) return;
  const changed = subtitleItemId !== item.id;
  if (changed) {
    subtitleRequest++; subtitleItemId = item.id; subtitleBusy = false; panel.open = false;
    $('#subtitle-results').replaceChildren(); $('#subtitle-query').value = item.seriesName || item.title; $('#subtitle-language').value = 'all';
    $('#subtitle-status').textContent = '按剧名、季集数和当前片源匹配，可修改名称重试。'; $('#subtitle-status').classList.remove('error');
  }
  const coordinate = item.type === 'Episode' && Number.isInteger(item.indexNumber) ? `${Number.isInteger(item.parentIndexNumber) ? `S${String(item.parentIndexNumber).padStart(2,'0')}` : ''}E${String(item.indexNumber).padStart(2,'0')}` : '';
  $('#subtitle-context').textContent = coordinate ? `当前单集 ${coordinate} · 优先匹配当前片源` : '按片名与当前片源匹配';
  if (!changed && !hydrate && !$('#subtitle-results').children.length) $('#subtitle-query').value = item.seriesName || item.title;
  $('#subtitle-search-button').disabled = !!(hydrate && (item.source === 'emby' || item.embyId)) || subtitleBusy;
  subtitleLinks($('#subtitle-query').value,coordinate);
}
function resultRow(result, itemId) {
  const row = document.createElement('article'); row.className = 'subtitle-result';
  const copy = document.createElement('div'); copy.className = 'subtitle-result-copy';
  const heading = document.createElement('h3'); heading.textContent = result.release;
  const meta = document.createElement('p'); meta.textContent = [result.providerName,result.language,result.format,...result.reasons].filter(Boolean).join(' · ');
  const badge = document.createElement('span'); badge.className = `subtitle-match${result.match === '本集匹配' ? ' exact' : ''}`; badge.textContent = result.match; copy.append(badge,heading,meta);
  const actions = document.createElement('div'); actions.className = 'subtitle-result-actions';
  const download = document.createElement('button'); download.type = 'button'; download.className = 'subtitle-download'; download.textContent = '↓ 下载字幕';
  download.addEventListener('click',async () => {
    download.disabled = true; download.textContent = '下载中…';
    try {
      const response = await fetch(`/api/subtitles/${encodeURIComponent(itemId)}/download/${encodeURIComponent(result.id)}`);
      if (!response.ok) { const data = await response.json(); throw Error(data.error || '下载失败，请前往原站'); }
      const filename = decodeURIComponent((response.headers.get('Content-Disposition') || '').match(/filename\*=UTF-8''([^;]+)/i)?.[1] || 'subtitle.srt');
      const blob = await response.blob(), objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = objectUrl; a.download = filename; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(objectUrl),60000);
      download.textContent = '✓ 已下载';
      if (detailItem?.id === itemId) $('#subtitle-status').textContent = `已提交浏览器下载：${filename}。将字幕拖入 mpv 即可加载。`;
    } catch (error) {
      download.textContent = '重试下载';
      if (detailItem?.id === itemId) { $('#subtitle-status').textContent = `${error.message}；可点此结果的“原站”继续。`; $('#subtitle-status').classList.add('error'); }
    } finally { download.disabled = false; }
  });
  const original = document.createElement('a'); original.textContent = '原站 ↗'; original.href = result.url; original.target = '_blank'; original.rel = 'noopener noreferrer';
  actions.append(download,original); row.append(copy,actions); return row;
}
$('#subtitle-form').addEventListener('submit',async event => {
  event.preventDefault(); if (!detailItem || subtitleBusy) return;
  const item = detailItem, ticket = ++subtitleRequest, query = $('#subtitle-query').value.trim(); if (!query) return;
  subtitleBusy = true; $('#subtitle-search-button').disabled = true;
  const status = $('#subtitle-status'); status.classList.remove('error'); status.textContent = '正在搜索字幕，核对片名、季集数和片源版本…'; $('#subtitle-results').replaceChildren();
  const params = new URLSearchParams({q:query,language:$('#subtitle-language').value}); const source = selectedSources.get(item.id); if (source) params.set('source',source);
  try {
    const data = await getJson(`/api/subtitles/${encodeURIComponent(item.id)}?${params}`);
    if (ticket !== subtitleRequest || detailItem?.id !== item.id) return;
    subtitleLinks(data.query,data.coordinate); $('#subtitle-results').replaceChildren(...data.items.map(result => resultRow(result,item.id)));
    const unavailable = data.providers.filter(p => p.status !== 'ready').map(p => p.message).filter(Boolean);
    status.textContent = `${data.items.length ? `找到 ${data.items.length} 个候选字幕，按本集及片源匹配度排序。` : '暂无匹配字幕，可修改名称或前往原站搜索。'}${unavailable.length ? ' ' + unavailable.join(' ') : ''}`;
  } catch (error) {
    if (ticket === subtitleRequest && detailItem?.id === item.id) { status.textContent = `${error.message}，可前往原站搜索。`; status.classList.add('error'); }
  } finally { if (ticket === subtitleRequest) { subtitleBusy = false; $('#subtitle-search-button').disabled = false; } }
});
