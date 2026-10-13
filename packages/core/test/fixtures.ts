// Synthetic evidence for tests.
import type { Manifest, ZHCEvent } from "../src/types.ts";

export const COMPANY = "did:web:test.zhc.network";

export const manifest: Manifest = {
  zhc: "0.2",
  id: COMPANY,
  name: "Test Co",
  legal: { entity_name: "Test Co LLC", jurisdiction: "US-WY" },
  accountable_human: { name: "A. Human", contact: "human@example.com" },
  charter: { mission: "Test", reserved_to_human: ["charter changes"], prohibited: [] },
  domains: ["support", "delivery"],
  scope: { products: 1 },
  agents: [{ id: "agent-1", role: "operator", domain: "support" }],
  services: [{ id: "svc", description: "x", endpoint: "https://example.com", protocol: "http" }],
};

let seq = 0;
const START = Date.parse("2026-07-01T00:00:00Z");
const at = (hours: number) => new Date(START + hours * 3_600_000).toISOString();
const base = (hours: number) => ({ v: "0.2" as const, id: `e${++seq}`, ts: at(hours), company: COMPANY });

/** ~60 days of a business-operator-shaped company: expected O3 D2 F2 R2 N1 -> ZH3. */
export function zh3Company(): ZHCEvent[] {
  const ev: ZHCEvent[] = [];
  for (let i = 0; i < 300; i++) {
    const h = i * 4.8; // 300 tasks over 60 days
    // support: fully unattended; delivery: batch reviewed (so O4 fails)
    const support = i % 2 === 0;
    ev.push({ ...base(h), type: "task.completed", domain: support ? "support" : "delivery", actor: "ai", touch: support ? "none" : "batch_review", exception: i % 10 === 0, exception_handled_by: "ai" });
    ev.push({ ...base(h + 0.1), type: "interaction", channel: "email", ai_disclosed: true });
  }
  for (let i = 0; i < 40; i++) ev.push({ ...base(i * 30), type: "decision.made", tier: "tactical", origin: "ai", decided_by: "ai", approval: "none" });
  for (let i = 0; i < 10; i++) ev.push({ ...base(i * 100), type: "decision.made", tier: "operational", origin: "ai", decided_by: "human", approval: "pre" });
  for (let i = 0; i < 30; i++) ev.push({ ...base(i * 40), type: "money.moved", direction: "in", category: "revenue", money: { amount: 4900, currency: "USD" }, authorized_by: i % 3 === 0 ? "human_approval" : "mandate", rail: "stripe" });
  for (let i = 0; i < 10; i++) ev.push({ ...base(i * 120), type: "money.moved", direction: "out", category: "spend", money: { amount: 1200, currency: "USD" }, authorized_by: "mandate" });
  ev.push({ ...base(200), type: "money.moved", direction: "none", category: "pricing_change", money: { amount: 0, currency: "USD" }, authorized_by: "mandate" });
  // 4 interventions over 60 days -> MTBHI = 1440h/5 = 288h (12 days): R2 (>=72h) but not R3 (>=504h)
  for (const h of [100, 500, 900, 1300]) ev.push({ ...base(h), type: "human.intervention", kind: "fix" });
  for (const h of [150, 600, 1000]) ev.push({ ...base(h), type: "incident.resolved", severity: "medium", detected_by: "ai", detected_before_impact: false, resolved_by: "ai", duration_s: 600 });
  ev.push({ ...base(700), type: "network.transaction", counterparty: "did:web:other.zhc", counterparty_is_zhc: true, direction: "buy", money: { amount: 500, currency: "USD" } });
  ev.push({ ...base(1439), type: "decision.made", tier: "tactical", origin: "ai", decided_by: "ai", approval: "none" });
  return ev;
}
