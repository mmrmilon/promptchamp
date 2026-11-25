// Accept the human-readable address entered by hosts; store a URL-safe slug.
export function normalizeEventAddress(value:unknown) {
  return typeof value==='string'?value.trim().toLowerCase().replace(/\s+/g,'-'):'';
}
