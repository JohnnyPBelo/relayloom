// Android test evidence contains outcomes and fixture identifiers, never keys/capabilities.
const omitted = new Set(['token', 'capability', 'password', 'vault', 'signkey', 'boxkey', 'proof', 'signsecret', 'boxsecret', 'privatekey', 'publickey']);
export function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !omitted.has(key.toLowerCase())).map(([key, item]) => [key, sanitize(item)]));
  return value;
}
export function sanitizeEvents(text) {
  return text.replace(/^INSTRUMENTATION_STATUS: event=(\{.*\})$/gm, (line, json) => {
    try { return 'INSTRUMENTATION_STATUS: event=' + JSON.stringify(sanitize(JSON.parse(json))); }
    catch { return 'INSTRUMENTATION_STATUS: event=[unparseable event omitted]'; }
  }).replace(/([#?]token=|Bearer )[A-Za-z0-9_-]+/g, '$1[REDACTED]');
}
