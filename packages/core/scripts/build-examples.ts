// Regenerates /examples from the test fixtures, so every example is reproducible and checked.
//
//   node scripts/build-examples.ts          rewrite the examples
//   node scripts/build-examples.ts --check  fail if any example is out of date
//
// Keys here are derived from published seeds. They are EXAMPLE KEYS: anyone can recompute the
// private half. Never use them for anything real.
import { createHash, createPrivateKey, createPublicKey } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import {
  canonicalJSON,
  formatProfile,
  issueAttestation,
  manifestKeyResolver,
  profileId,
  score,
  seal,
  signMandate,
  verifyAttestation,
  verifyChain,
  verifyMandate,
  type Manifest,
  type Mandate,
  type ZHCEvent,
} from "../src/index.ts";
import { FIXTURE_AS_OF, manifest as testCompany, zh3Company } from "../test/fixtures.ts";

const OUT = new URL("../../../examples/", import.meta.url);
const check = process.argv.includes("--check");
const stale: string[] = [];

function exampleKey(label: string) {
  const seed = createHash("sha256").update(`zhc-protocol example key: ${label}. Published; never use for anything real.`).digest();
  // PKCS#8 wrapper for a raw Ed25519 seed (RFC 8410).
  const der = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]);
  const privateKey = createPrivateKey({ key: der, format: "der", type: "pkcs8" });
  const publicKeyPem = createPublicKey(privateKey).export({ type: "spki", format: "pem" }).toString();
  return { privateKey, publicKeyPem };
}

/** JSON with short objects and arrays kept on one line, for readable examples. */
function pretty(v: unknown, indent = "", col = 0): string {
  const inline = (x: unknown): string => {
    if (Array.isArray(x)) return `[${x.map(inline).join(", ")}]`;
    if (x && typeof x === "object") {
      const e = Object.entries(x).filter(([, y]) => y !== undefined);
      return e.length ? `{ ${e.map(([k, y]) => `${JSON.stringify(k)}: ${inline(y)}`).join(", ")} }` : "{}";
    }
    return JSON.stringify(x);
  };
  const one = inline(v);
  if (v === null || typeof v !== "object" || col + one.length <= 110) return one;
  const next = `${indent}  `;
  if (Array.isArray(v)) return `[\n${v.map((x) => next + pretty(x, next, next.length)).join(",\n")}\n${indent}]`;
  const e = Object.entries(v).filter(([, y]) => y !== undefined);
  return `{\n${e
    .map(([k, y]) => {
      const head = `${next}${JSON.stringify(k)}: `;
      return head + pretty(y, next, head.length);
    })
    .join(",\n")}\n${indent}}`;
}

function emit(name: string, text: string) {
  const url = new URL(name, OUT);
  let current = "";
  try {
    current = readFileSync(url, "utf8");
  } catch {}
  if (current === text) return;
  if (check) stale.push(name);
  else writeFileSync(url, text);
}
const emitJSON = (name: string, v: unknown) => emit(name, `${pretty(v)}\n`);
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
function assertOk(label: string, r: { ok: boolean; reason?: string }) {
  if (!r.ok) throw new Error(`${label}: ${r.reason}`);
}

// 1. Evidence: the test company's ~60 days, in time order, hash-chained.
const raw = zh3Company()
  .map((e, i) => ({ e, i }))
  .sort((a, b) => Date.parse(a.e.ts) - Date.parse(b.e.ts) || a.i - b.i)
  .map(({ e }) => e);
const chain: ZHCEvent[] = [];
for (const e of raw) chain.push(seal(e, chain.at(-1)?.hash));
const verified = verifyChain(chain);
assertOk("evidence chain", verified);
emit("events.sample.jsonl", chain.map((e) => JSON.stringify(e)).join("\n") + "\n");
emitJSON("test-company.zhc.json", testCompany);

// 2. Score report, as of just after the last event.
const report = score(chain, testCompany, { asOf: FIXTURE_AS_OF, chainVerified: true });
emit("score-report.sample.json", `${JSON.stringify(report, null, 2)}\n`);

// 3. An independent validator and its attestation of the test company.
const validatorKey = exampleKey("validator.example 2026-09");
const validator: Manifest = {
  zhc: "0.2",
  id: "did:web:validator.example",
  name: "Example Validator",
  url: "https://validator.example",
  legal: { entity_name: "Example Validator (illustrative)", jurisdiction: "US-DE" },
  accountable_human: { name: "Accountable human of record", contact: "accountable@validator.example" },
  charter: {
    mission: "Recompute and attest ZH profiles of companies we have no stake in.",
    reserved_to_human: ["changes to this charter", "dissolution", "scoring method changes"],
    prohibited: ["attesting our own company or one under common control", "fees that depend on the profile issued"],
  },
  domains: ["assessment"],
  agents: [
    { id: "assessor", role: "Verifies evidence and recomputes profiles", domain: "assessment" },
    { id: "reviewer", role: "Approves the release of each attestation", domain: "assessment" },
  ],
  validator_keys: [{ id: "validator-2026-09", alg: "Ed25519", public_key_pem: validatorKey.publicKeyPem }],
};
emitJSON("validator.zhc.json", validator);
const attestation = issueAttestation({
  issuer: validator.id,
  kid: "validator-2026-09",
  profile: report.profile,
  evidenceHead: verified.head!,
  privateKey: validatorKey.privateKey,
  publicKeyPem: validatorKey.publicKeyPem,
  now: "2026-09-01T00:00:00.000Z",
  manifestSha256: sha256(canonicalJSON(testCompany)),
  independence: { common_control: false, fee_depends_on_outcome: false, note: "Example. The subject paid a flat fee agreed before the assessment." },
});
assertOk("attestation", verifyAttestation(attestation, { resolveKey: manifestKeyResolver(validator), now: "2026-09-02T00:00:00.000Z" }));
emit("attestation.sample.json", `${JSON.stringify(attestation, null, 2)}\n`);

// 4. The Rating Desk's billing mandate, signed by its accountable human.
const deskUrl = new URL("rating-desk.zhc.json", OUT);
const desk = JSON.parse(readFileSync(deskUrl, "utf8")) as Manifest;
const ownerKey = exampleKey("ratingdesk accountable human 2026-10");
const deskValidatorKey = exampleKey("ratingdesk validator 2026-10");
desk.signing_keys = [{ id: "accountable-2026-10", holder: "human:accountable", alg: "Ed25519", public_key_pem: ownerKey.publicKeyPem }];
desk.validator_keys = [{ id: "ratingdesk-2026-10", alg: "Ed25519", public_key_pem: deskValidatorKey.publicKeyPem }];
emitJSON("rating-desk.zhc.json", desk);
const mandateUrl = new URL("billing.mandate.json", OUT);
const { signature: _old, ...unsigned } = JSON.parse(readFileSync(mandateUrl, "utf8")) as Mandate;
const mandate = signMandate(unsigned, ownerKey.privateKey, "accountable-2026-10");
assertOk("mandate signature", verifyMandate(mandate, manifestKeyResolver(desk)));
emitJSON("billing.mandate.json", mandate);

if (stale.length) {
  console.error(`out of date: ${stale.join(", ")} (run node scripts/build-examples.ts)`);
  process.exit(1);
}
console.log(`${check ? "examples up to date" : "examples written"}: ${formatProfile(report.profile)} · ${profileId(report.profile)} · head ${verified.head!.slice(0, 16)}…`);
