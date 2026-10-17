#!/usr/bin/env node
// Bridge: S2 `source-evidence-lineage.json` (+ a reviewed claim→finding map) -> S3
// `comprev.evidence-packet-links/2`.
//
//   node scripts/source-evidence/lineage-to-links.mjs \
//     --lineage evidence/import/<run>/source-evidence-lineage.json \
//     --claim-graph knowledge/claim_graph.json \
//     [--claim-finding-map knowledge/claim-finding-map.json] \
//     [--locator-doi 10.5281/zenodo.123 | --locator-url https://github.com/o/r/releases/download/v1/packet.tar] \
//     [--out knowledge/evidence-links.json]
//
// Two bindings are kept apart:
//  * reviewed-mapping: a review author recorded, in `comprev.claim-finding-map/1`, that a specific
//    claim uses a specific finding revision. The decision is bound to the exact lineage sidecar bytes
//    and to the imported Phase 2 finding digest, so editing either breaks it.
//  * same-paper-candidate: the finding is about a paper the claim cites (exact DOI equality), and
//    nothing more. A paper reporting several outcomes yields several candidates; none of them is
//    evidence for the claim until it is mapped.
// A DOI that no review citation carries, or that maps to several citation keys, yields no link and is
// listed under `skipped`. Text, title or similarity are never used. The packet digest is the SHA-256 of
// the packet's manifest.json bytes, which the S2 importer records as `manifest_sha256`.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compareText, invariant, isObject, parseArgs, stableJson, writeText } from '../release-artifacts/lib.mjs';
import { sha256 } from './canonical.mjs';
import { EVIDENCE_LINKS_SCHEMA_V2, normalizeLocator } from '../oratlas/export-oratlas.mjs';

export const CLAIM_FINDING_MAP_SCHEMA = 'comprev.claim-finding-map/1';
const TAGGED = /^sha256:[a-f0-9]{64}$/u;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u;
const strip = (hash) => String(hash).replace(/^sha256:/u, '');
const normalizeDoi = (doi) => String(doi ?? '').trim().replace(/^(?:doi:\s*|https?:\/\/(?:dx\.)?doi\.org\/)/iu, '').toLowerCase();

function citationIndex(claimGraph) {
  const keysByDoi = new Map();
  const claimsByKey = new Map();
  const claimIds = new Set();
  for (const claim of claimGraph.claims) {
    claimIds.add(claim.claim_id);
    for (const context of claim.citation_contexts ?? []) {
      const doi = normalizeDoi(context.doi);
      if (doi) keysByDoi.set(doi, new Set([...(keysByDoi.get(doi) ?? []), context.cite_key]));
      claimsByKey.set(context.cite_key, new Set([...(claimsByKey.get(context.cite_key) ?? []), claim.claim_id]));
    }
  }
  return { keysByDoi, claimsByKey, claimIds };
}

/** Validate a reviewed claim→finding map against the exact lineage bytes; fail closed on any mismatch. */
export function validateClaimFindingMap(map, lineage, lineageBytes, claimGraph) {
  invariant(isObject(map) && map.schema === CLAIM_FINDING_MAP_SCHEMA, `claim-finding map must declare schema ${CLAIM_FINDING_MAP_SCHEMA}`);
  // Same tagged form as the importer's import_provenance.lineage_sha256.
  invariant(map.lineage_sha256 === sha256(Buffer.from(lineageBytes)), 'claim-finding map is bound to a different lineage sidecar (lineage_sha256 mismatch)');
  invariant(Array.isArray(map.mappings), 'claim-finding map mappings must be an array');
  const { keysByDoi, claimsByKey, claimIds } = citationIndex(claimGraph);
  const seen = new Set();
  return map.mappings.map((mapping, index) => {
    const label = `claim-finding map mappings[${index}]`;
    invariant(isObject(mapping), `${label} must be an object`);
    invariant(claimIds.has(mapping.claim_id), `${label}: unknown review claim ${mapping.claim_id}`);
    invariant(Number.isInteger(mapping.finding_revision) && mapping.finding_revision >= 1, `${label}.finding_revision must be an integer >= 1`);
    invariant(TAGGED.test(mapping.phase2_finding_sha256 || ''), `${label}.phase2_finding_sha256 must be sha256:<64 hex>`);
    invariant(typeof mapping.decision_ref === 'string' && mapping.decision_ref.trim(), `${label}.decision_ref is required`);
    invariant(typeof mapping.asserted_at === 'string' && TIMESTAMP.test(mapping.asserted_at), `${label}.asserted_at must be an RFC 3339 UTC timestamp`);
    invariant(typeof mapping.basis === 'string' && mapping.basis.trim(), `${label}.basis is required`);
    const entry = lineage.entries.find((candidate) => candidate.finding.finding_id === mapping.finding_id && candidate.finding.revision === mapping.finding_revision);
    invariant(entry, `${label}: ${mapping.finding_id} revision ${mapping.finding_revision} is not an accepted finding in the lineage sidecar`);
    invariant(entry.phase2_finding_sha256 === mapping.phase2_finding_sha256, `${label}: phase2_finding_sha256 does not match the imported finding`);
    const keys = [...(keysByDoi.get(normalizeDoi(entry.doi)) ?? [])];
    invariant(keys.length === 1, `${label}: the finding's DOI does not resolve to exactly one review citation`);
    invariant(claimsByKey.get(keys[0])?.has(mapping.claim_id), `${label}: claim ${mapping.claim_id} does not cite ${keys[0]}, the finding's paper`);
    const pair = `${mapping.claim_id}|${mapping.finding_id}`;
    invariant(!seen.has(pair), `${label} maps ${pair} twice`);
    seen.add(pair);
    return { ...mapping };
  });
}

export function lineageToLinks(lineageBytes, claimGraph, { locator, claimFindingMap } = {}) {
  const lineage = JSON.parse(Buffer.from(lineageBytes).toString('utf8'));
  invariant(isObject(lineage) && lineage.schema_version === 'source-evidence-lineage/0.1.0', 'input must be a source-evidence-lineage/0.1.0 file');
  invariant(Array.isArray(lineage.entries), 'lineage entries must be an array');
  const mappings = claimFindingMap ? validateClaimFindingMap(claimFindingMap, lineage, lineageBytes, claimGraph) : [];
  const { keysByDoi, claimsByKey } = citationIndex(claimGraph);
  const findings = [];
  const skipped = [];
  for (const entry of lineage.entries) {
    const findingId = entry.finding.finding_id;
    const keys = [...(keysByDoi.get(normalizeDoi(entry.doi)) ?? [])];
    if (keys.length !== 1) {
      skipped.push({ finding_id: findingId, reason: keys.length === 0 ? 'doi-not-cited-by-review' : 'doi-maps-to-multiple-citations' });
      continue;
    }
    const detail = {
      finding_id: findingId,
      finding_revision: entry.finding.revision,
      source_sha256: strip(entry.article.source_snapshot.sha256),
      cite_key: keys[0],
      doi: entry.doi,
      verification_level: entry.finding.verification_level,
      passages: entry.passages.map((passage) => ({
        passage_id: passage.passage_id,
        quote_sha256: passage.quote_sha256,
        quote_state: passage.quote_state,
        match_status: passage.match.status,
      })),
      assessments: entry.native_assessments.map((assessment) => ({
        assessment_id: assessment.assessment_id,
        protocol: assessment.protocol,
        status: assessment.status,
      })),
    };
    const mapped = mappings
      .filter((mapping) => mapping.finding_id === findingId && mapping.finding_revision === entry.finding.revision)
      .sort((a, b) => compareText(a.claim_id, b.claim_id));
    const mappedIds = new Set(mapped.map((mapping) => mapping.claim_id));
    if (mapped.length > 0) {
      findings.push({
        ...detail,
        binding: 'reviewed-mapping',
        phase2_finding_sha256: entry.phase2_finding_sha256,
        claim_ids: mapped.map((mapping) => mapping.claim_id),
        mappings: mapped.map(({ claim_id, decision_ref, asserted_at, basis }) => ({ claim_id, decision_ref, asserted_at, basis })),
      });
    }
    const candidates = [...claimsByKey.get(keys[0])].filter((id) => !mappedIds.has(id)).sort(compareText);
    if (candidates.length > 0) findings.push({ ...detail, binding: 'same-paper-candidate', claim_ids: candidates });
  }
  findings.sort((a, b) => compareText(a.finding_id, b.finding_id) || a.finding_revision - b.finding_revision || compareText(a.binding, b.binding));
  const links = {
    schema: EVIDENCE_LINKS_SCHEMA_V2,
    producer: 'diggypaper',
    packet: { id: lineage.packet.packet_id, sha256: strip(lineage.packet.manifest_sha256) },
    findings,
  };
  const normalized = normalizeLocator(locator);
  if (normalized) links.packet.locator = normalized;
  return { links, skipped };
}

function main() {
  const args = parseArgs(process.argv.slice(2), ['lineage', 'claim-graph']);
  invariant(!(args['locator-doi'] && args['locator-url']), 'give at most one of --locator-doi and --locator-url');
  const locator = args['locator-doi']
    ? { kind: 'doi', doi: args['locator-doi'] }
    : args['locator-url']
      ? { kind: 'github-release-asset', url: args['locator-url'] }
      : undefined;
  const claimFindingMap = args['claim-finding-map'] ? JSON.parse(readFileSync(resolve(args['claim-finding-map']), 'utf8')) : undefined;
  const { links, skipped } = lineageToLinks(
    readFileSync(resolve(args.lineage)),
    JSON.parse(readFileSync(resolve(args['claim-graph']), 'utf8')),
    { locator, claimFindingMap },
  );
  const out = resolve(args.out ?? 'knowledge/evidence-links.json');
  writeText(out, stableJson(links));
  const reviewed = links.findings.filter((finding) => finding.binding === 'reviewed-mapping').length;
  process.stdout.write(`Wrote ${links.findings.length} link(s) (${reviewed} reviewed mapping(s)) to ${out}\n`);
  if (skipped.length > 0) process.stderr.write(`Skipped (not linked): ${JSON.stringify(skipped)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
