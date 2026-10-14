import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  canonicalJSON,
  generateIssuerKeys,
  hashEvent,
  hashEventWeb,
  importEd25519PrivateKey,
  importEd25519PublicKey,
  issueAttestation,
  score,
  seal,
  sealWeb,
  signCanonicalWeb,
  signMandate,
  verifyCanonicalWeb,
  verifyChain,
  verifyChainWeb,
  verifyMandate,
  type Mandate,
  type ZHCEvent,
} from "../src/index.ts";
import { FIXTURE_AS_OF, manifest, zh3Company } from "./fixtures.ts";

test("canonical JSON matches the published vectors", () => {
  const vectors = JSON.parse(readFileSync(new URL("./vectors/canonical.json", import.meta.url), "utf8")) as { name: string; input: unknown; canonical: string }[];
  for (const v of vectors) assert.equal(canonicalJSON(v.input), v.canonical, v.name);
  assert.throws(() => canonicalJSON({ x: Number.NaN }), /non-finite/);
});

test("Web Crypto and node:crypto chains are byte-identical", async () => {
  const raw = zh3Company().slice(0, 30);
  const nodeChain: ZHCEvent[] = [];
  for (const e of raw) nodeChain.push(seal(e, nodeChain.at(-1)?.hash));
  const webChain: ZHCEvent[] = [];
  for (const e of raw) webChain.push(await sealWeb(e, webChain.at(-1)?.hash));
  assert.deepEqual(webChain, nodeChain);
  assert.equal(await hashEventWeb(nodeChain[7]), hashEvent(nodeChain[7]));
  assert.deepEqual(await verifyChainWeb(nodeChain), verifyChain(nodeChain));
  const tampered = nodeChain.map((e, i) => (i === 3 ? { ...e, ts: "2026-07-09T00:00:00Z" } : e));
  assert.deepEqual(await verifyChainWeb(tampered), { ok: false, brokenAt: 3, reason: "event hash mismatch" });
});

test("mandates are signed over their canonical form and verified with a resolved key", () => {
  const keys = generateIssuerKeys();
  const m: Mandate = {
    zhc: "0.2",
    id: "m-1",
    issuer: "human:owner",
    subject: "agent:billing",
    issued_at: "2026-01-01T00:00:00Z",
    expires_at: "2026-12-31T00:00:00Z",
    scopes: [{ action: "money.refund", limits: { per_action: { amount: 1000, currency: "USD" } } }],
    escalation: { to: "human:owner", timeout_s: 60, on_timeout: "deny" },
  };
  const signed = signMandate(m, keys.privateKey, "owner-2026");
  const resolveKey = (issuer: string, kid?: string) => (issuer === "human:owner" && kid === "owner-2026" ? keys.publicKeyPem : undefined);
  assert.deepEqual(verifyMandate(signed, resolveKey), { ok: true });
  const widened = { ...signed, scopes: [{ ...signed.scopes[0], limits: { per_action: { amount: 999999, currency: "USD" } } }] };
  assert.equal(verifyMandate(widened, resolveKey).reason, "bad signature");
  assert.equal(verifyMandate(m, resolveKey).reason, "unsigned");
  assert.equal(verifyMandate({ ...signed, issuer: "human:someone-else" }, resolveKey).reason, "issuer key not trusted");
});

test("Web Crypto verifies a node-signed attestation and signs interoperably", async () => {
  const keys = generateIssuerKeys();
  const { profile } = score(zh3Company(), manifest, { asOf: FIXTURE_AS_OF, chainVerified: true });
  const a = issueAttestation({ issuer: "did:web:v.example", profile, evidenceHead: "h", now: "2026-09-01T00:00:00Z", privateKey: keys.privateKey });
  const pub = await importEd25519PublicKey(keys.publicKeyPem);
  assert.equal(await verifyCanonicalWeb(a.payload, a.signature, pub), true);
  assert.equal(await verifyCanonicalWeb({ ...a.payload, subject: "x" }, a.signature, pub), false);
  const priv = await importEd25519PrivateKey(keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString());
  const sig = await signCanonicalWeb({ hello: "world" }, priv);
  assert.equal(await verifyCanonicalWeb({ hello: "world" }, sig, pub), true);
});

// --- Found while building the first real service on the protocol (W-findings) --------------------

test("W02: chain helpers seal any record and verify a segment from a head you hold", async () => {
  const { sealWeb: sw, verifyChainWeb: vw, extendsHead } = await import("../src/index.ts");
  type Check = { prev?: string; hash?: string; monitor: string; ok: boolean; at: string };
  const checks: Check[] = [];
  for (let i = 0; i < 6; i++) checks.push(await sw<Check>({ monitor: "m1", ok: i !== 3, at: `2026-10-01T00:0${i}:00Z` }, checks.at(-1)?.hash));
  assert.equal((await vw(checks)).ok, true);
  const held = checks[2].hash!;
  assert.deepEqual(await vw(checks.slice(3), held), { ok: true, head: checks[5].hash });
  assert.equal((await vw(checks.slice(3), checks[1].hash)).reason, "prev hash mismatch");
  assert.equal(verifyChain(checks).ok, true, "node and Web Crypto agree on non-event records");
  assert.equal(extendsHead(checks, { head: held, events: 3 }), true);
  assert.equal(extendsHead(checks, { head: held, events: 4 }), false);
});

test("W03: evidence heads are signed with evidence keys only", async () => {
  const { signHead, verifyHead, evidenceKeyResolver, mandateKeyResolver } = await import("../src/index.ts");
  const ev = generateIssuerKeys();
  const owner = generateIssuerKeys();
  const company = {
    id: "did:web:co.example",
    evidence_keys: [{ id: "e1", alg: "Ed25519" as const, public_key_pem: ev.publicKeyPem }],
    signing_keys: [{ id: "k1", holder: "human:h", alg: "Ed25519" as const, public_key_pem: owner.publicKeyPem }],
  };
  const head = signHead({ company: company.id, head: "a".repeat(64), events: 704, at: "2026-10-01T00:00:00Z" }, ev.privateKey, "e1");
  assert.deepEqual(verifyHead(head, evidenceKeyResolver(company)), { ok: true });
  assert.equal(verifyHead({ ...head, payload: { ...head.payload, events: 703 } }, evidenceKeyResolver(company)).reason, "bad signature");
  const byMandateKey = signHead({ company: company.id, head: "a".repeat(64), events: 704, at: "2026-10-01T00:00:00Z" }, owner.privateKey, "k1");
  assert.equal(verifyHead(byMandateKey, evidenceKeyResolver(company)).ok, false, "a mandate key can't sign the books' head");
  assert.equal(mandateKeyResolver(company)("did:web:co.example", "e1"), undefined, "an evidence key can't sign a mandate");
});
