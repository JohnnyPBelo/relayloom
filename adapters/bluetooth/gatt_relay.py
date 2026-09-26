"""Optional foreground Linux peripheral for browser peers. No BlueZ settings changed.

Run with the project venv and --tcp-port of an owned RelayLoom node. The loopback
port is the native *packet* listener, never the control/UI API. E2E encryption,
signing, relay consent and admission remain in RelayLoom's existing packet router.
"""
import argparse
import asyncio
import contextlib
import json
import re
import signal
import time

SERVICE = '7c9a0001-53b0-4c7d-a15b-96b235e9417b'
RX = '7c9a0002-53b0-4c7d-a15b-96b235e9417b'
TX = '7c9a0003-53b0-4c7d-a15b-96b235e9417b'
INFO = '7c9a0004-53b0-4c7d-a15b-96b235e9417b'
PATH = '/org/relayloom/browsermesh'


def payload_mtu(mtu):
    if type(mtu) is not int or mtu < 23 or mtu > 517:
        raise ValueError('Invalid ATT MTU')
    return min(244, mtu - 3)


class GattRelay:
    """Single central at a time; tags separate notifications seen by subscribers.

    Tags are not authentication. Private packet content is end-to-end encrypted.
    A second central cannot write into an active stream, even by copying its tag.
    """
    def __init__(self, port, indicate):
        if type(port) is not int or not 1 <= port <= 65535:
            raise ValueError('Invalid RelayLoom packet port')
        self.port, self.indicate = port, indicate
        self.session = None
        self.reader_task = None
        self.epoch = 0
        self.opening_device = None
        self.partial = bytearray()
        self.write_lock = asyncio.Lock()
        self.notify_lock = asyncio.Lock()
        self.window, self.frames, self.controls = time.monotonic(), 0, 0
        self.opens = []

    def owns_device(self, device):
        return (self.opening_device is not None and self.opening_device == device) or (
            self.session is not None and self.session['device'] == device)

    async def emit(self, session, kind, data=b''):
        async with self.notify_lock:
            if self.session is not session:
                raise ConnectionError('Stream changed')
            await asyncio.wait_for(self.indicate(session['tag'] + bytes([kind]) + data), 10)

    async def line(self, session, data):
        for offset in range(0, len(data), session['mtu'] - 9):
            await self.emit(session, 1, data[offset:offset + session['mtu'] - 9])

    async def write(self, device, data, mtu=23):
        if self.write_lock.locked():
            raise ConnectionError('Concurrent GATT writes refused')
        async with self.write_lock:
            if not isinstance(device, str) or not device.startswith('/org/bluez/') or len(device) > 256:
                raise ValueError('GATT device required')
            cap = payload_mtu(mtu)
            if len(data) < 9 or len(data) > cap:
                raise ValueError('Invalid GATT frame length')
            tag, kind = bytes(data[:8]), data[8]
            if kind == 0 and len(data) == 9:
                if self.session:
                    raise ConnectionError('RelayLoom peripheral already in use')
                now = time.monotonic()
                self.opens = [t for t in self.opens if now - t < 60]
                if len(self.opens) >= 8:
                    raise ConnectionError('Connection attempt limit')
                self.opens.append(now)
                epoch = self.epoch
                self.opening_device = device
                writer = None
                try:
                    reader, writer = await asyncio.wait_for(asyncio.open_connection('127.0.0.1', self.port, limit=4097), 5)
                    if self.epoch != epoch:
                        raise ConnectionError('Bluetooth session closed during connection')
                    session = {'tag': tag, 'device': device, 'mtu': cap, 'writer': writer}
                    self.session = session
                    await self.emit(session, 0)
                    if self.epoch != epoch or self.session is not session:
                        raise ConnectionError('Bluetooth session closed during indication')
                    self.reader_task = asyncio.create_task(self.read_native(reader, session))
                except BaseException:
                    if self.epoch == epoch:
                        await self.close()
                    elif writer is not None:
                        # The platform operation may finish after disconnection.
                        # Dispose only its own socket, never a replacement session.
                        await self.dispose_writer(writer)
                    raise
                finally:
                    if self.epoch == epoch:
                        self.opening_device = None
                return
            session = self.session
            if not session or device != session['device'] or tag != session['tag']:
                raise ConnectionError('Foreign or stale Bluetooth session')
            if kind == 2 and len(data) == 9:
                await self.close()
                return
            if kind != 1 or len(data) == 9:
                raise ValueError('Invalid GATT stream data')
            try:
                for byte in data[9:]:
                    if byte == 10:
                        raw = bytes(self.partial)
                        self.partial.clear()
                        await self.accept_line(session, raw)
                    else:
                        if len(self.partial) >= 4096:
                            raise ValueError('Stream receive budget')
                        self.partial.append(byte)
            except BaseException:
                await self.close()
                raise

    async def accept_line(self, session, raw):
        now = time.monotonic()
        if now - self.window >= 1:
            self.window, self.frames, self.controls = now, 0, 0
        self.frames += 1
        if self.frames > 8192:
            raise ValueError('Frame rate exceeded')
        value = json.loads(raw.decode('utf8'))
        if not isinstance(value, dict):
            raise ValueError('Invalid frame')
        kind = value.get('t')
        if kind in ('ping', 'drop'):
            self.controls += 1
            if self.controls > 64:
                raise ValueError('Control rate exceeded')
            if kind == 'ping' and set(value) == {'t', 'nonce'} and isinstance(value['nonce'], str) and re.fullmatch('[a-f0-9-]{36}', value['nonce']):
                await self.line(session, (json.dumps({'t': 'pong', 'nonce': value['nonce']}, separators=(',', ':')) + '\n').encode())
                return
            if kind == 'drop' and set(value) == {'t', 'id'} and isinstance(value['id'], str) and re.fullmatch('[a-f0-9]{64}', value['id']):
                # The ordinary native stream has no drop control. Close it so
                # partial assemblies cannot survive a revoked transfer.
                await self.emit(session, 2)
                await self.close()
                return
            raise ValueError('Invalid stream control')
        if kind not in ('part', 'ack'):
            raise ValueError('Unknown stream frame')
        session['writer'].write(raw + b'\n')
        await asyncio.wait_for(session['writer'].drain(), 10)

    async def read_native(self, reader, session):
        try:
            while self.session is session:
                raw = await asyncio.wait_for(reader.readuntil(b'\n'), 120)
                if len(raw) > 4097 or len(raw) < 2:
                    raise ValueError('Native stream frame length')
                await self.line(session, raw)
        except (ConnectionError, OSError, ValueError, asyncio.TimeoutError, asyncio.IncompleteReadError, asyncio.LimitOverrunError):
            with contextlib.suppress(Exception):
                await self.emit(session, 2)
        finally:
            if self.session is session:
                await self.close()

    @staticmethod
    async def dispose_writer(writer):
        writer.close()
        with contextlib.suppress(Exception):
            await asyncio.wait_for(writer.wait_closed(), 5)

    def close(self):
        # Invalidate synchronously, including when the D-Bus callback schedules
        # the returned cleanup coroutine. A late opener must not activate a
        # session between signal receipt and asynchronous cleanup.
        self.epoch += 1
        self.opening_device = None
        session, self.session = self.session, None
        self.partial.clear()
        task, self.reader_task = self.reader_task, None

        async def finish():
            if task and task is not asyncio.current_task():
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
            if session:
                await self.dispose_writer(session['writer'])
        return finish()


async def run(args):
    # Same pinned project dependency used by the existing Bleak adapter.
    from dbus_fast import BusType, Variant, DBusError, MessageType, Message
    from dbus_fast.aio import MessageBus
    from dbus_fast.service import ServiceInterface, method, dbus_property
    from dbus_fast.constants import PropertyAccess

    bus = await MessageBus(bus_type=BusType.SYSTEM).connect()
    stop = asyncio.Event()
    advertisements = application = None
    registered_app = registered_ad = False
    relay = None

    class Service(ServiceInterface):
        def __init__(self): super().__init__('org.bluez.GattService1')
        @dbus_property(access=PropertyAccess.READ)
        def UUID(self) -> 's': return SERVICE
        @dbus_property(access=PropertyAccess.READ)
        def Primary(self) -> 'b': return True
        @dbus_property(access=PropertyAccess.READ)
        def Includes(self) -> 'ao': return []

    class Characteristic(ServiceInterface):
        def __init__(self, uuid, flags):
            super().__init__('org.bluez.GattCharacteristic1')
            self.uuid, self.flags, self.notifying = uuid, flags, False
            self.value = b''
            self.confirmed = asyncio.Event()
        @dbus_property(access=PropertyAccess.READ)
        def UUID(self) -> 's': return self.uuid
        @dbus_property(access=PropertyAccess.READ)
        def Service(self) -> 'o': return PATH + '/service'
        @dbus_property(access=PropertyAccess.READ)
        def Flags(self) -> 'as': return self.flags
        @dbus_property(access=PropertyAccess.READ)
        def Value(self) -> 'ay': return self.value
        @dbus_property(access=PropertyAccess.READ)
        def Notifying(self) -> 'b': return self.notifying
        @method()
        def ReadValue(self, options: 'a{sv}') -> 'ay':
            if self.uuid != INFO: raise DBusError('org.bluez.Error.NotPermitted', 'Not readable')
            cap = payload_mtu(options.get('mtu', Variant('q', 23)).value)
            value = json.dumps({'protocol': 'relayloom-stream-v1', 'mtu': cap}, separators=(',', ':')).encode()
            offset = options.get('offset', Variant('q', 0)).value
            if offset > len(value): raise DBusError('org.bluez.Error.InvalidOffset', 'Invalid offset')
            return value[offset:]
        @method()
        async def WriteValue(self, value: 'ay', options: 'a{sv}'):
            if self.uuid != RX: raise DBusError('org.bluez.Error.NotPermitted', 'Not writable')
            if options.get('offset', Variant('q', 0)).value != 0: raise DBusError('org.bluez.Error.InvalidOffset', 'No prepared writes')
            try:
                await relay.write(options.get('device', Variant('o', '/')).value, bytes(value), options.get('mtu', Variant('q', 23)).value)
            except Exception:
                raise DBusError('org.bluez.Error.Failed', 'RelayLoom stream refused')
        @method()
        def StartNotify(self):
            if self.uuid != TX: raise DBusError('org.bluez.Error.NotSupported', 'No indications')
            self.notifying = True
            self.emit_properties_changed({'Notifying': True})
        @method()
        async def StopNotify(self):
            self.notifying = False
            self.confirmed.set()
            await relay.close()
            self.emit_properties_changed({'Notifying': False})
        @method()
        def Confirm(self): self.confirmed.set()
        async def indicate(self, value):
            if not self.notifying: raise ConnectionError('No indication subscriber')
            self.confirmed.clear()
            self.value = value
            self.emit_properties_changed({'Value': value})
            await asyncio.wait_for(self.confirmed.wait(), 10)

    service = Service()
    info, rx, tx = Characteristic(INFO, ['read']), Characteristic(RX, ['write']), Characteristic(TX, ['indicate'])
    objects = {PATH + '/service': service, PATH + '/service/info': info, PATH + '/service/rx': rx, PATH + '/service/tx': tx}
    relay = GattRelay(args.tcp_port, tx.indicate)

    class Manager(ServiceInterface):
        def __init__(self): super().__init__('org.freedesktop.DBus.ObjectManager')
        @method()
        def GetManagedObjects(self) -> 'a{oa{sa{sv}}}':
            result = {}
            for path, obj in objects.items():
                if obj is service:
                    values = {'UUID': Variant('s', SERVICE), 'Primary': Variant('b', True), 'Includes': Variant('ao', [])}
                else:
                    values = {'UUID': Variant('s', obj.uuid), 'Service': Variant('o', PATH + '/service'),
                              'Flags': Variant('as', obj.flags), 'Value': Variant('ay', obj.value), 'Notifying': Variant('b', obj.notifying)}
                result[path] = {obj.name: values}
            return result

    class Advertisement(ServiceInterface):
        def __init__(self): super().__init__('org.bluez.LEAdvertisement1')
        @dbus_property(access=PropertyAccess.READ)
        def Type(self) -> 's': return 'peripheral'
        @dbus_property(access=PropertyAccess.READ)
        def ServiceUUIDs(self) -> 'as': return [SERVICE]
        @dbus_property(access=PropertyAccess.READ)
        def LocalName(self) -> 's': return 'RelayLoom'
        @method()
        def Release(self): stop.set()

    def disconnected(message):
        if message.message_type == MessageType.SIGNAL and message.interface == 'org.freedesktop.DBus.Properties' and message.member == 'PropertiesChanged' and relay.owns_device(message.path):
            interface, changed, _ = message.body
            if interface == 'org.bluez.Device1' and 'Connected' in changed and not changed['Connected'].value:
                asyncio.create_task(relay.close())
    try:
        adapter = args.adapter
        proxy = bus.get_proxy_object('org.bluez', adapter, await bus.introspect('org.bluez', adapter))
        properties = proxy.get_interface('org.freedesktop.DBus.Properties')
        if not (await properties.call_get('org.bluez.Adapter1', 'Powered')).value:
            raise RuntimeError('Bluetooth adapter is off; no settings changed')
        application = proxy.get_interface('org.bluez.GattManager1')
        advertisements = proxy.get_interface('org.bluez.LEAdvertisingManager1')
        bus.export(PATH, Manager())
        for path, obj in objects.items(): bus.export(path, obj)
        bus.export(PATH + '/advertisement', Advertisement())
        bus.add_message_handler(disconnected)
        match = "type='signal',sender='org.bluez',interface='org.freedesktop.DBus.Properties',member='PropertiesChanged',path_namespace='" + adapter + "'"
        reply = await bus.call(Message(destination='org.freedesktop.DBus', path='/org/freedesktop/DBus', interface='org.freedesktop.DBus', member='AddMatch', signature='s', body=[match]))
        if reply.message_type == MessageType.ERROR: raise RuntimeError('Cannot observe adapter disconnects')
        await application.call_register_application(PATH, {})
        registered_app = True
        await advertisements.call_register_advertisement(PATH + '/advertisement', {})
        registered_ad = True
        loop = asyncio.get_running_loop()
        for sig in (signal.SIGINT, signal.SIGTERM): loop.add_signal_handler(sig, stop.set)
        print(json.dumps({'event': 'ready', 'service': SERVICE, 'physical_transfer_tested': False}), flush=True)
        await stop.wait()
    finally:
        await relay.close()
        if registered_ad:
            with contextlib.suppress(Exception): await advertisements.call_unregister_advertisement(PATH + '/advertisement')
        if registered_app:
            with contextlib.suppress(Exception): await application.call_unregister_application(PATH)
        bus.disconnect()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--tcp-port', type=int, required=True)
    parser.add_argument('--adapter', default='/org/bluez/hci0')
    args = parser.parse_args()
    if not re.fullmatch('/org/bluez/hci[0-9]+', args.adapter): parser.error('Expected a local BlueZ adapter path')
    asyncio.run(run(args))
