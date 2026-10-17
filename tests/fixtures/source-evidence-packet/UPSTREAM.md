# Upstream provenance

`upstream-valid/` and `upstream-invalid/` are byte-for-byte copies of
`docs/contracts/source-evidence-packet/v0.1.0/fixtures/{valid,invalid}` from
[dhuzard/diggypaper](https://github.com/dhuzard/diggypaper) at commit
`303e3771e79c938b45ca8a9d2941b0706e09189c` (PR #48, contract issue #47). Each invalid case carries
an `expected.json` listing the error codes the producer's reference validator emits; the importer
test suite requires this repository's validator to emit exactly the same code set.

`g2-pilot/` is generated here by `build-g2-fixture.mjs` (synthetic data only). Do not edit it by
hand; regenerate and commit. The test suite fails if the committed bytes differ from a fresh build.
