// Mandates: signed, machine-readable business authority for an agent.
// Pure evaluation logic; signing lives in attestation.ts helpers.
import type { DecisionTier, IntegrityGrade, Money, Assurance, ZHLevel } from "./types.ts";

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

export interface CounterpartyRequirement {
  min_level?: ZHLevel;
  min_integrity?: Exclude<IntegrityGrade, "U">;
  min_assurance?: Assurance;
}

export interface MandateScope {
  action: MandateAction;
  domain?: string;
  /** Highest decision tier this scope may decide alone. */
  tier_max?: DecisionTier;
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

export interface ProgressionCondition {
  /** Metric name from a ScoreReport (`metrics`), or `integrity` / `level`. */
  metric: string;
  op: ">=" | "<=" | "==";
  value: number | string;
}

export interface ProgressionRule {
  /** One condition, or several that must all hold. */
  when: ProgressionCondition | ProgressionCondition[];
  /** Which scope to widen (by action, and domain if given) and the new values. */
  then: { action: MandateAction; domain?: string; set: Partial<MandateScope> };
  note?: string;
}

export interface Mandate {
  zhc: "0.2";
  id: string;
  /** Who grants authority: the accountable human, or a parent agent (delegation). */
  issuer: string;
  subject: string;
  parent?: string;
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

/** Spend already used under this mandate, per currency, for limit checks. */
export interface UsageLedger {
  day: Record<string, number>;
  month: Record<string, number>;
}

/**
 * Why an action was denied. `counterparty` denials mean the other party failed the buyer's
 * requirements; they are screening outcomes, not conduct by the agent (PROTOCOL §3.1).
 */
export type DenyCode = "revoked" | "validity" | "scope" | "charter" | "change" | "counterparty" | "limit";

export type Verdict =
  | { decision: "allow"; scope: MandateScope }
  | { decision: "require_approval"; scope: MandateScope; reason: string; escalate_to: string }
  | { decision: "deny"; code: DenyCode; reason: string };

const TIERS: DecisionTier[] = ["tactical", "operational", "strategic", "charter"];
const GRADES: IntegrityGrade[] = ["A", "B", "C", "D", "U"];
const ASSURANCE: Assurance[] = ["claimed", "provisional", "measured", "attested"];

function over(m: Money | undefined, limit: Money | undefined): boolean {
  if (!m || !limit) return false;
  if (m.currency !== limit.currency) return true; // a limit in another currency never authorizes
  return m.amount > limit.amount;
}

export function evaluate(mandate: Mandate, req: ActionRequest, usage: UsageLedger = { day: {}, month: {} }): Verdict {
  const deny = (code: DenyCode, reason: string): Verdict => ({ decision: "deny", code, reason });
  if (mandate.revoked) return deny("revoked", "mandate revoked");
  const at = Date.parse(req.at);
  if (at < Date.parse(mandate.issued_at) || at > Date.parse(mandate.expires_at)) {
    return deny("validity", "outside mandate validity window");
  }
  const scope = mandate.scopes.find((s) => s.action === req.action && (!s.domain || s.domain === req.domain));
  if (!scope) return deny("scope", `no scope grants ${req.action}${req.domain ? ` in ${req.domain}` : ""}`);
  if (req.tier === "charter") return deny("charter", "charter-tier decisions are reserved to the accountable human");

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
    const l = scope.limits ?? {};
    const dayUsed = (usage.day[amt.currency] ?? 0) + amt.amount;
    const monthUsed = (usage.month[amt.currency] ?? 0) + amt.amount;
    if (l.per_day && (l.per_day.currency !== amt.currency || dayUsed > l.per_day.amount)) return deny("limit", "daily limit reached");
    if (l.per_month && (l.per_month.currency !== amt.currency || monthUsed > l.per_month.amount)) return deny("limit", "monthly limit reached");
    if (over(amt, l.per_action)) return deny("limit", "per-action limit exceeded");
  }

  // 2. Approval bands: the action is permissible, but not by the agent alone.
  if (req.tier && scope.tier_max && TIERS.indexOf(req.tier) > TIERS.indexOf(scope.tier_max)) {
    return { decision: "require_approval", scope, reason: `${req.tier} decision exceeds tier_max ${scope.tier_max}`, escalate_to: mandate.escalation.to };
  }
  if (amt && over(amt, scope.require_approval_over)) {
    return { decision: "require_approval", scope, reason: `amount over ${scope.require_approval_over!.amount} ${scope.require_approval_over!.currency}`, escalate_to: mandate.escalation.to };
  }
  return { decision: "allow", scope };
}

const RANK = <T,>(order: readonly T[], x: T | undefined) => (x === undefined ? -1 : order.indexOf(x));

/** A delegated mandate may only narrow its parent: same or fewer actions, same or lower limits, same or stricter checks. */
export function isAttenuationOf(child: Mandate, parent: Mandate): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  if (parent.revoked) problems.push("parent is revoked");
  if (Date.parse(child.expires_at) > Date.parse(parent.expires_at)) problems.push("child outlives parent");
  for (const cs of child.scopes) {
    const ps = parent.scopes.find((p) => p.action === cs.action && (!p.domain || p.domain === cs.domain));
    if (!ps) {
      problems.push(`parent does not grant ${cs.action}`);
      continue;
    }
    for (const k of ["per_action", "per_day", "per_month"] as const) {
      const pl = ps.limits?.[k];
      const cl = cs.limits?.[k];
      if (pl && (!cl || over(cl, pl))) problems.push(`${cs.action}.${k} exceeds parent`);
    }
    if (ps.require_approval_over) {
      // The child's effective approval threshold: its own band, else its hard cap (nothing above it is allowed anyway).
      const eff = cs.require_approval_over ?? cs.limits?.per_action;
      if (!eff || over(eff, ps.require_approval_over)) problems.push(`${cs.action}.require_approval_over exceeds parent`);
    }
    if (ps.tier_max && (!cs.tier_max || TIERS.indexOf(cs.tier_max) > TIERS.indexOf(ps.tier_max))) problems.push(`${cs.action}.tier_max exceeds parent`);
    if (ps.max_relative_change !== undefined && (cs.max_relative_change === undefined || cs.max_relative_change > ps.max_relative_change)) {
      problems.push(`${cs.action}.max_relative_change exceeds parent`);
    }
    const pc = ps.counterparty;
    if (pc) {
      const cc = cs.counterparty ?? {};
      if (pc.min_level !== undefined && (cc.min_level === undefined || cc.min_level < pc.min_level)) problems.push(`${cs.action}.counterparty.min_level weaker than parent`);
      // Grades: lower index is stricter.
      if (pc.min_integrity && (!cc.min_integrity || GRADES.indexOf(cc.min_integrity) > GRADES.indexOf(pc.min_integrity))) problems.push(`${cs.action}.counterparty.min_integrity weaker than parent`);
      if (pc.min_assurance && RANK(ASSURANCE, cc.min_assurance) < RANK(ASSURANCE, pc.min_assurance)) problems.push(`${cs.action}.counterparty.min_assurance weaker than parent`);
    }
  }
  return { ok: problems.length === 0, problems };
}

function holds(cond: ProgressionCondition, facts: Record<string, number | string | null>): boolean {
  const v = facts[cond.metric];
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

/**
 * Progressive autonomy: widen scopes whose progression rule is satisfied by the latest score.
 * Returns a new mandate (the issuer re-signs it) and the rules that fired.
 */
export function applyProgression(
  mandate: Mandate,
  facts: Record<string, number | string | null>,
): { mandate: Mandate; fired: ProgressionRule[] } {
  const fired: ProgressionRule[] = [];
  const scopes = mandate.scopes.map((s) => ({ ...s }));
  for (const rule of mandate.progression ?? []) {
    const conds = Array.isArray(rule.when) ? rule.when : [rule.when];
    if (!conds.every((c) => holds(c, facts))) continue;
    const i = scopes.findIndex((s) => s.action === rule.then.action && (rule.then.domain === undefined || s.domain === rule.then.domain));
    if (i < 0) continue;
    const next: MandateScope = { ...scopes[i], ...rule.then.set };
    if (scopes[i].limits || rule.then.set.limits) next.limits = { ...scopes[i].limits, ...rule.then.set.limits };
    scopes[i] = next;
    fired.push(rule);
  }
  return { mandate: { ...mandate, scopes }, fired };
}
