// ZH Attestations: a validator signs a computed profile over a specific evidence window.
// Ed25519 signatures over canonical JSON. Node only. Shape follows the W3C VC data model loosely
// so it can be re-wrapped as a VC or anchored as an ERC-8004 validation entry.
import { generateKeyPairSync, sign, verify, createPublicKey, type KeyObject } from "node:crypto";
import { canonicalJSON } from "./evidence.ts";
import { THRESHOLDS } from "./model.ts";
import type { Profile } from "./types.ts";

export interface AttestationPayload {
  type: "ZHAttestation";
  spec: "0.2";
  method: string;
  issuer: string;
  subject: string;
  profile: Profile;
  evidence: { head: string; events: number; from: string; to: string };
  issued_at: string;
  expires_at: string;
}

export interface Attestation {
  payload: AttestationPayload;
  /** base64url Ed25519 signature over canonicalJSON(payload). */
  signature: string;
  /** SPKI PEM of the issuer key, for convenience. Verifiers should pin keys from the issuer's manifest. */
  public_key: string;
}

export const METHOD_VERSION = "zhc-score/0.2.0";

export function generateIssuerKeys(): { privateKey: KeyObject; publicKeyPem: string } {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return { privateKey, publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString() };
}

export function issueAttestation(args: {
  issuer: string;
  profile: Profile;
  evidenceHead: string;
  privateKey: KeyObject;
  publicKeyPem: string;
  now?: string;
}): Attestation {
  const { profile } = args;
  if (!profile.window) throw new Error("profile has no evidence window");
  if (profile.assurance !== "measured") throw new Error(`only measured profiles can be attested (got ${profile.assurance})`);
  if (profile.company === args.issuer) throw new Error("validators must not attest their own company");
  const issued = args.now ? new Date(args.now) : new Date();
  const expires = new Date(issued.getTime() + THRESHOLDS.attestation_ttl_days * 86_400_000);
  const payload: AttestationPayload = {
    type: "ZHAttestation",
    spec: "0.2",
    method: METHOD_VERSION,
    issuer: args.issuer,
    subject: profile.company,
    profile: { ...profile, assurance: "attested" },
    evidence: { head: args.evidenceHead, events: profile.window.events, from: profile.window.from, to: profile.window.to },
    issued_at: issued.toISOString(),
    expires_at: expires.toISOString(),
  };
  const signature = sign(null, Buffer.from(canonicalJSON(payload)), args.privateKey).toString("base64url");
  return { payload, signature, public_key: args.publicKeyPem };
}

export function verifyAttestation(a: Attestation, opts: { publicKeyPem?: string; now?: string } = {}): { ok: boolean; reason?: string } {
  const key = createPublicKey(opts.publicKeyPem ?? a.public_key);
  const valid = verify(null, Buffer.from(canonicalJSON(a.payload)), key, Buffer.from(a.signature, "base64url"));
  if (!valid) return { ok: false, reason: "bad signature" };
  const now = opts.now ? Date.parse(opts.now) : Date.now();
  if (now > Date.parse(a.payload.expires_at)) return { ok: false, reason: "expired" };
  return { ok: true };
}
