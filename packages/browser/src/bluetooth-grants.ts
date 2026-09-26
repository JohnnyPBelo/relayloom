import { exactShape } from "../../core/src/protocol";
export const BLUETOOTH_GRANTS_KEY = "bluetooth-nodes";
export type BluetoothGrants = { version: 1; devices: string[] };
export interface BluetoothGrantStore {
  load(): Promise<unknown>;
  save(value: BluetoothGrants): Promise<void>;
}
export function validBluetoothDeviceId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 512 &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}
export function bluetoothGrants(value: unknown): BluetoothGrants {
  if (
    !exactShape(value, ["version", "devices"]) ||
    (value as BluetoothGrants).version !== 1 ||
    !Array.isArray((value as BluetoothGrants).devices) ||
    (value as BluetoothGrants).devices.length > 8 ||
    (value as BluetoothGrants).devices.some(
      (id) => !validBluetoothDeviceId(id),
    ) ||
    new Set((value as BluetoothGrants).devices).size !==
      (value as BluetoothGrants).devices.length
  )
    throw Error("Escolhas Bluetooth inválidas");
  return {
    version: 1,
    devices: [...(value as BluetoothGrants).devices].sort(),
  };
}
