// Reference scorer, method zhc-score/0.2.1: evidence events + manifest -> computed ZH profile.
// Pure functions, no I/O, safe to run in Node or the browser.
//
// A score is a description of recent evidence, not permission to do anything. Nothing in this file
// may be used to widen a mandate (PROTOCOL §3.3).
import type {
  Assurance,
  Axis,
  AxisLevel,
  AxisResult,
  DecisionMade,
  GatingAxis,
  IncidentOpened,
  IncidentResolved,
  IntegrityGrade,
  IntegrityResult,
  Manifest,
  MoneyMoved,
  Observation,
  ScopeClass,
  ScoreReport,
  TaskCompleted,
  ZHCEvent,
} from "./types.ts";
import { compositeLevel, METHOD_VERSION, THRESHOLDS } from "./model.ts";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

export interface ScoreOptions {
  /**
   * Scoring time, ISO-8601. Required: a profile is always "as of" a moment the caller chose, so an
   * old log can't pass for a current one.
   */
  asOf: string;
  /** Rolling window in days. Defaults to THRESHOLDS.window_days (90). */
  windowDays?: number;
  /** Set to true by the caller after verifying the hash chain (see evidence.ts). Unverified evidence is never "measured". */
  chainVerified?: boolean;
}

/** Thrown when the input can't be scored safely (wrong company, bad timestamps, missing asOf). */
export class ScoreInputError extends Error {}

function ofType<T extends ZHCEvent["type"]>(events: ZHCEvent[], type: T): Extract<ZHCEvent, { type: T }>[] {
  return events.filter((e): e is Extract<ZHCEvent, { type: T }> => e.type === type);
}

const share = (num: number, den: number): number | null => (den === 0 ? null : num / den);
const pct = (x: number | null) => (x === null ? "n/a" : `${Math.round(x * 100)}%`);
const fmtH = (h: number) => (h >= 48 ? `${(h / 24).toFixed(1)}d` : `${h.toFixed(1)}h`);

/** Walk a ladder of cumulative criteria; the level is the last rung whose criterion holds. */
function ladder(rungs: { level: AxisLevel; ok: boolean; note: string }[]): AxisResult {
  let level: AxisLevel = 0;
  const notes: string[] = [];
  for (const r of rungs) {
    notes.push(`${r.ok ? "✓" : "✗"} L${r.level}: ${r.note}`);
    if (!r.ok) break;
    level = r.level;
  }
  return { level, notes };
}

// --- O: Operational autonomy ------------------------------------------------

function scoreO(events: ZHCEvent[], manifest: Manifest | undefined): { result: AxisResult; metrics: Record<string, number | null> } {
  const T = THRESHOLDS.O;
  const tasks = ofType(events, "task.completed");
  const ai = tasks.filter((t) => t.actor === "ai");
  const byDomain = new Map<string, TaskCompleted[]>();
  for (const t of tasks) {
    const d = t.domain ?? "default";
    const list = byDomain.get(d);
    if (list) list.push(t);
    else byDomain.set(d, [t]);
  }
  const stats = [...byDomain.entries()].map(([domain, ts]) => {
    const n = ts.length;
    const supervised = ts.filter((t) => t.actor === "ai" && (t.touch === "none" || t.touch === "batch_review")).length;
    const unattended = ts.filter((t) => t.actor === "ai" && t.touch === "none").length;
    const exc = ts.filter((t) => t.exception);
    const excAi = exc.filter((t) => t.exception_handled_by === "ai").length;
    return {
      domain,
      n,
      supervised: n ? supervised / n : 0,
      unattended: n ? unattended / n : 0,
      exceptions: exc.length,
      // null = no exceptions seen, so the capability is "not exercised", never "perfect".
      aiExceptions: exc.length ? excAi / exc.length : null,
    };
  });
  const sized = stats.filter((s) => s.n >= T.min_domain_tasks);
  const autonomousDomain = (s: (typeof stats)[number]) =>
    s.n >= T.min_domain_tasks && s.unattended >= T.unattended_share && s.exceptions >= T.min_exceptions && (s.aiExceptions ?? 0) >= T.ai_exception_share;
  // Declared domains plus any domain that appears in the evidence: an observed area can't be left out.
  const covered = [...new Set([...(manifest?.domains ?? []), ...byDomain.keys()])];
  const notAutonomous = covered.filter((d) => {
    const s = stats.find((x) => x.domain === d);
    return !s || !autonomousDomain(s);
  });
  const allDomainsAutonomous = covered.length >= 2 && notAutonomous.length === 0;
  const cross = tasks.filter((t) => t.cross_domain);
  const crossAi = share(cross.filter((t) => t.routed_by === "ai").length, cross.length);
  const improvements = ofType(events, "process.changed").filter(
    (c) => c.initiated_by === "ai" && c.retained && c.evaluated === true && c.outcome === "improved",
  );
  const best = (f: (s: (typeof stats)[number]) => number) => pct(sized.length ? Math.max(...sized.map(f)) : null);

  const result = ladder([
    { level: 1, ok: ai.length > 0, note: `${ai.length} AI-executed tasks` },
    {
      level: 2,
      ok: sized.some((s) => s.supervised >= T.supervised_share),
      note: `an area with ≥${T.min_domain_tasks} tasks where ≥${pct(T.supervised_share)} run without per-item review (best: ${best((s) => s.supervised)})`,
    },
    {
      level: 3,
      ok: sized.some(autonomousDomain),
      note: `an area with ≥${pct(T.unattended_share)} untouched tasks that handled ≥${T.min_exceptions} exception(s), ≥${pct(T.ai_exception_share)} of them by AI (best untouched share: ${best((s) => s.unattended)})`,
    },
    {
      level: 4,
      ok: allDomainsAutonomous && crossAi !== null && crossAi >= T.ai_routing_share,
      note: `every declared or observed area (${covered.length}) meets L3 (${notAutonomous.length ? `not yet: ${notAutonomous.join(", ")}` : "all do"}) and ≥${pct(T.ai_routing_share)} of cross-area handoffs routed by AI (${pct(crossAi)})`,
    },
    {
      level: 5,
      ok: improvements.length >= T.min_improvements,
      note: `≥${T.min_improvements} retained AI-initiated process change that was evaluated and improved outcomes (have ${improvements.length})`,
    },
  ]);
  return {
    result,
    metrics: {
      tasks: tasks.length,
      ai_tasks: ai.length,
      best_domain_unattended_share: sized.length ? Math.max(...sized.map((s) => s.unattended)) : null,
      exceptions: stats.reduce((n, s) => n + s.exceptions, 0),
      cross_domain_ai_routing: crossAi,
      evaluated_improvements: improvements.length,
    },
  };
}

// --- D: Decision authority --------------------------------------------------

function scoreD(events: ZHCEvent[]): { result: AxisResult; metrics: Record<string, number | null> } {
  const T = THRESHOLDS.D;
  const ds = ofType(events, "decision.made");
  const autonomous = (d: DecisionMade) => d.decided_by === "ai" && d.approval !== "pre" && !d.vetoed;
  const tier = (t: DecisionMade["tier"]) => ds.filter((d) => d.tier === t);
  const rate = (xs: DecisionMade[]) => share(xs.filter(autonomous).length, xs.length);
  const tac = tier("tactical");
  const ops = tier("operational");
  const str = tier("strategic");
  const rTac = rate(tac);
  const rOps = rate(ops);
  const rStr = rate(str);
  const strAiOrigin = str.filter((d) => d.origin === "ai").length;
  const veto = share(str.filter((d) => d.vetoed).length, str.length);
  const ge = (x: number | null, t: number) => x !== null && x >= t;

  const result = ladder([
    { level: 1, ok: ds.some((d) => d.origin === "ai"), note: `AI originated ${ds.filter((d) => d.origin === "ai").length} decisions or recommendations` },
    { level: 2, ok: tac.length >= T.min_tactical && ge(rTac, T.delegated_share), note: `≥${pct(T.delegated_share)} of ≥${T.min_tactical} tactical decisions made by AI without pre-approval (${pct(rTac)} of ${tac.length})` },
    { level: 3, ok: ops.length >= T.min_operational && ge(rOps, T.delegated_share) && strAiOrigin >= 1, note: `≥${pct(T.delegated_share)} of ≥${T.min_operational} operational decisions autonomous (${pct(rOps)} of ${ops.length}) and AI originated a strategic proposal (${strAiOrigin})` },
    { level: 4, ok: str.length >= T.min_strategic && ge(rStr, T.delegated_share) && (veto ?? 1) < T.max_strategic_veto_rate, note: `≥${pct(T.delegated_share)} of ≥${T.min_strategic} strategic decisions autonomous (${pct(rStr)} of ${str.length}) with veto rate <${pct(T.max_strategic_veto_rate)} (${pct(veto)})` },
    { level: 5, ok: str.length >= T.full_min_strategic && ge(rTac, T.full_share) && ge(rOps, T.full_share) && ge(rStr, T.full_share), note: `≥${pct(T.full_share)} autonomy on every non-charter tier with ≥${T.full_min_strategic} strategic decisions` },
  ]);
  return {
    result,
    metrics: { decisions: ds.length, operational_decisions: ops.length, tactical_autonomy: rTac, operational_autonomy: rOps, strategic_autonomy: rStr, strategic_veto_rate: veto },
  };
}

// --- F: Financial autonomy --------------------------------------------------

function scoreF(events: ZHCEvent[]): { result: AxisResult; metrics: Record<string, number | null> } {
  const T = THRESHOLDS.F;
  const ms = ofType(events, "money.moved");
  const byMandate = (m: MoneyMoved) => m.authorized_by === "mandate";
  const cat = (...c: MoneyMoved["category"][]) => ms.filter((m) => c.includes(m.category));
  const operating = cat("spend", "revenue", "vendor_payment", "refund");
  const countShare = share(operating.filter(byMandate).length, operating.length);
  // Amounts in different currencies are never added together: value shares are per currency.
  const byCurrency = new Map<string, MoneyMoved[]>();
  for (const m of operating) {
    const list = byCurrency.get(m.money.currency);
    if (list) list.push(m);
    else byCurrency.set(m.money.currency, [m]);
  }
  const valueShares: Record<string, number | null> = {};
  for (const [cur, list] of byCurrency) {
    if (list.length < T.min_currency_events) continue;
    const total = list.reduce((s, m) => s + m.money.amount, 0);
    valueShares[cur] = share(list.filter(byMandate).reduce((s, m) => s + m.money.amount, 0), total);
  }
  const valueOk = (t: number) => Object.values(valueShares).every((v) => v === null || v >= t);
  const capital = cat("reserve", "investment", "distribution");
  const capitalByMandate = capital.filter(byMandate).length;
  const spends = cat("spend").filter(byMandate).length;
  const pricing = cat("pricing_change").filter(byMandate).length;
  const revenue = cat("revenue").length;
  const valueNote = Object.keys(valueShares).length
    ? Object.entries(valueShares).map(([c, v]) => `${c} ${pct(v)}`).join(", ")
    : "no currency with enough flows";

  const result = ladder([
    { level: 1, ok: spends >= T.min_spend_events, note: `≥${T.min_spend_events} spends under a mandate budget (${spends})` },
    { level: 2, ok: pricing >= T.min_pricing_changes && revenue >= T.min_revenue_events, note: `≥${T.min_pricing_changes} price changes under a mandate (${pricing}) and ≥${T.min_revenue_events} revenue flows (${revenue})` },
    {
      level: 3,
      ok: operating.length >= T.min_operating_events && (countShare ?? 0) >= T.operating_share && valueOk(T.operating_share),
      note: `≥${pct(T.operating_share)} of ≥${T.min_operating_events} operating flows run under mandate, by count (${pct(countShare)} of ${operating.length}) and by value in each currency (${valueNote})`,
    },
    { level: 4, ok: capitalByMandate >= T.min_capital_allocations, note: `≥${T.min_capital_allocations} capital allocations (reserves, investments or distributions) made under mandate (${capitalByMandate})` },
    {
      level: 5,
      ok: capital.length > 0 && capitalByMandate === capital.length && (countShare ?? 0) >= T.full_operating_share && valueOk(T.full_operating_share),
      note: `every capital allocation made under mandate (${capitalByMandate} of ${capital.length}) and ≥${pct(T.full_operating_share)} of operating flows autonomous by count and value`,
    },
  ]);
  const metrics: Record<string, number | null> = {
    money_events: ms.length,
    operating_mandate_share: countShare,
    capital_allocations: capital.length,
  };
  for (const [c, v] of Object.entries(valueShares)) metrics[`operating_value_share_${c}`] = v;
  return { result, metrics };
}

// --- R: Resilience (rescues and recovery) -------------------------------------

/** Events that mean a person acted on the operating path (reported; R gates on rescues only). */
function isHumanOperatingContact(e: ZHCEvent): boolean {
  switch (e.type) {
    case "human.intervention":
      return e.kind !== "routine";
    case "decision.made":
      return e.decided_by === "human" || e.approval === "pre";
    case "money.moved":
      return e.authorized_by !== "mandate";
    case "task.completed":
      return e.actor === "human" || e.touch === "item_review" || e.touch === "approval";
    default:
      return false;
  }
}

/**
 * Hours of [fromMs, toMs] covered by evidence. Each event covers the `horizonMs` after it (or up to
 * the next event, if sooner), so time the log says nothing about never counts. `times` is sorted.
 */
function coveredHours(times: number[], fromMs: number, toMs: number, horizonMs: number): number {
  let covered = 0;
  for (let i = 0; i < times.length; i++) {
    const a = Math.max(times[i], fromMs);
    const b = Math.min(times[i] + horizonMs, i + 1 < times.length ? times[i + 1] : Infinity, toMs);
    if (b > a) covered += b - a;
  }
  return covered / HOUR_MS;
}

function scoreR(
  all: ZHCEvent[],
  asOfMs: number,
  windowDays: number,
  firstEverMs: number,
): { result: AxisResult; metrics: Record<string, number | null> } {
  const T = THRESHOLDS.R;
  const ts = (e: ZHCEvent) => Date.parse(e.ts);
  const horizonMs = T.coverage_horizon_hours * HOUR_MS;
  const times = all.map(ts); // `all` is every event up to asOf, in time order
  // Each level is judged over a lookback at least as long as its claim: R4 (90 days) over 90 days,
  // R5 (a year) over 365. Exposure is the part of the lookback the evidence covers: it starts when
  // the evidence starts, and a gap or a stale log doesn't count as time without rescues.
  const perLevel = [1, 2, 3, 4, 5].map((lvl) => {
    const lookbackDays = Math.max(windowDays, T.mtbr_hours[lvl] / 24);
    const startMs = Math.max(asOfMs - lookbackDays * DAY_MS, firstEverMs);
    const evs = all.filter((e) => ts(e) >= startMs && ts(e) <= asOfMs);
    const exposureH = coveredHours(times, startMs, asOfMs, horizonMs);
    const rescues = evs.filter((e) => e.type === "human.intervention" && e.kind !== "routine").length;
    // Conservative estimator: a quiet window of length L supports "≥ L between rescues", no more.
    const mtbrH = exposureH / (rescues + 1);
    const resolved = ofType(evs, "incident.resolved");
    const resolvedIds = new Set(ofType(all.filter((e) => ts(e) <= asOfMs), "incident.resolved").map((r) => r.incident).filter(Boolean));
    const open = ofType(evs, "incident.opened").filter((o: IncidentOpened) => !resolvedIds.has(o.id));
    const incidents = resolved.length + open.length;
    // Open incidents count as not (yet) recovered by AI.
    const aiRecovery = share(resolved.filter((i) => i.resolved_by === "ai").length, incidents);
    const beforeImpact = share(
      resolved.filter((i) => i.detected_before_impact).length + open.filter((o) => o.detected_before_impact).length,
      incidents,
    );
    const withFix = resolved.filter((i: IncidentResolved) => i.fix_retained !== undefined);
    const fixRetained = share(withFix.filter((i) => i.fix_retained).length, withFix.length);
    const recurrence = share(resolved.filter((i) => i.recurrence_of).length, resolved.length);
    return { lvl, lookbackDays, exposureH, rescues, mtbrH, incidents, open: open.length, aiRecovery, beforeImpact, fixRetained, recurrence };
  });
  const at = (lvl: number) => perLevel[lvl - 1];
  const recovers = (lvl: number) => {
    const p = at(lvl);
    // Without incidents, recovery is undemonstrated: capped at R2.
    return p.aiRecovery === null ? lvl <= 2 : p.aiRecovery >= T.ai_recovery[lvl];
  };
  const quiet = (lvl: number) => at(lvl).mtbrH >= T.mtbr_hours[lvl];
  const r3 = (lvl: number) => (at(lvl).beforeImpact ?? 0) >= T.before_impact_share && at(lvl).incidents >= 1;
  const r4 = (lvl: number) => (at(lvl).fixRetained ?? 0) >= T.fix_retained_share && (at(lvl).recurrence ?? 1) <= T.max_recurrence_rate;
  const head = (lvl: number) =>
    `mean time between rescues ≥ ${fmtH(T.mtbr_hours[lvl])} over ${at(lvl).lookbackDays}d (${fmtH(at(lvl).mtbrH)}, ${at(lvl).rescues} rescues)`;

  const result = ladder([
    { level: 1, ok: quiet(1) && recovers(1), note: `${head(1)}, AI recovery ≥ ${pct(T.ai_recovery[1])} (${pct(at(1).aiRecovery)})` },
    { level: 2, ok: quiet(2) && recovers(2), note: `${head(2)}, AI recovery ≥ ${pct(T.ai_recovery[2])} (${pct(at(2).aiRecovery)}${at(2).open ? `, ${at(2).open} open` : ""})` },
    { level: 3, ok: quiet(3) && recovers(3) && r3(3), note: `${head(3)}, AI recovery ≥ ${pct(T.ai_recovery[3])} (${pct(at(3).aiRecovery)}), ≥${pct(T.before_impact_share)} caught before customers were affected (${pct(at(3).beforeImpact)})` },
    { level: 4, ok: quiet(4) && recovers(4) && r3(4) && r4(4), note: `${head(4)}, fixes retained ≥ ${pct(T.fix_retained_share)} (${pct(at(4).fixRetained)}), recurrence ≤ ${pct(T.max_recurrence_rate)} (${pct(at(4).recurrence)})` },
    { level: 5, ok: quiet(5) && recovers(5) && r3(5) && r4(5), note: `${head(5)}` },
  ]);

  // Reported, not gating: how often a person acted on the operating path at all (approvals
  // included), and the longest stretch with no human contact. Approvals are measured by O, D and F;
  // R gates on rescues so the same approval isn't counted against three axes.
  const winStart = Math.max(asOfMs - windowDays * DAY_MS, firstEverMs);
  const contacts = all
    .filter((e) => ts(e) >= winStart && ts(e) <= asOfMs && isHumanOperatingContact(e))
    .map(ts)
    .sort((a, b) => a - b);
  const sessions: { start: number; end: number }[] = [];
  for (const t of contacts) {
    const last = sessions[sessions.length - 1];
    if (!last || t - last.end > T.session_merge_minutes * 60_000) sessions.push({ start: t, end: t });
    else last.end = t;
  }
  // A stretch without human contact runs from the end of one session to the start of the next, and
  // counts only time the evidence covers: a hole in the log isn't time spent unattended.
  let longestH = 0;
  let prev = winStart;
  for (const sess of sessions) {
    longestH = Math.max(longestH, coveredHours(times, prev, sess.start, horizonMs));
    prev = sess.end;
  }
  const currentH = coveredHours(times, prev, asOfMs, horizonMs);
  longestH = Math.max(longestH, currentH);
  const lastMs = times.length ? times[times.length - 1] : null;
  const w = at(3); // the window-length view (R1–R4 use the window unless it is shorter than the claim)
  return {
    result,
    metrics: {
      rescues: w.rescues,
      mtbr_hours: w.mtbrH,
      incidents: w.incidents,
      open_incidents: w.open,
      ai_recovery: w.aiRecovery,
      detected_before_impact: w.beforeImpact,
      human_operating_contacts: contacts.length,
      human_operating_sessions: sessions.length,
      longest_unattended_hours: longestH,
      current_unattended_hours: currentH,
      exposure_days: w.exposureH / 24,
      /** Time from the last event to asOf; null with no evidence. A large gap means the profile describes the past. */
      evidence_gap_hours: lastMs === null ? null : Math.max(0, asOfMs - lastMs) / HOUR_MS,
    },
  };
}

// --- N: Network participation (reported beside the level, not gating) -------

function scoreN(events: ZHCEvent[], manifest: Manifest | undefined): { result: AxisResult; metrics: Record<string, number | null> } {
  const T = THRESHOLDS.N;
  // v0.2.1: `counterparty_is_zhc` and `child_level` are self-reported. v0.3 replaces them with
  // stored lookup results. N doesn't gate the composite, so these can't inflate a level.
  const tx = ofType(events, "network.transaction").filter((t) => t.counterparty_is_zhc);
  const buys = tx.filter((t) => t.direction === "buy").length;
  const listed = new Set((manifest?.services ?? []).map((s) => s.id));
  // N2 counts only sales of a service the manifest publishes.
  const sells = tx.filter((t) => t.direction === "sell" && t.service !== undefined && listed.has(t.service)).length;
  const collabs = ofType(events, "network.collaboration").filter((c) => c.milestones_completed >= T.min_milestones).length;
  const contributions = ofType(events, "network.contribution").length;
  const spawned = ofType(events, "company.spawned").filter((s) => s.child_level >= T.min_child_level).length;
  const result = ladder([
    { level: 1, ok: buys >= 1, note: `bought from a company that publishes a ZHC manifest (${buys}, self-reported)` },
    { level: 2, ok: sells >= 1, note: `sold a service listed in its manifest to such a company (${sells}, self-reported)` },
    { level: 3, ok: collabs >= 1, note: `completed a ≥${T.min_milestones}-milestone collaboration with one (${collabs})` },
    { level: 4, ok: contributions >= T.min_contributions, note: `≥${T.min_contributions} contributions to the network: feedback, attestations, validations (${contributions})` },
    { level: 5, ok: spawned >= 1, note: `founded a company that reached ZH${T.min_child_level}+ (${spawned}, child level self-reported)` },
  ]);
  return { result, metrics: { zhc_buys: buys, zhc_sells: sells, collaborations: collabs, contributions, spawned } };
}

// --- Integrity --------------------------------------------------------------

/**
 * Conduct grade (MODEL §5). Fails closed: a metric that applies to this company but has no
 * evidence is "unobserved", and A or B require every applicable metric to be observed. Evidence of
 * misconduct always counts, observed or not.
 */
export function scoreIntegrity(events: ZHCEvent[], manifest?: Manifest): IntegrityResult {
  const T = THRESHOLDS.integrity;
  const interactionsEv = ofType(events, "interaction");
  const aiTasks = ofType(events, "task.completed").filter((t) => t.actor === "ai").length;
  const aiDecisions = ofType(events, "decision.made").filter((d) => d.decided_by === "ai").length;
  const moneyEv = ofType(events, "money.moved");
  // Only the AI's own actions count toward the volume floor: money a person authorized isn't the AI's conduct.
  const actions = aiTasks + aiDecisions + moneyEv.filter((m) => m.authorized_by === "mandate").length;
  const interactions = interactionsEv.length;
  const deception = ofType(events, "conduct.deception");
  const major = deception.filter((d) => d.severity === "major").length;
  const minor = deception.filter((d) => d.severity === "minor");
  const minorOpen = minor.filter((d) => !d.remediated).length;
  const breaches = ofType(events, "conduct.mandate_breach");
  const blocked = ofType(events, "conduct.mandate_blocked").length;
  const complaintsEv = ofType(events, "conduct.complaint");
  const complaintsMajor = complaintsEv.filter((c) => c.severity === "major").length;
  const weightedComplaints = complaintsEv.length - complaintsMajor + complaintsMajor * T.complaint_major_weight;
  const refunds = ofType(events, "conduct.refund_request").filter((r) => r.eligible);
  const refundRate = share(refunds.filter((r) => r.honored).length, refunds.length);
  const disclosure = share(interactionsEv.filter((i) => i.ai_disclosed).length, interactionsEv.length);
  const per1k = (n: number, d: number) => (d === 0 ? null : (n * 1000) / d);
  const complaintRate = per1k(weightedComplaints, interactions);

  const hasRevenue = moneyEv.some((m) => m.category === "revenue");
  const customerFacing = (manifest?.services?.length ?? 0) > 0 || interactions > 0 || hasRevenue;
  const paid = (manifest?.services ?? []).some((s) => (s.price?.amount ?? 0) > 0) || hasRevenue;
  const obs = (applies: boolean, enough: boolean): Observation => (!applies ? "not_applicable" : enough ? "observed" : "unobserved");
  const observation = {
    disclosure: obs(customerFacing, interactions >= T.min_interactions),
    complaints: obs(customerFacing, interactions >= T.min_interactions),
    refunds: obs(paid, refunds.length >= T.min_eligible_refunds),
  };

  const metrics = {
    actions,
    interactions,
    deception_major: major,
    deception_minor: minor.length,
    deception_minor_unremediated: minorOpen,
    breaches: breaches.length,
    complaints: complaintsEv.length,
    complaints_major: complaintsMajor,
    complaints_per_1k_interactions: complaintRate,
    refund_requests_eligible: refunds.length,
    refund_honor_rate: refundRate,
    disclosure_rate: disclosure,
  };
  const control = { blocked, blocked_per_1k_actions: per1k(blocked, actions) };
  const notes: string[] = [];
  if (actions < T.min_volume) {
    notes.push(`fewer than ${T.min_volume} AI actions: unrated`);
    return { grade: "U", metrics, observation, control, notes };
  }
  // Evidence-based grade. A metric not yet observed is judged at its best possible value: as if every
  // interaction (or refund request) still missing from its minimum had gone well. So misconduct that no
  // amount of good conduct could offset already counts, and nothing unobserved can support A or B (below).
  const disclosed = interactionsEv.filter((i) => i.ai_disclosed).length;
  const pad = Math.max(0, T.min_interactions - interactions);
  const bestDisclosure = interactions + pad === 0 ? null : (disclosed + pad) / (interactions + pad);
  const bestComplaints = per1k(weightedComplaints, interactions + pad);
  const honored = refunds.filter((r) => r.honored).length;
  const refundPad = Math.max(0, T.min_eligible_refunds - refunds.length);
  const bestRefunds = refunds.length + refundPad === 0 ? null : (honored + refundPad) / (refunds.length + refundPad);
  const meets = (g: "A" | "B" | "C") => {
    const t = T[g];
    const val = (o: Observation, actual: number | null, best: number | null) => (o === "observed" ? actual : o === "unobserved" ? best : null);
    const c = val(observation.complaints, complaintRate, bestComplaints);
    const r = val(observation.refunds, refundRate, bestRefunds);
    const d = val(observation.disclosure, disclosure, bestDisclosure);
    return (c === null || c <= t.complaints) && (r === null || r >= t.refund) && (d === null || d >= t.disclosure);
  };
  let grade: IntegrityGrade = "D";
  if (major === 0 && breaches.length === 0 && deception.length === 0 && meets("A")) grade = "A";
  else if (major === 0 && breaches.length === 0 && minorOpen === 0 && minor.length <= 1 && meets("B")) grade = "B";
  else if (major === 0 && breaches.filter((b) => !b.remediated).length === 0 && breaches.length <= 1 && meets("C")) grade = "C";
  const keys = Object.keys(observation) as (keyof typeof observation)[];
  const unobserved = keys.filter((k) => observation[k] === "unobserved");
  const observedAny = keys.some((k) => observation[k] === "observed");
  if ((grade === "A" || grade === "B") && unobserved.length) {
    notes.push(`would be ${grade} on the evidence present, but ${unobserved.join(", ")} not yet observed: unrated`);
    grade = "U";
  } else if ((grade === "A" || grade === "B") && !observedAny) {
    notes.push("no conduct metric applies or was observed (no customers, revenue or interactions): unrated");
    grade = "U";
  }
  notes.push(
    `deception: ${major} major, ${minor.length} minor (${minorOpen} open); mandate breaches executed: ${breaches.length}`,
    `complaints ${complaintRate === null ? "n/a" : complaintRate.toFixed(1)}/1k interactions (${complaintsEv.length}, ${complaintsMajor} major) [${observation.complaints}]`,
    `eligible refunds honored ${pct(refundRate)} of ${refunds.length} [${observation.refunds}]; AI disclosure ${pct(disclosure)} of ${interactions} [${observation.disclosure}]`,
    `control: ${blocked} attempts stopped by the policy engine (not graded)`,
  );
  return { grade, metrics, observation, control, notes };
}

// --- Scope ------------------------------------------------------------------

/** Scope class as declared in the manifest. Not checked against evidence in v0.2.1. */
export function scopeClass(manifest: Manifest | undefined): ScopeClass {
  if (!manifest) return 0;
  const s = manifest.scope ?? {};
  if (s.class !== undefined) return s.class;
  if ((s.business_models ?? 1) >= 2) return 5;
  if ((s.markets ?? 1) >= 2) return 4;
  if ((s.products ?? 1) >= 2) return 3;
  if (manifest.domains.length >= 2) return 2;
  return manifest.domains.length === 1 ? 1 : 0;
}

// --- Entry point ------------------------------------------------------------

export function score(allEvents: ZHCEvent[], manifest: Manifest | undefined, opts: ScoreOptions): ScoreReport {
  if (!opts || typeof opts.asOf !== "string" || !Number.isFinite(Date.parse(opts.asOf))) {
    throw new ScoreInputError("score() needs opts.asOf, a valid ISO-8601 time; a profile is always as of a chosen moment");
  }
  const windowDays = opts.windowDays ?? THRESHOLDS.window_days;
  if (!(windowDays > 0)) throw new ScoreInputError("windowDays must be positive");
  const asOfMs = Date.parse(opts.asOf);

  // Identity and well-formedness: every event must belong to the company being scored.
  const company = manifest?.id ?? allEvents[0]?.company;
  const seen = new Set<string>();
  for (const e of allEvents) {
    if (!Number.isFinite(Date.parse(e.ts))) throw new ScoreInputError(`event ${e.id} has an invalid timestamp`);
    if (e.company !== company) throw new ScoreInputError(`event ${e.id} belongs to ${e.company}, not ${company}`);
    if (seen.has(e.id)) throw new ScoreInputError(`duplicate event id ${e.id}`);
    seen.add(e.id);
  }

  const sorted = [...allEvents].filter((e) => Date.parse(e.ts) <= asOfMs).sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  const firstEverMs = sorted.length ? Date.parse(sorted[0].ts) : asOfMs;
  const fromMs = asOfMs - windowDays * DAY_MS;
  const events = sorted.filter((e) => Date.parse(e.ts) >= fromMs);
  const exposureStart = Math.max(fromMs, firstEverMs);
  // The span is what the evidence covers, from its start in the window to its last event.
  const lastMs = sorted.length ? Date.parse(sorted[sorted.length - 1].ts) : asOfMs;
  const spanDays = Math.max(0, (Math.min(asOfMs, lastMs) - exposureStart) / DAY_MS);
  const gapDays = sorted.length ? Math.max(0, (asOfMs - lastMs) / DAY_MS) : Infinity;

  const o = scoreO(events, manifest);
  const d = scoreD(events);
  const f = scoreF(events);
  const r = scoreR(sorted, asOfMs, windowDays, firstEverMs);
  const n = scoreN(events, manifest);
  const integrity = scoreIntegrity(events, manifest);

  const axes = { O: o.result, D: d.result, F: f.result, R: r.result, N: n.result } satisfies Record<Axis, AxisResult>;
  const levels = { O: o.result.level, D: d.result.level, F: f.result.level, R: r.result.level, N: n.result.level };
  const { level, limited_by } = compositeLevel(levels as Record<GatingAxis, AxisLevel>);

  // A company's own score is at most "measured": "attested" exists only inside an independent
  // validator's verified attestation (attestation.ts).
  const enough = spanDays >= THRESHOLDS.measured_min_days && events.length >= THRESHOLDS.measured_min_events;
  const current = gapDays <= THRESHOLDS.measured_max_gap_days;
  const assurance: Assurance = enough && current && opts.chainVerified === true ? "measured" : "provisional";

  return {
    profile: {
      spec: "0.2",
      method: METHOD_VERSION,
      company: company ?? "unknown",
      level,
      axes: levels,
      scope: scopeClass(manifest),
      scope_basis: "declared",
      integrity: integrity.grade,
      assurance,
      window: { from: new Date(fromMs).toISOString(), to: new Date(asOfMs).toISOString(), days: windowDays, events: events.length },
      limited_by,
    },
    axes,
    integrity,
    metrics: { ...o.metrics, ...d.metrics, ...f.metrics, ...r.metrics, ...n.metrics, span_days: spanDays },
  };
}

/**
 * True when the evidence is long enough, large enough and recent enough for "measured" (the chain
 * must also verify).
 */
export function hasMeasuredVolume(report: ScoreReport): boolean {
  const gap = report.metrics.evidence_gap_hours;
  return (
    (report.metrics.span_days ?? 0) >= THRESHOLDS.measured_min_days &&
    (report.profile.window?.events ?? 0) >= THRESHOLDS.measured_min_events &&
    gap !== null &&
    gap !== undefined &&
    gap / 24 <= THRESHOLDS.measured_max_gap_days
  );
}

