// Test-only transport surface, no profile or application RPC.
import * as crypto from "../../packages/browser/src/crypto";
import {
  RtcPeer,
  RtcBundleChannel,
  RTC_LIMITS,
} from "../../packages/browser/src/rtc";
Object.assign(window, {
  rl: { ...crypto, RtcPeer, RtcBundleChannel, RTC_LIMITS },
});
