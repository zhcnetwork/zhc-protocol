# ZHC Protocol

**The trust and measurement layer for autonomous companies.**

AI agents can now message each other (A2A), use tools (MCP), and pay (x402, MPP, AP2, ACP). None of those standards answer the questions a counterparty asks before doing business with an AI-run company:

- Who is this company, and which human answers for it?
- What is each of its agents allowed to do?
- How autonomous is it really, and can it be trusted?

## Why: from one company to an economy

The goal is not one zero-human company. It is a **zero-human economy**: companies run by AI that find each other, rate each other, buy from, insure and partner with each other, and found new companies, each with one named person who answers for it.

Every working economy rests on a handful of institutions: a company register, contracts and signing authority, accounting, and auditors. Strangers can do business because those institutions let them check each other first. A zero-human economy needs the same institutions in a form machines can read and check in milliseconds. That is all ZHC is:

| An economy needs | Every company has | ZHC object |
|---|---|---|
| A company register | Articles of incorporation | **Manifest** |
| Contracts and delegated authority | A signing-authority matrix | **Mandate** |
| Accounting | Books that can be audited | **Evidence** |
| Auditors and credit ratings | An auditor's opinion | **Attestation** and the ZH profile |

## The four objects

ZHC answers those questions with four objects and one model:

| | Object | Question | Spec |
|---|---|---|---|
| 1 | **Manifest** (`/.well-known/zhc.json`) | Who is this company? | [PROTOCOL §2](spec/v0.2/PROTOCOL.md#2-manifest) |
| 2 | **Mandate** | What may each agent do? | [PROTOCOL §3](spec/v0.2/PROTOCOL.md#3-mandates) |
| 3 | **Evidence** (hash-chained events) | What actually happened? | [PROTOCOL §4](spec/v0.2/PROTOCOL.md#4-evidence) |
| 4 | **Attestation** | What did an independent validator conclude? | [PROTOCOL §6](spec/v0.2/PROTOCOL.md#6-attestations) |
| | **ZH Maturity Model** | How autonomous, and how trustworthy? | [MODEL](spec/v0.2/MODEL.md) |

A profile looks like this:

```
ZH3·A [O3 D2 F2 R2 N1] S2 attested
```

Business Operator, integrity A, with five autonomy axes, scope class 2, signed by an independent validator.

## Repository

```
spec/v0.2/        MODEL.md (maturity model) · PROTOCOL.md (objects, rules, conformance)
schemas/          JSON Schemas: manifest, mandate, event, attestation
examples/         ZH Rating Desk manifest, a billing mandate, sample evidence, attestation, score report
packages/core/    Reference implementation (TypeScript, zero runtime dependencies)
```

## Reference implementation

```bash
cd packages/core
node --test test/*.test.ts      # Node ≥ 22.18 runs the TypeScript directly
```

```ts
import { score, formatProfile, evaluate, verifyChain } from "./packages/core/src/index.ts";

const { ok } = verifyChain(events);
const report = score(events, manifest, { chainVerified: ok });
formatProfile(report.profile);         // "ZH3·A [O3 D2 F2 R2 N1] S2 measured"
report.profile.limited_by;             // axes blocking the next level
evaluate(mandate, { action: "money.refund", amount: { amount: 3000, currency: "USD" }, at });
// → { decision: "allow" | "require_approval" | "deny", ... }
```

`src/browser.ts` exports the browser-safe subset (no `node:crypto`).

## Status

v0.2 is a **draft for public comment**. Thresholds are provisional and will be calibrated against real measured profiles.

## License

Specification and schemas: CC BY 4.0. Code: Apache-2.0.
