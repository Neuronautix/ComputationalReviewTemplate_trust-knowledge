#!/usr/bin/env node
// Bridge: S2 `source-evidence-lineage.json` -> S3 `comprev.evidence-packet-links/2`.
//
//   node scripts/source-evidence/lineage-to-links.mjs \
//     --lineage evidence/import/<run>/source-evidence-lineage.json \
//     --claim-graph knowledge/claim_graph.json \
//     [--locator-doi 10.5281/zenodo.123 | --locator-url https://github.com/o/r/releases/download/v1/packet.tar] \
//     [--out knowledge/evidence-links.json]
//
// A finding is bound to a review citation by exact DOI equality with the claim graph and nothing
// else. A DOI that no review citation carries, or that maps to several citation keys, yields no
// link and is listed under `skipped` on stderr; text, title or similarity are never used. The
// packet digest is the SHA-256 of the packet's manifest.json bytes, which the S2 importer already
// records as `manifest_sha256`. Offline and deterministic.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compareText, invariant, isObject, parseArgs, stableJson, writeText } from '../release-artifacts/lib.mjs';
import { EVIDENCE_LINKS_SCHEMA_V2, normalizeLocator } from '../oratlas/export-oratlas.mjs';

const strip = (hash) => String(hash).replace(/^sha256:/u, '');
const normalizeDoi = (doi) => String(doi ?? '').trim().replace(/^(?:doi:\s*|https?:\/\/(?:dx\.)?doi\.org\/)/iu, '').toLowerCase();

export function lineageToLinks(lineage, claimGraph, { locator } = {}) {
  invariant(isObject(lineage) && lineage.schema_version === 'source-evidence-lineage/0.1.0', 'input must be a source-evidence-lineage/0.1.0 file');
  invariant(Array.isArray(lineage.entries), 'lineage entries must be an array');
  const keysByDoi = new Map();
  const claimsByKey = new Map();
  for (const claim of claimGraph.claims) {
    for (const context of claim.citation_contexts ?? []) {
      const doi = normalizeDoi(context.doi);
      if (doi) keysByDoi.set(doi, new Set([...(keysByDoi.get(doi) ?? []), context.cite_key]));
      claimsByKey.set(context.cite_key, new Set([...(claimsByKey.get(context.cite_key) ?? []), claim.claim_id]));
    }
  }
  const findings = [];
  const skipped = [];
  for (const entry of lineage.entries) {
    const findingId = entry.finding.finding_id;
    const keys = [...(keysByDoi.get(normalizeDoi(entry.doi)) ?? [])];
    if (keys.length !== 1) {
      skipped.push({ finding_id: findingId, reason: keys.length === 0 ? 'doi-not-cited-by-review' : 'doi-maps-to-multiple-citations' });
      continue;
    }
    findings.push({
      finding_id: findingId,
      finding_revision: entry.finding.revision,
      source_sha256: strip(entry.article.source_snapshot.sha256),
      cite_key: keys[0],
      doi: entry.doi,
      claim_ids: [...claimsByKey.get(keys[0])].sort(compareText),
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
    });
  }
  findings.sort((a, b) => compareText(a.finding_id, b.finding_id) || a.finding_revision - b.finding_revision);
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
  const { links, skipped } = lineageToLinks(
    JSON.parse(readFileSync(resolve(args.lineage), 'utf8')),
    JSON.parse(readFileSync(resolve(args['claim-graph']), 'utf8')),
    { locator },
  );
  const out = resolve(args.out ?? 'knowledge/evidence-links.json');
  writeText(out, stableJson(links));
  process.stdout.write(`Wrote ${links.findings.length} link(s) to ${out}\n`);
  if (skipped.length > 0) process.stderr.write(`Skipped (not linked): ${JSON.stringify(skipped)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
