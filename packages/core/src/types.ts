// ZHC Protocol v0.2 — core types.
// Erasable TypeScript only (no enums / parameter properties) so Node can run it with type stripping.

export const SPEC_VERSION = "0.2";

/** The five autonomy axes that gate the composite ZH level. */
export type Axis = "O" | "D" | "F" | "R" | "N";
export const AXES: readonly Axis[] = ["O", "D", "F", "R", "N"];

export type AxisLevel = 0 | 1 | 2 | 3 | 4 | 5;
export type ZHLevel = 0 | 1 | 2 | 3 | 4 | 5;
/** Scope class S0–S5: describes complexity, does not gate the ZH level. */
export type ScopeClass = 0 | 1 | 2 | 3 | 4 | 5;
/** Integrity grade, reported next to every ZH level. U = unrated (insufficient evidence). */
export type IntegrityGrade = "A" | "B" | "C" | "D" | "U";
/** How a profile was produced. */
export type Assurance = "claimed" | "provisional" | "measured" | "attested";

export type Actor = "ai" | "human";
export type DecisionTier = "tactical" | "operational" | "strategic" | "charter";
export type Rail = "stripe" | "x402" | "mpp" | "ap2" | "acp" | "ledger" | "other";

export interface Money {
  /** Integer minor units (cents for USD). */
  amount: number;
  currency: string;
}

// ---------------------------------------------------------------------------
// Evidence events
// ---------------------------------------------------------------------------

interface EventBase {
  v: "0.2";
  id: string;
  /** ISO-8601 timestamp. */
  ts: string;
  /** Company id (DID or domain) emitting the event. */
  company: string;
  /** Agent id within the company, if an agent acted. */
  agent?: string;
  domain?: string;
  /** Mandate id under which the action was taken. */
  mandate?: string;
  /** Hash of the previous event in this company's log (hash chain). */
  prev?: string;
  /** sha256 of the canonical event without `hash`. */
  hash?: string;
}

export interface TaskCompleted extends EventBase {
  type: "task.completed";
  actor: Actor;
  /** Human involvement on this task. batch_review = sampled/aggregate review, not per item. */
  touch: "none" | "batch_review" | "item_review" | "approval";
  exception?: boolean;
  exception_handled_by?: Actor;
  /** True when the task was handed off from another domain. */
  cross_domain?: boolean;
  routed_by?: Actor;
}

export interface DecisionMade extends EventBase {
  type: "decision.made";
  /** For decisions escalated to a human: what the human decided. */
  outcome?: "approved" | "denied";
  tier: DecisionTier;
  /** Who originated the option that was chosen. */
  origin: Actor;
  decided_by: Actor;
  /** pre = approved before acting; post_veto_window = acted, human could veto afterwards. */
  approval: "none" | "pre" | "post_veto_window";
  vetoed?: boolean;
  summary?: string;
}

export type MoneyCategory =
  | "spend"
  | "pricing_change"
  | "revenue"
  | "vendor_payment"
  | "refund"
  | "reserve"
  | "investment"
  | "distribution";

export interface MoneyMoved extends EventBase {
  type: "money.moved";
  direction: "in" | "out" | "none";
  category: MoneyCategory;
  money: Money;
  authorized_by: "mandate" | "human_approval" | "human";
  rail?: Rail;
  product?: string;
  counterparty?: string;
}

export interface HumanIntervention extends EventBase {
  type: "human.intervention";
  /** routine = scheduled board review; does not count against resilience. */
  kind: "fix" | "override" | "kill_switch" | "routine";
  reason?: string;
}

export interface IncidentResolved extends EventBase {
  type: "incident.resolved";
  severity: "low" | "medium" | "high" | "critical";
  detected_by: Actor;
  detected_before_impact: boolean;
  resolved_by: Actor;
  duration_s: number;
  recurrence_of?: string;
  fix_retained?: boolean;
}

export interface ProcessChanged extends EventBase {
  type: "process.changed";
  initiated_by: Actor;
  change: "workflow" | "role_created" | "role_retired" | "policy";
  retained: boolean;
  summary?: string;
}

export interface NetworkTransaction extends EventBase {
  type: "network.transaction";
  counterparty: string;
  counterparty_is_zhc: boolean;
  direction: "buy" | "sell";
  money: Money;
  service?: string;
}

export interface NetworkCollaboration extends EventBase {
  type: "network.collaboration";
  counterparty: string;
  contract: string;
  milestones_completed: number;
}

export interface NetworkContribution extends EventBase {
  type: "network.contribution";
  kind: "feedback" | "attestation" | "validation" | "insight";
  subject?: string;
}

export interface CompanySpawned extends EventBase {
  type: "company.spawned";
  child: string;
  child_level: ZHLevel;
}

export interface Interaction extends EventBase {
  type: "interaction";
  channel: string;
  /** Did the agent disclose that it is an AI? */
  ai_disclosed: boolean;
}

export interface ConductComplaint extends EventBase {
  type: "conduct.complaint";
  severity: "minor" | "major";
}

export interface ConductRefund extends EventBase {
  type: "conduct.refund_request";
  eligible: boolean;
  honored: boolean;
}

export interface ConductMandateBlocked extends EventBase {
  type: "conduct.mandate_blocked";
  action: string;
  reason: string;
}

export interface ConductMandateBreach extends EventBase {
  type: "conduct.mandate_breach";
  action: string;
  remediated: boolean;
}

export interface ConductDeception extends EventBase {
  type: "conduct.deception";
  severity: "minor" | "major";
  remediated: boolean;
  summary?: string;
}

export interface MandateChanged extends EventBase {
  type: "mandate.changed";
  /** Mandate id that was issued, widened, narrowed or revoked. */
  subject_mandate: string;
  change: "issued" | "widened" | "narrowed" | "revoked";
  /** progression = a progression rule fired; issuer = the issuer changed it by hand. */
  cause: "progression" | "issuer";
  summary?: string;
}

export type ZHCEvent =
  | TaskCompleted
  | DecisionMade
  | MoneyMoved
  | HumanIntervention
  | IncidentResolved
  | ProcessChanged
  | NetworkTransaction
  | NetworkCollaboration
  | NetworkContribution
  | CompanySpawned
  | Interaction
  | ConductComplaint
  | ConductRefund
  | ConductMandateBlocked
  | ConductMandateBreach
  | ConductDeception
  | MandateChanged;

export type EventType = ZHCEvent["type"];

// ---------------------------------------------------------------------------
// Company manifest (/.well-known/zhc.json)
// ---------------------------------------------------------------------------

export interface ManifestAgent {
  id: string;
  role: string;
  domain: string;
  /** URL of the agent's A2A Agent Card. */
  agent_card?: string;
  /** ERC-8004 identity: eip155:{chainId}:{registry}:{agentId}. */
  erc8004?: string;
}

export interface ManifestService {
  id: string;
  description: string;
  endpoint: string;
  protocol: "a2a" | "mcp" | "http";
  price?: Money;
  rails?: Rail[];
}

export interface Manifest {
  zhc: "0.2";
  id: string;
  name: string;
  url?: string;
  legal: {
    entity_name: string;
    jurisdiction: string;
    form?: string;
    registration_id?: string;
  };
  accountable_human: {
    name: string;
    contact: string;
  };
  charter: {
    mission: string;
    /** Decisions only the accountable human may make (charter tier). */
    reserved_to_human: string[];
    prohibited: string[];
    uri?: string;
  };
  domains: string[];
  scope?: {
    class?: ScopeClass;
    products?: number;
    markets?: number;
    business_models?: number;
  };
  agents: ManifestAgent[];
  services?: ManifestService[];
  mandates_uri?: string;
  /** Public keys this company signs attestations with, if it acts as a validator. */
  validator_keys?: { id: string; alg: "Ed25519"; public_key_pem: string }[];
  evidence?: { uri: string; format: "zhc-events/0.2" };
  parent?: string;
  profile?: { claimed?: string; attestations?: string[] };
}

// ---------------------------------------------------------------------------
// Scoring output
// ---------------------------------------------------------------------------

export interface AxisResult {
  level: AxisLevel;
  /** Human-readable reason for each criterion that passed or failed. */
  notes: string[];
}

export interface IntegrityResult {
  grade: IntegrityGrade;
  metrics: {
    interactions: number;
    actions: number;
    deception_major: number;
    deception_minor_unremediated: number;
    deception_minor: number;
    breaches: number;
    blocked_per_1k_actions: number;
    complaints_per_1k_interactions: number;
    refund_honor_rate: number | null;
    disclosure_rate: number | null;
  };
  notes: string[];
}

export interface Profile {
  spec: "0.2";
  company: string;
  level: ZHLevel;
  axes: Record<Axis, AxisLevel>;
  scope: ScopeClass;
  integrity: IntegrityGrade;
  assurance: Assurance;
  window?: { from: string; to: string; days: number; events: number };
  /** Axis that capped the composite level (the "weakest link"), if any. */
  limited_by?: Axis[];
}

export interface ScoreReport {
  profile: Profile;
  axes: Record<Axis, AxisResult>;
  integrity: IntegrityResult;
  metrics: Record<string, number | null>;
}
