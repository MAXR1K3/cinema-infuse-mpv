from pathlib import Path
import hashlib, json, zipfile
from audit_publication import ROOT, check

files=check();out=ROOT/'dist';out.mkdir(exist_ok=True)
archive=out/'Cinema-Infuse-mpv-source.zip'
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
    for p in files:
        rel=p.relative_to(ROOT).as_posix();info=zipfile.ZipInfo('cinema-infuse-mpv/'+rel);info.create_system=3
        executable=rel.endswith('/templates/MPVCinema') or p.suffix in {'.command','.sh'}
        info.external_attr=(0o100755 if executable else 0o100644)<<16;info.compress_type=zipfile.ZIP_DEFLATED;z.writestr(info,p.read_bytes())
digest=hashlib.sha256(archive.read_bytes()).hexdigest();archive.with_suffix('.zip.sha256').write_text(digest+'  '+archive.name+'\n')
print(json.dumps({'archive':str(archive),'bytes':archive.stat().st_size,'sha256':digest}))
