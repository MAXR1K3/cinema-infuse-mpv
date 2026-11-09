const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

async function freePort() {
  const server = http.createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}
async function startLibrary(port, root, embyUrl) {
  const proc = spawn(process.execPath, ['server.js'], { cwd: __dirname, stdio: 'ignore', windowsHide: true, env: {
    ...process.env, MPV_LIBRARY_ROOT: path.join(root, 'movies'), MPV_LIBRARY_PORT: String(port),
    MPV_EMBY_URL: embyUrl, MPV_LIBRARY_USER_DATA: path.join(root, 'user.json'), MPV_EMBY_SESSION_FILE: path.join(root, 'session.json')
  }});
  for (let i = 0; i < 80; i++) {
    if (proc.exitCode !== null) throw Error('Library process exited');
    try { if ((await fetch(`http://127.0.0.1:${port}/api/library`)).ok) return proc; } catch {}
    await new Promise(resolve => setTimeout(resolve, 80));
  }
  proc.kill(); throw Error('Library start timed out');
}

test('episode detail separates the series synopsis from the episode synopsis; movie uses explicit BoxSet context', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mpv-emby-story-'));
  await fs.mkdir(path.join(root, 'movies'));
  await fs.writeFile(path.join(root, 'movies', 'episode-demo.mkv'), 'synthetic empty movie');
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const requests = [];
  let seriesUnavailable = false;
  const mock = http.createServer((req, res) => {
    requests.push(req.url);
    res.setHeader('Content-Type', 'application/json');
    let data;
    if (req.url === '/emby/Users/AuthenticateByName') data = { AccessToken: 'fixture-token', User: { Id: 'u2', Name: 'Fixture' } };
    else if (req.url === '/emby/Users/u2/Views') data = { Items: [{ Id: 'v1', Name: '全部', CollectionType: 'mixed' }] };
    else if(req.url.includes('/emby/Users/u2/Items?') && req.url.includes('PersonIds=actor1')) data={Items:[{Id:'correct',Name:'正确作品',Type:'Movie',People:[{Id:'actor1',Name:'演员'}]},{Id:'wrong',Name:'同名演员作品',Type:'Movie',People:[{Id:'other',Name:'演员'}]}],TotalRecordCount:2};
    else if(req.url.startsWith('/emby/Items/actor1/Images/Primary')){res.setHeader('Content-Type','image/png');res.end(Buffer.from([137,80,78,71]));return;}
    else if (req.url.startsWith('/emby/Users/u2/Items?')) data = { Items: [
      { Id: 'ep1', Name: '第二集', Type: 'Episode', Overview: '本集简介', Path: 'Z:/Movies/episode-demo.mkv', IsFolder: false },
      { Id: 'movie1', Name: '系列电影第一部', Type: 'Movie', Overview: '本片简介', IsFolder: false }
    ], TotalRecordCount: 2 };
    else if (req.url === '/emby/Users/u2/Items/ep1') data = { Id: 'ep1', Name: '第二集', Type: 'Episode', Overview: '本集简介', SeriesId: 'series1', SeriesName: '山海故事', IsFolder: false };
    else if (req.url === '/emby/Users/u2/Items/series1') {
      if (seriesUnavailable) { res.statusCode = 404; data = {}; }
      else data = { Id: 'series1', Name: '山海故事', Type: 'Series', Overview: '整部剧的梗概', IsFolder: true, ImageTags: { Primary: 'x' },People:[{Id:'actor1',Name:'演员',Type:'Actor',Role:'主角',PrimaryImageTag:'portrait1'}] };
    }
    else if (req.url === '/emby/Users/u2/Items/movie1') data = { Id: 'movie1', Name: '系列电影第一部', Type: 'Movie', Overview: '本片简介', Collections: [{ Id: 'collection1', Name: '山海电影合集' }] };
    else if (req.url === '/emby/Users/u2/Items/collection1') data = { Id: 'collection1', Name: '山海电影合集', Type: 'BoxSet', Overview: '电影合集的梗概', IsFolder: true };
    else { res.statusCode = 404; data = {}; }
    res.end(JSON.stringify(data));
  });
  await new Promise(resolve => mock.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => mock.close(resolve)));
  const embyUrl = `http://127.0.0.1:${mock.address().port}`;
  const port = await freePort();
  const app = await startLibrary(port, root, embyUrl);
  t.after(() => app.kill());
  const login = await fetch(`http://127.0.0.1:${port}/api/emby/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: embyUrl, username: 'fixture', password: 'fixture', remember: false }) });
  assert.equal(login.status, 200);
  const localItems = (await (await fetch(`http://127.0.0.1:${port}/api/library`)).json()).items;
  assert.equal(localItems.length, 1);
  assert.equal(localItems[0].embyId, 'ep1');
  assert.equal(localItems[0].type, 'Episode');
  assert.equal(localItems[0].overview, '本集简介');
  const episodeResponse = await fetch(`http://127.0.0.1:${port}/api/emby/item/ep1`);
  assert.equal(episodeResponse.status, 200);
  const episode = await episodeResponse.json();
  assert.equal(episode.overview, '本集简介');
  assert.equal(episode.series?.overview, '整部剧的梗概');
  assert.equal(episode.peopleFromSeries,true);
  assert.equal(episode.people[0].imageTag,'portrait1');
  const portrait=await fetch(`http://127.0.0.1:${port}/art/person/actor1`);
  assert.equal(portrait.status,200);assert.equal(portrait.headers.get('content-type'),'image/png');await portrait.arrayBuffer();
  assert.equal((await fetch(`http://127.0.0.1:${port}/art/person/unknown`)).status,404);
  const works=await(await fetch(`http://127.0.0.1:${port}/api/emby/person?id=actor1`)).json();
  assert.deepEqual(works.items.map(x=>x.id),['emby-correct']);
  assert.equal(episode.series?.id, 'emby-series1');
  const movie = await (await fetch(`http://127.0.0.1:${port}/api/emby/item/movie1`)).json();
  assert.equal(movie.overview, '本片简介');
  assert.equal(movie.collection?.overview, '电影合集的梗概');
  assert.equal(requests.filter(url => url === '/emby/Users/u2/Items/series1').length, 1);
  seriesUnavailable = true;
  const fallbackResponse = await fetch(`http://127.0.0.1:${port}/api/emby/item/ep1`);
  assert.equal(fallbackResponse.status, 200);
  const fallback = await fallbackResponse.json();
  assert.equal(fallback.series, undefined);
  assert.equal(fallback.overview, '本集简介');
});
