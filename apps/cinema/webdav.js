const fs=require('node:fs/promises'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {protectSecret,unprotectSecret}=require('./session-store');
function createDavVault(file){return {
 async load(){const saved=JSON.parse(await fs.readFile(file,'utf8'));return JSON.parse(await unprotectSecret(saved.protectedValue));},
 async save(value){const protectedValue=await protectSecret(JSON.stringify(value));await fs.mkdir(path.dirname(file),{recursive:true});const temporary=file+'.'+randomUUID()+'.tmp';try{await fs.writeFile(temporary,JSON.stringify({version:1,protectedValue}),'utf8');await fs.rename(temporary,file);}finally{await fs.rm(temporary,{force:true});}},
 async clear(){await fs.rm(file,{force:true});}
};}
const {chooseDavPoster}=require('./webdav-posters');
const {readPosterImage}=require('./poster-image');
const VIDEO=/\.(mkv|mp4|m4v|mov|avi|ts|m2ts|webm|wmv|mpg|mpeg)$/i;
function endpoint(value){
 let address=String(value || '').trim();if(!address.includes('://'))address='https://'+address;
 let url;try{url=new URL(address);}catch{throw Error('请输入有效的 WebDAV 域名或完整地址');}
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw Error('地址只支持 HTTP/HTTPS，请在账号栏填写登录信息');
 if(!url.pathname.endsWith('/'))url.pathname+='/';return url.href;
}
const unxml=s=>s.replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi,x=>{const key=x.slice(1,-1),named={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"};if(named[key])return named[key];const n=key[1]?.toLowerCase()==='x'?parseInt(key.slice(2),16):parseInt(key.slice(1),10);return n>0 && n<=0x10ffff?String.fromCodePoint(n):'';});
const tag=(xml,name)=>xml.match(new RegExp('<(?:[\\w-]+:)?'+name+'\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w-]+:)?'+name+'>','i'))?.[1] || '';
function safeTarget(base,href){
 const root=new URL(endpoint(base)),url=new URL(href,root);
 if(url.origin!==root.origin||url.username||url.password||url.search||url.hash||!url.pathname.startsWith(root.pathname))throw Error('路径超出此连接的目录');
 // Encoded path separators and double encoding can be reinterpreted by upstream servers.
 for(const segment of url.pathname.split('/')){let decoded;try{decoded=decodeURIComponent(segment);}catch{throw Error('路径编码无效');}if(decoded==='.'||decoded==='..'||/[\\/\x00-\x1f]/.test(decoded)||/%(?:2e|2f|5c|25)/i.test(decoded))throw Error('路径编码无效');}
 return url;
}
function parseListing(xml,base,current){
 if(/<!DOCTYPE|<!ENTITY/i.test(xml))throw Error('不支持的 WebDAV XML 响应');
 if(!/<(?:[\w-]+:)?multistatus\b/i.test(xml))throw Error('服务器没有返回 WebDAV 目录，请检查 WebDAV 地址');
 const target=safeTarget(base,current),items=new Map();
 for(const response of xml.matchAll(/<(?:[\w-]+:)?response\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?response>/gi)){
  const href=unxml(tag(response[1],'href').trim());if(!href)continue;
  let url;try{url=safeTarget(base,new URL(href,target).href);}catch{continue;}
  const own=target.pathname.replace(/\/$/,''),child=url.pathname.replace(/\/$/,'');
  if(child===own||!child.startsWith(own+'/')||child.slice(own.length+1).includes('/'))continue;
  const propstats=[...response[1].matchAll(/<(?:[\w-]+:)?propstat\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?propstat>/gi)];
  const props=propstats.filter(p=>/\s200(?:\s|$)/.test(tag(p[1],'status'))).map(p=>tag(p[1],'prop')).join('');if(!props)continue;
  const directory=/<(?:[\w-]+:)?collection\b/i.test(props),name=decodeURIComponent(child.split('/').at(-1));
  const rawSize=tag(props,'getcontentlength').trim(),size=/^\d+$/.test(rawSize)?Number(rawSize):null;
  const modified=Date.parse(unxml(tag(props,'getlastmodified')));
  items.set(url.pathname,{path:url.pathname,name,directory,video:!directory && VIDEO.test(name),size,modified:Number.isFinite(modified)?new Date(modified).toISOString():''});
 }
 return [...items.values()].sort((a,b)=>Number(b.directory)-Number(a.directory)||a.name.localeCompare(b.name,'zh-CN',{numeric:true}));
}
async function boundedText(response){let text='',size=0;for await(const chunk of response.body){size+=chunk.length;if(size>5*1024*1024)throw Error('目录内容过大，请打开更小的子目录');text+=Buffer.from(chunk).toString('binary');}return Buffer.from(text,'binary').toString('utf8');}
function createWebDav({directory,storeFactory=createDavVault,request=fetch}={}){
 const connections=new Map(),tickets=new Map();let initialized;
 const publicConnection=c=>({id:c.id,name:c.name,url:c.url,username:c.username,remembered:c.remembered});
 function store(id){return storeFactory(path.join(directory,id+'.json'));}
 async function init(){if(!initialized)initialized=(async()=>{await fs.mkdir(directory,{recursive:true});for(const name of await fs.readdir(directory)){if(!/^[\da-f-]{36}\.json$/.test(name))continue;try{const saved=await store(name.slice(0,-5)).load();if(!saved)continue;const c=JSON.parse(saved.token);c.url=endpoint(c.url);c.remembered=true;c.entries=new Map();connections.set(c.id,c);}catch{/* An invalid credential file never exposes its contents. */}}})();return initialized;}
 const get=id=>{const c=connections.get(id);if(!c)throw Error('连接已断开，请重新选择');return c;};
 async function headerRequest(url,options){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);const signal=options.signal?AbortSignal.any([options.signal,controller.signal]):controller.signal;try{return await request(url,{...options,signal});}finally{clearTimeout(timer);}}
 async function remote(c,url,options={}){
  const headers=new Headers(options.headers);if(c.username||c.password)headers.set('Authorization','Basic '+Buffer.from(c.username+':'+c.password).toString('base64'));
  const optionsWithHeaders={...options,headers,redirect:'manual'};
  const response=options.method==='PROPFIND'?await request(url,{...optionsWithHeaders,signal:AbortSignal.timeout(20000)}):await headerRequest(url,optionsWithHeaders);
  if(response.status===401||response.status===403){await response.body?.cancel();throw Error('连接被拒绝，请检查账号、密码和目录权限');}
  return response;
 }
 async function browseConnection(c,current,{refresh=false}={}){
  const url=safeTarget(c.url,current || c.url);if(!url.pathname.endsWith('/'))url.pathname+='/';
  c.directories ||= new Map();const previous=c.directories.get(url.pathname);
  if(previous && (!previous.settled || !refresh && previous.expires>Date.now()))return previous.promise;
  const cached={expires:Date.now()+60000,settled:false};c.directories.set(url.pathname,cached);
  cached.promise=readDirectory(c,url).then(result=>{cached.settled=true;return result;},error=>{if(c.directories.get(url.pathname)===cached)c.directories.delete(url.pathname);throw error;});
  while(c.directories.size>128)c.directories.delete(c.directories.keys().next().value);
  return cached.promise;
 }
 async function readDirectory(c,url){
  const response=await remote(c,url,{method:'PROPFIND',headers:{Depth:'1','Content-Type':'application/xml; charset=utf-8'},body:'<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontentlength/><d:getlastmodified/></d:prop></d:propfind>'});
  if(response.status!==207){await response.body?.cancel();throw Error(response.status>=300&&response.status<400?'目录地址发生跳转，请填写最终 WebDAV 地址':`无法读取 WebDAV 目录（HTTP ${response.status}）`);}
  const items=parseListing(await boundedText(response),c.url,url.href);
  for(const item of items)c.entries.set(item.path,item);while(c.entries.size>20000)c.entries.delete(c.entries.keys().next().value);
  const root=new URL(c.url).pathname,relative=url.pathname.slice(root.length).split('/').filter(Boolean),breadcrumbs=[{name:c.name,path:root}];let cursor=root;
  for(const segment of relative){cursor+=segment+'/';breadcrumbs.push({name:decodeURIComponent(segment),path:cursor});}
  return {connection:publicConnection(c),path:url.pathname,breadcrumbs,items};
 }
 async function remoteFile(c,url,range,method='GET',{signal,cache}={}){
  const original=url;const headers=range?{Range:range}:{};let response;
  if(cache?.target && cache.target.expires>Date.now()){
   url=new URL(cache.target.url);response=await headerRequest(url,{method,headers,signal,redirect:'manual'});
   if([401,403,404,410].includes(response.status)){await response.body?.cancel();delete cache.target;url=original;response=null;}
  }
  if(!response)response=await remote(c,url,{method,headers,signal});
   for(let i=0;i<4 && [301,302,303,307,308].includes(response.status);i++){
    const location=response.headers.get('location');await response.body?.cancel();if(!location)throw Error('播放跳转地址缺失');const next=new URL(location,url);if(!['http:','https:'].includes(next.protocol)||next.username||next.password||(url.protocol==='https:'&&next.protocol!=='https:'))throw Error('不支持的播放跳转');
    // Credentials belong only to this DAV endpoint, never to a CDN or an unrelated path.
    url=next;let authenticated=false;try{safeTarget(c.url,url.href);authenticated=true;}catch{}
    response=authenticated?await remote(c,url,{method,headers,signal}):await headerRequest(url,{method,headers,signal,redirect:'manual'});
   }
  // Only cache unauthenticated CDN targets in memory. DAV passwords never leave their root.
  if(cache && [200,206].includes(response.status) && url.href!==original.href){let authenticated=false;try{safeTarget(c.url,url.href);authenticated=true;}catch{}if(!authenticated)cache.target={url:url.href,expires:Date.now()+60000};}
  return response;
 }
 return {
  async list(){await init();return [...connections.values()].map(publicConnection);},
  async connect(input){await init();if(connections.size>=20)throw Error('最多保存 20 个连接，请先断开不用的连接');const c={id:randomUUID(),name:String(input.name || 'WebDAV').trim().slice(0,80),url:endpoint(input.url),username:String(input.username || '').slice(0,256),password:String(input.password || ''),remembered:input.remember===true,entries:new Map()};if(c.password.length>4096)throw Error('密码过长');const listing=await browseConnection(c,c.url);if(c.remembered)await store(c.id).save({url:new URL(c.url).origin,userId:c.id,name:c.name,token:JSON.stringify({...c,entries:undefined})});connections.set(c.id,c);return listing;},
  async browse(id,current,options){await init();const c=get(id),result=await browseConnection(c,current,options);if(connections.get(id)!==c)throw Error('连接已断开');return result;},
  async entry(id,file){await init();const entry=get(id).entries.get(file);if(!entry || (!entry.directory && !entry.video))throw Error('影片不在当前目录中');return {...entry};},
  async artwork(id,file){
   await init();const c=get(id),entry=c.entries.get(file);if(!entry || (!entry.directory && !entry.video))return null;
   let siblings;
   if(entry.directory){siblings=(await browseConnection(c,file)).items;}
   else{const parent=file.slice(0,file.lastIndexOf('/')+1);siblings=[...c.entries.values()].filter(x=>x.path.slice(0,x.path.lastIndexOf('/')+1)===parent);}
   if(connections.get(id)!==c)return null;const image=chooseDavPoster(entry,siblings);if(!image)return null;
   const response=await remoteFile(c,safeTarget(c.url,image.path));
   const coverData=await readPosterImage(response);
   if(connections.get(id)!==c)return null;return coverData;
  },
  async disconnect(id){await init();get(id);await store(id).clear();connections.delete(id);for(const [key,t]of tickets)if(t.id===id)tickets.delete(key);},
  async prepare(id,file){await init();const c=get(id),entry=c.entries.get(file);if(!entry?.video)throw Error('请先浏览目录并选择视频文件');const key=randomUUID();for(const [k,t]of tickets)if(t.expires<Date.now())tickets.delete(k);if(tickets.size>=200)tickets.delete(tickets.keys().next().value);tickets.set(key,{id,file,expires:Date.now()+24*3600000});return {key,entry,context:{kind:'webdav',server:c.url,userId:c.username,itemId:file,title:entry.name}};},
  async stream(key,range,method='GET',{signal}={}){
   const ticket=tickets.get(key);if(!ticket||ticket.expires<Date.now())throw Error('播放连接已过期，请重新打开影片');const c=get(ticket.id);const response=await remoteFile(c,safeTarget(c.url,ticket.file),range,method,{signal,cache:ticket});

   return response;
  }
 };
}
module.exports={endpoint,safeTarget,parseListing,createWebDav};
