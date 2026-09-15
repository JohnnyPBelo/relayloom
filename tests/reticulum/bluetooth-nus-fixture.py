"""Two actual BluetoothSerial PTYs with simulated GATT delivery, no physical BLE."""
import asyncio
import json
import os
from pathlib import Path
import pty
import signal
import sys
import tty
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'adapters/reticulum'))
from bluetooth_serial import BluetoothSerial, SERVICE, RX, TX

class Characteristic:
    properties = ['notify', 'write-without-response']
    max_write_without_response_size = 20

class SimulatedGatt:
    is_connected = True
    connected = True
    def __init__(self): self.services = self
    def get_service(self, uuid): return self if uuid == SERVICE else None
    def get_characteristic(self, uuid): return Characteristic() if uuid in (RX,TX) else None
    async def start_notify(self, char, callback): self.callback = callback
    async def stop_notify(self, char): pass
    async def write_gatt_char(self, char, data, response):
        await asyncio.sleep(.001)
        if self.connected: self.other.callback(None,data)

async def main():
    descriptors = [pty.openpty(),pty.openpty()]
    for _,s in descriptors: tty.setraw(s)
    a,b = SimulatedGatt(), SimulatedGatt(); a.other=b; b.other=a
    adapters = [BluetoothSerial(g,m) for g,(m,s) in zip([a,b],descriptors)]
    loop = asyncio.get_running_loop()
    def stop():
        for adapter in adapters: adapter.closed.set()
    def toggle(): a.connected=b.connected=not a.connected
    loop.add_signal_handler(signal.SIGTERM,stop)
    loop.add_signal_handler(signal.SIGUSR1,toggle)
    ready = [asyncio.Event(),asyncio.Event()]
    tasks = [asyncio.create_task(adapter.run(event.set)) for adapter,event in zip(adapters,ready)]
    try:
        await asyncio.gather(*(e.wait() for e in ready))
        print(json.dumps({'left':os.ttyname(descriptors[0][1]),'right':os.ttyname(descriptors[1][1]),'gatt':'SIMULATED'}),flush=True)
        await asyncio.gather(*tasks)
    finally:
        stop()
        for task in tasks: task.cancel()
        await asyncio.gather(*tasks,return_exceptions=True)
        for pair in descriptors:
            for fd in pair: os.close(fd)

asyncio.run(main())
