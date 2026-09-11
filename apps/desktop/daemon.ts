// Bundle the existing node entry point; all transport, storage, authentication and crypto
// remain implemented by that daemon. This bridge only adds graceful child shutdown.
export {};
const parent = (
  process as NodeJS.Process & {
    parentPort?: {
      on(
        event: "message",
        listener: (message: { data: unknown }) => void,
      ): void;
    };
  }
).parentPort;
let loaded = false,
  stopping = false;
parent?.on("message", (message) => {
  if (message.data !== "relayloom:shutdown") return;
  stopping = true;
  if (loaded) process.emit("SIGTERM");
});
await import("../node/src/cli.js");
loaded = true;
if (stopping) process.emit("SIGTERM");
