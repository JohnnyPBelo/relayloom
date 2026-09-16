#!/usr/bin/env python3
"""Source/plist/project consistency only. Never claims Swift or iOS execution."""
from pathlib import Path
import json
import plistlib
import re
import xml.etree.ElementTree as ET

root = Path(__file__).resolve().parents[1]
ios = root / 'apps/ios'
info = plistlib.loads((ios / 'RelayLoom/Info.plist').read_bytes())
assert info['NSAppTransportSecurity'] == {'NSAllowsLocalNetworking': True, 'NSExceptionDomains': {'127.0.0.1': {'NSExceptionAllowsInsecureHTTPLoads': True, 'NSIncludesSubdomains': False}}}
assert 'UIBackgroundModes' not in info
assert info['NSMicrophoneUsageDescription'] and info['NSLocalNetworkUsageDescription']
assert not info['UIFileSharingEnabled']
project = (ios / 'RelayLoom.xcodeproj/project.pbxproj').read_text()
definitions = re.findall(r'^\s*([A-F0-9]{24}) = \{', project, re.M)
assert len(definitions) == len(set(definitions))
references = set(re.findall(r'\b[A-F0-9]{24}\b', project))
assert references == set(definitions)
for filename in ['AppDelegate.swift', 'RelayViewController.swift', 'OriginPolicy.swift', 'RuntimeCoordinator.swift', 'NativeText.swift', 'NativeBridge.m', 'NativeBridge.h', 'RelayLoom-Bridging-Header.h', 'Info.plist']:
    assert (ios / 'RelayLoom' / filename).is_file() and filename in project
assert 'Mobile.xcframework' in project and '../../.cache/ios/stage/web' in project
ET.parse(ios / 'RelayLoom.xcodeproj/xcshareddata/xcschemes/RelayLoom.xcscheme')
controller = (ios / 'RelayLoom/RelayViewController.swift').read_text()
assert '.nonPersistent()' in controller and 'WKContentRuleListStore' in controller
assert 'addScriptMessageHandler' not in controller and 'UIApplication.shared.open' not in controller
assert 'FileProtectionType.complete' in controller and 'isExcludedFromBackup = true' in controller
assert 'Self.runtime.stop(prior)' in controller and 'frame.isMainFrame' in controller
bridge = (ios / 'RelayLoom/NativeBridge.m').read_text()
assert 'MobileStart(data, assets, &error)' in bridge and 'MobileStop(&error)' in bridge
print(json.dumps({'kind': 'IOS_STATIC_SOURCE_CHECK', 'status': 'passed', 'projectObjectCount': len(definitions), 'swiftCompiled': False, 'iosBuilt': False, 'simulatorExecuted': False, 'deviceExecuted': False}))
