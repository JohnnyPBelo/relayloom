import { nodeCertificateCrypto } from "../../core/src/certificate-crypto";
import { createGroupCertificateProtocol } from "./certificate-protocol";
export * from "./certificate-protocol";

export const {
  memberCardHash,
  verifyGroupAnchor,
  createGroupAnchor,
  verifyGroupEpoch,
  verifyGroupInvitation,
  createGroupInvitation,
  verifyGroupConsent,
  acceptGroupInvitation,
  verifyGroupLeave,
  createGroupLeave,
  verifyGroupSnapshot,
  verifyGroupEpochLink,
  classifyGroupEpochPath,
  verifyGroupTransition,
  verifyGroupSnapshotTransition,
  createAnchoredGroup,
  createGroupSuccessor,
  closeAnchoredGroup,
} = createGroupCertificateProtocol(nodeCertificateCrypto);
