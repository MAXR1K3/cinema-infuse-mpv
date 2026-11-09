const test = require('node:test');
const assert = require('node:assert/strict');
const { detailPresentation, enrichDetailItem } = require('./detail-presentation');

test('a local episode matched to Emby gains its series synopsis without changing local playback or favorite identity', () => {
  const local = { id: 'local-123', embyId: 'ep1', title: '第二集', type: 'Episode', overview: '本集简介', favorite: true, poster: true };
  const remote = { id: 'emby-ep1', source: 'emby', favorite: false, type: 'Episode', overview: '完整的本集简介', series: { id: 'emby-series1', title: '山海故事', overview: '整部剧的梗概' } };
  const merged = enrichDetailItem(local, remote);
  assert.equal(merged.id, 'local-123');
  assert.equal(merged.source, undefined);
  assert.equal(merged.favorite, true);
  assert.equal(merged.series?.overview, '整部剧的梗概');
  assert.equal(detailPresentation(merged).primaryOverview, '整部剧的梗概');
});

test('episode presents series synopsis first without losing its own synopsis or playback target', () => {
  const episode = { id: 'emby-ep1', type: 'Episode', title: '第二集', overview: '本集简介', series: { id: 'emby-series1', title: '山海故事', overview: '整部剧的梗概', type: 'Series' } };
  const view = detailPresentation(episode);
  assert.equal(view.title, '山海故事');
  assert.equal(view.primaryHeading, '剧集梗概');
  assert.equal(view.primaryOverview, '整部剧的梗概');
  assert.equal(view.secondaryHeading, '本集简介');
  assert.equal(view.secondaryOverview, '本集简介');
  assert.equal(view.context, '当前单集：第二集');
  assert.equal(view.browseTarget.id, 'emby-series1');
  assert.equal(view.playLabel, '▶　播放本集');
});

test('film collection is only shown when Emby explicitly supplies one; standalone and Series keep their own overview', () => {
  const film = detailPresentation({ type: 'Movie', title: '第一部', overview: '本片简介', collection: { id: 'emby-c1', title: '山海电影合集', overview: '整个系列的梗概', type: 'BoxSet' } });
  assert.equal(film.title, '山海电影合集');
  assert.equal(film.primaryOverview, '整个系列的梗概');
  assert.equal(film.secondaryOverview, '本片简介');
  assert.equal(film.browseTarget.id, 'emby-c1');
  const standalone = detailPresentation({ type: 'Movie', title: '独立电影', overview: '独立故事' });
  assert.equal(standalone.title, '独立电影');
  assert.equal(standalone.primaryOverview, '独立故事');
  assert.equal(standalone.secondaryOverview, '');
  assert.equal(standalone.browseTarget, null);
  const series = detailPresentation({ type: 'Series', title: '山海故事', overview: '整部剧的梗概' });
  assert.equal(series.primaryHeading, '剧集梗概');
  assert.equal(series.primaryOverview, '整部剧的梗概');
});
