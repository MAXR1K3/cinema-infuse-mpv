const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { normalizeEmbyUrl, createSessionStore } = require('./session-store');

test('Emby URL accepts a server origin, strips its trailing slash, and rejects embedded credentials or paths', () => {
  assert.equal(normalizeEmbyUrl(' https://media.example.org:8920/ '), 'https://media.example.org:8920');
  for (const value of ['ftp://example.org', 'https://a:b@example.org', 'https://example.org/emby', 'https://example.org/?token=x', 'not-a-url', 'http://localhost:7788', 'http://media.example.org']) {
    assert.throws(() => normalizeEmbyUrl(value));
  }
});

test('persisted Emby session survives a new store instance without plaintext token; clearing removes it', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mpv-session-'));
  const file = path.join(dir, 'session.json');
  try {
    const store = createSessionStore(file);
    await store.save({ url: 'https://media.example.org', userId: 'user-1', name: 'Viewer', token: 'a-test-token-never-in-file' });
    const raw = await fs.readFile(file, 'utf8');
    assert.equal(raw.includes('a-test-token-never-in-file'), false);
    assert.equal(raw.includes('"password"'), false);
    assert.equal((await createSessionStore(file).load()).token, 'a-test-token-never-in-file');
    await store.clear();
    assert.equal(await createSessionStore(file).load(), null);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('server address remains saved when the login session is cleared', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mpv-server-url-'));
  const file = path.join(dir, 'session.json');
  try {
    await createSessionStore(file).saveUrl('https://media.example.org');
    await createSessionStore(file).clear();
    assert.equal(await createSessionStore(file).loadUrl(), 'https://media.example.org');
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
