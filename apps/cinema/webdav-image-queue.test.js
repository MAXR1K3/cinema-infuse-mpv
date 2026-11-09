const test=require('node:test'),assert=require('node:assert/strict');
const {createDavImageQueue}=require('./webdav-image-queue');
function picture(){const events=new Map();return {isConnected:true,src:'',addEventListener(event,fn){events.set(event,fn);},removeEventListener(event){events.delete(event);},removeAttribute(){this.src='';},finish(){events.get('load')?.();}};}
test('posters use at most two browser connections and release slots after load',()=>{
 const queue=createDavImageQueue({Observer:null}),images=Array.from({length:8},picture);images.forEach((img,i)=>queue.observe(img,'/poster/'+i));assert.equal(images.filter(x=>x.src).length,2);images[0].finish();assert.equal(images.filter(x=>x.src).length,3);queue.clear();assert.ok(images.every(x=>!x.src));
});
test('off-screen images wait for intersection and stale images never start',()=>{
 let enter;class Observer{constructor(fn){enter=fn;}observe(){}unobserve(){}disconnect(){}}
 const queue=createDavImageQueue({Observer}),a=picture(),b=picture();queue.observe(a,'/a');queue.observe(b,'/b');assert.equal(a.src,'');b.isConnected=false;enter([{target:a,isIntersecting:true},{target:b,isIntersecting:true}]);assert.equal(a.src,'/a');assert.equal(b.src,'');queue.clear();enter([{target:a,isIntersecting:true}]);assert.equal(a.src,'');
});
