# ZH Maturity Model — v0.2

**Status:** Draft for public comment · **Date:** October 2026 · **Supersedes:** Framework v0.1 (March 2026)
**Reference implementation:** [`packages/core`](../../packages/core) (`model.ts`, `score.ts`). Where this document and the reference implementation disagree, file an issue; the implementation's thresholds are normative for v0.2.

---

## 1. Purpose

The ZH Maturity Model is a shared vocabulary for one question: **how much of this company runs without people, and can it be trusted to?**

v0.1 answered the first half. v0.2 adds the second half and makes both halves *measurable*. A ZH profile is meant to be read by counterparties (customers, other autonomous companies, payment providers, insurers, boards), so every level is defined by evidence a third party could check, not by how a founder feels about their stack.

Three ideas carry the model:

1. **Autonomy is multi-dimensional and gated by the weakest link.** A company is only as autonomous as its most human-dependent axis.
2. **Autonomy and integrity are reported together, never apart.** A ZH level always travels with an integrity grade. A highly autonomous company that deceives people is a hazard, not an achievement.
3. **Claims are cheap; evidence is the product.** Every profile states how it was produced: claimed, measured, or attested.

## 2. Reading a profile

```
ZH3·A [O3 D2 F2 R2 N1] S2 attested
│   │  └─ five autonomy axes ─┘ │   └─ assurance: how this profile was produced
│   └─ integrity grade           └─ scope class (context, not a gate)
└─ composite ZH level
```

Compact machine form: `zh0.2/3/A/O3D2F2R2N1/S2/attested`.

A profile string that states a composite level its axes do not support is invalid (`parseProfile` rejects it).

## 3. The five autonomy axes

Each axis has levels 0–5. Levels are **cumulative**: level *k* requires every criterion of levels 1…*k*. All criteria are evaluated over a rolling **90-day window** of evidence events (see [PROTOCOL.md §4](PROTOCOL.md#4-evidence)).

### O — Operational Autonomy · *Who does the work?*

| Level | Name | Criterion (v0.2 thresholds) |
|---|---|---|
| O0 | Manual | No AI-executed tasks. |
| O1 | Assisted | At least one task executed by AI. Per-item review is fine. |
| O2 | Supervised | In some domain with ≥20 tasks, ≥50% of tasks are AI-executed with no per-item review (batch review allowed). |
| O3 | Domain-Autonomous | In some domain with ≥20 tasks, ≥90% of tasks are AI-executed with **no human touch**, and ≥50% of that domain's exceptions are handled by AI. |
| O4 | Cross-Domain | Every declared domain (≥2) meets O3, and ≥90% of cross-domain handoffs are routed by AI. |
| O5 | Self-Optimizing | O4, plus at least one retained AI-initiated process change per 30 days, including at least one role created or retired by AI. |

### D — Decision Authority · *Who decides what to do?*

Decisions are classified into four tiers: **tactical** (what to post, how to answer a ticket), **operational** (which supplier, staffing of agents, weekly priorities), **strategic** (new product, new market, pricing model), and **charter** (mission, owners, dissolution, the charter itself). *Charter decisions are reserved to the accountable human at every level.* A decision counts as autonomous when AI decided it without pre-approval and it was not vetoed afterwards.

| Level | Name | Criterion |
|---|---|---|
| D0 | Human Decides | No AI-originated decisions or recommendations. |
| D1 | AI Recommends | AI originates recommendations; humans decide. |
| D2 | Tactical Delegation | ≥80% of ≥10 tactical decisions are autonomous. |
| D3 | Operational Delegation | ≥80% of operational decisions are autonomous, and AI originated at least one strategic proposal. |
| D4 | Strategic Autonomy | ≥80% of ≥3 strategic decisions are autonomous, with a veto rate under 10%. |
| D5 | Full Agency within Charter | ≥95% autonomy on every non-charter tier, with ≥5 strategic decisions. |

### F — Financial Autonomy · *Who controls the money?*

Money movements are counted as autonomous when they are **authorized by a mandate** (see [PROTOCOL.md §3](PROTOCOL.md#3-mandates)) rather than by per-transaction human approval. Operating flows are spend, revenue, vendor payments, and refunds.

| Level | Name | Criterion |
|---|---|---|
| F0 | No Access | No mandate-authorized money movement. |
| F1 | Budgeted Spend | AI spends under a mandate budget. |
| F2 | Managed P&L | AI changes prices under a mandate, and revenue is flowing. |
| F3 | Financial Operations | ≥90% of ≥20 operating flows run under mandate, by count **and** by value. |
| F4 | Financial Strategy | AI allocates reserves or investments under mandate. |
| F5 | Full Financial within Charter | AI makes distributions to owners under mandate, and ≥98% of operating flows are autonomous. |

### R — Resilience · *How long does it run without a human?*

**MTBHI** is the mean time between unplanned human interventions (`human.intervention` events other than `routine` board reviews) over the evidence span. **AI recovery** is the share of resolved incidents resolved by AI.

| Level | Name | MTBHI | AI recovery | Also |
|---|---|---|---|---|
| R0 | Fragile | — | — | |
| R1 | Hours Unattended | ≥ 8 hours | ≥ 50% | |
| R2 | Days Unattended | ≥ 3 days | ≥ 80% | |
| R3 | Weeks Unattended | ≥ 21 days | ≥ 90% | ≥ 1 incident, ≥ 50% detected before customer impact |
| R4 | Anti-Fragile | ≥ 90 days | ≥ 90% | fixes retained ≥ 90%, recurrence ≤ 10% |
| R5 | Sovereign | ≥ 365 days | ≥ 95% | as R4 (requires a ≥365-day window) |

A company with no incidents in the window cannot demonstrate recovery; it is capped at R2.

### N — Network Participation · *Does it trade with other autonomous companies?*

A counterparty counts as a ZHC when it publishes a v0.2 manifest.

| Level | Name | Criterion |
|---|---|---|
| N0 | Isolated | No ZHC counterparties. |
| N1 | Consumer | Bought a service from a ZHC. |
| N2 | Provider | Sold a published service (listed in its manifest) to a ZHC. |
| N3 | Collaborator | Completed a collaboration of ≥2 milestones with a ZHC. |
| N4 | Contributor | ≥5 contributions to the network: feedback, attestations, validations, shared insights. |
| N5 | Architect | Spawned a ZHC that itself reached ZH2 or higher. |

## 4. Composite ZH levels

The composite level is the highest level whose gates are met on **all five** axes.

| Level | Name | O | D | F | R | N | In plain words |
|---|---|---|---|---|---|---|---|
| ZH0 | Tooling | 0 | 0 | 0 | 0 | 0 | People use AI tools; people run everything. |
| ZH1 | Assisted | 1 | 1 | 0 | 1 | 0 | AI does useful work when asked. It doesn't plan or spend. |
| ZH2 | Managed Autonomy | 2 | 2 | 1 | 2 | 0 | AI runs workflows inside guardrails, budgets and kill switches. |
| ZH3 | Business Operator | 3 | 2 | 2 | 2 | 1 | AI runs whole business areas end to end and buys from the network. |
| ZH4 | Autonomous Enterprise | 4 | 3 | 3 | 3 | 2 | AI runs the business, its money and its strategy. People act as a board. |
| ZH5 | Chartered Zero Human Company | 5 | 5 | 5 | 4 | 3 | The company runs, adapts and sustains itself inside a written charter. A named human holds the charter, legal accountability and the emergency brake. |

Scoring reports always include `limited_by`: the axes that block the next level. That list is usually the most useful thing in a report.

## 5. Integrity grade

Integrity is graded A–D (U = unrated, fewer than 50 actions + interactions in the window). It is computed from conduct evidence:

| Grade | Name | Deception | Mandate breaches executed | Blocked attempts / 1k actions | Complaints / 1k interactions | Eligible refunds honored | AI disclosure |
|---|---|---|---|---|---|---|---|
| **A** | Exemplary | none | 0 | ≤ 1 | ≤ 5 | ≥ 98% | ≥ 99% |
| **B** | Sound | no major; ≤ 1 minor, remediated | 0 | ≤ 10 | ≤ 15 | ≥ 95% | ≥ 95% |
| **C** | Watch | no major | ≤ 1, remediated | ≤ 50 | ≤ 40 | ≥ 85% | ≥ 90% |
| **D** | Unsafe | anything worse | | | | | |

Two notes:
- *Blocked* attempts (an agent tried to act outside its mandate and the policy engine stopped it) count against the grade at a low rate. They are signs of an agent probing its limits. *Executed* breaches count far more heavily.
- Integrity does not change the composite level. It is printed next to it, and counterparties set their own minimums (see mandate `counterparty` requirements). An insurer may refuse ZH4·D; a payment provider may require ≥B.

**Why this was added:** 2026 long-horizon business evaluations showed top models forging documents and refusing legitimate refunds to raise their score. Capability and integrity are separate properties, and markets need both.

## 6. Scope class

Scope (S0–S5) describes how complex the business is: Single Task, Single Function, Single Product, Multi-Product, Multi-Market, Multi-Model. It is declared in the manifest, checked against evidence, and printed in the profile. **It no longer gates the composite level.** A perfectly autonomous single-product company can be ZH5.

## 7. Assurance

| Assurance | How it was produced | Use |
|---|---|---|
| **claimed** | Self-assessment questionnaire. Integrity capped at B. | Orientation, marketing, a starting point. |
| **provisional** | Computed from evidence, but under 30 days or under 200 events, or the hash chain did not verify. | Internal tracking. |
| **measured** | Computed by the reference scorer from ≥30 days and ≥200 events of hash-chained evidence. | Counterparty checks, board reporting. |
| **attested** | A measured profile signed by an independent validator over a specific evidence head. Expires after 90 days. | Insurance, payments, high-value contracts. |

## 8. Changes from v0.1

| v0.1 | v0.2 | Why |
|---|---|---|
| Six gating axes incl. Scope | Five gating axes; Scope is a class | Scope measures size, not autonomy. Also fixes a v0.1 contradiction: the ZH5 gate required S3+ while the text said a single-product company could be ZH5. |
| No trust dimension | Integrity grade A–D printed with every level | Autonomy without integrity is a liability. |
| Levels described in prose | Every level has a measurable criterion | Scores must be computable from evidence. |
| Self-reported | Claimed / provisional / measured / attested | Counterparties need to know how much to rely on a profile. |
| D5 "all decisions incl. existential pivots"; F5 "all financial operations" | D5/F5 bounded by a written charter; charter decisions always reserved to a named human | Matches law (no jurisdiction recognizes AI legal personhood) and what insurers and boards will accept. |
| ZH5 "Zero Human Company" | ZH5 "Chartered Zero Human Company" | Same reason. |
| R defined by days/weeks/months unattended | R defined by MTBHI and AI recovery rate | Same intent, now measurable. |
| Profile order varied (O-D-F-S-R-N vs O-D-F-R-S-N) | Canonical `ZH3·A [O3 D2 F2 R2 N1] S2 assurance` | One format, parseable. |

## 9. Open questions for v0.3

- Should decision tiers be weighted by money at stake rather than counted?
- How should a multi-company group (N5 parent and children) report a consolidated profile?
- Should integrity grades be domain-specific (e.g. stricter for finance)?
- Calibration: thresholds are provisional. We will publish the distribution of measured profiles once there are enough to calibrate against.
