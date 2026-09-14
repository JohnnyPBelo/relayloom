"""Real process controls for dedicated RNS configuration and identity ownership."""
from pathlib import Path
import json
import os
import subprocess
import sys
import tempfile
import unittest
import selectors

ROOT = Path(__file__).resolve().parents[2]
SIDECAR = Path(os.environ.get("RELAYLOOM_POLICY_SIDECAR", ROOT / "adapters/reticulum/sidecar.py"))


class ProfilePolicy(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="rns-policy-", dir=ROOT / ".cache")
        self.path = Path(self.directory.name)
        self.processes = []

    def tearDown(self):
        for process in self.processes:
            if process.poll() is None:
                process.stdin.write(b'{"t":"stop"}\n')
                process.stdin.flush()
            try:
                process.communicate(timeout=6)
            except subprocess.TimeoutExpired:
                process.kill()
                process.communicate()
                self.fail("owned sidecar did not stop within cleanup deadline")
        self.directory.cleanup()

    def config(self, shared="No", transport="No"):
        (self.path / "config").write_text(
            f"[reticulum]\nshare_instance = {shared}\nenable_transport = {transport}\n[interfaces]\n")

    def start(self):
        process = subprocess.Popen([sys.executable, "-u", str(SIDECAR), "--config", str(self.path)],
                                   stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.processes.append(process)
        return process

    def ready(self, process):
        with selectors.DefaultSelector() as selector:
            selector.register(process.stdout, selectors.EVENT_READ)
            self.assertTrue(selector.select(8), "sidecar readiness deadline")
        line = process.stdout.readline()
        self.assertTrue(line, "sidecar exited before readiness")
        result = json.loads(line)
        self.assertEqual(result["t"], "ready")
        return result["destination"]

    def rejected(self, message):
        process = self.start()
        out, err = process.communicate(timeout=8)
        self.assertNotEqual(process.returncode, 0)
        self.assertNotIn(b'"t":"ready"', out)
        self.assertIn(message.encode(), err)
        self.assertFalse((self.path / "relayloom-transport.identity").exists())

    def test_missing_explicit_config_cannot_fall_back_to_global(self):
        self.rejected("dedicated config")
        self.assertFalse((self.path / "storage").exists())

    def test_shared_daemon_is_rejected(self):
        self.config(shared="Yes")
        self.rejected("dedicated config")

    def test_uncoordinated_rns_transit_is_rejected(self):
        self.config(transport="Yes")
        self.rejected("RelayLoom owns relay consent")

    def test_executable_interface_is_never_loaded(self):
        self.config()
        (self.path / "interfaces").mkdir()
        marker = self.path / "executed"
        (self.path / "interfaces/LocalCode.py").write_text(f"from pathlib import Path\nPath({str(marker)!r}).touch()\n")
        self.rejected("custom executable interfaces")
        self.assertFalse(marker.exists())

    def test_corrupt_transport_identity_is_not_replaced(self):
        self.config()
        key = self.path / "relayloom-transport.identity"
        key.write_bytes(b"corrupted identity")
        p = self.start()
        _, err = p.communicate(timeout=8)
        self.assertNotEqual(p.returncode, 0)
        self.assertIn(b"refusing replacement", err)
        self.assertEqual(key.read_bytes(), b"corrupted identity")

    def test_real_process_ownership_release_and_empty_directory_restart(self):
        self.config()
        first = self.start()
        destination = self.ready(first)
        key = self.path / "relayloom-transport.identity"
        original = key.read_bytes()
        second = self.start()
        _, err = second.communicate(timeout=8)
        self.assertNotEqual(second.returncode, 0)
        self.assertIn(b"already owned", err)
        self.assertEqual(key.read_bytes(), original)
        first.stdin.write(b'{"t":"stop"}\n'); first.stdin.flush()
        first.communicate(timeout=8)
        self.assertEqual(first.returncode, 0)
        self.assertTrue((self.path / "interfaces").is_dir())
        replacement = self.start()
        self.assertEqual(self.ready(replacement), destination)
        self.assertEqual(key.read_bytes(), original)
        if os.name != "nt":
            self.assertEqual(key.stat().st_mode & 0o777, 0o600)

    def test_killed_owner_releases_the_lease_without_changing_identity(self):
        self.config()
        first = self.start()
        destination = self.ready(first)
        original = (self.path / "relayloom-transport.identity").read_bytes()
        first.kill()
        first.communicate(timeout=8)
        replacement = self.start()
        self.assertEqual(self.ready(replacement), destination)
        self.assertEqual((self.path / "relayloom-transport.identity").read_bytes(), original)


if __name__ == "__main__":
    unittest.main()
