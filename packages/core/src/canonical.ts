// Canonical JSON for hashing and signing (ZHC-CJSON). Browser-safe, no crypto.
//
// Rules (PROTOCOL §4.2):
// - object keys sorted by UTF-16 code unit order (JavaScript's default sort), recursively;
// - no insignificant whitespace;
// - members whose value is `undefined` are omitted;
// - strings and numbers serialized as JSON.stringify does;
// - non-finite numbers (NaN, Infinity) are rejected, because JSON cannot represent them.
// Cross-language test vectors live in packages/core/test/vectors/canonical.json.

export function canonicalJSON(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("canonical JSON cannot represent non-finite numbers");
    return JSON.stringify(value);
  }
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? "null" : canonicalJSON(v))).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJSON(obj[k])}`).join(",")}}`;
}

/** UTF-8 bytes of the canonical form, ready to hash or sign. */
export function canonicalBytes(value: unknown): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(canonicalJSON(value));
}
