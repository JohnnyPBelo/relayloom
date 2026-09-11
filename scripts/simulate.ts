import {
  ACCEPTANCE_SEED,
  runAcceptanceSuite,
} from "../packages/simulation/src/scenarios.js";

const seed =
  process.argv[2] === undefined ? ACCEPTANCE_SEED : Number(process.argv[2]);
const result = runAcceptanceSuite(seed);
process.stdout.write(
  JSON.stringify(
    {
      ...result,
      limitations: [
        "SIMULATION only: no socket, PTY, radio, operating-system, mobile background or disaster field validation.",
        "Seed controls modeled loss and event scheduling; cryptographic fixtures use production secure randomness.",
        "Production core verifies signatures and encrypted chunks. Transport envelope/frame bounds are imported, but queues, medium MTU segmentation, ACK scheduling and cache behavior are models, not the live Router or ContentStore.",
        "A medium frame is delivered only when every modeled segment survives; retransmission retries the application packet. No claim of BLE, Wi-Fi Direct, LoRa, Reticulum interoperability or measured physical parameters.",
      ],
    },
    null,
    2,
  ) + "\n",
);
if (!result.pass) process.exitCode = 1;
