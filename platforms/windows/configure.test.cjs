const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');const {configure}=require('./configure.cjs');
test('Windows installer resolves portable paths and refuses silent overwrite',t=>{
 const project=fs.mkdtempSync(path.join(os.tmpdir(),'cinema-config-'));t.after(()=>fs.rmSync(project,{recursive:true,force:true}));const root=path.join(project,'player');fs.mkdirSync(root);fs.writeFileSync(path.join(root,'mpv.exe'),'fixture');
 configure({mpvRoot:root,project});const thumbnail=fs.readFileSync(path.join(root,'portable_config/script-opts/thumbfast.conf'),'utf8');assert.ok(!thumbnail.includes('@MPV_ROOT'));assert.ok(thumbnail.includes(root.replaceAll('\\','/')));
 assert.equal(JSON.parse(fs.readFileSync(path.join(project,'config.local.json'),'utf8')).mpvExe,path.join(root,'mpv.exe'));assert.throws(()=>configure({mpvRoot:root,project}),/already exists/);
});
