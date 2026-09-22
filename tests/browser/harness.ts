import { BrowserContributionCatalog } from "../../packages/browser/src/contribution-catalog";
import { BrowserContributionRuntime } from "../../packages/browser/src/contribution-runtime";
import { BrowserContributionInbox } from "../../packages/browser/src/contribution-inbox";
import { BrowserSiteCatalog } from "../../packages/browser/src/site-catalog";
import { BrowserResourceCatalog } from "../../packages/browser/src/resource-catalog";
// Test-only exports. Never included in the shipped client or a served control API.
import * as crypto from "../../packages/browser/src/crypto";
import {
  BrowserProfile,
  PRIVATE_VALUE_LIMITS,
} from "../../packages/browser/src/profile";
import {
  RtcPeer,
  RtcBundleChannel,
  RtcTransportPeer,
  RTC_LIMITS,
} from "../../packages/browser/src/rtc";
import { BrowserApplication } from "../../packages/browser/src/application";
import { browserGroupCertificates } from "../../packages/browser/src/group-certificates";
import { browserSiteRevisions } from "../../packages/browser/src/site-revisions";
import { BrowserMesh } from "../../packages/browser/src/mesh";
import * as resources from "../../packages/content/src/site-resource";
import { BrowserRouter } from "../../packages/browser/src/router";
import * as packet from "../../packages/browser/src/packet";
Object.assign(window, {
  rl: {
    ...crypto,
    BrowserApplication,
    groups: browserGroupCertificates,
    sites: browserSiteRevisions,
    ...packet,
    BrowserProfile,
    BrowserSiteCatalog,
    BrowserResourceCatalog,
    BrowserContributionCatalog,
    BrowserContributionRuntime,
    BrowserContributionInbox,
    PRIVATE_VALUE_LIMITS,
    BrowserMesh,
    resources,
    BrowserRouter,
    RtcPeer,
    RtcBundleChannel,
    RtcTransportPeer,
    RTC_LIMITS,
  },
});
