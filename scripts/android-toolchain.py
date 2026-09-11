#!/usr/bin/env python3
"""Project-local, checksum-verified Android prerequisites. No global SDK/JDK or adb server."""
from pathlib import Path, PurePosixPath
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tarfile
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / '.cache/android'
SDK = CACHE / 'sdk'
JDK = ROOT / '.cache/toolchains/jdk17'
MIN_FREE = 15 * 1024 ** 3
MAX_USAGE = 25 * 1024 ** 3
PACKAGES = ['platform-tools', 'platforms;android-36', 'build-tools;36.0.0', 'ndk;28.2.13676358']
ASSETS = [
    dict(name='OpenJDK17U-jdk_x64_linux_hotspot_17.0.20.1_1.tar.gz', url='https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.20.1%2B1/OpenJDK17U-jdk_x64_linux_hotspot_17.0.20.1_1.tar.gz', size=193252603, algorithm='sha256', digest='3808d1d15e3ec6bd5b84057fb5d84c33d8a1536a258146bcea2e603fc726e08e', metadata='https://api.github.com/repos/adoptium/temurin17-binaries/releases/latest'),
    dict(name='commandlinetools-linux-16111833_latest.zip', url='https://dl.google.com/android/repository/commandlinetools-linux-16111833_latest.zip', size=181052239, algorithm='sha1', digest='e025545c62a8e64c7559119566a569fb1dec5f60', metadata='https://dl.google.com/android/repository/repository2-3.xml'),
]

def usage():
    total = 0
    for root in (CACHE, JDK):
        if root.exists():
            for base, dirs, files in os.walk(root, followlinks=False):
                for name in files:
                    p = Path(base) / name
                    if not p.is_symlink(): total += p.stat().st_blocks * 512
    return total

def check_space(reserve=0):
    free = shutil.disk_usage(ROOT).free
    used = usage()
    if free - reserve < MIN_FREE or used + reserve > MAX_USAGE:
        raise RuntimeError(f'Android resource budget exceeded: free={free}, used={used}, requested reserve={reserve}')
    return dict(freeBytes=free, androidAllocatedBytes=used, maxAndroidBytes=MAX_USAGE, minimumFreeBytes=MIN_FREE)

def digest(path, algorithm):
    h = hashlib.new(algorithm)
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''): h.update(chunk)
    return h.hexdigest()

def download(asset):
    path = CACHE / 'downloads' / asset['name']; path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and (path.stat().st_size != asset['size'] or digest(path, asset['algorithm']) != asset['digest']):
        raise RuntimeError(f'Existing archive failed checksum: {path}; inspect it before retrying')
    if not path.exists():
        part = path.with_name(path.name + '.part')
        if part.exists(): part.unlink()  # Only this script's incomplete project-owned download.
        request = urllib.request.Request(asset['url'], headers={'User-Agent': 'RelayLoom-project-build'})
        with urllib.request.urlopen(request, timeout=60) as response, part.open('wb') as out:
            count = 0
            while chunk := response.read(1024 * 1024):
                count += len(chunk)
                if count > asset['size']: raise RuntimeError('Archive exceeds published size')
                out.write(chunk)
        if part.stat().st_size != asset['size'] or digest(part, asset['algorithm']) != asset['digest']:
            raise RuntimeError(f'Archive size/checksum mismatch: {part}')
        part.rename(path)
    print(f'Verified {asset["name"]}', flush=True)
    return {**asset, 'computedSha256': digest(path, 'sha256')}

def safe_zip(archive, destination):
    destination.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive) as z:
        for item in z.infolist():
            p = PurePosixPath(item.filename)
            if p.is_absolute() or '..' in p.parts: raise RuntimeError('Unsafe archive member')
        z.extractall(destination)
        for item in z.infolist():
            mode = (item.external_attr >> 16) & 0o777
            if mode and not item.is_dir(): (destination / item.filename).chmod(mode)

def bootstrap():
    CACHE.mkdir(parents=True, exist_ok=True); JDK.mkdir(parents=True, exist_ok=True)
    before = check_space(3 * sum(a['size'] for a in ASSETS))
    with ThreadPoolExecutor(max_workers=2) as pool: verified = list(pool.map(download, ASSETS))
    if not (JDK / 'bin/javac').exists():
        temporary = JDK / '.unpack'; temporary.mkdir(exist_ok=True)
        with tarfile.open(CACHE / 'downloads' / ASSETS[0]['name']) as tar:
            tar.extractall(temporary, filter='data')
        top = list(temporary.iterdir())
        if len(top) != 1 or not top[0].is_dir(): raise RuntimeError('Unexpected JDK archive layout')
        for entry in top[0].iterdir(): shutil.move(str(entry), str(JDK / entry.name))
        shutil.rmtree(temporary)
    if not (SDK / 'cmdline-tools/latest/bin/sdkmanager').exists():
        temporary = CACHE / 'cli-unpack'; safe_zip(CACHE / 'downloads' / ASSETS[1]['name'], temporary)
        (SDK / 'cmdline-tools').mkdir(parents=True, exist_ok=True)
        shutil.move(str(temporary / 'cmdline-tools'), str(SDK / 'cmdline-tools/latest')); temporary.rmdir()
    versions = {}
    for name in ['java', 'javac']:
        result = subprocess.run([str(JDK / 'bin' / name), '-version'], text=True, capture_output=True, check=True)
        versions[name] = (result.stdout + result.stderr).strip()
    (CACHE / 'toolchain-bootstrap.json').write_text(json.dumps({'archives': verified, 'versions': versions, 'before': before, 'after': check_space()}, indent=2) + '\n')
    print(json.dumps(versions, indent=2), flush=True)

def environment():
    env = os.environ.copy()
    env.update(JAVA_HOME=str(JDK), ANDROID_HOME=str(SDK), ANDROID_SDK_ROOT=str(SDK), ANDROID_USER_HOME=str(CACHE / 'user'), ANDROID_AVD_HOME=str(CACHE / 'avd'), GRADLE_USER_HOME=str(CACHE / 'gradle'), ANDROID_NDK_HOME=str(SDK / 'ndk/28.2.13676358'), XDG_CACHE_HOME=str(CACHE / 'xdg-cache'), XDG_CONFIG_HOME=str(CACHE / 'xdg-config'), XDG_DATA_HOME=str(CACHE / 'xdg-data'))
    env['PATH'] = str(JDK / 'bin') + os.pathsep + env.get('PATH', '')
    env['ANDROID_EMULATOR_HOME'] = str(CACHE / 'emulator-home')
    env['JAVA_TOOL_OPTIONS'] = f'-Djava.util.prefs.userRoot={CACHE / "java-prefs"} -Djava.util.prefs.systemRoot={CACHE / "java-system-prefs"}'
    return env

if __name__ == '__main__':
    mode = sys.argv[1] if len(sys.argv) > 1 else 'bootstrap'
    if mode == 'bootstrap': bootstrap()
    elif mode == 'sdk':
        check_space(7 * 1024 ** 3)
        # CLI 23 replaces sdkmanager with Android CLI. Disable its documented optional metrics.
        command = [str(SDK / 'cmdline-tools/latest/bin/android'), '--no-metrics', '--sdk=' + str(SDK), 'sdk', 'install', *[p.replace(';', '/') for p in PACKAGES]]
        sys.exit(subprocess.call(command, env=environment(), cwd=ROOT))
    elif mode == 'status': print(json.dumps(check_space(), indent=2))
    else: raise SystemExit('Use bootstrap, sdk, or status')
