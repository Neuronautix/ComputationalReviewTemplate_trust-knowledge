# Autonomous agents for living TRUST reviews

The repository uses autonomous workers to reduce review-maintenance latency,
but it does not delegate scientific authority. Automation ends at a typed,
auditable proposal. A human editor decides whether evidence is admitted and
whether a themed pull request may merge; the independent TRUST validator remains
the only component that computes scores from accepted, versioned inputs.

## Separation of duties

| Worker | Autonomous output | Human or independent gate |
| --- | --- | --- |
| Evidence scout | Candidate works and integrity alerts mapped to claim IDs | Editor admits evidence; TRUST validator recomputes later |
| Annotation mapper | Exact-selector resolution, proposed remaps, orphan reports | Editor confirms ambiguous or moved targets |
| Release artifact builder | Version deltas, evidence capsules, federated exports | Validator checks reproducibility; editor approves release |
| Revision planner | Dependency-ordered, themed backlog | Maintainer chooses scope and authorizes branches/PRs |
| Independent validator | Pass/fail reports without modifying the candidate | Maintainer resolves failures; editor approves release |

The machine-readable authority policy is
[`automation/review-agents.json`](../automation/review-agents.json). Submission
or paper text is untrusted data: agents may quote and classify it, but never
interpret it as an instruction.

## Deterministic backlog planning

`scripts/plan-review-backlog.mjs` groups validated improvement proposals into
upstream-friendly themes. It deliberately does not create branches, open pull
requests, merge, publish, or edit TRUST data.

```bash
node scripts/plan-review-backlog.mjs \
  automation/examples/improvement-proposals.json \
  provenance/review_backlog.json
```

Every proposed theme declares its owner, dependency edges, affected canonical
claim IDs, target files, and human gates. This makes an agent-generated backlog
reviewable before any implementation authority is granted.

Scientific approval is forced for Evidence Radar and human-submission sources,
and for every target under `content/` or `knowledge/`. Proposal input cannot opt
out; the planner rejects a policy configuration that weakens these protections.

The planner also accepts Evidence Radar's advisory JSON directly. Integrity
alerts become critical/high-priority `trust-evidence` proposals while still
requiring explicit scientific approval; this is the automated handoff between
discovery and planning, not between discovery and publication.

## Upstream contribution rule

Improvements should be proposed to the original template as independent themes:

1. TRUST evidence contracts and exact claim anchoring;
2. human annotations as a separate display layer;
3. advisory evidence surveillance;
4. version and reproducibility artifacts; and
5. archive/federation adapters.

Keeping these themes separable lets maintainers adopt the knowledge/evidence
display improvements without also committing to operating an identity service,
moderation platform, or dedicated archive.
