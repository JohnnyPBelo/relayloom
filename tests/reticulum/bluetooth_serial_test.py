"""Real OS PTY with a simulated GATT peripheral; never a physical BLE claim."""
import asyncio
import os
from pathlib import Path
import pty
import sys
import tty
import unittest
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'adapters/reticulum'))
from bluetooth_serial import BluetoothSerial, SERVICE, RX, TX, MAX_BUFFER

class Characteristic:
    properties = ['notify', 'write-without-response']
    max_write_without_response_size = 20

class FakeGatt:
    is_connected = True
    def __init__(self):
        self.services = self
        self.writes = []
        self.started, self.written = asyncio.Event(), asyncio.Event()
        self.stopped = False
        self.failure = False
        self.allowed = asyncio.Event(); self.allowed.set()
    def get_service(self, uuid): return self if uuid == SERVICE else None
    def get_characteristic(self, uuid): return Characteristic() if uuid in [RX,TX] else None
    async def start_notify(self, char, callback):
        self.callback = callback; self.started.set()
    async def stop_notify(self, char): self.stopped = True
    async def write_gatt_char(self, char, data, response):
        await self.allowed.wait()
        if self.failure: raise OSError('simulated radio failure')
        self.writes.append(bytes(data)); self.written.set()

class BluetoothTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.master, self.slave = pty.openpty(); tty.setraw(self.slave)
        os.set_blocking(self.slave, False)
        self.gatt = FakeGatt(); self.adapter = BluetoothSerial(self.gatt, self.master)
        self.task = asyncio.create_task(self.adapter.run())
        await asyncio.wait_for(self.gatt.started.wait(), 1)
    async def asyncTearDown(self):
        self.adapter.closed.set()
        try: await asyncio.wait_for(self.task, 2)
        except (ConnectionError, OSError): pass
        os.close(self.master); os.close(self.slave)
    async def until(self, fn):
        async def loop():
            while not fn(): await asyncio.sleep(.001)
        await asyncio.wait_for(loop(), 2)
    async def test_exact_binary_roundtrip_and_mtu_fragmentation(self):
        payload = bytes(range(256))*12
        os.write(self.slave, payload)
        await self.until(lambda: sum(map(len, self.gatt.writes)) == len(payload))
        self.assertEqual(b''.join(self.gatt.writes), payload)
        self.assertTrue(all(len(c)<=20 for c in self.gatt.writes))
        for offset in range(0,len(payload),20): self.gatt.callback(None,payload[offset:offset+20])
        await self.until(lambda:self.adapter.received == len(payload))
        self.assertEqual(os.read(self.slave,len(payload)), payload)
    async def test_backpressure_does_not_reorder_or_spawn_writes(self):
        self.gatt.allowed.clear()
        os.write(self.slave, b'a'*100)
        await asyncio.sleep(.03)
        self.assertEqual(self.gatt.writes, [])
        self.gatt.allowed.set()
        await self.until(lambda:self.adapter.sent == 100)
        self.assertEqual(b''.join(self.gatt.writes),b'a'*100)
    async def test_overflow_fails_closed_and_clears_queue(self):
        for _ in range(MAX_BUFFER//512+1): self.gatt.callback(None,b'x'*512)
        self.assertLessEqual(len(self.adapter.incoming), MAX_BUFFER)
        with self.assertRaises(ConnectionError): await asyncio.wait_for(self.task, 2)
        self.assertEqual(self.adapter.incoming, b'')
        self.assertTrue(self.gatt.stopped)
    async def test_disconnection_and_write_failure_stop_owned_tasks(self):
        self.gatt.failure=True; os.write(self.slave,b'fail')
        with self.assertRaises(OSError): await asyncio.wait_for(self.task, 2)
        self.assertTrue(self.adapter.closed.is_set())
        self.assertTrue(self.gatt.stopped)
    async def test_remote_disconnect_is_not_a_success(self):
        self.adapter.disconnect()
        with self.assertRaises(ConnectionError): await asyncio.wait_for(self.task, 2)
        self.assertTrue(self.gatt.stopped)

if __name__=='__main__': unittest.main()
