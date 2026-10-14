# ZHC Protocol — v0.2.1

**The trust and measurement layer for autonomous companies.**

**Status:** Draft for public comment · **Date:** October 2026 · **Wire version:** `0.2` (unchanged; see §10)
**Companion:** [MODEL.md](MODEL.md) (the ZH Maturity Model) · **Schemas:** [`/schemas`](../../schemas) · **Reference implementation:** [`packages/core`](../../packages/core) (`@zhc/core` 0.2.1)

The key words MUST, SHOULD and MAY are used as in RFC 2119.

---

## 0. Purpose: the institutions of a zero-human economy

A zero-human company is a company, not a piece of automation. It has a purpose, holds money, chooses who to do business with, makes judgment calls, and answers for them through one named person. The aim of this protocol is an economy of such companies: companies that discover, rate, trade with, insure and found each other.

Economies run on shared institutions: a register of companies, contracts and signing authority, accounting, and independent audit. ZHC specifies the minimum machine-readable form of some of them, so that one autonomous company can check another before money moves. Each ZHC object borrows a corporate name because it plays a similar role. None of them is the legal institution it is named after:

| Institution | ZHC object | What it is | What it is not |
|---|---|---|---|
| Company register | Manifest (§2) | A file the company publishes about itself | Evidence that the company is incorporated. The legal fields are claims until someone checks them against a register (for example a GLEIF vLEI). |
| Signing authority | Mandate (§3) | Machine-checkable limits on what each agent may do | A statement of what binds the company in law. That depends on the jurisdiction and the company's contracts. |
| The books | Evidence (§4) | An operating log, sealed with hashes | Financial accounts. The seal shows the log wasn't edited after a point you hold, not that it is complete or true. |
| Audit opinion | Attestation and ZH profile (§5–6) | A validator's signed recomputation of the profile from the evidence | An audit under an audit framework, or a credit rating. |
| A way to check a stranger | Lookup and counterparty checks (§7) | A draft interface for checking a company before trading | A decision to pay. See §7. |
| **Not in v0.2.1** | — | Bank or custodian, dispute forum, capital and insurance | A company still needs all three. v0.3 adds a capacity statement: what binds the company, what covers its obligations, and where disputes go. |

## 1. Scope: what ZHC is and is not

By late 2026 the agent ecosystem has solid standards for most of what v0.1 proposed to build:

| Need | Use this; ZHC does not reinvent it |
|---|---|
| Agent-to-agent messaging | **A2A** (Agentic AI Foundation, Linux Foundation) with signed Agent Cards |
| Tools and data access | **MCP** (Agentic AI Foundation) |
| Agent payments | **x402**, **MPP** (Stripe/Tempo), **AP2** (FIDO), **ACP** (OpenAI/Stripe) |
| Agent identity and reputation anchors | **ERC-8004** registries, W3C DIDs and Verifiable Credentials |
| Organisation identity | **GLEIF vLEI** and official organisational role credentials |
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
| `id` | MUST | Stable company identifier. SHOULD be a `did:web` matching the domain. Every evidence event and every profile names the company by this id. |
| `name`, `url` | MUST / SHOULD | |
| `legal` | MUST | Legal entity name, jurisdiction (ISO 3166-2 style, e.g. `US-WY`), form, registration id. Self-declared (§0). |
| `accountable_human` | MUST | The natural person who holds the charter, legal accountability and the emergency brake. Every ZHC has one, at every level. `contact` SHOULD be a role address, not a personal one. |
| `charter` | MUST | Mission; `reserved_to_human` (charter-tier decisions); `prohibited` actions. MAY link to a full charter document, which SHOULD name a successor, or a procedure, for when the accountable human can't act. |
| `domains` | MUST | Business areas the company operates (used by the O axis, together with every area that appears in its evidence). |
| `scope` | SHOULD | Scope class, or counts of products, markets and business models. Declared, not checked against evidence (MODEL §6). |
| `agents[]` | MUST | Each agent: `id`, `role`, `domain`; SHOULD link its A2A `agent_card`; MAY link an `erc8004` identity. |
| `signing_keys[]` | SHOULD | Ed25519 public keys (`id`, `holder`, `alg`, `public_key_pem`) that sign the company's mandates (§3.5). `holder` is the issuer id used in mandates, such as `human:owner` or an agent id that delegates. |
| `validator_keys[]` | MUST if it issues attestations | Ed25519 public keys (`id`, `alg`, `public_key_pem`) that verifiers resolve attestation signatures against (§6.2). |
| `services[]` | SHOULD | Services offered to others: endpoint, protocol (`a2a` / `mcp` / `http`), price, accepted rails. Used by integrity applicability (MODEL §5) and N2. |
| `mandates_uri` | SHOULD | Where mandates (or their public summaries) are published. |
| `evidence` | SHOULD | Where the evidence head (and, if public, the log) is published. |
| `parent` | MAY | Parent ZHC id, if founded by another ZHC (N5). |
| `profile` | MAY | Claimed profile string and links to current attestations. |

The manifest SHOULD be signed (JWS, detached) with a key listed in the company's DID document. A manifest can only be as trustworthy as its domain: keys published in it are trusted because the verifier trusts that the domain belongs to the company.

**Keys have one purpose each.** A verifier resolves mandate signatures only from `signing_keys` (by holder and key id) and attestation signatures only from `validator_keys`. A key listed for one purpose MUST NOT verify the other: an attestation key must never authorize spending, and a mandate key must never vouch for another company (`mandateKeyResolver()`, `validatorKeyResolver()`).

**A2A binding.** Each Agent Card listed in a manifest SHOULD include the extension `{"zhc": {"company": "<manifest id>", "mandate": "<mandate id>"}}` so a peer that meets an agent can find the company and its rules.

## 3. Mandates

A mandate is a signed grant of business authority from an **issuer** (the accountable human, or an agent delegating part of its own authority) to a **subject** agent. Schema: [`schemas/mandate.schema.json`](../../schemas/mandate.schema.json).

A mandate has:
- **identity and lineage:** `id`; `parent`, the mandate it was delegated from (§3.2); `supersedes`, an earlier version of the same grant that it replaces;
- **validity:** `issued_at`, `expires_at`, `revoked`;
- **scopes:** each grants one action (`money.spend`, `money.collect`, `money.refund`, `money.vendor_payment`, `money.reserve`, `pricing.change`, `decision.make`, `service.deliver`, `network.buy`, `network.sell`, `process.change`, `attestation.issue`), optionally limited to a domain, with:
  - `limits.per_action | per_day | per_month`: hard caps;
  - `require_approval_over`: an approval band below the hard cap;
  - `tier_max`: the highest decision tier the agent may decide alone;
  - `max_relative_change`: for price changes;
  - `counterparty`: the minimum ZH level, integrity grade and assurance the buyer requires of a counterparty (§7 explains why a level alone isn't a payment decision);
- **escalation:** who approves, the timeout, and what happens on timeout;
- **progression:** rules that change scopes when conditions hold; only facts from outside the company can widen them (§3.3);
- **bindings:** optional compiled forms for payment rails (§3.4);
- **signature:** the issuer's signature (§3.5).

Money is always an integer amount in minor units (cents for USD) with a currency code.

### 3.1 Evaluation

An implementation MUST evaluate every governed action against the subject's mandate **before** the action executes, and MUST record the outcome as evidence. The reference `evaluate()` returns one of:

- `allow`;
- `require_approval`: escalate, and record the human's decision as a `decision.made` event with `outcome`;
- `deny`, with a reason code: `invalid`, `revoked`, `validity`, `scope`, `charter`, `change`, `counterparty` or `limit`.

Denials are recorded as `conduct.mandate_blocked`, except `counterparty` denials. Those are screening outcomes, not conduct by the agent, and MUST NOT be recorded as `conduct.mandate_blocked`. Agents SHOULD screen counterparties with a lookup (§7) before requesting the action.

**Evaluation fails closed.** Anything that can't be checked is denied. The rules apply in this order:

1. **The mandate must be well-formed:** valid times, with expiry after issue; at least one scope; no two scopes for the same action and area; valid money values, including rail bindings; a non-negative relative-change limit; a `tier_max` below charter; valid counterparty requirements; a well-formed escalation; and progression rules that don't change a scope's action or area. Otherwise: `invalid`.
2. **The request must be well-formed:** a valid time. Any amount is a non-negative integer with a currency code. Actions that move money (`money.*`, `network.buy`, `network.sell`) carry an amount. `decision.make` carries a tier. `pricing.change` carries the relative change. A counterparty profile, if given, has a level from 0 to 5, a grade from A to D or U, and an assurance level. Otherwise: `invalid`.
3. A revoked mandate denies everything (`revoked`); so does a request outside the validity window (`validity`).
4. **The most specific scope applies.** A scope for the request's area beats a scope with no area. If the action is limited by area anywhere in the mandate, the request MUST name its area (`invalid`). No matching scope: `scope`.
5. Charter-tier decisions are always denied to agents (`charter`).
6. **Every constraint in the chosen scope must be checkable from the request.** A scope with money limits needs an amount, `tier_max` needs a tier, and `max_relative_change` needs the change. Otherwise: `invalid`.
7. **Hard limits**, which no human approval can override:
   - a price change beyond `max_relative_change` (`change`);
   - a counterparty below the scope's minimum, or no counterparty check supplied when the scope asks for one (`counterparty`);
   - an amount over `per_action`, or one that would exceed `per_day` or `per_month` (`limit`). A limit in one currency never authorizes an amount in another.
8. **Approval bands:** a decision above `tier_max`, or an amount over `require_approval_over`, requires approval.
9. Otherwise the action is allowed.

**Delegated authority is evaluated link by link.** When the subject's mandate was delegated, the request MUST be evaluated against every mandate in the chain up to the root (`evaluateChain()`). The chain MUST be complete: it ends at a mandate with no `parent`, so leaving out an ancestor denies (`invalid`). A revoked mandate anywhere in the chain denies (`revoked`). Any other denial denies. Any approval band requires approval. Every link MUST pass §3.2.

**Limits are shared down the chain.** An amount spent under a delegated mandate counts against that mandate and every ancestor, so a parent's daily cap bounds the total spent under it and all its descendants. The reference `ExposureBook` reserves an amount before acting, commits it once the effect is confirmed, and releases it if the action didn't happen.

**Re-check at the moment of effect.** Authority is checked when the action takes effect, not only when it is queued. An implementation MUST evaluate the action again, against current mandates and current usage, immediately before it executes. A human approval authorizes one exact action. It satisfies an approval band, but never a hard limit, a revocation or an expiry: if the mandate was revoked or the limit used up while the approval was pending, the action is denied.

**Where evaluation runs.** Evaluation SHOULD run outside the agent being governed: in a policy service, an approval queue, or a credential broker that holds the keys the action needs. An agent that holds credentials to act directly can skip the check. Rail limits (§3.4) back this up for money; other actions have no rail, so for them, keeping credentials outside the agent is the control.

### 3.2 Delegation

An agent MAY issue a mandate to another agent. A delegated mandate MUST be a genuine **attenuation** of its parent (`isAttenuationOf()`):
- its `parent` is the parent's `id`, and its `issuer` is the parent's `subject`: only the agent that holds authority can delegate it;
- the parent is not revoked;
- it starts no earlier and ends no later than the parent;
- it grants no action the parent lacks;
- it has no higher limit, no higher approval threshold, no higher tier and no larger relative-change limit. The effective approval threshold is the scope's own band, or its per-action cap if it has no band;
- it has no weaker counterparty requirement;
- its escalation goes to the parent's approver, and is no more permissive on timeout: it doesn't allow where the parent denies, or allow sooner;
- its rail bindings are no larger than the parent's.

Each child scope is compared with the parent scope that governs the same requests: the parent's scope for the same area if there is one, otherwise its area-less scope. A child scope with no area applies in every area, so it must also be no wider than each of the parent's area scopes it would cover, unless the child has its own scope for that area.

Revoking a mandate cuts off everything delegated from it: a chain with a revoked link fails at every evaluation. The root of a chain SHOULD be a mandate issued by the accountable human.

A mandate that `supersedes` another replaces it. It isn't delegated from it. The issuer SHOULD revoke the earlier version at the same moment and record both as `mandate.changed` events.

### 3.3 Progressive autonomy

`progression` rules change a scope when conditions hold, for example "after an independent attestation at integrity A, raise the refund limit". A rule has one condition or a list that must all hold. It targets one scope by action and area exactly: a rule with no area targets the area-less scope. A rule MUST NOT change a scope's action or area, and an implementation MUST refuse a change that would leave the mandate malformed.

**Every condition names its source:**

| `source` | Facts | May widen authority? |
|---|---|---|
| `self` (default) | Anything the company computes or records itself, **including its own ZH score** | **No.** Only narrow. |
| `attestation` | Values from an attestation about this company, verified as in §6.2, from an independent validator, and current at the time the rule is applied | Yes |
| `processor` | Figures obtained by the governance layer directly from a payment processor or custodian, such as settled volume or chargebacks | Yes |

A rule MUST NOT widen authority if any of its conditions is self-sourced. A company must not be able to raise its own limits by writing its own evidence. When a self-sourced rule would widen a scope, the implementation MUST NOT apply it; it MAY present the widened scope to the issuer as a proposal to sign (`applyProgression()` returns these as `refused`).

The result of any rule that fires is a candidate mandate that the issuer signs. The issuer MAY pre-authorize automatic signing for rules whose conditions are all `attestation` or `processor`. Every change to a mandate is recorded as a `mandate.changed` event.

This is how "the human's surface area shrinks as trust grows" becomes an auditable mechanism rather than a promise: trust grows from facts the company doesn't author.

### 3.4 Payment rail bindings

A mandate MAY carry compiled forms of its limits for payment rails (`bindings`), so the rail enforces the same limit even if the agent runtime is compromised. v0.2.1 doesn't specify the compilation. An implementation that uses bindings MUST keep each one no wider than the scope it implements, and delegated bindings may not exceed the parent's (§3.2). The intended mappings:

| Rail | Mandate maps to |
|---|---|
| MPP | session spending limit; Shared Payment Token scope and expiry |
| x402 | facilitator-side `max_amount` per request and per period |
| AP2 | intent mandate (human-signed), cart mandates per purchase |
| ACP | delegated payment token constraints |
| Cards / Stripe | issuing spending controls, Radar rules |

Rail limits cover money only. Decisions, deliveries, process changes and attestations have no rail.

### 3.5 Signatures

A mandate SHOULD be signed by its issuer:

- `signature` is `{ "alg": "Ed25519", "kid": "<key id>", "sig": "<base64url>" }`;
- `sig` covers the canonical JSON (§4.2) of the mandate **without** its `signature` member;
- the verifier resolves the issuer's public key by `issuer` and `kid` from the company manifest's `signing_keys` (where `holder` equals the issuer), or from the issuer's DID document.

A verifier MUST NOT use a key supplied alongside the mandate. A counterparty MUST NOT treat an unsigned mandate, or one whose signature doesn't verify, as evidence of authority. A company MAY evaluate unsigned mandates internally.

## 4. Evidence

A ZHC that wants a measured or attested profile MUST keep an append-only evidence log of v0.2 events. Schema: [`schemas/event.schema.json`](../../schemas/event.schema.json).

Every event's `company` MUST be the manifest `id`, and event `id`s MUST be unique within the log.

### 4.1 Event types

| Type | Records | Feeds |
|---|---|---|
| `task.completed` | actor, human touch (`none` / `batch_review` / `item_review` / `approval`), exceptions, cross-domain routing | O |
| `decision.made` | tier, origin, decider, approval mode, veto, and for escalations the human's `outcome` | D |
| `money.moved` | direction, category, amount, `authorized_by` (`mandate` / `human_approval` / `human`), rail | F |
| `human.intervention` | kind: `fix`, `override` or `kill_switch` (rescues), or `routine` (scheduled review, not a rescue) | R |
| `incident.opened` | severity, detection, before-impact. Open until a linked `incident.resolved`; open incidents count as not recovered | R |
| `incident.resolved` | the opened `incident` it closes (if one was recorded), severity, detection, resolver, before-impact, fix retained, recurrence | R |
| `process.changed` | initiator, change type, retained; `evaluated` against comparable work, and the measured `outcome` | O5 |
| `network.transaction` / `network.collaboration` / `network.contribution` / `company.spawned` | dealings with other ZHCs (self-reported in v0.2.1) | N |
| `interaction` | channel, AI disclosed | Integrity |
| `mandate.changed` | mandate issued, widened, narrowed or revoked, and whether by progression or by the issuer | Audit trail |
| `conduct.complaint` / `conduct.refund_request` / `conduct.mandate_breach` / `conduct.deception` | conduct | Integrity |
| `conduct.mandate_blocked` | an action the policy engine stopped | Control effectiveness (reported, not graded) |

### 4.2 Integrity of the log

**Hashing.** Each event MUST carry `prev`, the previous event's `hash` (omitted on the first event), and `hash`: the lowercase hex SHA-256 of the canonical JSON of the event without its `hash` member. The latest hash is the **evidence head**.

**Canonical JSON (ZHC-CJSON).** Used for every hash and signature in this protocol:
- object members sorted by key, comparing UTF-16 code units, recursively;
- no insignificant whitespace;
- members whose value is undefined are omitted; an undefined array element is written as `null`;
- strings and numbers serialized as ECMAScript `JSON.stringify` does;
- non-finite numbers rejected.

On I-JSON input this produces the same bytes as RFC 8785 (JCS). Test vectors: [`packages/core/test/vectors/canonical.json`](../../packages/core/test/vectors/canonical.json). The reference implementation computes identical hashes and signatures with `node:crypto` and with Web Crypto (browsers and Workers).

**What a valid chain proves, and what it doesn't.** A chain that verifies shows that the events are internally consistent and haven't been edited since a head you already hold. It does not show that the events happened, that none were left out, or that the timestamps are honest. A company can rewrite and re-seal its entire log; only a head published earlier, or held by someone else, exposes that. So:
- a company SHOULD publish its head at least daily (in its manifest's `evidence.uri`), and MAY anchor it on a public chain;
- validators SHOULD keep every head they have seen, and treat a log that doesn't extend a head they hold as rewritten.

### 4.3 Who records what

Evidence about humans (approvals, interventions) and conduct (complaints, deception findings) MUST NOT be recorded only by the agents being measured. Implementations SHOULD record them at the governance layer (policy engine, approval queue, support inbox), and validators SHOULD sample them against external sources (payment processor records, customer surveys, complaint channels). v0.3 will mark each event's origin and require external origin for the events that move a measured score.

### 4.4 Privacy

Evidence logs can contain commercial data. A company MAY keep its log private and share it only with a validator, publishing only the head and the attestation. Events SHOULD carry no personal data; use pseudonymous ids.

### 4.5 OpenTelemetry mapping

Implementations MAY emit evidence as OTel spans or logs with attributes `zhc.event.type`, `zhc.company`, `zhc.agent`, `zhc.domain`, `zhc.touch`, `zhc.tier`, `zhc.authorized_by`, alongside the `gen_ai.*` conventions, and derive the hash-chained log in a collector.

## 5. Scoring

The score is a pure function, `score(events, manifest, { asOf, windowDays?, chainVerified? }) → ScoreReport`, specified by [MODEL.md](MODEL.md) and implemented in `packages/core/src/score.ts`. A score report includes the profile, per-axis notes (✓/✗ for each rung, up to the first that fails), integrity metrics with their observation status, control effectiveness, raw metrics, and `limited_by`.

- **`asOf` is required.** A profile is always "as of" a moment the scorer chose. An old log must not pass for a current one.
- **Identity is bound.** Every event MUST belong to the manifest's company. A scorer MUST reject input with an event from another company, a duplicate event id or an invalid timestamp.
- **Reproducible.** Anyone holding the same events, manifest, `asOf`, window and chain verification MUST get the same profile with the same method. The profile carries the method that produced it (`method: "zhc-score/0.2.1"`), and validators MUST state it.
- **The chain is verified by the caller.** `score()` doesn't hash; it trusts `chainVerified`. Only a caller that verified the chain (§4.2) may pass it.
- **A self-score is at most `measured`.** Only a validator's attestation makes a profile `attested` (§6).

## 6. Attestations

Schema: [`schemas/attestation.schema.json`](../../schemas/attestation.schema.json).

### 6.1 Issuing

A validator MAY issue an attestation after it has:
1. verified the hash chain, and checked that it extends any head the validator already holds;
2. checked that every event belongs to the subject;
3. sampled human and conduct evidence against external sources;
4. re-run the scorer with the stated method.

Rules:
- Only `measured` profiles may be attested.
- **Independence.** A validator MUST NOT attest its own company, or a company under common control with it. Its fee MUST NOT depend on the profile it issues. It SHOULD state its relationship to the subject in `independence`, including who pays for the attestation.
- The release of an attestation SHOULD be approved by an agent or person other than the one that computed the profile.
- The payload binds issuer, subject, profile (with method), evidence head (the head of the log the validator verified), event count and window, issue time and expiry (at most 90 days). It SHOULD also carry the key id (`kid`), the manifest's hash (`manifest_sha256`) and `independence`.
- Signature: Ed25519 over the canonical JSON (§4.2) of the payload, base64url.
- The attestation MAY be re-wrapped as a W3C Verifiable Credential, and/or recorded in an ERC-8004 Validation Registry (`requestHash` = evidence head, response = profile id).

### 6.2 Verifying

A verifier MUST:
- resolve the issuer's public key by `issuer` and `kid` from the issuer's manifest `validator_keys`, or its DID document, fetched from a source the verifier trusts. A key carried inside the attestation is a hint and MUST NOT be used to verify it;
- check that the issuer is not the subject, that the profile's company is the subject, and that the profile is marked `attested`;
- check the signature;
- check the validator's statement of independence, if present: no common control, and a fee that doesn't depend on the outcome;
- check the times: `issued_at` is not in the future (allowing a few minutes of clock skew for that comparison only), `expires_at` is after `issued_at`, the validity is at most 90 days, and `now < expires_at`.

A verifier SHOULD also check that the method is one it understands, that the evidence head matches one it holds or the subject published, and that `manifest_sha256` matches the manifest it is checking. When it holds the events, it SHOULD recompute the profile.

**What an attestation establishes.** That a validator recomputed the profile from the evidence up to a stated head, with a stated method, after the checks in §6.1. It does not establish that the evidence was complete. It is not an audit opinion and not a credit rating. v0.3 will add typed claims, so each attestation states exactly which checks were performed and which external records were sampled.

## 7. Lookup and counterparty checks

A ZHC registry exposes the interface below. It is a draft: no public registry is operated yet, and anyone may run one.

```
GET  /v0.2/companies/{id}            → manifest, latest profile, attestations, evidence head
GET  /v0.2/companies?level>=3&integrity>=B
POST /v0.2/check                      → { allow | warn | deny, reasons[] }
     body: { counterparty: id, action: MandateAction, amount?: Money,
             require: { min_level, min_integrity, min_assurance } }
```

A registry MAY expose the same functions as MCP tools (`zhc_lookup`, `zhc_check`), so an agent can check a counterparty before paying or accepting payment.

**A ZH level is not a payment decision.** A profile describes how a company operates, not whether it can deliver, pay or make good on a loss. A highly autonomous company with no capital or insurance can be a worse counterparty than a staffed one. A buyer MAY require a minimum level in its mandates as a matter of policy, and evaluation enforces it like any other limit (§3.1). But a counterparty SHOULD decide whether to pay on the legal entity, the authority behind the agent (a signed mandate, §3.5), and what covers the obligation. Integrity and assurance minimums are the safety-relevant parts of a counterparty requirement.

**Fetching safely.** Manifests and evidence are fetched from addresses chosen by the company being checked. A verifier or registry SHOULD restrict every fetch, including evidence URLs named inside a manifest, to the company's own domain or an allowlist; SHOULD refuse private and loopback addresses; and SHOULD apply a size cap and a timeout.

## 8. Conformance

| Conformance level | Requirements |
|---|---|
| **Publisher** | Valid manifest at `/.well-known/zhc.json` with accountable human and charter. |
| **Governed** | Publisher, plus: every money and decision action is evaluated against a mandate before it executes, and again at the moment of effect (§3.1), with outcomes recorded; a halt control (below). Conduct checks, such as releasing a report or approving a refund, SHOULD be made by an agent other than the one that performed the action. |
| **Measured** | Governed, plus a hash-chained evidence log, a published head, and a self-score with the reference method. |
| **Attested** | Measured, plus a current attestation from an independent validator (§6). |

**Halt.** A Governed company MUST have a halt control that the accountable human can use at any time to stop every agent:
- From the moment of the halt, every governed evaluation, including the re-check at the moment of effect, MUST deny. Revoking every root mandate (§3.2) is one way to do this.
- The halt MUST be recorded as a `human.intervention` with `kind: "kill_switch"`.
- Amounts reserved but not yet in effect SHOULD be released.
- A halt doesn't undo actions already in effect, such as a payment sent or a delivery under way. The company SHOULD report its residual exposure (obligations accepted but not fulfilled, refunds owed) and settle it under the accountable human's direction.
- Only the accountable human resumes operation, and the resumption SHOULD be recorded as a charter-tier `decision.made` event.

v0.3 will make scheduled halt drills part of Governed conformance.

## 9. Security considerations

- **Self-reporting fraud.** Agents could under-report human touches or leave events out. Mitigations: governance-layer recording (§4.3), validator sampling against processor records, published heads (§4.2), short attestation lifetimes. A measured profile is no stronger than the company's own log (MODEL §7).
- **Self-raised authority.** A company that could widen its own mandates from its own score would control its own limits. Self-sourced progression can only narrow (§3.3).
- **Mandate bypass.** A compromised runtime could skip `evaluate()`. Mitigations: evaluation outside the agent, credentials held by a broker, rail-native limits (§3.1, §3.4).
- **Time of check versus time of use.** An approval queued before a revocation must not release after it. Re-check at the moment of effect (§3.1).
- **Limit splitting.** Delegating to several sub-agents must not multiply a cap. Usage is shared down the chain (§3.1).
- **Forged authority.** Verifiers resolve keys from the issuer's manifest or DID document, never from the object being verified, and never with a key published for another purpose (§2, §3.5, §6.2). Rotate keys by publishing new ones under new key ids and removing old ones; objects name the key id they were signed with.
- **Truncated chains.** A delegated agent that presents only its own mandate would escape its parent's revocation and limits. Chains must reach their root (§3.1).
- **Server-side request forgery.** A manifest can point a verifier at any address. Restrict fetches (§7).
- **Goodhart.** Any measured axis can be gamed. The integrity grade, the observation rules that stop missing evidence from counting as good conduct (MODEL §5), and validator sampling exist to keep the score honest. Thresholds are provisional and will be recalibrated as real distributions arrive.
- **The accountable human is self-declared.** In v0.2.1 nothing checks that the named person exists, consented, or can still act. A counterparty that relies on the person SHOULD verify the role out of band, for example with a vLEI official organisational role credential.

## 10. Versioning

Three version numbers are in play:

| Version | Value | Changes when |
|---|---|---|
| **Wire version** | `"0.2"`, carried in every object (`zhc`, `v`, `spec`) | The meaning of an existing field changes, or a field becomes required. |
| **Specification revision** | `0.2.1` (this text) | Rules, requirements or optional fields change. A patch revision keeps the wire version, so v0.2 objects stay readable. |
| **Scoring method** | `zhc-score/0.2.1`, carried in every profile and attestation | Any threshold or scoring rule changes. Profiles from different methods aren't comparable. |

Profile strings written under v0.2, with N inside the brackets (`ZH3·A [O3 D2 F3 R2 N4] S3`), still parse, and are checked against the v0.2 gates they were written with. v0.x is pre-stable: breaking changes are expected and documented in each revision's change notes.

### Changes in v0.2.1

| Section | Change |
|---|---|
| §0 | Each corporate analogy now says what the object is not. Bank, dispute forum and capital are listed as missing. |
| §2 | `signing_keys`; mandate keys and validator keys have one purpose each. The charter SHOULD name a successor. Scope is declared, not checked. |
| §3.1 | Evaluation fails closed, including malformed counterparty checks; most specific scope; delegated chains evaluated link by link to their root, with shared limits; a revoked ancestor denies; re-check at the moment of effect; evaluation outside the agent. New deny code `invalid`. |
| §3.2 | Delegation checks provenance (parent id, issuer, validity), escalation and rail bindings as well as narrowing, against the parent's most specific scope. `supersedes` is separate from delegation. |
| §3.3 | Progression conditions name their source. Self-sourced facts, including a company's own score, can only narrow authority. Rules can't change a scope's action or area; attestation facts must be current. |
| §3.5 | Mandate signatures. |
| §4 | `incident.opened`; `process.changed` records evaluation and outcome. ZHC-CJSON defined with test vectors. The text says what a valid chain does and doesn't prove. |
| §5 | `asOf` required; events must belong to the scored company; profiles carry their method; the caller verifies the chain. |
| §6 | Independence rules, checked on verification; trusted key resolution and exact time checks; what an attestation establishes. |
| §7 | A ZH level isn't a payment decision; safe fetching; no claim of a live registry. |
| §8 | Governed requires the re-check at execution and a halt control, with defined halt semantics. |
| §10 | Wire version, specification revision and scoring method are versioned separately. |
