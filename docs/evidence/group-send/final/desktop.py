import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import time

root = Path('/home/absint0o/projects/relayloom')
out = root / '.cache/group-send-final'
prior = json.loads((out / 'report.json').read_text())
assert prior['status'] == 'pass', 'Complete the sequential host gate first'
expected = json.loads((out / 'source-hashes.json').read_text())
def unchanged():
    return all(hashlib.sha256((root / p).read_bytes()).hexdigest() == digest for p, digest in expected.items())

report = {'sourceSha256': prior['sourceSha256'], 'status': 'running', 'checks': []}
def save():
    (out / 'desktop-report.json').write_text(json.dumps(report, indent=2) + '\n')
checks = [
    ('desktop-build', ['npm', 'run', 'desktop:build']),
    ('desktop-smoke', ['npm', 'run', 'desktop:smoke']),
    ('desktop-package', ['npm', 'run', 'desktop:package', '--', '--linux', '--x64', '--dir']),
    ('desktop-packaged-smoke', ['npm', 'run', 'desktop:packaged-smoke']),
]
save()
for name, argv in checks:
    assert unchanged(), 'Source changed since host verification'
    assert shutil.disk_usage(root).free >= 15 * 1024**3, 'Disk reserve'
    entry = {'name': name, 'argv': argv, 'startedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'status': 'running'}
    report['checks'].append(entry); save()
    print(name + ': START', flush=True)
    started = time.monotonic()
    with (out / (name + '.log')).open('wb') as log:
        child = subprocess.Popen(argv, cwd=root, stdout=log, stderr=subprocess.STDOUT)
        entry['pid'] = child.pid; save()
        code = child.wait()
    entry.update(exitCode=code, elapsedSeconds=round(time.monotonic()-started,3), status='pass' if code == 0 else 'fail', sourceUnchanged=unchanged())
    save()
    print(name + ': ' + entry['status'].upper(), flush=True)
    if code != 0 or not entry['sourceUnchanged']:
        report['status'] = 'failed'; save(); raise SystemExit(1)
report['status'] = 'pass'; save()
