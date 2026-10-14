// Mandate signatures (PROTOCOL §3.5) and signed evidence heads (§4.2). Node only (node:crypto);
// crypto-web.ts signs and verifies the same canonical bytes with Web Crypto.
import { createPublicKey, sign, verify, type KeyObject } from "node:crypto";
import { canonicalJSON } from "./canonical.ts";
import type { EvidenceHead, KeyResolver, SignedEvidenceHead } from "./types.ts";
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

/** Sign a statement of the company's evidence head with a key from its manifest's `evidence_keys`. */
export function signHead(head: Omit<EvidenceHead, "type" | "spec" | "kid">, privateKey: KeyObject, kid: string): SignedEvidenceHead {
  const payload: EvidenceHead = { type: "ZHEvidenceHead", spec: "0.2", ...head, kid };
  return { payload, signature: sign(null, Buffer.from(canonicalJSON(payload)), privateKey).toString("base64url") };
}

/** Verify a head statement with the company's evidence key (`evidenceKeyResolver(manifest)`). */
export function verifyHead(s: SignedEvidenceHead, resolveKey: KeyResolver): { ok: boolean; reason?: string } {
  const p = s?.payload;
  if (!p || p.type !== "ZHEvidenceHead" || p.spec !== "0.2") return { ok: false, reason: "not a v0.2 evidence head" };
  if (!/^[0-9a-f]{64}$/.test(p.head) || !Number.isInteger(p.events) || p.events < 1 || !Number.isFinite(Date.parse(p.at))) {
    return { ok: false, reason: "malformed head" };
  }
  const pem = resolveKey(p.company, p.kid);
  if (!pem) return { ok: false, reason: "evidence key not trusted" };
  try {
    return verify(null, Buffer.from(canonicalJSON(p)), createPublicKey(pem), Buffer.from(s.signature, "base64url")) ? { ok: true } : { ok: false, reason: "bad signature" };
  } catch {
    return { ok: false, reason: "bad signature" };
  }
}
