const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
function configure({mpvRoot,force=false,home=os.homedir(),project=path.resolve(__dirname,'../..')}){
 if(!mpvRoot || !path.isAbsolute(mpvRoot))throw Error('--mpv-root must be an absolute directory');
 const root=path.resolve(mpvRoot);if(!fs.existsSync(path.join(root,'mpv.exe')))throw Error('Install mpv.exe in --mpv-root first');
 const source=path.join(__dirname,'portable_config'),target=path.join(root,'portable_config');
 if(fs.existsSync(target)&&!force)throw Error('portable_config already exists. Back it up, then use --force to overlay.');
 for(const entry of fs.readdirSync(source,{recursive:true,withFileTypes:true})){
  if(!entry.isFile())continue;
  const input=path.join(entry.parentPath || entry.path,entry.name),relative=path.relative(source,input),output=path.join(target,relative);
  fs.mkdirSync(path.dirname(output),{recursive:true});
  if(/\.(conf|lua|vpy|glsl|md|lgpl|txt)$/i.test(entry.name)){
   let text=fs.readFileSync(input,'utf8');
   text=text.replaceAll('@MPV_ROOT_ESC@',root.replaceAll('\\','\\\\')).replaceAll('@MPV_ROOT_POSIX@',root.replaceAll('\\','/')).replaceAll('@MPV_ROOT@',root).replaceAll('@USER_HOME@',home);
   fs.writeFileSync(output,text,'utf8');
  }else fs.copyFileSync(input,output);
 }
 const settings=path.join(project,'config.local.json');let previous={};if(fs.existsSync(settings))previous=JSON.parse(fs.readFileSync(settings,'utf8'));
 fs.writeFileSync(settings,JSON.stringify({...previous,mpvExe:path.join(root,'mpv.exe'),libraryRoot:previous.libraryRoot || path.join(home,'Movies'),port:previous.port || 7788},null,2)+'\n');
 return {target,settings};
}
if(require.main===module){try{const args=process.argv.slice(2),at=args.indexOf('--mpv-root');console.log(JSON.stringify(configure({mpvRoot:at<0?null:args[at+1],force:args.includes('--force')})));}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={configure};
