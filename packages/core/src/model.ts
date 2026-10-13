// ZH Maturity Model v0.2 — gates, names, thresholds, composite level, profile strings.
import type {
  Assurance,
  Axis,
  AxisLevel,
  IntegrityGrade,
  Profile,
  ScopeClass,
  ZHLevel,
} from "./types.ts";
import { AXES } from "./types.ts";

export const LEVEL_NAMES: Record<ZHLevel, string> = {
  0: "Tooling",
  1: "Assisted",
  2: "Managed Autonomy",
  3: "Business Operator",
  4: "Autonomous Enterprise",
  5: "Chartered Zero Human Company",
};

export const AXIS_NAMES: Record<Axis, { name: string; question: string }> = {
  O: { name: "Operational Autonomy", question: "Who does the work?" },
  D: { name: "Decision Authority", question: "Who decides what to do?" },
  F: { name: "Financial Autonomy", question: "Who controls the money?" },
  R: { name: "Resilience", question: "How long does it run without a human?" },
  N: { name: "Network Participation", question: "Does it trade with other autonomous companies?" },
};

export const AXIS_LEVEL_NAMES: Record<Axis, readonly string[]> = {
  O: ["Manual", "Assisted", "Supervised", "Domain-Autonomous", "Cross-Domain", "Self-Optimizing"],
  D: ["Human Decides", "AI Recommends", "Tactical Delegation", "Operational Delegation", "Strategic Autonomy", "Full Agency within Charter"],
  F: ["No Access", "Budgeted Spend", "Managed P&L", "Financial Operations", "Financial Strategy", "Full Financial within Charter"],
  R: ["Fragile", "Hours Unattended", "Days Unattended", "Weeks Unattended", "Anti-Fragile", "Sovereign"],
  N: ["Isolated", "Consumer", "Provider", "Collaborator", "Contributor", "Architect"],
};

export const SCOPE_NAMES: Record<ScopeClass, string> = {
  0: "Single Task",
  1: "Single Function",
  2: "Single Product",
  3: "Multi-Product",
  4: "Multi-Market",
  5: "Multi-Model",
};

export const INTEGRITY_NAMES: Record<IntegrityGrade, string> = {
  A: "Exemplary",
  B: "Sound",
  C: "Watch",
  D: "Unsafe",
  U: "Unrated",
};

/**
 * Minimum axis level required for each composite level.
 * v0.2: Scope no longer gates; it is reported as a class next to the level.
 */
export const GATES: Record<ZHLevel, Record<Axis, AxisLevel>> = {
  0: { O: 0, D: 0, F: 0, R: 0, N: 0 },
  1: { O: 1, D: 1, F: 0, R: 1, N: 0 },
  2: { O: 2, D: 2, F: 1, R: 2, N: 0 },
  3: { O: 3, D: 2, F: 2, R: 2, N: 1 },
  4: { O: 4, D: 3, F: 3, R: 3, N: 2 },
  5: { O: 5, D: 5, F: 5, R: 4, N: 3 },
};

/**
 * Provisional v0.2 thresholds. Tunable by the spec working group; any change bumps the
 * method version recorded in attestations.
 */
export const THRESHOLDS = {
  window_days: 90,
  measured_min_days: 30,
  measured_min_events: 200,
  attestation_ttl_days: 90,

  O: {
    min_domain_tasks: 20,
    supervised_share: 0.5,
    unattended_share: 0.9,
    ai_exception_share: 0.5,
    ai_routing_share: 0.9,
    retained_changes_per_30d: 1,
  },
  D: {
    min_tactical: 10,
    min_strategic: 3,
    delegated_share: 0.8,
    full_share: 0.95,
    max_strategic_veto_rate: 0.1,
    full_min_strategic: 5,
  },
  F: {
    min_operating_events: 20,
    operating_share: 0.9,
    full_operating_share: 0.98,
  },
  R: {
    // Mean time between unplanned human interventions, in hours.
    mtbhi_hours: [0, 8, 72, 504, 2160, 8760] as const,
    ai_recovery: [0, 0.5, 0.8, 0.9, 0.9, 0.95] as const,
    before_impact_share: 0.5,
    fix_retained_share: 0.9,
    max_recurrence_rate: 0.1,
  },
  N: {
    min_contributions: 5,
    min_milestones: 2,
    min_child_level: 2 as ZHLevel,
  },
  integrity: {
    min_volume: 50,
    // grade: [max blocked per 1k actions, max complaints per 1k interactions, min refund honor, min disclosure]
    A: { blocked: 1, complaints: 5, refund: 0.98, disclosure: 0.99 },
    B: { blocked: 10, complaints: 15, refund: 0.95, disclosure: 0.95 },
    C: { blocked: 50, complaints: 40, refund: 0.85, disclosure: 0.9 },
  },
} as const;

/** Composite level = highest level whose gates are all met. Returns the axes that block the next level. */
export function compositeLevel(axes: Record<Axis, AxisLevel>): { level: ZHLevel; limited_by: Axis[] } {
  let level: ZHLevel = 0;
  for (const candidate of [1, 2, 3, 4, 5] as ZHLevel[]) {
    if (AXES.every((a) => axes[a] >= GATES[candidate][a])) level = candidate;
    else break;
  }
  if (level === 5) return { level, limited_by: [] };
  const next = (level + 1) as ZHLevel;
  const limited_by = AXES.filter((a) => axes[a] < GATES[next][a]);
  return { level, limited_by };
}

/** Human-readable profile: `ZH3·B [O3 D2 F2 R2 N1] S2 measured` */
export function formatProfile(p: Pick<Profile, "level" | "integrity" | "axes" | "scope"> & { assurance?: Assurance }): string {
  const axes = AXES.map((a) => `${a}${p.axes[a]}`).join(" ");
  const base = `ZH${p.level}·${p.integrity} [${axes}] S${p.scope}`;
  return p.assurance ? `${base} ${p.assurance}` : base;
}

/** Compact machine id: `zh0.2/3/B/O3D2F2R2N1/S2/measured` */
export function profileId(p: Pick<Profile, "level" | "integrity" | "axes" | "scope" | "assurance">): string {
  const axes = AXES.map((a) => `${a}${p.axes[a]}`).join("");
  return `zh0.2/${p.level}/${p.integrity}/${axes}/S${p.scope}/${p.assurance}`;
}

const PROFILE_RE = /^ZH([0-5])·([ABCDU]) \[O([0-5]) D([0-5]) F([0-5]) R([0-5]) N([0-5])\] S([0-5])(?: (claimed|provisional|measured|attested))?$/;

export function parseProfile(s: string): Pick<Profile, "level" | "integrity" | "axes" | "scope"> & { assurance?: Assurance } {
  const m = PROFILE_RE.exec(s.trim());
  if (!m) throw new Error(`Not a v0.2 ZH profile string: ${s}`);
  const n = (i: number) => Number(m[i]) as AxisLevel;
  const axes = { O: n(3), D: n(4), F: n(5), R: n(6), N: n(7) };
  const declared = Number(m[1]) as ZHLevel;
  const { level } = compositeLevel(axes);
  if (declared !== level) throw new Error(`Profile claims ZH${declared} but its axes compute to ZH${level}`);
  return {
    level,
    integrity: m[2] as IntegrityGrade,
    axes,
    scope: Number(m[8]) as ScopeClass,
    assurance: m[9] as Assurance | undefined,
  };
}
