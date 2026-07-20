# Upstream contribution plan: TRUST as inspectable knowledge

The goal of this branch is to propose improvements to the original
Computational Review Template, not to turn one fork into a permanently separate
product. The contribution unit should therefore be a small capability with an
independent test surface and a clear scientific-authority boundary.

## Product principle

TRUST is a computational assessment of versioned evidence, not a popularity
score. Every visible number must resolve to the exact prose concerned, the
eligible source passages, the component rules, and the frozen validator output.
Human comments and automated update proposals add context around that result;
they do not enter its arithmetic.

The complete iteration loop is:

`new evidence or comment -> affected claim -> advisory proposal -> themed PR -> independent validation -> human approval -> immutable version and diff`

## Suggested upstream series

| Theme | Capability | Main review question | Dependency |
| --- | --- | --- | --- |
| 1. Evidence-attributable TRUST | Canonical claims, atom/passage attribution, deterministic rubric and score basis | Can a reader reconstruct why each component received its value? | none |
| 2. Exact TRUST display | Stable claim anchors and hover/focus highlighting of only the scored prose | Does every score interaction identify exactly the text evaluated? | theme 1 |
| 3. Human annotation layer | Version/manifest-bound accepted comments with support/dispute/qualify stance and orphan handling | Can human judgment be inspected without being mistaken for score input? | themes 1–2 |
| 4. Advisory evidence automation | Integrity/new-work radar plus deterministic, proposal-only backlog planner | Can automation shorten update latency without silently changing knowledge? | theme 1 |
| 5. Verifiable release deltas | Claim/evidence/TRUST/human-decision diff and RO-Crate 1.3 evidence capsule | Can a reader reproduce what changed and the computation behind evidence? | themes 1 and 3 |
| 6. Federated archive adapter | Durable versioned claim URIs, provenance graphs, and content-addressed artifact index | Can independent archives index and link claims without scraping HTML? | theme 5 |

The GitHub Actions runtime modernization is an infrastructure-only proposal and
should remain separate from these scientific features.

## Acceptance criteria shared by every theme

- no autonomous or UI code writes an overall or component TRUST score;
- the existing independent TRUST validator remains the sole score producer;
- human submissions and external metadata are treated as untrusted data;
- exact selectors fail closed on missing or ambiguous prose;
- generated artifacts are deterministic from frozen inputs and carry digests;
- changed evidence produces a proposed revision, never a silent publication;
- tests cover valid, invalid, stale-anchor, malicious-input, and mutation-boundary
  cases; and
- source-specific example content remains replaceable so the feature works in a
  newly generated review.

## What belongs outside the template

The template can provide schemas, static UI, advisory workers, artifact
builders, and archive adapters. A production archive still needs an identified
operator, editorial board, moderation and appeals process, restricted identity
service, retention policy, object-store controls, identifier provider, and
legal/privacy review. Those operational services should not be smuggled into a
template PR under the label of automation.

## Submission workflow

Before proposing a theme upstream:

1. update the branch onto the latest upstream `main`;
2. remove fork-specific URLs, release identifiers, and claims from core logic;
3. keep example records only under example/fixture paths;
4. run TRUST, community-contract, widget, artifact, and MyST build gates;
5. attach the relevant generated diff and test summary to the proposal; and
6. open a draft PR explaining the scientific boundary before requesting API or
   visual-design review.

This ordering lets upstream maintainers accept evidence and display
improvements incrementally, even if they do not yet want to operate a dedicated
computational-review archive.
