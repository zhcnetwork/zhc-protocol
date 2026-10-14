// Mandates: signed, machine-readable business authority for an agent (PROTOCOL §3).
// Pure evaluation logic, browser-safe. Signing lives in signing.ts (node) and crypto-web.ts (web).
//
// v0.2.1 rules this file enforces:
// - evaluation fails closed: a request that lacks a field some constraint needs is denied;
// - the most specific scope wins, and an area-limited action must name its area;
// - delegated authority is checked link by link, and limits are shared across the chain;
// - progression rules may widen authority only from facts the company doesn't author.
import type { Assurance, DecisionTier, IntegrityGrade, Money, ZHLevel } from "./types.ts";

export type MandateAction =
  | "money.spend"
  | "money.collect"
  | "money.refund"
  | "money.vendor_payment"
  | "money.reserve"
  | "pricing.change"
  | "decision.make"
  | "service.deliver"
  | "network.buy"
  | "network.sell"
  | "process.change"
  | "attestation.issue";

/** Actions that always move money, and so always need an amount. */
export const MONEY_ACTIONS: readonly MandateAction[] = [
  "money.spend",
  "money.collect",
  "money.refund",
  "money.vendor_payment",
  "money.reserve",
  "network.buy",
  "network.sell",
];

export interface CounterpartyRequirement {
  /**
   * The buyer's policy, enforced like any other limit. A ZH level describes how a company runs, not
   * whether it can deliver or make good on a loss, so it isn't evidence of capacity (PROTOCOL §7).
   */
  min_level?: ZHLevel;
  min_integrity?: Exclude<IntegrityGrade, "U">;
  min_assurance?: Assurance;
}

export interface MandateScope {
  action: MandateAction;
  domain?: string;
  /** Highest decision tier this scope may decide alone. Charter decisions are never delegable. */
  tier_max?: Exclude<DecisionTier, "charter">;
  limits?: {
    per_action?: Money;
    per_day?: Money;
    per_month?: Money;
  };
  /** Above this amount the action needs human approval instead of being denied. */
  require_approval_over?: Money;
  /** For pricing.change: max relative change per action, e.g. 0.2 = ±20%. */
  max_relative_change?: number;
  counterparty?: CounterpartyRequirement;
}

/**
 * Where a progression fact comes from.
 * - `self`: anything the company computes or records itself, including its own ZH score.
 * - `attestation`: a current, verified attestation by an independent validator (attestation.ts).
 * - `processor`: figures from a payment processor or custodian, e.g. settled volume.
 * Self-sourced rules may only narrow authority (PROTOCOL §3.3).
 */
export type ProgressionSource = "self" | "attestation" | "processor";

export interface ProgressionCondition {
  /** Metric name, or `integrity` / `level`. */
  metric: string;
  op: ">=" | "<=" | "==";
  value: number | string;
  /** Defaults to "self". */
  source?: ProgressionSource;
}

export interface ProgressionRule {
  /** One condition, or several that must all hold. */
  when: ProgressionCondition | ProgressionCondition[];
  /** Which scope to change (by action, and domain if given) and the new values. */
  then: { action: MandateAction; domain?: string; set: Partial<MandateScope> };
  /**
   * What the rule is for. A `widen` rule never narrows: once the scope is at least as wide, it is
   * satisfied and does nothing, so it can't undo a wider version the issuer signed. A `narrow` rule
   * never widens. Without it, the rule applies whichever way it points (self-sourced rules still
   * can't widen).
   */
  effect?: "widen" | "narrow";
  note?: string;
}

export interface MandateSignature {
  alg: "Ed25519";
  /** Key id; verifiers resolve it from the issuer's manifest or DID document. */
  kid: string;
  /** base64url signature over the canonical JSON of the mandate without `signature`. */
  sig: string;
}

export interface Mandate {
  zhc: "0.2";
  id: string;
  /** Who grants authority: the accountable human, or the subject of the parent mandate (delegation). */
  issuer: string;
  subject: string;
  /** Delegation parent: the mandate whose subject issued this one. */
  parent?: string;
  /** Earlier version of the same grant that this one replaces (not a delegation link). */
  supersedes?: string;
  issued_at: string;
  expires_at: string;
  revoked?: boolean;
  scopes: MandateScope[];
  escalation: { to: string; timeout_s: number; on_timeout: "deny" | "allow" };
  progression?: ProgressionRule[];
  /** Optional compiled forms for payment rails. */
  bindings?: {
    mpp?: { session_limit: Money };
    x402?: { max_amount: Money };
    ap2?: { intent_mandate: string };
  };
  signature?: MandateSignature;
}

export interface ActionRequest {
  action: MandateAction;
  domain?: string;
  amount?: Money;
  tier?: DecisionTier;
  relative_change?: number;
  counterparty?: { level: ZHLevel; integrity: IntegrityGrade; assurance: Assurance };
  at: string;
}

/** Spend already used under a mandate, per currency, for limit checks. */
export interface UsageLedger {
  day: Record<string, number>;
  month: Record<string, number>;
}

/**
 * Why an action was denied. `counterparty` denials mean the other party failed the buyer's
 * requirements; they are screening outcomes, not conduct by the agent (PROTOCOL §3.1).
 * `invalid` means the request or mandate was malformed and nothing could be checked safely.
 */
export type DenyCode = "invalid" | "revoked" | "validity" | "scope" | "charter" | "change" | "counterparty" | "limit";

export type Verdict =
  | { decision: "allow"; scope: MandateScope }
  | { decision: "require_approval"; scope: MandateScope; reason: string; escalate_to: string }
  | { decision: "deny"; code: DenyCode; reason: string };

const TIERS: DecisionTier[] = ["tactical", "operational", "strategic", "charter"];
const OPS: ProgressionCondition["op"][] = [">=", "<=", "=="];
const SOURCES: ProgressionSource[] = ["self", "attestation", "processor"];
const GRADES: IntegrityGrade[] = ["A", "B", "C", "D", "U"];
const ASSURANCE: Assurance[] = ["claimed", "provisional", "measured", "attested"];
const CURRENCY_RE = /^[A-Z0-9]{3,5}$/;
const EMPTY_USAGE: UsageLedger = { day: {}, month: {} };

const validTime = (s: unknown): s is string => typeof s === "string" && Number.isFinite(Date.parse(s));

/** A money value is a non-negative safe integer in minor units with a currency code. */
export function isValidMoney(m: unknown): m is Money {
  if (!m || typeof m !== "object") return false;
  const { amount, currency } = m as Money;
  return Number.isSafeInteger(amount) && amount >= 0 && typeof currency === "string" && CURRENCY_RE.test(currency);
}

/** Structural problems that make a mandate unusable. An empty list means it can be evaluated. */
export function validateMandate(m: Mandate): string[] {
  const problems: string[] = [];
  if (!validTime(m.issued_at)) problems.push("issued_at is not a valid time");
  if (!validTime(m.expires_at)) problems.push("expires_at is not a valid time");
  if (validTime(m.issued_at) && validTime(m.expires_at) && Date.parse(m.issued_at) >= Date.parse(m.expires_at)) {
    problems.push("expires_at must be after issued_at");
  }
  if (!Array.isArray(m.scopes) || m.scopes.length === 0) problems.push("a mandate needs at least one scope");
  const e = m.escalation;
  if (!e || typeof e.to !== "string" || !e.to || !Number.isSafeInteger(e.timeout_s) || e.timeout_s < 0 || (e.on_timeout !== "deny" && e.on_timeout !== "allow")) {
    problems.push("escalation needs an approver, a non-negative whole-second timeout and an on_timeout of deny or allow");
  }
  const keys = new Set<string>();
  for (const s of m.scopes ?? []) {
    const key = `${s.action}|${s.domain ?? "*"}`;
    if (keys.has(key)) problems.push(`two scopes for ${s.action}${s.domain ? ` in ${s.domain}` : ""}`);
    keys.add(key);
    for (const k of ["per_action", "per_day", "per_month"] as const) {
      const l = s.limits?.[k];
      if (l !== undefined && !isValidMoney(l)) problems.push(`${s.action}.${k} is not a valid amount`);
    }
    if (s.require_approval_over !== undefined && !isValidMoney(s.require_approval_over)) problems.push(`${s.action}.require_approval_over is not a valid amount`);
    if (s.max_relative_change !== undefined && !(Number.isFinite(s.max_relative_change) && s.max_relative_change >= 0)) {
      problems.push(`${s.action}.max_relative_change must be a non-negative number`);
    }
    if (s.tier_max !== undefined && !(TIERS.includes(s.tier_max) && (s.tier_max as string) !== "charter")) problems.push(`${s.action}.tier_max must be tactical, operational or strategic`);
    const c = s.counterparty;
    if (c !== undefined) {
      if (c.min_level !== undefined && !(Number.isInteger(c.min_level) && c.min_level >= 0 && c.min_level <= 5)) problems.push(`${s.action}.counterparty.min_level must be 0 to 5`);
      if (c.min_integrity !== undefined && !["A", "B", "C", "D"].includes(c.min_integrity)) problems.push(`${s.action}.counterparty.min_integrity must be A, B, C or D`);
      if (c.min_assurance !== undefined && !ASSURANCE.includes(c.min_assurance)) problems.push(`${s.action}.counterparty.min_assurance is not an assurance level`);
    }
  }
  for (const [i, r] of (m.progression ?? []).entries()) {
    const conds = Array.isArray(r?.when) ? r.when : [r?.when];
    if (!conds.length || conds.some((c) => !c || typeof c.metric !== "string" || !OPS.includes(c.op) || (c.source !== undefined && !SOURCES.includes(c.source)))) {
      problems.push(`progression rule ${i + 1} has a malformed condition`);
    }
    if (!r?.then || typeof r.then.action !== "string" || !r.then.set || typeof r.then.set !== "object") problems.push(`progression rule ${i + 1} has no target scope or change`);
    else if ("action" in r.then.set || "domain" in r.then.set) problems.push(`progression rule ${i + 1} may not change a scope's action or area`);
    if (r?.effect !== undefined && r.effect !== "widen" && r.effect !== "narrow") problems.push(`progression rule ${i + 1} has an unknown effect`);
  }
  const b = m.bindings;
  for (const [label, money] of [["bindings.mpp.session_limit", b?.mpp?.session_limit], ["bindings.x402.max_amount", b?.x402?.max_amount]] as const) {
    if (money !== undefined && !isValidMoney(money)) problems.push(`${label} is not a valid amount`);
  }
  return problems;
}

/** Problems with the counterparty profile a request carries. Empty means it can be checked. */
function counterpartyProblems(cp: ActionRequest["counterparty"]): string[] {
  if (cp === undefined) return [];
  const problems: string[] = [];
  if (!(Number.isInteger(cp.level) && cp.level >= 0 && cp.level <= 5)) problems.push("level must be 0 to 5");
  if (!GRADES.includes(cp.integrity)) problems.push("integrity must be A, B, C, D or U");
  if (!ASSURANCE.includes(cp.assurance)) problems.push("assurance is not an assurance level");
  return problems;
}

function over(m: Money, limit: Money): boolean {
  if (m.currency !== limit.currency) return true; // a limit in another currency never authorizes
  return m.amount > limit.amount;
}

/**
 * Most-specific matching scope. A scope for the request's area beats an area-less one. If the
 * action is limited by area anywhere in the mandate, the request must name its area.
 */
export function selectScope(m: Mandate, req: ActionRequest): { scope: MandateScope } | { code: DenyCode; reason: string } {
  const candidates = m.scopes.filter((s) => s.action === req.action);
  if (!candidates.length) return { code: "scope", reason: `no scope grants ${req.action}` };
  if (req.domain === undefined) {
    if (candidates.some((s) => s.domain !== undefined)) {
      return { code: "invalid", reason: `${req.action} is limited by area in this mandate; the request must name its area` };
    }
    return { scope: candidates[0] };
  }
  const exact = candidates.find((s) => s.domain === req.domain);
  if (exact) return { scope: exact };
  const general = candidates.find((s) => s.domain === undefined);
  if (general) return { scope: general };
  return { code: "scope", reason: `no scope grants ${req.action} in ${req.domain}` };
}

/**
 * Usage already counted against a mandate: a ledger, or a function that returns the ledger for the
 * scope the request selects (limits belong to a scope, so other scopes' flows don't count).
 */
export type UsageSource = UsageLedger | ((scope: MandateScope) => UsageLedger);

export function evaluate(mandate: Mandate, req: ActionRequest, usageSource: UsageSource = EMPTY_USAGE): Verdict {
  const deny = (code: DenyCode, reason: string): Verdict => ({ decision: "deny", code, reason });

  // 0. Well-formedness: nothing malformed reaches a limit check.
  const problems = validateMandate(mandate);
  if (problems.length) return deny("invalid", `mandate ${mandate.id} is malformed: ${problems.join("; ")}`);
  if (!req || typeof req.action !== "string") return deny("invalid", "request has no action");
  if (!validTime(req.at)) return deny("invalid", "request time is missing or not a valid time");
  if (req.amount !== undefined && !isValidMoney(req.amount)) {
    return deny("invalid", "amount must be a non-negative integer in minor units with a currency code");
  }
  if (MONEY_ACTIONS.includes(req.action) && req.amount === undefined) return deny("invalid", `${req.action} needs an amount`);
  if (req.action === "decision.make" && req.tier === undefined) return deny("invalid", "decision.make needs a decision tier");
  if (req.action === "pricing.change" && req.relative_change === undefined) return deny("invalid", "pricing.change needs the relative change");
  if (req.tier !== undefined && !TIERS.includes(req.tier)) return deny("invalid", `unknown decision tier ${String(req.tier)}`);
  if (req.relative_change !== undefined && !Number.isFinite(req.relative_change)) return deny("invalid", "relative change must be a finite number");
  const cpProblems = counterpartyProblems(req.counterparty);
  if (cpProblems.length) return deny("invalid", `counterparty profile is malformed: ${cpProblems.join("; ")}`);

  if (mandate.revoked) return deny("revoked", "mandate revoked");
  const at = Date.parse(req.at);
  if (at < Date.parse(mandate.issued_at) || at > Date.parse(mandate.expires_at)) {
    return deny("validity", "outside mandate validity window");
  }
  const picked = selectScope(mandate, req);
  if (!("scope" in picked)) return deny(picked.code, picked.reason);
  const scope = picked.scope;
  if (req.tier === "charter") return deny("charter", "charter-tier decisions are reserved to the accountable human");

  // Every constraint in the scope must be checkable from the request.
  const hasMoneyConstraint = scope.limits?.per_action || scope.limits?.per_day || scope.limits?.per_month || scope.require_approval_over;
  if (hasMoneyConstraint && req.amount === undefined) return deny("invalid", `${req.action} is limited by amount here; the request must include one`);
  if (scope.tier_max && req.tier === undefined) return deny("invalid", `${req.action} is limited by decision tier here; the request must include one`);
  if (scope.max_relative_change !== undefined && req.relative_change === undefined) {
    return deny("invalid", `${req.action} is limited by relative change here; the request must include it`);
  }

  // 1. Hard limits first: no human approval can override these.
  if (scope.max_relative_change !== undefined && req.relative_change !== undefined && Math.abs(req.relative_change) > scope.max_relative_change) {
    return deny("change", `change ${Math.round(req.relative_change * 100)}% exceeds ±${Math.round(scope.max_relative_change * 100)}%`);
  }
  if (scope.counterparty) {
    const c = scope.counterparty;
    const cp = req.counterparty;
    if (!cp) return deny("counterparty", "scope requires a counterparty check but none was supplied");
    if (c.min_level !== undefined && cp.level < c.min_level) return deny("counterparty", `counterparty ZH${cp.level} below ZH${c.min_level}`);
    if (c.min_integrity && (cp.integrity === "U" || GRADES.indexOf(cp.integrity) > GRADES.indexOf(c.min_integrity))) {
      return deny("counterparty", `counterparty integrity ${cp.integrity} below ${c.min_integrity}`);
    }
    if (c.min_assurance && ASSURANCE.indexOf(cp.assurance) < ASSURANCE.indexOf(c.min_assurance)) {
      return deny("counterparty", `counterparty assurance ${cp.assurance} below ${c.min_assurance}`);
    }
  }
  const amt = req.amount;
  if (amt) {
    const usage = typeof usageSource === "function" ? usageSource(scope) : usageSource;
    const l = scope.limits ?? {};
    const dayUsed = (usage.day[amt.currency] ?? 0) + amt.amount;
    const monthUsed = (usage.month[amt.currency] ?? 0) + amt.amount;
    if (l.per_day && (l.per_day.currency !== amt.currency || dayUsed > l.per_day.amount)) return deny("limit", "daily limit reached");
    if (l.per_month && (l.per_month.currency !== amt.currency || monthUsed > l.per_month.amount)) return deny("limit", "monthly limit reached");
    if (l.per_action && over(amt, l.per_action)) return deny("limit", "per-action limit exceeded");
  }

  // 2. Approval bands: the action is permissible, but not by the agent alone.
  if (req.tier && scope.tier_max && TIERS.indexOf(req.tier) > TIERS.indexOf(scope.tier_max)) {
    return { decision: "require_approval", scope, reason: `${req.tier} decision exceeds tier_max ${scope.tier_max}`, escalate_to: mandate.escalation.to };
  }
  if (amt && scope.require_approval_over && over(amt, scope.require_approval_over)) {
    return {
      decision: "require_approval",
      scope,
      reason: `amount over ${scope.require_approval_over.amount} ${scope.require_approval_over.currency}`,
      escalate_to: mandate.escalation.to,
    };
  }
  return { decision: "allow", scope };
}

/**
 * Evaluate an action under a delegated mandate and every ancestor. `chain[0]` is the subject's
 * mandate; each next element is its delegation parent. Any deny denies; any approval band requires
 * approval. `usageOf` must return usage shared by everything that spends under that mandate (all its
 * versions, and its descendants) for the scope the request selects in it (see ExposureBook).
 */
export function evaluateChain(
  chain: Mandate[],
  req: ActionRequest,
  usageOf: (mandateId: string, scope: MandateScope) => UsageLedger = () => EMPTY_USAGE,
): Verdict {
  if (!chain.length) return { decision: "deny", code: "invalid", reason: "no mandate" };
  // The chain must reach its root: leaving out a parent would skip its revocation and its limits.
  const root = chain[chain.length - 1];
  if (root.parent !== undefined) {
    return { decision: "deny", code: "invalid", reason: `incomplete delegation chain: ${root.id} was delegated from ${root.parent}, which wasn't supplied` };
  }
  // A revoked mandate cuts off everything delegated from it.
  const revoked = chain.find((m) => m.revoked);
  if (revoked) return { decision: "deny", code: "revoked", reason: revoked === chain[0] ? "mandate revoked" : `${revoked.id} was revoked, and everything delegated from it with it` };
  for (let i = 0; i + 1 < chain.length; i++) {
    const link = isAttenuationOf(chain[i], chain[i + 1]);
    if (!link.ok) return { decision: "deny", code: "invalid", reason: `delegation chain broken at ${chain[i].id}: ${link.problems.join("; ")}` };
  }
  let approval: Verdict | undefined;
  let leaf: Verdict | undefined;
  for (const m of chain) {
    const v = evaluate(m, req, (scope) => usageOf(m.id, scope));
    if (v.decision === "deny") return { ...v, reason: m === chain[0] ? v.reason : `${m.id}: ${v.reason}` };
    if (v.decision === "require_approval" && !approval) approval = v;
    if (!leaf) leaf = v;
  }
  return approval ?? leaf!;
}

export interface Reservation {
  id: string;
  /** Every mandate in the chain the amount counts against. */
  mandates: string[];
  /** The scope each of those mandates selected for the request (`scopeKey()`), in the same order. */
  scopes?: string[];
  amount: Money;
  at: string;
  state: "held" | "committed" | "released";
}

/** Identifies a scope within a mandate's grant: `action|domain`, with `*` for an area-less scope. */
export const scopeKey = (s: Pick<MandateScope, "action" | "domain">): string => `${s.action}|${s.domain ?? "*"}`;

/**
 * Exposure accounting shared across a delegation chain. Reserve before acting, commit once the
 * effect is confirmed, release if it didn't happen. Usage belongs to a *grant* and a *scope*:
 * - a parent's cap bounds the sum of everything spent under it and its descendants;
 * - a new version of a mandate (`supersedes`) inherits the usage of the versions before it, so
 *   re-issuing a mandate can't reset a daily or monthly limit;
 * - an amount counts only against the scope each mandate selected for it, so one scope's flows
 *   (say, collections) don't use up another's cap (say, spending).
 */
export class ExposureBook {
  #res = new Map<string, Reservation>();
  #supersedes = new Map<string, string>();

  constructor(reservations: Reservation[] = [], mandates: Pick<Mandate, "id" | "supersedes">[] = []) {
    for (const r of reservations) this.#res.set(r.id, { ...r });
    for (const m of mandates) this.learn(m);
  }

  /** Records that a mandate supersedes an earlier version. reserve() learns this from every chain it sees. */
  learn(m: Pick<Mandate, "id" | "supersedes">): void {
    if (m.supersedes && m.supersedes !== m.id) this.#supersedes.set(m.id, m.supersedes);
  }

  /** A mandate and every version it supersedes, newest first. */
  lineage(mandateId: string): string[] {
    const out: string[] = [];
    for (let id: string | undefined = mandateId; id !== undefined && !out.includes(id); id = this.#supersedes.get(id)) out.push(id);
    return out;
  }

  /** Usage under a mandate's grant on the day and month of `at`; for one scope if `scope` (a scopeKey) is given. */
  usage(mandateId: string, at: string, scope?: string): UsageLedger {
    const iso = new Date(at).toISOString();
    const day = iso.slice(0, 10);
    const month = iso.slice(0, 7);
    const grant = new Set(this.lineage(mandateId));
    const out: UsageLedger = { day: {}, month: {} };
    for (const r of this.#res.values()) {
      if (r.state === "released") continue;
      const i = r.mandates.findIndex((m) => grant.has(m));
      if (i < 0) continue;
      // Reservations without scope keys (recorded by older code) count against every scope.
      if (scope !== undefined && r.scopes?.[i] !== undefined && r.scopes[i] !== scope) continue;
      const rIso = new Date(r.at).toISOString();
      if (rIso.slice(0, 7) === month) out.month[r.amount.currency] = (out.month[r.amount.currency] ?? 0) + r.amount.amount;
      if (rIso.slice(0, 10) === day) out.day[r.amount.currency] = (out.day[r.amount.currency] ?? 0) + r.amount.amount;
    }
    return out;
  }

  /**
   * Evaluate and, if permitted, hold the amount against every mandate in the chain. Pass
   * `approved: true` only when a human approved this exact action; it satisfies an approval band but
   * never a hard limit, and the action is re-evaluated against current mandates and usage now.
   */
  reserve(chain: Mandate[], req: ActionRequest, opts: { id: string; approved?: boolean }): { verdict: Verdict; held: boolean } {
    if (this.#res.has(opts.id)) throw new Error(`reservation ${opts.id} already exists`);
    for (const m of chain) this.learn(m);
    const verdict = evaluateChain(chain, req, (id, scope) => (validTime(req.at) ? this.usage(id, req.at, scopeKey(scope)) : EMPTY_USAGE));
    const permitted = verdict.decision === "allow" || (verdict.decision === "require_approval" && opts.approved === true);
    if (!permitted) return { verdict, held: false };
    if (req.amount) {
      const scopes = chain.map((m) => {
        const picked = selectScope(m, req);
        return "scope" in picked ? scopeKey(picked.scope) : "";
      });
      this.#res.set(opts.id, { id: opts.id, mandates: chain.map((m) => m.id), scopes, amount: { ...req.amount }, at: req.at, state: "held" });
    }
    return { verdict, held: true };
  }

  commit(id: string): void {
    const r = this.#res.get(id);
    if (r && r.state === "held") r.state = "committed";
  }

  release(id: string): void {
    const r = this.#res.get(id);
    if (r && r.state === "held") r.state = "released";
  }

  list(): Reservation[] {
    return [...this.#res.values()].map((r) => ({ ...r, scopes: r.scopes ? [...r.scopes] : undefined }));
  }
}

/** Ways `cs` would grant more than `ps` for one scope. Empty means it is no wider. */
export function scopeWideningProblems(cs: MandateScope, ps: MandateScope): string[] {
  const problems: string[] = [];
  const name = `${cs.action}${cs.domain ? `(${cs.domain})` : ""}`;
  if (cs.action !== ps.action) problems.push(`${name} grants a different action than ${ps.action}`);
  if (ps.domain !== undefined && cs.domain !== ps.domain) problems.push(`${name} is not limited to ${ps.domain}`);
  for (const k of ["per_action", "per_day", "per_month"] as const) {
    const pl = ps.limits?.[k];
    const cl = cs.limits?.[k];
    if (pl && (!cl || over(cl, pl))) problems.push(`${name}.${k} exceeds parent`);
  }
  if (ps.require_approval_over) {
    // The effective approval threshold: its own band, else its hard cap (nothing above it is allowed anyway).
    const eff = cs.require_approval_over ?? cs.limits?.per_action;
    if (!eff || over(eff, ps.require_approval_over)) problems.push(`${name}.require_approval_over exceeds parent`);
  }
  if (ps.tier_max && (!cs.tier_max || TIERS.indexOf(cs.tier_max) > TIERS.indexOf(ps.tier_max))) problems.push(`${name}.tier_max exceeds parent`);
  if (ps.max_relative_change !== undefined && (cs.max_relative_change === undefined || cs.max_relative_change > ps.max_relative_change)) {
    problems.push(`${name}.max_relative_change exceeds parent`);
  }
  const pc = ps.counterparty;
  if (pc) {
    const cc = cs.counterparty ?? {};
    if (pc.min_level !== undefined && (cc.min_level === undefined || cc.min_level < pc.min_level)) problems.push(`${name}.counterparty.min_level weaker than parent`);
    if (pc.min_integrity && (!cc.min_integrity || GRADES.indexOf(cc.min_integrity) > GRADES.indexOf(pc.min_integrity))) {
      problems.push(`${name}.counterparty.min_integrity weaker than parent`);
    }
    if (pc.min_assurance && (cc.min_assurance === undefined || ASSURANCE.indexOf(cc.min_assurance) < ASSURANCE.indexOf(pc.min_assurance))) {
      problems.push(`${name}.counterparty.min_assurance weaker than parent`);
    }
  }
  return problems;
}

/**
 * A delegated mandate may only narrow its parent, and must really come from it: issued by the
 * parent's subject, pointing at the parent, starting no earlier and ending no later.
 */
export function isAttenuationOf(child: Mandate, parent: Mandate): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  if (parent.revoked) problems.push("parent is revoked");
  if (child.parent !== parent.id) problems.push(`child.parent is ${child.parent ?? "missing"}, not ${parent.id}`);
  if (child.issuer !== parent.subject) problems.push(`issued by ${child.issuer}, but only ${parent.subject} may delegate this authority`);
  for (const [label, m] of [["child", child], ["parent", parent]] as const) {
    if (!validTime(m.issued_at) || !validTime(m.expires_at)) problems.push(`${label} has an invalid validity window`);
  }
  if (validTime(child.issued_at) && validTime(parent.issued_at) && Date.parse(child.issued_at) < Date.parse(parent.issued_at)) {
    problems.push("child starts before parent");
  }
  if (validTime(child.expires_at) && validTime(parent.expires_at) && Date.parse(child.expires_at) > Date.parse(parent.expires_at)) {
    problems.push("child outlives parent");
  }
  for (const cs of child.scopes) {
    // Compare with the parent scope that would govern the same requests: the most specific one.
    const ps =
      (cs.domain !== undefined ? parent.scopes.find((p) => p.action === cs.action && p.domain === cs.domain) : undefined) ??
      parent.scopes.find((p) => p.action === cs.action && p.domain === undefined);
    if (!ps) {
      problems.push(`parent does not grant ${cs.action}${cs.domain ? ` in ${cs.domain}` : " in every area"}`);
      continue;
    }
    problems.push(...scopeWideningProblems(cs, ps));
    // An area-less child scope also applies in every area the parent limits more tightly, unless the
    // child has its own scope for that area.
    if (cs.domain === undefined) {
      for (const pd of parent.scopes.filter((p) => p.action === cs.action && p.domain !== undefined)) {
        if (child.scopes.some((x) => x.action === cs.action && x.domain === pd.domain)) continue;
        problems.push(...scopeWideningProblems({ ...cs, domain: pd.domain }, pd));
      }
    }
  }
  // Approvals go where the parent's go, and a timeout may not be more permissive.
  const ce = child.escalation;
  const pe = parent.escalation;
  if (ce && pe) {
    if (ce.to !== pe.to) problems.push(`escalation goes to ${ce.to}, not the parent's approver ${pe.to}`);
    if (ce.on_timeout === "allow" && pe.on_timeout !== "allow") problems.push("escalation allows on timeout where the parent denies");
    if (ce.on_timeout === "allow" && pe.on_timeout === "allow" && ce.timeout_s < pe.timeout_s) problems.push("escalation allows on timeout sooner than the parent");
  }
  // Rail bindings may not exceed the parent's.
  for (const [label, cm, pm] of [
    ["bindings.mpp.session_limit", child.bindings?.mpp?.session_limit, parent.bindings?.mpp?.session_limit],
    ["bindings.x402.max_amount", child.bindings?.x402?.max_amount, parent.bindings?.x402?.max_amount],
  ] as const) {
    if (pm && (!cm || over(cm, pm))) problems.push(`${label} exceeds parent`);
  }
  return { ok: problems.length === 0, problems };
}

/** Facts from a verified, independent attestation. Produce with `attestedFacts()` in attestation.ts; they lapse at `expires_at`. */
export interface AttestedFacts {
  kind: "verified-attestation";
  issuer: string;
  subject: string;
  expires_at: string;
  values: Record<string, number | string | null>;
}

export interface ProgressionFacts {
  /** Anything the company computed itself, including its own score. Can only narrow. */
  self?: Record<string, number | string | null>;
  attestation?: AttestedFacts;
  /** Figures from the payment processor or custodian. */
  processor?: Record<string, number | null>;
}

function holds(cond: ProgressionCondition, bag: Record<string, number | string | null> | undefined): boolean {
  if (!bag) return false;
  const v = bag[cond.metric];
  if (v === null || v === undefined) return false;
  const { op, value } = cond;
  if (cond.metric === "integrity" && typeof v === "string" && typeof value === "string") {
    // Grades compare by rank: A is best; U never satisfies a threshold.
    if (v === "U") return false;
    const rv = GRADES.indexOf(v as IntegrityGrade);
    const rt = GRADES.indexOf(value as IntegrityGrade);
    return op === "==" ? rv === rt : op === ">=" ? rv <= rt : rv >= rt;
  }
  return op === ">=" ? Number(v) >= Number(value) : op === "<=" ? Number(v) <= Number(value) : v === value;
}

function bagFor(source: ProgressionSource, facts: ProgressionFacts, atMs: number): Record<string, number | string | null> | undefined {
  if (source === "attestation") {
    const a = facts.attestation;
    // Only a current attestation counts: an expired one widens nothing.
    return a?.kind === "verified-attestation" && Date.parse(a.expires_at) > atMs ? a.values : undefined;
  }
  if (source === "processor") return facts.processor;
  return facts.self;
}

/**
 * Apply progression rules to a mandate at time `at`. Returns the candidate mandate (the issuer
 * re-signs it), the rules that fired, and the rules that matched but were refused: a widening based
 * on self-sourced facts (a proposal for the issuer to sign, never a change in authority), or a rule
 * that would change a scope's action or area, or leave the mandate malformed.
 */
export function applyProgression(
  mandate: Mandate,
  facts: ProgressionFacts,
  at: string,
): { mandate: Mandate; fired: ProgressionRule[]; refused: { rule: ProgressionRule; reason: string; proposed: MandateScope }[] } {
  const atMs = Date.parse(at);
  if (!Number.isFinite(atMs)) throw new Error("applyProgression needs a valid time");
  const fired: ProgressionRule[] = [];
  const refused: { rule: ProgressionRule; reason: string; proposed: MandateScope }[] = [];
  const scopes = mandate.scopes.map((s) => ({ ...s }));
  for (const rule of mandate.progression ?? []) {
    const conds = Array.isArray(rule.when) ? rule.when : [rule.when];
    if (!conds.length || !conds.every((c) => c && holds(c, bagFor(c.source ?? "self", facts, atMs)))) continue;
    // A rule names its scope exactly: with no area it targets the area-less scope only.
    const i = scopes.findIndex((s) => s.action === rule.then.action && s.domain === rule.then.domain);
    if (i < 0) continue;
    const next: MandateScope = { ...scopes[i], ...rule.then.set };
    if (scopes[i].limits || rule.then.set.limits) next.limits = { ...scopes[i].limits, ...rule.then.set.limits };
    if ("action" in rule.then.set || "domain" in rule.then.set) {
      refused.push({ rule, reason: "a progression rule may not change a scope's action or area", proposed: next });
      continue;
    }
    const candidate: Mandate = { ...mandate, scopes: scopes.map((s, k) => (k === i ? next : s)) };
    const problems = validateMandate(candidate);
    if (problems.length) {
      refused.push({ rule, reason: `the change would leave the mandate malformed: ${problems.join("; ")}`, proposed: next });
      continue;
    }
    const widens = scopeWideningProblems(next, scopes[i]).length > 0;
    const narrows = scopeWideningProblems(scopes[i], next).length > 0;
    if (rule.effect === "widen") {
      if (narrows) {
        // Already at least as wide in some respect (e.g. a wider version the issuer signed): the rule
        // never undoes that. If it would also widen something else, it's malformed for its purpose.
        if (widens) refused.push({ rule, reason: "a widening rule may not also narrow", proposed: next });
        continue;
      }
      if (!widens) continue; // satisfied
    }
    if (rule.effect === "narrow") {
      if (widens) {
        refused.push({ rule, reason: "a narrowing rule may not widen", proposed: next });
        continue;
      }
      if (!narrows) continue; // satisfied
    }
    const selfSourced = conds.some((c) => (c.source ?? "self") === "self");
    if (selfSourced && widens) {
      refused.push({ rule, reason: "a rule based on the company's own figures may only narrow authority; the issuer must sign any widening", proposed: next });
      continue;
    }
    scopes[i] = next;
    fired.push(rule);
  }
  return { mandate: { ...mandate, scopes }, fired, refused };
}
