// Only the Emby access token is persisted; DPAPI binds it to the Windows user.
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');

function normalizeEmbyUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) throw Error('请输入有效的 Emby 服务器地址');
  let url;
  try { url = new URL(value.trim()); } catch { throw Error('请输入有效的 Emby 服务器地址'); }
  if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw Error('Emby 地址应为 http(s) 服务器地址，不含账号、路径或参数');
  }
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && process.env.MPV_EMBY_ALLOW_HTTP !== '1') {
    throw Error('远程 Emby 登录需要 HTTPS；可信局域网 HTTP 须显式设置 MPV_EMBY_ALLOW_HTTP=1');
  }
  if (['127.0.0.1', 'localhost'].includes(url.hostname) && url.port === String(process.env.MPV_LIBRARY_PORT || 7788)) {
    throw Error('Emby 地址不能指向本机影库');
  }
  return url.origin;
}

const dpapiScript = `
Add-Type -AssemblyName System.Security
$inputText = [Console]::In.ReadToEnd()
if ($args[0] -eq 'protect') {
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($inputText)
  $out = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
  [Console]::Out.Write([Convert]::ToBase64String($out))
} else {
  $bytes = [Convert]::FromBase64String($inputText)
  $out = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
  [Console]::Out.Write([System.Text.Encoding]::UTF8.GetString($out))
}`;

function dpapi(mode, input) {
  if (process.platform !== 'win32') return Promise.reject(Error('只有 Windows 当前用户会话支持安全保存 Emby 登录'));
  return new Promise((resolve, reject) => {
    const encoded = Buffer.from(dpapiScript.replace('$args[0]', `'${mode}'`), 'utf16le').toString('base64');
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => child.kill(), 15000);
    child.stdout.on('data', chunk => { stdout += chunk; if (stdout.length > 16000) child.kill(); });
    child.stderr.on('data', chunk => { stderr += chunk; if (stderr.length > 16000) child.kill(); });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) reject(Error('Windows 凭据保护失败；请确认此用户可使用 DPAPI'));
      else resolve(stdout.trim());
    });
    child.stdin.end(input);
  });
}

function createSessionStore(file) {
  const urlFile = path.join(path.dirname(file), 'emby-server.json');
  return {
    async saveUrl(value) {
      const url = normalizeEmbyUrl(value);
      await fs.mkdir(path.dirname(urlFile), { recursive: true });
      const temp = `${urlFile}.${process.pid}.tmp`;
      try {
        await fs.writeFile(temp, JSON.stringify({ version: 1, url }), { encoding: 'utf8', mode: 0o600 });
        await fs.rename(temp, urlFile);
      } finally { await fs.rm(temp, { force: true }); }
    },
    async loadUrl() {
      try {
        const saved = JSON.parse(await fs.readFile(urlFile, 'utf8'));
        return normalizeEmbyUrl(saved.url);
      } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    },
    async save({ url, userId, name, token }) {
      const server = normalizeEmbyUrl(url);
      if (!token || !userId || !name) throw Error('Emby 会话信息不完整');
      const protectedToken = await dpapi('protect', token);
      const snapshot = JSON.stringify({ version: 1, url: server, userId, name, protectedToken }, null, 2);
      await fs.mkdir(path.dirname(file), { recursive: true });
      const temp = `${file}.${process.pid}.tmp`;
      try {
        await fs.writeFile(temp, snapshot, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        await fs.rename(temp, file);
      } finally { await fs.rm(temp, { force: true }); }
    },
    async load() {
      let saved;
      try { saved = JSON.parse(await fs.readFile(file, 'utf8')); }
      catch (error) { if (error.code === 'ENOENT') return null; throw error; }
      if (saved.version !== 1 || !saved.protectedToken || !saved.userId || !saved.name) throw Error('已保存的 Emby 会话无效');
      const url = normalizeEmbyUrl(saved.url);
      const token = await dpapi('unprotect', saved.protectedToken);
      if (!token) throw Error('无法解锁已保存的 Emby 会话');
      return { url, userId: saved.userId, name: saved.name, token };
    },
    async clear() { await fs.rm(file, { force: true }); }
  };
}
module.exports = { normalizeEmbyUrl, createSessionStore,protectSecret:value=>dpapi('protect',value),unprotectSecret:value=>dpapi('unprotect',value) };
