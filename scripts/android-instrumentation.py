#!/usr/bin/env python3
"""Build a separate, debug-only native test APK; never included in the application APK."""
from pathlib import Path
import runpy
import zipfile
import json

ROOT = Path(__file__).resolve().parents[1]
M = runpy.run_path(str(ROOT / 'scripts/android-build.py'))
CACHE, JDK, BT, JAR, run = M['CACHE'], M['JDK'], M['BUILD_TOOLS'], M['ANDROID_JAR'], M['run']
M['TOOLS']['check_space'](128 * 1024 ** 2)
stage = CACHE / 'instrumentation-build'; M['fresh_directory'](stage)
source = ROOT / 'apps/android/instrumentation'; classes = stage / 'classes'; classes.mkdir()
run([JDK / 'bin/javac', '-proc:none', '--release', '8', '-classpath', JAR, '-d', classes, *sorted(source.glob('*.java'))])
jar = stage / 'tests.jar'; run([JDK / 'bin/jar', 'cf', jar, '-C', classes, '.'])
dex = stage / 'dex'; dex.mkdir(); run([BT / 'd8', '--release', '--min-api', '24', '--lib', JAR, '--output', dex, jar])
unsigned = stage / 'unsigned.apk'; run([BT / 'aapt2', 'link', '-I', JAR, '--manifest', source / 'AndroidManifest.xml', '-o', unsigned])
with zipfile.ZipFile(unsigned, 'a') as apk:
    for file in dex.glob('*.dex'): apk.write(file, file.name, compress_type=zipfile.ZIP_DEFLATED)
aligned = stage / 'aligned.apk'; run([BT / 'zipalign', '-P', '16', '-f', '4', unsigned, aligned])
output = CACHE / 'artifacts/relayloom-android-instrumentation.apk'
run([BT / 'apksigner', 'sign', '--ks', CACHE / 'debug.keystore', '--ks-key-alias', 'androiddebugkey', '--ks-pass', 'pass:android', '--key-pass', 'pass:android', '--out', output, aligned])
run([BT / 'apksigner', 'verify', output]); print(json.dumps({'kind':'ANDROID_TEST_APK_BUILD','apk':str(output.relative_to(ROOT)),'sha256':M['sha'](output),'deviceRun':False},indent=2))
