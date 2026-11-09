// Reserve browser connections for browsing and playback instead of flooding them with posters.
function createDavImageQueue({Observer=globalThis.IntersectionObserver,limit=2}={}){
 const records=new Map(),waiting=[];let active=0;
 function pump(){while(active<limit && waiting.length){const record=waiting.shift();if(!records.has(record.img) || !record.img.isConnected)continue;active++;record.active=true;record.img.src=record.url;}}
 function ready(img){const record=records.get(img);if(!record || record.queued)return;record.queued=true;observer?.unobserve(img);waiting.push(record);pump();}
 const observer=Observer?new Observer(entries=>{for(const entry of entries)if(entry.isIntersecting)ready(entry.target);},{rootMargin:'160px'}):null;
 function observe(img,url){const record={img,url};records.set(img,record);const done=()=>{if(!records.has(img))return;if(record.active){active--;record.active=false;}img.removeEventListener('load',done);img.removeEventListener('error',done);record.done=undefined;pump();};record.done=done;img.addEventListener('load',done);img.addEventListener('error',done);if(observer)observer.observe(img);else ready(img);}
 function clear(){observer?.disconnect();for(const {img,done}of records.values()){if(done){img.removeEventListener('load',done);img.removeEventListener('error',done);}img.removeAttribute('src');}records.clear();waiting.length=0;active=0;}
 return {observe,clear};
}
if(typeof module!=='undefined')module.exports={createDavImageQueue};
if(typeof window!=='undefined')window.createDavImageQueue=createDavImageQueue;
