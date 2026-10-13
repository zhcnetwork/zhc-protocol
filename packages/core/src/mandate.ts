// Mandates: signed, machine-readable business authority for an agent.
// Pure evaluation logic; signing lives in attestation.ts helpers.
import type { DecisionTier, IntegrityGrade, Money, Assurance, ZHLevel } from "./types.ts";

export type MandateAction =
  | "money.spend"
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

export interface ProgressionRule {
  /** Metric name from a ScoreReport (`metrics`), or `integrity` / `level`. */
  when: { metric: string; op: ">=" | "<=" | "=="; value: number | string };
  /** Which scope to widen and the new values. */
  then: { action: MandateAction; set: Partial<MandateScope> };
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

export type Verdict =
  | { decision: "allow"; scope: MandateScope }
  | { decision: "require_approval"; scope: MandateScope; reason: string; escalate_to: string }
  | { decision: "deny"; reason: string };

const TIERS: DecisionTier[] = ["tactical", "operational", "strategic", "charter"];
const GRADES: IntegrityGrade[] = ["A", "B", "C", "D", "U"];
const ASSURANCE: Assurance[] = ["claimed", "provisional", "measured", "attested"];

function over(m: Money | undefined, limit: Money | undefined): boolean {
  if (!m || !limit) return false;
  if (m.currency !== limit.currency) return true; // a limit in another currency never authorizes
  return m.amount > limit.amount;
}

export function evaluate(mandate: Mandate, req: ActionRequest, usage: UsageLedger = { day: {}, month: {} }): Verdict {
  if (mandate.revoked) return { decision: "deny", reason: "mandate revoked" };
  const at = Date.parse(req.at);
  if (at < Date.parse(mandate.issued_at) || at > Date.parse(mandate.expires_at)) {
    return { decision: "deny", reason: "outside mandate validity window" };
  }
  const scope = mandate.scopes.find((s) => s.action === req.action && (!s.domain || s.domain === req.domain));
  if (!scope) return { decision: "deny", reason: `no scope grants ${req.action}${req.domain ? ` in ${req.domain}` : ""}` };

  if (req.tier === "charter") return { decision: "deny", reason: "charter-tier decisions are reserved to the accountable human" };
  if (req.tier && scope.tier_max && TIERS.indexOf(req.tier) > TIERS.indexOf(scope.tier_max)) {
    return { decision: "require_approval", scope, reason: `${req.tier} decision exceeds tier_max ${scope.tier_max}`, escalate_to: mandate.escalation.to };
  }
  if (scope.max_relative_change !== undefined && req.relative_change !== undefined && Math.abs(req.relative_change) > scope.max_relative_change) {
    return { decision: "deny", reason: `change ${Math.round(req.relative_change * 100)}% exceeds ±${Math.round(scope.max_relative_change * 100)}%` };
  }
  if (scope.counterparty && req.counterparty) {
    const c = scope.counterparty;
    const cp = req.counterparty;
    if (c.min_level !== undefined && cp.level < c.min_level) return { decision: "deny", reason: `counterparty ZH${cp.level} below ZH${c.min_level}` };
    if (c.min_integrity && (cp.integrity === "U" || GRADES.indexOf(cp.integrity) > GRADES.indexOf(c.min_integrity))) {
      return { decision: "deny", reason: `counterparty integrity ${cp.integrity} below ${c.min_integrity}` };
    }
    if (c.min_assurance && ASSURANCE.indexOf(cp.assurance) < ASSURANCE.indexOf(c.min_assurance)) {
      return { decision: "deny", reason: `counterparty assurance ${cp.assurance} below ${c.min_assurance}` };
    }
  } else if (scope.counterparty) {
    return { decision: "deny", reason: "scope requires a counterparty check but none was supplied" };
  }

  const amt = req.amount;
  if (amt) {
    const l = scope.limits ?? {};
    const dayUsed = (usage.day[amt.currency] ?? 0) + amt.amount;
    const monthUsed = (usage.month[amt.currency] ?? 0) + amt.amount;
    if (l.per_day && (l.per_day.currency !== amt.currency || dayUsed > l.per_day.amount)) return { decision: "deny", reason: "daily limit reached" };
    if (l.per_month && (l.per_month.currency !== amt.currency || monthUsed > l.per_month.amount)) return { decision: "deny", reason: "monthly limit reached" };
    // per_action is a hard cap; require_approval_over defines an approval band beneath it.
    if (over(amt, l.per_action)) return { decision: "deny", reason: "per-action limit exceeded" };
    if (over(amt, scope.require_approval_over)) {
      return { decision: "require_approval", scope, reason: `amount over ${scope.require_approval_over!.amount} ${scope.require_approval_over!.currency}`, escalate_to: mandate.escalation.to };
    }
  }
  return { decision: "allow", scope };
}

/** A delegated mandate may only narrow its parent: same or fewer actions, same or lower limits. */
export function isAttenuationOf(child: Mandate, parent: Mandate): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
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
    if (ps.tier_max && (!cs.tier_max || TIERS.indexOf(cs.tier_max) > TIERS.indexOf(ps.tier_max))) problems.push(`${cs.action}.tier_max exceeds parent`);
  }
  return { ok: problems.length === 0, problems };
}

/**
 * Progressive autonomy: widen scopes whose progression rule is satisfied by the latest score.
 * Returns a new mandate (caller re-signs it) and the rules that fired.
 */
export function applyProgression(
  mandate: Mandate,
  facts: Record<string, number | string | null>,
): { mandate: Mandate; fired: ProgressionRule[] } {
  const fired: ProgressionRule[] = [];
  const scopes = mandate.scopes.map((s) => ({ ...s }));
  for (const rule of mandate.progression ?? []) {
    const v = facts[rule.when.metric];
    if (v === null || v === undefined) continue;
    const { op, value } = rule.when;
    let ok: boolean;
    if (rule.when.metric === "integrity" && typeof v === "string" && typeof value === "string") {
      // Grades compare by rank: A is best.
      const rv = GRADES.indexOf(v as IntegrityGrade);
      const rt = GRADES.indexOf(value as IntegrityGrade);
      ok = op === "==" ? rv === rt : op === ">=" ? rv <= rt : rv >= rt;
    } else {
      ok = op === ">=" ? Number(v) >= Number(value) : op === "<=" ? Number(v) <= Number(value) : v === value;
    }
    if (!ok) continue;
    const i = scopes.findIndex((s) => s.action === rule.then.action);
    if (i < 0) continue;
    scopes[i] = { ...scopes[i], ...rule.then.set, limits: { ...scopes[i].limits, ...rule.then.set.limits } };
    fired.push(rule);
  }
  return { mandate: { ...mandate, scopes }, fired };
}
