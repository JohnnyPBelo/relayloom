// Typed surface of the existing owned-process supervisor reused by fixtures.
// Implementation and its host tests remain in ios-simulator.mjs.
export function stopOwnedProcessGroup(
  pid: number,
  controls?: {
    alive?: () => boolean;
    signal?: (signal: NodeJS.Signals) => void;
    wait?: (milliseconds: number) => Promise<unknown>;
  },
): Promise<void>;
