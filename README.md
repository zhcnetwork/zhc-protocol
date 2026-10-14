# ZHC Protocol

**The trust and measurement layer for autonomous companies.**

AI agents can now message each other (A2A), use tools (MCP), and pay (x402, MPP, AP2, ACP). None of those standards answer the questions a counterparty asks before doing business with an AI-run company:

- Who is this company, and which human answers for it?
- What is each of its agents allowed to do?
- How autonomous is it really, and can it be trusted?

## Why: from one company to an economy

The goal is not one zero-human company. It is a **zero-human economy**: companies run by AI that find each other, rate each other, buy from, insure and partner with each other, and found new companies, each with one named person who answers for it.

Every working economy rests on a handful of institutions: a company register, contracts and signing authority, accounting, and auditors. Strangers can do business because those institutions let them check each other first. A zero-human economy needs machine-readable counterparts that can be checked in milliseconds. ZHC specifies four of them. Each plays a similar role to the institution it is named after, and none of them is that institution:

| An economy has | ZHC object | What it is | What it is not |
|---|---|---|---|
| A company register | **Manifest** | A file the company publishes about itself | Proof of incorporation |
| Signing authority | **Mandate** | Machine-checkable limits on each agent | A statement of what binds the company in law |
| Books that can be audited | **Evidence** | An operating log sealed with hashes | Financial accounts, or proof that nothing was left out |
| Auditors and ratings | **Attestation** and the ZH profile | A validator's signed recomputation of the profile | An audit opinion or a credit rating |

Banks, dispute forums and insurance are not covered yet. [PROTOCOL §0](spec/v0.2/PROTOCOL.md#0-purpose-the-institutions-of-a-zero-human-economy) has the details.

## The four objects

| | Object | Question | Spec |
|---|---|---|---|
| 1 | **Manifest** (`/.well-known/zhc.json`) | Who is this company? | [PROTOCOL §2](spec/v0.2/PROTOCOL.md#2-manifest) |
| 2 | **Mandate** | What may each agent do? | [PROTOCOL §3](spec/v0.2/PROTOCOL.md#3-mandates) |
| 3 | **Evidence** (hash-chained events) | What actually happened? | [PROTOCOL §4](spec/v0.2/PROTOCOL.md#4-evidence) |
| 4 | **Attestation** | What did an independent validator conclude? | [PROTOCOL §6](spec/v0.2/PROTOCOL.md#6-attestations) |
| | **ZH Maturity Model** | How autonomous, and how trustworthy? | [MODEL](spec/v0.2/MODEL.md) |

A profile looks like this:

```
ZH3·A [O3 D2 F2 R2] N1 S2 attested
```

ZH3 (Business Operator), integrity A. The level is set by the weakest of four axes: operations, decisions, finance and resilience. Network participation (N1) and scope (S2) are reported beside it. An independent validator signed it.

## Repository

```
spec/v0.2/        MODEL.md (maturity model) · PROTOCOL.md (objects, rules, conformance)
schemas/          JSON Schemas: manifest, mandate, event, attestation
examples/         manifests (a reference validator desk, an example validator, a test company),
                  a signed mandate, sample evidence, a score report and an attestation
packages/core/    Reference implementation (TypeScript, zero runtime dependencies)
```

The examples are generated from the test fixtures with published example keys, and `npm test` fails if they drift.

## Reference implementation

```bash
cd packages/core
npm test             # Node ≥ 22.18 runs the TypeScript directly
npm run examples     # regenerate /examples
```

```ts
import { score, formatProfile, evaluateChain, ExposureBook, verifyChain, verifyAttestation, manifestKeyResolver } from "./packages/core/src/index.ts";

const { ok } = verifyChain(events);
const report = score(events, manifest, { asOf: new Date().toISOString(), chainVerified: ok });
formatProfile(report.profile);         // "ZH3·A [O3 D2 F2 R2] N1 S2 measured"
report.profile.limited_by;             // axes blocking the next level

// Authority: evaluate against the agent's mandate and every mandate above it, with shared limits.
const book = new ExposureBook();
book.reserve([agentMandate, parentMandate], { action: "money.refund", amount: { amount: 3000, currency: "USD" }, at }, { id: "refund-1" });
// → { verdict: { decision: "allow" | "require_approval" | "deny", ... }, held }

// Attestations verify only against the issuer's published keys.
verifyAttestation(attestation, { resolveKey: manifestKeyResolver(validatorManifest) });
```

`src/browser.ts` exports the subset that runs in browsers and Workers (hashing and signing through Web Crypto).

## Status

**v0.2.1**, a draft for public comment. This revision fixes problems found in independent reviews of v0.2. Mandate evaluation now fails closed, a company can no longer widen its own authority from its own score, and missing evidence no longer counts as good conduct. See the [changelog](CHANGELOG.md). Objects still carry wire version `0.2`. Thresholds are provisional and will be calibrated against real measured profiles.

## License

Specification and schemas: CC BY 4.0. Code: Apache-2.0.
