import { ProfileOwnership } from "../../packages/profile/src/ownership.js";
try {
  const ownership = new ProfileOwnership(process.argv[2]);
  process.send?.({ ready: true });
  process.once("message", (message: any) => {
    if (message.crash) process.exit(75);
    ownership.close();
    process.disconnect();
  });
} catch (error) {
  process.send?.({ error: (error as Error).message });
  process.disconnect();
}
