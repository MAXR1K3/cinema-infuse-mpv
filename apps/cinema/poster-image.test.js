const test=require('node:test'),assert=require('node:assert/strict');const {readPosterImage}=require('./poster-image');
test('stalled cover bodies time out and cancel the stream instead of occupying poster workers',async()=>{
 let cancelled=false;const response=new Response(new ReadableStream({cancel(){cancelled=true;}}),{headers:{'content-type':'image/jpeg'}});
 await assert.rejects(readPosterImage(response,{timeout:20}),/超时/);assert.equal(cancelled,true);
});
test('cover reader rejects HTML and oversized images',async()=>{
 assert.equal(await readPosterImage(new Response('<html/>',{headers:{'content-type':'text/html'}})),null);
 await assert.rejects(readPosterImage(new Response('large',{headers:{'content-type':'image/jpeg'}}),{maxBytes:2}),/过大/);
});
