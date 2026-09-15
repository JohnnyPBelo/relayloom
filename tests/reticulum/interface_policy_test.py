"""Catalog coverage is separate from actual interface execution/hardware tests."""
import ast
from pathlib import Path
import sys
import unittest
import RNS
from RNS.vendor.configobj import ConfigObj
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'adapters/reticulum'))
from interface_policy import BUILTIN_INTERFACES, validate_interfaces, interface_stats

class InterfacePolicy(unittest.TestCase):
    def settings(self, kind, pipe='No'):
        return ConfigObj(['[relayloom]', f'allow_pipe_interface = {pipe}', '[interfaces]', ' [[test]]', f' type = {kind}', ' enabled = No'])

    def test_catalog_matches_pinned_reference_dispatch(self):
        tree = ast.parse((Path(RNS.__file__).parent / 'Reticulum.py').read_text())
        names = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Compare) and isinstance(node.left, ast.Subscript):
                if isinstance(node.left.slice, ast.Constant) and node.left.slice.value == 'type':
                    for value in node.comparators:
                        if isinstance(value, ast.Constant) and str(value.value).endswith('Interface'):
                            names.add(value.value)
        self.assertEqual(RNS.__version__, '1.5.4')
        self.assertEqual(names, BUILTIN_INTERFACES)
        for name in names:
            validate_interfaces(self.settings(name, 'Yes'))

    def test_executable_pipe_requires_explicit_local_opt_in(self):
        with self.assertRaisesRegex(ValueError, 'local allow_pipe'):
            validate_interfaces(self.settings('PipeInterface'))
        validate_interfaces(self.settings('PipeInterface', 'Yes'))

    def test_custom_shared_and_excess_interfaces_rejected(self):
        for kind in ['LocalInterface', 'InjectedInterface', '../../module']:
            with self.assertRaisesRegex(ValueError, 'unsupported'):
                validate_interfaces(self.settings(kind))
        with self.assertRaisesRegex(ValueError, 'at most 16'):
            validate_interfaces({'interfaces': {str(i): {'type': 'UDPInterface'} for i in range(17)}})

    def test_diagnostics_bounded_and_do_not_export_network_details(self):
        class UDPInterface:
            online, txb, rxb = True, 123, 456
            name, address, key = 'private name', 'private address', 'private key'
        result = interface_stats([UDPInterface()] * 100)
        self.assertEqual(len(result), 32)
        self.assertEqual(result[0], {'type': 'UDPInterface', 'online': True, 'sent': 123, 'received': 456})

if __name__ == '__main__': unittest.main()
