"""Packaging header controls only; these tiny files are not executable libraries."""
from pathlib import Path
import runpy
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[3]
BUILD = runpy.run_path(str(ROOT / 'scripts/android-build.py'))


class BuildTargetsTest(unittest.TestCase):
    def setUp(self):
        cache = ROOT / '.cache/android/abi-policy'
        cache.mkdir(parents=True, exist_ok=True)
        self.directory = tempfile.TemporaryDirectory(dir=cache)
        self.path = Path(self.directory.name) / 'header.so'

    def tearDown(self):
        self.directory.cleanup()

    def header(self, machine, elf_class=2, endian=1, kind=3):
        value = bytearray(20)
        value[:6] = b'\x7fELF' + bytes([elf_class, endian])
        value[16:18] = kind.to_bytes(2, 'little')
        value[18:20] = machine.to_bytes(2, 'little')
        self.path.write_bytes(value)

    def test_matching_64_bit_android_headers(self):
        for abi, machine in [('x86_64', 62), ('arm64-v8a', 183)]:
            self.header(machine)
            self.assertEqual(BUILD['elf_machine'](self.path, abi), machine)

    def test_another_abi_is_refused_before_packaging(self):
        for abi, machine in [('x86_64', 183), ('arm64-v8a', 62)]:
            self.header(machine)
            with self.assertRaisesRegex(RuntimeError, 'does not match'):
                BUILD['elf_machine'](self.path, abi)

    def test_non_shared_or_wrong_encoding_is_refused(self):
        for options in [{'elf_class': 1}, {'endian': 2}, {'kind': 2}]:
            self.header(183, **options)
            with self.assertRaisesRegex(RuntimeError, 'shared library'):
                BUILD['elf_machine'](self.path, 'arm64-v8a')

    def test_missing_or_unknown_headers_fail(self):
        for value in [b'', b'\x7fELF', bytes(20)]:
            self.path.write_bytes(value)
            with self.assertRaises(RuntimeError):
                BUILD['elf_machine'](self.path, 'arm64-v8a')
        self.header(183)
        with self.assertRaisesRegex(RuntimeError, 'Unsupported'):
            BUILD['elf_machine'](self.path, '../other')


if __name__ == '__main__':
    unittest.main()
