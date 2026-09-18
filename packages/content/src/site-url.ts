// Shared lexical URL policy for page links and structured cells.
export function safeSiteUrl(value: string): boolean {
  // One lexical policy in TS and Go; WHATWG URL and net/url disagree on
  // malformed escapes, whitespace and abbreviated/octal IPv4 addresses.
  const parts =
    /^https:\/\/([A-Za-z0-9.-]+)(?::([0-9]{1,5}))?(?:[/?#].*)?$/u.exec(value);
  if (
    !parts ||
    value.length > 2000 ||
    parts[1].length > 253 ||
    /[\p{White_Space}\uFEFF\\\u0000-\u001f\u007f]/u.test(value) ||
    /%(?![0-9a-f]{2})/i.test(value) ||
    Number(parts[2] ?? 443) > 65535
  )
    return false;
  const labels = parts[1].split(".");
  if (
    labels.some(
      (label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label),
    )
  )
    return false;
  if (/^(?:[0-9]+|0x[0-9a-f]*)$/i.test(labels.at(-1)!))
    return (
      labels.length === 4 &&
      labels.every(
        (label) =>
          /^(?:0|[1-9][0-9]{0,2})$/.test(label) && Number(label) <= 255,
      )
    );
  return true;
}
