const path=require('node:path');
const {spawn}=require('node:child_process');
async function launchTrackedPlayer({executable,media,context,store,sourceId='',startSeconds=0,tracked:prepared,spawnPlayer=spawn}) {
  const tracked=prepared || await store.startSession(context,{sourceId,startSeconds});
  const args=[`--script=${path.join(__dirname,'library-progress.lua')}`,'--resume-playback=no',`--start=${Math.max(0,Number(startSeconds)||0)}`,media];
  const child=spawnPlayer(executable,args,{detached:true,stdio:'ignore',windowsHide:false,env:{...process.env,MPV_CINEMA_PROGRESS_FILE:tracked.file,MPV_CINEMA_MEDIA_URL:media,MPV_CINEMA_QUEUE_FILE:tracked.queueFile || ''}});
  await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject)});
  child.once('exit',()=>{setTimeout(()=>store.poll().catch(error=>console.error(error.message)),100).unref()});
  child.unref();return {...tracked,child};
}
module.exports={launchTrackedPlayer};
