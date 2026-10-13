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
  const r = score(zh3Company(), manifest);
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
  const child: Mandate = { ...mandate, id: "m-2", issuer: "agent:billing", subject: "agent:refunds", parent: "m-1", scopes: [{ action: "money.refund", limits: { per_action: usd(5000), per_day: usd(10000) } }] };
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
  const { profile } = score(zh3Company(), manifest);
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
