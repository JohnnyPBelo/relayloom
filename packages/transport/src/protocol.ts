// Portable routing envelope shared by native sockets and browser adapters.
export type Priority = "sos" | "normal" | "bulk";
export interface Packet {
  id: string;
  source: string;
  created: number;
  expires: number;
  maxHops: number;
  hops: string[];
  priority: Priority;
  payload: unknown;
}
