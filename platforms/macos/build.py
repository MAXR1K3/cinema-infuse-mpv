from pathlib import Path
import shutil, json, plistlib, zipfile, struct, hashlib, re
ROOT=Path(__file__).resolve().parent; SOURCE=ROOT.parents[1]/'apps/cinema'; STAGE=ROOT/'staging'; APP=STAGE/'Cinema Infuse.app'; RES=APP/'Contents/Resources'; BIN=APP/'Contents/MacOS'
assert STAGE.resolve().parent==ROOT.resolve() and STAGE.name=='staging'
if STAGE.exists():shutil.rmtree(STAGE)
RES.mkdir(parents=True,exist_ok=True);BIN.mkdir(parents=True,exist_ok=True);(RES/'app').mkdir(exist_ok=True);(RES/'runtime').mkdir(exist_ok=True)
for source in SOURCE.iterdir():
 if source.suffix not in {'.js','.css','.html'} and source.name!='credit-localizations.json':continue
 if source.name.endswith('.test.js') or source.name in {'test-emby.js','tracked-player.js','playback-queue.js'}:continue
 shutil.copy2(source,RES/'app'/source.name)
for name in ['mac-secrets.js','infuse-player.js']:shutil.copy2(ROOT/'templates'/name,RES/'app'/name)
for name in ['launcher.cjs','stop.cjs']:shutil.copy2(ROOT/'templates'/name,RES/name)
shutil.copy2(ROOT/'templates/MPVCinema',BIN/'CinemaInfuse');shutil.copy2(ROOT/'downloads/node-arm64',RES/'runtime/node');shutil.copy2(ROOT/'downloads/NODE-LICENSE.txt',RES/'runtime/NODE-LICENSE.txt');shutil.copy2(ROOT/'downloads/runtime.json',RES/'runtime/runtime.json')
p=RES/'app/session-store.js';s=p.read_text(encoding='utf-8');a=s.index('const dpapiScript');b=s.index('function createSessionStore',a);s=s[:a]+"const {macSecrets}=require('./mac-secrets');\nfunction dpapi(mode,input){return macSecrets(mode,input);}\n\n"+s[b:];s=s.replace("const { spawn } = require('node:child_process');",'');s=s.replace('// Only the Emby access token is persisted; DPAPI binds it to the Windows user.','// Emby and DAV secrets use AES-GCM with a key kept in macOS Keychain.');p.write_text(s,encoding='utf-8',newline='\n')
p=RES/'app/server.js';s=p.read_text(encoding='utf-8');s=s.replace("const path = require('node:path');","const path = require('node:path');\nconst MAC_DATA=path.join(require('node:os').homedir(),'Library','Application Support','Cinema Infuse');")
s=s.replace("const { launchTrackedPlayer } = require('./tracked-player');","const {launchTrackedPlayer,handleInfuseCallback,serveInfuseLocal}=require('./infuse-player');")
s='\n'.join(line for line in s.splitlines() if 'createPlaybackQueue' not in line and "if(event === 'start' && context.queueId)" not in line)
lines={"const ROOT =":"const ROOT = process.env.MPV_LIBRARY_ROOT || path.join(require('node:os').homedir(),'Movies');","const MPV =":"const MPV = 'Infuse';","const HISTORY =":"const HISTORY = process.env.MPV_HISTORY || path.join(MAC_DATA,'legacy-history.jsonl');","const SESSION_FILE =":"const SESSION_FILE = process.env.MPV_EMBY_SESSION_FILE || path.join(MAC_DATA,'emby-session.json');","const USER_DATA =":"const USER_DATA = process.env.MPV_LIBRARY_USER_DATA || path.join(MAC_DATA,'user-data.json');","const WATCH_LATER=":"const WATCH_LATER=process.env.MPV_WATCH_LATER_DIR || path.join(MAC_DATA,'legacy-watch-later');"}
s='\n'.join(next((value for prefix,value in lines.items() if line.startswith(prefix)),line) for line in s.splitlines())
s=s.replace("path.join(process.env.APPDATA || __dirname,'mpv-cinema','webdav')","path.join(MAC_DATA,'webdav')").replace('Device="Windows"','Device="Mac"').replace('mpv-cinema-local','cinema-infuse-macos')
s=re.sub(r"const tracked=item.type==='Episode' \? await playbackQueue.start\([^\n]+",'const tracked=undefined;',s)
s=re.sub(r"      const child=spawn\(MPV,[^\n]+\n      await new Promise\([^\n]+",'      await launchTracked(item.path,progressContext(item,true),{startSeconds:resumeSeconds});',s)
needle="  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);"
s=s.replace(needle,needle+"\n  if(req.method==='GET' && url.pathname==='/api/health')return json(res,200,{application:'cinema-infuse-macos',nonce:process.env.CINEMA_INSTANCE_NONCE || ''});\n  if(req.method==='GET' && url.pathname==='/api/infuse/finish')return handleInfuseCallback(url,res);\n  const infuseLocal=url.pathname.match(/^\\/api\\/infuse\\/local\\/([a-f0-9-]{36})\\/[^/]+$/);\n  if(infuseLocal && ['GET','HEAD'].includes(req.method))return serveInfuseLocal(req,res,infuseLocal[1]);")
s=s.replace("const {spawn}=require('node:child_process');",'').replace("user's existing mpv","user's existing Infuse").replace('mpv Cinema','Cinema Infuse')
s=re.sub(r'\bMPV\b','INFUSE_APP',s)
a=s.index('async function watchEvents()');b=s.index('async function recentIds()',a)
s=s[:a]+"async function watchEvents(){\n const local=await progressStore.list({kind:'local'},{includeCompleted:true});\n const remote=embySession?await progressStore.list({kind:'emby',server:embyUrl,userId:embySession.userId},{includeCompleted:true}):[];\n return [...local.map(x=>({id:x.itemId,playedAt:Date.parse(x.watchedAt)})),...remote.map(x=>({id:'emby-'+x.itemId,playedAt:Date.parse(x.watchedAt)}))].filter(x=>Number.isFinite(x.playedAt)).sort((a,b)=>b.playedAt-a.playedAt).slice(0,40);\n}\n\n"+s[b:]
p.write_text(s,encoding='utf-8',newline='\n')
p=RES/'app/progress-store.js';s=p.read_text(encoding='utf-8');old='  return {startSession,poll,get,list,allowLegacy};';assert old in s
s=s.replace(old,"""  async function saveExternal(context,{positionSeconds,durationSeconds=0,sourceId=''}) {
    await init();const key=keyFor(context),prior=state.records[key] || {context,sources:{}};
    const duration=Number.isFinite(durationSeconds)&&durationSeconds>0?durationSeconds:0;
    const record={positionSeconds:duration?Math.min(positionSeconds,duration):positionSeconds,durationSeconds:duration,sourceId,paused:true,updatedAt:new Date().toISOString()};
    record.completed=isCompleted(record);prior.context=context;prior.latest=record;prior.sources[sourceId]=record;state.records[key]=prior;await persist();
    Promise.resolve(onUpdate({...context,sourceId},record,'stopped')).catch(()=>{});
  }
  return {startSession,poll,get,list,allowLegacy,saveExternal};""");p.write_text(s,encoding='utf-8',newline='\n')
for name in ['app.js','webdav-ui.js','index.html','subtitle-ui.js']:
 p=RES/'app'/name;s=p.read_text(encoding='utf-8').replace('mpv','Infuse').replace('Windows 当前用户','macOS 钥匙串').replace('请检查 Z: 盘连接','请检查设置中的本地影片目录').replace('播放中自动记忆进度','退出 Infuse 并返回后保存进度').replace('本机影库与 Emby · 使用原有 Infuse 播放配置','本机影库与 Emby · 通过 Infuse 播放');p.write_text(s,encoding='utf-8',newline='\n')
plist={'CFBundleName':'Cinema Infuse','CFBundleDisplayName':'Cinema Infuse','CFBundleIdentifier':'local.cinema.infuse','CFBundleExecutable':'CinemaInfuse','CFBundlePackageType':'APPL','CFBundleShortVersionString':'1.0.0','CFBundleVersion':'1','CFBundleDevelopmentRegion':'zh_CN','LSMinimumSystemVersion':'11.0','LSUIElement':True,'NSHighResolutionCapable':True,'CFBundleIconFile':'Cinema.icns'}
(APP/'Contents/Info.plist').write_bytes(plistlib.dumps(plist))
# Reuse the app's existing mint play mark for the Finder icon.
from PIL import Image,ImageDraw
icon=Image.new('RGBA',(1024,1024),(0,0,0,0));d=ImageDraw.Draw(icon);d.rounded_rectangle((35,35,989,989),radius=220,fill='#101d27');d.rounded_rectangle((165,165,859,859),radius=180,fill='#daeee7');d.polygon([(431,334),(431,690),(703,512)],fill='#183b42');records=[]
import io
for tag,size in [('ic08',256),('ic09',512),('ic10',1024)]:
 b=io.BytesIO();icon.resize((size,size),Image.Resampling.LANCZOS).save(b,format='PNG');data=b.getvalue();records.append(tag.encode()+struct.pack('>I',len(data)+8)+data)
data=b''.join(records);(RES/'Cinema.icns').write_bytes(b'icns'+struct.pack('>I',len(data)+8)+data)
# Helper is intentionally outside the app so it can be double-clicked in Finder.
(STAGE/'停止片库.command').write_text('#!/bin/sh\nset -eu\nHERE="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"\nAPP="$HERE/Cinema Infuse.app"\nif [ ! -d "$APP" ]; then APP="/Applications/Cinema Infuse.app"; fi\nexec "$APP/Contents/Resources/runtime/node" "$APP/Contents/Resources/stop.cjs"\n',encoding='utf-8',newline='\n')
if (ROOT/'README-使用说明.txt').exists():shutil.copy2(ROOT/'README-使用说明.txt',STAGE/'先读我.txt')
manifest={str(p.relative_to(STAGE)).replace('\\','/'):hashlib.sha256(p.read_bytes()).hexdigest() for p in STAGE.rglob('*') if p.is_file()};(STAGE/'SHA256SUMS.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
archive=ROOT.parents[1]/'dist/Cinema-Infuse-macOS-AppleSilicon.zip'
archive.parent.mkdir(parents=True,exist_ok=True)
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
 for p in STAGE.rglob('*'):
  name='Cinema Infuse macOS/'+p.relative_to(STAGE).as_posix();info=zipfile.ZipInfo(name+('/' if p.is_dir() else ''));info.create_system=3;mode=0o755 if p.is_dir() or p.name in {'CinemaInfuse','node','停止片库.command'} else 0o644;info.external_attr=((0o040000 if p.is_dir() else 0o100000)|mode)<<16;info.compress_type=zipfile.ZIP_DEFLATED;z.writestr(info,b'' if p.is_dir() else p.read_bytes())
print(json.dumps({'archive':str(archive),'bytes':archive.stat().st_size,'files':len(manifest)},ensure_ascii=False))
