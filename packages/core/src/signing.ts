// Mandate signatures (PROTOCOL §3.5). Node only (node:crypto); crypto-web.ts signs and verifies the
// same canonical bytes with Web Crypto.
import { createPublicKey, sign, verify, type KeyObject } from "node:crypto";
import { canonicalJSON } from "./canonical.ts";
import type { KeyResolver } from "./types.ts";
import type { Mandate } from "./mandate.ts";

/** The bytes a mandate signature covers: the mandate without its `signature`. */
export function mandateSigningInput(m: Mandate): string {
  const { signature: _ignored, ...rest } = m;
  return canonicalJSON(rest);
}

export function signMandate(m: Mandate, privateKey: KeyObject, kid: string): Mandate {
  const sig = sign(null, Buffer.from(mandateSigningInput(m)), privateKey).toString("base64url");
  return { ...m, signature: { alg: "Ed25519", kid, sig } };
}

/** Verify with the issuer's key, resolved from a source you trust. */
export function verifyMandate(m: Mandate, resolveKey: KeyResolver): { ok: boolean; reason?: string } {
  if (!m.signature) return { ok: false, reason: "unsigned" };
  if (m.signature.alg !== "Ed25519") return { ok: false, reason: `unsupported algorithm ${m.signature.alg}` };
  const pem = resolveKey(m.issuer, m.signature.kid);
  if (!pem) return { ok: false, reason: "issuer key not trusted" };
  try {
    const ok = verify(null, Buffer.from(mandateSigningInput(m)), createPublicKey(pem), Buffer.from(m.signature.sig, "base64url"));
    return ok ? { ok } : { ok, reason: "bad signature" };
  } catch {
    return { ok: false, reason: "bad signature" };
  }
}
