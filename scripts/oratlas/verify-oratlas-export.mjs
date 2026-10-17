#!/usr/bin/env node

// Offline verifier for an ORAtlas export directory. It mirrors the strict ORAtlas
// import contracts (contract-pin.mjs), checks cross-file integrity, and verifies
// that the source-native companion still binds the original review files by hash.
// The authoritative check against the real extractor is validate-with-oratlas.mjs.

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isObject, parseArgs, sha256, validateSourceNativeProvenance } from '../release-artifacts/lib.mjs';
import {
  CLAIM_TYPES,
  COMMIT_PATTERN,
  DOI_PATTERN,
  LIMITS,
  MANIFEST_SCHEMA_VERSION,
  PMID_PATTERN,
  RELATION_TYPES,
  REVIEW_TYPES,
  isSafeRepoRelativePath,
} from './contract-pin.mjs';
import { EXPORT_VERSION, REPORT_SCHEMA, SIDECAR_SCHEMA } from './export-oratlas.mjs';

function hasOnly(record, allowed) {
  return Object.keys(record).every((key) => allowed.includes(key));
}
const str = (value, max, min = 0) => typeof value === 'string' && value.length >= min && value.length <= max;

// Each validator returns an array of problems for one parsed record.
export function claimProblems(record) {
  if (!isObject(record) || !hasOnly(record, ['id', 'text', 'section', 'anchor', 'claimType', 'qualification', 'scope'])) return ['unknown or malformed claim keys'];
  const problems = [];
  if (!str(record.id, LIMITS.claim.id, 1)) problems.push('id');
  if (!str(record.text, LIMITS.claim.text, 1)) problems.push('text');
  for (const key of ['section', 'anchor']) if (record[key] !== undefined && !str(record[key], 300)) problems.push(key);
  if (record.claimType !== undefined && !CLAIM_TYPES.includes(record.claimType)) problems.push('claimType');
  if (record.scope !== undefined) {
    if (!isObject(record.scope) || !hasOnly(record.scope, ['population', 'model', 'intervention', 'outcome', 'method', 'exclusions', 'analysisPlan'])) problems.push('scope');
    else if (Object.values(record.scope).some((value) => !str(value, 1000))) problems.push('scope values');
  }
  return problems;
}

export function citationProblems(record) {
  if (!isObject(record)) return ['not an object'];
  const problems = [];
  if (!str(record.id, LIMITS.citation.id, 1)) problems.push('id');
  if (record.doi !== undefined && !(typeof record.doi === 'string' && DOI_PATTERN.test(record.doi))) problems.push('doi');
  if (record.pmid !== undefined && !(typeof record.pmid === 'string' && PMID_PATTERN.test(record.pmid))) problems.push('pmid');
  if (record.title !== undefined && !str(record.title, LIMITS.citation.title)) problems.push('title');
  if (record.authors !== undefined && !(Array.isArray(record.authors) && record.authors.length <= LIMITS.citation.authors && record.authors.every((a) => str(a, LIMITS.citation.author)))) problems.push('authors');
  if (record.year !== undefined && !(Number.isInteger(record.year) && record.year >= 1500 && record.year <= 2100)) problems.push('year');
  if (record.source !== undefined && !str(record.source, LIMITS.citation.source)) problems.push('source');
  if (record.url !== undefined) {
    let ok = false;
    try { ok = new URL(record.url).protocol === 'https:' || new URL(record.url).protocol === 'http:'; } catch { ok = false; }
    if (!ok || record.url.length > LIMITS.citation.url) problems.push('url');
  }
  return problems;
}

export function relationProblems(record) {
  if (!isObject(record) || !hasOnly(record, ['claimId', 'citationId', 'relationType', 'supportDirection', 'sourceLocation', 'extractionMethod', 'extractionConfidence', 'humanReviewed'])) return ['unknown or malformed relation keys'];
  const problems = [];
  if (!str(record.claimId, 120, 1)) problems.push('claimId');
  if (!str(record.citationId, 120, 1)) problems.push('citationId');
  if (!RELATION_TYPES.includes(record.relationType)) problems.push('relationType');
  if (record.sourceLocation !== undefined && !str(record.sourceLocation, LIMITS.relation.sourceLocation)) problems.push('sourceLocation');
  if (record.extractionMethod !== undefined && !str(record.extractionMethod, LIMITS.relation.extractionMethod)) problems.push('extractionMethod');
  return problems;
}

export function manifestProblems(manifest) {
  if (!isObject(manifest)) return ['manifest is not an object'];
  const problems = [];
  if (!hasOnly(manifest, ['schemaVersion', 'review', 'repository', 'publication', 'contact', 'contributors', 'artifacts'])) problems.push('unknown top-level key');
  if (manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION) problems.push(`schemaVersion must be ${MANIFEST_SCHEMA_VERSION}`);
  if (!isObject(manifest.review) || !str(manifest.review.title, 500, 1)) problems.push('review.title');
  else if (manifest.review.reviewType !== undefined && !REVIEW_TYPES.includes(manifest.review.reviewType)) problems.push('review.reviewType');
  if (!isObject(manifest.repository) || !/^https:\/\//u.test(manifest.repository.url || '')) problems.push('repository.url');
  else if (manifest.repository.commit !== undefined && !COMMIT_PATTERN.test(manifest.repository.commit)) problems.push('repository.commit');
  if (manifest.artifacts !== undefined) {
    if (!isObject(manifest.artifacts) || !hasOnly(manifest.artifacts, ['claims', 'citations', 'relations', 'trustAssessments', 'provenance'])) problems.push('artifacts keys');
    else for (const [key, path] of Object.entries(manifest.artifacts)) if (!isSafeRepoRelativePath(path)) problems.push(`artifacts.${key} path`);
  }
  return problems;
}

function parseJsonl(text, label, problemsFor, problems) {
  const records = [];
  if (text.length > 0 && !text.endsWith('\n')) problems.push(`${label}: truncated (no trailing newline)`);
  text.split('\n').forEach((line, index) => {
    if (!line.trim()) return;
    let value;
    try { value = JSON.parse(line); } catch { problems.push(`${label}:${index + 1}: invalid JSON`); return; }
    const found = problemsFor(value);
    if (found.length > 0) problems.push(`${label}:${index + 1}: ${found.join(', ')}`);
    else records.push(value);
  });
  return records;
}

// Returns an array of human-readable problems; empty means the export verifies.
export function verifyOratlasExport(directory) {
  const problems = [];
  const root = resolve(directory);
  const readText = (path) => (existsSync(join(root, path)) ? readFileSync(join(root, path), 'utf8') : null);
  const manifestText = readText('review-manifest.json');
  if (manifestText === null) return ['review-manifest.json is missing'];
  let manifest;
  try { manifest = JSON.parse(manifestText); } catch { return ['review-manifest.json is not valid JSON']; }
  problems.push(...manifestProblems(manifest).map((problem) => `manifest: ${problem}`));
  const artifacts = manifest.artifacts ?? {};
  const texts = {};
  for (const key of ['claims', 'citations', 'relations', 'provenance']) {
    if (!artifacts[key]) { problems.push(`manifest does not declare artifacts.${key}`); continue; }
    texts[key] = readText(artifacts[key]);
    if (texts[key] === null) problems.push(`declared artifact ${artifacts[key]} is missing`);
  }
  if (problems.length > 0 && (texts.claims === undefined || texts.citations === undefined || texts.relations === undefined)) return problems;
  if (texts.claims === null || texts.citations === null || texts.relations === null) return problems;

  const claims = parseJsonl(texts.claims, 'claims', claimProblems, problems);
  const citations = parseJsonl(texts.citations, 'citations', citationProblems, problems);
  const relations = parseJsonl(texts.relations, 'relations', relationProblems, problems);
  const claimIds = new Set(claims.map((claim) => claim.id));
  const citationIds = new Set(citations.map((citation) => citation.id));
  if (claimIds.size !== claims.length) problems.push('claims: duplicate id');
  if (citationIds.size !== citations.length) problems.push('citations: duplicate id');
  const pairs = new Set();
  for (const relation of relations) {
    if (!claimIds.has(relation.claimId) || !citationIds.has(relation.citationId)) problems.push(`relations: ${relation.claimId}->${relation.citationId} references an unknown claim or citation`);
    const pair = `${relation.claimId}\u0000${relation.citationId}`;
    if (pairs.has(pair)) problems.push(`relations: duplicate ${relation.claimId}->${relation.citationId}`);
    pairs.add(pair);
  }
  for (const claim of claims) if (!relations.some((relation) => relation.claimId === claim.id)) problems.push(`claim ${claim.id} has no citation relation`);
  if (artifacts.trustAssessments !== undefined) problems.push('export must not declare trustAssessments: native TRUST is never converted');

  // Source-native companion + hash binding.
  if (texts.provenance !== null && texts.provenance !== undefined) {
    let sidecar;
    try { sidecar = JSON.parse(texts.provenance); } catch { problems.push('sidecar is not valid JSON'); }
    if (sidecar) {
      if (sidecar.schema !== SIDECAR_SCHEMA || sidecar.export_version !== EXPORT_VERSION) problems.push('sidecar schema/version mismatch');
      try { validateSourceNativeProvenance(sidecar.source_native_provenance, 'sidecar.source_native_provenance'); } catch (error) { problems.push(error.message); }
      for (const [name, source] of Object.entries(sidecar.sources ?? {})) {
        if (!source) continue;
        const actual = readText(source.path);
        if (actual === null) problems.push(`source-native source ${name} (${source.path}) is missing`);
        else if (sha256(Buffer.from(actual, 'utf8')) !== source.sha256) problems.push(`source-native source ${name} (${source.path}) hash changed`);
      }
      const sidecarIds = new Set((sidecar.claims ?? []).map((claim) => claim.claim_id));
      for (const id of claimIds) if (!sidecarIds.has(id)) problems.push(`sidecar lacks review claim ${id}`);
      for (const claim of sidecar.claims ?? []) {
        if (claim.trust_v2?.origin !== 'source_native_trust') problems.push(`sidecar claim ${claim.claim_id} lacks source-native TRUST marker`);
      }
    }
  }
  const reportText = readText(`${artifacts.provenance ? artifacts.provenance.replace(/[^/]+$/u, '') : ''}compatibility-report.json`);
  if (reportText !== null) {
    try {
      const report = JSON.parse(reportText);
      if (report.schema !== REPORT_SCHEMA) problems.push('compatibility report schema mismatch');
      for (const [path, digest] of Object.entries(report.artifact_digests ?? {})) {
        const actual = readText(path);
        if (actual === null || sha256(Buffer.from(actual, 'utf8')) !== digest) problems.push(`artifact ${path} does not match compatibility report digest`);
      }
    } catch { problems.push('compatibility report is not valid JSON'); }
  } else problems.push('compatibility report is missing');
  return problems;
}

function main() {
  const args = parseArgs(process.argv.slice(2), ['directory']);
  const problems = verifyOratlasExport(args.directory);
  if (problems.length > 0) {
    process.stderr.write(`${problems.map((problem) => `- ${problem}`).join('\n')}\n`);
    process.exit(1);
  }
  process.stdout.write('ORAtlas export verified\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
