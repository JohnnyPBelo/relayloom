import { exactShape } from "../../core/src/protocol";
import { parseContributionFormLookup } from "./contribution-context";
import type { ContributionCreationRequest } from "./contribution-operations";
/** Closed command parser. Request payload is captured by the operation parser
 * before asynchronous work; a client never supplies source or policy context. */
export function contributionCommandShape(value: any) {
  if (value?.action === "form") return parseContributionFormLookup(value);
  if (
    value?.action === "reject" &&
    exactShape(value, ["action", "id", "revision", "reason"]) &&
    typeof value.id === "string" &&
    /^[a-f0-9]{64}$/.test(value.id) &&
    Number.isSafeInteger(value.revision) &&
    value.revision >= 0 &&
    typeof value.reason === "string" &&
    value.reason.length <= 512
  )
    return {
      action: "reject" as const,
      id: value.id as string,
      revision: value.revision as number,
      reason: value.reason as string,
    };
  if (
    value?.action === "dismiss" &&
    exactShape(value, ["action", "id", "revision"]) &&
    typeof value.id === "string" &&
    /^[a-f0-9]{64}$/.test(value.id) &&
    Number.isSafeInteger(value.revision) &&
    value.revision >= 0
  )
    return {
      action: "dismiss" as const,
      id: value.id as string,
      revision: value.revision as number,
    };
  if (
    value?.action === "obtain-source" &&
    exactShape(value, ["action", "id"]) &&
    typeof value.id === "string" &&
    /^[a-f0-9]{64}$/.test(value.id)
  )
    return { action: "obtain-source" as const, id: value.id as string };
  if (
    ["state", "inbox"].includes(value?.action) &&
    exactShape(value, ["action"])
  )
    return { action: value.action } as
      { action: "state" } | { action: "inbox" };
  if (
    ["operation", "resume", "cancel"].includes(value?.action) &&
    exactShape(value, ["action", "sequence", "operationId"]) &&
    Number.isSafeInteger(value.sequence) &&
    value.sequence > 0 &&
    typeof value.operationId === "string" &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
      value.operationId,
    )
  )
    return {
      action: value.action,
      sequence: value.sequence,
      operationId: value.operationId,
    } as {
      action: "operation" | "resume" | "cancel";
      sequence: number;
      operationId: string;
    };
  if (
    value?.action === "submit" &&
    exactShape(value, [
      "action",
      "sequence",
      "operationId",
      "snapshotId",
      "pageId",
      "formId",
      "values",
      "publicationScope",
      "ttlMs",
    ])
  )
    return value as ContributionCreationRequest & { action: "submit" };
  throw Error("Comando de proposta inválido");
}
