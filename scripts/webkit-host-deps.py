#!/usr/bin/env python3
"""Extract hash-pinned test libraries inside this project, without root or package scripts."""
import hashlib
import json
import platform
import shutil
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parents[1]
lock = json.loads((root / "scripts/webkit-host-deps-linux.json").read_text())
if platform.system() != "Linux" or platform.machine() != lock["architecture"]:
    raise SystemExit("This dependency lock only describes the recorded Linux x86_64 host")
if subprocess.check_output(["getconf", "GNU_LIBC_VERSION"], text=True).strip() != lock["libc"]:
    raise SystemExit("Host ABI differs from this test-library lock; no OS changes attempted")
if shutil.disk_usage(root).free < 16 * 1024**3:
    raise SystemExit("Keep the 15 GiB reserve before downloading test libraries")

output = root / ".cache/browser-libs"
downloads = output / "downloads"
library = output / "lib"
for path in [downloads, library, output / "notices"]:
    path.mkdir(parents=True, exist_ok=True)
records = []
for package in lock["packages"]:
    target = downloads / Path(package["Filename"]).name
    if not target.exists():
        subprocess.run(["apt", "download", package["Package"] + "=" + package["Version"]], cwd=downloads, check=True, timeout=120)
    if target.stat().st_size != int(package["Size"]) or hashlib.sha256(target.read_bytes()).hexdigest() != package["SHA256"]:
        raise SystemExit("Downloaded package does not match its pinned index hash: " + target.name)
    stage = output / "extracted" / package["Package"]
    stage.mkdir(parents=True, exist_ok=True)
    subprocess.run(["dpkg-deb", "--extract", str(target), str(stage)], check=True, timeout=30)
    files = []
    for source in (stage / "usr/lib/x86_64-linux-gnu").glob("*.so.*"):
        # Copy the resolved file for each SONAME; no link can redirect a later
        # write outside the project library directory.
        destination = library / source.name
        resolved = source.resolve(strict=True)
        if not resolved.is_relative_to(stage.resolve()) or destination.is_symlink():
            raise SystemExit("Library path escapes the extracted package or targets a link")
        shutil.copyfile(resolved, destination)
        files.append({"name": source.name, "sha256": hashlib.sha256(destination.read_bytes()).hexdigest()})
    for notice in (stage / "usr/share/doc").glob("*/copyright"):
        shutil.copy2(notice, output / "notices" / (package["Package"] + "-copyright"))
    records.append({"package": package["Package"], "version": package["Version"], "archiveSha256": package["SHA256"], "files": files})
# The official MiniBrowser wrapper replaces LD_LIBRARY_PATH with these bundle
# directories. Add only missing libraries there; preserve its scripts/binaries
# and every library that the browser distribution already provides.
webkit = root / ".cache/playwright" / ("webkit-" + lock["webkitRevision"])
if not webkit.is_dir():
    raise SystemExit("Install the pinned Playwright WebKit revision first")
augmentations = []
for port in ["minibrowser-wpe", "minibrowser-gtk"]:
    target_dir = webkit / port / "sys/lib"
    if not target_dir.is_dir():
        raise SystemExit("Unexpected WebKit bundle layout")
    executable = webkit / port / "bin/MiniBrowser"
    executable_hash = hashlib.sha256(executable.read_bytes()).hexdigest()
    for source in library.iterdir():
        target = target_dir / source.name
        if target.exists() or target.is_symlink():
            continue
        shutil.copyfile(source, target)
        augmentations.append({"path": str(target.relative_to(webkit)), "sha256": hashlib.sha256(target.read_bytes()).hexdigest()})
    if hashlib.sha256(executable.read_bytes()).hexdigest() != executable_hash:
        raise SystemExit("Browser executable changed during dependency preparation")
(output / "report.json").write_text(json.dumps({"status": "EXTRACTED_NOT_BROWSER_TESTED", "scriptSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), "lockSha256": hashlib.sha256((root / "scripts/webkit-host-deps-linux.json").read_bytes()).hexdigest(), "scope": lock["scope"], "osPackagesInstalled": False, "packageScriptsExecuted": False, "records": records, "browserRevision": lock["webkitRevision"], "addedBrowserLibraries": augmentations}, indent=2) + "\n")
print("Hash-pinned libraries extracted in .cache/browser-libs/lib; OS packages unchanged")
