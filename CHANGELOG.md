# Changelog

Three numbers are versioned separately (PROTOCOL §10): the **wire version** carried in every object, the **specification revision**, and the **scoring method** carried in every profile. `@zhc/core` follows the specification revision.

## 0.2.1 — 2026-10-13

Specification revision 0.2.1 · scoring method `zhc-score/0.2.1` · `@zhc/core` 0.2.1 · wire version unchanged (`0.2`)

This revision fixes problems found in independent reviews of v0.2. Each confirmed problem is now a regression test (`packages/core/test/review-regressions.test.ts`). Profiles computed under `zhc-score/0.2.0` aren't comparable with new ones: recompute them.

### Authority (mandates)

- **Evaluation fails closed.** `evaluate()` denies with the new code `invalid` when the mandate is malformed, the time is invalid, an amount is negative, fractional or missing on an action that moves money, or the request lacks a field that a constraint in the chosen scope needs (amount, tier, relative change).
- **The most specific scope applies.** A scope for the request's area beats an area-less one. A request for an area-limited action must name its area.
- **Delegated authority is checked link by link, with shared limits.** `evaluateChain()` evaluates the request against every mandate up to the root. `ExposureBook` reserves amounts against every mandate in the chain, so a parent's cap bounds everything spent beneath it. Approvals are re-checked against current mandates and usage when the action executes (PROTOCOL §3.1).
- **Delegation checks provenance.** `isAttenuationOf()` now requires `child.parent` to be the parent's id, the child's issuer to be the parent's subject, and the child's validity to sit inside the parent's. `supersedes` records a replacement, separate from delegation.
- **A company can't raise its own limits.** Progression conditions name their source: `self`, `attestation` or `processor`. A rule with any self-sourced condition, including one on the company's own ZH score, may only narrow authority. A widening it would have made is returned as `refused`, a proposal for the issuer to sign. `attestedFacts()` turns a verified, independent attestation into facts a rule may use.
- **Mandate signatures.** `signMandate()` and `verifyMandate()` (Ed25519 over canonical JSON). Keys are published in the manifest's new `signing_keys`.

### Attestations

- `verifyAttestation()` requires a key resolver. The key carried in an attestation is never used. `manifestKeyResolver()` resolves keys from a manifest.
- Verification enforces issue time not in the future, expiry after issue, validity of at most 90 days, issuer not the subject, profile company equal to the subject.
- `issueAttestation()` refuses a validator under common control with the subject, or one whose fee depends on the outcome. Payloads may carry `kid`, `manifest_sha256` and `independence`.

### Scoring (`zhc-score/0.2.1`)

- `score()` requires `asOf`, rejects events from another company, duplicate ids and invalid timestamps, and orders events by instant rather than by how the timestamp is written. A company's own score is never `attested`.
- **N no longer gates the composite level.** It is reported beside the level, like scope. Profile strings put N outside the brackets: `ZH3·A [O3 D2 F2 R2] N1 S2 measured`. Legacy strings still parse under the gates they were written with.
- **R measures rescues.** Mean time between rescues, over a lookback as long as the claim, so R4 and R5 are reachable. Open incidents (new event `incident.opened`) count as not recovered. With no incidents, R is capped at R2. Human operating contacts, sessions and unattended stretches are reported beside the profile. Levels are renamed "… Without Rescue".
- **O:** O3 needs at least one handled exception, O4 counts every observed area as well as the declared ones, and O5 needs a retained AI change that was evaluated and improved outcomes.
- **D and F:** minimum counts for D3, F1, F2 and F4. F value shares are computed per currency. F5 needs every capital allocation under mandate, with no distribution required. F2 and F4 are renamed "Managed Pricing" and "Capital Allocation".
- **Integrity fails closed.** A and B require every applicable conduct metric to be observed, and at least one to be observed; otherwise the grade is U. Attempts the policy engine blocked are reported as control effectiveness and no longer graded.
- **Level names and sentences match the gates.** ZH5 is now "Chartered Autonomous Company". "Zero-human runtime" is defined as a separate statement about a period (MODEL §9), to be measured from v0.3.
- Profiles carry `method`, and `scope_basis: "declared"`.

### Evidence

- New event `incident.opened`. `incident.resolved` may link to it with `incident`. `process.changed` records `evaluated` and `outcome`.
- Canonical JSON (ZHC-CJSON) is specified, with cross-language test vectors. It matches RFC 8785 on I-JSON input.
- Hashing and signing also run on Web Crypto (browsers and Workers), byte-identical with `node:crypto`.

### Specification text

- §0 says what each object is not, and lists the institutions not yet covered: bank, dispute forum, capital and insurance.
- §7: a ZH level is a preference, not a payment decision. No public registry is claimed. Verifiers restrict what they fetch.
- §8: Governed conformance requires the re-check at execution and a halt control, with defined halt semantics.
- §9 and §10: new security considerations. Wire version, revision and method are versioned separately.

### Schemas and examples

- Schemas (still `0.2`) add `signing_keys`, `supersedes`, `signature`, progression `source`, `incident.opened`, `process.changed` evaluation fields, attestation `kid`, `manifest_sha256`, `independence` and profile `method`. Money amounts must be safe integers with a currency code.
- Examples are generated by `npm run examples` from the test fixtures with published example keys, and `npm test` checks they are current. New: an example validator and a test company manifest. The billing mandate is signed, and its progression rule is attestation-sourced.

### Breaking changes for implementers

`score()` needs `opts.asOf`. `verifyAttestation()` needs `resolveKey`. `applyProgression()` takes `{ self, attestation, processor }` facts and returns `refused`. `limited_by` never contains N. `IntegrityResult` adds `observation` and `control`. R metrics are renamed (`mtbr_hours` replaces the intervention-based figure).

## 0.2.0 — 2026-10-12

First v0.2 release: the ZH Maturity Model with integrity grades and assurance; manifest, mandate, evidence and attestation; JSON Schemas; the reference implementation. It includes the fixes found while building the reference desk (hard limits before approval bands, deny codes, attenuation checks, `money.collect`, `validator_keys`, `mandate.changed`). That commit's message called them "Core v0.2.1", but they shipped as `@zhc/core` 0.2.0 with method `zhc-score/0.2.0`.
