const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function freePort() {
  const socket = http.createServer(); await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve)); return port;
}
async function startApp(port, dir, embyUrl) {
  const child = spawn(process.execPath, ['server.js'], { cwd: __dirname, windowsHide: true,
    env: { ...process.env, MPV_LIBRARY_ROOT: path.join(dir, 'empty-movies'), MPV_LIBRARY_PORT: String(port),
      MPV_EMBY_URL: embyUrl, MPV_LIBRARY_USER_DATA: path.join(dir, 'user.json'), MPV_EMBY_SESSION_FILE: path.join(dir, 'emby-session.json') }, stdio: 'ignore' });
  for (let attempt = 0; attempt < 80; attempt++) {
    if (child.exitCode !== null) throw Error('Library process exited');
    try { const response = await fetch(`http://127.0.0.1:${port}/api/library`); if (response.ok) return child; }
    catch { await delay(75); }
  }
  child.kill(); throw Error('Library did not start');
}
async function post(port, route, payload) {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  return { status: response.status, body: await response.json() };
}

test('remembered Emby connection restores after process restart and logout removes protected token', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mpv-emby-integration-'));
  await fs.mkdir(path.join(dir, 'empty-movies'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const mock = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/emby/Users/AuthenticateByName') {
      res.end(JSON.stringify({ AccessToken: 'secret-not-in-file', User: { Id: 'u1', Name: 'Viewer' } }));
    } else if (req.url === '/emby/Users/u1/Views') {
      if (req.headers['x-emby-token'] !== 'secret-not-in-file') { res.statusCode = 401; res.end('{}'); }
      else res.end(JSON.stringify({ Items: [{ Id: 'movies', Name: '电影', CollectionType: 'movies' }] }));
    } else if (req.url.startsWith('/emby/Users/u1/Items?')) res.end(JSON.stringify({ Items: [], TotalRecordCount: 0 }));
    else if (req.url === '/emby/Sessions/Logout') res.end('{}');
    else { res.statusCode = 404; res.end('{}'); }
  });
  await new Promise(resolve => mock.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => mock.close(resolve)));
  const embyUrl = `http://127.0.0.1:${mock.address().port}`;
  const port = await freePort();
  let app = await startApp(port, dir, 'https://unused.invalid');
  t.after(() => app.kill());
  let result = await post(port, '/api/emby/login', { url: embyUrl, username: 'viewer', password: 'test-only', remember: true });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.remembered, true);
  const file = path.join(dir, 'emby-session.json');
  const raw = await fs.readFile(file, 'utf8');
  assert.equal(raw.includes('secret-not-in-file'), false);
  assert.equal(raw.includes('test-only'), false);
  app.kill(); await new Promise(resolve => app.once('exit', resolve));
  app = await startApp(port, dir, 'https://unused.invalid');
  result = { status: 200, body: await (await fetch(`http://127.0.0.1:${port}/api/library`)).json() };
  assert.equal(result.body.emby.connected, true);
  assert.equal(result.body.emby.url, embyUrl);
  assert.equal(result.body.emby.remembered, true);
  result = await post(port, '/api/emby/logout', {});
  assert.equal(result.status, 200);
  await assert.rejects(fs.stat(file), { code: 'ENOENT' });
  app.kill(); await new Promise(resolve => app.once('exit', resolve));
  app = await startApp(port, dir, 'https://unused.invalid');
  const loggedOut = await (await fetch(`http://127.0.0.1:${port}/api/library`)).json();
  assert.equal(loggedOut.emby.connected, false);
  assert.equal(loggedOut.emby.url, embyUrl);
  result = await post(port, '/api/emby/login', { url: embyUrl, username: 'viewer', password: 'test-only', remember: false });
  assert.equal(result.status, 200);
  assert.equal(result.body.remembered, false);
  await assert.rejects(fs.stat(file), { code: 'ENOENT' });
  app.kill(); await new Promise(resolve => app.once('exit', resolve));
  app = await startApp(port, dir, 'https://unused.invalid');
  const sessionOnly = await (await fetch(`http://127.0.0.1:${port}/api/library`)).json();
  assert.equal(sessionOnly.emby.connected, false);
  assert.equal(sessionOnly.emby.url, embyUrl);
});
