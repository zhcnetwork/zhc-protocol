import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyProgression,
  claimedProfile,
  compositeLevel,
  evaluate,
  formatProfile,
  generateIssuerKeys,
  isAttenuationOf,
  issueAttestation,
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
import { COMPANY, manifest, zh3Company } from "./fixtures.ts";

test("composite level is gated by the weakest axis", () => {
  assert.deepEqual(compositeLevel({ O: 4, D: 4, F: 1, R: 3, N: 2 }), { level: 2, limited_by: ["F"] });
  assert.equal(compositeLevel({ O: 5, D: 5, F: 5, R: 4, N: 3 }).level, 5);
  assert.equal(compositeLevel({ O: 0, D: 0, F: 0, R: 0, N: 0 }).level, 0);
});

test("v0.2 fixes the v0.1 contradiction: a single-product company can reach ZH5", () => {
  const p = parseProfile("ZH5·A [O5 D5 F5 R4 N3] S2");
  assert.equal(p.level, 5);
  assert.equal(p.scope, 2);
});

test("profile strings round-trip and reject false claims", () => {
  const p = { level: 3 as const, integrity: "B" as const, axes: { O: 3, D: 2, F: 2, R: 2, N: 1 } as const, scope: 2 as const, assurance: "measured" as const };
  const s = formatProfile(p);
  assert.equal(s, "ZH3·B [O3 D2 F2 R2 N1] S2 measured");
  assert.deepEqual(parseProfile(s), p);
  assert.equal(profileId(p), "zh0.2/3/B/O3D2F2R2N1/S2/measured");
  assert.throws(() => parseProfile("ZH4·B [O3 D2 F2 R2 N1] S2"), /compute to ZH3/);
});

test("no evidence scores ZH0, unrated, provisional", () => {
  const r = score([], manifest, { asOf: "2026-09-01T00:00:00Z" });
  assert.equal(r.profile.level, 0);
  assert.equal(r.profile.integrity, "U");
  assert.equal(r.profile.assurance, "provisional");
});

test("synthetic business operator scores ZH3 and names the limiting axes", () => {
  const r = score(zh3Company(), manifest, { chainVerified: true });
  assert.deepEqual(r.profile.axes, { O: 3, D: 2, F: 2, R: 2, N: 1 });
  assert.equal(r.profile.level, 3);
  assert.equal(r.profile.scope, 2);
  assert.equal(r.profile.integrity, "A");
  assert.equal(r.profile.assurance, "measured");
  assert.deepEqual(r.profile.limited_by, ["O", "D", "F", "R", "N"]);
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
  assert.equal(scoreIntegrity(ev).grade, "D");
  assert.equal(score(ev, manifest).profile.level, 3); // autonomy unchanged; integrity reported beside it
});

test("integrity: unremediated minor deception caps at C, remediated single minor allows B", () => {
  const mk = (remediated: boolean): ZHCEvent => ({ v: "0.2", id: "m", ts: "2026-08-01T00:00:00Z", company: COMPANY, type: "conduct.deception", severity: "minor", remediated });
  assert.equal(scoreIntegrity([...zh3Company(), mk(true)]).grade, "B");
  assert.equal(scoreIntegrity([...zh3Company(), mk(false)]).grade, "C");
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
    { when: { metric: "integrity", op: ">=", value: "A" }, then: { action: "money.refund", set: { require_approval_over: { amount: 5000, currency: "USD" } } } },
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

test("mandate: counterparty checks before buying from another ZHC", () => {
  const ok = { level: 3 as const, integrity: "A" as const, assurance: "attested" as const };
  assert.equal(evaluate(mandate, { action: "network.buy", amount: usd(1000), counterparty: ok, at }).decision, "allow");
  assert.equal(evaluate(mandate, { action: "network.buy", amount: usd(1000), counterparty: { ...ok, integrity: "C" }, at }).decision, "deny");
  assert.equal(evaluate(mandate, { action: "network.buy", amount: usd(1000), counterparty: { ...ok, assurance: "claimed" }, at }).decision, "deny");
  assert.equal(evaluate(mandate, { action: "network.buy", amount: usd(1000), at }).decision, "deny");
});

test("delegated mandates may only narrow their parent", () => {
  const child: Mandate = { ...mandate, id: "m-2", issuer: "agent:billing", subject: "agent:refunds", parent: "m-1", scopes: [{ action: "money.refund", limits: { per_action: usd(5000), per_day: usd(10000) }, require_approval_over: usd(2000) }] };
  assert.equal(isAttenuationOf(child, mandate).ok, true);
  const greedy: Mandate = { ...child, scopes: [{ action: "money.refund", limits: { per_action: usd(50000) } }, { action: "money.spend" }] };
  const r = isAttenuationOf(greedy, mandate);
  assert.equal(r.ok, false);
  assert.ok(r.problems.includes("parent does not grant money.spend"));
  assert.ok(r.problems.includes("money.refund.per_action exceeds parent"));
});

test("progressive autonomy widens the approval band when integrity is A", () => {
  const { mandate: widened, fired } = applyProgression(mandate, { integrity: "A" });
  assert.equal(fired.length, 1);
  assert.equal(evaluate(widened, { action: "money.refund", amount: usd(3000), at }).decision, "allow");
  assert.equal(applyProgression(mandate, { integrity: "B" }).fired.length, 0);
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

test("attestations sign a profile and fail on tamper or expiry", () => {
  const { profile } = score(zh3Company(), manifest, { chainVerified: true });
  const keys = generateIssuerKeys();
  const a = issueAttestation({ issuer: "did:web:ratingdesk.zhc.network", profile, evidenceHead: "abc", now: "2026-09-01T00:00:00Z", ...keys });
  assert.equal(a.payload.profile.assurance, "attested");
  assert.deepEqual(verifyAttestation(a, { now: "2026-09-02T00:00:00Z" }), { ok: true });
  assert.equal(verifyAttestation(a, { now: "2027-01-01T00:00:00Z" }).reason, "expired");
  const forged = { ...a, payload: { ...a.payload, profile: { ...a.payload.profile, level: 5 as const } } };
  assert.equal(verifyAttestation(forged, { now: "2026-09-02T00:00:00Z" }).reason, "bad signature");
});

test("self-assessment yields a claimed profile; self-report can't earn integrity A", () => {
  const p = claimedProfile({ O: 4, D: 3, F: 3, R: 3, N: 2, S: 2, I1: 3, I2: 3, I3: 3 });
  assert.equal(formatProfile(p), "ZH4·B [O4 D3 F3 R3 N2] S2 claimed");
  assert.equal(claimedProfile({ O: 4, D: 3, F: 3, R: 3, N: 2, I1: 0, I2: 3, I3: 3 }).integrity, "D");
  assert.equal(claimedProfile({ O: 1 }).integrity, "U");
});

test("unverified evidence is never measured", () => {
  assert.equal(score(zh3Company(), manifest).profile.assurance, "provisional");
  assert.equal(score(zh3Company(), manifest, { chainVerified: false }).profile.assurance, "provisional");
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
  const provisional = score(zh3Company(), manifest).profile;
  assert.throws(() => issueAttestation({ issuer: "did:web:v.example", profile: provisional, evidenceHead: "x", ...keys }), /only measured/);
  const measured = score(zh3Company(), manifest, { chainVerified: true }).profile;
  assert.throws(() => issueAttestation({ issuer: COMPANY, profile: measured, evidenceHead: "x", ...keys }), /own company/);
});

test("attenuation also checks approval bands, change limits, counterparty rules and revocation", () => {
  const base: Mandate = { ...mandate, id: "c", parent: "m-1", scopes: [{ action: "money.refund", limits: { per_action: usd(5000), per_day: usd(10000) } }] };
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

test("progression supports AND conditions, domain targeting, and leaves limits alone", () => {
  const m: Mandate = {
    ...mandate,
    scopes: [{ action: "decision.make", domain: "finance", tier_max: "tactical" }, { action: "decision.make", domain: "ops", tier_max: "tactical" }],
    progression: [{ when: [{ metric: "integrity", op: ">=", value: "B" }, { metric: "operational_autonomy", op: ">=", value: 0.8 }], then: { action: "decision.make", domain: "ops", set: { tier_max: "operational" } } }],
  };
  assert.equal(applyProgression(m, { integrity: "A", operational_autonomy: 0.5 }).fired.length, 0);
  assert.equal(applyProgression(m, { integrity: "U", operational_autonomy: 0.9 }).fired.length, 0);
  const { mandate: w, fired } = applyProgression(m, { integrity: "A", operational_autonomy: 0.9 });
  assert.equal(fired.length, 1);
  assert.equal(w.scopes[0].tier_max, "tactical");
  assert.equal(w.scopes[1].tier_max, "operational");
  assert.equal("limits" in w.scopes[1], false);
});
