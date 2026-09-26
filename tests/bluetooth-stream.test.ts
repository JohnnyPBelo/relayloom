import test from "node:test";
import assert from "node:assert/strict";
import {
  BluetoothStream,
  BLE_INFO,
  BLE_RX,
  BLE_TX,
  BLE_SERVICE,
  type BleDevice,
  type BleCharacteristic,
} from "../packages/browser/src/bluetooth";
import { BluetoothDiscovery } from "../packages/browser/src/bluetooth-discovery";
import {
  bluetoothGrants,
  type BluetoothGrants,
} from "../packages/browser/src/bluetooth-grants";
import { BrowserRouter } from "../packages/browser/src/router";
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
class Characteristic extends EventTarget implements BleCharacteristic {
  properties = { read: true, write: true, indicate: true };
  value?: DataView;
  constructor(
    private read: () => Uint8Array = () => new Uint8Array(),
    private write: (v: Uint8Array) => Promise<void> = async () => {},
  ) {
    super();
  }
  async readValue() {
    const b = this.read();
    return new DataView(b.buffer, b.byteOffset, b.byteLength);
  }
  async writeValueWithResponse(value: Uint8Array<ArrayBuffer>) {
    await this.write(value);
  }
  async startNotifications() {
    return this;
  }
  emit(bytes: Uint8Array) {
    this.value = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.dispatchEvent(new Event("characteristicvaluechanged"));
  }
}
class Peripheral extends EventTarget implements BleDevice {
  id = crypto.randomUUID();
  chunks: Uint8Array[] = [];
  tag = new Uint8Array(8);
  infoValue = { protocol: "relayloom-stream-v1", mtu: 20 };
  hold?: () => Promise<void>;
  connectHold?: () => Promise<void>;
  openHold?: () => Promise<void>;
  tx = new Characteristic();
  info = new Characteristic(() =>
    new TextEncoder().encode(JSON.stringify(this.infoValue)),
  );
  rx = new Characteristic(undefined, async (value) => {
    if (value[8] === 0) {
      this.tag = value.slice(0, 8);
      this.tx.emit(value);
      await this.openHold?.();
    } else {
      this.chunks.push(value.slice());
      await this.hold?.();
    }
  });
  gatt = {
    connected: false,
    connect: async () => {
      await this.connectHold?.();
      this.gatt.connected = true;
      return {
        getPrimaryService: async (uuid: string) => {
          assert.equal(uuid, BLE_SERVICE);
          return {
            getCharacteristic: async (uuid: string) => {
              if (uuid === BLE_INFO) return this.info;
              if (uuid === BLE_RX) return this.rx;
              assert.equal(uuid, BLE_TX);
              return this.tx;
            },
          };
        },
      };
    },
    disconnect: () => {
      if (this.gatt.connected) {
        this.gatt.connected = false;
        this.dispatchEvent(new Event("gattserverdisconnected"));
      }
    },
  };
  notify(text: Uint8Array, tag = this.tag) {
    for (let at = 0; at < text.length; at += 11) {
      const value = new Uint8Array(9 + Math.min(11, text.length - at));
      value.set(tag);
      value[8] = 1;
      value.set(text.slice(at, at + 11), 9);
      this.tx.emit(value);
    }
  }
}

test("production Bluetooth stream checks its service and chunks real UTF-8 bytes with acknowledgements and finite budgets", async () => {
  const device = new Peripheral(),
    stream = new BluetoothStream(device),
    received: string[] = [];
  stream.addEventListener("message", (e) =>
    received.push((e as MessageEvent).data),
  );
  try {
    await stream.connect();
    assert.equal(stream.readyState, "open");
    const line = JSON.stringify({ text: "Ligação — português 🇵🇹".repeat(15) });
    stream.send(line);
    for (let i = 0; i < 100 && stream.bufferedAmount; i++) await delay(1);
    assert.equal(stream.bufferedAmount, 0);
    assert.ok(device.chunks.every((c) => c.length <= 20));
    assert.equal(
      Buffer.concat(
        device.chunks.map((c) => Buffer.from(c.slice(9))),
      ).toString(),
      line + "\n",
    );
    device.notify(new TextEncoder().encode(line + "\n"));
    assert.deepEqual(received, [line]);
    device.notify(
      new TextEncoder().encode("ignored\n"),
      new Uint8Array(8).fill(99),
    );
    assert.equal(received.length, 1);
    assert.throws(() => stream.send("x".repeat(4097)), /limit/);
  } finally {
    stream.close();
  }
});
test("incompatible Bluetooth capability and notification-only devices never become packet peers", async () => {
  for (const mode of ["protocol", "indicate"]) {
    const device = new Peripheral(),
      stream = new BluetoothStream(device);
    if (mode === "protocol") device.infoValue.protocol = "rnode-serial";
    else device.tx.properties.indicate = false;
    await assert.rejects(stream.connect());
    assert.equal(stream.readyState, "closed");
    assert.equal(device.gatt.connected, false);
  }
});
test("partial overflow and invalid UTF-8 close the BLE stream before admission", async () => {
  for (const value of [
    new Uint8Array(4097).fill(65),
    new Uint8Array([255, 10]),
  ]) {
    const device = new Peripheral(),
      stream = new BluetoothStream(device),
      received: unknown[] = [];
    stream.addEventListener("message", (e) => received.push(e));
    await stream.connect();
    device.notify(value);
    assert.equal(stream.readyState, "closed");
    assert.equal(received.length, 0);
  }
});
test("revocation during a held GATT write stops subsequent fragments and does not reuse the partial line", async () => {
  const device = new Peripheral(),
    stream = new BluetoothStream(device);
  let resume!: () => void,
    allowed = true;
  device.hold = () =>
    new Promise((resolve) => {
      resume = resolve;
    });
  await stream.connect();
  stream.send("A".repeat(100), () => allowed);
  for (let i = 0; i < 100 && !device.chunks.length; i++) await delay(1);
  assert.equal(device.chunks.length, 1);
  allowed = false;
  resume();
  await delay(10);
  assert.equal(device.chunks.length, 1);
  assert.equal(stream.readyState, "closed");
  assert.equal(stream.bufferedAmount, 0);
});
test("closing while the platform connects fences the late GATT connection", async () => {
  const device = new Peripheral(),
    stream = new BluetoothStream(device);
  let resume!: () => void;
  device.connectHold = () =>
    new Promise((resolve) => {
      resume = resolve;
    });
  const connecting = stream.connect();
  stream.close();
  await assert.rejects(connecting);
  resume();
  await delay(1);
  assert.equal(device.gatt.connected, false);
  assert.equal(device.chunks.length, 0);
});
test("remembered grants reconnect through the router, opt-out prevents attempts, and lock cancels late selection", async () => {
  const router = new BrowserRouter({
    relay: true,
    validate: async () => {},
    receive: async () => {},
  });
  const device = new Peripheral();
  let enabled = false,
    prompts = 0,
    selected!: (v: BleDevice) => void;
  const api = Object.assign(new EventTarget(), {
    getDevices: async () => [device],
    requestDevice: () => {
      prompts++;
      return new Promise<BleDevice>((r) => {
        selected = r;
      });
    },
  });
  const manager = new BluetoothDiscovery(
    router,
    () => enabled,
    () => false,
    {
      load: async () => ({ version: 1, devices: [device.id] }),
      save: async () => {},
    },
    api,
  );
  try {
    await delay(1100);
    assert.equal(manager.state.connected, 0);
    assert.equal(prompts, 0);
    enabled = true;
    await delay(1200);
    assert.equal(manager.state.connected, 1);
    assert.equal(prompts, 0);
    device.gatt.disconnect();
    await delay(1200);
    assert.equal(manager.state.connected, 1);
    const choose = manager.choose();
    assert.equal(prompts, 1);
    manager.close();
    selected(new Peripheral());
    await assert.rejects(choose);
    assert.equal(
      router.peers.filter((p) => p.medium === "bluetooth").length,
      0,
    );
  } finally {
    manager.close();
    router.close();
  }
});

test("the first data frame waits for the acknowledged GATT open write", async () => {
  const device = new Peripheral(),
    stream = new BluetoothStream(device);
  let resume!: () => void;
  device.openHold = () =>
    new Promise((resolve) => {
      resume = resolve;
    });
  const connecting = stream.connect();
  try {
    for (let i = 0; i < 100 && stream.readyState !== "open"; i++)
      await delay(1);
    assert.equal(stream.readyState, "open");
    stream.send("a new packet");
    await delay(5);
    assert.equal(
      device.chunks.length,
      0,
      "must not overlap WriteValueWithResponse operations",
    );
  } finally {
    resume?.();
    await connecting;
    stream.close();
  }
});

test("origin-wide Bluetooth grants alone do not authorise automatic RelayLoom connections", async () => {
  const router = new BrowserRouter({
    relay: true,
    validate: async () => {},
    receive: async () => {},
  });
  const other = new Peripheral();
  let connections = 0;
  const connect = other.gatt.connect;
  other.gatt.connect = async () => {
    connections++;
    return connect();
  };
  const api = Object.assign(new EventTarget(), {
    getDevices: async () => [other],
    requestDevice: async () => {
      throw Error("No RelayLoom chooser was used");
    },
  });
  const manager = new BluetoothDiscovery(
    router,
    () => true,
    () => false,
    { load: async () => null, save: async () => {} },
    api,
  );
  try {
    await delay(1100);
    assert.equal(
      connections,
      0,
      "another page on the same origin may own the browser grant",
    );
  } finally {
    manager.close();
    router.close();
  }
});

test("a late obsolete GATT connect cannot disconnect its replacement stream", async () => {
  const device = new Peripheral(),
    old = new BluetoothStream(device);
  let release!: () => void;
  device.connectHold = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  const opening = old.connect();
  old.close();
  await assert.rejects(opening);
  device.connectHold = undefined;
  const next = new BluetoothStream(device);
  try {
    await next.connect();
    release();
    await delay(5);
    assert.equal(next.readyState, "open");
    assert.equal(device.gatt.connected, true);
  } finally {
    release();
    old.close();
    next.close();
  }
});

test("Bluetooth choices validate bounded opaque IDs without silently replacing malformed data", () => {
  for (const value of [
    null,
    {},
    { version: 1, devices: [], extra: true },
    { version: 1, devices: ["a", "a"] },
    { version: 1, devices: Array.from({ length: 9 }, (_, i) => String(i)) },
    { version: 1, devices: ["\u0000"] },
  ])
    assert.throws(() => bluetoothGrants(value));
  assert.deepEqual(bluetoothGrants({ version: 1, devices: ["z", "a"] }), {
    version: 1,
    devices: ["a", "z"],
  });
});
test("selected nodes persist before connecting, forget stops reconnection, and failed saves never open a new node", async () => {
  const device = new Peripheral(),
    router = new BrowserRouter({
      relay: true,
      validate: async () => {},
      receive: async () => {},
    });
  let value: BluetoothGrants | null = null,
    fail = false,
    selections = 0;
  const store = {
    load: async () => value,
    save: async (v: BluetoothGrants) => {
      if (fail) throw Error("Storage full");
      value = structuredClone(v);
    },
  };
  const api = Object.assign(new EventTarget(), {
    getDevices: async () => [device],
    requestDevice: async () => {
      selections++;
      return device;
    },
  });
  const manager = new BluetoothDiscovery(
    router,
    () => true,
    () => false,
    store,
    api,
  );
  try {
    fail = true;
    const denied = manager.choose();
    assert.equal(selections, 1);
    await assert.rejects(denied, /Storage full/);
    assert.equal(device.gatt.connected, false);
    assert.equal(value, null);
    fail = false;
    await manager.choose();
    assert.deepEqual(value, { version: 1, devices: [device.id] });
    assert.equal(manager.state.connected, 1);
    fail = true;
    await assert.rejects(manager.forget(), /Storage full/);
    assert.equal(manager.state.connected, 1);
    assert.equal(manager.state.authorised, 1);
    fail = false;
    await manager.forget();
    await delay(1100);
    assert.equal(manager.state.connected, 0);
    assert.deepEqual(value, { version: 1, devices: [] });
  } finally {
    manager.close();
    router.close();
  }
});
test("invalid stored choices preserve data and never enumerate or connect origin-wide grants", async () => {
  const router = new BrowserRouter({
    relay: true,
    validate: async () => {},
    receive: async () => {},
  });
  let enumerations = 0,
    writes = 0;
  const api = Object.assign(new EventTarget(), {
    getDevices: async () => {
      enumerations++;
      return [new Peripheral()];
    },
    requestDevice: async () => new Peripheral(),
  });
  const manager = new BluetoothDiscovery(
    router,
    () => true,
    () => false,
    {
      load: async () => ({ malformed: true }),
      save: async () => {
        writes++;
      },
    },
    api,
  );
  try {
    await delay(5);
    assert.equal(manager.state.grantState, "unavailable");
    await assert.rejects(manager.choose());
    assert.equal(enumerations, 0);
    assert.equal(writes, 0);
    assert.equal(router.peers.length, 0);
  } finally {
    manager.close();
    router.close();
  }
});
test("a second stream cannot take over or close an active device lease", async () => {
  const device = new Peripheral(),
    first = new BluetoothStream(device),
    second = new BluetoothStream(device);
  try {
    await first.connect();
    await assert.rejects(second.connect(), /already in use/);
    assert.equal(first.readyState, "open");
    assert.equal(device.gatt.connected, true);
  } finally {
    first.close();
    second.close();
  }
});
