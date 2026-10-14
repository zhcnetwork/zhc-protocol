// ZHC Protocol v0.2.1 — core types.
// Erasable TypeScript only (no enums / parameter properties) so Node can run it with type stripping.

/** Wire-format version carried in every object. Patch revisions (0.2.x) don't change it. */
export const SPEC_VERSION = "0.2";
/** Specification revision this code implements. */
export const SPEC_REVISION = "0.2.1";

/** The five axes of a ZH profile. */
export type Axis = "O" | "D" | "F" | "R" | "N";
export const AXES: readonly Axis[] = ["O", "D", "F", "R", "N"];
/**
 * The four axes that gate the composite ZH level. Since v0.2.1, N (network participation) is
 * reported beside the level, like scope, and no longer gates it.
 */
export type GatingAxis = Exclude<Axis, "N">;
export const GATING_AXES: readonly GatingAxis[] = ["O", "D", "F", "R"];

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

/** An incident detected but not yet resolved. Open incidents count against recovery (MODEL §3, R). */
export interface IncidentOpened extends EventBase {
  type: "incident.opened";
  severity: "low" | "medium" | "high" | "critical";
  detected_by: Actor;
  detected_before_impact: boolean;
}

export interface IncidentResolved extends EventBase {
  type: "incident.resolved";
  /** Id of the matching `incident.opened` event, if one was recorded. */
  incident?: string;
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
  /** Was the change tested against comparable work before it was kept? Required for O5. */
  evaluated?: boolean;
  /** Measured effect of the change on outcomes or cost at equal quality. Required for O5. */
  outcome?: "improved" | "neutral" | "worse";
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
  | IncidentOpened
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
  /**
   * Public keys that sign this company's mandates: the accountable human's, and those of agents
   * that delegate authority. `holder` is the issuer id used in mandates (e.g. "human:owner").
   */
  signing_keys?: { id: string; holder: string; alg: "Ed25519"; public_key_pem: string }[];
  evidence?: { uri: string; format: "zhc-events/0.2" };
  parent?: string;
  profile?: { claimed?: string; attestations?: string[] };
}

/** Returns a trusted public key (SPKI PEM) for an issuer and key id, or undefined if unknown. */
export type KeyResolver = (issuer: string, kid?: string) => string | undefined;

/** Key resolver over a manifest's published keys (signing_keys for mandates, validator_keys for attestations). */
export function manifestKeyResolver(manifest: Pick<Manifest, "id" | "signing_keys" | "validator_keys">): KeyResolver {
  return (issuer, kid) => {
    const signing = (manifest.signing_keys ?? []).find((k) => k.holder === issuer && (kid === undefined || k.id === kid));
    if (signing) return signing.public_key_pem;
    if (issuer === manifest.id) {
      const v = (manifest.validator_keys ?? []).find((k) => kid === undefined || k.id === kid);
      if (v) return v.public_key_pem;
    }
    return undefined;
  };
}

// ---------------------------------------------------------------------------
// Scoring output
// ---------------------------------------------------------------------------

export interface AxisResult {
  level: AxisLevel;
  /** Human-readable reason for each criterion that passed or failed. */
  notes: string[];
}

/** Status of one conduct metric (MODEL §5). */
export type Observation = "observed" | "unobserved" | "not_applicable";

export interface IntegrityResult {
  grade: IntegrityGrade;
  metrics: {
    actions: number;
    interactions: number;
    deception_major: number;
    deception_minor: number;
    deception_minor_unremediated: number;
    breaches: number;
    complaints: number;
    complaints_major: number;
    /** Weighted: a major complaint counts as THRESHOLDS.integrity.complaint_major_weight minor ones. */
    complaints_per_1k_interactions: number | null;
    refund_requests_eligible: number;
    refund_honor_rate: number | null;
    disclosure_rate: number | null;
  };
  /** Whether each metric was applicable and observed. A and B need every applicable metric observed. */
  observation: { disclosure: Observation; complaints: Observation; refunds: Observation };
  /**
   * Control effectiveness: attempts the policy engine stopped. Reported, never graded, so that
   * logging denials can't cost a company its grade.
   */
  control: { blocked: number; blocked_per_1k_actions: number | null };
  notes: string[];
}

export interface Profile {
  spec: "0.2";
  /** Scoring method that produced this profile, e.g. "zhc-score/0.2.1". */
  method: string;
  company: string;
  level: ZHLevel;
  axes: Record<Axis, AxisLevel>;
  scope: ScopeClass;
  /** Scope is taken from the manifest and not yet checked against evidence (v0.2.1). */
  scope_basis?: "declared";
  integrity: IntegrityGrade;
  assurance: Assurance;
  window?: { from: string; to: string; days: number; events: number };
  /** Gating axes that hold the composite below the next level (the "weakest links"). */
  limited_by?: GatingAxis[];
}

export interface ScoreReport {
  profile: Profile;
  axes: Record<Axis, AxisResult>;
  integrity: IntegrityResult;
  metrics: Record<string, number | null>;
}
