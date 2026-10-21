# Offline working-project artifact descriptor (producer draft)

Implements the independent offline tranche of [TRUST #16](https://github.com/Neuronautix/ComputationalReviewTemplate_trust-knowledge/issues/16).
`research-project-artifacts/0.1` is a producer draft, not an implemented ORAtlas
connector or a ratified `ResearchProjectDescriptor` consumer contract. Schema:
[`manifest.schema.json`](contracts/project-artifacts/v0.1/manifest.schema.json).

The descriptor itself is always private (`scope: private-descriptor`), including
when it references an intentionally released artifact. It contains project
metadata and local paths: never put it under MyST content, evidence, Pages,
public export, or other automatically published directories. The existing public
`review-manifest.json`, JSONL exporter and native TRUST contracts are unchanged.
There is no automatic public metadata projection, publication, network request,
credential delegation, source discovery or document copy.

## Reproduce the synthetic demo

From the repository root, choose a protected output location outside the
publication tree (the command refuses an existing output):

```bash
node scripts/project-artifacts/build.mjs \
  tests/fixtures/project-artifacts/declaration.json \
  tests/fixtures/project-artifacts \
  /YOUR/PRIVATE/DIRECTORY/project-artifacts.private.json
node --test tests/project-artifacts.test.mjs
```

The synthetic fixture includes one unpublished working draft, a reviewed graph
and a deliberately released version in a synthetic private GitHub repository.
No real private materials, collaborator identities or grants are used.
`expected.private.json` is a synthetic golden only; real descriptors must not be
committed to a public fixture directory.

The declaration and output share the strict schema. Each artifact names exact
local bytes, SHA-256, a stable producer-local id, a repository-relative path,
kind, declared `working|reviewed|released` state, visibility, rights and clearance.
The CLI validates all hashes and lengths before writing anything. It sorts
artifact ids and object keys, preserving input bytes; it adds no timestamp.
Changed bytes, withdrawn clearance, duplicate ids/paths, unsafe paths and paths
resolving outside the root are rejected. Public artifacts require released state
and explicit redistribution rights. These are declaration consistency checks:
**they do not prove review, consent, legal rights or publication approval**.
A restricted/private artifact can remain locally described even when its
redistribution is prohibited or unknown; its contents are never emitted.

A GitHub provider is represented by `owner/repository` and an exact 40-character
commit, without a URL, userinfo, token or arbitrary provider extension fields.
The CLI verifies file bytes, not Git history: the declared commit is an assertion
and must be independently checked before future ingestion. Never put secrets in
free-text fields (project question, workflow, license, generator metadata).
Closed schemas prevent credential fields; arbitrary free-text secret detection
is neither implemented nor claimed.

Generator name/version/role/run id is software provenance only. No author,
ORCID, principal, membership or authorization field is inferred. A future
contributorship artifact can reference the existing `comprev.contributorship/1`
companion as exact bytes; this draft never flattens its human/agent/curator
channels or converts native TRUST/SEIP judgments. Public MyST authorship rendering
is unchanged.

## ORAtlas boundary and remaining acceptance

[ORAtlas #206](https://github.com/dhuzard/oratlas/issues/206) calls for producer
project ids, immutable artifact references, permissions, provenance, processing
policy and separately typed contributor assertions. This draft provides local
project/artifact identity, exact hashes/commit, declared states/rights, workflow
and generator provenance. Its fixed `access_effect: none` is explicit: nothing
here is an actor-account binding or verified grant. It cannot be used as proof
that a principal may discover or read any private metadata.

The following remain consumer decisions or separately gated implementation:

- Ratified ORAtlas descriptor field mapping, media types, provider adapters,
  deep links and typed credit-companion negotiation.
- Actual commit-to-file binding and source permission checks; grant scope,
  expiry, withdrawal, replay prevention and inaccessible/stale status handling.
- Principal-scoped listing, storage, retention and protected source retrieval.
- An explicit, consent-checked public metadata allowlist and release gate.

No provider access is tested or granted. Owner-only output mode is best effort
and does not replace Windows/provider ACLs or protect an unsafe destination.
Keep production private ingestion blocked on ORAtlas #202 and #203/#204. #16
stays open: offline descriptor generation does not fulfill connector acceptance.
