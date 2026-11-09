const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),{execFile}=require('node:child_process'),{promisify}=require('node:util');
const run=promisify(execFile);
function settings(home=os.homedir()){
 const directory=path.join(home,'Library','Application Support','Cinema Infuse');
 fs.mkdirSync(directory,{recursive:true,mode:0o700});const file=path.join(directory,'config.json');
 if(!fs.existsSync(file))fs.writeFileSync(file,JSON.stringify({libraryRoot:path.join(home,'Movies'),port:7788},null,2),{mode:0o600});
 const config=JSON.parse(fs.readFileSync(file,'utf8'));if(!Number.isInteger(config.port)||config.port<1024||config.port>65535)throw Error('config.json 的 port 应为 1024–65535 的整数');
 const libraryRoot=config.libraryRoot?.startsWith('~/')?path.join(home,config.libraryRoot.slice(2)):config.libraryRoot;
 if(typeof libraryRoot!=='string'||!path.isAbsolute(libraryRoot))throw Error('config.json 的 libraryRoot 应为绝对目录');
 return {directory,config:{...config,libraryRoot},file};
}
async function health(origin){try{const response=await fetch(origin+'/api/health',{signal:AbortSignal.timeout(1200)});const info=await response.json();return info.application==='cinema-infuse-macos'?info:null;}catch{return null;}}
function staleLock(owner,modified,now=Date.now(),alive=pid=>{try{process.kill(pid,0);return true;}catch(error){return error.code!=='ESRCH';}}){return Number.isInteger(owner?.pid)&&owner.pid>0?!alive(owner.pid):now-modified>30000;}
async function alert(message){try{await run('/usr/bin/osascript',['-e','on run argv\ndisplay alert "Cinema Infuse" message (item 1 of argv) as warning\nend run',message]);}catch{console.error(message);}}
async function main(){
 if(process.platform!=='darwin')throw Error('此应用包需要 macOS');
 const {directory,config}=settings(),origin=`http://127.0.0.1:${config.port}`;
 if(await health(origin)){await run('/usr/bin/open',[origin]);return;}
 const lock=path.join(directory,'service.lock');let acquired=false;
 try{fs.mkdirSync(lock);acquired=true;}catch(error){if(error.code!=='EEXIST')throw error;let old;try{old=JSON.parse(fs.readFileSync(path.join(lock,'owner.json'),'utf8'));}catch{}
  if(staleLock(old,fs.statSync(lock).mtimeMs)){fs.rmSync(path.join(lock,'owner.json'),{force:true});fs.rmdirSync(lock);fs.mkdirSync(lock);acquired=true;}
  else{for(let i=0;i<50;i++){if(await health(origin)){await run('/usr/bin/open',[origin]);return;}await new Promise(resolve=>setTimeout(resolve,100));}throw Error('片库正在启动或已有进程占用锁，请查看 logs/server.log。不要重复启动。');}
 }
 if(!acquired)return;
 const nonce=crypto.randomUUID(),owner={pid:process.pid,nonce,port:config.port};fs.writeFileSync(path.join(lock,'owner.json'),JSON.stringify(owner),{mode:0o600});
 const cleanup=()=>{try{const saved=JSON.parse(fs.readFileSync(path.join(lock,'owner.json'),'utf8'));if(saved.nonce===nonce){fs.unlinkSync(path.join(lock,'owner.json'));fs.rmdirSync(lock);}}catch{}};
 process.once('exit',cleanup);process.once('SIGTERM',()=>process.exit(0));process.once('SIGINT',()=>process.exit(0));
 Object.assign(process.env,{MPV_LIBRARY_ROOT:config.libraryRoot,MPV_EXE:'Infuse',MPV_HISTORY:path.join(directory,'legacy-history.jsonl'),MPV_LIBRARY_PORT:String(config.port),MPV_EMBY_URL:'https://example.invalid',MPV_EMBY_SESSION_FILE:path.join(directory,'emby-session.json'),MPV_LIBRARY_USER_DATA:path.join(directory,'user-data.json'),MPV_PROGRESS_DIR:path.join(directory,'playback-progress'),MPV_WEBDAV_DIRECTORY:path.join(directory,'webdav'),MPV_WATCH_LATER_DIR:path.join(directory,'legacy-watch-later'),CINEMA_INSTANCE_NONCE:nonce});
 if(config.allowLanHttp===true)process.env.MPV_EMBY_ALLOW_HTTP='1';
 const logDir=path.join(directory,'logs');fs.mkdirSync(logDir,{recursive:true,mode:0o700});const log=fs.createWriteStream(path.join(logDir,'server.log'),{flags:'a',mode:0o600});console.log=(...args)=>log.write(args.join(' ')+'\n');console.error=(...args)=>log.write(args.map(x=>x?.stack || String(x)).join(' ')+'\n');
 process.on('uncaughtException',error=>{console.error(error);alert('片库服务启动或运行失败。请查看 ~/Library/Application Support/Cinema Infuse/logs/server.log').finally(()=>process.exit(1));});
 require('./app/server.js');
 for(let i=0;i<100;i++){const info=await health(origin);if(info?.nonce===nonce){await run('/usr/bin/open',[origin]);return;}await new Promise(resolve=>setTimeout(resolve,100));}
 throw Error('片库未能启动。请检查端口是否占用，并查看日志。');
}
module.exports={settings,health,staleLock};if(require.main===module)main().catch(error=>alert(error.message).finally(()=>process.exit(1)));
