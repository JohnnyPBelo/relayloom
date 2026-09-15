"""Install the pinned RNS host adapter in project-owned paths only."""
from pathlib import Path
import argparse
import platform
import shutil
import subprocess
import sys

parser = argparse.ArgumentParser()
parser.add_argument("--bluetooth", action="store_true", help="Install optional Linux Nordic UART BLE dependencies")
args = parser.parse_args()

root = Path(__file__).resolve().parents[1]
if platform.system() != "Linux" or platform.machine() != "x86_64" or sys.version_info[:2] != (3, 11):
    raise SystemExit("The current hashed lock targets Linux x86_64 / Python 3.11. Other platforms need a verified lock and execution gate.")
if shutil.disk_usage(root).free < 15 * 1024**3:
    raise SystemExit("RelayLoom requires at least 15 GiB free before installing dependencies.")
environment = root / ".cache/reticulum/venv"
python = environment / "bin/python"
if not python.exists():
    subprocess.run([sys.executable, "-m", "venv", str(environment)], check=True)
subprocess.run([str(python), "-m", "pip", "install", "--disable-pip-version-check",
                "--only-binary=:all:", "--require-hashes", "--cache-dir",
                str(root / ".cache/reticulum/pip"), "-r",
                str(root / "adapters/reticulum/requirements-linux.lock")], check=True, cwd=root)

if args.bluetooth:
    subprocess.run([str(python), "-m", "pip", "install", "--disable-pip-version-check",
                    "--only-binary=:all:", "--require-hashes", "--cache-dir",
                    str(root / ".cache/reticulum/pip"), "-r",
                    str(root / "adapters/reticulum/requirements-bluetooth-linux.lock")], check=True, cwd=root)
