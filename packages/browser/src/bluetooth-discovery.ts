import {
  bluetoothAPI,
  BLE_SERVICE,
  type BrowserBluetooth,
  type BleDevice,
} from "./bluetooth";
import type { BrowserRouter } from "./router";
import {
  bluetoothGrants,
  validBluetoothDeviceId,
  type BluetoothGrants,
  type BluetoothGrantStore,
} from "./bluetooth-grants";
export type BluetoothState = {
  supported: boolean;
  rememberSupported: boolean;
  enabled: boolean;
  authorised: number;
  connected: number;
  connecting: boolean;
  grantState: "loading" | "ready" | "unavailable";
  error: string | null;
};
/** Uses only grants belonging to this origin, never scans arbitrary devices.
 * The first grant is obtained synchronously in the owner's user gesture. */
export class BluetoothDiscovery {
  private stopped = false;
  private devices = new Map<
    string,
    { device: BleDevice; handle?: string; retryAt: number; delay: number }
  >();
  private timer: ReturnType<typeof setInterval>;
  private busy = false;
  private selecting = false;
  private pendingHandle?: string;
  private error: string | null = null;
  private grants?: BluetoothGrants;
  private ready = false;
  private loaded: Promise<void>;
  constructor(
    private router: BrowserRouter,
    private enabled: () => boolean,
    private lowPower: () => boolean,
    private store: BluetoothGrantStore,
    private api: BrowserBluetooth | undefined = bluetoothAPI(),
  ) {
    this.timer = setInterval(() => this.tick(), 1000);
    this.loaded = this.load();
    void this.loaded.then(() => this.restore());
  }
  private async load() {
    try {
      const value = await this.store.load();
      if (!this.stopped)
        this.grants =
          value === null ? { version: 1, devices: [] } : bluetoothGrants(value);
    } catch {
      this.error = "invalid-grants";
    } finally {
      this.ready = true;
    }
  }
  private restore() {
    if (this.stopped || !this.grants?.devices.length || !this.api?.getDevices)
      return;
    void this.api
      .getDevices()
      .then(
        (devices) => {
          if (this.stopped) return;
          for (const device of devices) {
            if (this.grants?.devices.includes(device.id)) this.remember(device);
          }
          this.tick();
        },
        () => {
          this.error = "grants-unavailable";
        },
      )
      .catch(() => {
        this.error = "grants-unavailable";
      });
  }
  get state(): BluetoothState {
    return {
      supported: !!this.api,
      rememberSupported: !!this.api?.getDevices,
      enabled: this.enabled(),
      authorised: this.grants?.devices.length ?? 0,
      connected: this.router.peers.filter(
        (p) => p.medium === "bluetooth" && p.connected,
      ).length,
      connecting: this.busy || this.selecting,
      grantState: !this.ready
        ? "loading"
        : this.grants
          ? "ready"
          : "unavailable",
      error: this.error,
    };
  }
  private remember(device: BleDevice) {
    if (
      !device.gatt ||
      !validBluetoothDeviceId(device.id) ||
      this.devices.has(device.id)
    )
      return;
    if (this.devices.size >= 8) throw Error("Bluetooth device limit");
    this.devices.set(device.id, { device, retryAt: 0, delay: 2000 });
  }
  async choose() {
    if (!this.api || this.stopped || this.selecting || this.busy)
      throw Error("Bluetooth unavailable");
    this.selecting = true;
    try {
      // No await before requestDevice: preserve the browser's transient user activation.
      const device = await this.api.requestDevice({
        filters: [{ services: [BLE_SERVICE] }],
      });
      await this.loaded;
      if (this.stopped) throw Error("Bluetooth session closed");
      if (!this.grants || !device.gatt || !validBluetoothDeviceId(device.id))
        throw Error("Bluetooth grants unavailable");
      if (!this.grants.devices.includes(device.id)) {
        const next = bluetoothGrants({
          version: 1,
          devices: [...this.grants.devices, device.id],
        });
        await this.store.save(next);
        if (this.stopped) throw Error("Bluetooth session closed");
        this.grants = next;
      }
      this.remember(device);
      const entry = this.devices.get(device.id)!;
      await this.connect(entry);
      return { connected: true };
    } finally {
      this.selecting = false;
    }
  }
  async forget() {
    if (this.stopped || this.busy || this.selecting)
      throw Error("Bluetooth session unavailable");
    this.selecting = true;
    try {
      await this.loaded;
      if (!this.grants || this.stopped)
        throw Error("Bluetooth grants unavailable");
      const next: BluetoothGrants = { version: 1, devices: [] };
      await this.store.save(next);
      if (this.stopped) throw Error("Bluetooth session closed");
      this.grants = next;
      for (const entry of this.devices.values())
        if (entry.handle) this.router.disconnect(entry.handle);
      this.devices.clear();
      this.error = null;
    } finally {
      this.selecting = false;
    }
  }
  private async connect(entry: {
    device: BleDevice;
    handle?: string;
    retryAt: number;
    delay: number;
  }) {
    if (this.stopped || this.busy) throw Error("Bluetooth session unavailable");
    if (
      entry.handle &&
      this.router.peers.some((p) => p.id === entry.handle && p.connected)
    )
      return;
    if (entry.handle) this.router.disconnect(entry.handle);
    this.busy = true;
    try {
      const next = this.router.connectBluetooth(entry.device);
      entry.handle = next.id;
      this.pendingHandle = next.id;
      await next.peer.connect();
      if (this.stopped || (!this.selecting && !this.enabled())) {
        this.router.disconnect(next.id);
        throw Error("Bluetooth session closed");
      }
      entry.delay = 2000;
      this.error = null;
    } catch (e) {
      if (entry.handle) this.router.disconnect(entry.handle);
      entry.handle = undefined;
      entry.retryAt = Date.now() + entry.delay;
      entry.delay = Math.min(entry.delay * 2, 60000);
      this.error = "connection-unavailable";
      throw e;
    } finally {
      this.busy = false;
      this.pendingHandle = undefined;
    }
  }
  pausePending() {
    if (!this.selecting && this.pendingHandle)
      this.router.disconnect(this.pendingHandle);
  }
  private tick() {
    if (!this.enabled()) this.pausePending();
    if (
      this.stopped ||
      !this.ready ||
      !this.grants ||
      this.busy ||
      this.selecting ||
      !this.enabled()
    )
      return;
    const peers = this.router.peers;
    if (
      peers.filter((p) => p.medium === "bluetooth" && p.connected).length >=
      (this.lowPower() ? 1 : 2)
    )
      return;
    const entry = [...this.devices.values()].find(
      (e) =>
        e.retryAt <= Date.now() &&
        !peers.some((p) => p.id === e.handle && p.connected),
    );
    if (entry) void this.connect(entry).catch(() => {});
  }
  close() {
    if (this.stopped) return;
    this.stopped = true;
    clearInterval(this.timer);
    for (const entry of this.devices.values())
      if (entry.handle) this.router.disconnect(entry.handle);
    this.devices.clear();
  }
}
