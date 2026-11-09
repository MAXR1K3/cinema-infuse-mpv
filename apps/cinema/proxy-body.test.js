const test=require('node:test'),assert=require('node:assert/strict'),{PassThrough}=require('node:stream');const {once}=require('node:events');const {pipeProxyBody}=require('./proxy-body');
test('artwork body timeout closes only the response without an unhandled stream error',async()=>{
 let controller;const body=new ReadableStream({start(c){controller=c;}}),response=new PassThrough();response.resume();const closed=once(response,'close');pipeProxyBody(body,response);controller.error(Error('Upstream timeout'));await closed;assert.equal(response.destroyed,true);
});
test('closing an artwork response cancels the upstream body',async()=>{
 let cancelled=false;const response=new PassThrough(),body=new ReadableStream({cancel(){cancelled=true;}});pipeProxyBody(body,response);response.destroy();await new Promise(resolve=>setImmediate(resolve));assert.equal(cancelled,true);
});
