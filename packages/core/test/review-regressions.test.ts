// Regression tests for the problems found in independent reviews of v0.2 (October 2026). Each
// confirmed finding (labelled R01–A02, G-*, C07, and V01–V20 from the spec-against-code review of
// revision 0.2.1) is pinned as an expectation of the corrected behaviour. Findings about the
// reference desk rather than the core are tested there.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sign as nodeSign } from "node:crypto";
import {
  applyProgression,
  canonicalJSON,
  evaluate,
  evaluateChain,
  ExposureBook,
  generateIssuerKeys,
  isAttenuationOf,
  issueAttestation,
  mandateKeyResolver,
  score,
  ScoreInputError,
  scoreIntegrity,
  signMandate,
  validateMandate,
  validatorKeyResolver,
  verifyAttestation,
  verifyMandate,
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
/** Signs any payload the way issueAttestation does, to build attestations it would refuse to issue. */
const signCanonical = (payload: unknown, key: Parameters<typeof issueAttestation>[0]["privateKey"]) =>
  nodeSign(null, Buffer.from(canonicalJSON(payload)), key).toString("base64url");
/** ISO time `hours` after the fixtures' start (2026-07-01). */
const atHour = (hours: number) => new Date(Date.parse("2026-07-01T00:00:00Z") + hours * 3_600_000).toISOString();

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
  const p = applyProgression(m, { self: { integrity: "A" } }, at);
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

test("R: time the log doesn't cover is never counted as time without rescues", () => {
  const end = Date.parse("2026-12-31T00:00:00Z");
  const ev = quietCompany(end - 120 * DAY, 120);
  const atEnd = score(ev, undefined, { asOf: iso(end) });
  assert.equal(atEnd.profile.axes.R, 4);
  // The same log, scored 60 days after it stopped: the silence isn't 60 more rescue-free days.
  const stale = score(ev, undefined, { asOf: iso(end + 60 * DAY) });
  assert.ok((stale.metrics.exposure_days ?? 0) < 32, "only the evidence's last month plus one day is covered");
  assert.ok(stale.profile.axes.R < 4);
  assert.equal(stale.metrics.evidence_gap_hours, 60 * 24 + 1);
  // A month missing from the middle of the log doesn't count either.
  const holed = ev.filter((e) => Date.parse(e.ts) < end - 70 * DAY || Date.parse(e.ts) >= end - 40 * DAY);
  const h = score(holed, undefined, { asOf: iso(end) });
  assert.ok((h.metrics.exposure_days ?? 0) < 62, "the 30-day hole adds at most one covered day");
  assert.ok(h.profile.axes.R < 4);
});

// --- Spec-against-code review of 0.2.1 (V-findings) ----------------------------------------

test("V01: a progression rule can't change a scope's action or area", () => {
  const m: Mandate = {
    ...mandate,
    scopes: [{ action: "money.refund", limits: { per_action: usd(1000) } }],
    progression: [{ when: { metric: "integrity", op: ">=", value: "A" }, then: { action: "money.refund", set: { action: "money.spend" } as never } }],
  };
  assert.ok(validateMandate(m).some((p) => /action or area/.test(p)), "the mandate is malformed");
  assert.equal(denyCode(evaluate(m, { action: "money.spend", amount: usd(10), at })), "invalid");
  const p = applyProgression(m, { self: { integrity: "A" } }, at);
  assert.equal(p.fired.length, 0);
  assert.equal(p.mandate.scopes[0].action, "money.refund");
});

test("V02: a malformed counterparty check fails closed", () => {
  const m: Mandate = { ...mandate, scopes: [{ action: "network.buy", limits: { per_action: usd(1000) }, counterparty: { min_level: 2, min_integrity: "B" } }] };
  const buy = (counterparty: unknown) => evaluate(m, { action: "network.buy", amount: usd(10), at, counterparty: counterparty as never });
  assert.equal(denyCode(buy({ assurance: "measured" })), "invalid", "no level or integrity");
  assert.equal(denyCode(buy({ level: 3, integrity: "Z", assurance: "measured" })), "invalid", "unknown grade");
  assert.equal(denyCode(buy({ level: 3, integrity: "A", assurance: "measured" })), "allow");
  const bad: Mandate = { ...m, scopes: [{ ...m.scopes[0], counterparty: { min_assurance: "gold" as never } }] };
  assert.ok(validateMandate(bad).some((p) => /min_assurance/.test(p)));
  assert.equal(denyCode(evaluate(bad, { action: "network.buy", amount: usd(10), at, counterparty: { level: 3, integrity: "A", assurance: "claimed" } })), "invalid");
});

test("V03: a delegation chain must reach its root, and a revoked ancestor denies as revoked", () => {
  const parent: Mandate = { ...mandate, id: "p", subject: "agent:a" };
  const child: Mandate = { ...mandate, id: "c", issuer: "agent:a", subject: "agent:b", parent: "p", scopes: [{ action: "money.spend", limits: { per_action: usd(500), per_day: usd(1000) } }] };
  const req = { action: "money.spend" as const, amount: usd(100), at };
  assert.equal(denyCode(evaluateChain([child], req)), "invalid", "leaving the parent out is not allowed");
  assert.equal(new ExposureBook().reserve([child], req, { id: "r1" }).held, false);
  assert.equal(denyCode(evaluateChain([child, parent], req)), "allow");
  assert.equal(denyCode(evaluateChain([child, { ...parent, revoked: true }], req)), "revoked");
});

test("V04: delegation is compared with the parent's most specific scope", () => {
  const parent: Mandate = {
    ...mandate,
    id: "p",
    scopes: [
      { action: "money.spend", limits: { per_action: usd(100000) } },
      { action: "money.spend", domain: "ads", limits: { per_action: usd(1000) } },
    ],
  };
  const base = { ...mandate, id: "c", issuer: parent.subject, subject: "agent:b", parent: "p" };
  assert.equal(isAttenuationOf({ ...base, scopes: [{ action: "money.spend", domain: "ads", limits: { per_action: usd(50000) } }] }, parent).ok, false);
  assert.equal(isAttenuationOf({ ...base, scopes: [{ action: "money.spend", limits: { per_action: usd(50000) } }] }, parent).ok, false, "an area-less child scope also applies to ads");
  assert.equal(
    isAttenuationOf({ ...base, scopes: [{ action: "money.spend", limits: { per_action: usd(50000) } }, { action: "money.spend", domain: "ads", limits: { per_action: usd(500) } }] }, parent).ok,
    true,
  );
});

test("V05: a delegated mandate can't redirect or loosen escalation, or widen rail bindings", () => {
  const parent: Mandate = { ...mandate, id: "p", bindings: { mpp: { session_limit: usd(1000) } } };
  const ok: Mandate = { ...mandate, id: "c", issuer: parent.subject, subject: "agent:b", parent: "p", bindings: { mpp: { session_limit: usd(500) } } };
  assert.equal(isAttenuationOf(ok, parent).ok, true);
  assert.equal(isAttenuationOf({ ...ok, escalation: { to: parent.subject, timeout_s: 60, on_timeout: "deny" } }, parent).ok, false, "the delegating agent can't approve itself");
  assert.equal(isAttenuationOf({ ...ok, escalation: { ...parent.escalation, on_timeout: "allow" } }, parent).ok, false);
  assert.equal(isAttenuationOf({ ...ok, bindings: { mpp: { session_limit: usd(5000) } } }, parent).ok, false);
});

test("V06: mandate keys and validator keys aren't interchangeable", () => {
  const owner = generateIssuerKeys();
  const v = generateIssuerKeys();
  const company = {
    id: "did:web:co.example",
    signing_keys: [{ id: "k1", holder: "human:h", alg: "Ed25519" as const, public_key_pem: owner.publicKeyPem }],
    validator_keys: [{ id: "v1", alg: "Ed25519" as const, public_key_pem: v.publicKeyPem }],
  };
  const signed = signMandate(mandate, owner.privateKey, "k1");
  assert.deepEqual(verifyMandate(signed, mandateKeyResolver(company)), { ok: true });
  assert.equal(validatorKeyResolver(company)("human:h", "k1"), undefined, "a mandate key is not a validator key");
  // An attestation signed with the company's mandate key doesn't verify as the company's attestation.
  const { profile } = score(zh3Company(), manifest, { asOf: FIXTURE_AS_OF, chainVerified: true });
  const a = issueAttestation({ issuer: company.id, kid: "k1", profile, evidenceHead: "h", now: "2026-09-01T00:00:00Z", privateKey: owner.privateKey });
  assert.equal(verifyAttestation(a, { resolveKey: validatorKeyResolver(company), now: "2026-09-02T00:00:00Z" }).ok, false);
  // And a validator key can't sign a mandate.
  const forged = signMandate({ ...mandate, issuer: company.id }, v.privateKey, "v1");
  assert.equal(verifyMandate(forged, mandateKeyResolver(company)).ok, false);
});

test("V07: verification enforces independence and the 90-day limit exactly", () => {
  const keys = generateIssuerKeys();
  const resolveKey = (issuer: string) => (issuer === "did:web:v.example" ? keys.publicKeyPem : undefined);
  const { profile } = score(zh3Company(), manifest, { asOf: FIXTURE_AS_OF, chainVerified: true });
  const a = issueAttestation({ issuer: "did:web:v.example", profile, evidenceHead: "h", now: "2026-09-01T00:00:00Z", privateKey: keys.privateKey });
  const resign = (payload: typeof a.payload) => ({ ...a, payload, signature: signCanonical(payload, keys.privateKey) });
  const conflicted = resign({ ...a.payload, independence: { common_control: true, fee_depends_on_outcome: true } });
  assert.equal(verifyAttestation(conflicted, { resolveKey, now: "2026-09-02T00:00:00Z" }).ok, false);
  const long = resign({ ...a.payload, expires_at: new Date(Date.parse(a.payload.issued_at) + 90 * DAY + 4 * 60_000).toISOString() });
  assert.equal(verifyAttestation(long, { resolveKey, now: "2026-09-02T00:00:00Z" }).reason, "validity longer than allowed");
});

test("V08: misconduct no good conduct could offset counts before a metric is observed", () => {
  const ev: ZHCEvent[] = [];
  for (let i = 0; i < 60; i++) ev.push({ ...base(i), type: "task.completed", domain: "d", actor: "ai", touch: "none" });
  for (let i = 0; i < 19; i++) ev.push({ ...base(100 + i), type: "interaction", channel: "email", ai_disclosed: false });
  for (let i = 0; i < 19; i++) ev.push({ ...base(200 + i), type: "conduct.complaint", severity: "major" });
  assert.equal(scoreIntegrity(ev).grade, "D");
  // One miss in 19 could still end at 95% after the 20th, so it isn't decisive: unrated, not C.
  const mild: ZHCEvent[] = ev.filter((e) => e.type === "task.completed");
  for (let i = 0; i < 19; i++) mild.push({ ...base(300 + i), type: "interaction", channel: "email", ai_disclosed: i !== 0 });
  assert.equal(scoreIntegrity(mild).grade, "U");
});

test("V09: the volume floor counts only the AI's own actions", () => {
  const ev: ZHCEvent[] = [];
  for (let i = 0; i < 50; i++) ev.push({ ...base(i), type: "money.moved", direction: "in", category: "revenue", money: usd(100), authorized_by: "human_approval" });
  for (let i = 0; i < 20; i++) ev.push({ ...base(60 + i), type: "interaction", channel: "email", ai_disclosed: true });
  ev.push({ ...base(90), type: "conduct.refund_request", eligible: true, honored: true });
  const r = scoreIntegrity(ev);
  assert.equal(r.metrics.actions, 0);
  assert.equal(r.grade, "U");
});

test("V11: unattended stretches start when a session ends and skip holes in the log", () => {
  const ev: ZHCEvent[] = [];
  for (let h = 0; h <= 130; h++) ev.push({ ...base(h), type: "task.completed", domain: "d", actor: "ai", touch: "none" });
  // One long session of approvals from hour 100 to hour 120 (contacts 50 minutes apart).
  for (let m = 100 * 60; m <= 120 * 60; m += 50) ev.push({ ...base(m / 60 + 0.01), type: "decision.made", tier: "operational", origin: "ai", decided_by: "human", approval: "pre" });
  const r = score(ev, undefined, { asOf: atHour(130) });
  assert.ok(Math.abs((r.metrics.longest_unattended_hours ?? 0) - 100) < 0.1, `longest ${r.metrics.longest_unattended_hours}`);
  // No contacts at all, with a 300-hour hole in the middle of the log.
  const holed: ZHCEvent[] = [];
  for (let h = 0; h <= 100; h++) holed.push({ ...base(h), type: "task.completed", domain: "d", actor: "ai", touch: "none" });
  for (let h = 400; h <= 500; h++) holed.push({ ...base(h), type: "task.completed", domain: "d", actor: "ai", touch: "none" });
  const hr = score(holed, undefined, { asOf: atHour(500) });
  assert.ok((hr.metrics.longest_unattended_hours ?? 0) < 230, `longest ${hr.metrics.longest_unattended_hours}`);
});

test("V12: a rule with no area targets only the area-less scope", () => {
  const m: Mandate = {
    ...mandate,
    scopes: [{ action: "money.spend", domain: "ads", limits: { per_action: usd(1000) } }],
    progression: [{ when: { metric: "level", op: ">=", value: 3, source: "processor" }, then: { action: "money.spend", set: { limits: { per_action: usd(100000) } } } }],
  };
  const p = applyProgression(m, { processor: { level: 4 } }, at);
  assert.equal(p.fired.length, 0);
  assert.equal(p.mandate.scopes[0].limits?.per_action?.amount, 1000);
});

test("V14: N2 needs the sale of a service the manifest lists", () => {
  const ev = zh3Company();
  ev.push({ ...base(1000), type: "network.transaction", counterparty: "did:web:x.example", counterparty_is_zhc: true, direction: "sell", money: usd(4900), service: "unlisted" });
  assert.equal(score(ev, manifest, { asOf: FIXTURE_AS_OF }).profile.axes.N, 1);
  ev.push({ ...base(1001), type: "network.transaction", counterparty: "did:web:x.example", counterparty_is_zhc: true, direction: "sell", money: usd(4900), service: "svc" });
  assert.equal(score(ev, manifest, { asOf: FIXTURE_AS_OF }).profile.axes.N, 2);
});

test("V20: the evidence gap is unknown, not zero, when there is no evidence", () => {
  assert.equal(score([], manifest, { asOf: FIXTURE_AS_OF }).metrics.evidence_gap_hours, null);
});

// --- Found while upgrading the reference desk to 0.2.1 (D-findings) --------------------------

test("D01: usage counts only against the scope it was spent under", () => {
  const m: Mandate = {
    ...mandate,
    scopes: [
      { action: "money.collect", limits: { per_month: usd(1_000_000) } },
      { action: "money.spend", limits: { per_month: usd(150_000) } },
    ],
  };
  const book = new ExposureBook();
  assert.equal(book.reserve([m], { action: "money.collect", amount: usd(200_000), at }, { id: "c1" }).held, true);
  assert.equal(book.reserve([m], { action: "money.spend", amount: usd(1000), at }, { id: "s1" }).held, true, "a collection doesn't use up the spend cap");
  assert.equal(book.usage(m.id, at, "money.spend|*").month.USD, 1000);
});

test("D02: a new version of a mandate inherits the usage of the version it supersedes", () => {
  const v1: Mandate = { ...mandate, id: "v1", scopes: [{ action: "money.spend", limits: { per_month: usd(150_000) } }] };
  const v2: Mandate = { ...v1, id: "v2", supersedes: "v1" };
  const book = new ExposureBook();
  assert.equal(book.reserve([v1], { action: "money.spend", amount: usd(140_000), at }, { id: "a" }).held, true);
  const r = book.reserve([v2], { action: "money.spend", amount: usd(140_000), at }, { id: "b" });
  assert.equal(denyCode(r.verdict), "limit", "re-issuing the mandate doesn't reset its monthly cap");
  assert.deepEqual(book.lineage("v2"), ["v2", "v1"]);
});

test("D03: a widening rule never undoes a wider version the issuer signed; a narrowing rule never widens", () => {
  const facts = { processor: { settled_volume: 1_000_000 } };
  const widen: Mandate = {
    ...mandate,
    scopes: [{ action: "money.refund", limits: { per_action: usd(200_000) }, require_approval_over: usd(100_000) }],
    progression: [{ when: { metric: "settled_volume", op: ">=", value: 500_000, source: "processor" }, then: { action: "money.refund", set: { require_approval_over: usd(50_000) } }, effect: "widen" }],
  };
  const p = applyProgression(widen, facts, at);
  assert.equal(p.fired.length, 0, "the signed version is already wider: satisfied, not narrowed");
  assert.equal(p.mandate.scopes[0].require_approval_over?.amount, 100_000);
  const narrow: Mandate = { ...widen, progression: [{ ...widen.progression![0], effect: "narrow", then: { action: "money.refund", set: { require_approval_over: usd(150_000) } } }] };
  const q = applyProgression(narrow, facts, at);
  assert.equal(q.fired.length, 0);
  assert.equal(q.refused.length, 1, "a narrowing rule that would widen is refused");
});

test("D04: an old log isn't measured as of today", () => {
  const ev = zh3Company();
  assert.equal(score(ev, manifest, { asOf: FIXTURE_AS_OF, chainVerified: true }).profile.assurance, "measured");
  const later = score(ev, manifest, { asOf: "2026-09-30T00:00:00Z", chainVerified: true });
  assert.equal(later.profile.assurance, "provisional", "the evidence ends a month before asOf");
});

test("W04: an approval band is satisfied by a timeout only if every mandate allows it and the time has passed", () => {
  const allow: Mandate = { ...mandate, escalation: { to: "human:h", timeout_s: 3600, on_timeout: "allow" }, scopes: [{ action: "money.refund", limits: { per_action: usd(10_000) }, require_approval_over: usd(1000) }] };
  const req = { action: "money.refund" as const, amount: usd(5000), at: "2026-06-01T02:00:00Z" };
  const book = new ExposureBook();
  assert.equal(book.reserve([allow], req, { id: "early", approvedBy: "timeout", escalatedAt: "2026-06-01T01:30:00Z" }).held, false, "only 30 minutes have passed");
  assert.equal(book.reserve([allow], req, { id: "late", approvedBy: "timeout", escalatedAt: "2026-06-01T00:30:00Z" }).held, true);
  const deny: Mandate = { ...allow, escalation: { ...allow.escalation, on_timeout: "deny" } };
  assert.equal(book.reserve([deny], req, { id: "d", approvedBy: "timeout", escalatedAt: "2026-06-01T00:00:00Z" }).held, false);
  assert.equal(book.reserve([deny], { ...req, amount: usd(20_000) }, { id: "h", approvedBy: "human" }).held, false, "no approval passes a hard limit");
});

test("W06: an escalation nobody answered counts as autonomous and is reported", () => {
  const ev: ZHCEvent[] = [];
  for (let i = 0; i < 10; i++) ev.push({ ...base(i), type: "decision.made", tier: "tactical", origin: "ai", decided_by: "ai", approval: i < 3 ? "timeout" : "none" });
  const r = score(ev, undefined, { asOf: "2026-07-05T00:00:00Z" });
  assert.equal(r.metrics.unanswered_escalations, 3);
  assert.equal(r.metrics.tactical_autonomy, 1);
});
