# Contributorship and source-finding credit (`comprev.contributorship/1`)

An **optional** companion that records who contributed what to an exact review version, and
which external source findings a review claim inherits, without inflating authorship. Nothing in
the default pipeline calls it. It does not change `review-manifest.json`, the S2 source-evidence
importer, the S3/ORAtlas exporter or the MyST authorship widget. Issue
[#17](https://github.com/Neuronautix/ComputationalReviewTemplate_trust-knowledge/issues/17).

> **Status: producer-side proposal.** The shared cross-project credit contract and the
> permission-aware projection belong to ORAtlas
> ([dhuzard/oratlas#207](https://github.com/dhuzard/oratlas/issues/207)); this companion is the
> CRT producer side and will be aligned with it. No hosted route, authentication or group feature
> is added. Do **not** wire it into private production workflows until the security model in
> ORAtlas #202 is approved.

## Usage

```bash
node scripts/contributorship/build.mjs --config contributorship.config.json [--out-dir dir]
```

```json
{
  "declarations": "contribution-declarations.json",
  "claim_graph": "../knowledge/claim_graph.json",
  "authors": "../content/authors.yml",
  "sources": [
    { "lineage": "evidence/import/<run>/source-evidence-lineage.json", "claim_finding_map": "knowledge/claim-finding-map.json" }
  ]
}
```

Paths are relative to the config file. `authors` and `sources` are optional. The builder is
deterministic (no clock, network or randomness) and order independent.

| Output | Visibility | Content |
| --- | --- | --- |
| `contributorship.private.json` | authorised workspace only | Full record: every contributor, assertion, legacy label, source origin (incl. private project ref/title), curator pseudonyms, decision refs, and each record's disclosure decision. |
| `contributorship.public.json` | publishable | The private record projected through `PUBLIC_ALLOWLIST`, cleared records only. |
| `contributorship-release-report.json` | private (names ids) | Digests of both companions and of the allowlist, public counts, every withheld record with its reason. |

Schemas: [`docs/contracts/contributorship/v1/`](contracts/contributorship/v1/) —
`contribution-declarations`, `contributorship.private`, `contributorship.public`,
`contributorship-release-report` (JSON Schema 2020-12, checked by
`scripts/release-artifacts/json-schema.mjs`).

## Separate credit channels

| Who | Where | Never |
| --- | --- | --- |
| Human review/claim contributors and human reviewers | `contributors[]` + `credit_assertions[]` | a role outside the 14 CRediT roles |
| Software agents and tools (LLM pipelines, validators) | `production.agent_runs[]`: name, version, workflow role, producer | a person, an ORCID, a CRediT assertion |
| Authors of a cited work | `source_credit[].findings[].cited_work.authors` (`credit_kind: bibliographic-citation`) | contributors of this review |
| Source finding curators/assessors (Diggypaper) | private `source_assessments[].curator_ref` (`source-native-pseudonym`); `source_curation: {credit_channel: source-native, review_authorship: false}` | review authors; named in public output |
| Person proposing a cross-finding relation | `relation_proposals[].proposed_by` (a human contributor) | implied by the existence of the relation |

A CRediT assertion is a statement of contribution. It is not publication authorship, editorial
acceptance, a citation count, `source-verified`, or native TRUST. No TRUST score and no SEIP
judgment is converted; source `seip-support-v1` assessment ids and statuses are carried as is.

## CRediT assertions

* Roles are the 14 ANSI/NISO Z39.104-2022 roles, by slug (`writing-review-editing`), with the
  standard label and `https://credit.niso.org/contributor-roles/<slug>/` URI added by the builder.
  Anything else in declarations is rejected.
* `degree`: `lead | equal | supporting` or absent.
* `status`: `declared` (no reference) or `confirmed | disputed | withdrawn` (needs `status_ref`).
  Only `declared` and `confirmed` are ever public.
* `source_kind`/`source_ref`: who made the assertion (`self-declared`, `corresponding-author`,
  `controller`; `legacy-author-file` for imported labels). `source_ref` stays private.
* `target`: the whole review version or one `claim_id` in the bound claim graph. The subject binds
  every assertion to `review_id`, `version` and the SHA-256 of the claim graph bytes.
* ORCID: `claimed` or `verified`; `verified` requires a declared verification (`orcid-oauth` or
  `controller-check`, reference, time). Check digits are validated. An ORCID in `authors.yml` is
  only ever `claimed`.

### Legacy `content/authors.yml`

The author file is read, never written. Each `roles` entry and `credit_levels[].role` is kept
verbatim in `legacy_role_labels` (private) with its field, position and level, and mapped by case,
dash/ampersand and spacing normalisation only (`Writing – Original Draft` → `writing-original-draft`;
`Visualisation` → `visualization`). A label that does not name exactly one role (e.g.
`Statistics`) is marked `unmappable`; no role is invented. Entries with `is_ai_tool: true` become
`production.agent_runs` (version/role/producer stay `null` unless declared) and their labels are
`credit_eligible: false`. For human entries, mapped labels yield `declared` assertions unless the
declarations already assert that role. A human who appears only in the author file has no
approval and stays private; to publish them, declare them with `legacy_author_id` and approve.

The MyST widget still reads the same file the same way; its output is pinned by a test.

## Source-finding credit lineage

Built only from reviewed `comprev.claim-finding-map/1` decisions, validated against the exact
lineage bytes, Phase 2 finding digest and claim citations by
`scripts/source-evidence/lineage-to-links.mjs`. Per finding: `finding_id`, `finding_revision`,
`phase2_finding_sha256`, `packet.manifest_sha256`, cited-work DOI/key/authors, passage ids and
`quote_sha256` (only when the source rights say `redistribution: allowed`), and source assessment
ids/protocol/status. Quotation text, rationales and finding statements are never copied, not even
privately. A DOI match without a decision credits nothing.

Every lineage's packet must be declared in `source_origins` as `public` or `private`. A private
origin may carry a `project_ref` and `project_title`; they never leave the private companion.

## Disclosure and the public allowlist

Approvals (`disclosure_approvals`) are bound to `subject_version`; an approval for another
version does not count.

| Subject | Public only when |
| --- | --- |
| Contributor | one approval for this version carries **both** an `individual` and a `controller` grant and approves `display_name`. `orcid` and `credit_assertions` (with the credit statement) each need their own field. |
| Private source origin | a `controller` grant for this version. Public origins need none. |
| Source credit for a claim | every origin behind every mapped finding is cleared. Otherwise the claim publishes **no** source credit (never a public evidence claim with hidden sources). |
| Relation proposal | a `controller` grant, a disclosed proposer and cleared origins for all findings. |

Missing clearance means the record stays private. The builder never infers consent.

`PUBLIC_ALLOWLIST` in `scripts/contributorship/build.mjs` and the closed objects of
`contributorship.public.schema.json` name the same fields (tested). The public companion is
exactly `projectPublic(private)`: records are filtered and restricted to allowlisted keys, values
are never renamed or recomputed, and only `visibility` differs. `validateCompanions` re-derives the
projection and rejects any other public file.

## Fixtures and tests

`tests/fixtures/contributorship/` is fully synthetic: `10.5555/` test DOIs, invented people, the
ORCID test identity `0000-0002-1825-0097` and checksum-valid `0000-0000-0000-…` values outside
issued ranges. Two public packets (alpha, beta) back one claim; a private packet (gamma) backs
another. `build-fixture.mjs` regenerates lineages, maps and the golden `expected/` outputs
(`--check` fails if anything is stale).

```bash
node tests/fixtures/contributorship/build-fixture.mjs --check
node --test tests/contributorship.test.mjs
```
