const test=require('node:test'),assert=require('node:assert/strict');
const {createLatestPersonRequest}=require('./person-results');
test('late actor results and errors cannot overwrite a newer actor or a cancelled view',async()=>{
 const requests=[],committed=[];
 const loader=createLatestPersonRequest(()=>new Promise((resolve,reject)=>requests.push({resolve,reject})));
 const a=loader.load('a',x=>committed.push(x)),b=loader.load('b',x=>committed.push(x));
 requests[1].resolve('B');await b;requests[0].resolve('A');await a;assert.deepEqual(committed,['B']);
 const c=loader.load('c',x=>committed.push(x));loader.cancel();requests[2].reject(Error('old request failed'));await c;assert.deepEqual(committed,['B']);
});
