import urllib.request, pathlib, re, hashlib, tarfile, json
out=pathlib.Path(__file__).resolve().parent/'downloads'; out.mkdir(parents=True,exist_ok=True); base='https://nodejs.org/dist/latest-v22.x/'
manifest=urllib.request.urlopen(base+'SHASUMS256.txt',timeout=40).read().decode()
match=re.search(r'^([0-9a-f]{64})\s+(node-v[\d.]+-darwin-arm64\.tar\.xz)$',manifest,re.M)
if not match: raise RuntimeError('Official Apple Silicon runtime not listed')
expected,name=match.groups(); archive=out/name
if not archive.exists() or hashlib.sha256(archive.read_bytes()).hexdigest()!=expected:
 with urllib.request.urlopen(base+name,timeout=120) as response, archive.open('wb') as target:
  while chunk:=response.read(1024*1024):target.write(chunk)
if hashlib.sha256(archive.read_bytes()).hexdigest()!=expected:raise RuntimeError('Runtime checksum mismatch')
with tarfile.open(archive,'r:xz') as tar:
 for suffix,destination in [('bin/node','node-arm64'),('LICENSE','NODE-LICENSE.txt')]:
  member=next(m for m in tar.getmembers() if m.name.endswith('/'+suffix));(out/destination).write_bytes(tar.extractfile(member).read())
info={'archive':name,'sha256':expected,'source':base+name};(out/'runtime.json').write_text(json.dumps(info,indent=2))
print(json.dumps(info))
