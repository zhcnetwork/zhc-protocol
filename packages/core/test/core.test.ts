import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyProgression,
  attestedFacts,
  claimedProfile,
  compositeLevel,
  evaluate,
  formatProfile,
  generateIssuerKeys,
  isAttenuationOf,
  issueAttestation,
  METHOD_VERSION,
  parseProfile,
  profileId,
  score,
  scoreIntegrity,
  seal,
  verifyAttestation,
  verifyChain,
  type Mandate,
  type ZHCEvent,
} from "../src/index.ts";
import { COMPANY, FIXTURE_AS_OF, manifest, zh3Company } from "./fixtures.ts";

const asOf = FIXTURE_AS_OF;

test("composite level is gated by the weakest of O, D, F and R", () => {
  assert.deepEqual(compositeLevel({ O: 4, D: 4, F: 1, R: 3 }), { level: 2, limited_by: ["F"] });
  assert.equal(compositeLevel({ O: 5, D: 5, F: 5, R: 4 }).level, 5);
  assert.equal(compositeLevel({ O: 0, D: 0, F: 0, R: 0 }).level, 0);
});

test("a single-product company can reach ZH5, and N doesn't gate it", () => {
  const p = parseProfile("ZH5·A [O5 D5 F5 R4] N0 S2");
  assert.equal(p.level, 5);
  assert.equal(p.scope, 2);
  assert.equal(p.axes.N, 0);
});

test("profile strings round-trip and reject false claims", () => {
  const p = { level: 3 as const, integrity: "B" as const, axes: { O: 3, D: 2, F: 2, R: 2, N: 1 } as const, scope: 2 as const, assurance: "measured" as const };
  const s = formatProfile(p);
  assert.equal(s, "ZH3·B [O3 D2 F2 R2] N1 S2 measured");
  assert.deepEqual(parseProfile(s), { ...p, method: METHOD_VERSION });
  assert.equal(profileId(p), "zh0.2.1/3/B/O3D2F2R2/N1/S2/measured");
  assert.throws(() => parseProfile("ZH4·B [O3 D2 F2 R2] N1 S2"), /compute to ZH3/);
});

test("legacy v0.2.0 profile strings still parse, validated under the gates they were written with", () => {
  const legacy = parseProfile("ZH3·B [O3 D2 F2 R2 N1] S2 measured");
  assert.equal(legacy.level, 3);
  assert.equal(legacy.method, "zhc-score/0.2.0");
  // Under v0.2.0, N0 held this company at ZH2.
  assert.equal(parseProfile("ZH2·B [O3 D2 F2 R2 N0] S2").level, 2);
  assert.throws(() => parseProfile("ZH3·B [O3 D2 F2 R2 N0] S2"), /compute to ZH2/);
});

test("no evidence scores ZH0, unrated, provisional", () => {
  const r = score([], manifest, { asOf: "2026-09-01T00:00:00Z" });
  assert.equal(r.profile.level, 0);
  assert.equal(r.profile.integrity, "U");
  assert.equal(r.profile.assurance, "provisional");
  assert.equal(r.profile.method, METHOD_VERSION);
});

test("synthetic business operator scores ZH3 and names the limiting axes", () => {
  const r = score(zh3Company(), manifest, { asOf, chainVerified: true });
  assert.deepEqual(r.profile.axes, { O: 3, D: 2, F: 2, R: 2, N: 1 });
  assert.equal(formatProfile(r.profile), "ZH3·A [O3 D2 F2 R2] N1 S2 measured");
  assert.deepEqual(r.profile.limited_by, ["O", "D", "F", "R"]);
  assert.equal(r.profile.scope_basis, "declared");
  assert.ok(r.axes.O.notes.some((n) => n.startsWith("✗ L4")));
});

test("window excludes events older than the window", () => {
  const r = score(zh3Company(), manifest, { asOf: "2026-12-31T00:00:00Z", windowDays: 30 });
  assert.equal(r.profile.window?.events, 0);
  assert.equal(r.profile.level, 0);
});

test("integrity: a confirmed major deception is a D regardless of autonomy", () => {
  const ev = zh3Company();
  ev.push({ v: "0.2", id: "x", ts: "2026-08-01T00:00:00Z", company: COMPANY, type: "conduct.deception", severity: "major", remediated: true });
  assert.equal(scoreIntegrity(ev, manifest).grade, "D");
  assert.equal(score(ev, manifest, { asOf }).profile.level, 3); // autonomy unchanged; integrity reported beside it
});

test("integrity: unremediated minor deception caps at C, remediated single minor allows B", () => {
  const mk = (remediated: boolean): ZHCEvent => ({ v: "0.2", id: "m", ts: "2026-08-01T00:00:00Z", company: COMPANY, type: "conduct.deception", severity: "minor", remediated });
  assert.equal(scoreIntegrity([...zh3Company(), mk(true)], manifest).grade, "B");
  assert.equal(scoreIntegrity([...zh3Company(), mk(false)], manifest).grade, "C");
});

test("integrity: blocked attempts are reported as control effectiveness and never graded", () => {
  const ev = zh3Company();
  for (let i = 0; i < 30; i++) ev.push({ v: "0.2", id: `b${i}`, ts: "2026-08-01T00:00:00Z", company: COMPANY, type: "conduct.mandate_blocked", action: "money.spend", reason: "limit" });
  const r = scoreIntegrity(ev, manifest);
  assert.equal(r.grade, "A");
  assert.equal(r.control.blocked, 30);
});

const mandate: Mandate = {
  zhc: "0.2",
  id: "m-1",
  issuer: "human:jay",
  subject: "agent:billing",
  issued_at: "2026-01-01T00:00:00Z",
  expires_at: "2026-12-31T00:00:00Z",
  scopes: [
    { action: "money.refund", limits: { per_action: { amount: 10000, currency: "USD" }, per_day: { amount: 20000, currency: "USD" } }, require_approval_over: { amount: 2000, currency: "USD" } },
    { action: "decision.make", tier_max: "operational" },
    { action: "network.buy", limits: { per_action: { amount: 5000, currency: "USD" } }, counterparty: { min_level: 2, min_integrity: "B", min_assurance: "measured" } },
  ],
  escalation: { to: "human:jay", timeout_s: 86400, on_timeout: "deny" },
  progression: [
    { when: { metric: "integrity", op: ">=", value: "A", source: "attestation" }, then: { action: "money.refund", set: { require_approval_over: { amount: 5000, currency: "USD" } } } },
  ],
};
const at = "2026-06-01T00:00:00Z";
const usd = (amount: number) => ({ amount, currency: "USD" });

test("mandate: allow, approval band, hard cap, daily limit, expiry", () => {
  assert.equal(evaluate(mandate, { action: "money.refund", amount: usd(1500), at }).decision, "allow");
  assert.equal(evaluate(mandate, { action: "money.refund", amount: usd(3000), at }).decision, "require_approval");
  assert.equal(evaluate(mandate, { action: "money.refund", amount: usd(15000), at }).decision, "deny");
  assert.equal(evaluate(mandate, { action: "money.refund", amount: usd(1500), at }, { day: { USD: 19000 }, month: {} }).decision, "deny");
  assert.equal(evaluate(mandate, { action: "money.refund", amount: usd(1500), at: "2027-02-01T00:00:00Z" }).decision, "deny");
  assert.equal(evaluate(mandate, { action: "money.refund", amount: { amount: 100, currency: "EUR" }, at }).decision, "deny");
  assert.equal(evaluate(mandate, { action: "money.spend", amount: usd(1), at }).decision, "deny");
});

test("mandate: decision tiers, charter reserved to the human", () => {
  assert.equal(evaluate(mandate, { action: "decision.make", tier: "tactical", at }).decision, "allow");
  assert.equal(evaluate(mandate, { action: "decision.make", tier: "strategic", at }).decision, "require_approval");
  assert.equal(evaluate(mandate, { action: "decision.make", tier: "charter", at }).decision, "deny");
});

test("mandate: counterparty checks before buying from another company", () => {
  const ok = { level: 3 as const, integrity: "A" as const, assurance: "attested" as const };
  assert.equal(evaluate(mandate, { action: "network.buy", amount: usd(1000), counterparty: ok, at }).decision, "allow");
  assert.equal(evaluate(mandate, { action: "network.buy", amount: usd(1000), counterparty: { ...ok, integrity: "C" }, at }).decision, "deny");
  assert.equal(evaluate(mandate, { action: "network.buy", amount: usd(1000), counterparty: { ...ok, assurance: "claimed" }, at }).decision, "deny");
  assert.equal(evaluate(mandate, { action: "network.buy", amount: usd(1000), at }).decision, "deny");
});

test("delegated mandates may only narrow their parent", () => {
  const child: Mandate = { ...mandate, id: "m-2", issuer: "agent:billing", subject: "agent:refunds", parent: "m-1", progression: [], scopes: [{ action: "money.refund", limits: { per_action: usd(5000), per_day: usd(10000) }, require_approval_over: usd(2000) }] };
  assert.equal(isAttenuationOf(child, mandate).ok, true);
  const greedy: Mandate = { ...child, scopes: [{ action: "money.refund", limits: { per_action: usd(50000) } }, { action: "money.spend" }] };
  const r = isAttenuationOf(greedy, mandate);
  assert.equal(r.ok, false);
  assert.ok(r.problems.includes("parent does not grant money.spend in every area"));
  assert.ok(r.problems.includes("money.refund.per_action exceeds parent"));
});

test("progression widens only on a verified independent attestation", () => {
  const keys = generateIssuerKeys();
  const validator = "did:web:validator.example";
  const resolveKey = (issuer: string) => (issuer === validator ? keys.publicKeyPem : undefined);
  const { profile } = score(zh3Company(), manifest, { asOf, chainVerified: true });
  const att = issueAttestation({ issuer: validator, profile, evidenceHead: "h", now: "2026-09-01T00:00:00Z", privateKey: keys.privateKey });
  const facts = attestedFacts(att, { resolveKey, now: "2026-09-02T00:00:00Z", subject: COMPANY });
  assert.ok(facts, "a verified attestation yields facts");
  const { mandate: widened, fired, refused } = applyProgression(mandate, { attestation: facts }, "2026-09-02T00:00:00Z");
  assert.equal(fired.length, 1);
  assert.equal(refused.length, 0);
  assert.equal(evaluate(widened, { action: "money.refund", amount: usd(3000), at }).decision, "allow");
  // The same rule never fires on the company's own figures.
  assert.equal(applyProgression(mandate, { self: { integrity: "A" } }, "2026-09-02T00:00:00Z").fired.length, 0);
  // An attestation that has expired widens nothing.
  assert.equal(applyProgression(mandate, { attestation: facts }, "2026-12-01T00:00:00Z").fired.length, 0);
});

test("evidence hash chain detects tampering", () => {
  const raw = zh3Company().slice(0, 20);
  const chain: ZHCEvent[] = [];
  for (const e of raw) chain.push(seal(e, chain.at(-1)?.hash));
  const v = verifyChain(chain);
  assert.equal(v.ok, true);
  assert.equal(v.head, chain.at(-1)?.hash);
  const tampered = chain.map((e, i) => (i === 5 ? { ...e, ts: "2026-07-02T00:00:00Z" } : e));
  assert.deepEqual(verifyChain(tampered), { ok: false, brokenAt: 5, reason: "event hash mismatch" });
});

test("attestations sign a profile and fail on tamper or expiry; only resolved keys are trusted", () => {
  const { profile } = score(zh3Company(), manifest, { asOf, chainVerified: true });
  const keys = generateIssuerKeys();
  const issuer = "did:web:validator.example";
  const resolveKey = (i: string) => (i === issuer ? keys.publicKeyPem : undefined);
  const a = issueAttestation({ issuer, profile, evidenceHead: "abc", now: "2026-09-01T00:00:00Z", ...keys });
  assert.equal(a.payload.profile.assurance, "attested");
  assert.equal(a.payload.method, METHOD_VERSION);
  assert.deepEqual(verifyAttestation(a, { resolveKey, now: "2026-09-02T00:00:00Z" }), { ok: true });
  assert.equal(verifyAttestation(a, { resolveKey, now: "2027-01-01T00:00:00Z" }).reason, "expired");
  const forged = { ...a, payload: { ...a.payload, profile: { ...a.payload.profile, level: 5 as const } } };
  assert.equal(verifyAttestation(forged, { resolveKey, now: "2026-09-02T00:00:00Z" }).reason, "bad signature");
});

test("self-assessment yields a claimed profile; self-report can't earn integrity A", () => {
  const p = claimedProfile({ O: 4, D: 3, F: 3, R: 3, N: 2, S: 2, I1: 3, I2: 3, I3: 3 });
  assert.equal(formatProfile(p), "ZH4·B [O4 D3 F3 R3] N2 S2 claimed");
  assert.equal(p.method, METHOD_VERSION);
  assert.equal(claimedProfile({ O: 4, D: 3, F: 3, R: 3, N: 2, I1: 0, I2: 3, I3: 3 }).integrity, "D");
  assert.equal(claimedProfile({ O: 1 }).integrity, "U");
});

test("unverified evidence is never measured", () => {
  assert.equal(score(zh3Company(), manifest, { asOf }).profile.assurance, "provisional");
  assert.equal(score(zh3Company(), manifest, { asOf, chainVerified: false }).profile.assurance, "provisional");
});

test("hard limits beat approval bands: approval can't push through a forbidden change", () => {
  const m: Mandate = { ...mandate, scopes: [{ action: "pricing.change", tier_max: "tactical", max_relative_change: 0.2 }] };
  const big = evaluate(m, { action: "pricing.change", tier: "strategic", relative_change: 0.35, at });
  assert.equal(big.decision, "deny");
  assert.equal(big.decision === "deny" && big.code, "change");
  assert.equal(evaluate(m, { action: "pricing.change", tier: "strategic", relative_change: 0.1, at }).decision, "require_approval");
});

test("counterparty denials carry a screening code", () => {
  const v = evaluate(mandate, { action: "network.buy", amount: usd(1000), counterparty: { level: 1, integrity: "A", assurance: "attested" }, at });
  assert.equal(v.decision === "deny" && v.code, "counterparty");
});

test("attestations require a measured profile and an independent issuer", () => {
  const keys = generateIssuerKeys();
  const provisional = score(zh3Company(), manifest, { asOf }).profile;
  assert.throws(() => issueAttestation({ issuer: "did:web:v.example", profile: provisional, evidenceHead: "x", ...keys }), /only measured/);
  const measured = score(zh3Company(), manifest, { asOf, chainVerified: true }).profile;
  assert.throws(() => issueAttestation({ issuer: COMPANY, profile: measured, evidenceHead: "x", ...keys }), /own company/);
  assert.throws(
    () => issueAttestation({ issuer: "did:web:v.example", profile: measured, evidenceHead: "x", independence: { common_control: true, fee_depends_on_outcome: false }, ...keys }),
    /common control/,
  );
});

test("attenuation also checks approval bands, change limits, counterparty rules and revocation", () => {
  const base: Mandate = { ...mandate, id: "c", issuer: "agent:billing", parent: "m-1", progression: [], scopes: [{ action: "money.refund", limits: { per_action: usd(5000), per_day: usd(10000) } }] };
  assert.ok(isAttenuationOf(base, mandate).problems.includes("money.refund.require_approval_over exceeds parent"));
  const weak: Mandate = { ...base, scopes: [{ action: "network.buy", limits: { per_action: usd(1000) }, counterparty: { min_level: 1, min_integrity: "C" } }] };
  const p = isAttenuationOf(weak, mandate).problems;
  assert.ok(p.includes("network.buy.counterparty.min_level weaker than parent"));
  assert.ok(p.includes("network.buy.counterparty.min_integrity weaker than parent"));
  assert.ok(p.includes("network.buy.counterparty.min_assurance weaker than parent"));
  const capped: Mandate = { ...base, scopes: [{ action: "money.refund", limits: { per_action: usd(1500), per_day: usd(10000) } }] };
  assert.equal(isAttenuationOf(capped, mandate).ok, true, "a hard cap below the parent's approval band needs no band of its own");
  const ok: Mandate = { ...base, scopes: [{ action: "money.refund", limits: { per_action: usd(5000), per_day: usd(10000) }, require_approval_over: usd(1000) }] };
  assert.equal(isAttenuationOf(ok, mandate).ok, true);
  assert.ok(isAttenuationOf(ok, { ...mandate, revoked: true }).problems.includes("parent is revoked"));
});

test("progression supports AND conditions and domain targeting; self figures may narrow", () => {
  const m: Mandate = {
    ...mandate,
    scopes: [{ action: "decision.make", domain: "finance", tier_max: "operational" }, { action: "decision.make", domain: "ops", tier_max: "operational" }],
    progression: [
      { when: [{ metric: "integrity", op: "<=", value: "C" }, { metric: "complaints", op: ">=", value: 3 }], then: { action: "decision.make", domain: "ops", set: { tier_max: "tactical" } } },
    ],
  };
  assert.equal(applyProgression(m, { self: { integrity: "C", complaints: 1 } }, at).fired.length, 0);
  const { mandate: narrowed, fired } = applyProgression(m, { self: { integrity: "C", complaints: 4 } }, at);
  assert.equal(fired.length, 1);
  assert.equal(narrowed.scopes[0].tier_max, "operational");
  assert.equal(narrowed.scopes[1].tier_max, "tactical");
  assert.equal("limits" in narrowed.scopes[1], false);
});

test("MODEL.md §4 states exactly the level names and sentences the code uses", async () => {
  const { readFileSync } = await import("node:fs");
  const { LEVEL_NAMES, LEVEL_SUMMARIES } = await import("../src/index.ts");
  const md = readFileSync(new URL("../../../spec/v0.2/MODEL.md", import.meta.url), "utf8");
  for (const l of [0, 1, 2, 3, 4, 5] as const) {
    const row = md.split("\n").find((r) => r.startsWith(`| ZH${l} |`));
    assert.ok(row, `MODEL.md has no row for ZH${l}`);
    const cells = row.split("|").map((c) => c.trim());
    assert.equal(cells[2], LEVEL_NAMES[l]);
    assert.equal(cells[7], LEVEL_SUMMARIES[l]);
  }
});
