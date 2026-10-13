# ZHC.Network — The Zero Human Company Operating System

## Complete Framework Document v0.1

---

## 1. WHAT IS ZHC.NETWORK

ZHC.Network is the foundational operating system for building, running, and scaling Zero Human Companies. It is the infrastructure layer that enables vertical AI agent stacks to plug in and operate autonomous businesses.

If individual agent frameworks are employees, and orchestration tools like Paperclip are the management layer, ZHC.Network is the organizational fabric underneath — providing identity, communication, memory, governance, compute, and network connectivity that every autonomous company needs but nobody should have to build from scratch.

ZHC.Network is not an agent framework. It is not a chatbot platform. It is not a workflow builder. It is the operating system that makes all of those things composable into functioning autonomous enterprises, and connects those enterprises into an ecosystem where they can discover, transact with, and strengthen each other.

---

## 2. THE ZH MATURITY MODEL

The ZH Maturity Model is a standardized framework for measuring how autonomous a company actually is. Inspired by the SAE levels for self-driving vehicles, it provides a shared vocabulary for the emerging Zero Human Company ecosystem.

Unlike simple linear scales, the ZH Maturity Model measures autonomy across six independent axes, recognizing that a company can be highly autonomous operationally while still depending on humans for financial decisions. A single composite ZH Level (ZH0 through ZH5) provides a public-facing shorthand, determined by gated requirements across all six axes.

### 2.1 THE SIX AXES

#### Axis 1: Operational Autonomy (O)
*Who does the work?*

**O0 — Manual.** Human does all work. AI is not involved in execution.

**O1 — Assisted.** AI performs individual tasks on explicit human instruction. Human reviews output before it goes anywhere. Writing a draft email on command. Generating an image from a prompt. One task, one instruction, one review.

**O2 — Supervised.** AI executes multi-step workflows within a single domain without step-by-step instruction, but a human monitors, reviews batches of output, and intervenes on exceptions. The AI can run a content calendar but the human spot-checks posts before they publish.

**O3 — Domain-Autonomous.** AI runs a complete operational loop within one or more business domains end-to-end, including handling routine exceptions. Human does not review individual outputs — only audits aggregate performance. The support agent handles tickets, escalates hard cases on its own, and the human reviews CSAT scores weekly.

**O4 — Cross-Domain Autonomous.** AI manages operations across all business domains and coordinates between them. Marketing output informs product decisions which inform engineering priorities, all without human routing. The human interacts with the system at the level of "how is the business doing" not "what should marketing do this week."

**O5 — Self-Optimizing.** AI not only runs all operations but continuously improves its own operational processes — restructuring workflows, spinning up new agent roles, deprecating inefficient ones, and adapting to novel operational challenges it has never encountered before.

---

#### Axis 2: Decision Authority (D)
*Who decides what to do?*

**D0 — Human Decides Everything.** AI provides no input on decisions.

**D1 — AI Recommends.** AI surfaces options, analysis, and recommendations. Human makes all decisions. "Here are three pricing strategies with projected outcomes — which do you want?"

**D2 — Tactical Delegation.** AI makes routine tactical decisions autonomously within defined parameters. What to post, how to respond to a customer, which bug to fix next. Human makes strategic and cross-functional decisions.

**D3 — Strategic Input.** AI formulates strategic proposals based on data — "we should enter market X because of Y signals" — and can execute on approved strategies autonomously. Human approves or rejects strategic direction but does not originate it.

**D4 — Strategic Autonomy.** AI sets and executes strategy, pivots based on market data, and allocates resources across business functions. Human serves as board member with veto power and periodic review, not as active strategist.

**D5 — Full Agency.** AI makes all decisions including novel strategic moves, partnership evaluations, and existential pivots. Human retains only emergency override and legal accountability.

---

#### Axis 3: Financial Autonomy (F)
*Who controls the money?*

**F0 — No Financial Access.** AI has no ability to spend, earn, or manage money.

**F1 — Budgeted Spending.** AI can spend within pre-allocated budgets such as API costs and ad spend caps. All revenue collection, pricing decisions, and financial management are human-controlled.

**F2 — Managed P&L.** AI manages revenue and costs within a defined business function or product line. It can adjust pricing within bounds, optimize spend allocation, and report on unit economics. Human controls overall company finances, banking, and capital allocation.

**F3 — Financial Operations.** AI manages full company P&L including invoicing, payment collection, vendor payments, and cash flow management. It operates within financial policies set by the human but handles day-to-day financial execution autonomously. Human manages banking relationships, tax compliance, and capital reserves.

**F4 — Financial Strategy.** AI makes investment decisions, manages reserves, optimizes capital allocation, and handles financial planning. Human retains authority over major capital events such as fundraising and large commitments, and legal financial obligations.

**F5 — Full Financial Autonomy.** AI manages all financial operations and strategy including maintaining reserves, distributing returns, and making capital allocation decisions across ventures. Human retains legal ownership and fiduciary accountability only.

---

#### Axis 4: Resilience (R)
*What happens when things break?*

**R0 — Fragile.** Any unexpected input, failure, or environmental change stops the system. Requires human to diagnose and fix.

**R1 — Error Handling.** System handles known failure modes through retries, fallbacks, and basic error recovery. Novel failures escalate to human or cause the system to stop safely.

**R2 — Adaptive Recovery.** System can diagnose and recover from a range of unexpected failures — switching providers, rerouting workflows, degrading gracefully. Escalates to human only for truly novel situations. Can operate without human attention for days.

**R3 — Self-Healing.** System detects degradation before failure, proactively restructures to maintain service quality, and can operate without human attention for weeks. Can handle most novel failures through reasoning and experimentation rather than pre-programmed responses.

**R4 — Anti-Fragile.** System improves from failures and stressors. Each incident makes the system more robust. Can operate without human attention for months. Survives major external shocks such as provider outages, market shifts, and regulatory changes through autonomous adaptation.

**R5 — Sovereign Resilience.** System operates indefinitely without human involvement. Survives founder absence. Maintains operations through extreme scenarios including infrastructure migrations, market collapses, and adversarial conditions.

---

#### Axis 5: Scope & Complexity (S)
*How complex is what this entity manages?*

**S0 — Single Task.** The entity handles one task or one narrow function. Answering support emails. Generating social media posts. Not a business, just a capability.

**S1 — Single Function.** The entity manages a complete business function — all of marketing, all of customer support, all of engineering. Multiple tasks, one domain, with internal coordination between tasks within that domain.

**S2 — Single Product.** The entity manages multiple business functions in service of one product or service line. Marketing, sales, delivery, and support for one offering. This is a simple but complete business.

**S3 — Multi-Product.** The entity manages multiple product lines or service offerings, including cross-product resource allocation, portfolio prioritization, and managing different customer segments with different needs.

**S4 — Multi-Market.** The entity operates across multiple markets, geographies, or customer segments with distinct strategies for each. It handles the complexity of localization, regulatory differences, market-specific positioning, and cross-market resource allocation.

**S5 — Conglomerate.** The entity manages fundamentally different business models — perhaps a SaaS product, a marketplace, and a services business — each with different operational patterns, financial models, and strategic considerations. Maximum internal complexity.

---

#### Axis 6: Network Participation (N)
*How does this entity operate within an ecosystem of autonomous entities?*

**N0 — Isolated.** The ZHC operates as a standalone entity with no structured interaction with other autonomous systems. It may use third-party APIs and services, but there is no agent-to-agent relationship.

**N1 — Service Consumer.** The ZHC can discover and consume services provided by other ZHCs or agent systems through the network. It can find and transact with other autonomous entities programmatically. It buys from the network but does not sell.

**N2 — Service Provider.** The ZHC exposes its own capabilities as services that other ZHCs can consume. It has a defined interface, service level agreements, and pricing. The ZHC participates in the network economy in both directions — it buys and sells.

**N3 — Collaborative.** The ZHC engages in multi-party coordination with other ZHCs. Not just buying and selling atomic services, but forming working relationships — ongoing partnerships, joint projects, shared objectives. Agents from different entities communicate directly, share context, and coordinate timelines. This requires trust protocols, shared memory spaces, and inter-entity governance.

**N4 — Ecosystem Contributor.** The ZHC contributes to the health of the broader network. It shares anonymized operational insights, failure patterns, and best practices. It participates in network-level governance — rating other ZHCs, validating service quality, contributing to shared standards. The ZHC is not just in the ecosystem; it actively makes the ecosystem better.

**N5 — Network Architect.** The ZHC can spawn, fund, coordinate, and govern other ZHCs within the network. It identifies market gaps, instantiates new entities to fill them, establishes inter-entity relationships, and manages a portfolio of network participants. At N5, the entity is not just participating in the network — it is building the network.

---

### 2.2 COMPOSITE ZH LEVELS

The composite ZH Level provides a single-number shorthand for overall company autonomy. Each level has gate requirements across all six axes. A company must meet the minimum threshold on every axis to qualify for that level.

| ZH Level | Name | O | D | F | R | S | N | Description |
|----------|------|---|---|---|---|---|---|-------------|
| ZH0 | Tooling | 0+ | 0+ | 0+ | 0+ | 0+ | 0+ | AI tools are being used, but a human drives everything. |
| ZH1 | Assisted | 1+ | 1+ | 0+ | 1+ | 0+ | 0+ | AI performs useful work when asked. It does not plan or spend on its own. |
| ZH2 | Managed Autonomy | 2+ | 2+ | 1+ | 2+ | 1+ | 0+ | AI runs multi-step workflows within guardrails, spending limits, and kill-switch controls. |
| ZH3 | Business Operator | 3+ | 2+ | 2+ | 2+ | 2+ | 1+ | AI runs complete business domains end-to-end. It can acquire customers, deliver value, and handle exceptions within scope. |
| ZH4 | Autonomous Enterprise | 4+ | 3+ | 3+ | 3+ | 2+ | 2+ | AI runs the full business including financial operations and strategic pivots. Human serves as board member. |
| ZH5 | Zero Human Company | 5+ | 5+ | 5+ | 4+ | 3+ | 3+ | The system operates, adapts, and sustains itself with no regular human involvement. Human retains legal ownership and emergency override only. |

The gate requirements are intentionally asymmetric. Operational autonomy leads because organizations learn to trust AI with decisions after seeing it execute reliably. Financial autonomy lags because of legal and trust constraints. Network participation becomes required at ZH3+ because no real business operates in complete isolation. Scope gates are moderate because autonomy level and business complexity are somewhat independent — a perfectly autonomous single-product company still qualifies as ZH5.

### 2.3 READING A ZH PROFILE

A full ZH profile is expressed as six scores followed by the composite level:

**O3-D2-F2-S2-R2-N1 → ZH3**

This describes a company where AI runs complete operational loops in business domains (O3), makes tactical decisions autonomously (D2), manages revenue and costs within a product line (F2), operates a single complete product business (S2), recovers from unexpected failures and runs for days unattended (R2), and consumes services from the network (N1). It meets all gate requirements for ZH3.

A profile like **O4-D4-F1-S3-R3-N2** would be composite **ZH2** despite high scores on most axes, because financial autonomy (F1) only meets the ZH2 gate. This forces honesty: the company is only as autonomous as its most human-dependent dimension.

---

## 3. THE ZHC.NETWORK PLATFORM

### 3.1 ARCHITECTURE

ZHC.Network is structured as six platform layers. Each layer provides primitives that ZHC builders would otherwise have to reinvent, and each maps to enabling progression on the ZH Maturity Model axes.

**Layer 0: Identity & Registry.** Every entity in the system — agents, companies, humans, tools, data stores — gets a universal identity. An agent at cto@acme.zhc.network has an identity, a role, permissions, a budget, and a verifiable history. This is the namespace for autonomous organizations. It includes agent identity and credentialing, role-based access control, capability declarations, trust scores, and portable identity that moves across tools and runtimes.

**Layer 1: Communication Bus.** A universal agent communication protocol for structured messages with intent, context, and accountability. Not just "send text to channel" but "delegate task with budget, deadline, context chain, and escalation policy." This enables agents across different runtimes and tools to coordinate — a Paperclip-managed CEO agent communicating with a Rivet-hosted coding agent and a Team9-based collaboration agent, all through one protocol.

**Layer 2: State & Memory Fabric.** Organizational memory as a service. Working memory for current task context. Episodic memory for what happened and when. Semantic memory for institutional knowledge, learnings, and patterns. Shared memory for cross-agent knowledge that compounds over time. Any agent runtime can plug into this layer so that knowledge persists across agents, sessions, and time.

**Layer 3: Governance & Control Plane.** Cross-cutting governance that works regardless of agent runtime. Budget enforcement, approval gates, audit trails, kill switches, escalation policies, and compliance logging. The human-on-the-board interface lives here. Designed so the human's required surface area shrinks over time as trust scores increase.

**Layer 4: Compute & Execution Fabric.** An abstraction layer over agent runtimes. Integrates with Rivet, Modal, Fly.io, and other compute providers. The vertical ZHC developer declares an agent with a role and capabilities; the OS handles where it runs, how it persists, and how it scales. Runtime-agnostic by design — if it can receive a heartbeat, it is hired.

**Layer 5: Network & Marketplace.** Service discovery, inter-entity communication protocols, trust and reputation systems, shared learning, and network governance. Pre-built vertical ZHC templates — content agency, e-commerce, SaaS, trading firm — that plug into the platform and run. This is the ecosystem layer that creates network effects and makes ZHC.Network a platform rather than a tool.

### 3.2 CORE PRINCIPLES

**Runtime Agnostic.** ZHC.Network does not dictate which agent framework, LLM provider, or compute platform you use. It provides the organizational layer that sits above all of them.

**Progressive Autonomy.** The platform is designed to support companies at every ZH level, from ZH0 to ZH5. You start with human-heavy operations and progressively hand off control as trust and capability increase.

**Network-Native.** Every entity on ZHC.Network is a potential node in the broader ecosystem from day one. Service interfaces, trust protocols, and communication standards are built into the foundation, not bolted on later.

**Observable by Default.** The platform has the data to objectively measure where a company sits on each axis of the ZH Maturity Model. ZH scores are not self-reported — they are computed from actual operational data.

### 3.3 HOW THE PLATFORM ENABLES ZH LEVEL PROGRESSION

| Transition | Platform Capability Required |
|------------|------------------------------|
| ZH0 → ZH1 | Agent identity, basic task execution, tool integration |
| ZH1 → ZH2 | Communication bus, guardrails, budget controls, error handling |
| ZH2 → ZH3 | Memory fabric, domain-level operational loops, P&L tracking, network service consumption |
| ZH3 → ZH4 | Cross-domain coordination, strategic decision support, financial operations automation, self-healing infrastructure, service provision to network |
| ZH4 → ZH5 | Full self-optimization, autonomous financial management, sovereign resilience, network collaboration |

---

## 4. VERTICAL ZHC TEMPLATES

ZHC.Network enables vertical Zero Human Companies to plug in and operate on the platform. Each vertical template defines the organizational structure, agent roles, communication patterns, governance rules, and integration points for a specific type of business.

Example verticals include content agencies, e-commerce businesses, SaaS products, consulting firms, trading operations, development studios, and marketing agencies. The platform handles all shared infrastructure so that vertical builders focus only on domain-specific logic.

The ZHC Marketplace allows templates to be shared, sold, and forked. A builder can download a complete content agency ZHC template, customize it for their niche, and have an operational autonomous business running on ZHC.Network within hours.

---

## 5. VISION

Today, every person building an autonomous AI company is reinventing the same infrastructure: identity, communication, memory, governance, compute orchestration, and inter-agent coordination. ZHC.Network eliminates that duplication by providing it as a platform.

The near-term goal is to become the standard infrastructure layer for autonomous companies — the way AWS became the standard infrastructure for internet companies and Stripe became the standard for payments.

The long-term goal is to enable a self-sustaining network of autonomous enterprises that discover each other, trade with each other, learn from each other, and collectively push the frontier of what businesses can achieve without human labor. Not a single zero human company, but a zero human economy.

ZHC.Network is where that economy runs.

---

*ZHC.Network — The Operating System for Zero Human Companies*
*Framework Version: 0.1*
*Date: March 2026*
