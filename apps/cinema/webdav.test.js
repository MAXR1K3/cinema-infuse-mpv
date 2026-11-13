const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {endpoint,safeTarget,parseListing,createWebDav}=require('./webdav');
const xml=rows=>'<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">'+rows.map(([href,dir,size=16])=>'<d:response><d:href>'+href+'</d:href><d:propstat><d:prop><d:resourcetype>'+(dir?'<d:collection/>':'')+'</d:resourcetype><d:getcontentlength>'+size+'</d:getcontentlength></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>').join('')+'</d:multistatus>';
test('DAV URLs and listings stay within the configured root and preserve Unicode filenames',()=>{
 assert.equal(endpoint('https://nas.test:5006/dav'),'https://nas.test:5006/dav/');
 assert.equal(endpoint(' dav.pikpak.ai '),'https://dav.pikpak.ai/');
 assert.equal(endpoint('nas.test:5006/dav'),'https://nas.test:5006/dav/');
 assert.equal(endpoint('http://192.168.1.2:5244/dav/'),'http://192.168.1.2:5244/dav/');
 assert.throws(()=>endpoint('https://user:secret@nas.test/dav'));
 for(const href of ['https://other.test/dav/a.mkv','/private/a','/dav/%252e%252e/a','/dav/%2fsecret'])assert.throws(()=>safeTarget('https://nas.test/dav/',href));
 const result=parseListing(xml([['/dav/',true],['/dav/Movies/',true],['/dav/%E7%94%B5%E5%BD%B1%20%26%20A.mkv',false],['/dav/note.txt',false],['/outside/private.mkv',false],['https://other.test/dav/a.mkv',false],['/dav/Movies/nested.mkv',false]]),'https://nas.test/dav/','/dav/');
 assert.equal(result.length,3);assert.equal(result[0].name,'Movies');assert.equal(result.find(x=>x.video).name,'电影 & A.mkv');
 assert.throws(()=>parseListing('<!DOCTYPE x><d:multistatus/>','https://nas.test/dav/','/dav/'));
});
test('connection, browsing, secret-free public metadata, range playback and disconnect',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'dav-test-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));const records=new Map(),calls=[];
 const storeFactory=file=>({load:async()=>records.get(file),save:async value=>records.set(file,value),clear:async()=>records.delete(file)});
 const request=async(url,options)=>{calls.push({url:String(url),options});if(options.method==='PROPFIND')return new Response(xml([['/dav/',true],['/dav/Movies/',true],['/dav/A.mkv',false],['/dav/info.txt',false]]),{status:207});return new Response('tail',{status:206,headers:{'content-range':'bytes 12-15/16'}});};
 const service=createWebDav({directory,storeFactory,request});const listing=await service.connect({name:'NAS',url:'https://nas.test/dav/',username:'me',password:'secret',remember:true});const id=listing.connection.id;
 assert.equal(records.size,1);assert.ok(!JSON.stringify(await service.list()).includes('secret'));assert.ok(!JSON.stringify(listing).includes('secret'));assert.equal(calls[0].options.headers.get('Authorization'),'Basic '+Buffer.from('me:secret').toString('base64'));
 await assert.rejects(service.prepare(id,'/dav/info.txt'));await assert.rejects(service.prepare(id,'/dav/unknown.mkv'));
 const prepared=await service.prepare(id,'/dav/A.mkv');assert.equal(prepared.context.itemId,'/dav/A.mkv');const response=await service.stream(prepared.key,'bytes=12-15');assert.equal(response.status,206);assert.equal(await response.text(),'tail');assert.equal(calls.at(-1).options.headers.get('Range'),'bytes=12-15');assert.equal(calls.at(-1).options.signal.aborted,false);
 await service.disconnect(id);assert.equal(records.size,0);await assert.rejects(service.stream(prepared.key));assert.deepEqual(await service.list(),[]);
});
test('cross-origin CDN redirects never receive DAV credentials',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'dav-cdn-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));let cdnHeaders;
 const service=createWebDav({directory,request:async(url,options)=>{if(options.method==='PROPFIND')return new Response(xml([['/dav/A.mkv',false]]),{status:207});if(String(url).includes('nas.test'))return new Response(null,{status:302,headers:{location:'https://cdn.test/file'}});cdnHeaders=new Headers(options.headers);return new Response('video');}});
 const {connection}=await service.connect({url:'https://nas.test/dav/',username:'me',password:'private'});const ticket=await service.prepare(connection.id,'/dav/A.mkv');assert.equal(await(await service.stream(ticket.key)).text(),'video');assert.equal(cdnHeaders.has('Authorization'),false);
});
test('remembered HTTP DAV credentials use their own encrypted vault and restore without Emby policy changes',async t=>{
 if(process.platform!=='win32')return t.skip('Windows DPAPI');const directory=await fs.mkdtemp(path.join(os.tmpdir(),'dav-vault-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));const request=async()=>new Response(xml([['/dav/A.mkv',false]]),{status:207});
 const service=createWebDav({directory,request});const {connection}=await service.connect({name:'Private NAS',url:'http://192.168.1.2/dav/',username:'viewer',password:'not-plaintext',remember:true});
 const file=await fs.readFile(path.join(directory,connection.id+'.json'),'utf8');assert.ok(!file.includes('not-plaintext'));assert.ok(!file.includes('viewer'));
 const restarted=createWebDav({directory,request});const restored=await restarted.list();assert.equal(restored[0].url,'http://192.168.1.2/dav/');assert.equal(restored[0].username,'viewer');assert.equal((await restarted.browse(connection.id)).items[0].name,'A.mkv');
});
test('directory artwork uses only listed safe image files and keeps credentials server-side',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'dav-art-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));let gets=0;
 const service=createWebDav({directory,request:async(url,options)=>{if(options.method==='PROPFIND'){return new Response(String(url).endsWith('/Movie/')?xml([['/dav/Movie/poster.jpg',false],['/dav/Movie/A.mkv',false]]):xml([['/dav/Movie/',true]]),{status:207});}gets++;assert.equal(String(url),'https://nas.test/dav/Movie/poster.jpg');return new Response('jpeg',{headers:{'content-type':'image/jpeg'}});}});
 const {connection}=await service.connect({url:'https://nas.test/dav/'});const art=await service.artwork(connection.id,'/dav/Movie/');assert.equal(art.type,'image/jpeg');assert.equal(art.bytes.toString(),'jpeg');assert.equal(gets,1);assert.equal(await service.artwork(connection.id,'/dav/unknown/'),null);
});

test('CDN resolution is reused for seeks and refreshed once when a signed URL expires',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'dav-resolve-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));let resolves=0,expired=false;const calls=[];
 const service=createWebDav({directory,request:async(url,options)=>{calls.push({url:String(url),options});if(options.method==='PROPFIND')return new Response(xml([['/dav/A.mkv',false]]),{status:207});if(new URL(url).hostname==='nas.test'){resolves++;return new Response(null,{status:302,headers:{location:'https://cdn.test/file?version='+resolves}});}if(expired&&String(url).endsWith('version=1'))return new Response(null,{status:403});return new Response('ok',{status:206});}});
 const {connection}=await service.connect({url:'https://nas.test/dav/',username:'viewer',password:'secret'}),ticket=await service.prepare(connection.id,'/dav/A.mkv');
 await(await service.stream(ticket.key,'bytes=0-1')).text();await(await service.stream(ticket.key,'bytes=10-11')).text();assert.equal(resolves,1,'seeks must reuse resolved CDN address');
 expired=true;await(await service.stream(ticket.key,'bytes=20-21')).text();assert.equal(resolves,2,'expired CDN URL must re-resolve');for(const c of calls.filter(x=>new URL(x.url).hostname==='cdn.test'))assert.equal(new Headers(c.options.headers).has('authorization'),false);
});
test('browsed folders are reused for artwork, concurrent directory reads coalesce and refresh is explicit',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'dav-dir-cache-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));let reads=0;
 const service=createWebDav({directory,request:async(url,options)=>{assert.equal(options.method,'PROPFIND');reads++;await new Promise(r=>setImmediate(r));return new Response(String(url).endsWith('/Movie/')?xml([['/dav/Movie/A.mkv',false]]):xml([['/dav/Movie/',true]]),{status:207});}});
 const {connection}=await service.connect({url:'https://nas.test/dav/'});await Promise.all([service.browse(connection.id,'/dav/Movie/'),service.browse(connection.id,'/dav/Movie/')]);assert.equal(reads,2);await service.artwork(connection.id,'/dav/Movie/');assert.equal(reads,2);await service.browse(connection.id,'/dav/Movie/',{refresh:true});assert.equal(reads,3);
});
test('closing a player request aborts upstream even before response headers arrive',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'dav-abort-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));let started,signal;const ready=new Promise(r=>started=r);
 const service=createWebDav({directory,request:async(url,options)=>{if(options.method==='PROPFIND')return new Response(xml([['/dav/A.mkv',false]]),{status:207});signal=options.signal;started();return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));}});
 const {connection}=await service.connect({url:'https://nas.test/dav/'}),ticket=await service.prepare(connection.id,'/dav/A.mkv'),controller=new AbortController();const pending=service.stream(ticket.key,'bytes=0-1','GET',{signal:controller.signal});await ready;controller.abort();assert.equal(signal.aborted,true);await assert.rejects(pending);
});
