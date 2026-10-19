# Ecosystem readiness: Diggypaper → CRT/TRUST → ORAtlas

Parent run `run-1a41a3886630` · written 2026-10-19 on branch `pico/ecosystem-evidence-1a41` from `0db82e1`; repaired on branch `pico/ecosystem-repair-1a41` from `8bfe330` (the repair edits this page, the handoff and the JSON twin and adds `tests/contributorship-private-leak.test.mjs`; no runtime, schema, contract or policy file changed) · machine-readable twin: [`provenance/ecosystem-readiness-report.json`](../provenance/ecosystem-readiness-report.json) (descriptive only, not an interchange contract) · launch instructions: [`ecosystem-handoff.md`](ecosystem-handoff.md).

## 0. What this page is, and is not

This is an **honest partial program report**. It records what exists, what was executed, what was only read, and which human decisions and authorizations stand between the current state and the end-to-end mission. It does **not** claim that the Diggypaper → CRT/TRUST → ORAtlas pipeline is complete, that any issue can be closed, or that any private feature is safe. No real data was processed; every fixture is synthetic.

- Evidence is per acceptance criterion, from code and named tests. Issue open/closed state and PR titles were **not** used as evidence. A merged PR proves an engineering slice landed, not that the issue is done.
- GitHub data is a **point-in-time snapshot** (2026-10-19). Check results quoted from it are historical (`ci-pr`), not re-executed.
- Only the TRUST repository was executed against (this run). Diggypaper, ORAtlas, ORCID and the reference fork were read, and three native validators plus an ORCID test file were run read-only by the parent. Where a foreign test is cited, the test *exists*; whether it passes is stated separately.
- Nothing here approves ORAtlas #202, the counsel/DPIA gate, or any of TRUST decisions D01–D12 (all still `proposed`).

Status vocabulary used below:

- `IE` — IMPLEMENTED_EVIDENCED — code and a named test exist in the pinned tree (says nothing about whether the test passes unless the run column says so)
- `PART` — PARTIAL — some of the criterion is evidenced; the gap is stated
- `NE` — NOT_EVIDENCED — no code/test found at the pinned tree
- `PR_ONLY` — PR_ONLY — claimed only by a PR that is not in the pinned tree (draft or unmerged)
- `BH` — BLOCKED_HUMAN — needs a named human/owner/reviewer decision or action
- `BS` — BLOCKED_SECURITY — waits on ORAtlas #202 (unratified security ADR, draft PR #211) and the counsel/DPIA gate
- `CS` — CANDIDATE_SUPERSEDED — this report observes overlap with a newer issue; no maintainer proposal or owner ratification is evidenced unless stated; left open

Run column: `this-run` executed here at the pinned commit · `parent-run` executed read-only by the parent (or re-checked read-only here) · `ci-pr` PR checks recorded in the snapshot · `not-run` not executed in this program.

## 1. Architecture map

```
source-native (producers)                     editorial / pipeline                      archive / destination
Diggypaper  ──source-evidence-packet/0.1.0──►  CRT/TRUST (this repo)  ──comprev.evidence-packet-links/2──►  ORAtlas
  findings, SEIP seip-support-v1                 Phase 2 import (S2) + claim graph          public lineage view, claim passport
  finding-credit-companion/0.1.0 ──────────────► comprev.contributorship/1 (private+public) ─► oratlas.source-credit-observations/0.1.0 (offline)
ORCID playground ─orcid-playground/roster-assertion 0.1.0 (candidate contacts only)──────────────────────────► (same adapter; no access effect)
                                                 native TRUST v2 stays native ──────────────► never an ORAtlas score
                                                                                              oratlas.private-cross-finding/0.1.0: contract only, NOT a production ACL
```

| Layer | Repository | Owns | Never does |
|---|---|---|---|
| source / native | `dhuzard/diggypaper` | findings with exact passages, `seip-support-v1` human assessments, packet manifests, rights, pseudonymous curator/assessor credit | translate SEIP into TRUST; reveal private reviewers; treat a quote match as support |
| source / native | `dhuzard/orcid-playground` | public ORCID claims, working-group roster assertions (`roster-assertion/0.1.0`) | grant project access; create accounts/invitations; write to ORCID; claim OAuth verification offline |
| editorial | `Neuronautix/…_trust-knowledge` (this repo) | review claim graph, native TRUST v2, reviewed `comprev.claim-finding-map/1`, `comprev.contributorship/1` private/public companions | credit a source curator as a review author; convert SEIP or TRUST into each other |
| editorial (reference) | `dhuzard/ComputationalReviewTemplate` | generic upstream pipeline and Evidence Explorer contract; Issues disabled | carry TRUST-specific semantics |
| archive / destination | `dhuzard/oratlas` | public lineage regression, offline credit adapters, private-credit *contract* | production private ACL (blocked on #202) |
| coordination | `dhuzard/scientific-review-workspace` | nothing yet: local `master` is unborn, directories empty, no issues/PRs | — |

**No crosswalk is asserted.** DOI equality credits nothing; only a reviewed `comprev.claim-finding-map/1` decision bound to exact lineage bytes does. A human-asserted verification is not destination verification; an original article author is not a cross-finding author; an ORCID claim is not OAuth verification; AI runs are production records, never people; a rights grant is not scientific support.

### Contract owners and versions (no duplication)

| Contract | Version | Owner | Consumers | Notes |
|---|---|---|---|---|
| source-evidence-packet | 0.1.0 (frozen) | Diggypaper | TRUST importer (vendored schemas in `docs/contracts/source-evidence-packet/v0.1.0`), ORAtlas lineage | TRUST does not redefine it |
| seip-support-v1 | v1 | Diggypaper | carried verbatim by TRUST lineage and ORAtlas | never converted to TRUST |
| comprev.claim-finding-map | 1 | TRUST | `comprev.evidence-packet-links/2` bridge | reviewed decisions only |
| comprev.evidence-packet-links | 2 | TRUST | ORAtlas extractor (pin `9cd3a0c`) | `scripts/oratlas/contract-pin.mjs` mirrors, verified against a real checkout |
| native TRUST | v2 | TRUST | sidecar only | D01–D12 `proposed` |
| comprev.contributorship | 1 | TRUST | ORAtlas CRT adapter | schemas in `docs/contracts/contributorship/v1` |
| finding-credit-companion | 0.1.0 (frozen) | Diggypaper | ORAtlas Diggypaper adapter | additive fields only |
| orcid-playground/roster-assertion | 0.1.0 | ORCID playground | ORAtlas ORCID adapter | schema byte-identical across both repos (verified) |
| oratlas.source-credit-observations | 0.1.0 | ORAtlas | — | offline mapping, `accessEffect: none` |
| oratlas.private-cross-finding | 0.1.0 | ORAtlas | — | contract + owner-only pure projector; **not production ACL** |

## 2. Pins and synchronization

| Repository | Pin | Reference | Checkout used |
|---|---|---|---|
| `Neuronautix/ComputationalReviewTemplate_trust-knowledge` | `0db82e1eeacf9ff53037edd7c624464aad6fcf9f` | origin/main (merge of PR #20; PR head e006757) | /tmp/trust-ecosystem-1a41 (bound worktree, branch pico/ecosystem-evidence-1a41) |
| `dhuzard/ComputationalReviewTemplate` | `0e36bac88241252413a340b6b7155f8026eb0faa` | local and remote main (PR #8 merge, head 6836c17, green) | workspace/review-template (read-only) |
| `dhuzard/diggypaper` | `a34d18f` | local and remote main | workspace/diggypaper (read-only) |
| `dhuzard/oratlas` | `f6c834b (local main, STALE)` | remote main 230b8a3 (includes PR #212 CI shards); local contains #200, #208, #210 | workspace/oratlas (read-only); exporter pin for TRUST is 9cd3a0c284400b30dd0044cf3acb24df1047275d (unchanged), validated at /tmp/trust-sync-eb51dbbd-oratlas |
| `dhuzard/orcid-playground` | `ff5aff93cb34620f3f2500f709259aa0134c24f2` | remote main snapshot (PR #10 merged green); PR #7 network pilot is an open draft | /tmp/orcid-discovery-1a41 (read-only temporary capture; NOT a durable or authorized working checkout) |
| `dhuzard/scientific-review-workspace` | `None` | local master is unborn (no commits); origin dhuzard/scientific-review-workspace has no issues/PRs; docs/, scripts/, missions/ are empty | not bootstrapped by this run; nested workspace/workspace/ directories have no .git and must not be used |

Sync facts verified (read-only):

- TRUST PR #20 merged as `0db82e1` (head `e006757`; build, evidence-explorer, manifest, test, prose-fidelity SUCCESS, deploy SKIPPED); `git diff e006757 origin/main` is empty (parent). `8cc8383` and the fork baseline `a19a8dc` are ancestors of `0db82e1`. `f205552` is **not** — the Evidence Explorer contract was ported file by file (see `docs/upstream-sync-validation.md`).
- Reference fork `main` `0e36bac` (PR #8, head `6836c17`, green) has both `8cc8383` and `f205552` as ancestors. PRs #7/#19 are older overlapping source-sync proposals; their duplicate merge metadata is not interpreted.
- **Stale local checkouts (action for the user):** `workspace/trust-knowledge` local `main` is `f205552`, diverged from TRUST `origin/main` (26 local-only, 84 behind) and carries untracked `.pi/` and `AGENTS.md`; `workspace/oratlas` is `f6c834b` versus remote `230b8a3` (PR #212 CI shards). Neither was modified.
- TRUST exporter pin to ORAtlas stays `9cd3a0c284400b30dd0044cf3acb24df1047275d`; it was validated against a checkout at exactly that commit.

## 3. Prior validation: merged and open PRs

| Repo | PR | State (snapshot) | Checks (snapshot) | Reading |
|---|---|---|---|---|
| TRUST | #20 sync v30 | merged `0db82e1`, head `e006757` | build, evidence-explorer, manifest, test, prose-fidelity SUCCESS; deploy SKIPPED | this run re-executes the same families at `0db82e1` (§6) |
| TRUST | #18 contributorship | merged `a19a8dc`, head `3e54896` | build, test SUCCESS; deploy SKIPPED | producer slice of #17 |
| TRUST | #12–#15 ORAtlas export, importer, links/2, claim-finding map | merged | build/extractor/test SUCCESS | slices behind closed POC #10/#11 |
| Reference fork | #8 integrate v30 | merged `0e36bac`, head `6836c17` | evidence-explorer, manifest, test, prose-fidelity SUCCESS | parity reference |
| ORAtlas | #200 lineage regression | merged, head `3108f28` | 8 checks SUCCESS | #198 slice |
| ORAtlas | #208 private foundation | merged, head `4fec8c4` | 8 checks SUCCESS | contract only, not production ACL |
| ORAtlas | #210 credit adapters | merged, head `e4e33a8` | 8 checks SUCCESS | #209 slice |
| ORAtlas | #212 CI shards | merged, head `eb5e15a` | 15 SUCCESS | in remote main, not in local tree |
| ORAtlas | #211 security ADR | **open draft**, head `c3078cd` | 14 SUCCESS, 1 FAILURE (aggregate `e2e`; the snapshot shows `e2e-shard 1–6` and `e2e-agent-contract` as successes) | unratified; not approved here. The aggregate failure's root cause is **unverified**: no job logs were read |
| ORAtlas | #213 (titled as a sign-in flake fix) | open, head `a3ae23d` | 14 SUCCESS, 1 FAILURE (aggregate `e2e`) | not merged or assessed by this run; the sign-in explanation is the PR author's, attributed and unverified here |
| ORAtlas | #214 CI budget | open, head `de7a442` | 13 queued/in progress | open is not authorization to merge; not merged or assessed by this run |
| ORCID | #10 roster contract | merged `ff5aff9`, head `8210450` | ubuntu + windows SUCCESS | #9 slice |
| ORCID | #7 network pilot | **open draft**, head `fba68fc` | ubuntu + windows SUCCESS | unreviewed; green is not merge readiness |
| Diggypaper | 42 PRs (SEIP #8–#45, Finding Curation #48–#52, credit #56) | all merged | **no status checks recorded for any of them** | no CI evidence in the snapshot; author-reported test counts only |

## 4. Issue reconciliation (criterion level)

Each table lists the acceptance criteria, paraphrased, with a status, the run provenance, the evidence and the gap. Whole-issue statements are separate from slice statements. **No issue is recommended for closure by this report.**

### Neuronautix/ComputationalReviewTemplate_trust-knowledge

#### #17 — [CREDIT] Export CRediT contribution statements and source-finding credit lineage without authorship inflation (snapshot: OPEN)

- **Whole issue:** slice-delivered; whole issue not complete (criterion 3 partial, now with a bounded offline cross-artifact regression; private wiring blocked)
- **Engineering slice:** PR #18 (merge a19a8dc, carried into 0db82e1): comprev.contributorship/1 builder, schemas, synthetic fixtures, 22 golden tests. Repair adds an offline cross-artifact regression (6 tests in `tests/contributorship-private-leak.test.mjs`) for criterion 3

| Criterion | Status | Run | Evidence | Gap / next action |
|---|---|---|---|---|
| Mixed human+agent review -> separate provenance/credit records; MyST rendering preserved; 14 CRediT roles; verified vs claimed ORCID distinct | `IE` | this-run | tests/contributorship.test.mjs: 'mixed human + agent review…' , 'the real content/authors.yml maps to one production agent…', 'the MyST authorship widget output is unchanged', 'exactly the 14 ANSI/NISO Z39.104-2022 roles…', 'an invented or misspelt role… rejected', 'verified and claimed ORCIDs stay distinct…'; tests/authorship-integration-boundary.test.mjs (3 tests). All pass. | 'verified' is a declared reference checked by schema, not a live ORCID OAuth check (that is ORAtlas #203). |
| One CRT claim tracks two source findings' bibliographic/curator credit without making curators authors | `IE` | this-run | contributorship tests 'one review claim credits two source findings without making their curators review authors', 'DOI equality alone credits nothing…', 'a finding id + revision supplied by two packets is rejected, whatever the input order'; evidence-links-v2 'a reviewed map binds only the mapped finding…'. All pass. | Synthetic fixtures only; no real packet. |
| A private origin leaks no title, credit/ORCID, relation or protected passage, including sidecars, caches and fixtures | `PART` | this-run (repair) | Existing: contributorship tests 'nothing from an uncleared private origin… reaches the public companion', 'if one of two origins… is private and uncleared, the claim publishes no source credit at all', 'rights-restricted sources publish no passage hashes', 'the public companion is exactly the allowlisted projection of the private one'. NEW `tests/contributorship-private-leak.test.mjs` (6 tests, pass): unique canaries (private project ref/title, unpublished collaborator name and schema-valid ORCID, curator ref, packet passage and paper title) are injected into realistic private builder inputs bound to the new lineage digest; the credit builder and the existing public pipeline (importer → links/2 bridge → ORAtlas export, scratch directory, two public packets) are run; the complete output of every enumerated public surface is scanned and no canary appears; public-pipeline bytes are identical before and after private processing; fixture tree and builder inputs are byte-unchanged; a private-scope packet is refused by the importer with no outputs; the scanner fails when a canary is inserted into any public artifact; leaking mutations of a disposable clone of the builder are detected. | Still `PART`. Tested surfaces are the enumerated offline artifacts only. Untested and blocked on ORAtlas #202 (with #203 identity and #204 workspaces): caches, discovery/search, logs, notifications, timing/count side channels, ORAtlas-side surfaces, deployed-site output and any real private data. The exporter and importer have no ACL: the private origin is credit-builder metadata and is deliberately never fed to the exporter, so this does not show that the exporter filters private input. Canaries detect leaked values, not ids or existence, and a finite set is not universal leak prevention. The carried `packet.manifest_sha256` of committed fixtures is not recomputed without packet bytes. |
| Approval produces a reproducible credit manifest; private/public differ only per explicit allowlist | `IE` | this-run | 'contributors need both the individual and the controller…', 'the public companion is exactly the allowlisted projection…', 'build is deterministic and independent of input order', 'the private release report names withheld records and is bound to both companions', 'a supplied release report must be the one recomputed from both companions', 'the committed fixture and golden outputs are exactly what the generator and builder produce'. Pass; build-fixture.mjs --check passes. | Synthetic only. The builder binds packet.manifest_sha256 as a carried value; it does not recompute a packet manifest without the packet bytes. |
| Native TRUST scores, source SEIP judgments, S2/S3 packets and public ORAtlas export stay distinct; regressions pass | `IE` | this-run | contributorship 'credit lineage is kept apart from TRUST and source SEIP judgments'; oratlas-export 'native TRUST v2 is never expressed as an ORAtlas assessment or score'; source-evidence-import 'outputs carry no TRUST, replication or full-text fields…'. Pass; PR #18/#20 CI green (ci-pr). | Real-extractor test needs ORATLAS_DIR; run separately at pin 9cd3a0c (12/12 pass). |
| Whole-issue integration / release acceptance with ORAtlas | `BS` | not-run | docs/CONTRIBUTORSHIP.md and the issue thread: no private-workflow wiring before ORAtlas #202. | Owner ratification of ORAtlas #202. |

#### #16 — [INTEGRATION] Private review workspace artifact manifest for ORAtlas My Research (snapshot: OPEN)

- **Whole issue:** not started in code. The issue text allows the offline manifest schema, CLI and fixtures to proceed independently of the production private gate, so that design work is actionable now and ORAtlas #202 is not a reason to withhold it; it was not implemented in this repair. The cross-repository consumer contract with ORAtlas My Research is unresolved, and the connector authorization part stays blocked on #202.
- **Engineering slice:** none (building blocks only: sha256-bound lineage, claim-graph-bound contributorship subject)

| Criterion | Status | Run | Evidence | Gap / next action |
|---|---|---|---|---|
| Private CRT working project generates a portable versioned artifact manifest | `NE` | this-run | No generator or schema found (searched scripts/, docs/, tests/). review-manifest.json and scripts/release-artifacts are public release bundles, a different thing. | Offline schema, CLI and fixtures are actionable now (not blocked by #202); unimplemented; the ORAtlas consumer contract must be agreed first. |
| Connector lists only principal-authorized artifacts; invalid/expired access fails closed | `BS` | not-run | No principal/authorization concept on the CRT side; existing 'fail closed' is import validation, not access control. | Production connector and authorization are blocked on ORAtlas #202; do not build them before it. |
| Exact source hashes/versions and contribution assertions attributable; drafts not presented as peer reviewed/archived | `PART` | this-run | Building blocks only: phase2_finding_sha256 / packet.manifest_sha256 carried in lineage; contributorship subject bound to review_id, version and claim-graph SHA-256. | No workspace-level file/version manifest or draft-status labelling. |
| Public exporter and ORAtlas deposit format unchanged without opt-in | `PART` | this-run | Nothing new was added; oratlas-export idempotency test passes. | Trivially true while the feature does not exist; needs a regression test when a generator is added. |
| Reproducible offline demo: working draft + reviewed claim graph + released version | `NE` | this-run | tests/fixtures/contributorship has a claim graph and companions but no draft/released-version demo or manifest. | Needs the offline generator first (actionable, see above). |

### dhuzard/diggypaper

#### #1 — [EPIC] Scientific Evidence Integrity & Provenance (snapshot: OPEN)

- **Whole issue:** not complete; depends on #7 (human pilot)
- **Engineering slice:** Engineering slices for #2–#6 merged (PRs 13–45); pilot engine only for #7

| Criterion | Status | Run | Evidence | Gap / next action |
|---|---|---|---|---|
| All six scopes complete | `PART` | not-run | Slices for #2–#6 exist; #7 has validators/scorer but no pilot. | #7 blocked on people. |
| Reference/version integrity and independent export checks pass | `IE` | not-run | backend/app/portable_replay.py, evidence_crate.py; backend/tests/unit/test_evidence_crate.py::test_archive_consumer_detects_hash_and_link_tampering | PostgreSQL-only tests are not in CI (audit F-10). No full-suite run at a34d18f in this program. |
| Legacy behaviour preserved | `IE` | not-run | test_evidence_links.py::test_legacy_conversion_preserves_order_duplicates_empty_quotes_and_no_bindings; test_gold_api.py::test_legacy_gold_is_explicitly_unqualified_then_preserved_on_refresh | Not executed here. |
| Pilot results, limitations and continue/stop decision published | `BH` | not-run | No SEIP pilot output in runs/ and no decision document. | Needs two independent reviewers and an adjudicator. |

#### #2 — [SEIP-3] Preserve evidence source versions and exact inference provenance (snapshot: OPEN)

- **Whole issue:** engineering slices merged; not complete (PostgreSQL concurrency guard unexecuted in CI; prefilter case not evidenced)
- **Engineering slice:** PRs 14, 17, 19–21, 24, 26, 28–30 (merged)

| Criterion | Status | Run | Evidence | Gap / next action |
|---|---|---|---|---|
| Replacing PDF with JATS cannot export a stale PDF or reuse old methods | `IE` | not-run | backend/app/fulltext.py (_apply_fulltext); test_fulltext.py::test_complete_article_replaces_entire_source, ::test_uploaded_pdf_replaces_source_without_old_methods; test_evidence_crate.py::test_replacement_source_text_cannot_replay_old_invocation | Issue text names JATS; code path is Europe PMC XML — wording to reconcile. |
| A new prediction resolves to byte-identical captured messages and article input | `IE` | not-run | provenance_capture.py; test_provenance.py::test_authoritative_bytes_survive_numeric_projection_changes_and_reject_tampering; test_provenance_chat.py::test_actual_raw_response_is_bound_to_prepared_unknown_call; unit/test_quote_matcher.py::test_only_frozen_source_is_used_after_mutable_article_changes | Normal chat path only. |
| Abstract-only, legacy placeholders, examples, prefilter and windowed/scorer inputs have explicit provenance | `PART` | not-run | test_evidence_crate.py abstract/legacy capture tests; test_provenance_render.py::test_template_and_examples_are_never_classified_by_matching_source_substrings; test_scorer_provenance.py (SystemOne windows, ONNX feeds) | No test for a 'prefilter' input; benchmark scorer call tracing not confirmed (audit F-2). |
| Concurrent replacement/inference cannot bind mismatched versions; secrets excluded | `PART` | not-run | Concurrency: test_provenance_migration.py::test_capture_source_serializes_with_article_replacement is PostgreSQL-only (skips without SEIP_TEST_POSTGRES_URL). Secrets: test_provenance.py::test_request_allowlist_rejects_transport_secrets_and_settings. | Secrets half evidenced; the concurrency half is written but PostgreSQL-only and unexecuted in CI, so it is not counted as evidenced. |

#### #3 — [SEIP-1] Verify quotations deterministically against captured article input (snapshot: OPEN)

- **Whole issue:** criteria evidenced in source; not executed here; awaits independent review before any closure decision
- **Engineering slice:** PRs 16, 22, 23, 44 (merged)

| Criterion | Status | Run | Evidence | Gap / next action |
|---|---|---|---|---|
| Fabricated, paraphrased, example-only quotes cannot get exact status | `IE` | not-run | quote_matcher.py; unit/test_quote_matcher.py::test_contract_fixtures, ::test_example_and_instruction_text_are_not_search_inputs; test_quote_checks.py::test_example_only_text_never_becomes_target_match |  |
| Abstract-only quotations verifiable against captured abstract | `IE` | not-run | test_evidence_crate.py abstract capture replay; test_quote_matcher.py::test_contract_fixtures | No dedicated abstract-only matcher test. |
| Exact/normalized/repeated/absent/unavailable distinguishable and persisted | `IE` | not-run | test_quote_matcher.py: exact-pass-wins, normalized-repetition-is-ambiguous, unavailable/known-empty/legacy distinct; migration 0023_quote_checks.py | Audit F-5 ('not produced' vs 'unchecked') said fixed by PR 44 — verify. |
| Matching never sets support/adjudication or implies AUTO_ACCEPTED is verified | `IE` | not-run | test_evidence_links.py::test_link_validity_does_not_upgrade_any_match_status_to_support; test_portable_replay.py (two tests) | No test names AUTO_ACCEPTED. |
| 100 KB / 1 MB inputs with 100 quotes have measured latency/memory; bounded expansion | `IE` | not-run | backend/scripts/benchmark_quote_matcher.py; docs/benchmarks/quote-matcher-v1.2-windows-python312.jsonl; test_candidate_expansion_is_bounded_for_adversarial_repetitions | Windows/Python 3.12 only; memory is tracemalloc peak, not RSS. |

#### #4 — [SEIP-2] Link answer revisions to stable evidence records (snapshot: OPEN)

- **Whole issue:** criteria evidenced in source; not executed here; PG scope guard unexecuted
- **Engineering slice:** PRs 18, 27 (merged)

| Criterion | Status | Run | Evidence | Gap / next action |
|---|---|---|---|---|
| One answer references two passages and one passage two answers without duplicated provenance | `IE` | not-run | evidence_links.py; test_evidence_links.py::test_many_to_many_fixture_and_resume_have_stable_server_ids |  |
| Unknown fields, duplicate IDs, cross-article/input refs and dangling links fail validation | `IE` | not-run | test_invalid_submitted_claims_are_rejected_without_repair, test_duplicate_ids_or_edges_are_rejected, test_match_receipt_cannot_reference_another_source_or_input | PostgreSQL scope-immutability guard test is unexecuted in CI. |
| Changed answer creates a distinct revision and cannot inherit old support | `IE` | not-run | test_changed_answer_requires_new_revision_and_cannot_reuse_old_ids; test_support_assessments_api.py::test_new_prediction_does_not_inherit_old_assessment |  |
| Legacy lists and structured outputs coexist with a deterministic projection | `IE` | not-run | test_mixed_structured_and_unlinked_legacy_evidence_preserves_both; test_old_client_projection_echo_or_omission_never_erases_structured_graph | Audit F-13 (one bad link nulls the graph) is by design but unresolved. |

#### #5 — [SEIP-4] Record human evidence support and preserve gold integrity (snapshot: OPEN)

- **Whole issue:** partially evidenced; a UI criterion has no implementation
- **Engineering slice:** PRs 25, 32, 34, 37, 42, 43, 45 (merged)

| Criterion | Status | Run | Evidence | Gap / next action |
|---|---|---|---|---|
| Support recorded per exact answer/evidence relationship, independent of matcher outcome | `IE` | not-run | api/v1/support_assessments.py; migration 0027; test_support_assessments_api.py::test_assessment_is_human_and_exact_despite_not_found_quote, ::test_forged_graph_nodes_or_links_cannot_receive_judgment | PG guard test unexecuted. |
| Review UI keeps context and flags negation/population/design/conflicting passages; unclear/negative judgments carry rationale | `PART` | not-run | Context label and required rationale (SupportAssessmentPanel.tsx). | No negation/population/design/conflict affordance exists in frontend/src. Needs a design decision, then build. |
| Source-only and quote-only changes surface gold staleness | `IE` | not-run | api/v1/gold.py _staleness; test_gold_api.py::test_gold_revisions_separate_source_quote_and_answer_staleness | PG test unexecuted. |
| Gold refresh preserves lineage; unverified/legacy gold clearly unqualified | `IE` | not-run | test_gold_api.py legacy-gold test; migration 0028 |  |
| Blind review hides model/other-reviewer evidence | `IE` | not-run | test_support_assessments_api.py::test_member_and_blind_boundaries; test_gold_api.py::test_blind_gold_hides_other_reviewers_revisions; test_annotations_api.py::test_blind_second_submission_cannot_replace_first_judgment | Audit F-7 (project-wide embargo) has no code. |

#### #6 — [SEIP-5] Preserve human evidence and publish portable evidence-aware RO-Crate (snapshot: OPEN)

- **Whole issue:** criteria mostly evidenced in source; documentation gaps remain
- **Engineering slice:** PRs 13, 31, 33, 36 (merged)

| Criterion | Status | Run | Evidence | Gap / next action |
|---|---|---|---|---|
| Human quotes and review attribution survive export | `IE` | not-run | crate.py; test_crate_human_evidence.py (all-quotes test; reviewer-reference-survives-account-deletion test); test_reviewer_pseudonym_policy.py |  |
| Consumer without Diggypaper/DB validates schema, resolves refs, reproduces matching from retained input | `IE` | not-run | evidence_crate.py, portable_replay.py CLI; test_portable_replay.py::test_replays_example_from_retained_canonical_bytes, ::test_checked_in_example_and_cli | Only title/abstract captures distributed; responses, rationale and full text withheld by design. |
| Documented examples for exact/normalized/ambiguous/unavailable/legacy/human-only | `PART` | not-run | docs/examples/seip-portable-replay-v1.json; test_portable_replay.py | No single example covers every state. |
| Gold qualification and each prediction's history distinct from current project metadata | `IE` | not-run | test_crate_human_evidence.py; test_evidence_crate.py::test_two_runs_retain_distinct_results_and_source_replacement | Export of gold qualification not confirmed. |
| No claim of full compatibility with reference repositories; mappings/gaps documented | `PART` | not-run | docs/design/evidence-crate-v1.md says unsigned, rights-uncertified. | No crate-specific mapping/gap table. |

#### #7 — [SEIP-6] Qualify extraction, evidence integrity and support on an independent pilot (snapshot: OPEN)

- **Whole issue:** validators and scorer only; pilot not run
- **Engineering slice:** PRs 12, 15, 35, 38, 39 (merged)

| Criterion | Status | Run | Evidence | Gap / next action |
|---|---|---|---|---|
| Frozen manifest, protocol and reviewer provenance; disjoint dev/eval sets inspectable | `BH` | not-run | seip_pilot_manifest.py, seip_reference_ledger.py; test_seip_pilot_manifest.py::test_frozen_30_paper_ledger_and_scorer_adapter; protocols in docs/protocols/ | No real manifest/ledger. Proposed reviewers and adjudicator have not recorded acceptance, conflicts or sign-off. |
| Missing/invalid predictions counted as attempts; zero denominators NA | `IE` | not-run | seip_scoring.py; test_seip_scoring.py::test_attempt_manifest_retains_missing_invalid_calls_and_fields_and_excludes_examples, ::test_zero_denominators_empty_manifest_and_unassessed_only_support_are_na | Audit F-22 unchecked. |
| Integrity, attribution, linkage, support reported separately with paper-cluster intervals | `IE` | not-run | test_seip_scoring.py (engine), synthetic inputs | Engine only; no real data. |
| Negation/conflict sensitivity and pre-adjudication agreement reported | `NE` | not-run | Only disagreement/adjudication handling exists; no agreement metric. | Audit F-8. |
| Observed outcomes, limitations, bounded continue/stop decision published | `BH` | not-run | No pilot output or decision document. | Independent reviewers and adjudicator required; no scientific validation claim is possible without them. |

#### #46 — [EPIC] Finding Curation: multiple provenance-bound scientific findings per article (snapshot: OPEN)

- **Whole issue:** MVP producer slice merged; epic not complete (pilot, full-suite run, numeric non-coercion test)
- **Engineering slice:** PRs 48, 49, 50, 51, 52 (merged); source-evidence-packet/0.1.0 frozen

| Criterion | Status | Run | Evidence | Gap / next action |
|---|---|---|---|---|
| At least 2 reviewable findings per article; no mistaken merging across articles | `IE` | not-run | test_findings_api.py::test_two_findings_on_one_article_stay_distinct_and_null_results_retained, ::test_shared_passage_across_findings_and_second_article_not_merged |  |
| Exportable findings resolve to immutable lineage; absent refs cause omission or error | `IE` | not-run | test_findings_api.py::test_unknown_forged_or_empty_evidence_rejected, ::test_legacy_or_forged_prediction_graph_cannot_back_a_finding; test_finding_packet.py::test_omitted_cases_counted_and_never_exported |  |
| Numbers, units, contrasts and non-significance not coerced | `PART` | not-run | finding_schema.py states no unit is guessed. | No test names unit/numeric non-coercion. |
| Quote occurrence and human support separate; seip-support-v1 never translated to TRUST | `IE` | not-run | test_findings_api.py::test_quote_match_and_judgment_are_separate_and_refs_are_pseudonyms; findings.py:48; finding_packet.py | No test asserts absence of TRUST translation. |
| Approvals attributable/versioned; history unchanged; incomplete findings internal | `IE` | not-run | test_findings_api.py (several); PG-only test_finding_curation_postgres.py unexecuted |  |
| Rights/access, blinded and cross-project negative tests | `IE` | not-run | test_findings_api.py; test_article_rights_api.py; test_finding_packet.py::test_anything_but_allowlisted_allowed_withholds |  |
| Offline validator reproduces finding-to-passage linkage from a fixture | `IE` | parent-run | docs/contracts/source-evidence-packet/v0.1.0/validator/sep_validate.py; parent ran it read-only on the ORAtlas fixture packet (valid, warning private-packet-not-exportable with --allow-restricted; exit 1 with --for-import, the correct negative). |  |
| Public pilot, independently double-reviewed, with precision/coverage and clustered analyses | `BH` | not-run | No findings pilot artefact. | Two independent reviewers. |
| Existing screening, inference, gold, PRISMA and RO-Crate unchanged | `NE` | not-run | Suites exist; the merge audit's 832-pass run predates PRs 40–56. | Full backend/frontend suite not run in this program. |

#### #53 — [INTEGRATION] Private project directory and permission-bound export for ORAtlas My Research (snapshot: OPEN)

- **Whole issue:** not started in code; blocked
- **Engineering slice:** none (packet-level rights/restricted handling exists, no connector)

| Criterion | Status | Run | Evidence | Gap / next action |
|---|---|---|---|---|
| Member registers own authorized project with a private ORAtlas workspace via bounded export/connector | `BS` | not-run | No connector, descriptor, grant or OAuth code; only LEAD-only GET /{project_id}/findings/export (restricted by default). | ORAtlas #202, then the #203 identity plan, then #204. |
| Stranger / other member / same-name ORCID cannot discover projects | `BS` | not-run | No discovery endpoint exists, so nothing to test. |  |
| Withdrawn grant or revoked membership ends reads, even with old signed link | `BS` | not-run | No grant or signed-link model. |  |
| Evidence stays source-native; citations/notes private unless rights authorize | `PART` | not-run | test_finding_packet.py::test_no_declaration_withholds_quotes_and_stays_restricted; sep_validate.py private-packet-not-exportable | Connector layer absent. |
| Existing APIs backward-compatible; independent security tests; least-privilege contract; migration strategy | `BS` | not-run | Nothing added for #53. | Waiting on ORAtlas #202. |

#### #55 — [CREDIT] Preserve source-finding curator and reviewer attribution in privacy-safe evidence handoff (snapshot: OPEN)

- **Whole issue:** producer slice merged (PR #56, a34d18f); issue not complete — comment-requested compatibility check absent
- **Engineering slice:** PR #56 finding-credit-companion/0.1.0: schemas, pure builder, fixtures, validator; no route/migration/UI

| Criterion | Status | Run | Evidence | Gap / next action |
|---|---|---|---|---|
| Two findings from one article keep distinct proposers, curators and assessments | `IE` | not-run | test_finding_credit_companion.py::test_two_findings_of_one_article_keep_distinct_proposers_and_assessments | Fixture/builder level only. |
| Authorised reviewer vs public consumer visibility with explicit 'withheld' | `IE` | not-run | test_public_companion_shares_only_approved_findings_and_counts_the_rest; test_finding_credit.py::test_missing_proposer_is_withheld_not_guessed | consent_ref/approval_ref referenced but not defined (README). |
| Claimed vs verified ORCID; CRediT only when declared; no implied authorship | `IE` | not-run | test_claimed_and_verified_orcid_are_never_conflated; test_builder_never_discloses_and_never_infers_roles; test_explicit_declarations_carry_roles_and_inactive_ones_do_not |  |
| Revocation, dispute and consent changes block disclosure; identities redacted | `PART` | not-run | test_revocation_after_release_prevents_further_disclosure; test_handoff_expiry_is_checked_against_the_consumer_clock | Offline validator only; no live revocation; logs/cache out of scope. |
| Multi-paper finding, repeated DOI, blinded reviewer, private-packet negative cases | `PART` | not-run | test_blinded_reviewers_stay_pseudonymous_or_withheld; test_one_entry_binds_exactly_one_paper | No test for 'multiple papers for one finding' or 'repeated DOI, different results'. |
| SEP 0.1.0, SEIP, rights, PRISMA and CRT importer regression | `IE` | not-run | test_frozen_packet_contract_is_untouched; test_article_rights_api.py::test_crt_importer_accepts_redistributable_and_withholds_default | No PRISMA test tied to this issue. |
| Native validators on the ORAtlas credit fixture | `IE` | parent-run | Parent ran fcc_validate.py (valid, no errors) on the ORAtlas diggypaper credit.json with its packet; companion digest acae7c32…; packet manifest digest 64c01a63… | Read-only parent execution (logs under /tmp/ecosystem-discovery-1a41). |
| Comment-requested producer-side compatibility fixture/check against ORAtlas SourceCreditObservations mapping and loss report | `NE` | not-run | Not present at a34d18f. | Add before closing #55 (handoff Diggypaper objective). |

### dhuzard/oratlas

#### #198 — [POC-S4][MVP] End-to-end review ingestion and evidence-lineage regression test (snapshot: OPEN)

- **Whole issue:** synthetic regression delivered (PR #200); real-data workflow open
- **Engineering slice:** PR #200 merged (8 checks pass)

| Criterion | Status | Run | Evidence | Gap / next action |
|---|---|---|---|---|
| Offline seeded test with exact commits and committed fixture-digest manifest | `IE` | ci-pr | packages/extractor/src/fixtures/crt-diggypaper-evidence-lineage/{pins,digests}.json; evidence-lineage.test.ts 'records exact upstream revisions…', 'matches the committed digest manifest byte for byte', 'contains no PDF, full text or credential material' | Synthetic fixture; not executed here. |
| Public read-only view shows source links and full lineage with producer/assessment labels | `IE` | ci-pr | apps/web/src/lib/crt-diggypaper-lineage.integration.test.ts (passport API, passage/snapshot resolution); extractor test labels native TRUST v2 as source-native | Graph-to-passport hop is not id-based (doc item B4). |
| Link to preserved packet or explicit unavailable; never silently flattened | `PART` | ci-pr | Packet availability locator-declared \| location-not-declared; extractor tests for declared-but-missing artifact | No real packet deposit; fixture uses an unlinked example DOI. |
| Existing ingestion and /api/graph suites unchanged; no historical row mutated | `PART` | ci-pr | Integration tests 'left every earlier accepted record byte-identical', 'accepts the real exported review through the unchanged submission pipeline' | Needs a run on current remote main 230b8a3. |
| Reproducibility script/README and pass/fail report | `IE` | ci-pr | docs/cross-repo-evidence-lineage.md; pnpm evidence-lineage:verify / :build | Report is a doc table, not a run. |
| Real-data workflow (Diggypaper #46 export, real deposit, reviewed mapping) | `BH` | not-run | Doc 'Open' section: 24 Phase-2 gate checks exempted as pilot exceptions; rights of citation_contexts excerpts undecided. | Human rights decision and a real deposit. |

#### #199 — [PROGRAM EPIC][MVP v0.1] Source evidence → ComputationalReviewTemplate → ORAtlas (Stages 0–4) (snapshot: OPEN)

- **Whole issue:** MVP not released; G0–G4 partly synthetic
- **Engineering slice:** #200 (lineage), TRUST PRs 13–15, Diggypaper PRs 48–52

| Criterion | Status | Run | Evidence | Gap / next action |
|---|---|---|---|---|
| G0 packet v0.1 frozen; both sides validate same bytes | `PART` | parent-run | Diggypaper froze source-evidence-packet/0.1.0 (PR 48); TRUST vendors the schemas (docs/contracts/source-evidence-packet/v0.1.0); parent ran native sep_validate.py on the ORAtlas packet. | Issue owner is Diggypaper #47 (outside the named set); not reconciled here. |
| G1 two findings from one paper separately approved and exported | `PART` | not-run | Diggypaper findings tests (see #46); ORAtlas fixture has f1 mapped and f2 candidate. | Producer evidence in #46. |
| G2 packet imports into CRT pipeline with a loss report | `IE` | this-run | TRUST tests/source-evidence-import.test.mjs: 'G2: two findings from one article and one from another import with exact source and reviewer provenance', 'every non-accepted record has an explicit status and reasons…', 'Gate G2…' — all pass (144-test run). | Synthetic G2 pilot packet; 24 Phase-2 checks are exempted in the ORAtlas lineage fixture. |
| G3 native claim graph produces ORAtlas JSONL without TRUST translation | `IE` | this-run | TRUST tests/oratlas-export.test.mjs 12/12 pass against the real extractor at pin 9cd3a0c; 'native TRUST v2 is never expressed as an ORAtlas assessment or score'. | Pin 9cd3a0c is not the current ORAtlas main. |
| G4 one offline acceptance test: claim -> >=2 findings -> passage/snapshot hashes | `PART` | ci-pr | Extractor 'follows one review claim to two papers'; integration passage resolution (PR 200). | Synthetic; 'two findings from one article' is covered only as f1 reviewed + f2 candidate. |
| MVP v0.1 released; G5/G6 expansion | `BH` | not-run | None. | Owner decision; expansion needs separate approval. |

#### #202 — [R0][SECURITY GATE] Threat model and authorization contract for private research workspaces (snapshot: OPEN)

- **Whole issue:** architecture only; UNRATIFIED; no test implementation
- **Engineering slice:** Draft PR #211 (ADR) — OPEN, draft, 14 checks pass / 1 fail (aggregate e2e; root cause unverified, no logs read)

| Criterion | Status | Run | Evidence | Gap / next action |
|---|---|---|---|---|
| Non-interference policy and endpoint matrix reviewed before storage/API changes | `BS` | ci-pr | PR #211 only (draft); describes an ingress/egress catalog. | Owner review; not in the pinned tree. |
| A-only/B-only/A+B/anonymous get disjoint projections; no side channels | `PART` | not-run | Pure-function proxy: private-research-credit.test.ts (owner-only trail; other member gets null; auth failure = not found). | No storage/API/timing/count test; PR #211 tests are specified, not implemented. |
| Revoke / remove-account / leave-group with cache and token invalidation tests | `PART` | not-run | 'fails closed if an A+B member loses B access on a subsequent request' (per-request recheck). | No tokens or caches exist to test. |
| Public APIs stay public-only and compatible; no cross-project private index | `PART` | ci-pr | #208/#210 add no route, DB or index. | Needs a CI regression on current main. |
| Processing/release separate from read; private notes not sent to external models by default | `PART` | not-run | 'requires independent cross-project processing consent from both projects' | No egress control in code. |
| Ratify model; enumerate migration and retention consequences | `BH` | not-run | PR #211 D1–D11 recorded 2026-10-19; D11 (retention, controller/processor) provisional. | Owner ratification plus counsel/DPIA before any real data. This report does NOT auto-approve. |

#### #203 — [R1] Verified ORCID identity linking and researcher-scoped contribution directory (snapshot: OPEN)

- **Whole issue:** not started in code; blocked
- **Engineering slice:** none

| Criterion | Status | Run | Evidence | Gap / next action |
|---|---|---|---|---|
| GitHub sign-in plus ORCID OAuth link; spoofed ORCID gets no verified badge | `BS` | not-run | No ORCID OAuth code in apps/web/src. Adjacent: adapters refuse a forged verified ORCID; an ORCID string is never an access grant (private test). | Those are contract tests, not OAuth proof. |
| Duplicate ORCID on another account fails closed; unlink/revoke audited | `NE` | not-run | None. |  |
| A false ORCID claim grants nothing | `PART` | not-run | Contract-level tests only. | No researcher directory exists. |
| Works without ORCID; privacy export; OAuth/CSRF/refresh/session tests | `NE` | not-run | None. |  |
| No private data in public profile/search/graph/feed | `PART` | ci-pr | #208/#210 add no public surface. | CI regression needed. |

#### #204 — [R2] Authenticated research project workspaces, group roles and private artifact registry (snapshot: OPEN)

- **Whole issue:** not started; depends on #202 and on the #203 identity plan (do not order #204 before #203)
- **Engineering slice:** none

| Criterion | Status | Run | Evidence | Gap / next action |
|---|---|---|---|---|
| Four principals, two private workspaces, one public project, no leakage | `BS` | not-run | No workspace model; docs list #204 as follow-up. | Needs #202 ratified and the #203 identity plan first. |
| Invite/revoke members; server-side membership check on every API/file/token | `NE` | not-run | None. |  |
| Versioned artifact refs with source/version/hash/rights; restricted text not copied | `PART` | not-run | privateResearchSourceRefSchema (artifact id, version, sha256); adapters carry sourceRights declarations. | No registry; rights are declarations only. |
| Public archive/graph/search/feeds/export unchanged | `PART` | ci-pr | No change in #208/#210. | CI run on current main. |
| Leak tests for search, counts, pagination, cache, notifications, media, agents | `NE` | not-run | None. |  |
| Retention, consent and publication controls documented | `PR_ONLY` | ci-pr | PR #211 (draft; D11 provisional). |  |

#### #205 — [R3] Researcher-only cross-project serendipity with per-principal graph and non-disclosure (snapshot: OPEN)

- **Whole issue:** contract + pure projector only; no discovery code; blocked
- **Engineering slice:** PR #208 (merged) — oratlas.private-cross-finding/0.1.0, NOT a production ACL

| Criterion | Status | Run | Evidence | Gap / next action |
|---|---|---|---|---|
| R(A+B) sees a private candidate with exact version; no auto-confirmed edge | `PART` | not-run | Projector test (owner with both grants); contract status candidate\|human-reviewed\|rejected; contract blocks public visibility/publication fields. | No discovery code; do not build before #202/#204. |
| A-only/B-only/anonymous see nothing incl. timing, counts, embeddings | `PART` | not-run | Null-response tests only. | Timing/counts/embeddings/notifications not evidenced. |
| Concurrent agents share no index, cache, prompt or log | `NE` | not-run | None. |  |
| Revoking R's B membership removes results incl. cached URLs | `PART` | not-run | Per-request recheck test only. |  |
| No publishing B-derived text without B approval | `PART` | not-run | Contract refuses visibility: public. | No release workflow. |
| False-match fixtures (same words/different unit, shared cohort, conflicting permissions) | `PART` | not-run | DOI treated as citation metadata only; same-paper candidate not authoritative. | The three named fixture cases are not evidenced. |

#### #206 — [R2-INTEGRATION] Private producer connectors and permission-bound project artifact exchange (snapshot: OPEN)

- **Whole issue:** only pure validators/offline adapters exist; blocked
- **Engineering slice:** PR #210 (merged) — offline adapters, accessEffect none

| Criterion | Status | Run | Evidence | Gap / next action |
|---|---|---|---|---|
| Versioned, type-checked descriptor and fixture contract; no tool-specific approval shown as universal | `PART` | ci-pr | source-credit-observations/0.1.0 schema; frozen producer schemas; adapters test 'validates %s fixture against the exact frozen producer JSON Schema' (3 producers). | A credit observation, not a project descriptor. |
| Registry links tools only with grants; revocation immediately removes refs | `BS` | not-run | No connector, token or registry. |  |
| Public ingestion unchanged; deliberate publish creates only approved records | `PART` | ci-pr | #210 does not touch the public pipeline. |  |
| Tests for leakage, tampering, stale permissions, token misuse, replay, outages | `PART` | ci-pr | Byte-change rejection tests only. | Token/replay/stale-permission/outage cases not evidenced. |

#### #207 — [R3-CREDIT] CRediT attribution and versioned provenance for cross-project findings (snapshot: OPEN)

- **Whole issue:** contract and pure projection only; blocked for production
- **Engineering slice:** PR #208 (merged) — private-research-credit contract + owner-only projector

| Criterion | Status | Run | Evidence | Gap / next action |
|---|---|---|---|---|
| A+B+member R: exact version/digest, distinct roles, R credited only for a confirmed role | `PART` | ci-pr | Contract tests: distinct versioned provenance/authors/bridge credit/AI runs; refuses forged confirmations and unknown roles. | Synthetic input. |
| Others cannot infer existence, ORCID, counts or credit (incl. admin) | `PART` | not-run | Projector null-response tests. | Admin/operator not modelled; no count/graph/alert surfaces. |
| Public DOI/ORCID/text cannot gain private privileges | `IE` | ci-pr | 'never uses an ORCID string, bibliographic DOI or assertion as an access grant' | Projector function only; not a production ACL. |
| New private link not publicly credited until each source controller approves | `BS` | not-run | Contract refuses visibility: public. | No approval workflow; consent-withheld, mixed-license, reviewer-anonymity, revocation, version-change cases not evidenced. |
| Source citation, curator, reviewer, linking scientist and AI stay distinct | `IE` | ci-pr | capacity enum and activities[].actorKind; contract tests; adapters tests | Contract level. |
| Permission-filtered credit trail; PROV exports | `NE` | not-run | No export code. |  |
| Controlled CRediT vocabulary; duplicates; disputes; audit | `PART` | ci-pr | 'supports exactly the 14 CRediT roles…', 'rejects duplicate credit and agent-run identities' | Disputes/audit not evidenced. |

#### #209 — [R0-INTEROP] Normalize merged Diggypaper, CRT and ORCID credit contracts without privacy/credit inflation (snapshot: OPEN)

- **Whole issue:** adapter slice delivered (PR #210); residual gaps named below; no closure recommended by this report
- **Engineering slice:** PR #210 merged (8 checks pass), packages/knowledge/src/source-credit-*.ts + test + fixtures + docs/source-credit-interop.md

| Criterion | Status | Run | Evidence | Gap / next action |
|---|---|---|---|---|
| Fixtures pinned to exact merged commits; no full text or sensitive identities | `PART` | parent-run | docs pin Diggypaper a34d18f, CRT a19a8dc, ORCID ff5aff9; schema validation test (3 producers). THIS PROGRAM: ORCID fixture and schema are byte-identical to ff5aff9 (sha256 6b2cd197…, 3ccfc007…); ORAtlas diggypaper credit.json validated by native fcc_validate.py (parent); crt credit.json == TRUST expected private fixture (91aa4dfd…) and claim-graph == TRUST fixture (5d23f7aa…). | The doc itself still says the ORCID bytes were not compared; update the doc after this report. No automated pinned-byte check in the repo. |
| Diggypaper: one article, two findings; curator/proposer/pseudonymous assessor; blind/revoked/withheld never named | `IE` | ci-pr | source-credit-diggypaper.ts; adapter tests incl. 'never emits a name for a withheld/withdrawn credit…', 'fails closed, without a name in the error, when a blinded reviewer is disclosed' |  |
| CRT: duplicate finding across packets rejected; reviewed mapping vs same-paper candidate; source author vs CRT contributor vs AI | `IE` | ci-pr | 'rejects a finding duplicated across packets regardless of order'; 'does not turn the same-paper candidate… into authoritative knowledge' |  |
| ORCID roster: candidate contacts and declared contributions only; never authenticated users, memberships, roles or verified ORCIDs | `IE` | ci-pr | source-credit-orcid.ts; roster tests (candidate-only, elevated oauth-verified claim fails closed, accountVerification not-performed) |  |
| CRediT label->slug deterministic; original label/degree/declaration preserved; unrecognized labels reported | `IE` | ci-pr | 'deterministic CRediT role normalization' describe; unmappable-label and preserved-label tests | Verify the loss report records an unmapped label. |
| Source 'confirmed' without destination confirmation stays source-asserted; missing evidence flagged not synthesized | `IE` | ci-pr | destinationStatus 'not-adjudicated' asserted; 'flags a source-confirmed credit lacking a decision ref instead of synthesizing one' |  |
| Packet, claim-graph and roster digests use their own bytes; a changed byte fails | `IE` | ci-pr | manifest-byte, claim-graph-byte, packet-bytes and roster-digest tests | CRT lineage_sha256 / per-finding manifest_sha256 are carried, not recomputed (documented loss); claim-graph bytes optional (claim-graph-bytes-not-supplied). |
| Adapters independent; record order invariant; duplicates fail closed | `IE` | ci-pr | order-invariance and duplicate tests |  |
| Credit with no displayName representable; nothing leaks via exceptions | `IE` | ci-pr | 'emits only stable codes for every failure path' | Application logging not examined. |
| Fixtures document lossy semantics; no auto-generated refs, ownership, validation or access | `IE` | ci-pr | docs/source-credit-interop.md 10-row loss table; adapter report counts and reason codes |  |
| Rights grant is not scientific support (named test) | `PART` | not-run | sourceRights carried as a declared string with accessEffect none; docs state it. | No test is named for this; recommend adding one (handoff ORAtlas objective). |
| Public original packet import allowed; private packet import denied | `PART` | ci-pr | Lives in lineage code: extractor 'refuses a packet that is not public…'; integration 'never exposes the restricted, unreviewed finding or any quote text'. TRUST importer refuses private/embargoed by default (this-run pass); Diggypaper native validator exit 1 with --for-import (parent-run). | #210 adapters are private-only/offline, so no import-denial test there. |
| Existing public contributors, assertions, CRediT contracts, graph and #208 tests pass unchanged | `NE` | not-run | PR #210 CI: 8 checks pass (snapshot). | No local run; local tree stale vs remote main 230b8a3. |

#### #160 — Add typed citation, mention, evidence-relation, and TRUST discussion subjects (snapshot: OPEN)

- **Whole issue:** not evidenced; independent of the synthetic MVP
- **Engineering slice:** none

| Criterion | Status | Run | Evidence | Gap / next action |
|---|---|---|---|---|
| Typed subjects with stable occurrence identity and threads (UI/API/JSON-LD/moderation) | `NE` | not-run | No such subject kinds found (shallow search of contracts/comments). | Not needed for the synthetic MVP. |

#### #178 — Add versioned canonical graph snapshots and an incremental change feed (snapshot: OPEN)

- **Whole issue:** not evidenced; independent of the synthetic MVP
- **Engineering slice:** none

| Criterion | Status | Run | Evidence | Gap / next action |
|---|---|---|---|---|
| Snapshot id/watermark, ordered change events, cursor/replay, OpenAPI entries | `NE` | not-run | apps/web/src/app/api/graph holds only route.ts and its test; no snapshot/changes route. | Not needed for the synthetic MVP (G4 uses GET /api/graph + passport). |

#### #195 — [EPIC] Federated evidence comparison: Diggypaper + Knowledge Loom + SciClaim2Explore (snapshot: OPEN)

- **Whole issue:** Diggypaper-only slice partial; Loom/SciClaim2Explore not evidenced; independent of MVP
- **Engineering slice:** PR #200 (Diggypaper-only lineage slice)

| Criterion | Status | Run | Evidence | Gap / next action |
|---|---|---|---|---|
| Compare >=2 Diggypaper findings and 1 Loom statement with distinct identities; reviewable relation proposals; 'not available' state; analytical fixture with digests | `PART` | not-run | Diggypaper-only slice via #200; Loom/SciClaim2Explore parts NE. | Its own thread says S5/S6 must not block MVP v0.1. |

### dhuzard/orcid-playground

#### #9 — [INTEROP] Portable ORCID researcher and group-roster assertions for private research workspaces (snapshot: OPEN)

- **Whole issue:** producer contract slice delivered (PR #10, merge ff5aff9); whole issue not complete
- **Engineering slice:** PR #10 merged (ubuntu+windows checks pass)

| Criterion | Status | Run | Evidence | Gap / next action |
|---|---|---|---|---|
| Stable schema-validated demo export parses in an ORAtlas fixture without granting any project access | `IE` | parent-run | roster.py build_export/validate_export/candidate_contacts; tests test_schema_is_valid_draft_2020_12, test_demo_export_is_stable_and_valid, test_consumer_fixture_parses_without_granting_access, test_access_effect_cannot_be_changed. Parent: 24 pass in test_roster.py. THIS PROGRAM: ORAtlas orcid/roster.json and schema byte-identical to ORCID ff5aff9 files; native validate_export returned [] (executed this run, read-only). | ORAtlas-side parse not executed here. |
| Public ORCID, curator attribution, external proof and local membership stay distinct | `IE` | parent-run | test_assertions_keep_public_curated_and_membership_facts_distinct, test_unverified_roster_entry_stays_a_listed_member, test_external_platform_membership_needs_evidence, test_forged_orcid_verification_is_refused, test_credit_is_never_inferred_from_membership_or_outputs | Real OAuth-verified path is ORAtlas #203. |
| Private roster/project data not in public biosketch, feed, team pack or Pages output | `PART` | parent-run | test_private_member_never_leaves_the_workspace, test_default_export_shares_only_orcid_ids, test_public_outputs_never_read_rosters | Feed and team pack exist only in draft PR #7; must re-prove before merge. |
| No automatic accounts/invitations/publishing/ORCID writes; existing network and biosketch tests pass | `PART` | parent-run | ACCESS_EFFECT constant; roster.py has no I/O; test_export_requires_creator_opt_in, test_build_does_not_modify_the_local_group | Only test_roster.py (24) was run; the rest of the suite and the PR #7 network pilot were not. |
| Adapter from network pilot (PR #7) to builder input | `PR_ONLY` | not-run | Depends on draft PR #7. |  |
| Private-workflow integration | `BS` | not-run | docs/roster-assertions.md and issue thread wait on ORAtlas #202. |  |
| Producer golden test for the canonical digest (2026-10-19 comment) | `PART` | not-run | Tampering/redaction/access tests exist; no hard-coded-digest golden test found (demo-export comparison includes the digest). | Handoff ORCID objective. |

#### #6 — Epic: ORCID research network pilot — follow researchers, working groups and team packs (snapshot: OPEN)

- **Whole issue:** first-milestone workstreams exist only in draft PR #7 (checks green, unreviewed); not on main
- **Engineering slice:** none on main; draft PR #7

| Criterion | Status | Run | Evidence | Gap / next action |
|---|---|---|---|---|
| WS1–WS5: ingestion/workspace, feed, UI, rosters/team pack, pilot tests/runbook | `PR_ONLY` | ci-pr | Draft PR #7 head fba68fc (checks pass). The ticked boxes in the issue are the author's claims about PR #7. | Review/merge decision is the owner's; green checks are not a merge-readiness claim. |
| WS6 shared-service milestone (OAuth, per-user authz, invitations, deployment, privacy) | `NE` | not-run | None; thread points OAuth to ORAtlas #203 and membership to #204/Diggypaper #53. | Owner decision on where this lives. |
| WS7 ORCID API access/sync model agreed; premium webhook | `BH` | not-run | Needs agreement with ORCID. |  |
| WS8 digest / collaboration requests | `NE` | not-run | None. | Waits on feedback. |
| A real working-group coordinator completes the pilot and records feedback | `BH` | not-run | No feedback record. | A human coordinator must run the pilot. |

#### #5 — create a social layer were you can follow ORCID s and have upadtes and some stats and interactions, networks and AI enriched features (snapshot: OPEN)

- **Whole issue:** CANDIDATE_SUPERSEDED by #6 — this report observes overlap with #6; no comment or issue-body evidence shows a maintainer proposing that #6 supersedes it, and nothing is owner-ratified; left open and unresolved
- **Engineering slice:** none

| Criterion | Status | Run | Evidence | Gap / next action |
|---|---|---|---|---|
| Follow ORCIDs; updates, stats, interactions, networks; AI-enriched features | `CS` | not-run | Partly overlapped by #6 and draft PR #7; AI-enriched features have no code. | Owner to ratify or reject. |

## 5. Prioritized dependency graph

```
L0 human ─► L1 public synthetic ─► L2 credit slices ─► L3 residual (no #202) ─► MVP v0.1 decision (human)
                                                                   ╲
L0 #202 ratification + counsel/DPIA ─► L4 private (#203 identity plan ─► #204 ─► #205/#206 ─► #207 ─► Diggypaper #53, TRUST #16 connector, ORCID #9 private)
L5 independent: Diggypaper #7 pilot, ORCID #6/#5, ORAtlas #160/#178/#195
```

**L0 human prerequisites (no code)**

- User authorizes repos one at a time (B2)
- User picks durable ORCID clone (B3) and refreshes stale local bases (B5)
- Owner decides coordinator bootstrap (B4)
- Owner reviews ORAtlas PR #211 / counsel+DPIA (B1) — independent of L1–L3

**L1 public synthetic path, already delivered as synthetic slices**

- Diggypaper source-evidence-packet/0.1.0 (frozen) -> Finding Curation MVP #46 slice
- TRUST #10 importer / #11 exporter / links-v2 (PRs 13–15)
- ORAtlas #198 lineage regression (PR #200)

**L2 credit slices, delivered producer/adapter-side**

- Diggypaper #55 companion (PR #56)
- TRUST #17 contributorship (PR #18)
- ORCID #9 roster contract (PR #10)
- ORAtlas #209 adapters (PR #210)

**L3 bounded residual work that does not need #202 (each needs its own authorization)**

- Diggypaper #55: producer-side compatibility check against SourceCreditObservations mapping
- ORAtlas #209: named rights!=support test; pinned-byte check; run on 230b8a3
- TRUST #17: cross-artifact private non-leak scan — done offline in the repair (`tests/contributorship-private-leak.test.mjs`); residual surfaces stay blocked
- TRUST #16: offline manifest schema/CLI/fixtures design (issue allows it independently of #202; not implemented; ORAtlas consumer contract unresolved)
- ORCID #9: golden canonical-digest producer test

**L4 blocked on #202 (private)**

- ORAtlas #202 ratification -> #203 identity plan (ORCID OAuth) -> #204 workspaces (depends on #202 and #203) -> #205 discovery / #206 connectors -> #207 cross-finding credit
- then Diggypaper #53, the TRUST #16 production connector, ORCID #9 private integration

**L5 independent / human-gated**

- Diggypaper #7 pilot (reviewers) -> #1 epic
- ORCID #6 / PR #7 review, #5 ratification
- ORAtlas #160, #178, #195 (not needed for the synthetic MVP)
- MVP v0.1 release decision (#199) and real-data deposit (#198)

The public synthetic path is independent of the private path: #198/#199 do not import the private-credit modules, and #160/#178/#195 need not be forced before the synthetic MVP.

## 6. Native validation executed in this run (original evidence pass; repair run in §6.1)

Run from the bound worktree `/tmp/trust-ecosystem-1a41` at `0db82e1` (clean before and after; logs in `/tmp/ecosystem-validation-1a41/`, not persisted). `mystmd` 1.10.1 was on `PATH` from `/tmp/trust-sync-eb51dbbd-tools`.

| Command | Exit | Result |
|---|---|---|
| `node scripts/validate-trust.js` | 0 | 4 claims, 5 citation contexts, 16 verified passages |
| `node scripts/test-trust-validator.js` | 0 | TRUST validator tests passed |
| `node scripts/validate-community-contracts.js` | 0 | examples PASS; community contract validator tests passed |
| `node --test tests/*.test.mjs (15 files)` | 0 | 144 tests: 143 pass, 0 fail, 0 cancelled, 1 skipped (the real-ORAtlas-extractor test, needs ORATLAS_DIR) |
| `node --test test/*.test.mjs (4 files; mystmd 1.10.1 on PATH from /tmp/trust-sync-eb51dbbd-tools)` | 0 | 25 tests: 25 pass, 0 skipped (contract, compatibility report, golden fixture render, clean-copy TRUST site render) |
| `node tests/fixtures/contributorship/build-fixture.mjs --check` | 0 | contributorship fixture is current |
| `node scripts/release-artifacts/validate-release-artifact-schemas.mjs --root .` | 0 | 9 documents |
| `node scripts/release-artifacts/validate-release-artifact-bundle.mjs --directory release_artifacts/examples` | 0 | release-example-v1-1-0, 4 indexed artifacts |
| `node scripts/oratlas/verify-oratlas-export.mjs --directory .` | 0 | ORAtlas export verified |
| `python3 scripts/build_skill_manifest.py --check` | 0 | 22 skills, pipeline v30 |
| `python3 scripts/check_template_consistency.py` | 0 | 14/14 checks passed |
| `python3 scripts/test_check_template_consistency.py` | 0 | 6 tests OK |
| `python3 scripts/check_prose_fidelity.py --self-test` | 0 | 16/16 self-test cases behaved correctly |
| `node scripts/test_evidence_explorer.mjs` | 0 | 21/21 passed |

Separate pinned-ORAtlas run (`ORATLAS_DIR=/tmp/trust-sync-eb51dbbd-oratlas`, HEAD `9cd3a0c284400b30dd0044cf3acb24df1047275d` = native pin):

| Command | Exit | Result |
|---|---|---|
| `ORATLAS_DIR=/tmp/trust-sync-eb51dbbd-oratlas (HEAD 9cd3a0c284400b30dd0044cf3acb24df1047275d == native pin) node --test tests/oratlas-export.test.mjs` | 0 | 12/12 pass, 0 skipped, including the real extractor ingest |
| `node scripts/oratlas/validate-with-oratlas.mjs --oratlas-dir /tmp/trust-sync-eb51dbbd-oratlas --directory .` | 0 | extractor loaded 4 claims, 5 citations, 5 relations with zero dropped records |

Clean MyST build in a disposable clone (`/tmp/ecosystem-build-1a41`, `0db82e1`; clone stayed clean): `BASE_URL=/ComputationalReviewTemplate_trust-knowledge myst build --html` → exit 0, 5 pages (index, introduction, methods, evidence-database, provenance). Two **pre-existing** `myst.yml` contributor warnings (extra keys ignored; no given name for `Claude`) are unchanged from `docs/upstream-sync-validation.md`; a Node `DEP0169` deprecation notice also appears. The build fetched the unpinned `book-theme` template from GitHub (an already-recorded open item).

Read-only checks by the parent (logs `/tmp/ecosystem-discovery-1a41`), not re-run here:

- pytest tests/test_roster.py -q (PYTHONPATH=/tmp/orcid-discovery-1a41/src, bytecode/cache disabled) → 24 passed
- fcc_validate.py (Diggypaper docs/contracts/finding-credit-companion/v0.1.0/validator) on ORAtlas diggypaper/credit.json with --packet → valid=true, no errors, no warnings; companion digest sha256:acae7c32…11a2, packet digest sha256:64c01a63…7ae48
- sep_validate.py --allow-restricted on the ORAtlas fixture packet → valid=true, warning private-packet-not-exportable
- sep_validate.py --for-import on the same packet → exit 1 (expected negative: private/restricted packet is not importable)

Read-only checks added in this run:

- byte comparison ORAtlas crt/credit.json vs TRUST tests/fixtures/contributorship/expected/contributorship.private.json → identical, sha256 91aa4dfd4bde8e797ee6d8673debd2b498368301f2cc51204d34aa8026af7703
- byte comparison ORAtlas crt/claim-graph.json vs TRUST tests/fixtures/contributorship/claim-graph.json → identical, sha256 5d23f7aaac420c4f25cbc4d1843366be3c80d57ef7beec5b3f3e0d1a7fb6ffec
- byte comparison ORAtlas orcid/roster.json vs ORCID ff5aff9 tests/fixtures/roster/demo-export.json → identical, sha256 6b2cd197557213247c099f9fb84c47817aa48ec008ecc038d8200145db70a96e (closes the 'ORCID bytes not compared' gap in ORAtlas docs/source-credit-interop.md)
- byte comparison ORAtlas schemas/orcid.roster.schema.json vs ORCID ff5aff9 schema/roster-assertion.schema.json → identical, sha256 3ccfc0072ac214cdec86df966c96a7a4212f8cc1058b4cdd62ecfe29813b2e94
- ORCID native validate_export(demo-export.json), read-only, bytecode disabled → errors: [] (schema orcid-playground/roster-assertion 0.1.0)
- ORAtlas diggypaper/credit.json and packet/manifest.json digests → credit.json acae7c329969d1e8617b3b820bf32f06d72c0f0d5e8e76e81f2794e0b2ff11a2; packet manifest 64c01a630dabab2b72dee4f8b2afa20f2fb0aeaca6ac5d4c47b653b56a57ae48 (match the parent's native validator output)
- ancestry in the TRUST object store → 8cc8383 and a19a8dc are ancestors of 0db82e1; f205552 is NOT an ancestor (the Evidence Explorer contract was ported file-by-file, as docs/upstream-sync-validation.md says). In the reference fork 0e36bac, 8cc8383 and f205552 are both ancestors.

**Not run** (and therefore not claimed):

- Diggypaper backend/frontend suites, PostgreSQL-only SEIP guards, Playwright/e2e — no dependencies, services or authorization to run them here; Diggypaper PR snapshots carry NO recorded status checks (all 42 merged PRs have empty rollups), so there is no CI evidence for Diggypaper in the snapshot either; test counts in issue comments are author-reported.
- ORAtlas test suites (vitest/e2e/postgres) — not installed; evidence is PR #200/#208/#210/#212 snapshot checks. The local tree is stale (f6c834b) versus remote main 230b8a3.
- ORCID: only tests/test_roster.py (24, parent-run) and validate_export; the rest of the ORCID suite and draft PR #7 were not run.
- Any private-workspace feature (My Research, connector, cross-finding credit ACL, #53, #16): nothing to run; blocked.
- Real data: none processed. All fixtures are synthetic.

### 6.1 Repair run (this repair)

Run from `/tmp/trust-ecosystem-repair-1a41` (branch `pico/ecosystem-repair-1a41`, base `8bfe33002d78e67273118b7f0969b07f564ce913`; node v24.21.0, Python 3.12.3). Logs are under `/tmp/ecosystem-repair-1a41-logs/` and are not persisted. The repair changes no runtime, schema, contract, workflow or fixture file, so the §6 results above still describe the unchanged code; the rows below were re-executed after the new test was added. Only the TRUST repository was executed; nothing was run in a foreign repository and no foreign CI is claimed.

| Command | Exit | Result |
|---|---|---|
| `node scripts/validate-trust.js` | 0 | 4 claims, 5 citation contexts, 16 verified passages |
| `node scripts/test-trust-validator.js` | 0 | TRUST validator tests passed |
| `node scripts/validate-community-contracts.js` | 0 | examples PASS; community contract validator tests passed |
| `node --test tests/*.test.mjs test/*.test.mjs (20 files: 16 + 4; mystmd 1.10.1 on PATH from /tmp/trust-sync-eb51dbbd-tools)` | 0 | 175 tests: 174 pass, 0 fail, 0 cancelled, 1 skipped (the real-ORAtlas-extractor test, needs ORATLAS_DIR) |
| `node --test tests/*.test.mjs (16 files, run separately)` | 0 | 150 tests: 149 pass, 0 fail, 1 skipped (includes the 6 new tests) |
| `node --test test/*.test.mjs (4 files, run separately)` | 0 | 25 tests: 25 pass, 0 skipped |
| `node --test tests/contributorship-private-leak.test.mjs` | 0 | 6 tests: 6 pass (the new regression, positive and negative cases) |
| `ORATLAS_DIR=/tmp/trust-sync-eb51dbbd-oratlas (HEAD 9cd3a0c284400b30dd0044cf3acb24df1047275d == native pin) node --test tests/oratlas-export.test.mjs` | 0 | 12/12 pass, 0 skipped, including the real extractor ingest |
| `node scripts/oratlas/validate-with-oratlas.mjs --oratlas-dir /tmp/trust-sync-eb51dbbd-oratlas --directory .` | 0 | extractor loaded 4 claims, 5 citations, 5 relations with zero dropped records |
| `node scripts/oratlas/verify-oratlas-export.mjs --directory .` | 0 | ORAtlas export verified |
| `node tests/fixtures/contributorship/build-fixture.mjs --check` | 0 | contributorship fixture is current (fixtures and goldens unchanged) |
| `node scripts/release-artifacts/validate-release-artifact-schemas.mjs --root .` | 0 | 9 documents |
| `node scripts/release-artifacts/validate-release-artifact-bundle.mjs --directory release_artifacts/examples` | 0 | release-example-v1-1-0, 4 indexed artifacts |
| `python3 scripts/build_skill_manifest.py --check` | 0 | 22 skills, pipeline v30 |
| `python3 scripts/check_template_consistency.py` | 0 | 14/14 checks passed |
| `python3 scripts/test_check_template_consistency.py` | 0 | 6 tests OK |
| `python3 scripts/check_prose_fidelity.py --self-test` | 0 | 16/16 self-test cases behaved correctly |
| `node scripts/test_evidence_explorer.mjs` | 0 | 21/21 passed |

Clean MyST build in a disposable clone (`/tmp/ecosystem-repair-build-1a41`, clone of `8bfe330` with this repair's file changes copied in; `docs/`, `provenance/` and `tests/` are not MyST inputs, `content/` is unchanged): `BASE_URL=/ComputationalReviewTemplate_trust-knowledge myst build --html` → exit 0, 5 pages. The same two pre-existing `myst.yml` contributor warnings as before appear, and the unpinned `book-theme` template was again fetched from GitHub. Not a CI run and not a deployed-site check.

The new test uses only synthetic canaries, writes only under a temporary directory it removes, and reads (never writes) `tests/fixtures/contributorship`. Its negative cases (scanner fails on an injected canary in each public artifact; leaking mutations of a disposable clone of the builder are detected; a private-scope packet is refused) are part of the 6 tests above, not separate runs.

### Native test commands and coverage limits

- TRUST: the commands in the table above are the CI set (`.github/workflows/{validate,deploy,contributorship,oratlas-export,source-evidence-import,plugins,skills}.yml`). Coverage is synthetic-fixture only. The real ORAtlas extractor test is skipped without `ORATLAS_DIR`; CI fetches the pin (`oratlas-export.yml`).
- `deploy.yml` installs unpinned `mystmd` and executes notebooks at build time; the deployed site is therefore built differently from what these checks saw (open item recorded in `docs/upstream-sync-validation.md`).
- Outstanding failures in executed suites: **none**. Outstanding *gaps*: see §4 (notably the residual untested surfaces of TRUST #17 criterion 3, the Diggypaper #55 compatibility check, ORAtlas #209 named rights≠support test).

## 7. Synthetic scenario coverage

The ten scenarios below are the ones the user enumerated, in the user's words. An earlier version of this page said the list had not been given and substituted credit-centred rows; that was wrong and is corrected here. The substituted rows are kept at the end only as **supplemental credit subcases** (C1–C10); they do not replace or count toward the requested ten.

Scope of every statement: each TRUST row is a named test running on **synthetic** fixtures in this repository (invented people, `10.5555/` or fictional DOIs, invented sentences). "Pass" means the named tests passed in the repair run (§6.1); it does not mean the behaviour was validated on a real corpus, a real pilot, a real deposit or a real private workspace, and it is not a scientific-validity claim. Rows that mention other repositories refer to tests that were read, not executed. The builder carries `packet.manifest_sha256` and cannot recompute a packet manifest without the packet bytes; those digests are carried values.

| # | Requested scenario | TRUST tests and scripts (exact names) | TRUST result | Gaps and limits |
|---|---|---|---|---|
| 1 | One paper with multiple independently curated findings. | tests/source-evidence-import.test.mjs: 'G2: two findings from one article and one from another import with exact source and reviewer provenance', 'the two findings of one article stay distinct and keep their own context, passages and verification', 'findings are never merged by text, even when two share a sentence', 'revisions are never collapsed: only the latest revision of a finding can be imported'; tests/evidence-links-v2.test.mjs: 'a reviewed map binds only the mapped finding; a second finding of the same paper stays a candidate' | pass (repair run, synthetic packets) | (1) No TRUST test asserts that the findings of one paper were curated by different people: curator independence is a producer-side (Diggypaper) property. Diggypaper test_findings_api.py::test_two_findings_on_one_article_stay_distinct_and_null_results_retained was read, not run. (2) Synthetic G2 packet only; no real paper or pilot. |
| 2 | Source quotation verification and exact-version provenance. | tests/source-evidence-import.test.mjs: 'validator reproduces the producer reference validator on every upstream fixture', 'corrupt hash, length, version and bytes fail closed with no outputs', 'cross-paper links fail: finding to foreign passage, and assessment to a passage the finding does not cite', 'a numeric value absent from the source passage is flagged, not asserted as sourced', 'imported findings are bound to the verified sidecar: editing a finding after import fails the gates', 'idempotent replay: identical input bytes yield identical files and digests'; tests/evidence-links-v2.test.mjs: 'native fields are checked against the packet contract, not just for presence'; scripts/validate-trust.js (script, not node:test): 4 claims, 5 citation contexts, 16 verified passages | pass (repair run) | (1) The importer checks carried hashes, versions and match statuses; packets carry no article full text, so TRUST does not re-run quote matching against source bytes. The matcher lives in Diggypaper (quote_matcher.py; read, not run). (2) Exact-version provenance is a carried snapshot SHA-256 and manifest digest; TRUST cannot recompute a packet manifest without the packet bytes. |
| 3 | Transfer to CRT with claim-to-finding mappings. | tests/evidence-links-v2.test.mjs: 'the S2 lineage sidecar bridges to links/2 and exports passage-level lineage', 'DOI equality alone yields only same-paper candidates, never claim evidence', 'the reviewed map fails closed on every mismatch', 'the exporter refuses inconsistent bindings', 'a DOI the review does not cite is skipped, never linked by text', 'the imported Phase 2 package passes the real Phase 2 and Phase 5 gates, and mapped digests are the vouched ones'; tests/source-evidence-import.test.mjs: 'Gate G2: imported packages pass the Phase 2 import gate and the Phase 5 shape and curation gates', 'importing is opt-in: no native pipeline script or skill invokes the importer' | pass (repair run) | (1) Reviewed mapping decisions in fixtures are synthetic ('Synthetic fixture decision'); no real reviewed mapping or mapping workflow was exercised. (2) The ORAtlas lineage fixture exempts 24 Phase-2 checks as pilot exceptions. |
| 4 | Independent TRUST and human-review assessments. | tests/human-review-plugin.test.mjs: 'transform pairs accepted records with the canonical TRUST target and marks stale text orphaned', 'accepted state requires a real, non-backdated acceptance event and revision', 'loader uses the canonical public contract validator for accepted records', 'fresh production content does not publish example human acceptances'; tests/human-review-widget.test.mjs: 'card is keyboard-native, exposes version/status, escapes comments, and separates TRUST', 'claim annotations reuse stable TRUST DOM ids without reading or changing the score', 'all human stances have explicit non-numeric labels'; tests/release-diff-capsule.test.mjs: 'scientific diff compares frozen values without mutation or TRUST recomputation'; tests/oratlas-export.test.mjs: 'native TRUST v2 is never expressed as an ORAtlas assessment or score'; tests/contributorship.test.mjs: 'credit lineage is kept apart from TRUST and source SEIP judgments'; tests/source-evidence-import.test.mjs: 'outputs carry no TRUST, replication or full-text fields and no reviewer identity beyond the pseudonym'; scripts/validate-community-contracts.js (script): human submission/moderation examples PASS | pass (repair run; 'pass' = separation and contract checks on example records) | (1) Human review is a read-only annotation UI and contract with example records; the identity and moderation services are intentionally unimplemented (docs/HUMAN_REVIEW_AND_PUBLICATION.md). (2) No test takes one claim, assesses it by TRUST and by an independent human reviewer, and carries both through export. The ORAtlas exporter carries only the claim's human_review_required flag (scripts/oratlas/export-oratlas.mjs); human submissions are not exported. (3) Reviewer independence (blinding, conflicts of interest) is not tested; 'independent' here means the two records are stored and rendered separately. |
| 5 | ORCID-linked and non-ORCID human contributors. | tests/contributorship.test.mjs: 'verified and claimed ORCIDs stay distinct and are checked', 'contributors need both the individual and the controller, for this version, before anything about them is public', 'assertion status needs a decision reference except when merely declared', 'the private schema keeps the verified-ORCID and status-reference invariants' | pass (repair run) | (1) Fixture shape: person-a verified ORCID, person-b and person-d claimed ORCID (neither ORCID is published), person-e no ORCID at all (withheld publicly for an approval of another version). No named test asserts a publicly disclosed contributor who has no ORCID. (2) 'verified' is a declared reference checked by schema, not a live ORCID OAuth check (ORAtlas #203, blocked). ORCID playground roster tests (24 pass) were a read-only parent run, not repeated here. |
| 6 | Separate AI-agent/tool provenance and CRediT attribution. | tests/contributorship.test.mjs: 'mixed human + agent review: agents are production records only, never people, ORCIDs or CRediT holders', 'the real content/authors.yml maps to one production agent and no human contributor', 'the MyST authorship widget output is unchanged', 'exactly the 14 ANSI/NISO Z39.104-2022 roles, with legacy spellings normalised but never guessed', 'an invented or misspelt role in declarations is rejected rather than mapped'; tests/authorship-integration-boundary.test.mjs: 'the credit builder still consumes the local parser, and authors.yml names no human' | pass (repair run) | (1) Agent name, version and workflow role are declared fields; nothing verifies them against a real run or trace. (2) CRediT assertions are declarations or decision references on synthetic people, not validated contributions. |
| 7 | Import into ORAtlas with stable graph identities. | tests/oratlas-export.test.mjs: 'committed export is exactly what the exporter regenerates (idempotent)', 'review-authored claim identities and citation bindings are preserved', 'source-native sidecar keeps the claim graph, atoms, groups and TRUST v2 intact and hash-bound', 'producer findings link to review claims at a separate, labelled provenance level', 'the real ORAtlas extractor ingests the export with zero dropped records'; tests/evidence-links-v2.test.mjs: 'bridge and exporter are deterministic and order independent' | pass (repair run); the real-extractor test is skipped in the default run and passed 12/12 only with ORATLAS_DIR at pin 9cd3a0c | (1) The ORAtlas pin 9cd3a0c is not current ORAtlas main (remote 230b8a3 at snapshot). (2) Identity stability across repeated ingests into a running ORAtlas graph is ORAtlas-side and was not run; ORAtlas evidence is historical PR checks. |
| 8 | Versioned publication and evidence exploration. | tests/release-diff-capsule.test.mjs: 'diff rejects mutable, ambiguous, or silently retargeted version lineage', 'RO-Crate 1.3 evidence capsule hashes all four artifact roles deterministically', 'capsule rejects path traversal, hash drift, and incoherent status'; tests/federated-archive.test.mjs: 'federated export uses durable IDs, named provenance graphs, and all relation types', 'aggregate CLI reproduces committed static archive examples and index hashes'; tests/source-evidence-display.test.mjs: 'packet -> curation -> display keeps lineage, digests and native findings unchanged'; test/evidence-explorer-plugin.test.mjs (12 tests, e.g. 'discovers any number of canonical packages in stable numeric order', 'rejects declared future package versions instead of adapting them as legacy'); test/myst-golden-fixtures.test.mjs: 'MyST renders the golden fixture through the production Evidence Explorer'; test/trust-site-render.test.mjs: 'the TRUST site renders its claim, authorship and evidence widgets from a clean copy'; scripts/test_evidence_explorer.mjs (script, 21 cases); release-artifact schema and bundle validators (scripts) | pass (repair run) | (1) Persistent-identifier deposit, a production archive operator and formal editorial governance are intentionally unimplemented (docs/HUMAN_REVIEW_AND_PUBLICATION.md); nothing was published. (2) The deployed site is built differently from the checks (deploy.yml installs unpinned mystmd and executes notebooks). |
| 9 | Private sources must not leak through ANY export or discovery surface. | NEW tests/contributorship-private-leak.test.mjs (6 tests): 'the exact private allowlist is the private companion and the private release report; the public companion is the only public builder output', 'canaries in private builder inputs reach the private companion only; no enumerated public surface contains any, and no input or fixture byte changes', 'a private-scope packet is refused by the importer and produces no public source artifact, canaries included', 'mutation sensitivity: the scanner fails when a canary is inserted into any public artifact', 'mutation sensitivity: a leaking projection in a disposable clone of the builder is caught by the scanner', 'the private origin is bound to the claim that carries no public source credit'; tests/contributorship.test.mjs: 'nothing from an uncleared private origin, unpublished collaborator or rights-protected text reaches the public companion', 'if one of two origins behind a claim is private and uncleared, the claim publishes no source credit at all', 'rights-restricted sources publish no passage hashes', 'the public companion is exactly the allowlisted projection of the private one'; tests/source-evidence-import.test.mjs: 'private and embargoed packets are refused by default and only warn with allowRestricted', 'restricted and private content is withheld or refused, never published', 'a paper whose rights are not redistributable cannot reach the outputs even if the producer approved it' | pass (repair run) for the enumerated surfaces only; the requirement as worded is NOT demonstrated | (1) Tested surfaces (offline, synthetic canaries, scratch directory): the public contributorship companion; the source-evidence importer outputs (phase2, lineage, report) for two public packets; the links/2 bridge output; every file of the ORAtlas export (review-manifest.json, claims, citations, relations, source-native sidecar, compatibility report). The only exempt files are contributorship.private.json and contributorship-release-report.json. (2) NOT tested and still blocked on ORAtlas #202 (security gate) with #203 identity and #204 workspaces: caches, search or discovery indexes, logs, notifications, timing or count side channels, ORAtlas-side surfaces, deployed-site output, access control of any kind, real private data. (3) The exporter and importer have no ACL API. The private credit origin (gamma) is declarations metadata for the credit builder only, so the exporter is never given private material; the test proves that private credit processing does not alter or leak into independently generated public output, and that a private-scope packet is refused. It does not prove that the exporter filters private input. (4) Canaries detect leaked values, not leaked existence or ids, and a finite set of canaries is not universal leak prevention. Mutation checks show the scanner and the builder's allowlist layers react; they do not show the absence of other leaks. |
| 10 | Conflicting, withdrawn, unsupported and superseded evidence. | tests/source-evidence-import.test.mjs: 'every non-accepted record has an explicit status and reasons, and is absent from the outputs' (reviewer-contradiction, source-unavailable, missing-doi, source-sentence-not-verbatim), 'revisions are never collapsed: only the latest revision of a finding can be imported' (superseded-revision), 'a legitimate empty conflict set is accepted only when declared, in imports and in native packages', 'Phase 5 gates still reject what they always rejected' (ALL_CONFLICTS_ASSIGNED fails); tests/source-evidence-display.test.mjs: 'a section that carries its conflict assessment shows it verbatim and does not warn'; tests/release-diff-capsule.test.mjs: 'diff rejects mutable, ambiguous, or silently retargeted version lineage' (claim succession); tests/evidence-radar.test.mjs: 'radar deterministically maps alerts and new works to canonical claims' (a retraction alert yields an advisory proposal only); tests/contributorship.test.mjs: 'contributors need both the individual and the controller, for this version, before anything about them is public' (disputed and withdrawn CRediT assertions stay private); scripts/test-trust-validator.js (script): asserts the 'overextended' evidence relation; scripts/validate-trust.js also derives 'unsupported' and emits unsupported_citation | pass (repair run) for the listed behaviours | (1) Cross-paper conflict detection is not performed: an import sets conflict_assessment to not_assessed, and an empty conflicts[] means not assessed, not that no conflict exists. (2) No test imports a withdrawn or retracted paper or finding and follows it to export; the retraction alert is advisory and writes nothing. 'Withdrawn' is tested only for CRediT assertions and for the human-submission lifecycle in the community contract validator. (3) The native 'unsupported' relation path has no dedicated named test in test-trust-validator.js; no test carries a superseded or conflicting finding through the ORAtlas export. |

Coverage summary: scenarios 1–8 and 10 each have named synthetic tests with the stated gaps; scenario 9 is covered **only** for the enumerated offline surfaces, and its "any export or discovery surface" wording is not met. Not covered by any scenario: real data; live ORCID OAuth; any private-workspace access control; caches, discovery and side channels; ORAtlas run on current remote main.

### Supplemental credit subcases (not the requested ten)

Earlier substituted rows, kept for reference and relabelled C1–C10. Their tests are real and passed in the repair run, but they are credit-attribution details, not additional coverage of the requested scenarios.

| # | Subcase | TRUST tests (exact names) | TRUST result | Other repos | Missing / blocked |
|---|---|---|---|---|---|
| C1 | Two findings from one article, one CRT claim; source curators are not review authors | tests/contributorship.test.mjs: 'one review claim credits two source findings without making their curators review authors'; tests/source-evidence-import.test.mjs: 'G2: two findings from one article and one from another import…', 'the two findings of one article stay distinct…' | pass (this run) | Diggypaper test_finding_credit_companion.py::test_two_findings_of_one_article_keep_distinct_proposers_and_assessments (read, not run); ORAtlas adapter + lineage tests (PR #200/#210 CI green) | Real packet; ORAtlas-side run on current main |
| C2 | Mixed human + agent review; AI stays a production identity, never a person/ORCID/CRediT holder | tests/contributorship.test.mjs: 'mixed human + agent review…', 'the real content/authors.yml maps to one production agent and no human contributor'; tests/authorship-integration-boundary.test.mjs (3) | pass (this run) | ORAtlas private-research-credit contract test (actorKind software); Diggypaper builder test_builder_rejects_non_credit_roles_and_ai_people (read, not run) | none identified at contract level |
| C3 | Claimed vs verified ORCID; human-asserted verification is not destination verification | tests/contributorship.test.mjs: 'verified and claimed ORCIDs stay distinct and are checked', 'assertion status needs a decision reference except when merely declared', 'the private schema keeps the verified-ORCID and status-reference invariants' | pass (this run) | ORCID roster tests incl. test_forged_orcid_verification_is_refused (24 pass, parent-run); ORAtlas adapters keep destinationStatus not-adjudicated and fail closed on elevated claims (CI only) | Live ORCID OAuth verification does not exist (ORAtlas #203, blocked) |
| C4 | 14 CRediT roles, explicit decision references for confirmed assertions | tests/contributorship.test.mjs: 'exactly the 14 ANSI/NISO Z39.104-2022 roles…', 'an invented or misspelt role in declarations is rejected rather than mapped', 'assertion status needs a decision reference…' | pass (this run) | ORAtlas contracts 'supports exactly the 14 CRediT roles…'; adapters CRediT normalization tests (CI only) | dispute/audit workflow in ORAtlas not evidenced |
| C5 | Reviewed claim-finding map vs same-paper DOI candidate | tests/evidence-links-v2.test.mjs: 'DOI equality alone yields only same-paper candidates, never claim evidence', 'a reviewed map binds only the mapped finding; a second finding of the same paper stays a candidate', 'the reviewed map fails closed on every mismatch'; tests/contributorship.test.mjs: 'DOI equality alone credits nothing…' | pass (this run) | ORAtlas adapter test on same-paper candidate (CI only) | none identified |
| C6 | Duplicate finding id+revision from two packets rejected in both input orders | tests/contributorship.test.mjs: 'a finding id + revision supplied by two packets is rejected, whatever the input order'; tests/source-evidence-import.test.mjs: 'revisions are never collapsed…', 'findings are never merged by text…' | pass (this run) | ORAtlas adapters 'rejects a finding duplicated across packets regardless of order' (CI only) | none identified |
| C7 | Lineage binding, exact claim-graph binding and release-report recomputation | tests/contributorship.test.mjs: 'the committed fixture and golden outputs are exactly what the generator and builder produce', 'the private release report names withheld records and is bound to both companions', 'a supplied release report must be the one recomputed from both companions', 'build is deterministic and independent of input order'; tests/source-evidence-import.test.mjs: 'imported findings are bound to the verified sidecar…'; build-fixture.mjs --check | pass (this run) | ORAtlas adapters: manifest-byte and claim-graph-byte change tests (CI only); byte equality of the ORAtlas CRT fixtures with TRUST's expected outputs established this run | The builder carries packet.manifest_sha256 and does not recompute a packet manifest without the packet bytes; ORAtlas claim-graph bytes are optional (reported, not failed) |
| C8 | Private origin / unpublished collaborator / rights-restricted text never reaches the public companion | tests/contributorship.test.mjs: 'nothing from an uncleared private origin, unpublished collaborator or rights-protected text reaches the public companion', 'if one of two origins… is private and uncleared, the claim publishes no source credit at all', 'rights-restricted sources publish no passage hashes', 'contributors need both the individual and the controller…', 'the public companion is exactly the allowlisted projection of the private one' | pass (this run) | ORAtlas lineage integration 'never exposes the restricted, unreviewed finding or any quote text anywhere public' (CI only) | Cross-artifact canary scan added in the repair (tests/contributorship-private-leak.test.mjs); caches, discovery, ACL and real private data remain untested and blocked (see requested scenario 9) |
| C9 | Public original packet import allowed; private/embargoed packet import denied; no real data | tests/source-evidence-import.test.mjs: 'private and embargoed packets are refused by default and only warn with allowRestricted', 'restricted and private content is withheld or refused, never published', 'a paper whose rights are not redistributable cannot reach the outputs…' | pass (this run) | Diggypaper sep_validate.py --for-import exit 1 and --allow-restricted valid+warning (parent-run); ORAtlas extractor 'refuses a packet that is not public…' (CI only) | ORAtlas #210 adapters are private/offline only and have no import-denial test |
| C10 | Rights grant is not scientific support; native TRUST / source SEIP / CRediT credit stay separate | tests/contributorship.test.mjs: 'credit lineage is kept apart from TRUST and source SEIP judgments'; tests/oratlas-export.test.mjs: 'native TRUST v2 is never expressed as an ORAtlas assessment or score'; tests/source-evidence-import.test.mjs: 'outputs carry no TRUST, replication or full-text fields…' | pass (this run) | ORAtlas docs + accessEffect none (CI only) | No test in ORAtlas is named for 'rights grant != scientific support' (PARTIAL; recommended in the ORAtlas handoff objective) |

## 8. Blockers

| ID | Kind | Blocker | Owner |
|---|---|---|---|
| B1 | security-gate | ORAtlas #202 security ADR is unratified (draft PR #211; its aggregate `e2e` check is red with the root cause unverified); counsel/DPIA gate on D11 retention/roles. Blocks the production private features: ORAtlas #203–#207, Diggypaper #53, the TRUST #16 connector and authorization, ORCID #9 private integration. Offline design that the issues allow independently (for example TRUST #16 schema/CLI/fixtures) is not blocked by it. Nothing here auto-approves it. | ORAtlas owner |
| B2 | authorization | Only Neuronautix/ComputationalReviewTemplate_trust-knowledge is authorized for writes. Diggypaper, ORAtlas, ORCID, reference fork and coordinator are read-only until the user authorizes each separately. PICO has no native multi-repo dispatch. | user |
| B3 | checkout | No durable ORCID checkout exists (only a temporary read-only capture at ff5aff9); the user must choose a durable clone location. | user |
| B4 | checkout | Coordinator repo master is unborn; bootstrapping is a separate session and was not done. | user |
| B5 | stale-checkout | Local trust-knowledge main (f205552) is diverged from TRUST origin/main (26 ahead / 84 behind); local ORAtlas main f6c834b is stale versus remote 230b8a3. | user |
| B6 | ci | ORAtlas aggregate `e2e` fails on #211 and #213 while the snapshot shows every `e2e-shard` as success; no job logs were read, so the root cause is unverified. PR #213's author attributes it to a sign-in flake (their explanation, not verified here). #214 (CI budget) is open with checks queued at the snapshot; an open PR is not authorization to merge. None were merged or assessed for merge by this run. | ORAtlas owner |
| B7 | human-science | TRUST decisions D01–D12 are all 'proposed'. Diggypaper #7 pilot needs two independent reviewers and a separate adjudicator (only proposed; acceptance/conflicts/sign-off unrecorded). Rights decision on ORAtlas lineage citation_contexts excerpts. Real-data deposit. | project owners / domain reviewers |
| B8 | ratification | ORCID #5 overlaps #6 and is a candidate superseded issue; no maintainer proposal is evidenced and nothing is owner-ratified. | ORCID owner |

## 9. Risks of this report

- Foreign test names and line references come from read-only inspection by sub-reviewers; they were not executed. Treat them as pointers to verify, not as results.
- Criterion statuses involve judgment (e.g., PARTIAL vs IE). They are conservative: a missing named test is reported as a gap even where the behaviour may exist.
- The snapshot may be out of date; re-snapshot before acting on any PR or issue state.
- The repair's new regression covers a finite, enumerated set of offline surfaces with finite canaries. It is evidence for those surfaces, not a guarantee against leaks elsewhere, and it does not test the exporter as an access-control boundary because none exists.
- Scenario rows list tests that passed on synthetic data; none of them validates a scientific conclusion.
