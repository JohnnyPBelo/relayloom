"""Linux BLE Nordic UART -> private OS serial endpoint for stock RNS interfaces.

This is a foreground peripheral connection, not BLE browser-to-browser peering.
The RNS/RelayLoom layers above it still own encryption, verification and consent.
No daemon configuration, pairing, power changes or automatic device selection.
"""
import argparse
import asyncio
import contextlib
import json
import os
import pty
import signal
import sys
import tty

SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e'
RX = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'
TX = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'
MAX_BUFFER = 64 * 1024
MAX_CHUNK = 4096


class BluetoothSerial:
    def __init__(self, client, master):
        self.client, self.master = client, master
        self.incoming = bytearray()
        self.closed = asyncio.Event()
        self.failed = False
        self.sent = self.received = 0
        self._readable = asyncio.Event()
        self._writable = asyncio.Event()
        self._notified = asyncio.Event()

    def disconnect(self, *_):
        self.failed = True
        self.closed.set()

    def notify(self, _characteristic, data):
        if self.closed.is_set(): return
        if not data or len(data) > 512 or len(self.incoming) + len(data) > MAX_BUFFER:
            self.disconnect()
            return
        self.incoming.extend(data)
        self._notified.set()

    async def run(self, ready=lambda: None):
        service = self.client.services.get_service(SERVICE)
        rx = service.get_characteristic(RX) if service else None
        tx = service.get_characteristic(TX) if service else None
        if not rx or not tx or 'notify' not in tx.properties:
            raise ValueError('Selected device does not expose Nordic UART notifications')
        if 'write-without-response' not in rx.properties and 'write' not in rx.properties:
            raise ValueError('Selected device has no Nordic UART write endpoint')
        response = 'write-without-response' not in rx.properties
        # Bleak supplies the actual characteristic limit; 20 remains the safe
        # baseline on BlueZ versions that do not report a larger negotiated MTU.
        size = 20 if response else max(1, min(512, rx.max_write_without_response_size))
        loop = asyncio.get_running_loop()
        os.set_blocking(self.master, False)
        started = False
        tasks = []
        try:
            await asyncio.wait_for(self.client.start_notify(tx, self.notify), 10)
            started = True
            ready()
            async def outbound():
                while not self.closed.is_set():
                    self._readable.clear()
                    try: data = os.read(self.master, MAX_CHUNK)
                    except BlockingIOError:
                        loop.add_reader(self.master, self._readable.set)
                        try: await self._readable.wait()
                        finally: loop.remove_reader(self.master)
                        continue
                    if not data: raise OSError('Serial endpoint closed')
                    for offset in range(0, len(data), size):
                        if self.closed.is_set(): return
                        chunk = data[offset:offset + size]
                        await asyncio.wait_for(self.client.write_gatt_char(rx, chunk, response=response), 10)
                        self.sent += len(chunk)
            async def inbound():
                while not self.closed.is_set():
                    if not self.incoming:
                        self._notified.clear()
                        await self._notified.wait()
                        continue
                    try: count = os.write(self.master, self.incoming[:MAX_CHUNK])
                    except BlockingIOError:
                        self._writable.clear()
                        loop.add_writer(self.master, self._writable.set)
                        try: await self._writable.wait()
                        finally: loop.remove_writer(self.master)
                        continue
                    if count <= 0: raise OSError('Serial write failed')
                    del self.incoming[:count]
                    self.received += count
            tasks = [asyncio.create_task(outbound()), asyncio.create_task(inbound()), asyncio.create_task(self.closed.wait())]
            done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            for task in done: await task
            if self.failed: raise ConnectionError('Bluetooth disconnected or receive budget exceeded')
        finally:
            self.closed.set()
            for task in tasks: task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            loop.remove_reader(self.master)
            loop.remove_writer(self.master)
            self.incoming.clear()
            if started and self.client.is_connected:
                with contextlib.suppress(Exception):
                    await asyncio.wait_for(self.client.stop_notify(tx), 5)


async def main(args):
    from bleak import BleakClient
    if sys.platform != 'linux': raise OSError('This PTY adapter has only a Linux implementation')
    master, slave = pty.openpty()
    tty.setraw(slave)
    os.chmod(os.ttyname(slave), 0o600)
    adapter = None
    try:
        client = BleakClient(args.address, services=[SERVICE], timeout=15,
                            disconnected_callback=lambda *_: adapter and adapter.disconnect())
        async with client:
            adapter = BluetoothSerial(client, master)
            loop = asyncio.get_running_loop()
            for sig in (signal.SIGINT, signal.SIGTERM): loop.add_signal_handler(sig, adapter.closed.set)
            # The descriptor contains no Bluetooth address or application keys.
            await adapter.run(lambda: print(json.dumps({'serial': os.ttyname(slave), 'medium': 'bluetooth-nus', 'connected': client.is_connected}), flush=True))
    finally:
        os.close(master)
        os.close(slave)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--address', required=True, help='Explicit local Bluetooth address of a Nordic UART/RNode peripheral')
    args = parser.parse_args()
    try: asyncio.run(main(args))
    except Exception as error:
        # BlueZ exceptions may include private addresses; keep diagnostics generic.
        print(f'Bluetooth serial adapter stopped ({type(error).__name__}); check the selected peripheral and local Bluetooth permissions.', file=sys.stderr)
        sys.exit(1)
