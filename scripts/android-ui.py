#!/usr/bin/env python3
"""UIAutomator inspection/identity smoke for the one isolated project emulator."""
from pathlib import Path
import argparse
import json
import re
import runpy
import subprocess
import time
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
M = runpy.run_path(str(ROOT / 'scripts/android-emulator.py'))
CACHE = M['CACHE']; EVIDENCE = CACHE / 'evidence'; EVIDENCE.mkdir(exist_ok=True)
PASSWORD = 'relayloom_android_test_passphrase'

def adb(*args, binary=False, timeout=30):
    result = subprocess.run([str(M['SDK']/'platform-tools/adb'),'-P',str(M['ADB_PORT']),'-s',M['SERIAL'],*args],env=M['ENV'],capture_output=True,text=not binary,timeout=timeout,check=True)
    return result.stdout

def dump():
    adb('shell','uiautomator','dump','/data/local/tmp/relayloom-ui.xml')
    value = adb('exec-out','cat','/data/local/tmp/relayloom-ui.xml'); (EVIDENCE/'ui-latest.xml').write_text(value)
    return ET.fromstring(value)

def tap(node):
    values = [int(x) for x in re.findall(r'\d+',node.attrib['bounds'])]
    if values[2]<=values[0] or values[3]<=values[1]: raise RuntimeError('Cannot tap an offscreen UIAutomator node')
    adb('shell','input','tap',str((values[0]+values[2])//2),str((values[1]+values[3])//2))

def visible(node):
    values=[int(x) for x in re.findall(r'\d+',node.attrib.get('bounds',''))]
    return len(values)==4 and values[2]>values[0] and values[3]>values[1]

def screenshot(name):
    output = EVIDENCE/(name+'.png'); output.write_bytes(adb('exec-out','screencap','-p',binary=True)); return str(output.relative_to(ROOT))

def select_portuguese():
    """Use the application's visible selector; never alter Android system locale."""
    root = dump()
    selected = next((n for n in root.iter('node') if visible(n) and n.attrib.get('text') in ('Português (Portugal)', 'English', 'Español')), None)
    if selected is None: raise RuntimeError('Application language selector is not visible')
    if selected.attrib.get('text') != 'Português (Portugal)':
        tap(selected)
        for _ in range(8):
            root = dump()
            option = next((n for n in root.iter('node') if visible(n) and n.attrib.get('text') == 'Português (Portugal)'), None)
            if option is not None: tap(option); break
            time.sleep(.25)
        else: raise RuntimeError('Portuguese application language option not visible')
    # The native preference API writes outside the changing HTTP origin.
    for _ in range(12):
        root = dump()
        if any(visible(n) and n.attrib.get('text') == 'Português (Portugal)' for n in root.iter('node')):
            time.sleep(.5); return
        time.sleep(.25)
    raise RuntimeError('Application language selection did not update')

def begin_setup():
    select_portuguese()
    for _ in range(7):
        root = dump()
        start = next((n for n in root.iter('node') if visible(n) and n.attrib.get('text') == 'Começar'), None)
        if start is not None: tap(start); return
        adb('shell','input','swipe','540','1650','540','650','350')
    raise RuntimeError('Initial setup action was not available')

def create_identity():
    image = screenshot('android-onboarding-before'); begin_setup(); root = dump()
    for i in range(7):
        inputs = [n for n in root.iter('node') if n.attrib.get('class')=='android.widget.EditText' and n.attrib.get('enabled')=='true' and visible(n)]
        name = next((n for n in inputs if n.attrib.get('password')=='false'),None)
        if name is not None:
            tap(name); adb('shell','input','text','AndroidEmulator'); adb('shell','input','keyevent','KEYCODE_BACK'); break
        adb('shell','input','swipe','540','1650','540','650','350'); root=dump()
    else: raise RuntimeError('Name field was not available through UIAutomator')
    for i in range(5):
        root=dump();password=next((n for n in root.iter('node') if n.attrib.get('class')=='android.widget.EditText' and n.attrib.get('password')=='true' and visible(n)),None)
        if password is not None:break
        adb('shell','input','swipe','540','1650','540','800','350')
    else: raise RuntimeError('Password field was not available through UIAutomator')
    tap(password); adb('shell','input','text',PASSWORD); adb('shell','input','keyevent','KEYCODE_BACK')
    root=dump()
    button=next((n for n in root.iter('node') if n.attrib.get('text')=='Criar identidade' and visible(n)),None)
    if button is None:
        adb('shell','input','swipe','540','1650','540','800','350');root=dump();button=next((n for n in root.iter('node') if n.attrib.get('text')=='Criar identidade' and visible(n)),None)
    if button is None: raise RuntimeError('Identity submit button was not available through UIAutomator')
    tap(button)
    for i in range(15):
        root=dump()
        if any('As tuas conversas' in n.attrib.get('text','') for n in root.iter('node')): break
        time.sleep(1)
    else: raise RuntimeError('Identity creation did not reach actual messenger UI')
    report={'kind':'ANDROID_EMULATOR_UIAUTOMATOR','identityCreatedViaNativeInput':True,'name':'AndroidEmulator','beforeScreenshot':image,'afterScreenshot':screenshot('android-identity-messenger'),'apkSha256':json.loads((CACHE/'build-report.json').read_text())['apkSha256'],'physicalDeviceTested':False,'microphoneCameraAccessed':False}
    (EVIDENCE/'uiautomator-identity.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('action',choices=['dump','screenshot','create-identity','select-language']);args=p.parse_args()
    if args.action=='create-identity':create_identity()
    elif args.action=='select-language':select_portuguese()
    elif args.action=='screenshot':print(screenshot('android-current'))
    else:
        for n in dump().iter('node'):
            if n.attrib.get('text') or n.attrib.get('content-desc') or n.attrib.get('class')=='android.widget.EditText':print({k:n.attrib.get(k) for k in ['text','content-desc','class','password','bounds']})
