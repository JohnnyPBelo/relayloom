#!/usr/bin/env python3
"""Build one x86_64 debug APK using official SDK tools and an actual gomobile AAR."""
from pathlib import Path
import argparse
import fcntl
import hashlib
import json
import os
import re
import runpy
import shutil
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]
TOOLS = runpy.run_path(str(ROOT / 'scripts/android-toolchain.py'))
CACHE, SDK, JDK = TOOLS['CACHE'], TOOLS['SDK'], TOOLS['JDK']
SOURCE = ROOT / 'apps/android/app/src/main'
BUILD_TOOLS = SDK / 'build-tools/36.0.0'
ANDROID_JAR = SDK / 'platforms/android-36/android.jar'
ENV = TOOLS['environment']()
ENV['JAVA_TOOL_OPTIONS'] += ' -Xmx1024m'

def run(args, cwd=ROOT, capture=False):
    result = subprocess.run([str(x) for x in args], cwd=cwd, env=ENV, text=True, capture_output=capture, check=True)
    return (result.stdout + result.stderr).strip() if capture else ''

def sha(path): return TOOLS['digest'](path, 'sha256')

def project_path(value):
    path = (ROOT / value).resolve()
    if not path.is_relative_to(ROOT): raise RuntimeError('Build inputs must stay inside this project')
    return path

def fresh_directory(path):
    marker = path / '.relayloom-android-build'
    if path.exists():
        if not marker.is_file(): raise RuntimeError(f'Refusing to clear an unowned build directory: {path}')
        shutil.rmtree(path)
    path.mkdir(parents=True); marker.write_text('Owned transient Android build directory\n')

def policy_test():
    target = CACHE / 'policy-test'; target.mkdir(parents=True, exist_ok=True)
    run([JDK / 'bin/javac', '--release', '17', '-d', target, SOURCE / 'java/org/relayloom/android/OriginPolicy.java', SOURCE / 'java/org/relayloom/android/RuntimeLeaseCoordinator.java', ROOT / 'apps/android/tests/OriginPolicyTest.java', ROOT / 'apps/android/tests/RuntimeLeaseCoordinatorTest.java'])
    return '\n'.join(run([JDK / 'bin/java', '-cp', target, 'org.relayloom.android.' + name], capture=True) for name in ['OriginPolicyTest', 'RuntimeLeaseCoordinatorTest'])

def prepare_web(source, stage):
    if not (source / 'index.html').is_file(): raise RuntimeError('The real built web index.html is required')
    target = stage / 'assets/web'; target.mkdir(parents=True)
    total = 0
    for item in sorted(source.rglob('*')):
        if item.is_symlink(): raise RuntimeError('Symlinked web assets are not accepted')
        if not item.is_file(): continue
        if item.suffix == '.map': continue
        total += item.stat().st_size
        if total > 16 * 1024 ** 2: raise RuntimeError('Web assets exceed native wrapper budget')
        destination = target / item.relative_to(source); destination.parent.mkdir(parents=True, exist_ok=True); shutil.copyfile(item, destination)
    index = (target / 'index.html').read_text()
    if re.search(r'<script[^>]+src=["\'](?:https?:)?//', index, re.I): raise RuntimeError('Remote executable scripts are forbidden in bundled index')
    if '<head>' not in index: raise RuntimeError('Expected a real HTML head in bundled index')
    index = index.replace('<head>', '<head><script src="/android-host.js"></script>', 1)
    (target / 'index.html').write_text(index)
    shutil.copyfile(SOURCE / 'assets/android-host.js', target / 'android-host.js')
    notices = {
        'relayloom-MIT.txt': ROOT / 'LICENSE',
        'dependency-boundaries.md': ROOT / 'docs/DEPENDENCIES.md',
        'go-BSD.txt': ROOT / '.cache/toolchains/go1.26.8/LICENSE',
        'x-mobile-BSD.txt': ROOT / '.cache/go-mod/golang.org/x/mobile@v0.0.0-20260908204917-8b95e45f8d3e/LICENSE',
        'x-crypto-BSD.txt': ROOT / '.cache/go-mod/golang.org/x/crypto@v0.57.0/LICENSE',
        'react-MIT.txt': ROOT / 'node_modules/react/LICENSE',
        'react-dom-MIT.txt': ROOT / 'node_modules/react-dom/LICENSE',
        'scheduler-MIT.txt': ROOT / 'node_modules/scheduler/LICENSE',
        'lucide-ISC.txt': ROOT / 'node_modules/lucide-react/LICENSE',
    }
    (target / 'notices').mkdir()
    for name, source in notices.items():
        if not source.is_file(): raise RuntimeError(f'Required distribution notice is missing: {source}')
        shutil.copyfile(source, target / 'notices' / name)
    entries = [{'path': str(p.relative_to(target)), 'sha256': sha(p)} for p in sorted(target.rglob('*')) if p.is_file()]
    (stage / 'assets/web-manifest.json').write_text(json.dumps(entries, separators=(',', ':')))
    return entries

def build(aar, web):
    if not aar.is_file(): raise RuntimeError('A real, successfully compiled gomobile AAR is required first')
    before = TOOLS['check_space'](2 * 1024 ** 3)
    stage = CACHE / 'apk-build'; fresh_directory(stage)
    extracted = stage / 'aar'; TOOLS['safe_zip'](aar, extracted)
    classes = extracted / 'classes.jar'
    if not classes.is_file(): raise RuntimeError('AAR lacks Java bindings')
    with zipfile.ZipFile(classes) as jar:
        for name in ['mobile/Mobile.class', 'go/Seq.class']:
            if name not in jar.namelist(): raise RuntimeError(f'AAR has no required binding {name}')
    libraries = list((extracted / 'jni/x86_64').glob('*.so'))
    if not libraries or not any(p.name == 'libgojni.so' for p in libraries): raise RuntimeError('AAR lacks the real x86_64 Go JNI runtime')
    elf = SDK / 'ndk/28.2.13676358/toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-readelf'
    alignments = []
    for library in libraries:
        output = run([elf, '-lW', library], capture=True); loads = [line.split()[-1] for line in output.splitlines() if line.strip().startswith('LOAD ')]
        if not loads or any(int(value, 16) < 16384 for value in loads): raise RuntimeError(f'{library.name} lacks 16 KiB ELF LOAD alignment')
        alignments.append({'name': library.name, 'sha256': sha(library), 'loadAlignments': loads})
    assets = prepare_web(web, stage)
    generated = stage / 'generated'; generated.mkdir()
    compiled = stage / 'resources.zip'
    run([BUILD_TOOLS / 'aapt2', 'compile', '--dir', SOURCE / 'res', '-o', compiled])
    unsigned = stage / 'unsigned.apk'
    run([BUILD_TOOLS / 'aapt2', 'link', '-I', ANDROID_JAR, '--manifest', SOURCE / 'AndroidManifest.xml', '--java', generated, '-A', stage / 'assets', '-o', unsigned, compiled])
    java_output = stage / 'java'; java_output.mkdir()
    sources = [*sorted((SOURCE / 'java').rglob('*.java')), *sorted(generated.rglob('*.java'))]
    # Java 8 release signatures supply LambdaMetafactory; D8 desugars lambdas for min API 24.
    # Android framework symbols come from the official platform jar on the classpath.
    run([JDK / 'bin/javac', '-proc:none', '-encoding', 'UTF-8', '--release', '8', '-classpath', str(ANDROID_JAR) + os.pathsep + str(classes), '-d', java_output, *sources])
    wrapper_jar = stage / 'wrapper.jar'; run([JDK / 'bin/jar', 'cf', wrapper_jar, '-C', java_output, '.'])
    dex = stage / 'dex'; dex.mkdir()
    run([BUILD_TOOLS / 'd8', '--release', '--min-api', '24', '--lib', ANDROID_JAR, '--output', dex, wrapper_jar, classes])
    with zipfile.ZipFile(unsigned, 'a') as apk:
        for file in sorted(dex.glob('classes*.dex')): apk.write(file, file.name, compress_type=zipfile.ZIP_DEFLATED)
        for library in libraries: apk.write(library, 'lib/x86_64/' + library.name, compress_type=zipfile.ZIP_STORED)
    aligned = stage / 'aligned.apk'; run([BUILD_TOOLS / 'zipalign', '-P', '16', '-f', '4', unsigned, aligned])
    key = CACHE / 'debug.keystore'
    if not key.exists():
        # Standard local development credential; never use this key for a signed production release.
        run([JDK / 'bin/keytool', '-genkeypair', '-keystore', key, '-storepass', 'android', '-keypass', 'android', '-alias', 'androiddebugkey', '-keyalg', 'RSA', '-keysize', '2048', '-validity', '3650', '-dname', 'CN=RelayLoom Debug,O=Development Only,C=PT'])
        key.chmod(0o600)
    artifacts = CACHE / 'artifacts'; artifacts.mkdir(exist_ok=True)
    apk = artifacts / 'relayloom-android-x86_64-debug.apk'
    run([BUILD_TOOLS / 'apksigner', 'sign', '--ks', key, '--ks-key-alias', 'androiddebugkey', '--ks-pass', 'pass:android', '--key-pass', 'pass:android', '--out', apk, aligned])
    signing = run([BUILD_TOOLS / 'apksigner', 'verify', '--verbose', '--print-certs', apk], capture=True)
    zip_alignment = run([BUILD_TOOLS / 'zipalign', '-c', '-P', '16', '-v', '4', apk], capture=True)
    manifest = run([BUILD_TOOLS / 'aapt2', 'dump', 'badging', apk], capture=True)
    with zipfile.ZipFile(apk) as archive:
        names = archive.namelist()
        if 'lib/x86_64/libgojni.so' not in names or 'classes.dex' not in names or 'assets/web/index.html' not in names: raise RuntimeError('APK contents do not contain the native runtime and bundled app')
    report = {'kind': 'ANDROID_NATIVE_BUILD', 'status': 'APK_BUILT_NOT_DEVICE_TESTED', 'abi': 'x86_64', 'minApi': 24, 'targetApi': 36, 'aar': str(aar.relative_to(ROOT)), 'aarSha256': sha(aar), 'apk': str(apk.relative_to(ROOT)), 'apkSha256': sha(apk), 'apkBytes': apk.stat().st_size, 'elfLibraries': alignments, 'apk16KiBZipAlignmentPassed': True, 'signatureVerification': signing, 'manifestBadging': manifest, 'bundledAssetCount': len(assets), 'hostPolicyTest': policy_test(), 'before': before, 'after': TOOLS['check_space'](), 'limitations': ['Host cross-compilation and archive/signature/alignment checks only; no emulator or physical device run is implied.', 'Debug signing is local development only; no store upload or release signing.', '16 KiB ELF/APK alignment does not establish physical ARM64 16 KiB device compatibility.']}
    (CACHE / 'build-report.json').write_text(json.dumps(report, indent=2) + '\n')
    (CACHE / 'zipalign-report.txt').write_text(zip_alignment + '\n')
    print(json.dumps({k: report[k] for k in ['kind', 'status', 'apk', 'apkSha256', 'apkBytes', 'apk16KiBZipAlignmentPassed']}, indent=2))

if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--aar', default='.cache/android/artifacts/relayloom-core.aar'); parser.add_argument('--web', default='dist/web'); parser.add_argument('--policy-test', action='store_true'); args = parser.parse_args()
    CACHE.mkdir(parents=True, exist_ok=True)
    with (CACHE / 'native-build.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.policy_test: print(policy_test())
        else: build(project_path(args.aar), project_path(args.web))
