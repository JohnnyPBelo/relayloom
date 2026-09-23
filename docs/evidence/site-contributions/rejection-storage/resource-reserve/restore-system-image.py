from pathlib import Path
import os,json,hashlib,lzma
base=Path(__file__).resolve().parent
record=json.loads((base/'android36-x86_64-system-eb4bd8cc.json').read_text())
assert record['status']=='ARCHIVED_VERIFIED'
archive=Path(record['archive']);target=Path(record['original'])
assert archive.parent==base and target.is_relative_to(base.parent/'sdk')
assert hashlib.file_digest(archive.open('rb'),'sha256').hexdigest()==record['archiveSha256']
if target.exists():
 assert hashlib.file_digest(target.open('rb'),'sha256').hexdigest()==record['sha256'],'Different image exists; preserve it'
 print('Image already restored and verified');raise SystemExit(0)
def free():
 s=os.statvfs(base);return s.f_bavail*s.f_frsize
reserve=15*1024**3
assert free()>=reserve+record['allocatedBefore']+64*1024**2,'Free additional space before restoring the Android emulator image'
temp=target.with_name(target.name+'.restore-'+str(os.getpid()));h=hashlib.sha256();size=0
try:
 with lzma.open(archive,'rb') as src,temp.open('xb') as dst:
  while block:=src.read(1024**2):
   h.update(block);size+=len(block)
   if not block.strip(b'\0'):dst.seek(len(block),1)
   else:
    assert free()>=reserve+2*1024**2,'Reserve changed during restore; keep compressed original'
    dst.write(block)
  dst.truncate(size);dst.flush();os.fsync(dst.fileno())
 assert size==record['bytes'] and h.hexdigest()==record['sha256']
 assert not target.exists(),'Image appeared during restore; preserve it'
 os.chmod(temp,record['mode']);os.rename(temp,target)
 print('Android system image restored; exact SHA256 and logical size verified; user data unchanged')
finally:
 if temp.exists():temp.unlink()
