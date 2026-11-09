const {execFile}=require('node:child_process'),{promisify}=require('node:util'),crypto=require('node:crypto');
function createMacSecrets({run=promisify(execFile)}={}){
 let pending;
 async function command(args){return (await run('/usr/bin/security',args,{timeout:30000,maxBuffer:16384})).stdout.trim();}
 async function key(){if(!pending)pending=(async()=>{
  const args=['-s','org.local.cinema.infuse','-a','encryption-key'];let value;
  try{value=await command(['find-generic-password',...args,'-w']);}
  catch(error){if(Number(error.code)!==44)throw Error('无法访问 macOS 钥匙串，请解锁登录钥匙串后重试');const generated=crypto.randomBytes(32).toString('base64');try{await command(['add-generic-password',...args,'-w',generated]);value=generated;}catch{value=await command(['find-generic-password',...args,'-w']);}}
  const bytes=Buffer.from(value,'base64');if(bytes.length!==32)throw Error('钥匙串加密密钥无效');return bytes;
 })().catch(error=>{pending=null;throw error;});return pending;}
 return {async protect(value){const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',await key(),iv),data=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return ['mac1',iv.toString('base64'),cipher.getAuthTag().toString('base64'),data.toString('base64')].join('.');},
 async unprotect(value){const [version,iv,tag,data]=String(value).split('.');if(version!=='mac1')throw Error('此连接来自其他系统，请在 Mac 上重新登录');const decipher=crypto.createDecipheriv('aes-256-gcm',await key(),Buffer.from(iv,'base64'));decipher.setAuthTag(Buffer.from(tag,'base64'));return Buffer.concat([decipher.update(Buffer.from(data,'base64')),decipher.final()]).toString('utf8');}};
}
const secrets=createMacSecrets();module.exports={createMacSecrets,macSecrets:(mode,value)=>mode==='protect'?secrets.protect(value):secrets.unprotect(value)};
