import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import time

root = Path('/home/absint0o/projects/relayloom')
out = root / '.cache/group-carriers-final'
out.mkdir(parents=True, exist_ok=True)

def sources():
    names = subprocess.check_output(['rg', '--files', 'apps', 'packages', 'native', 'scripts', 'tests', 'package.json', 'package-lock.json', 'tsconfig.json', 'playwright.config.ts', 'vite.config.ts'], cwd=root, text=True).splitlines()
    return {name: hashlib.sha256((root / name).read_bytes()).hexdigest() for name in sorted(names)}

before = sources()
report = {'startedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'baseCommit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip(), 'workingTree': 'uncommitted integration', 'sourceSha256': hashlib.sha256(json.dumps(before, sort_keys=True).encode()).hexdigest(), 'checks': [], 'status': 'running'}
(out / 'source-hashes.json').write_text(json.dumps(before, indent=2) + '\n')

def save():
    temporary = out / 'report.tmp'
    temporary.write_text(json.dumps(report, indent=2) + '\n')
    temporary.replace(out / 'report.json')

checks = [
    ('build', ['npm', 'run', 'build'], {}),
    ('ios-host', ['node', '--test', 'apps/ios/Tests/SimulatorRunnerTests.mjs'], {}),
    ('ios-static', ['node', 'scripts/ios-simulator.mjs', '--check'], {}),
    ('node', ['npm', 'test'], {}),
    ('go', ['node', 'scripts/go.mjs', 'test', '-json', '-race', '-count=1', '-p=1', './core', './transport', './app', './groups', './groupstore', './groupauthority', './groupaccess', './groupcontrol', './groupledger', './profilelock', './profilestate', './profilebinding', './profiledb', './sqlitedriver'], {}),
    ('native-build', ['npm', 'run', 'native:build'], {}),
    ('interop', ['npm', 'run', 'test:interop'], {}),
    ('cgo-boundary', ['node', 'scripts/go.mjs', 'test', '-json', '-race', '-count=1', '-p=1', '-tags', 'relayloom_sqlite_cgo,sqlite_omit_load_extension', '-run', 'TestGroupCommand|TestScopedRawProofTail|TestScopedRestrictivePrefix|TestGroupAdmission|TestGroupHistoricalDelete|TestGroupQuarantineReservation|TestGroupCorruptQuarantine|TestGroupHistoryExpiry|TestGroupOutbox|TestGroupSend|TestGroupConfirmation|TestGroupEvent|TestGroupControl|TestStopSnapshot', './app', './groupauthority', './groupledger'], {}),
    ('ui-node', ['node', 'scripts/e2e.mjs'], {}),
    ('ui-go', ['node', 'scripts/e2e.mjs'], {'RELAYLOOM_TEST_BACKEND': 'native'}),
]
save()
for name, argv, overrides in checks:
    if shutil.disk_usage(root).free < 15 * 1024**3:
        report['status'] = 'stopped-disk-reserve'
        save()
        raise SystemExit(1)
    if sources() != before:
        report['status'] = 'stopped-source-change'
        save()
        raise SystemExit(1)
    entry = {'name': name, 'argv': argv, 'environmentOverrides': overrides, 'status': 'running', 'startedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}
    report['checks'].append(entry)
    save()
    print(name + ': START', flush=True)
    start = time.monotonic()
    with (out / (name + '.log')).open('wb') as log:
        child = subprocess.Popen(argv, cwd=root, stdout=log, stderr=subprocess.STDOUT, env={**os.environ, **overrides})
        entry['pid'] = child.pid
        save()
        code = child.wait()
    entry.update(exitCode=code, elapsedSeconds=round(time.monotonic()-start, 3), status='pass' if code == 0 else 'fail', sourceUnchanged=sources() == before)
    if name.startswith('ui-') and (root / 'test-results/e2e.json').exists():
        shutil.copyfile(root / 'test-results/e2e.json', out / (name + '.json'))
        capture = out / (name + '-captures')
        capture.mkdir(exist_ok=True)
        for picture in ['site-editor.png', 'mobile-social.png', 'messenger-dark.png']:
            shutil.copyfile(root / 'docs/evidence/ui' / picture, capture / picture)
    save()
    print(name + ': ' + entry['status'].upper() + ' ' + str(entry['elapsedSeconds']) + 's', flush=True)
    if code != 0 or not entry['sourceUnchanged']:
        report['status'] = 'failed'
        save()
        raise SystemExit(1)
report['status'] = 'pass'
report['finishedAt'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
save()
