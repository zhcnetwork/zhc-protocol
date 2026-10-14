// ZH Maturity Model v0.2.1 — gates, names, thresholds, composite level, profile strings.
// MODEL.md is written from this file; where they disagree, this file is normative for the method
// version below.
import type {
  Assurance,
  Axis,
  AxisLevel,
  GatingAxis,
  IntegrityGrade,
  Profile,
  ScopeClass,
  ZHLevel,
} from "./types.ts";
import { AXES, GATING_AXES } from "./types.ts";

/** Scoring method implemented here. Recorded in every profile and attestation. */
export const METHOD_VERSION = "zhc-score/0.2.1";

export const LEVEL_NAMES: Record<ZHLevel, string> = {
  0: "Tooling",
  1: "Assisted",
  2: "Managed Autonomy",
  3: "Business Operator",
  4: "Autonomous Enterprise",
  5: "Chartered Autonomous Company",
};

/**
 * What each composite level means, stated no more strongly than its gates (some say less). Public
 * copy should use these sentences, or say less, so plain-language claims match the executable test.
 */
export const LEVEL_SUMMARIES: Record<ZHLevel, string> = {
  0: "Below ZH1 on at least one axis. Usually people do the work, with AI tools helping.",
  1: "AI does some of the work and recommends decisions. It goes eight hours or more between rescues, on average.",
  2: "In at least one area, AI does half the work or more without item-by-item review. It makes most routine decisions, spends within budgets, and goes three days or more between rescues, on average.",
  3: "In at least one area, AI does 90% or more of the work untouched and handles at least half its exceptions. It changes prices within limits. Operational decisions may still need a person.",
  4: "In every area, AI does 90% or more of the work untouched and routes the handoffs between areas. 90% or more of operating money moves under mandate, AI makes most operational decisions, and it goes three weeks or more between rescues. Strategy may still need a person.",
  5: "AI makes 95% or more of the decisions at every tier below the charter, moves 98% or more of operating money and every capital allocation under mandate, has kept a tested improvement, and goes 90 days or more between rescues. Charter decisions stay with a named person, who answers for the company.",
};

export const AXIS_NAMES: Record<Axis, { name: string; question: string }> = {
  O: { name: "Operational Autonomy", question: "Who does the work?" },
  D: { name: "Decision Authority", question: "Who decides what to do?" },
  F: { name: "Financial Autonomy", question: "Who controls the money?" },
  R: { name: "Resilience", question: "How often must a person rescue it, and does it recover on its own?" },
  N: { name: "Network Participation", question: "Does it trade with other autonomous companies? (reported, not gating)" },
};

export const AXIS_LEVEL_NAMES: Record<Axis, readonly string[]> = {
  O: ["Manual", "Assisted", "Supervised", "Domain-Autonomous", "Cross-Domain", "Self-Improving"],
  D: ["Human Decides", "AI Recommends", "Tactical Delegation", "Operational Delegation", "Strategic Autonomy", "Full Agency within Charter"],
  F: ["No Access", "Budgeted Spend", "Managed Pricing", "Financial Operations", "Capital Allocation", "Full Financial within Charter"],
  R: ["Fragile", "Hours Without Rescue", "Days Without Rescue", "Weeks Without Rescue", "Months Without Rescue", "A Year Without Rescue"],
  N: ["Isolated", "Consumer", "Provider", "Collaborator", "Contributor", "Founder"],
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
 * Minimum gating-axis level required for each composite level.
 * v0.2.1: N no longer gates (reported beside the level, like scope).
 */
export const GATES: Record<ZHLevel, Record<GatingAxis, AxisLevel>> = {
  0: { O: 0, D: 0, F: 0, R: 0 },
  1: { O: 1, D: 1, F: 0, R: 1 },
  2: { O: 2, D: 2, F: 1, R: 2 },
  3: { O: 3, D: 2, F: 2, R: 2 },
  4: { O: 4, D: 3, F: 3, R: 3 },
  5: { O: 5, D: 5, F: 5, R: 4 },
};

/** v0.2.0 gates, kept only to validate legacy profile strings (where N gated). */
const LEGACY_GATES_0_2_0: Record<ZHLevel, Record<Axis, AxisLevel>> = {
  0: { O: 0, D: 0, F: 0, R: 0, N: 0 },
  1: { O: 1, D: 1, F: 0, R: 1, N: 0 },
  2: { O: 2, D: 2, F: 1, R: 2, N: 0 },
  3: { O: 3, D: 2, F: 2, R: 2, N: 1 },
  4: { O: 4, D: 3, F: 3, R: 3, N: 2 },
  5: { O: 5, D: 5, F: 5, R: 4, N: 3 },
};

/**
 * Provisional v0.2.1 thresholds. Tunable by the spec working group; any change bumps the
 * method version recorded in profiles and attestations.
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
    /** A domain must have handled at least this many exceptions to show it can (O3+). */
    min_exceptions: 1,
    ai_exception_share: 0.5,
    ai_routing_share: 0.9,
    /** O5: retained AI-initiated process changes that were evaluated and improved outcomes. */
    min_improvements: 1,
  },
  D: {
    min_tactical: 10,
    min_operational: 10,
    min_strategic: 3,
    delegated_share: 0.8,
    full_share: 0.95,
    max_strategic_veto_rate: 0.1,
    full_min_strategic: 5,
  },
  F: {
    min_spend_events: 3,
    min_pricing_changes: 2,
    min_revenue_events: 10,
    min_operating_events: 20,
    /** Value shares are checked per currency, for currencies with at least this many operating flows. */
    min_currency_events: 10,
    operating_share: 0.9,
    min_capital_allocations: 2,
    full_operating_share: 0.98,
  },
  R: {
    /** Mean time between unplanned rescues (human.intervention other than routine reviews), hours. */
    mtbr_hours: [0, 8, 72, 504, 2160, 8760] as const,
    ai_recovery: [0, 0.5, 0.8, 0.9, 0.9, 0.95] as const,
    before_impact_share: 0.5,
    fix_retained_share: 0.9,
    max_recurrence_rate: 0.1,
    /** Human operating contacts within this many minutes count as one session (reported metric). */
    session_merge_minutes: 60,
    /**
     * Each event covers at most this many hours after it. Exposure counts only covered time, so a gap
     * in the log (or a log that stopped) is never counted as time without rescues.
     */
    coverage_horizon_hours: 24,
  },
  N: {
    min_contributions: 5,
    min_milestones: 2,
    min_child_level: 2 as ZHLevel,
  },
  integrity: {
    /** Fewer AI actions than this: unrated. */
    min_volume: 50,
    /** Interactions needed before disclosure and complaint rates count as observed. */
    min_interactions: 20,
    /** Eligible refund requests needed before the refund-honoring rate counts as observed. */
    min_eligible_refunds: 1,
    /** A major complaint counts as this many minor ones. */
    complaint_major_weight: 5,
    A: { complaints: 5, refund: 0.98, disclosure: 0.99 },
    B: { complaints: 15, refund: 0.95, disclosure: 0.95 },
    C: { complaints: 40, refund: 0.85, disclosure: 0.9 },
  },
} as const;

/** Composite level = highest level whose gates are all met on the gating axes. */
export function compositeLevel(axes: Record<GatingAxis, AxisLevel>): { level: ZHLevel; limited_by: GatingAxis[] } {
  let level: ZHLevel = 0;
  for (const candidate of [1, 2, 3, 4, 5] as ZHLevel[]) {
    if (GATING_AXES.every((a) => axes[a] >= GATES[candidate][a])) level = candidate;
    else break;
  }
  if (level === 5) return { level, limited_by: [] };
  const next = (level + 1) as ZHLevel;
  const limited_by = GATING_AXES.filter((a) => axes[a] < GATES[next][a]);
  return { level, limited_by };
}

type ProfileLike = Pick<Profile, "level" | "integrity" | "axes" | "scope"> & { assurance?: Assurance };

/** Human-readable profile: `ZH3·B [O3 D2 F2 R2] N1 S2 measured` */
export function formatProfile(p: ProfileLike): string {
  const gating = GATING_AXES.map((a) => `${a}${p.axes[a]}`).join(" ");
  const base = `ZH${p.level}·${p.integrity} [${gating}] N${p.axes.N} S${p.scope}`;
  return p.assurance ? `${base} ${p.assurance}` : base;
}

/** Compact machine id: `zh0.2.1/3/B/O3D2F2R2/N1/S2/measured` */
export function profileId(p: Pick<Profile, "level" | "integrity" | "axes" | "scope" | "assurance">): string {
  const gating = GATING_AXES.map((a) => `${a}${p.axes[a]}`).join("");
  return `zh0.2.1/${p.level}/${p.integrity}/${gating}/N${p.axes.N}/S${p.scope}/${p.assurance}`;
}

const PROFILE_RE = /^ZH([0-5])·([ABCDU]) \[O([0-5]) D([0-5]) F([0-5]) R([0-5])\] N([0-5]) S([0-5])(?: (claimed|provisional|measured|attested))?$/;
const LEGACY_PROFILE_RE = /^ZH([0-5])·([ABCDU]) \[O([0-5]) D([0-5]) F([0-5]) R([0-5]) N([0-5])\] S([0-5])(?: (claimed|provisional|measured|attested))?$/;

export type ParsedProfile = ProfileLike & { method: string };

/**
 * Parse a profile string. Accepts the v0.2.1 form and the legacy v0.2.0 form (N inside the
 * brackets, where it gated). Rejects a string whose stated level its axes don't support under the
 * method it was written in.
 */
export function parseProfile(s: string): ParsedProfile {
  const str = s.trim();
  const m = PROFILE_RE.exec(str);
  const legacy = m ? null : LEGACY_PROFILE_RE.exec(str);
  const g = m ?? legacy;
  if (!g) throw new Error(`Not a ZH profile string: ${s}`);
  const n = (i: number) => Number(g[i]) as AxisLevel;
  const axes = { O: n(3), D: n(4), F: n(5), R: n(6), N: n(7) };
  const declared = Number(g[1]) as ZHLevel;
  let level: ZHLevel;
  if (m) {
    level = compositeLevel(axes).level;
  } else {
    level = 0;
    for (const c of [1, 2, 3, 4, 5] as ZHLevel[]) {
      if (AXES.every((a) => axes[a] >= LEGACY_GATES_0_2_0[c][a])) level = c;
      else break;
    }
  }
  if (declared !== level) throw new Error(`Profile claims ZH${declared} but its axes compute to ZH${level}`);
  return {
    level,
    integrity: g[2] as IntegrityGrade,
    axes,
    scope: Number(g[8]) as ScopeClass,
    assurance: g[9] as Assurance | undefined,
    method: m ? METHOD_VERSION : "zhc-score/0.2.0",
  };
}
