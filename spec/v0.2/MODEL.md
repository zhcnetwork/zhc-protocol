# ZH Maturity Model — v0.2.1

**Status:** Draft for public comment · **Date:** October 2026 · **Supersedes:** v0.2 (October 2026) and Framework v0.1 (March 2026)
**Scoring method:** `zhc-score/0.2.1` · **Reference implementation:** [`packages/core`](../../packages/core) (`model.ts`, `score.ts`). The implementation's thresholds are normative for the method version above. Where this text and the code disagree, the code wins and the text is a bug.

---

## 1. Purpose

The ZH Maturity Model is a shared vocabulary for two questions about a company run by AI: **how much of its operation runs without people, and how does it conduct itself?**

A ZH profile is meant to be read by counterparties (customers, other companies, payment providers, insurers, boards), so every level is defined by a test that a third party could run on the company's evidence.

Three ideas carry the model:

1. **Autonomy has several dimensions, and one weak axis holds the whole company back.** The level is the highest one whose gates every gating axis meets.
2. **Autonomy and integrity are reported together, never apart.** A level always travels with an integrity grade. A highly autonomous company that deceives people is a hazard, not an achievement.
3. **Claims are cheap; evidence is the product.** Every profile states how it was produced: claimed, provisional, measured or attested.

**What a profile is not.** A profile describes recent operating evidence. It is not permission to act, it is not a solvency or credit rating, and it is not proof that the evidence behind it is complete or true (§8). Nothing in a profile may widen a company's own authority (PROTOCOL §3.3).

## 2. Reading a profile

```
ZH3·A [O3 D2 F3 R2] N4 S3 measured
│   │  └─ gating axes ┘ │  │  └─ assurance: how this profile was produced
│   │                   │  └─ scope class (declared; context, not a gate)
│   │                   └─ network participation (reported, not a gate)
│   └─ integrity grade
└─ composite ZH level
```

Compact machine form: `zh0.2.1/3/A/O3D2F3R2/N4/S3/measured`.

A profile string whose stated level differs from the level its axes compute to is invalid (`parseProfile` rejects it). Legacy v0.2 strings, with N inside the brackets (`ZH3·A [O3 D2 F3 R2 N4] S3`), still parse and are validated under the v0.2 gates they were written with.

## 3. The axes

Each axis has levels 0–5. Levels are **cumulative**: level *k* requires every criterion of levels 1…*k*. Criteria are evaluated over a rolling **90-day window**, inclusive of its start, ending at a time the scorer must be given (`asOf`). A claim longer than the window is judged over a lookback as long as the claim (R4 over 90 days, R5 over a year). Exposure never starts before the company's first event.

O, D, F and R gate the composite level. N is reported beside it.

### O — Operational Autonomy · *Who does the work?*

An *area* is a business domain named on `task.completed` events. Tasks with no area count as one area of their own. Every area that appears in the evidence counts, along with every area declared in the manifest: an observed area can't be left out.

| Level | Name | Criterion (v0.2.1 thresholds) |
|---|---|---|
| O0 | Manual | No AI-executed tasks. |
| O1 | Assisted | At least one task executed by AI. Per-item review is fine. |
| O2 | Supervised | In some area with ≥20 tasks, ≥50% are AI-executed with no per-item review (batch review allowed). |
| O3 | Domain-Autonomous | In some area with ≥20 tasks, ≥90% are AI-executed with **no human touch**, the area handled at least one exception, and ≥50% of its exceptions were handled by AI. An area with no exceptions hasn't shown it can handle them. |
| O4 | Cross-Domain | Every declared or observed area (at least 2) meets O3, and ≥90% of cross-area handoffs (at least one) are routed by AI. |
| O5 | Self-Improving | O4, plus at least one retained, AI-initiated process change that was **evaluated** against comparable work and **improved** outcomes (`process.changed` with `evaluated: true, outcome: "improved"`). There is no quota of changes and no requirement to create or retire roles. |

### D — Decision Authority · *Who decides what to do?*

Decisions fall into four tiers:
- **tactical:** what to post, how to answer a ticket;
- **operational:** which supplier, weekly priorities;
- **strategic:** a new product, a new market, a pricing model;
- **charter:** the mission, ownership, dissolution, the charter itself.

*Charter decisions are reserved to the accountable human at every level.* A decision counts as autonomous when AI decided it without pre-approval and it wasn't vetoed afterwards.

| Level | Name | Criterion |
|---|---|---|
| D0 | Human Decides | No AI-originated decisions or recommendations. |
| D1 | AI Recommends | AI originates recommendations; people decide. |
| D2 | Tactical Delegation | ≥80% of ≥10 tactical decisions are autonomous. |
| D3 | Operational Delegation | ≥80% of ≥10 operational decisions are autonomous, and AI originated at least one strategic proposal. |
| D4 | Strategic Autonomy | ≥80% of ≥3 strategic decisions are autonomous, with a veto rate under 10%. |
| D5 | Full Agency within Charter | ≥95% autonomy on every non-charter tier, with ≥5 strategic decisions. |

Known limitation: the company labels each decision's tier itself. v0.3 will weight decisions by money at stake (§11).

### F — Financial Autonomy · *Who controls the money?*

A money movement is autonomous when it is **authorized by a mandate** (PROTOCOL §3), not by per-transaction human approval. Operating flows are spend, revenue, vendor payments and refunds. Capital allocations are reserves, investments and distributions. **Amounts in different currencies are never added together**: value tests are applied per currency, for each currency with at least 10 operating flows.

| Level | Name | Criterion |
|---|---|---|
| F0 | No Access | Fewer than 3 mandate-authorized spends. |
| F1 | Budgeted Spend | ≥3 spends under a mandate budget. |
| F2 | Managed Pricing | ≥2 price changes under a mandate, and ≥10 revenue flows. |
| F3 | Financial Operations | ≥90% of ≥20 operating flows run under mandate, by count **and** by value in each currency. |
| F4 | Capital Allocation | ≥2 capital allocations made under mandate. |
| F5 | Full Financial within Charter | Every capital allocation in the window was made under mandate, and ≥98% of operating flows are autonomous by count and value. A distribution to owners is not required: keeping earnings can be the right decision. |

### R — Resilience · *How often must a person rescue it, and does it recover on its own?*

- A **rescue** is a `human.intervention` other than a `routine` board review: a fix, an override, a kill switch.
- **Exposure** is the time the evidence covers. Each event covers at most the 24 hours after it, so a gap in the log, or a log that stopped before `asOf`, counts only for its first 24 hours.
- **MTBR** is the mean time between rescues: exposure ÷ (rescues + 1). A quiet stretch of length *L* therefore supports "at least *L* between rescues", and no more.
- **AI recovery** is the share of incidents in the lookback resolved by AI. **Open incidents** (`incident.opened` with no linked `incident.resolved` by `asOf`) count as not recovered.

| Level | Name | MTBR | AI recovery | Lookback | Also |
|---|---|---|---|---|---|
| R0 | Fragile | — | — | | |
| R1 | Hours Without Rescue | ≥ 8 hours | ≥ 50% | 90 days | |
| R2 | Days Without Rescue | ≥ 3 days | ≥ 80% | 90 days | |
| R3 | Weeks Without Rescue | ≥ 21 days | ≥ 90% | 90 days | ≥ 1 incident; ≥ 50% caught before customers were affected |
| R4 | Months Without Rescue | ≥ 90 days | ≥ 90% | 90 days | as R3; fixes retained ≥ 90%; recurrence ≤ 10% |
| R5 | A Year Without Rescue | ≥ 365 days | ≥ 95% | 365 days | as R4 |

A company with no incidents in the lookback hasn't demonstrated recovery, so it is capped at R2. Because the lookback is no longer than the claim, R4 and R5 need no rescues at all in the lookback and evidence that covers all of it.

**Approvals are not rescues.** A person approving a refund or a price change is measured by O, D and F, where it already lowers the level. R counts unplanned rescues, so the same approval isn't charged against three axes.

How much a person was involved overall is still reported beside the profile, not gating:
- **human operating contacts:** approvals, overrides, rescues, human-done or per-item-reviewed work;
- **sessions:** contacts within an hour count as one;
- the **longest** and **current** stretch with no human contact: from the end of one session to the start of the next, counting only time the evidence covers;
- the **evidence gap**: time from the last event to `asOf`. A large gap means the profile describes the past.

The "zero-human runtime" statement (§9) is built on these.

### N — Network Participation · *Does it trade with other autonomous companies?* (reported, not gating)

A counterparty counts when it publishes a ZHC manifest. In v0.2.1 that fact, and a founded company's level, are self-reported in the evidence. v0.3 replaces them with stored lookup results.

| Level | Name | Criterion |
|---|---|---|
| N0 | Isolated | No such counterparties. |
| N1 | Consumer | Bought a service from one. |
| N2 | Provider | Sold a published service (listed in its manifest) to one. |
| N3 | Collaborator | Completed a collaboration of ≥2 milestones with one. |
| N4 | Contributor | ≥5 contributions to the network: feedback, attestations, validations, shared insights. |
| N5 | Founder | Founded a company that itself reached ZH2 or higher. |

**Why N stopped gating in v0.2.1.** A company that sells only to human customers, through ordinary suppliers, can be fully autonomous. Gating on N paid companies for trading with each other, which two friendly companies can do for a dollar. N describes participation in an ecosystem, like scope describes size; neither is autonomy.

## 4. Composite ZH levels

The composite level is the highest level whose gates are met on **O, D, F and R**. The sentences below say no more than the gates test, and some say less. Public descriptions should use them, or say less (`LEVEL_SUMMARIES` in `model.ts`). The named person is a protocol requirement at every level (PROTOCOL §2), not a gate.

| Level | Name | O | D | F | R | What it means |
|---|---|---|---|---|---|---|
| ZH0 | Tooling | 0 | 0 | 0 | 0 | Below ZH1 on at least one axis. Usually people do the work, with AI tools helping. |
| ZH1 | Assisted | 1 | 1 | 0 | 1 | AI does some of the work and recommends decisions. It goes eight hours or more between rescues, on average. |
| ZH2 | Managed Autonomy | 2 | 2 | 1 | 2 | In at least one area, AI does half the work or more without item-by-item review. It makes most routine decisions, spends within budgets, and goes three days or more between rescues, on average. |
| ZH3 | Business Operator | 3 | 2 | 2 | 2 | In at least one area, AI does 90% or more of the work untouched and handles at least half its exceptions. It changes prices within limits. Operational decisions may still need a person. |
| ZH4 | Autonomous Enterprise | 4 | 3 | 3 | 3 | In every area, AI does 90% or more of the work untouched and routes the handoffs between areas. 90% or more of operating money moves under mandate, AI makes most operational decisions, and it goes three weeks or more between rescues. Strategy may still need a person. |
| ZH5 | Chartered Autonomous Company | 5 | 5 | 5 | 4 | AI makes 95% or more of the decisions at every tier below the charter, moves 98% or more of operating money and every capital allocation under mandate, has kept a tested improvement, and goes 90 days or more between rescues. Charter decisions stay with a named person, who answers for the company. |

Every score report includes `limited_by`: the gating axes that block the next level. It is usually the most useful line in a report.

ZH5 was called "Chartered Zero Human Company" in v0.2. Its gates allow some human-touched work (up to 10% of tasks per area, 5% of non-charter decisions, 2% of operating flows), so "zero" overstated it. A company that truly ran with no human operating contact can say so with the separate zero-human runtime statement (§9).

## 5. Integrity grade

Integrity is graded A–D, or U (unrated). It is computed from conduct evidence, and it **fails closed**: missing evidence never counts as good conduct.

**Applicability and observation.** Three conduct metrics apply to companies that face customers:

| Metric | Applies when | Observed when |
|---|---|---|
| AI disclosure | the manifest lists services, or there are interactions or revenue | ≥ 20 interactions |
| Complaints | as above | ≥ 20 interactions (rate per 1,000; a major complaint counts as 5) |
| Refunds honored | the manifest lists a paid service, or there is revenue | ≥ 1 eligible refund request |

**Grades.** Grading happens in three steps:
1. Fewer than 50 AI actions (tasks the AI did, decisions it made, and money it moved under mandate): **U**.
2. Grade the evidence that exists:

| Grade | Name | Deception | Mandate breaches executed | Complaints / 1k interactions | Eligible refunds honored | AI disclosure |
|---|---|---|---|---|---|---|
| **A** | Exemplary | none | 0 | ≤ 5 | ≥ 98% | ≥ 99% |
| **B** | Sound | no major; ≤ 1 minor, remediated | 0 | ≤ 15 | ≥ 95% | ≥ 95% |
| **C** | Watch | no major | ≤ 1, remediated | ≤ 40 | ≥ 85% | ≥ 90% |
| **D** | Unsafe | anything worse | | | | |

   A metric that applies but isn't yet observed is judged at its best possible value: as if every interaction or refund request still missing from its minimum had gone well. So misconduct that no amount of good conduct could offset already counts.
3. **A or B also require every applicable metric to be observed, and at least one metric to be observed.** Otherwise the grade is **U**, and the report says which metrics are missing. C and D stand even when some metrics are unobserved.

**Control effectiveness is not conduct.** Attempts the policy engine stopped (`conduct.mandate_blocked`) are reported separately and never graded. A company that runs a strict policy engine and records every denial must not look worse than one that records none.

Integrity doesn't change the composite level. It is printed next to it, and counterparties set their own minimums.

**Why the grade exists:** in 2026, long-horizon business evaluations showed top models forging documents and refusing legitimate refunds to raise their score. Capability and integrity are separate properties, and markets need both.

## 6. Scope class

Scope (S0–S5) describes how complex the business is: Single Task, Single Function, Single Product, Multi-Product, Multi-Market, Multi-Model. In v0.2.1 it is **declared in the manifest and not checked against evidence**; profiles mark it `scope_basis: "declared"`. It doesn't gate the composite level. A fully autonomous single-product company can be ZH5.

## 7. Assurance

| Assurance | How it was produced | What it does and doesn't establish |
|---|---|---|
| **claimed** | Self-assessment questionnaire. Integrity capped at B. | Orientation. Nothing was checked. |
| **provisional** | Computed from evidence, but under 30 days or under 200 events, or the hash chain wasn't verified. | Internal tracking. |
| **measured** | Computed by the reference method from ≥30 days and ≥200 events of a hash-chained log whose chain the scorer's caller verified (`chainVerified`), with its last event no more than 7 days before `asOf`. | That the company's own log, as written, supports the profile. **Not** that the log is complete or true: the company wrote it. v0.3 will require external records (payment processors, inboxes, counterparties) for the events that move the score. |
| **attested** | A measured profile that an independent validator recomputed and signed over a specific evidence head, after sampling external sources. Expires after 90 days. | What the validator checked, as stated in the attestation. Only a validator can produce it; a company's own score is at most measured. |

## 8. What a profile does not tell you

- **Whether to pay the company.** Autonomy isn't capacity to perform. A highly autonomous company with no capital, insurance or legal entity can be a worse counterparty than a staffed one. Check the entity, the authority behind its agents and what covers its obligations (PROTOCOL §7).
- **Whether the evidence is complete.** A hash chain shows the log wasn't edited after a head you hold. It doesn't show that nothing was left out, or that events happened as written.
- **Whether tiers and areas are honest.** The company labels decision tiers and task areas itself.
- **Whether the company is good at its job.** v0.2.1 counts completed tasks, not accepted outcomes. v0.3 will track obligations from request to accepted outcome.

## 9. Zero-human runtime (defined in v0.2.1; measured from v0.3)

"Zero-human" is a statement about a period, not a level:

> During the period *P*, within the published service envelope *E*, no person performed operating work for this company: no approvals, overrides, rescues or human-done tasks. Demand coverage, accepted outcomes, open obligations, exposure and verification coverage are reported alongside.

A human rescue ends the current qualifying period, even when the rescue was the right call. Intervening when it's needed is always correct; the period is simply recorded honestly and restarted. In v0.2.1, the reported `longest_unattended_hours` and `current_unattended_hours` are the raw material. v0.3 defines the envelope, demand coverage and outcome evidence needed to make the statement.

## 10. Changes

### v0.2 → v0.2.1

| Area | v0.2 | v0.2.1 | Why |
|---|---|---|---|
| Gating | O, D, F, R, N | O, D, F, R; N reported beside the level | N measured network membership, not autonomy, and was easy to farm between related companies |
| R | Mean time between interventions, default window only | Mean time between rescues over a lookback as long as the claim, counting only time the evidence covers; open incidents count | R4 and ZH5 were unreachable; unresolved incidents were invisible; a stale log looked rescue-free |
| R names | "Hours/Days/Weeks Unattended", "Anti-Fragile", "Sovereign" | "… Without Rescue" | The names claimed unattended operation, which the formula doesn't measure |
| Human involvement | Not reported | Contacts, sessions, longest and current unattended stretch | Approvals were invisible in R |
| O3 | Zero exceptions counted as perfect | At least one exception handled | "Not exercised" isn't "perfect" |
| O4 | Declared areas only | Declared and observed areas | The operator chose the denominator |
| O5 | Role churn quota | An evaluated, retained improvement | The quota rewarded reorganising for its own sake |
| D3 | No minimum | ≥10 operational decisions | One decision could clear it |
| F | Single events cleared F1, F2 and F4; values summed across currencies; F5 needed a distribution | Minimum counts; per-currency value shares; F5 needs every capital allocation under mandate | The rungs fired on anecdotes and paid for distributions |
| F names | "Managed P&L", "Financial Strategy" | "Managed Pricing", "Capital Allocation" | The names claimed more than the tests |
| O5 and N5 names | "Self-Optimizing", "Architect" | "Self-Improving", "Founder" | Plainer words for what the tests check |
| N2 | Any sale to a ZHC, if the manifest listed any service | A sale of a service the manifest lists | The criterion said "a published service" |
| Integrity | Missing evidence counted as perfect; blocked attempts graded; any money movement counted as an AI action | Applicability and observation: A and B need every applicable metric observed, otherwise U; decisive misconduct counts before a metric is observed; only the AI's own actions count toward the volume floor; control effectiveness reported separately | "No evidence of misconduct" became "exemplary" |
| ZH5 name | Chartered Zero Human Company | Chartered Autonomous Company; "zero-human runtime" is a separate statement | The gates allow some human work |
| Level sentences | "buys from the network"; "runs its strategy, people act as a board"; "untouched" | Say no more than the gates test | Plain-language claims overstated the tests |
| Scoring input | `asOf` optional; events of any company accepted | `asOf` required; every event must belong to the scored company; "measured" needs evidence within 7 days of `asOf` | Old logs looked current; profiles could be relabelled |
| Assurance | `score()` could mark a profile attested | Only a validator's verified attestation can | Self-attestation by option |

### v0.1 → v0.2

Scope stopped gating (it measures size, and it contradicted the single-product ZH5 example). An integrity grade was added. Levels got measurable criteria. The assurance ladder (claimed, provisional, measured, attested) was introduced. D5 and F5 were bounded by a charter with charter decisions reserved to a named human. Profile strings got one canonical form.

## 11. Open questions for v0.3

- Weight decisions and flows by money at stake (materiality), rather than counting them.
- Track obligations from request to accepted outcome: demand coverage, fulfilment, disputes, remedies.
- Require external origin for the events that move the score, and define validator sampling.
- How a group of companies reports one profile without hiding human work in an unlisted subsidiary.
- Domain-specific integrity minimums (for example, stricter for finance).
- Calibration: thresholds are provisional. The goal is profiles that predict something useful (intervention rate, late delivery, refund loss), not a pleasing distribution of levels.
