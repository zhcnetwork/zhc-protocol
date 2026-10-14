// ZH Attestations: an independent validator signs a computed profile over a specific evidence head.
// Ed25519 signatures over canonical JSON. Node only (node:crypto); crypto-web.ts verifies the same
// bytes with Web Crypto. The shape follows the W3C VC data model loosely, so it can be re-wrapped as
// a VC or anchored as an ERC-8004 validation entry.
//
// v0.2.1: verification trusts only keys the caller resolves from the issuer's own manifest or DID
// document. The key carried in an attestation is a hint and is never used to verify it.
import { createPublicKey, generateKeyPairSync, sign, verify, type KeyObject } from "node:crypto";
import { canonicalJSON } from "./canonical.ts";
import { METHOD_VERSION, THRESHOLDS } from "./model.ts";
import type { AttestedFacts } from "./mandate.ts";
import type { Profile } from "./types.ts";

export { METHOD_VERSION } from "./model.ts";

import type { KeyResolver } from "./types.ts";
export type { KeyResolver } from "./types.ts";

export interface AttestationPayload {
  type: "ZHAttestation";
  spec: "0.2";
  method: string;
  issuer: string;
  /** Key id the issuer signed with; resolve it from the issuer's manifest (`validator_keys`). */
  kid?: string;
  subject: string;
  profile: Profile;
  evidence: { head: string; events: number; from: string; to: string };
  /** sha256 of the canonical manifest the profile was computed against. */
  manifest_sha256?: string;
  /** The validator's relationship to the subject (PROTOCOL §6). */
  independence?: { common_control: boolean; fee_depends_on_outcome: boolean; note?: string };
  issued_at: string;
  expires_at: string;
}

export interface Attestation {
  payload: AttestationPayload;
  /** base64url Ed25519 signature over canonicalJSON(payload). */
  signature: string;
  /** Convenience copy of the issuer key. Never trusted for verification. */
  public_key?: string;
}

export function generateIssuerKeys(): { privateKey: KeyObject; publicKeyPem: string } {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return { privateKey, publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString() };
}

export function issueAttestation(args: {
  issuer: string;
  kid?: string;
  profile: Profile;
  evidenceHead: string;
  privateKey: KeyObject;
  publicKeyPem?: string;
  now?: string;
  manifestSha256?: string;
  independence?: AttestationPayload["independence"];
}): Attestation {
  const { profile } = args;
  if (!profile.window) throw new Error("profile has no evidence window");
  if (profile.assurance !== "measured") throw new Error(`only measured profiles can be attested (got ${profile.assurance})`);
  if (profile.company === args.issuer) throw new Error("validators must not attest their own company");
  if (args.independence?.common_control) throw new Error("validators must not attest a company under common control");
  if (args.independence?.fee_depends_on_outcome) throw new Error("a validator's fee must not depend on the profile it issues");
  const issued = args.now ? new Date(args.now) : new Date();
  if (!Number.isFinite(issued.getTime())) throw new Error("invalid issue time");
  const expires = new Date(issued.getTime() + THRESHOLDS.attestation_ttl_days * 86_400_000);
  const payload: AttestationPayload = {
    type: "ZHAttestation",
    spec: "0.2",
    method: profile.method ?? METHOD_VERSION,
    issuer: args.issuer,
    kid: args.kid,
    subject: profile.company,
    profile: { ...profile, assurance: "attested" },
    evidence: { head: args.evidenceHead, events: profile.window.events, from: profile.window.from, to: profile.window.to },
    manifest_sha256: args.manifestSha256,
    independence: args.independence,
    issued_at: issued.toISOString(),
    expires_at: expires.toISOString(),
  };
  const signature = sign(null, Buffer.from(canonicalJSON(payload)), args.privateKey).toString("base64url");
  return { payload, signature, public_key: args.publicKeyPem };
}

export interface VerifyOptions {
  /** Resolve the issuer's key from a source you trust (its manifest's validator_keys, a DID document). */
  resolveKey: KeyResolver;
  /** Verification time; defaults to now. */
  now?: string;
  /** Allowed clock skew for the issue time, seconds. Default 300. */
  maxSkewSeconds?: number;
}

export function verifyAttestation(a: Attestation, opts: VerifyOptions): { ok: boolean; reason?: string } {
  if (!opts || typeof opts.resolveKey !== "function") {
    return { ok: false, reason: "a key resolver is required; the key inside an attestation is never trusted" };
  }
  const p = a?.payload;
  if (!p || p.type !== "ZHAttestation" || p.spec !== "0.2") return { ok: false, reason: "not a v0.2 ZH attestation" };
  if (p.issuer === p.subject) return { ok: false, reason: "self-attestation" };
  if (p.profile?.company !== p.subject) return { ok: false, reason: "profile company does not match subject" };
  if (p.profile?.assurance !== "attested") return { ok: false, reason: "profile is not marked attested" };
  if (p.independence && (p.independence.common_control !== false || p.independence.fee_depends_on_outcome !== false)) {
    return { ok: false, reason: "the validator says it isn't independent of the subject" };
  }
  const pem = opts.resolveKey(p.issuer, p.kid);
  if (!pem) return { ok: false, reason: "issuer key not trusted" };
  let valid = false;
  try {
    valid = verify(null, Buffer.from(canonicalJSON(p)), createPublicKey(pem), Buffer.from(a.signature, "base64url"));
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, reason: "bad signature" };
  const now = opts.now ? Date.parse(opts.now) : Date.now();
  const issued = Date.parse(p.issued_at);
  const expires = Date.parse(p.expires_at);
  if (!Number.isFinite(now) || !Number.isFinite(issued) || !Number.isFinite(expires)) return { ok: false, reason: "invalid time" };
  const skew = (opts.maxSkewSeconds ?? 300) * 1000;
  if (issued > now + skew) return { ok: false, reason: "issued in the future" };
  if (expires <= issued) return { ok: false, reason: "expires before it was issued" };
  // Skew applies only to comparing the issue time with our clock, never to the allowed validity.
  if (expires - issued > THRESHOLDS.attestation_ttl_days * 86_400_000) return { ok: false, reason: "validity longer than allowed" };
  if (now >= expires) return { ok: false, reason: "expired" };
  return { ok: true };
}

/**
 * Turn a verified attestation into facts a progression rule may use to widen a mandate. Returns
 * undefined unless the attestation verifies with a trusted key and is about `subject`.
 */
export function attestedFacts(a: Attestation, opts: VerifyOptions & { subject: string }): AttestedFacts | undefined {
  if (!verifyAttestation(a, opts).ok || a.payload.subject !== opts.subject) return undefined;
  const p = a.payload;
  return {
    kind: "verified-attestation",
    issuer: p.issuer,
    subject: p.subject,
    expires_at: p.expires_at,
    values: { level: p.profile.level, integrity: p.profile.integrity, ...Object.fromEntries(Object.entries(p.profile.axes).map(([k, v]) => [`axis_${k}`, v])) },
  };
}
