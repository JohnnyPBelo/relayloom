#!/usr/bin/env python3
"""One project-owned API36 x86_64 AVD, isolated adb, no host audio/camera, no global settings."""
from pathlib import Path
import argparse
import json
import os
import runpy
import signal
import subprocess
import time

ROOT = Path(__file__).resolve().parents[1]
TOOLS = runpy.run_path(str(ROOT / 'scripts/android-toolchain.py'))
CACHE, SDK = TOOLS['CACHE'], TOOLS['SDK']
ENV = TOOLS['environment']()
ADB_PORT = 5047
EMULATOR_PORT = 5580
SERIAL = f'emulator-{EMULATOR_PORT}'
ENV.update(ADB_SERVER_PORT=str(ADB_PORT), ANDROID_ADB_SERVER_PORT=str(ADB_PORT), ADB_SERVER_SOCKET=f'tcp:127.0.0.1:{ADB_PORT}')
ENV['ADB_VENDOR_KEYS'] = str(CACHE / 'emulator-home/adbkey')
ENV.update(TMPDIR=str(CACHE / 'tmp'), TMP=str(CACHE / 'tmp'), TEMP=str(CACHE / 'tmp'))
AVD = CACHE / 'avd/relayloom-api36.avd'
PID_FILE = CACHE / 'emulator-process.json'
IMAGE = SDK / 'system-images/android-36/google_apis/x86_64'

def run(args, capture=False, timeout=60):
    result = subprocess.run([str(x) for x in args], env=ENV, cwd=ROOT, text=True, capture_output=capture, timeout=timeout, check=True)
    return (result.stdout + result.stderr).strip() if capture else ''

def adb(*args, capture=False, timeout=60): return run([SDK / 'platform-tools/adb', '-P', str(ADB_PORT), '-s', SERIAL, *args], capture, timeout)

def provision():
    if not (CACHE / 'artifacts/relayloom-android-x86_64-debug.apk').is_file() or not json.loads((CACHE / 'build-report.json').read_text())['apk16KiBZipAlignmentPassed']:
        raise RuntimeError('A successful native APK/alignment build is required before downloading the emulator image')
    TOOLS['check_space'](12 * 1024 ** 3)
    # Stable channel only, one selected image, previously reviewed standard SDK terms, no metrics.
    run([SDK / 'cmdline-tools/latest/bin/android', '--no-metrics', '--sdk=' + str(SDK), 'sdk', 'install', 'emulator', 'system-images/android-36/google_apis/x86_64'], timeout=1800)
    revision = (SDK / 'emulator/source.properties').read_text()
    if '37.1.11' not in revision: raise RuntimeError('Installer did not select the reviewed stable emulator 37.1.11; inspect before running')
    print(json.dumps(TOOLS['check_space'](), indent=2))

def configure():
    if not (IMAGE / 'system.img').is_file(): raise RuntimeError('The single API36 image is not installed')
    AVD.mkdir(parents=True, exist_ok=True); (CACHE / 'avd').mkdir(exist_ok=True)
    (CACHE / 'emulator-home').mkdir(exist_ok=True)
    if not (CACHE / 'emulator-home/adbkey').exists():
        run([SDK / 'platform-tools/adb', 'keygen', CACHE / 'emulator-home/adbkey'])
        (CACHE / 'emulator-home/adbkey').chmod(0o600)
    (CACHE / 'avd/relayloom-api36.ini').write_text(f'avd.ini.encoding=UTF-8\npath={AVD}\npath.rel=avd/relayloom-api36.avd\ntarget=android-36\n')
    values = {
        'AvdId': 'relayloom-api36', 'avd.ini.displayname': 'RelayLoom API36 isolated test', 'abi.type': 'x86_64', 'hw.cpu.arch': 'x86_64', 'hw.cpu.ncore': '2',
        'hw.ramSize': '2048', 'hw.lcd.width': '1080', 'hw.lcd.height': '1920', 'hw.lcd.density': '420', 'hw.keyboard': 'yes', 'hw.gpu.enabled': 'yes', 'hw.gpu.mode': 'swiftshader_indirect',
        'hw.audioInput': 'no', 'hw.audioOutput': 'no', 'hw.camera.back': 'none', 'hw.camera.front': 'none', 'hw.gps': 'no',
        'disk.dataPartition.size': '6G', 'disk.cachePartition.size': '128M', 'image.sysdir.1': str(IMAGE) + '/', 'tag.id': 'google_apis', 'tag.display': 'Google APIs',
        'PlayStore.enabled': 'false', 'showDeviceFrame': 'no', 'fastboot.forceColdBoot': 'yes', 'fastboot.forceFastBoot': 'no', 'snapshot.present': 'false',
    }
    (AVD / 'config.ini').write_text(''.join(f'{key}={value}\n' for key, value in values.items()))

def start(reset_pristine=False):
    TOOLS['check_space'](5 * 1024 ** 3); configure()
    if PID_FILE.exists(): raise RuntimeError('A project emulator PID record already exists; inspect or stop it first')
    # Positive KVM check without changing device access or kernel configuration.
    acceleration = run([SDK / 'emulator/emulator', '-accel-check'], capture=True)
    run([SDK / 'platform-tools/adb', '-P', str(ADB_PORT), 'start-server'])
    args = [SDK / 'emulator/emulator', '-avd', 'relayloom-api36', '-ports', str(EMULATOR_PORT) + ',' + str(EMULATOR_PORT + 1), '-no-window', '-no-audio', '-camera-back', 'none', '-camera-front', 'none', '-no-boot-anim', '-no-snapshot', '-no-snapshot-save', '-gpu', 'swiftshader_indirect', '-memory', '2048', '-cores', '2', '-no-metrics', '-show-kernel', '-verbose']
    if reset_pristine:
        if (CACHE / 'evidence/uiautomator-identity.json').exists(): raise RuntimeError('Cannot reset an AVD after identity creation evidence exists')
        args.append('-wipe-data')
    log = (CACHE / 'emulator.log').open('w')
    child = subprocess.Popen([str(x) for x in args], cwd=ROOT, env=ENV, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    log.close()
    PID_FILE.write_text(json.dumps({'pid': child.pid, 'serial': SERIAL, 'adbServerPort': ADB_PORT, 'avd': str(AVD), 'args': [str(x) for x in args], 'acceleration': acceleration}, indent=2) + '\n')
    print(json.dumps({'pid': child.pid, 'serial': SERIAL, 'adbServerPort': ADB_PORT, 'log': '.cache/android/emulator.log', 'hostAudioCameraDisabled': True}, indent=2))

def stop():
    if not PID_FILE.exists(): print('No project-owned emulator PID record'); return
    record = json.loads(PID_FILE.read_text()); pid = record['pid']
    proc = Path(f'/proc/{pid}/cmdline')
    if proc.exists():
        command = proc.read_bytes().decode(errors='replace')
        if 'relayloom-api36' not in command and str(SDK / 'emulator') not in command: raise RuntimeError('PID no longer belongs to this project emulator')
        try: adb('emu', 'kill', timeout=15)
        except Exception: os.killpg(pid, signal.SIGTERM)
        for i in range(50):
            if not proc.exists(): break
            time.sleep(.2)
        if proc.exists(): raise RuntimeError('Project emulator has not exited; inspect before restarting')
    # Explicitly addresses only this script's isolated server port.
    run([SDK / 'platform-tools/adb', '-P', str(ADB_PORT), 'kill-server'])
    PID_FILE.unlink(); print('Project emulator and isolated adb server stopped')

if __name__ == '__main__':
    p = argparse.ArgumentParser(); p.add_argument('action', choices=['provision', 'configure', 'start', 'reset-pristine-start', 'status', 'install', 'stop']); args = p.parse_args()
    if args.action == 'provision': provision()
    elif args.action == 'configure': configure()
    elif args.action == 'start': start()
    elif args.action == 'reset-pristine-start': start(True)
    elif args.action == 'stop': stop()
    elif args.action == 'status':
        result = subprocess.run([str(SDK / 'platform-tools/adb'), '-P', str(ADB_PORT), '-s', SERIAL, 'shell', 'getprop', 'sys.boot_completed'], env=ENV, cwd=ROOT, text=True, capture_output=True, timeout=15)
        print(json.dumps({'bootCompleted': result.returncode == 0 and result.stdout.strip() == '1', 'adbStatus': (result.stdout + result.stderr).strip(), 'pidRecord': json.loads(PID_FILE.read_text())['pid'] if PID_FILE.exists() else None}, indent=2))
    elif args.action == 'install':
        adb('install', '-r', str(CACHE / 'artifacts/relayloom-android-x86_64-debug.apk'), timeout=120)
        adb('shell', 'am', 'start', '-n', 'org.relayloom.android/.MainActivity')
