const {execFile}=require('node:child_process'),{promisify}=require('node:util'),{randomUUID}=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const run=promisify(execFile);
function makePlayLink(media,{filename='',position=0,success,error}={}){const url=new URL('infuse://x-callback-url/play');url.searchParams.set('url',media);url.searchParams.set('position',String(Math.max(0,Math.floor(position || 0))));if(filename)url.searchParams.set('filename',filename);if(success)url.searchParams.set('x-success',success);if(error)url.searchParams.set('x-error',error);return url.href;}
function createInfusePlayer({open=url=>run('/usr/bin/open',[url]),origin=()=>`http://127.0.0.1:${process.env.MPV_LIBRARY_PORT || 7788}`,now=Date.now}={}){
 const tickets=new Map();
 function prune(){for(const [key,t]of tickets)if(t.expires<now())tickets.delete(key);if(tickets.size>=100)tickets.delete(tickets.keys().next().value);}
 async function launch({media,context,store,sourceId='',startSeconds=0}){
  prune();const key=randomUUID(),ticket={media,context,store,sourceId,expires:now()+86400000};let stream=media;
  if(!/^https?:\/\//i.test(media)){if(!path.isAbsolute(media))throw Error('本地影片路径无效');ticket.local=media;stream=origin()+'/api/infuse/local/'+key+'/'+encodeURIComponent(path.basename(media));}
  else{const url=new URL(media);if(url.origin!==origin() || url.username || url.password)throw Error('播放链接必须来自本机片库代理');}
  ticket.stream=stream;tickets.set(key,ticket);
  const callback=origin()+'/api/infuse/finish?ticket='+key;
  try{await open(makePlayLink(stream,{filename:context.item?.title || context.title || path.basename(media),position:startSeconds,success:callback,error:callback+'&failed=1'}));}
  catch{tickets.delete(key);throw Error('无法打开 Infuse，请先安装并启动一次 Infuse 后重试');}
  return {id:key};
 }
 async function callback(url,res){
  const key=url.searchParams.get('ticket'),ticket=tickets.get(key);if(!ticket || ticket.expires<now()){res.writeHead(404);res.end('Playback callback expired');return;}
  if(!ticket.handled && !url.searchParams.has('failed')){
   if(url.searchParams.get('lastPlayedUrl')!==ticket.stream){res.writeHead(400);res.end('Playback URL does not match');return;}
   const raw=url.searchParams.get('position'),position=raw===null?NaN:Number(raw);if(!Number.isFinite(position)||position<0||position>1e7){res.writeHead(400);res.end('Invalid playback position');return;}
   const duration=Number(ticket.context.item?.durationSeconds || ticket.context.durationSeconds || 0);
   await ticket.store.saveExternal(ticket.context,{positionSeconds:position,durationSeconds:duration,sourceId:ticket.sourceId});
   ticket.handled=true;
  }
  // Keep local media tickets alive: Infuse may still finish outstanding reads after returning.
  ticket.expires=now()+600000;
  res.writeHead(303,{Location:origin()+'/','Cache-Control':'no-store','Referrer-Policy':'no-referrer'});res.end();
 }
 async function local(req,res,key){const ticket=tickets.get(key);if(!ticket?.local || ticket.expires<now()){res.writeHead(404);return res.end();}const stat=await fs.promises.stat(ticket.local);let start=0,end=stat.size-1,status=200;const headers={'Content-Type':'application/octet-stream','Accept-Ranges':'bytes','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
  if(req.headers.range){const match=req.headers.range.match(/^bytes=(\d*)-(\d*)$/);if(!match || !match[1]&&!match[2]){res.writeHead(416,{'Content-Range':`bytes */${stat.size}`});return res.end();}if(!match[1])start=Math.max(0,stat.size-Number(match[2]));else{start=Number(match[1]);if(match[2])end=Math.min(Number(match[2]),end);}if(start>end || start>=stat.size){res.writeHead(416,{'Content-Range':`bytes */${stat.size}`});return res.end();}status=206;headers['Content-Range']=`bytes ${start}-${end}/${stat.size}`;}
  headers['Content-Length']=Math.max(0,end-start+1);res.writeHead(status,headers);if(req.method==='HEAD'||!stat.size)return res.end();const stream=fs.createReadStream(ticket.local,{start,end});stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);
 }
 return {launch,callback,local};
}
const player=createInfusePlayer();module.exports={makePlayLink,createInfusePlayer,launchTrackedPlayer:options=>player.launch(options),handleInfuseCallback:(url,res)=>player.callback(url,res),serveInfuseLocal:(req,res,key)=>player.local(req,res,key)};
