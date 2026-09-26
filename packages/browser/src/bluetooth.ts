import type { ReliableMessageStream } from "./rtc";
/** RelayLoom stream GATT, not generic NUS/RNode commands. UUIDs identify capability, not identity. */
export const BLE_SERVICE = "7c9a0001-53b0-4c7d-a15b-96b235e9417b";
export const BLE_RX = "7c9a0002-53b0-4c7d-a15b-96b235e9417b";
export const BLE_TX = "7c9a0003-53b0-4c7d-a15b-96b235e9417b";
export const BLE_INFO = "7c9a0004-53b0-4c7d-a15b-96b235e9417b";
export const BLE_LIMITS = Object.freeze({
  frame: 4096,
  queue: 65536,
  operationMs: 10000,
  connectMs: 20000,
});
export interface BleCharacteristic extends EventTarget {
  readonly properties: { read?: boolean; write?: boolean; indicate?: boolean };
  readonly value?: DataView;
  readValue(): Promise<DataView>;
  writeValueWithResponse(value: Uint8Array<ArrayBuffer>): Promise<void>;
  startNotifications(): Promise<unknown>;
}
export interface BleDevice extends EventTarget {
  readonly id: string;
  readonly gatt?: {
    readonly connected: boolean;
    connect(): Promise<{
      getPrimaryService(
        id: string,
      ): Promise<{ getCharacteristic(id: string): Promise<BleCharacteristic> }>;
    }>;
    disconnect(): void;
  };
}
export interface BrowserBluetooth extends EventTarget {
  requestDevice(options: {
    filters: { services: string[] }[];
  }): Promise<BleDevice>;
  getDevices?: () => Promise<BleDevice[]>;
}
export function bluetoothAPI(): BrowserBluetooth | undefined {
  return isSecureContext
    ? (navigator as Navigator & { bluetooth?: BrowserBluetooth }).bluetooth
    : undefined;
}
const text = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
// A cancelled platform connect can complete after a replacement acquired the
// same device. Cleanup is scoped to the current local owner of that device ID.
const deviceOwners = new Map<string, BluetoothStream>();
/** Bounded stream over acknowledged GATT writes/indications. Per-connection tags
 * demultiplex BlueZ notifications; tags grant no signing/reading authority. */
export class BluetoothStream
  extends EventTarget
  implements ReliableMessageStream
{
  readonly ordered = true;
  readonly maxPacketLifeTime = null;
  readonly maxRetransmits = null;
  bufferedAmountLowThreshold = 8192;
  #state: RTCDataChannelState = "connecting";
  #tag = crypto.getRandomValues(new Uint8Array(8));
  #rx?: BleCharacteristic;
  #tx?: BleCharacteristic;
  #chunk = 20;
  #partial: number[] = [];
  #queue: { bytes: Uint8Array; allowed: () => boolean }[] = [];
  #buffered = 0;
  #pumping = false;
  #deadline?: ReturnType<typeof setTimeout>;
  #opening: Promise<void>;
  #handshake?: Promise<void>;
  #attempted = false;
  #resolve!: () => void;
  #reject!: (error: Error) => void;
  #operations = new Set<(error: Error) => void>();
  constructor(readonly device: BleDevice) {
    super();
    this.#opening = new Promise((resolve, reject) => {
      this.#resolve = resolve;
      this.#reject = reject;
    });
    // A disconnected initial attempt may be closed before its caller awaits it.
    void this.#opening.catch(() => {});
    device.addEventListener("gattserverdisconnected", this.disconnected);
    this.#deadline = setTimeout(() => this.close(), BLE_LIMITS.connectMs);
  }
  get readyState() {
    return this.#state;
  }
  get bufferedAmount() {
    return this.#buffered;
  }
  private disconnected = () => this.close();
  private ensure() {
    if (this.#state === "closed") throw Error("Bluetooth connection closed");
  }
  private bounded<T>(job: Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const stop = (error: Error) => {
        cleanup();
        reject(error);
      };
      const timer = setTimeout(() => {
        stop(Error("Bluetooth operation timed out"));
        this.close();
      }, BLE_LIMITS.operationMs);
      const cleanup = () => {
        clearTimeout(timer);
        this.#operations.delete(stop);
      };
      this.#operations.add(stop);
      job.then(
        (value) => {
          cleanup();
          resolve(value);
        },
        (error) => {
          cleanup();
          reject(error);
        },
      );
    });
  }
  async connect(): Promise<void> {
    if (this.#attempted) throw Error("Bluetooth connection already attempted");
    this.#attempted = true;
    try {
      this.ensure();
      const gatt = this.device.gatt;
      if (!gatt) throw Error("GATT unavailable");
      if (deviceOwners.has(this.device.id))
        throw Error("Bluetooth device already in use");
      deviceOwners.set(this.device.id, this);
      const connecting = gatt.connect();
      // A platform operation may settle after timeout/lock; never leave a late connection alive.
      void connecting.then(
        () => {
          if (this.#state === "closed" && !deviceOwners.has(this.device.id)) {
            try {
              gatt.disconnect();
            } catch {
              /* Closed platform handle. */
            }
          }
        },
        () => {},
      );
      const server = await this.bounded(connecting);
      this.ensure();
      const service = await this.bounded(server.getPrimaryService(BLE_SERVICE));
      this.ensure();
      const info = await this.bounded(service.getCharacteristic(BLE_INFO));
      this.ensure();
      if (!info.properties.read) throw Error("Incompatible Bluetooth node");
      const raw = await this.bounded(info.readValue());
      this.ensure();
      if (raw.byteLength > 160) throw Error("Invalid Bluetooth capability");
      const meta = JSON.parse(decoder.decode(raw));
      if (
        !meta ||
        Object.keys(meta).sort().join() !== "mtu,protocol" ||
        meta.protocol !== "relayloom-stream-v1" ||
        !Number.isInteger(meta.mtu) ||
        meta.mtu < 20 ||
        meta.mtu > 244
      )
        throw Error("Incompatible Bluetooth protocol");
      this.#chunk = meta.mtu;
      this.#rx = await this.bounded(service.getCharacteristic(BLE_RX));
      this.ensure();
      this.#tx = await this.bounded(service.getCharacteristic(BLE_TX));
      this.ensure();
      if (!this.#rx.properties.write || !this.#tx.properties.indicate)
        throw Error("Reliable Bluetooth stream unavailable");
      this.#tx.addEventListener(
        "characteristicvaluechanged",
        this.notification,
      );
      await this.bounded(this.#tx.startNotifications());
      this.ensure();
      this.#handshake = this.bounded(
        this.#rx.writeValueWithResponse(this.frame(0)),
      );
      await this.#handshake;
      this.ensure();
      await this.#opening;
    } catch (error) {
      this.close();
      throw error;
    }
  }
  private frame(
    kind: number,
    data = new Uint8Array(0),
  ): Uint8Array<ArrayBuffer> {
    const value = new Uint8Array(9 + data.length);
    value.set(this.#tag);
    value[8] = kind;
    value.set(data, 9);
    return value;
  }
  private notification = (event: Event) => {
    if (this.#state === "closed") return;
    try {
      const value = (event.target as unknown as BleCharacteristic).value;
      if (!value || value.byteLength < 9 || value.byteLength > this.#chunk)
        throw Error("Invalid Bluetooth frame");
      const bytes = new Uint8Array(
        value.buffer,
        value.byteOffset,
        value.byteLength,
      );
      // Indications may be visible to other subscribers, but streams must never mix.
      if (this.#tag.some((v, i) => bytes[i] !== v)) return;
      if (
        bytes[8] === 0 &&
        bytes.length === 9 &&
        this.#state === "connecting"
      ) {
        clearTimeout(this.#deadline);
        this.#state = "open";
        this.#resolve();
        this.dispatchEvent(new Event("open"));
        return;
      }
      if (bytes[8] === 2 && bytes.length === 9) {
        this.close();
        return;
      }
      if (bytes[8] !== 1 || bytes.length === 9 || this.#state !== "open")
        throw Error("Invalid Bluetooth stream state");
      for (const byte of bytes.subarray(9)) {
        if (byte === 10) {
          if (!this.#partial.length)
            throw Error("Empty Bluetooth stream frame");
          const line = decoder.decode(Uint8Array.from(this.#partial));
          this.#partial = [];
          this.dispatchEvent(new MessageEvent("message", { data: line }));
          if (this.readyState === "closed") return;
        } else {
          if (this.#partial.length >= BLE_LIMITS.frame)
            throw Error("Bluetooth receive limit");
          this.#partial.push(byte);
        }
      }
    } catch {
      this.dispatchEvent(new Event("error"));
      this.close();
    }
  };
  send(data: string, allowed: () => boolean = () => true): void {
    const bytes = text.encode(data + "\n");
    if (
      this.#state !== "open" ||
      !allowed() ||
      data.includes("\n") ||
      bytes.length < 3 ||
      bytes.length > BLE_LIMITS.frame + 1 ||
      this.#buffered + bytes.length > BLE_LIMITS.queue
    )
      throw Error("Bluetooth send limit");
    this.#queue.push({ bytes, allowed });
    this.#buffered += bytes.length;
    void this.pump();
  }
  private async pump() {
    if (this.#pumping || this.#state !== "open") return;
    this.#pumping = true;
    try {
      // Ready indications can arrive before the ATT write response. Serialize
      // the first packet behind that response as well as all later writes.
      await this.#handshake;
      while (this.#queue.length && this.#state === "open") {
        const job = this.#queue[0];
        for (let at = 0; at < job.bytes.length; at += this.#chunk - 9) {
          // Revocation midway through a line closes the stream; no partial line is reused.
          if (!job.allowed() || this.#state !== "open")
            throw Error("Bluetooth send revoked");
          await this.bounded(
            this.#rx!.writeValueWithResponse(
              this.frame(1, job.bytes.slice(at, at + this.#chunk - 9)),
            ),
          );
        }
        if (this.readyState !== "open") return;
        this.#queue.shift();
        this.#buffered -= job.bytes.length;
        if (this.#buffered <= this.bufferedAmountLowThreshold)
          this.dispatchEvent(new Event("bufferedamountlow"));
      }
    } catch {
      this.dispatchEvent(new Event("error"));
      this.close();
    } finally {
      this.#pumping = false;
    }
  }
  close() {
    if (this.#state === "closed") return;
    this.#state = "closed";
    clearTimeout(this.#deadline);
    this.#reject(Error("Bluetooth connection closed"));
    for (const cancel of this.#operations)
      cancel(Error("Bluetooth connection closed"));
    this.device.removeEventListener(
      "gattserverdisconnected",
      this.disconnected,
    );
    this.#tx?.removeEventListener(
      "characteristicvaluechanged",
      this.notification,
    );
    this.#queue = [];
    this.#partial = [];
    this.#buffered = 0;
    if (deviceOwners.get(this.device.id) === this) {
      deviceOwners.delete(this.device.id);
      try {
        this.device.gatt?.disconnect();
      } catch {
        /* Already unavailable. */
      }
    }
    this.dispatchEvent(new Event("close"));
  }
}
