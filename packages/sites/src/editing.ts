import { canonical, exactShape } from "../../core/src/protocol";
import { parseSiteAddress } from "./protocol";

/** Local encrypted draft metadata. This is never included in a signed site's
 * payload and does not confer publishing authority. The catalog still applies CAS. */
export interface SiteEditingContext {
  domain: "relayloom/site-editing/1";
  address: string;
  base: string;
  sequence: number;
  recipients: "public" | string[];
  ttlMs: number;
  pending?: {
    operationId: string;
    requestHash: string;
    confirmedHeads?: string[];
  };
}
const digest = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
function denseIDs(value: unknown): value is string[] {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length > 128
  )
    return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return (
    Reflect.ownKeys(value).length === value.length + 1 &&
    Array.from(
      { length: value.length },
      (_, i) => descriptors[String(i)],
    ).every((d) => d && "value" in d)
  );
}
export function validateSiteEditingContext(
  value: unknown,
  ownerId: string,
): SiteEditingContext {
  const invalid = () => {
    throw new Error("Contexto do rascunho inválido");
  };
  const fields = [
    "domain",
    "address",
    "base",
    "sequence",
    "recipients",
    "ttlMs",
  ];
  if (!exactShape(value, fields) && !exactShape(value, [...fields, "pending"]))
    invalid();
  const v = value as SiteEditingContext;
  if (
    v.domain !== "relayloom/site-editing/1" ||
    !digest(ownerId) ||
    parseSiteAddress(v.address).ownerId !== ownerId ||
    !digest(v.base) ||
    !Number.isSafeInteger(v.sequence) ||
    v.sequence < 1
  )
    invalid();
  if (
    !Number.isSafeInteger(v.ttlMs) ||
    v.ttlMs < 1000 ||
    v.ttlMs > 365 * 86400_000 ||
    (v.recipients !== "public" &&
      (!denseIDs(v.recipients) ||
        v.recipients.length > 63 ||
        v.recipients.some(
          (id, i, a) =>
            !digest(id) || id === ownerId || (i > 0 && a[i - 1] >= id),
        )))
  )
    invalid();
  if (Object.hasOwn(v, "pending")) {
    const p = v.pending!;
    if (
      !exactShape(p, ["operationId", "requestHash"]) &&
      !exactShape(p, ["operationId", "requestHash", "confirmedHeads"])
    )
      invalid();
    if (
      typeof p.operationId !== "string" ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
        p.operationId,
      ) ||
      !digest(p.requestHash)
    )
      invalid();
    if (
      Object.hasOwn(p, "confirmedHeads") &&
      (!denseIDs(p.confirmedHeads) ||
        p.confirmedHeads.length < 2 ||
        p.confirmedHeads.length > 128 ||
        p.confirmedHeads.some(
          (id, i, a) => !digest(id) || (i > 0 && a[i - 1] >= id),
        ))
    )
      invalid();
  }
  return JSON.parse(canonical(v));
}
