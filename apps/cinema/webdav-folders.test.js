const test=require('node:test'),assert=require('node:assert/strict');const {createDavFolderService}=require('./webdav-folders');
test('real DAV browsing registers nested files for direct playback without a manual folder click',async t=>{
 const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');const directory=await fs.mkdtemp(path.join(os.tmpdir(),'dav-auto-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const graph={'/dav/':[['/dav/Movie/',true]],'/dav/Movie/':[['/dav/Movie/Film.mkv',false]]};
 const webdav=require('./webdav').createWebDav({directory,request:async url=>new Response('<d:multistatus xmlns:d="DAV:">'+(graph[new URL(url).pathname] || []).map(([href,dir])=>'<d:response><d:href>'+href+'</d:href><d:propstat><d:prop><d:resourcetype>'+(dir?'<d:collection/>':'')+'</d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>').join('')+'</d:multistatus>',{status:207})});
 const listing=await webdav.connect({url:'https://nas.test/dav/'}),id=listing.connection.id;await assert.rejects(webdav.prepare(id,'/dav/Movie/Film.mkv'));
 const result=await createDavFolderService({webdav}).get(id,'/dav/Movie/');assert.equal(result.items.length,1);assert.equal((await webdav.prepare(id,result.items[0].path)).entry.path,'/dav/Movie/Film.mkv');
 await webdav.disconnect(id);await assert.rejects(createDavFolderService({webdav}).get(id,'/dav/Movie/'));
});
test('folder discovery registers child videos, coalesces reads and preserves direct file identities',async()=>{
 let reads=0;const data={'/Movie/':[{path:'/Movie/Movie.mkv',name:'Movie.mkv',video:true,directory:false}]};
 const webdav={entry:async(id,path)=>({path,name:'Movie',directory:true}),browse:async(id,path)=>{reads++;return {items:data[path] || []};}};
 const service=createDavFolderService({webdav});const [one,two]=await Promise.all([service.get('a','/Movie/'),service.get('a','/Movie/')]);assert.equal(reads,1);assert.equal(one.items[0].path,'/Movie/Movie.mkv');assert.equal(one.complete,true);assert.deepEqual(one,two);
 await service.get('a','/Movie/');assert.equal(reads,1);await service.get('b','/Movie/');assert.equal(reads,2);await service.get('a','/Movie/',{refresh:true});assert.equal(reads,3);
});
test('nested seasons are bounded; partial, failed or too-deep discovery never claims a complete single-film folder',async()=>{
 const graph={'/Show/':[{path:'/Show/S1/',directory:true}],'/Show/S1/':[{path:'/Show/S1/e1.mkv',video:true},{path:'/Show/S1/Special/',directory:true}],'/Show/S1/Special/':[{path:'/Show/S1/Special/deeper/',directory:true}]};let calls=0;
 const service=createDavFolderService({webdav:{entry:async()=>({directory:true}),browse:async(id,path)=>{calls++;return {items:graph[path] || []};}}});const result=await service.get('a','/Show/');assert.equal(result.items.length,1);assert.equal(result.complete,false);assert.ok(calls<=8);
 const failed=createDavFolderService({webdav:{entry:async()=>({directory:true}),browse:async()=>{throw Error('private server detail');}}});const bad=await failed.get('a','/Show/');assert.equal(bad.complete,false);assert.equal(JSON.stringify(bad).includes('private'),false);
});
