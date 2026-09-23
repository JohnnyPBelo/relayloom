import { createRejectionOperations } from "../../packages/sites/src/contribution-rejection-operations";
import { createContributionInboxProtocol } from "../../packages/sites/src/contribution-inbox";
import { createSiteContributionProtocol } from "../../packages/sites/src/contribution-protocol";
import { createContributionReceiptProtocol } from "../../packages/sites/src/contribution-receipt";
import { createReceiptOperations } from "../../packages/sites/src/contribution-receipt-operations";
import { browserCertificateCrypto } from "../../packages/browser/src/certificate-crypto";
import { BrowserContributionCatalog } from "../../packages/browser/src/contribution-catalog";
import { BrowserContributionRuntime } from "../../packages/browser/src/contribution-runtime";
import {
  BrowserContributionInbox,
  ContributionInboxIntegrityError,
} from "../../packages/browser/src/contribution-inbox";
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
    rejectionOperations: createRejectionOperations(browserCertificateCrypto),
    receiptOperations: createReceiptOperations(browserCertificateCrypto),
    inboxProtocol: createContributionInboxProtocol(browserCertificateCrypto),
    proposalProtocol: createSiteContributionProtocol(browserCertificateCrypto),
    receiptProtocol: createContributionReceiptProtocol(
      browserCertificateCrypto,
    ),
    certificateCrypto: browserCertificateCrypto,
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
    ContributionInboxIntegrityError,
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
