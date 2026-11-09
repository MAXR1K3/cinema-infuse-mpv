async function readPosterImage(response,{timeout=10000,maxBytes=8*1024*1024}={}){
 const type=(response.headers.get('content-type') || '').split(';')[0];
 if(!response.ok || !response.body || !['image/jpeg','image/png','image/webp'].includes(type)){await response.body?.cancel();return null;}
 const reader=response.body.getReader();let timer;
 const read=async()=>{const chunks=[];let length=0;while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>maxBytes)throw Error('封面图片过大');chunks.push(value);}return length?{bytes:Buffer.concat(chunks),type}:null;};
 try{return await Promise.race([read(),new Promise((_,reject)=>{timer=setTimeout(()=>{reject(Error('封面读取超时'));reader.cancel().catch(()=>{});},timeout);})]);}
 finally{clearTimeout(timer);reader.cancel().catch(()=>{});}
}
module.exports={readPosterImage};
