"""Real asyncio/TCP boundary, simulated acknowledged GATT; no RF claim."""
import asyncio
import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('gatt_relay', Path(__file__).resolve().parents[2] / 'adapters/bluetooth/gatt_relay.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class RelayTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.lines, self.notifications, self.clients, self.jobs = [], [], set(), set()
        async def accepted(reader, writer):
            self.clients.add(writer)
            self.jobs.add(asyncio.current_task())
            try:
                while raw := await reader.readline():
                    self.lines.append(raw)
                    writer.write(raw)
                    await writer.drain()
            finally:
                self.clients.discard(writer)
                writer.close()
                await writer.wait_closed()
                self.jobs.discard(asyncio.current_task())
        self.server = await asyncio.start_server(accepted, '127.0.0.1', 0)
        async def indicate(value): self.notifications.append(value)
        self.relay = m.GattRelay(self.server.sockets[0].getsockname()[1], indicate)
        self.tag = bytes(range(8))
        self.device = '/org/bluez/hci0/dev_fixture'
    async def asyncTearDown(self):
        await self.relay.close()
        for writer in list(self.clients): writer.close()
        if self.jobs: await asyncio.gather(*list(self.jobs))
        self.server.close()
        await self.server.wait_closed()
    async def open(self): await self.relay.write(self.device, self.tag + b'\x00', 23)
    async def send(self, value):
        for at in range(0, len(value), 11):
            await self.relay.write(self.device, self.tag + b'\x01' + value[at:at+11], 23)
    async def test_bidirectional_fragmented_tcp(self):
        await self.open()
        raw = json.dumps({'t': 'part', 'id': 'a'*64, 'index': 0, 'count': 1, 'data': 'YQ=='}, separators=(',', ':')).encode()+b'\n'
        await self.send(raw)
        for _ in range(100):
            if sum(len(v)-9 for v in self.notifications[1:]) == len(raw): break
            await asyncio.sleep(.01)
        self.assertEqual(self.lines, [raw])
        self.assertEqual(self.notifications[0], self.tag+b'\x00')
        self.assertEqual(b''.join(v[9:] for v in self.notifications[1:]), raw)
        self.assertTrue(all(len(v) <= 20 for v in self.notifications))
    async def test_other_central_and_stale_epoch_cannot_inject(self):
        await self.open()
        for device, data in [('/org/bluez/hci0/other', self.tag+b'\x01{}\n'), (self.device, b'foreign!\x01{}\n'), ('/org/bluez/hci0/other', b'foreign!\x00')]:
            with self.assertRaises(ConnectionError): await self.relay.write(device, data)
        self.assertEqual(self.lines, [])
        self.assertEqual(self.relay.session['tag'], self.tag)
    async def test_partial_overflow_closes_and_reopen_has_no_old_bytes(self):
        await self.open()
        with self.assertRaises(ValueError): await self.send(b'A'*4097)
        self.assertIsNone(self.relay.session)
        self.assertEqual(len(self.relay.partial), 0)
        self.tag = b'newepoch'
        await self.open()
        await self.send(b'{"t":"ack","id":"'+b'a'*64+b'"}\n')
        for _ in range(100):
            if self.lines: break
            await asyncio.sleep(.01)
        self.assertEqual(len(self.lines), 1)
        self.assertFalse(self.lines[0].startswith(b'A'))
    async def test_ping_is_local_and_drop_releases_native_assembly(self):
        await self.open()
        nonce = '12345678-1234-1234-1234-123456789abc'
        await self.send(json.dumps({'t':'ping','nonce':nonce}, separators=(',',':')).encode()+b'\n')
        reply = b''.join(v[9:] for v in self.notifications[1:])
        self.assertEqual(json.loads(reply), {'t':'pong','nonce':nonce})
        self.assertEqual(self.lines, [])
        await self.send(b'{"t":"drop","id":"'+b'a'*64+b'"}\n')
        self.assertIsNone(self.relay.session)
        self.assertEqual(self.notifications[-1], self.tag+b'\x02')
    async def test_malformed_and_oversized_char_are_rejected(self):
        for mtu in (0, 22, 518, True):
            with self.assertRaises(ValueError): m.payload_mtu(mtu)
        await self.open()
        with self.assertRaises(ValueError): await self.relay.write(self.device, self.tag+b'\x01'+b'a'*12)
        with self.assertRaises(ValueError): await self.send(b'not-json\n')
        self.assertIsNone(self.relay.session)
        self.assertEqual(self.lines, [])

    async def test_close_fences_a_late_tcp_connection_without_announcing_ready(self):
        original = asyncio.open_connection
        started, release = asyncio.Event(), asyncio.Event()
        writers = []
        async def delayed(*args, **kwargs):
            reader, writer = await original(*args, **kwargs)
            writers.append(writer)
            started.set()
            await release.wait()
            return reader, writer
        with patch.object(m.asyncio, 'open_connection', delayed):
            opening = asyncio.create_task(self.open())
            try:
                await asyncio.wait_for(started.wait(), 2)
                self.assertTrue(self.relay.owns_device(self.device))
                self.assertFalse(self.relay.owns_device('/org/bluez/hci0/other'))
                cleanup = self.relay.close()
                self.assertFalse(self.relay.owns_device(self.device))
                await cleanup
                release.set()
                with self.assertRaisesRegex(ConnectionError, 'closed during connection'):
                    await opening
                self.assertIsNone(self.relay.session)
                self.assertIsNone(self.relay.reader_task)
                self.assertTrue(writers[0].is_closing())
                self.assertEqual(self.notifications, [])
            finally:
                release.set()
                await asyncio.gather(opening, return_exceptions=True)
        await self.open()
        self.assertEqual(self.notifications, [self.tag + b'\x00'])

    async def test_close_during_ready_indication_cannot_start_a_late_reader(self):
        indicate = self.relay.indicate
        started, release = asyncio.Event(), asyncio.Event()
        async def held(value):
            started.set()
            await release.wait()
        self.relay.indicate = held
        opening = asyncio.create_task(self.open())
        try:
            await asyncio.wait_for(started.wait(), 2)
            writer = self.relay.session['writer']
            await self.relay.close()
            release.set()
            with self.assertRaisesRegex(ConnectionError, 'closed during indication'):
                await opening
            self.assertIsNone(self.relay.session)
            self.assertIsNone(self.relay.reader_task)
            self.assertTrue(writer.is_closing())
        finally:
            release.set()
            await asyncio.gather(opening, return_exceptions=True)
            self.relay.indicate = indicate
        await self.open()
        self.assertIsNotNone(self.relay.session)

    async def test_old_cleanup_cannot_close_a_replacement_session(self):
        await self.open()
        old_writer = self.relay.session['writer']
        cleanup = self.relay.close()
        try:
            self.assertIsNone(self.relay.session)
            await self.open()
            replacement = self.relay.session
        finally:
            await cleanup
        self.assertIs(self.relay.session, replacement)
        self.assertTrue(old_writer.is_closing())
        self.assertFalse(replacement['writer'].is_closing())

if __name__ == '__main__': unittest.main()
