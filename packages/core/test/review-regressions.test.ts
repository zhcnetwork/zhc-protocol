// Regression tests for the problems found in independent reviews of v0.2 (October 2026). Each
// confirmed finding (labelled R01–A02, G-*, C07) is pinned as an expectation of the corrected
// v0.2.1 behaviour. Findings about the reference desk rather than the core are tested there.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyProgression,
  evaluate,
  evaluateChain,
  ExposureBook,
  generateIssuerKeys,
  isAttenuationOf,
  issueAttestation,
  score,
  ScoreInputError,
  scoreIntegrity,
  verifyAttestation,
  type Mandate,
  type ZHCEvent,
} from "../src/index.ts";
import { base, COMPANY, FIXTURE_AS_OF, manifest, zh3Company } from "./fixtures.ts";

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();
const usd = (amount: number) => ({ amount, currency: "USD" });
const at = "2026-06-01T00:00:00Z";

/** A steady, quiet company: one AI task per hour from `startMs` for `days` days, no rescues. */
function quietCompany(startMs: number, days: number): ZHCEvent[] {
  const ev: ZHCEvent[] = [];
  for (let h = 0; h < days * 24; h++) {
    ev.push({ v: "0.2", id: `q${h}`, ts: iso(startMs + h * 3_600_000), company: COMPANY, type: "task.completed", domain: "support", actor: "ai", touch: "none" });
  }
  // One incident, caught early and fixed by AI, ten days before the end: recovery must be shown, not assumed.
  ev.push({ v: "0.2", id: "inc", ts: iso(startMs + (days - 10) * DAY), company: COMPANY, type: "incident.resolved", severity: "low", detected_by: "ai", detected_before_impact: true, resolved_by: "ai", duration_s: 60, fix_retained: true });
  return ev;
}

test("R01: R4 is reachable with 90 quiet days in the default 90-day window", () => {
  const asOf = Date.parse("2026-12-31T00:00:00Z");
  const r = score(quietCompany(asOf - 120 * DAY, 120), undefined, { asOf: iso(asOf) });
  assert.equal(r.profile.axes.R, 4);
});

test("R02: R5 is reachable with a quiet year of history", () => {
  const asOf = Date.parse("2027-12-31T00:00:00Z");
  const r = score(quietCompany(asOf - 400 * DAY, 400), undefined, { asOf: iso(asOf) });
  assert.equal(r.profile.axes.R, 5);
});

test("R03: R gates on rescues; approvals are reported as human operating sessions instead", () => {
  const ev = zh3Company();
  const before = score(ev, manifest, { asOf: FIXTURE_AS_OF });
  for (let d = 0; d < 60; d++) {
    ev.push({ ...base(d * 24 + 18), type: "decision.made", tier: "operational", origin: "ai", decided_by: "human", approval: "pre" });
  }
  const after = score(ev, manifest, { asOf: FIXTURE_AS_OF });
  assert.equal(after.profile.axes.R, before.profile.axes.R, "approvals are measured by D, not R");
  assert.ok((after.metrics.human_operating_sessions ?? 0) >= 60, "every daily approval session is reported");
  assert.ok((after.metrics.longest_unattended_hours ?? Infinity) < 48, "the longest stretch with no human contact shrinks");
});

test("R03b: an open incident counts against recovery", () => {
  const ev = zh3Company();
  ev.push({ ...base(1400), type: "incident.opened", severity: "high", detected_by: "ai", detected_before_impact: false });
  ev.push({ ...base(1401), type: "incident.opened", severity: "high", detected_by: "ai", detected_before_impact: false });
  const r = score(ev, manifest, { asOf: FIXTURE_AS_OF });
  assert.equal(r.metrics.open_incidents, 2);
  assert.equal(r.metrics.ai_recovery, 3 / 5);
  assert.ok(r.profile.axes.R < 2, "60% recovery no longer meets R2's 80%");
});

test("I01: no disclosure or refund evidence means unrated, not A", () => {
  const ev: ZHCEvent[] = [];
  for (let i = 0; i < 80; i++) ev.push({ ...base(i), type: "task.completed", domain: "d", actor: "ai", touch: "none" });
  ev.push({ ...base(90), type: "money.moved", direction: "in", category: "revenue", money: usd(100), authorized_by: "mandate" });
  const r = scoreIntegrity(ev, manifest);
  assert.equal(r.grade, "U");
  assert.equal(r.observation.disclosure, "unobserved");
  assert.equal(r.observation.refunds, "unobserved");
});

test("I01b: evidence of misconduct still counts when other metrics are unobserved", () => {
  const ev: ZHCEvent[] = [];
  for (let i = 0; i < 80; i++) ev.push({ ...base(i), type: "task.completed", domain: "d", actor: "ai", touch: "none" });
  ev.push({ ...base(90), type: "conduct.deception", severity: "major", remediated: false });
  assert.equal(scoreIntegrity(ev, manifest).grade, "D");
});

test("G-IMP-07: tasks count once toward the integrity volume floor", () => {
  const ev: ZHCEvent[] = [];
  for (let i = 0; i < 25; i++) ev.push({ ...base(i), type: "task.completed", domain: "d", actor: "ai", touch: "none" });
  const r = scoreIntegrity(ev);
  assert.equal(r.grade, "U");
  assert.equal(r.metrics.interactions, 0);
});

const mandate: Mandate = {
  zhc: "0.2",
  id: "m-1",
  issuer: "human:h",
  subject: "agent:a",
  issued_at: "2026-01-01T00:00:00Z",
  expires_at: "2026-12-31T00:00:00Z",
  scopes: [
    { action: "money.spend", limits: { per_action: usd(1000), per_day: usd(2000) } },
    { action: "pricing.change", tier_max: "operational", max_relative_change: 0.2 },
    { action: "decision.make", tier_max: "operational" },
  ],
  escalation: { to: "human:h", timeout_s: 60, on_timeout: "deny" },
};

const denyCode = (v: ReturnType<typeof evaluate>) => (v.decision === "deny" ? v.code : v.decision);

test("M01: a money action without an amount is denied", () => {
  assert.equal(denyCode(evaluate(mandate, { action: "money.spend", at })), "invalid");
});

test("M02: negative, fractional or non-numeric amounts are denied", () => {
  assert.equal(denyCode(evaluate(mandate, { action: "money.spend", amount: usd(-500), at })), "invalid");
  assert.equal(denyCode(evaluate(mandate, { action: "money.spend", amount: usd(1.5), at })), "invalid");
  assert.equal(denyCode(evaluate(mandate, { action: "money.spend", amount: { amount: Number.NaN, currency: "USD" }, at })), "invalid");
  assert.equal(denyCode(evaluate(mandate, { action: "money.spend", amount: { amount: 100, currency: "usd" }, at })), "invalid");
});

test("M03: an invalid request time is denied", () => {
  assert.equal(denyCode(evaluate(mandate, { action: "money.spend", amount: usd(100), at: "not a date" })), "invalid");
  assert.equal(denyCode(evaluate({ ...mandate, expires_at: "never" }, { action: "money.spend", amount: usd(100), at })), "invalid");
});

test("M04: a request missing the field a constraint needs is denied", () => {
  assert.equal(denyCode(evaluate(mandate, { action: "pricing.change", tier: "tactical", at })), "invalid");
  assert.equal(denyCode(evaluate(mandate, { action: "pricing.change", relative_change: 0.1, at })), "invalid");
  assert.equal(denyCode(evaluate(mandate, { action: "decision.make", at })), "invalid");
  assert.equal(evaluate(mandate, { action: "pricing.change", tier: "tactical", relative_change: 0.1, at }).decision, "allow");
});

test("M05: attenuation requires the parent's subject as issuer, the parent's id, and nested validity", () => {
  const good: Mandate = { ...mandate, id: "c", issuer: "agent:a", subject: "agent:b", parent: "m-1", scopes: [{ action: "money.spend", limits: { per_action: usd(500), per_day: usd(1000) } }] };
  assert.equal(isAttenuationOf(good, mandate).ok, true);
  const p = isAttenuationOf({ ...good, issuer: "agent:stranger", parent: "m-9", issued_at: "2025-06-01T00:00:00Z" }, mandate).problems;
  assert.ok(p.some((x) => x.startsWith("issued by agent:stranger")));
  assert.ok(p.some((x) => x.startsWith("child.parent is m-9")));
  assert.ok(p.includes("child starts before parent"));
});

test("G-IMP-04: the most specific scope wins, and an area-limited action must name its area", () => {
  const m: Mandate = {
    ...mandate,
    scopes: [{ action: "money.spend", limits: { per_action: usd(100000) } }, { action: "money.spend", domain: "ads", limits: { per_action: usd(1000) } }],
  };
  assert.equal(denyCode(evaluate(m, { action: "money.spend", domain: "ads", amount: usd(50000), at })), "limit");
  assert.equal(denyCode(evaluate(m, { action: "money.spend", amount: usd(50000), at })), "invalid");
  assert.equal(evaluate(m, { action: "money.spend", domain: "infra", amount: usd(50000), at }).decision, "allow");
});

test("G-IMP-05 and shared budgets: a parent's daily cap bounds the whole delegation chain", () => {
  const parent: Mandate = { ...mandate, scopes: [{ action: "money.spend", limits: { per_action: usd(1000), per_day: usd(1500) } }] };
  const childA: Mandate = { ...mandate, id: "ca", issuer: "agent:a", subject: "agent:b", parent: "m-1", scopes: [{ action: "money.spend", limits: { per_action: usd(1000), per_day: usd(1500) } }] };
  const childB: Mandate = { ...childA, id: "cb", subject: "agent:c" };
  const book = new ExposureBook();
  assert.equal(book.reserve([childA, parent], { action: "money.spend", amount: usd(1000), at }, { id: "r1" }).held, true);
  // childB's own cap allows it, but the parent's $15 day cap now has only $5 left.
  const second = book.reserve([childB, parent], { action: "money.spend", amount: usd(1000), at }, { id: "r2" });
  assert.equal(second.held, false);
  assert.match(second.verdict.decision === "deny" ? second.verdict.reason : "", /m-1: daily limit/);
  book.release("r1");
  assert.equal(book.reserve([childB, parent], { action: "money.spend", amount: usd(1000), at }, { id: "r3" }).held, true);
});

test("G01 (core): an approval is re-checked at execution and dies with a revoked mandate", () => {
  const m: Mandate = { ...mandate, scopes: [{ action: "money.spend", limits: { per_action: usd(5000) }, require_approval_over: usd(100) }] };
  const book = new ExposureBook();
  assert.equal(book.reserve([m], { action: "money.spend", amount: usd(1000), at }, { id: "x" }).held, false, "needs approval");
  assert.equal(book.reserve([{ ...m, revoked: true }], { action: "money.spend", amount: usd(1000), at }, { id: "y", approved: true }).held, false);
  assert.equal(book.reserve([m], { action: "money.spend", amount: usd(1000), at }, { id: "z", approved: true }).held, true);
  assert.equal(book.reserve([m], { action: "money.spend", amount: usd(9000), at }, { id: "w", approved: true }).held, false, "approval never beats a hard cap");
});

test("G-01: a company's own score can't widen its mandate", () => {
  const m: Mandate = {
    ...mandate,
    scopes: [{ action: "money.refund", limits: { per_action: usd(100000) }, require_approval_over: usd(0) }],
    progression: [{ when: { metric: "integrity", op: ">=", value: "A" }, then: { action: "money.refund", set: { require_approval_over: usd(100000) } } }],
  };
  // 60 self-written task events used to earn integrity A and fire this rule.
  const fake: ZHCEvent[] = [];
  for (let i = 0; i < 60; i++) fake.push({ ...base(i), type: "task.completed", domain: "d", actor: "ai", touch: "none" });
  const r = score(fake, undefined, { asOf: "2026-07-10T00:00:00Z" });
  assert.equal(r.profile.integrity, "U", "self-written tasks alone no longer earn A");
  const p = applyProgression(m, { self: { integrity: "A" } });
  assert.equal(p.fired.length, 0);
  assert.equal(p.refused.length, 1, "the widening becomes a proposal for the issuer to sign");
  assert.equal(evaluate(p.mandate, { action: "money.refund", amount: usd(90000), at }).decision, "require_approval");
});

test("S01: events from another company are rejected, not scored under the manifest's name", () => {
  const ev = zh3Company();
  ev.push({ ...base(10, "did:web:someone-else.example"), type: "task.completed", domain: "d", actor: "ai", touch: "none" });
  assert.throws(() => score(ev, manifest, { asOf: FIXTURE_AS_OF }), ScoreInputError);
  const dup = zh3Company();
  dup.push({ ...dup[0] });
  assert.throws(() => score(dup, manifest, { asOf: FIXTURE_AS_OF }), /duplicate event id/);
});

test("S02: asOf is required, so an old log can't pass for a current one", () => {
  // @ts-expect-error: asOf is required by the type, and checked at runtime too.
  assert.throws(() => score(zh3Company(), manifest, {}), ScoreInputError);
  const stale = score(zh3Company(), manifest, { asOf: "2027-06-01T00:00:00Z", chainVerified: true });
  assert.equal(stale.profile.window?.events, 0);
  assert.equal(stale.profile.assurance, "provisional");
});

test("A01: verification never trusts the key carried in the attestation", () => {
  const real = generateIssuerKeys();
  const attacker = generateIssuerKeys();
  const { profile } = score(zh3Company(), manifest, { asOf: FIXTURE_AS_OF, chainVerified: true });
  const trusted = "did:web:trusted-validator.example";
  const forged = issueAttestation({ issuer: trusted, profile, evidenceHead: "h", now: "2026-09-01T00:00:00Z", privateKey: attacker.privateKey, publicKeyPem: attacker.publicKeyPem });
  const resolveKey = (i: string) => (i === trusted ? real.publicKeyPem : undefined);
  assert.equal(verifyAttestation(forged, { resolveKey, now: "2026-09-02T00:00:00Z" }).reason, "bad signature");
  // @ts-expect-error: a resolver is required.
  assert.equal(verifyAttestation(forged, {}).ok, false);
});

test("A02: an attestation issued in the future is rejected", () => {
  const keys = generateIssuerKeys();
  const issuer = "did:web:v.example";
  const { profile } = score(zh3Company(), manifest, { asOf: FIXTURE_AS_OF, chainVerified: true });
  const a = issueAttestation({ issuer, profile, evidenceHead: "h", now: "2026-12-01T00:00:00Z", privateKey: keys.privateKey });
  const r = verifyAttestation(a, { resolveKey: () => keys.publicKeyPem, now: "2026-09-02T00:00:00Z" });
  assert.equal(r.reason, "issued in the future");
});

test("G-IMP-01: D3 needs at least ten operational decisions", () => {
  const ev: ZHCEvent[] = [];
  for (let i = 0; i < 10; i++) ev.push({ ...base(i), type: "decision.made", tier: "tactical", origin: "ai", decided_by: "ai", approval: "none" });
  ev.push({ ...base(20), type: "decision.made", tier: "operational", origin: "ai", decided_by: "ai", approval: "none" });
  ev.push({ ...base(21), type: "decision.made", tier: "strategic", origin: "ai", decided_by: "human", approval: "pre" });
  assert.equal(score(ev, undefined, { asOf: "2026-07-05T00:00:00Z" }).profile.axes.D, 2);
});

test("G-IMP-06: an area with no exceptions hasn't shown it can handle them", () => {
  const ev: ZHCEvent[] = [];
  for (let i = 0; i < 20; i++) ev.push({ ...base(i), type: "task.completed", domain: "d", actor: "ai", touch: "none" });
  assert.equal(score(ev, undefined, { asOf: "2026-07-05T00:00:00Z" }).profile.axes.O, 2);
  ev.push({ ...base(25), type: "task.completed", domain: "d", actor: "ai", touch: "none", exception: true, exception_handled_by: "ai" });
  assert.equal(score(ev, undefined, { asOf: "2026-07-05T00:00:00Z" }).profile.axes.O, 3);
});

test("C07: value shares are computed per currency, never by adding currencies together", () => {
  const ev: ZHCEvent[] = [];
  for (let i = 0; i < 3; i++) ev.push({ ...base(i), type: "money.moved", direction: "out", category: "spend", money: usd(100), authorized_by: "mandate" });
  for (const p of [10, 11]) ev.push({ ...base(p), type: "money.moved", direction: "none", category: "pricing_change", money: usd(0), authorized_by: "mandate" });
  for (let i = 0; i < 20; i++) ev.push({ ...base(20 + i), type: "money.moved", direction: "in", category: "revenue", money: usd(100), authorized_by: "mandate" });
  // Ten human-approved yen flows: 95,000 JPY each would have dominated a naive sum.
  for (let i = 0; i < 10; i++) ev.push({ ...base(50 + i), type: "money.moved", direction: "in", category: "revenue", money: { amount: 95000, currency: "JPY" }, authorized_by: "human_approval" });
  const r = score(ev, undefined, { asOf: "2026-07-05T00:00:00Z" });
  assert.equal(r.metrics.operating_value_share_USD, 1);
  assert.equal(r.metrics.operating_value_share_JPY, 0);
  assert.equal(r.profile.axes.F, 2, "the JPY flows fail F3 on their own terms, not by swamping USD");
});

test("evaluateChain rejects a broken delegation link", () => {
  const stranger: Mandate = { ...mandate, id: "s", issuer: "agent:nobody", subject: "agent:b", parent: "m-1", scopes: [{ action: "money.spend", limits: { per_action: usd(10) } }] };
  const v = evaluateChain([stranger, mandate], { action: "money.spend", amount: usd(5), at });
  assert.equal(denyCode(v), "invalid");
});

test("the scorer orders events by instant, not by how the timestamp is written", () => {
  const utc = zh3Company();
  // The same log with every other timestamp written at +05:30, including the first. Compared as
  // strings, "05:30+05:30" sorts after "01:00Z" although it is an hour earlier.
  const at530 = (ts: string) => new Date(Date.parse(ts) + 5.5 * 3_600_000).toISOString().replace("Z", "+05:30");
  const offset = utc.map((e, i) => (i % 2 === 0 ? { ...e, ts: at530(e.ts) } : e));
  const a = score(utc, manifest, { asOf: FIXTURE_AS_OF });
  const b = score(offset, manifest, { asOf: FIXTURE_AS_OF });
  assert.deepEqual(b.profile, a.profile);
  assert.deepEqual(b.metrics, a.metrics);
});
