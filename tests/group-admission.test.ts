import test from "node:test";
import { groupAdmissionJourney } from "./fixtures/group-admission.js";

test(
  "real Node receivers hold epoch content until its snapshot arrives and keep only accepted history after closure",
  { timeout: 45000 },
  () => groupAdmissionJourney("node", "node", "node"),
);
