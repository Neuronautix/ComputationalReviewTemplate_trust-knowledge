#!/usr/bin/env node

// Deterministic export of the frozen review claim graph into the lean ORAtlas
// review-repository import shape (review-manifest.json + claims/citations/
// relations JSONL), plus a separate immutable source-native companion artifact.
//
// Boundaries (see docs/ORATLAS_EXPORT.md):
//  * ORAtlas records are built only from review-authored claims and the
//    citations the claim graph attaches to them.
//  * Native TRUST v2 is never converted into an ORAtlas TrustAssessmentRecord,
//    criterion rating, aggregate or verification status. It is re-exported
//    verbatim in the source-native sidecar and the original files are bound by
//    SHA-256.
//  * Nothing is fabricated: confidence, reviewer identity and assessor fields
//    are omitted, and unrepresentable data is listed in the compatibility report.

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  compareText,
  invariant,
  isObject,
  parseArgs,
  readJson,
  sha256,
  stableJson,
  writeText,
} from '../release-artifacts/lib.mjs';
import {
  CLAIM_TYPES,
  COMMIT_PATTERN,
  DOI_PATTERN,
  LIMITS,
  MANIFEST_SCHEMA_VERSION,
  ORATLAS_PINNED_COMMIT,
  ORATLAS_REPOSITORY,
  PMID_PATTERN,
  isSafeRepoRelativePath,
} from './contract-pin.mjs';

export const EXPORT_VERSION = '1.0.0';
export const SIDECAR_SCHEMA = 'comprev.oratlas-source-native-sidecar/1';
export const REPORT_SCHEMA = 'comprev.oratlas-compatibility-report/1';
export const EVIDENCE_LINKS_SCHEMA = 'comprev.evidence-packet-links/1';
export const DEFAULT_ARTIFACT_DIR = 'knowledge/oratlas';
export const FILE_NAMES = {
  claims: 'claims.jsonl',
  citations: 'citations.jsonl',
  relations: 'relations.jsonl',
  sidecar: 'source-native-trust.json',
  report: 'compatibility-report.json',
};

// Native edge relation -> ORAtlas claim/citation relation type. Anything not
// listed here has no ORAtlas equivalent and is reported as dropped, never guessed.
const RELATION_MAP = {
  supports: 'supports',
  partially_supports: 'partially-supports',
  contradicts: 'contradicts',
};

const SOURCE_NATIVE_PROVENANCE = (repository, rubricVersion) => ({
  originating_repository: repository,
  rubric_version: rubricVersion,
  method_version: `trust-validator-${rubricVersion}`,
  semantic_origin: 'source_native_trust',
  oratlas_re_adjudicated: false,
  assessment_unit: { decision_id: 'D01', status: 'proposed', projection: 'claim_object_current_behavior' },
  disagreement: { decision_id: 'D09', status: 'proposed', representation: 'not_available', aggregation_performed: false },
  export_semantics: { decision_id: 'D11', status: 'proposed' },
});

export function sha256Text(text) {
  return sha256(Buffer.from(text, 'utf8'));
}

export function jsonl(records) {
  return records.map((record) => `${JSON.stringify(record)}\n`).join('');
}

const ACCENTS = {
  "'": { a: 'á', e: 'é', i: 'í', o: 'ó', u: 'ú', y: 'ý', A: 'Á', E: 'É', I: 'Í', O: 'Ó', U: 'Ú' },
  '`': { a: 'à', e: 'è', i: 'ì', o: 'ò', u: 'ù', A: 'À', E: 'È' },
  '"': { a: 'ä', e: 'ë', i: 'ï', o: 'ö', u: 'ü', A: 'Ä', O: 'Ö', U: 'Ü' },
  '^': { a: 'â', e: 'ê', i: 'î', o: 'ô', u: 'û' },
  '~': { a: 'ã', n: 'ñ', o: 'õ', N: 'Ñ' },
};

function decodeLatex(text) {
  return text
    .replace(/\\(['`"^~])\{?([A-Za-z])\}?/gu, (match, accent, letter) => ACCENTS[accent]?.[letter] ?? match)
    .replace(/\\c\{?([cC])\}?/gu, (_, letter) => (letter === 'c' ? 'ç' : 'Ç'))
    .replace(/--/gu, '–')
    .replace(/[{}]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

// Brace-aware BibTeX field parser (entries are small and trusted-format).
export function parseBibliography(text) {
  const entries = new Map();
  const header = /@([A-Za-z]+)\s*\{\s*([^,\s]+)\s*,/gu;
  const starts = [...text.matchAll(header)];
  starts.forEach((match, index) => {
    const bodyStart = match.index + match[0].length;
    const bodyEnd = index + 1 < starts.length ? starts[index + 1].index : text.length;
    const body = text.slice(bodyStart, bodyEnd);
    const fields = {};
    const fieldStart = /([A-Za-z]+)\s*=\s*/gu;
    let field;
    while ((field = fieldStart.exec(body))) {
      let cursor = field.index + field[0].length;
      let value;
      if (body[cursor] === '{') {
        let depth = 0;
        const begin = cursor + 1;
        for (; cursor < body.length; cursor += 1) {
          if (body[cursor] === '{') depth += 1;
          if (body[cursor] === '}') {
            depth -= 1;
            if (depth === 0) break;
          }
        }
        value = body.slice(begin, cursor);
      } else if (body[cursor] === '"') {
        const end = body.indexOf('"', cursor + 1);
        value = body.slice(cursor + 1, end < 0 ? body.length : end);
        cursor = end < 0 ? body.length : end;
      } else {
        const end = body.slice(cursor).search(/[,\n]/u);
        value = body.slice(cursor, end < 0 ? body.length : cursor + end);
        cursor = end < 0 ? body.length : cursor + end;
      }
      fields[field[1].toLowerCase()] = value.trim();
      fieldStart.lastIndex = cursor;
    }
    entries.set(match[2], { entry_type: match[1].toLowerCase(), fields });
  });
  return entries;
}

function normalizeDoi(raw) {
  if (typeof raw !== 'string') return null;
  const stripped = raw.trim().replace(/^(?:doi:\s*|https?:\/\/(?:dx\.)?doi\.org\/)/iu, '');
  return stripped.toLowerCase();
}

function clip(value, max) {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function validateEvidenceLinks(links, claimsById) {
  if (links === undefined) return [];
  invariant(isObject(links) && links.schema === EVIDENCE_LINKS_SCHEMA, `evidence links must declare schema ${EVIDENCE_LINKS_SCHEMA}`);
  invariant(links.producer === 'diggypaper', 'evidence links producer must be diggypaper');
  invariant(isObject(links.packet) && typeof links.packet.id === 'string' && /^[a-f0-9]{64}$/u.test(links.packet.sha256 || ''), 'evidence links packet needs an id and sha256');
  invariant(Array.isArray(links.findings), 'evidence links findings must be an array');
  const seen = new Set();
  return links.findings.map((finding, index) => {
    const label = `evidence links finding[${index}]`;
    invariant(isObject(finding) && typeof finding.finding_id === 'string' && finding.finding_id.length > 0, `${label}.finding_id is required`);
    invariant(/^[a-f0-9]{64}$/u.test(finding.source_sha256 || ''), `${label}.source_sha256 must be a SHA-256`);
    invariant(Array.isArray(finding.claim_ids) && finding.claim_ids.length > 0, `${label}.claim_ids must be non-empty`);
    invariant(typeof finding.cite_key === 'string', `${label}.cite_key is required`);
    const claim = finding.claim_ids.map((id) => {
      invariant(claimsById.has(id), `${label} references unknown review claim ${id}`);
      return claimsById.get(id);
    });
    for (const owner of claim) {
      const context = owner.citation_contexts.find((candidate) => candidate.cite_key === finding.cite_key);
      invariant(context, `${label}: review claim ${owner.claim_id} does not cite ${finding.cite_key}`);
      invariant(
        finding.doi === undefined || normalizeDoi(finding.doi) === normalizeDoi(context.doi),
        `${label}: finding DOI differs from the DOI the claim graph records for ${finding.cite_key}`,
      );
    }
    const key = `${finding.finding_id}|${finding.claim_ids.join(',')}|${finding.cite_key}`;
    invariant(!seen.has(key), `${label} duplicates another link`);
    seen.add(key);
    return {
      level: 'producer_finding',
      producer: 'diggypaper',
      packet_id: links.packet.id,
      packet_sha256: links.packet.sha256,
      finding_id: finding.finding_id,
      finding_source_sha256: finding.source_sha256,
      cite_key: finding.cite_key,
      doi: finding.doi === undefined ? null : normalizeDoi(finding.doi),
      linked_review_claim_ids: [...finding.claim_ids].sort(compareText),
      note: 'A producer finding describes a cited article. It is not a review claim; the link only records which evidence-packet finding a review citation was drawn from.',
    };
  });
}

function validateGraph(graph, trustReport) {
  invariant(isObject(graph) && Array.isArray(graph.claims) && Array.isArray(graph.edges), 'claim graph must contain claims and edges');
  invariant(graph.rubric_version === trustReport.rubric_version, 'claim graph and TRUST report rubric versions differ');
  invariant(typeof graph.generated_at === 'string', 'claim graph generated_at is required');
  const ids = graph.claims.map((claim) => claim.claim_id);
  invariant(new Set(ids).size === ids.length, 'claim graph claim IDs must be unique');
  const reportIds = new Set(trustReport.claims.map((claim) => claim.claim_id));
  for (const claim of graph.claims) {
    invariant(reportIds.has(claim.claim_id), `TRUST report is missing claim ${claim.claim_id}`);
  }
}

export function buildOratlasExport({
  claimGraph,
  trustReport,
  bibliographyText,
  evidenceLinks,
  sources,
  options,
}) {
  validateGraph(claimGraph, trustReport);
  invariant(/^https:\/\/github\.com\/[^/]+\/[^/]+$/u.test(options.repositoryUrl || ''), 'repositoryUrl must be an https GitHub URL');
  invariant(typeof options.title === 'string' && options.title.length > 0 && options.title.length <= 500, 'title is required (<=500 chars)');
  invariant(options.commit === undefined || COMMIT_PATTERN.test(options.commit), 'commit must be a full lowercase git object id');
  const artifactDir = options.artifactDir ?? DEFAULT_ARTIFACT_DIR;
  const paths = Object.fromEntries(Object.entries(FILE_NAMES).map(([key, name]) => [key, `${artifactDir}/${name}`]));
  for (const path of Object.values(paths)) invariant(isSafeRepoRelativePath(path), `unsafe artifact path ${path}`);

  const claimsById = new Map(claimGraph.claims.map((claim) => [claim.claim_id, claim]));
  const reportById = new Map(trustReport.claims.map((claim) => [claim.claim_id, claim]));
  const bibliography = parseBibliography(bibliographyText);
  const evidenceLinkRecords = validateEvidenceLinks(evidenceLinks, claimsById);
  const notes = [];
  const dropped = [];

  // ---- claims ----
  const claimRecords = [...claimGraph.claims].sort((a, b) => compareText(a.claim_id, b.claim_id)).map((claim) => {
    const record = { id: claim.claim_id, text: claim.claim_text, section: claim.section_id };
    invariant(record.id.length <= LIMITS.claim.id && record.text.length > 0 && record.text.length <= LIMITS.claim.text, `claim ${claim.claim_id} violates ORAtlas length limits`);
    if (claim.source_file && Number.isInteger(claim.paragraph_index) && Number.isInteger(claim.sentence_index)) {
      record.anchor = `${claim.source_file}#p${claim.paragraph_index}s${claim.sentence_index}`;
    }
    if (CLAIM_TYPES.includes(claim.claim_type)) record.claimType = claim.claim_type;
    else notes.push({ subject: claim.claim_id, field: 'claimType', note: `native claim_type ${JSON.stringify(claim.claim_type)} is not an ORAtlas claim type; omitted` });
    const method = claim.claim_scope?.methodological;
    if (typeof method === 'string' && method.length > 0) record.scope = { method: clip(method, LIMITS.claim.method) };
    return record;
  });

  // ---- citations (only works the review actually cites) ----
  const citedKeys = [...new Set(claimGraph.claims.flatMap((claim) => claim.citation_contexts.map((context) => context.cite_key)))].sort(compareText);
  const citationRecords = citedKeys.map((key) => {
    const entry = bibliography.get(key);
    invariant(entry, `cited work ${key} is missing from the bibliography`);
    const graphDois = [...new Set(claimGraph.claims.flatMap((claim) => claim.citation_contexts.filter((context) => context.cite_key === key).map((context) => normalizeDoi(context.doi))))];
    invariant(graphDois.length === 1, `cited work ${key} has ambiguous DOIs in the claim graph: ${graphDois.join(', ')}`);
    const record = { id: key };
    const bibDoi = normalizeDoi(entry.fields.doi);
    if (bibDoi && graphDois[0] && bibDoi !== graphDois[0]) {
      throw new Error(`cited work ${key}: bibliography DOI ${bibDoi} conflicts with claim graph DOI ${graphDois[0]}`);
    }
    const doi = bibDoi || graphDois[0];
    if (!doi) notes.push({ subject: key, field: 'doi', note: 'no DOI recorded; omitted' });
    else if (!DOI_PATTERN.test(doi)) notes.push({ subject: key, field: 'doi', note: `${JSON.stringify(doi)} is not a valid bare DOI; omitted` });
    else {
      record.doi = doi;
      record.url = `https://doi.org/${doi}`;
    }
    if (entry.fields.pmid === undefined) notes.push({ subject: key, field: 'pmid', note: 'no PMID in the bibliography; omitted (not looked up)' });
    else if (PMID_PATTERN.test(entry.fields.pmid)) record.pmid = entry.fields.pmid;
    else notes.push({ subject: key, field: 'pmid', note: `${JSON.stringify(entry.fields.pmid)} is not a valid PMID; omitted` });
    if (entry.fields.title) record.title = clip(decodeLatex(entry.fields.title), LIMITS.citation.title);
    if (entry.fields.author) {
      const authors = entry.fields.author.split(/\s+and\s+/iu).map((author) => clip(decodeLatex(author), LIMITS.citation.author)).filter(Boolean);
      if (authors.length > 0 && authors.length <= LIMITS.citation.authors) record.authors = authors;
      else notes.push({ subject: key, field: 'authors', note: 'author list empty or longer than the ORAtlas cap; omitted' });
    } else notes.push({ subject: key, field: 'authors', note: 'no authors in the bibliography; omitted' });
    const year = Number.parseInt(entry.fields.year, 10);
    if (Number.isInteger(year) && year >= 1500 && year <= 2100) record.year = year;
    else notes.push({ subject: key, field: 'year', note: 'missing or implausible year; omitted' });
    const source = entry.fields.journal || entry.fields.booktitle;
    if (source) record.source = clip(decodeLatex(source), LIMITS.citation.source);
    return orderKeys(record, ['id', 'doi', 'pmid', 'title', 'authors', 'year', 'source', 'url']);
  });

  // ---- relations ----
  const citationSet = new Set(citedKeys);
  const relationRecords = [];
  const nonExportedEdges = [];
  const contextPairs = new Set(
    claimGraph.claims.flatMap((claim) => claim.citation_contexts.map((context) => `${claim.claim_id}\u0000${context.cite_key}`)),
  );
  const edgePairs = new Set();
  for (const edge of claimGraph.edges) {
    invariant(claimsById.has(edge.source_claim_id), `edge references unknown claim ${edge.source_claim_id}`);
    const exportable = edge.target_type === 'citation' && RELATION_MAP[edge.relation];
    if (!exportable) {
      const reason = edge.target_type === 'citation' ? `relation ${edge.relation} has no ORAtlas relation type` : `target_type ${edge.target_type} is not a citation`;
      nonExportedEdges.push({ edge, reason });
      dropped.push({ kind: 'relation', subject: `${edge.source_claim_id}->${edge.target}`, reason });
      continue;
    }
    invariant(citationSet.has(edge.target), `edge ${edge.source_claim_id}->${edge.target} references an uncited or unknown citation`);
    const pair = `${edge.source_claim_id}\u0000${edge.target}`;
    invariant(contextPairs.has(pair), `edge ${edge.source_claim_id}->${edge.target} has no citation_context on the claim`);
    invariant(!edgePairs.has(pair), `duplicate edge ${edge.source_claim_id}->${edge.target}`);
    edgePairs.add(pair);
    const claim = claimsById.get(edge.source_claim_id);
    const context = claim.citation_contexts.find((candidate) => candidate.cite_key === edge.target);
    const locators = [...new Set((context.passages || []).map((passage) => passage.locator).filter(Boolean))];
    const record = { claimId: claim.claim_id, citationId: edge.target, relationType: RELATION_MAP[edge.relation] };
    if (locators.length > 0) record.sourceLocation = clip(locators.join('; '), LIMITS.relation.sourceLocation);
    record.extractionMethod = clip(`computational-review-claim-graph@${claimGraph.schema_version}`, LIMITS.relation.extractionMethod);
    relationRecords.push(record);
  }
  for (const pair of contextPairs) {
    invariant(edgePairs.has(pair), `claim citation ${pair.replace('\u0000', '->')} has no claim-graph edge (missing claim/citation link)`);
  }
  relationRecords.sort((a, b) => compareText(a.claimId, b.claimId) || compareText(a.citationId, b.citationId));

  const claimsJsonl = jsonl(claimRecords);
  const citationsJsonl = jsonl(citationRecords);
  const relationsJsonl = jsonl(relationRecords);

  // ---- source-native sidecar ----
  const provenance = SOURCE_NATIVE_PROVENANCE(options.repositoryUrl, trustReport.rubric_version);
  const sidecarClaims = [...claimGraph.claims].sort((a, b) => compareText(a.claim_id, b.claim_id)).map((claim) => {
    const native = reportById.get(claim.claim_id);
    const atomCoverage = Object.fromEntries(
      claim.claim_atoms.map((atom) => [
        atom.atom_id,
        claim.citation_contexts.filter((context) => (context.supports_claim_atoms || []).includes(atom.atom_id)).map((context) => context.cite_key).sort(compareText),
      ]),
    );
    return {
      claim_id: claim.claim_id,
      oratlas_claim_id: claim.claim_id,
      provenance_level: 'review_claim',
      source: { file: claim.source_file, section_id: claim.section_id, paragraph_index: claim.paragraph_index, sentence_index: claim.sentence_index },
      claim_text_sha256: sha256Text(claim.claim_text),
      claim_atoms: claim.claim_atoms,
      atom_citation_coverage: atomCoverage,
      uncovered_atoms: Object.entries(atomCoverage).filter(([, keys]) => keys.length === 0).map(([atom]) => atom),
      claim_type: claim.claim_type,
      claim_scope: claim.claim_scope,
      scope_status: claim.scope_status,
      claim_polarity: claim.claim_polarity,
      modality: claim.modality,
      wording_strength: claim.wording_strength,
      entities: claim.entities,
      evidence_relation: claim.evidence_relation,
      conflicts: claim.conflicts,
      knowledge_edges: claim.knowledge_edges,
      citation_contexts: claim.citation_contexts,
      independence_groups: [...new Set(claim.citation_contexts.map((context) => context.independence_group))].sort(compareText),
      human_review_required: claim.human_review_required,
      validation_status: claim.validation_status,
      trust_v2: {
        origin: 'source_native_trust',
        rubric_version: claim.trust_score.rubric_version,
        components: claim.trust_score.components,
        raw_score: claim.trust_score.raw_score,
        overall_score: claim.trust_score.overall_score,
        trust_label: claim.trust_score.trust_label,
        capped: claim.trust_score.capped,
        cap_value: claim.trust_score.cap_value,
        cap_reasons: claim.trust_score.cap_reasons,
        computed_from: claim.trust_score.computed_from,
        report_entry: native,
      },
      evidence_links: evidenceLinkRecords.filter((link) => link.linked_review_claim_ids.includes(claim.claim_id)),
    };
  });
  const sidecar = {
    schema: SIDECAR_SCHEMA,
    export_version: EXPORT_VERSION,
    immutable: true,
    source_native_provenance: provenance,
    statement:
      'Native Computational Review TRUST v2 data, preserved verbatim. These are not ORAtlas TrustAssessmentRecords: no ORAtlas criterion, aggregate, reviewer identity, attestation or verified status is expressed or implied, and no score was converted.',
    generated_at: claimGraph.generated_at,
    sources: sources,
    evidence_levels: {
      producer_finding: 'A finding about a cited article in a Diggypaper evidence packet. Bound by packet and finding source hashes. Not a review claim.',
      review_claim: 'A sentence authored in this review (claims.jsonl). Identity is the native claim_id, unchanged.',
      graph_relation: 'A claim-graph edge between a review claim and a citation (relations.jsonl). Derived by the TRUST validator; human confirmation is recorded only via human_review_required and release decision references, never inferred here.',
    },
    claims: sidecarClaims,
    non_exported_graph_edges: nonExportedEdges.map(({ edge, reason }) => ({ ...edge, not_exported_reason: reason })),
    evidence_links: evidenceLinkRecords,
    claim_graph_summary: claimGraph.summary,
  };
  const sidecarText = stableJson(sidecar);

  // ---- manifest ----
  const manifest = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    review: { title: options.title, reviewType: 'computational-literature-review', language: 'en' },
    repository: { url: options.repositoryUrl },
    artifacts: { claims: paths.claims, citations: paths.citations, relations: paths.relations, provenance: paths.sidecar },
  };
  if (options.abstract) manifest.review.abstract = options.abstract;
  if (options.license) manifest.review.license = options.license;
  if (options.commit) manifest.repository.commit = options.commit;
  if (options.releaseTag) manifest.repository.releaseTag = options.releaseTag;
  const manifestText = stableJson(manifest);

  // ---- compatibility report ----
  const count = (list, pick) => list.reduce((total, item) => total + pick(item).length, 0);
  const report = {
    schema: REPORT_SCHEMA,
    export_version: EXPORT_VERSION,
    generated_at: claimGraph.generated_at,
    target: { repository: ORATLAS_REPOSITORY, pinned_commit: ORATLAS_PINNED_COMMIT, contracts: ['artifacts.ts', 'manifest.ts'] },
    source_native_provenance: provenance,
    parsed: {
      claims: claimGraph.claims.length,
      citations_cited: citedKeys.length,
      edges: claimGraph.edges.length,
    },
    exported: { claims: claimRecords.length, citations: citationRecords.length, relations: relationRecords.length, trust_assessments: 0 },
    dropped,
    expected_extractor_outcome: { claims_skipped: 0, citations_skipped: 0, relations_skipped: 0, trust: 'not-declared' },
    lossy_import_shape: {
      description: 'Native fields that ORAtlas lean claim/citation/relation records cannot hold. All remain intact in the source-native sidecar.',
      claim_atoms: count(claimGraph.claims, (claim) => claim.claim_atoms),
      atom_level_passages: count(claimGraph.claims.flatMap((claim) => claim.citation_contexts), (context) => context.passages || []),
      citation_contexts_with_independence_group: claimGraph.claims.flatMap((claim) => claim.citation_contexts).filter((context) => context.independence_group).length,
      entities: count(claimGraph.claims, (claim) => claim.entities),
      knowledge_edges: count(claimGraph.claims, (claim) => claim.knowledge_edges),
      claim_scope_fields_lost: 'biological, computational, clinical, conceptual (only methodological maps, to scope.method)',
      claim_fields_lost: ['claim_atoms', 'claim_polarity', 'modality', 'wording_strength', 'scope_status', 'normalized_claim', 'conflicts', 'evidence_relation'],
      relation_fields_lost: ['supports_claim_atoms', 'role', 'source_type', 'direction_match', 'independence_group', 'independence_basis', 'scope_match', 'integrity_status', 'passage text and verification'],
      trust_v2: 'Not exported as ORAtlas trust records by design; see source-native-trust.json.',
    },
    metadata_notes: notes,
    producer_finding_links: evidenceLinkRecords.length,
    sidecar_reference: { path: paths.sidecar, sha256: sha256Text(sidecarText) },
    artifact_digests: {
      [paths.claims]: sha256Text(claimsJsonl),
      [paths.citations]: sha256Text(citationsJsonl),
      [paths.relations]: sha256Text(relationsJsonl),
      [paths.sidecar]: sha256Text(sidecarText),
      'review-manifest.json': sha256Text(manifestText),
    },
  };

  return {
    files: new Map([
      ['review-manifest.json', manifestText],
      [paths.claims, claimsJsonl],
      [paths.citations, citationsJsonl],
      [paths.relations, relationsJsonl],
      [paths.sidecar, sidecarText],
      [paths.report, stableJson(report)],
    ]),
    report,
    paths,
  };
}

function orderKeys(record, order) {
  return Object.fromEntries(order.filter((key) => record[key] !== undefined).map((key) => [key, record[key]]));
}

export function readSources(args, root) {
  const read = (path) => {
    const bytes = readFileSync(resolve(root, path));
    return { path, sha256: sha256(bytes), bytes: bytes.length, text: bytes.toString('utf8') };
  };
  const claimGraph = read(args['claim-graph'] ?? 'knowledge/claim_graph.json');
  const trustReport = read(args['trust-report'] ?? 'knowledge/trust_score_report.json');
  const bibliography = read(args.bibliography ?? 'content/references.bib');
  const links = args['evidence-links'] ? read(args['evidence-links']) : undefined;
  return { claimGraph, trustReport, bibliography, links };
}

export function exportFromSources(loaded, options) {
  const sources = {
    claim_graph: { path: loaded.claimGraph.path, sha256: loaded.claimGraph.sha256, bytes: loaded.claimGraph.bytes },
    trust_score_report: { path: loaded.trustReport.path, sha256: loaded.trustReport.sha256, bytes: loaded.trustReport.bytes },
    bibliography: { path: loaded.bibliography.path, sha256: loaded.bibliography.sha256, bytes: loaded.bibliography.bytes },
    evidence_links: loaded.links ? { path: loaded.links.path, sha256: loaded.links.sha256, bytes: loaded.links.bytes } : null,
  };
  return buildOratlasExport({
    claimGraph: JSON.parse(loaded.claimGraph.text),
    trustReport: JSON.parse(loaded.trustReport.text),
    bibliographyText: loaded.bibliography.text,
    evidenceLinks: loaded.links ? JSON.parse(loaded.links.text) : undefined,
    sources,
    options,
  });
}

function main() {
  const args = parseArgs(process.argv.slice(2), ['repository-url', 'title']);
  const root = resolve(args.root ?? '.');
  const loaded = readSources(args, root);
  const { files } = exportFromSources(loaded, {
    repositoryUrl: args['repository-url'],
    title: args.title,
    commit: args.commit,
    releaseTag: args['release-tag'],
    abstract: args.abstract,
    license: args.license,
    artifactDir: args['artifact-dir'],
  });
  const outputDir = resolve(args['output-dir'] ?? root);
  for (const [path, text] of files) writeText(join(outputDir, path), text);
  process.stdout.write(`Wrote ${files.size} files to ${outputDir}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
