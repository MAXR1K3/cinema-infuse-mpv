"""Check the public source tree without printing secret values."""
from pathlib import Path
import json, re

ROOT=Path(__file__).resolve().parents[1]
SKIP={'.git','node_modules','downloads','staging','dist','runtime','__pycache__','.data'}
PRIVATE={'emby-session.json','emby-server.json','user-data.json','progress.json','config.local.json','watch_history.jsonl','file_browser_favourites.txt'}
TEXT={'.js','.cjs','.json','.html','.css','.md','.txt','.lua','.vpy','.py','.conf','.yml','.yaml','.gitignore','.gitattributes'}
def check():
    errors=[];files=[]
    for p in ROOT.rglob('*'):
        if not p.is_file() or any(x in SKIP for x in p.relative_to(ROOT).parts):continue
        rel=p.relative_to(ROOT).as_posix();files.append(p)
        if p.name in PRIVATE or p.suffix.lower() in {'.log','.engine','.plan','.onnx','.exe','.dll','.mkv','.mp4'}:errors.append((rel,'private/runtime file'))
        if p.stat().st_size>=95*1024*1024:errors.append((rel,'exceeds repository file budget'))
        if p.suffix.lower() not in TEXT and p.name not in {'.gitignore','.gitattributes'}:continue
        s=p.read_text(encoding='utf-8-sig')
        patterns=[r'(?i)(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})',r'-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----',r'(?i)v1\.zdz\.plus',r'(?i)C:[\\/]+Users[\\/]+Administrator']
        # The URL validation tests intentionally reject synthetic user:password URLs.
        if not p.name.endswith('.test.js'):patterns.append(r'(?i)https?://[^\s/@]+:[^\s/@]+@')
        for pattern in patterns:
            if re.search(pattern,s):errors.append((rel,'credential or private address pattern'))
        if p.suffix.lower() in {'.conf','.lua'}:
            pattern=r'''(?im)\b[\w.-]*(?:api[_-]?key|api[_-]?token|access[_-]?token|password|passwd|secret)[\w.-]*\s*=\s*(["'])([^\r\n]+?)\1'''
            if re.search(pattern,s):errors.append((rel,'nonempty literal secret option'))
    if errors:raise SystemExit(json.dumps({'failed':errors},ensure_ascii=False,indent=2))
    print(json.dumps({'audit':'passed','files':len(files),'bytes':sum(p.stat().st_size for p in files)}))
    return files
if __name__=='__main__':check()
