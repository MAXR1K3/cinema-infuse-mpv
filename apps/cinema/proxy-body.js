const {Readable}=require('node:stream');
function pipeProxyBody(body,res){
 if(!body){res.end();return;}
 const source=Readable.fromWeb(body);
 source.on('error',()=>res.destroy());
 res.once('close',()=>source.destroy());
 source.pipe(res);
}
module.exports={pipeProxyBody};
