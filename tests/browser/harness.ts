// Test-only exports. Never included in the shipped client or a served control API.
import * as crypto from "../../packages/browser/src/crypto";
import { BrowserProfile } from "../../packages/browser/src/profile";
import {
  RtcPeer,
  RtcBundleChannel,
  RtcTransportPeer,
  RTC_LIMITS,
} from "../../packages/browser/src/rtc";
import { BrowserApplication } from "../../packages/browser/src/application";
import { browserGroupCertificates } from "../../packages/browser/src/group-certificates";
import { BrowserMesh } from "../../packages/browser/src/mesh";
import { BrowserRouter } from "../../packages/browser/src/router";
import * as packet from "../../packages/browser/src/packet";
Object.assign(window, {
  rl: {
    ...crypto,
    BrowserApplication,
    groups: browserGroupCertificates,
    ...packet,
    BrowserProfile,
    BrowserMesh,
    BrowserRouter,
    RtcPeer,
    RtcBundleChannel,
    RtcTransportPeer,
    RTC_LIMITS,
  },
});
