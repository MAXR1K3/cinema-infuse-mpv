const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSubHD, rankSubtitles, createSubtitleService } = require('./subtitles');

const card = (id, name, release, tags = '简体 双语 ASS') => `<div class="bg-white shadow-sm rounded-3 mb-4"><div class="row"><a href='/a/${id}'>${name}</a><div class="view-text text-secondary"><a href='/a/${id}'>${release}</a></div><div class="text-truncate py-2 f11"><span>${tags}</span></div><time datetime="2026-10-20T00:00:00Z">今天</time></div></div>`;
const item = { title: '第一集', seriesName: '白色故事', originalTitle: 'White Story', type: 'Episode', parentIndexNumber: 1, indexNumber: 1, year: '2026' };

test('results deduplicate and rank the correct title, season and episode ahead of packs and uncertain matches', () => {
  const parsed = parseSubHD([
    card('wrongSeason', '白色故事', 'White.Story.S02E01.WEB-DL'),
    card('wrongEpisode', '白色故事', 'White.Story.S01E02.WEB-DL'),
    card('unrelated', '黑色故事', 'Black.Story.S01E01.WEB-DL'),
    card('pack', '白色故事', 'White.Story.S01.全10集.WEB-DL'),
    card('exact', '白色故事', 'White.Story.S01E01.1080p.NF.WEB-DL'),
    card('exact', '白色故事', 'White.Story.S01E01.1080p.NF.WEB-DL'),
    card('unknownSeason', '白色故事', '白色故事.E01.中韩双语'),
    card('unknownEpisode', '白色故事', '白色故事 中文字幕')
  ].join(''));
  const results = rankSubtitles(parsed, item, '1080p NF WEB-DL', 'all');
  assert.deepEqual(results.map(r => r.id), ['subhd-exact', 'subhd-pack', 'subhd-unknownSeason', 'subhd-unknownEpisode']);
  assert.equal(results[0].match, '本集匹配');
  assert.ok(results[0].reasons.includes('WEB-DL 版本'));
  assert.match(results[2].match, /季数待核对/);
  assert.equal(results[0].language, '简体 · 双语');
});

test('Chinese season/episode numbers and episode ranges do not match another episode', () => {
  const parsed = parseSubHD(card('chinese', '白色故事', '白色故事 第一季 第1-3集') + card('other', '白色故事', '白色故事 第一季 第四集'));
  assert.deepEqual(rankSubtitles(parsed, item).map(r => r.id), ['subhd-chinese']);
  assert.equal(rankSubtitles(parsed, { ...item, indexNumber: 4 })[0].id, 'subhd-other');
});

test('an unavailable provider is reported honestly; downloads accept only a matched result and follow the provider cookie session', async () => {
  const calls = [];
  const fetcher = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('/search/')) return new Response(card('abc123', '白色故事', 'White.Story.S01E01.WEB-DL', '简体 SRT'));
    if (String(url).includes('zimuku.org')) return new Response('请输入验证码', { status: 404 });
    if (String(url).endsWith('/prepare-download')) return new Response(JSON.stringify({ success: true, url: '/down/abc123' }), { headers: { 'Set-Cookie': 'session=fixture; Secure; HttpOnly' } });
    if (String(url).endsWith('/down/abc123')) {
      assert.match(options.headers.Cookie, /session=fixture/);
      return new Response('download page', { headers: { 'Set-Cookie': 'step=ready; Secure' } });
    }
    if (String(url).endsWith('/api/sub/down')) {
      assert.match(options.headers.Cookie, /step=ready/);
      return new Response(JSON.stringify({ success: true, pass: true, url: 'https://dlus.subhd.me/test.srt' }));
    }
    if (String(url) === 'https://dlus.subhd.me/test.srt') return new Response('1\n00:00:01,000 --> 00:00:02,000\n测试字幕', { headers: { 'Content-Type': 'text/plain' } });
    throw Error('Unexpected URL');
  };
  const service = createSubtitleService({ fetcher });
  await assert.rejects(service.download('episode1', 'subhd-forged'), /重新搜索/);
  const result = await service.search('episode1', item);
  assert.equal(result.items[0].id, 'subhd-abc123');
  assert.equal(result.providers.find(p => p.id === 'zimuku').status, 'verification');
  const file = await service.download('episode1', 'subhd-abc123');
  assert.match(file.filename, /S01E01.*\.srt$/);
  assert.match(file.bytes.toString(), /测试字幕/);
  assert.ok(!calls.some(c => c.url.includes('token')));
});

test('a provider-supplied private or unrelated download URL is rejected before fetching', async () => {
  for (const bad of ['http://127.0.0.1/secret.srt', 'https://evil.example/x.srt', 'https://dlus.subhd.me@evil.example/x.srt']) {
    const service = createSubtitleService({ fetcher: async (url) => {
      if (String(url).includes('/search/')) return new Response(card('abc', '白色故事', 'White.Story.S01E01'));
      if (String(url).includes('zimuku.org')) return new Response('', { status: 404 });
      if (String(url).endsWith('/prepare-download')) return new Response(JSON.stringify({ success: true, url: '/down/abc' }));
      if (String(url).endsWith('/down/abc')) return new Response('page');
      if (String(url).endsWith('/api/sub/down')) return new Response(JSON.stringify({ success: true, pass: true, url: bad }));
      throw Error('Forbidden URL was fetched');
    }});
    await service.search('ep', item);
    await assert.rejects(service.download('ep', 'subhd-abc'), /下载地址/);
  }
});
