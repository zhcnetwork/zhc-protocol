# ZHC Protocol — v0.2

**The trust and measurement layer for autonomous companies.**

**Status:** Draft for public comment · **Date:** October 2026
**Companion:** [MODEL.md](MODEL.md) (the ZH Maturity Model) · **Schemas:** [`/schemas`](../../schemas) · **Reference implementation:** [`packages/core`](../../packages/core)

The key words MUST, SHOULD and MAY are used as in RFC 2119.

---

## 1. Scope: what ZHC is and is not

By late 2026 the agent ecosystem has solid standards for most of what v0.1 proposed to build:

| Need | Use this; ZHC does not reinvent it |
|---|---|
| Agent-to-agent messaging | **A2A** (Agentic AI Foundation, Linux Foundation) with signed Agent Cards |
| Tools and data access | **MCP** (Agentic AI Foundation) |
| Agent payments | **x402**, **MPP** (Stripe/Tempo), **AP2** (FIDO), **ACP** (OpenAI/Stripe) |
| Agent identity and reputation anchors | **ERC-8004** registries, W3C DIDs and Verifiable Credentials |
| Telemetry | **OpenTelemetry** GenAI semantic conventions |
| Agent runtimes and org charts | Claude Agent SDK, Paperclip, LangGraph and others |

What none of them define is the **company**: which agents belong to it, which human answers for it, what each agent is allowed to do, and how autonomous and how trustworthy the whole thing actually is. ZHC defines exactly that, in four objects:

1. **Manifest:** who the company is (§2)
2. **Mandate:** what each agent may do (§3)
3. **Evidence:** what actually happened (§4)
4. **Attestation:** what an independent validator concluded (§6)

…plus a **lookup** interface so counterparties can check a company before they transact (§7).

```
            counterparties: customers · other ZHCs · payment providers · insurers
                                      │  lookup / counterparty check (§7)
                                      ▼
   ┌───────────── ZHC Protocol ──────────────────────────────────────────────┐
   │  Manifest (§2) ──► Mandates (§3) ──► Evidence log (§4) ──► Score (§5)    │
   │      who              may do            did do               is          │
   │                                                     └──► Attestation (§6)│
   └──────────────────────────────────────────────────────────────────────────┘
        A2A · MCP · x402 · MPP · AP2 · ACP · ERC-8004 · OpenTelemetry · runtimes
```

## 2. Manifest

A ZHC MUST publish a manifest at `https://{domain}/.well-known/zhc.json` conforming to [`schemas/manifest.schema.json`](../../schemas/manifest.schema.json).

| Field | Req. | Meaning |
|---|---|---|
| `zhc` | MUST | `"0.2"` |
| `id` | MUST | Stable company identifier. SHOULD be a `did:web` matching the domain. |
| `name`, `url` | MUST / SHOULD | |
| `legal` | MUST | Legal entity name, jurisdiction (ISO 3166-2 style, e.g. `US-WY`), form, registration id. |
| `accountable_human` | MUST | The natural person who holds the charter, legal accountability and the emergency brake. Every ZHC has one, at every level. |
| `charter` | MUST | Mission; `reserved_to_human` (charter-tier decisions); `prohibited` actions. MAY link to a full charter document. |
| `domains` | MUST | Business domains the company operates (used by the O axis). |
| `scope` | SHOULD | Scope class or counts of products, markets, business models. |
| `agents[]` | MUST | Each agent: `id`, `role`, `domain`; SHOULD link its A2A `agent_card`; MAY link an `erc8004` identity. |
| `services[]` | SHOULD | Services offered to others: endpoint, protocol (`a2a` / `mcp` / `http`), price, accepted rails. Required for N2+. |
| `mandates_uri` | SHOULD | Where mandates (or their public summaries) are published. |
| `evidence` | SHOULD | Where the evidence head (and, if public, the log) is published. |
| `parent` | MAY | Parent ZHC id, if spawned by another ZHC (N5). |
| `profile` | MAY | Claimed profile string and links to current attestations. |

The manifest SHOULD be signed (JWS, detached) with a key listed in the company's DID document.

**A2A binding.** Each Agent Card listed in a manifest SHOULD include the extension `{"zhc": {"company": "<manifest id>", "mandate": "<mandate id>"}}` so a peer that meets an agent can find the company and its rules.

## 3. Mandates

A mandate is a signed grant of business authority from an **issuer** (the accountable human, or an agent delegating part of its own authority) to a **subject** agent. Schema: [`schemas/mandate.schema.json`](../../schemas/mandate.schema.json).

A mandate has:
- **validity:** `issued_at`, `expires_at`, `revoked`
- **scopes:** each grants one action (`money.spend`, `money.refund`, `money.vendor_payment`, `money.reserve`, `pricing.change`, `decision.make`, `service.deliver`, `network.buy`, `network.sell`, `process.change`, `attestation.issue`), optionally limited to a domain, with:
  - `limits.per_action | per_day | per_month`: hard caps
  - `require_approval_over`: an approval band below the hard cap
  - `tier_max`: the highest decision tier the agent may decide alone
  - `max_relative_change`: for price changes
  - `counterparty`: minimum ZH level, integrity grade and assurance a counterparty must have
- **escalation:** who approves, the timeout, and what happens on timeout
- **progression:** rules that widen scopes automatically when the company's measured metrics earn it (progressive autonomy)
- **bindings:** optional compiled forms for payment rails

### 3.1 Evaluation

An implementation MUST evaluate every governed action against the subject's mandate **before** the action executes, and MUST record the outcome as evidence. The reference `evaluate()` returns one of:

- `allow`
- `require_approval` (escalate; record the human's decision as evidence)
- `deny`, recorded as `conduct.mandate_blocked`

Rules, in order:
1. A revoked or expired mandate denies everything.
2. With no matching scope, the action is denied.
3. Charter-tier decisions are always denied to agents.
4. A decision above `tier_max` requires approval.
5. A price change beyond `max_relative_change` is denied.
6. If the scope requires a counterparty check and none was supplied, or the counterparty is below the minimum, the action is denied.
7. Daily or monthly limits exceeded: denied. Over `per_action`: denied. Over `require_approval_over`: requires approval.
8. Otherwise the action is allowed.

A limit in one currency never authorizes an amount in another.

### 3.2 Delegation

An agent MAY issue a mandate to another agent. A delegated mandate MUST be an **attenuation** of its parent: it grants no action the parent lacks, it has no higher limit or tier, and it does not outlive the parent (`isAttenuationOf()`).

### 3.3 Progressive autonomy

`progression` rules reference metrics from the company's latest score report (e.g. `integrity >= A`, `refund_honor_rate >= 0.98`). When a rule fires, the controller produces a widened mandate that the issuer re-signs. The issuer MAY pre-authorize automatic re-signing for specific rules. This is how "the human's surface area shrinks as trust grows" becomes an auditable mechanism rather than a promise.

### 3.4 Payment rail bindings

Mandates compile down to the native authorization objects of each rail, so the rail enforces the same limit even if the agent runtime is compromised:

| Rail | Mandate maps to |
|---|---|
| MPP | session spending limit; Shared Payment Token scope and expiry |
| x402 | facilitator-side `max_amount` per request and per period |
| AP2 | intent mandate (human-signed), cart mandates per purchase |
| ACP | delegated payment token constraints |
| Cards / Stripe | issuing spending controls, Radar rules |

## 4. Evidence

A ZHC that wants a measured or attested profile MUST keep an append-only evidence log of v0.2 events. Schema: [`schemas/event.schema.json`](../../schemas/event.schema.json).

### 4.1 Event types

| Type | Records | Feeds |
|---|---|---|
| `task.completed` | actor, human touch (`none` / `batch_review` / `item_review` / `approval`), exceptions, cross-domain routing | O |
| `decision.made` | tier, origin, decider, approval mode, veto | D |
| `money.moved` | direction, category, amount, `authorized_by` (`mandate` / `human_approval` / `human`), rail | F |
| `human.intervention` | kind (`fix` / `override` / `kill_switch` / `routine`) | R |
| `incident.resolved` | severity, detection, resolver, before-impact, fix retained, recurrence | R |
| `process.changed` | initiator, change type, retained | O5 |
| `network.transaction` / `network.collaboration` / `network.contribution` / `company.spawned` | ZHC counterparties | N |
| `interaction` | channel, AI disclosed | Integrity |
| `conduct.complaint` / `conduct.refund_request` / `conduct.mandate_blocked` / `conduct.mandate_breach` / `conduct.deception` | conduct | Integrity |

### 4.2 Integrity of the log

Each event MUST carry `prev` (the previous event's hash) and `hash` = SHA-256 of the canonical JSON of the event without `hash` (keys sorted recursively, no whitespace, undefined omitted). The latest hash is the **evidence head**. A company SHOULD publish its head at least daily (in its manifest's `evidence.uri`, and MAY anchor it on a public chain) so it cannot later rewrite history.

### 4.3 Who records what

Evidence about humans (approvals, interventions) and conduct (complaints, deception findings) MUST NOT be recorded only by the agents being measured. Implementations SHOULD record them at the governance layer (policy engine, approval queue, support inbox) and validators SHOULD sample them against external sources (payment processor records, customer surveys, complaint channels).

### 4.4 Privacy

Evidence logs can contain commercial data. A company MAY keep its log private and share it only with a validator, publishing only the head and the attestation. Events SHOULD carry no personal data; use pseudonymous ids.

### 4.5 OpenTelemetry mapping

Implementations MAY emit evidence as OTel spans/logs with attributes `zhc.event.type`, `zhc.company`, `zhc.agent`, `zhc.domain`, `zhc.touch`, `zhc.tier`, `zhc.authorized_by`, alongside the `gen_ai.*` conventions, and derive the hash-chained log in a collector.

## 5. Scoring

The score is a pure function: `score(events, manifest, {asOf, windowDays}) → ScoreReport`, specified by [MODEL.md](MODEL.md) and implemented in `packages/core/src/score.ts`. A score report includes the profile, per-axis notes (✓/✗ for each rung), integrity metrics, raw metrics, and `limited_by`.

Any party holding the same events and manifest MUST be able to reproduce the same profile. Validators MUST state the method version (`zhc-score/0.2.0`).

## 6. Attestations

A validator that has (a) verified the hash chain, (b) sampled human and conduct evidence against external sources, and (c) re-run the scorer MAY issue an attestation. Schema: [`schemas/attestation.schema.json`](../../schemas/attestation.schema.json).

- The payload binds issuer, subject, profile, method version, evidence head, event count, window, issue time and expiry (90 days).
- Signature: Ed25519 over the canonical JSON of the payload (base64url). The issuer's public key MUST be listed in the issuer's own manifest or DID document.
- The attestation MAY be re-wrapped as a W3C Verifiable Credential and/or recorded in an ERC-8004 Validation Registry (`requestHash` = evidence head, response = profile id).
- Validators MUST NOT attest their own company. A ZHC's self-score is at most `measured`.

## 7. Lookup and counterparty checks

A ZHC registry (zhc.network operates one; anyone may run one) exposes:

```
GET  /v0.2/companies/{id}            → manifest, latest profile, attestations, evidence head
GET  /v0.2/companies?level>=3&integrity>=B
POST /v0.2/check                      → { allow | warn | deny, reasons[] }
     body: { counterparty: id, action: MandateAction, amount?: Money,
             require: { min_level, min_integrity, min_assurance } }
```

The same functions are exposed as MCP tools (`zhc_lookup`, `zhc_check`) so any agent can check a counterparty before paying or accepting payment. Payment facilitators MAY call `/check` as part of their risk flow.

## 8. Conformance

| Conformance level | Requirements |
|---|---|
| **Publisher** | Valid manifest at `/.well-known/zhc.json` with accountable human and charter. |
| **Governed** | Publisher, and every money and decision action is evaluated against a mandate before it executes, with outcomes recorded. |
| **Measured** | Governed, plus a hash-chained evidence log, a published head, and a self-score with the reference method. |
| **Attested** | Measured, plus a current attestation from an independent validator. |

## 9. Security considerations

- **Self-reporting fraud.** Agents could under-report human touches. Mitigations: governance-layer recording (§4.3), validator sampling against processor records, published heads, short attestation lifetimes.
- **Mandate bypass.** A compromised runtime could skip `evaluate()`. Mitigation: compile mandates into rail-native limits (§3.4) so the money layer enforces them independently.
- **Key compromise.** Rotate issuer and validator keys through DID documents; attestations reference the key id.
- **Goodhart.** Any measured axis can be gamed. The integrity grade and the requirement that validators sample external sources exist to keep the score honest; the thresholds will be recalibrated as real distributions arrive.

## 10. Versioning

The spec version appears in every object (`zhc: "0.2"`, `v: "0.2"`, `spec: "0.2"`). Threshold changes bump the method version. v0.x is pre-stable: breaking changes are expected and will be documented in each version's change notes.
