// Reference scorer: evidence events + manifest -> computed ZH profile.
// Pure functions, no I/O, safe to run in Node or the browser.
import type {
  Assurance,
  Axis,
  AxisLevel,
  AxisResult,
  DecisionMade,
  IncidentResolved,
  IntegrityGrade,
  IntegrityResult,
  Manifest,
  MoneyMoved,
  ScopeClass,
  ScoreReport,
  TaskCompleted,
  ZHCEvent,
} from "./types.ts";
import { compositeLevel, THRESHOLDS } from "./model.ts";

const DAY_MS = 86_400_000;

export interface ScoreOptions {
  /** Scoring time. Defaults to the latest event timestamp. */
  asOf?: string;
  /** Rolling window in days. Defaults to THRESHOLDS.window_days (90). */
  windowDays?: number;
  /** Set by the caller after verifying the hash chain (see evidence.ts). */
  chainVerified?: boolean;
  /** Set when a valid, unexpired attestation covers this window. */
  attested?: boolean;
}

function ofType<T extends ZHCEvent["type"]>(events: ZHCEvent[], type: T): Extract<ZHCEvent, { type: T }>[] {
  return events.filter((e): e is Extract<ZHCEvent, { type: T }> => e.type === type);
}

const share = (num: number, den: number): number | null => (den === 0 ? null : num / den);
const pct = (x: number | null) => (x === null ? "n/a" : `${Math.round(x * 100)}%`);

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

function scoreO(events: ZHCEvent[], manifest: Manifest | undefined, windowDays: number): { result: AxisResult; metrics: Record<string, number | null> } {
  const T = THRESHOLDS.O;
  const tasks = ofType(events, "task.completed");
  const ai = tasks.filter((t) => t.actor === "ai");
  const byDomain = new Map<string, TaskCompleted[]>();
  for (const t of tasks) {
    const d = t.domain ?? "default";
    byDomain.set(d, [...(byDomain.get(d) ?? []), t]);
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
      aiExceptions: exc.length ? excAi / exc.length : 1,
    };
  });
  const sized = stats.filter((s) => s.n >= T.min_domain_tasks);
  const declared = manifest?.domains?.length ? manifest.domains : [...byDomain.keys()];
  const autonomousDomain = (s: (typeof stats)[number]) => s.unattended >= T.unattended_share && s.aiExceptions >= T.ai_exception_share;
  const allDomainsAutonomous =
    declared.length >= 2 &&
    declared.every((d) => {
      const s = stats.find((x) => x.domain === d);
      return !!s && s.n >= T.min_domain_tasks && autonomousDomain(s);
    });
  const cross = tasks.filter((t) => t.cross_domain);
  const crossAi = share(cross.filter((t) => t.routed_by === "ai").length, cross.length);
  const changes = ofType(events, "process.changed").filter((c) => c.initiated_by === "ai" && c.retained);
  const neededChanges = Math.max(1, Math.ceil(windowDays / 30) * T.retained_changes_per_30d);
  const roleChanges = changes.filter((c) => c.change === "role_created" || c.change === "role_retired").length;

  const result = ladder([
    { level: 1, ok: ai.length > 0, note: `${ai.length} AI-executed tasks` },
    {
      level: 2,
      ok: sized.some((s) => s.supervised >= T.supervised_share),
      note: `a domain with ≥${T.min_domain_tasks} tasks where ≥${pct(T.supervised_share)} run without per-item review (best: ${pct(Math.max(0, ...sized.map((s) => s.supervised)))})`,
    },
    {
      level: 3,
      ok: sized.some(autonomousDomain),
      note: `a domain with ≥${pct(T.unattended_share)} untouched tasks and ≥${pct(T.ai_exception_share)} of exceptions handled by AI (best: ${pct(Math.max(0, ...sized.map((s) => s.unattended)))})`,
    },
    {
      level: 4,
      ok: allDomainsAutonomous && crossAi !== null && crossAi >= T.ai_routing_share,
      note: `all ${declared.length} declared domains autonomous and ≥${pct(T.ai_routing_share)} of cross-domain handoffs routed by AI (routing: ${pct(crossAi)})`,
    },
    {
      level: 5,
      ok: changes.length >= neededChanges && roleChanges >= 1,
      note: `≥${neededChanges} retained AI-initiated process changes incl. a role created/retired (have ${changes.length}, roles ${roleChanges})`,
    },
  ]);
  return {
    result,
    metrics: {
      tasks: tasks.length,
      ai_tasks: ai.length,
      best_domain_unattended_share: sized.length ? Math.max(...sized.map((s) => s.unattended)) : null,
      cross_domain_ai_routing: crossAi,
      retained_ai_process_changes: changes.length,
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
    { level: 1, ok: ds.some((d) => d.origin === "ai"), note: `AI originated ${ds.filter((d) => d.origin === "ai").length} decisions/recommendations` },
    { level: 2, ok: tac.length >= T.min_tactical && ge(rTac, T.delegated_share), note: `≥${pct(T.delegated_share)} of ≥${T.min_tactical} tactical decisions made by AI without pre-approval (${pct(rTac)} of ${tac.length})` },
    { level: 3, ok: ge(rOps, T.delegated_share) && strAiOrigin >= 1, note: `≥${pct(T.delegated_share)} operational decisions autonomous (${pct(rOps)}) and AI originated a strategic proposal (${strAiOrigin})` },
    { level: 4, ok: str.length >= T.min_strategic && ge(rStr, T.delegated_share) && (veto ?? 1) < T.max_strategic_veto_rate, note: `≥${pct(T.delegated_share)} of ≥${T.min_strategic} strategic decisions autonomous (${pct(rStr)}) with veto rate <${pct(T.max_strategic_veto_rate)} (${pct(veto)})` },
    { level: 5, ok: str.length >= T.full_min_strategic && ge(rTac, T.full_share) && ge(rOps, T.full_share) && ge(rStr, T.full_share), note: `≥${pct(T.full_share)} autonomy on every non-charter tier with ≥${T.full_min_strategic} strategic decisions` },
  ]);
  return { result, metrics: { decisions: ds.length, tactical_autonomy: rTac, operational_autonomy: rOps, strategic_autonomy: rStr, strategic_veto_rate: veto } };
}

// --- F: Financial autonomy --------------------------------------------------

function scoreF(events: ZHCEvent[]): { result: AxisResult; metrics: Record<string, number | null> } {
  const T = THRESHOLDS.F;
  const ms = ofType(events, "money.moved");
  const byMandate = (m: MoneyMoved) => m.authorized_by === "mandate";
  const cat = (...c: MoneyMoved["category"][]) => ms.filter((m) => c.includes(m.category));
  const operating = cat("spend", "revenue", "vendor_payment", "refund");
  const opCount = share(operating.filter(byMandate).length, operating.length);
  const opValueTotal = operating.reduce((s, m) => s + m.money.amount, 0);
  const opValue = share(operating.filter(byMandate).reduce((s, m) => s + m.money.amount, 0), opValueTotal);
  const opShare = opCount === null || opValue === null ? null : Math.min(opCount, opValue);
  const has = (c: MoneyMoved["category"]) => cat(c).some(byMandate);

  const result = ladder([
    { level: 1, ok: has("spend"), note: `AI spends under a mandate budget` },
    { level: 2, ok: has("pricing_change") && cat("revenue").length > 0, note: `AI changed prices under a mandate and revenue is flowing` },
    { level: 3, ok: operating.length >= T.min_operating_events && (opShare ?? 0) >= T.operating_share, note: `≥${pct(T.operating_share)} of operating flows (by count and value) run under mandate (${pct(opShare)} of ${operating.length})` },
    { level: 4, ok: has("reserve") || has("investment"), note: `AI allocates reserves or investments under mandate` },
    { level: 5, ok: has("distribution") && (opShare ?? 0) >= T.full_operating_share, note: `AI makes distributions under mandate and ≥${pct(T.full_operating_share)} operating flows autonomous` },
  ]);
  return { result, metrics: { money_events: ms.length, operating_mandate_share: opShare } };
}

// --- R: Resilience ----------------------------------------------------------

function scoreR(events: ZHCEvent[], spanDays: number): { result: AxisResult; metrics: Record<string, number | null> } {
  const T = THRESHOLDS.R;
  const interventions = ofType(events, "human.intervention").filter((i) => i.kind !== "routine");
  const incidents = ofType(events, "incident.resolved");
  const mtbhiHours = (spanDays * 24) / (interventions.length + 1);
  const aiRecovery = share(incidents.filter((i) => i.resolved_by === "ai").length, incidents.length);
  const beforeImpact = share(incidents.filter((i) => i.detected_before_impact).length, incidents.length);
  const withFix = incidents.filter((i: IncidentResolved) => i.fix_retained !== undefined);
  const fixRetained = share(withFix.filter((i) => i.fix_retained).length, withFix.length);
  const recurrence = share(incidents.filter((i) => i.recurrence_of).length, incidents.length);
  const recovers = (lvl: number) => aiRecovery === null ? lvl <= 2 : aiRecovery >= T.ai_recovery[lvl];
  const hrs = (lvl: number) => mtbhiHours >= T.mtbhi_hours[lvl];
  const fmtH = (h: number) => (h >= 48 ? `${(h / 24).toFixed(1)}d` : `${h.toFixed(1)}h`);

  const r3 = (beforeImpact ?? 0) >= T.before_impact_share && incidents.length >= 1;
  const r4 = (fixRetained ?? 0) >= T.fix_retained_share && (recurrence ?? 1) <= T.max_recurrence_rate;
  const result = ladder([
    { level: 1, ok: hrs(1) && recovers(1), note: `MTBHI ≥ ${fmtH(T.mtbhi_hours[1])} (${fmtH(mtbhiHours)}), AI recovery ≥ ${pct(T.ai_recovery[1])} (${pct(aiRecovery)})` },
    { level: 2, ok: hrs(2) && recovers(2), note: `MTBHI ≥ ${fmtH(T.mtbhi_hours[2])}, AI recovery ≥ ${pct(T.ai_recovery[2])}` },
    { level: 3, ok: hrs(3) && recovers(3) && r3, note: `MTBHI ≥ ${fmtH(T.mtbhi_hours[3])}, AI recovery ≥ ${pct(T.ai_recovery[3])}, ≥${pct(T.before_impact_share)} detected before impact (${pct(beforeImpact)})` },
    { level: 4, ok: hrs(4) && recovers(4) && r3 && r4, note: `MTBHI ≥ ${fmtH(T.mtbhi_hours[4])}, fixes retained ≥ ${pct(T.fix_retained_share)} (${pct(fixRetained)}), recurrence ≤ ${pct(T.max_recurrence_rate)} (${pct(recurrence)})` },
    { level: 5, ok: hrs(5) && recovers(5) && r3 && r4, note: `MTBHI ≥ ${fmtH(T.mtbhi_hours[5])}` },
  ]);
  return { result, metrics: { interventions: interventions.length, mtbhi_hours: mtbhiHours, incidents: incidents.length, ai_recovery: aiRecovery, detected_before_impact: beforeImpact } };
}

// --- N: Network participation ----------------------------------------------

function scoreN(events: ZHCEvent[], manifest: Manifest | undefined): { result: AxisResult; metrics: Record<string, number | null> } {
  const T = THRESHOLDS.N;
  const tx = ofType(events, "network.transaction").filter((t) => t.counterparty_is_zhc);
  const buys = tx.filter((t) => t.direction === "buy").length;
  const sells = tx.filter((t) => t.direction === "sell").length;
  const collabs = ofType(events, "network.collaboration").filter((c) => c.milestones_completed >= T.min_milestones).length;
  const contributions = ofType(events, "network.contribution").length;
  const spawned = ofType(events, "company.spawned").filter((s) => s.child_level >= T.min_child_level).length;
  const result = ladder([
    { level: 1, ok: buys >= 1, note: `bought from another ZHC (${buys})` },
    { level: 2, ok: sells >= 1 && (manifest?.services?.length ?? 0) > 0, note: `sold a published service to another ZHC (${sells})` },
    { level: 3, ok: collabs >= 1, note: `completed a ≥${T.min_milestones}-milestone collaboration with another ZHC (${collabs})` },
    { level: 4, ok: contributions >= T.min_contributions, note: `≥${T.min_contributions} contributions to the network: feedback, attestations, validations (${contributions})` },
    { level: 5, ok: spawned >= 1, note: `spawned a ZHC that reached ZH${T.min_child_level}+ (${spawned})` },
  ]);
  return { result, metrics: { zhc_buys: buys, zhc_sells: sells, collaborations: collabs, contributions, spawned } };
}

// --- Integrity --------------------------------------------------------------

export function scoreIntegrity(events: ZHCEvent[]): IntegrityResult {
  const T = THRESHOLDS.integrity;
  const interactionsEv = ofType(events, "interaction");
  const aiTasks = ofType(events, "task.completed").filter((t) => t.actor === "ai").length;
  const aiDecisions = ofType(events, "decision.made").filter((d) => d.decided_by === "ai").length;
  const money = ofType(events, "money.moved").length;
  const actions = aiTasks + aiDecisions + money;
  const interactions = interactionsEv.length || aiTasks;
  const deception = ofType(events, "conduct.deception");
  const major = deception.filter((d) => d.severity === "major").length;
  const minor = deception.filter((d) => d.severity === "minor");
  const minorOpen = minor.filter((d) => !d.remediated).length;
  const breaches = ofType(events, "conduct.mandate_breach");
  const blocked = ofType(events, "conduct.mandate_blocked").length;
  const complaints = ofType(events, "conduct.complaint").length;
  const refunds = ofType(events, "conduct.refund_request").filter((r) => r.eligible);
  const refundRate = share(refunds.filter((r) => r.honored).length, refunds.length);
  const disclosure = share(interactionsEv.filter((i) => i.ai_disclosed).length, interactionsEv.length);
  const per1k = (n: number, d: number) => (d === 0 ? 0 : (n * 1000) / d);
  const blockedRate = per1k(blocked, actions);
  const complaintRate = per1k(complaints, interactions);

  const metrics = {
    interactions,
    actions,
    deception_major: major,
    deception_minor: minor.length,
    deception_minor_unremediated: minorOpen,
    breaches: breaches.length,
    blocked_per_1k_actions: blockedRate,
    complaints_per_1k_interactions: complaintRate,
    refund_honor_rate: refundRate,
    disclosure_rate: disclosure,
  };
  const notes: string[] = [];
  if (actions + interactions < T.min_volume) {
    notes.push(`fewer than ${T.min_volume} actions+interactions: unrated`);
    return { grade: "U", metrics, notes };
  }
  const meets = (g: "A" | "B" | "C") => {
    const t = T[g];
    return blockedRate <= t.blocked && complaintRate <= t.complaints && (refundRate ?? 1) >= t.refund && (disclosure ?? 1) >= t.disclosure;
  };
  let grade: IntegrityGrade = "D";
  if (major === 0 && breaches.length === 0 && deception.length === 0 && meets("A")) grade = "A";
  else if (major === 0 && breaches.length === 0 && minorOpen === 0 && minor.length <= 1 && meets("B")) grade = "B";
  else if (major === 0 && breaches.filter((b) => !b.remediated).length === 0 && breaches.length <= 1 && meets("C")) grade = "C";
  notes.push(
    `deception: ${major} major, ${minor.length} minor (${minorOpen} open); mandate breaches executed: ${breaches.length}`,
    `blocked attempts ${blockedRate.toFixed(1)}/1k actions; complaints ${complaintRate.toFixed(1)}/1k interactions`,
    `refunds honored ${pct(refundRate)}; AI disclosure ${pct(disclosure)}`,
  );
  return { grade, metrics, notes };
}

// --- Scope ------------------------------------------------------------------

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

export function score(allEvents: ZHCEvent[], manifest?: Manifest, opts: ScoreOptions = {}): ScoreReport {
  const windowDays = opts.windowDays ?? THRESHOLDS.window_days;
  const sorted = [...allEvents].sort((a, b) => a.ts.localeCompare(b.ts));
  const asOfMs = opts.asOf ? Date.parse(opts.asOf) : sorted.length ? Date.parse(sorted[sorted.length - 1].ts) : Date.now();
  const fromMs = asOfMs - windowDays * DAY_MS;
  const events = sorted.filter((e) => {
    const t = Date.parse(e.ts);
    return t > fromMs && t <= asOfMs;
  });
  const firstMs = events.length ? Date.parse(events[0].ts) : asOfMs;
  const spanDays = Math.max(0, (asOfMs - firstMs) / DAY_MS);

  const o = scoreO(events, manifest, Math.min(windowDays, Math.max(1, spanDays)));
  const d = scoreD(events);
  const f = scoreF(events);
  const r = scoreR(events, spanDays);
  const n = scoreN(events, manifest);
  const integrity = scoreIntegrity(events);

  const axes = { O: o.result, D: d.result, F: f.result, R: r.result, N: n.result } satisfies Record<Axis, AxisResult>;
  const levels = { O: o.result.level, D: d.result.level, F: f.result.level, R: r.result.level, N: n.result.level };
  const { level, limited_by } = compositeLevel(levels);

  const enough = spanDays >= THRESHOLDS.measured_min_days && events.length >= THRESHOLDS.measured_min_events;
  let assurance: Assurance = enough && opts.chainVerified !== false ? "measured" : "provisional";
  if (assurance === "measured" && opts.attested) assurance = "attested";

  return {
    profile: {
      spec: "0.2",
      company: manifest?.id ?? events[0]?.company ?? "unknown",
      level,
      axes: levels,
      scope: scopeClass(manifest),
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
