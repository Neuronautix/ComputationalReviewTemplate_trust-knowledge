import fs from 'node:fs';
import path from 'node:path';
import { prettyJson, sha256 } from './canonical.mjs';
import { GOOD_MATCH, VERIFICATION_ORDER, validatePacket } from './validate.mjs';

export const IMPORTER = Object.freeze({ name: 'import-source-evidence-packet', version: '0.1.0' });
export const LINEAGE_SCHEMA_VERSION = 'source-evidence-lineage/0.1.0';
export const FILES = Object.freeze({
  phase2: 'cluster_evidence.json',
  lineage: 'source-evidence-lineage.json',
  report: 'import-report.json',
});
export const STATUSES = ['accepted', 'rejected', 'withheld', 'incomplete'];

const NOT_STATED = [
  'A matched quotation is not semantic support; only the native human assessments recorded in this file are judgments.',
  'No claim is made that any finding was independently replicated or that the source article is validated.',
  'Native Diggypaper assessment statuses are not ComputationalReviewTemplate TRUST levels and are not converted to them.',
  'Source-paper findings are not review-authored claims; article authors are citation metadata, never the origin of a finding.',
];

export const PILOT_EXCEPTIONS = Object.freeze([
  ['PAPER_COUNT_FLOOR', 'fixed-corpus', 'corpus size is fixed by the packet, not by min_papers_per_cluster'],
  ['CROSS_CLUSTER_UNIQUE_DOIS', 'fixed-corpus', 'corpus size is fixed by the packet'],
  ['BIBLIOGRAPHY_FLOOR_HARD', 'fixed-corpus', 'total_bibliography_target is not applied to an imported fixed corpus; record the user decision in gate_evidence_compliance.json user_signoff'],
  ['PAPER_COUNT', 'fixed-corpus', 'corpus size is fixed by the packet'],
  ['SHAPE_NOT_UNIFORM', 'fixed-corpus', 'a single imported cluster has no per-cluster spread to test'],
  ['FIGURE_DATA_PRESENT', 'fixed-corpus', 'packets carry no cross-paper figure comparisons'],
  ['FIGURE_DATA', 'fixed-corpus', 'packets carry no cross-paper figure comparisons'],
  ['EFFECT_SIZE_RATE', 'not-invented', 'the contract has no effect-size field; none is computed or imputed'],
  ['SAMPLE_SIZE_RATE', 'not-invented', 'n is imported only where the packet defines it as an experimental-unit count'],
  ['REPLICATION_UNKNOWN_CEILING', 'not-invented', 'replication is never inferred from packet data'],
  ['WEAKEST_EVIDENCE_SUBSTANTIVE', 'no-synthesis', 'the importer does not judge evidence strength'],
  ['SEARCH_FAILURES_PRESENT', 'no-search', 'the importer performs no literature search'],
  ['CONTRADICTION_QUERIES_EXECUTED', 'no-search', 'the importer performs no literature search'],
  ['FALSE_CONSENSUS_RISKS_IDENTIFIED', 'no-synthesis', 'the importer does not identify evidence gaps'],
  ['SATURATION_LOGGED', 'no-search', 'the importer performs no literature search'],
  ['DOI_RESOLVES', 'offline', 'import is offline; DOI resolution is not attempted'],
  ['DOI_TITLE_CROSSCHECK', 'offline', 'import is offline; CrossRef is not queried'],
  ['SOURCE_PROVENANCE', 'offline', 'no abstract is retrieved; text_access stays "unknown" rather than being deduced'],
  ['FULLTEXT_HONEST', 'offline', 'no document is retrieved, so no size test can establish fulltext'],
  ['FULLTEXT_HONEST_v2', 'offline', 'no document is retrieved, so no size test can establish fulltext'],
  ['FULLTEXT_RATE_PER_CLUSTER', 'offline', 'text_access is not determined by the packet'],
  ['FULLTEXT_RATE_OVERALL', 'offline', 'text_access is not determined by the packet'],
  ['SOURCE_LENGTH', 'import-semantics', 'a length heuristic aimed at agent extraction; the quote is a verbatim packet passage'],
  ['CLAIM_DIFFERS_FROM_SOURCE', 'import-semantics', 'a source-explicit finding may legitimately equal its source sentence'],
].map(([check, category, reason]) => Object.freeze({ check, category, reason })));

const DOI_PATTERN = /^10\.\d{4,9}\/\S+$/u;
export function normalizeDoi(value) {
  if (typeof value !== 'string') return null;
  const stripped = value.trim().replace(/^(?:https?:\/\/)?(?:dx\.)?doi\.org\//iu, '').replace(/^doi:\s*/iu, '').toLowerCase();
  return DOI_PATTERN.test(stripped) ? stripped : null;
}

const byFindingKey = (a, b) => (a.finding_id < b.finding_id ? -1 : a.finding_id > b.finding_id ? 1 : a.revision - b.revision);
const reason = (cls, code, message) => ({ class: cls, code, message });

function isNumeric(text, value) {
  const pattern = new RegExp(`(?<![\\d.])${String(Math.abs(value)).replace('.', '\\.')}(?![\\d])`, 'u');
  return pattern.test(text);
}

/** n is imported only when the packet says it counts experimental units; anything else stays out of Phase 2 `n`. */
function selectN(finding, loss) {
  const results = finding.numeric_results;
  if (!results.length) {
    loss.push({ field: 'n', disposition: 'null-absent-in-packet', reason: 'no numeric result with an n was exported' });
    return null;
  }
  const units = results.filter((r) => r.n.definition === 'experimental-unit' && r.n.value > 0);
  const values = [...new Set(units.map((r) => r.n.value))];
  if (values.length === 1) {
    loss.push({ field: 'n', disposition: 'mapped', source: 'numeric_results[].n', reason: 'n.definition is experimental-unit' });
    return values[0];
  }
  const why = values.length > 1
    ? `numeric results carry different experimental-unit n values (${values.join(', ')}); no single n is chosen`
    : `n definitions are [${[...new Set(results.map((r) => r.n.definition))].join(', ')}]; only experimental-unit counts are imported as n. The packet values stay in the evidence text and lineage`;
  loss.push({ field: 'n', disposition: 'null-not-comparable', reason: why });
  return null;
}

function describeEvidence(packetId, finding) {
  const c = finding.context;
  const numeric = finding.numeric_results
    .map((r) => `${r.name} = ${r.value} ${r.unit} (n=${r.n.value}, n-definition=${r.n.definition})`)
    .join('; ');
  return [
    `Source-paper finding imported from ${packetId} (${finding.finding_id} rev ${finding.revision}; wording origin: ${finding.origin}).`,
    `Context: population=${c.population}; exposure=${c.exposure}; comparator=${c.comparator}; outcome=${c.outcome}; time=${c.time}; experimental unit=${c.experimental_unit}.`,
    numeric ? `Numeric results: ${numeric}.` : 'Numeric results: none exported.',
  ].join(' ');
}

function evaluate(finding, ctx) {
  const { paper, passages, assessments, threshold, packetScope, latest } = ctx;
  const reasons = [];
  const flags = [];
  if (!latest) reasons.push(reason('rejected', 'superseded-revision', 'a later revision of this finding exists in the packet; revisions are never collapsed'));
  if (packetScope === 'restricted') reasons.push(reason('withheld', 'packet-scope-restricted', 'packet access_scope.level is restricted'));
  if (paper.rights.redistribution !== 'allowed') {
    reasons.push(reason('withheld', 'paper-rights-not-redistributable', `paper redistribution is ${paper.rights.redistribution}`));
  }
  if (finding.export_state !== 'approved-for-export') reasons.push(reason('rejected', 'not-approved-for-export', `export_state is ${finding.export_state}`));
  if (finding.review_state !== 'human-reviewed') reasons.push(reason('rejected', 'unreviewed', `review_state is ${finding.review_state}`));
  if (VERIFICATION_ORDER.indexOf(finding.verification_level) < VERIFICATION_ORDER.indexOf(threshold)) {
    reasons.push(reason('rejected', 'verification-below-threshold', `verification_level ${finding.verification_level} is below ${threshold}`));
  }
  const doi = normalizeDoi(paper.identifiers.doi);
  if (doi === null) {
    reasons.push(reason('rejected', paper.identifiers.doi === 'not-available' ? 'missing-doi' : 'invalid-doi', `paper DOI is ${JSON.stringify(paper.identifiers.doi)}`));
  }
  if (paper.source_snapshot.state !== 'captured') {
    reasons.push(reason('rejected', 'source-unavailable', `source snapshot state is ${paper.source_snapshot.state}`));
  }
  if (assessments.some((a) => a.status === 'contradicts')) {
    reasons.push(reason('rejected', 'reviewer-contradiction', 'a native assessment records that a passage contradicts this finding'));
  }

  const supporting = assessments.filter((a) => a.status === 'supports');
  const usable = (match) => supporting
    .map((a) => ({ a, p: passages.get(a.passage_id) }))
    .filter(({ p }) => p && p.match.status === match && p.quote_state === 'included')
    .sort((x, y) => (x.p.passage_id < y.p.passage_id ? -1 : 1));
  const exact = usable('exact');
  const normalized = usable('normalized');
  const supportedOnWithheld = supporting.some((a) => passages.get(a.passage_id)?.quote_state === 'withheld-rights');
  const own = finding.passage_ids.map((id) => passages.get(id)).filter(Boolean);

  if (!exact.length) {
    if (normalized.length) {
      reasons.push(reason('incomplete', 'source-sentence-not-verbatim', 'the supported passage matched only after normalization, so the exported quote is not a verbatim source sentence'));
    } else if (supportedOnWithheld) {
      reasons.push(reason('withheld', 'quote-withheld-for-rights', 'the supporting passage quote is withheld for rights'));
    } else if (!own.some((p) => GOOD_MATCH.has(p.match.status))) {
      const ambiguous = own.some((p) => p.match.status === 'ambiguous');
      reasons.push(reason('rejected', ambiguous ? 'ambiguous-passage' : 'no-matched-passage', ambiguous ? 'passage match is ambiguous' : 'no passage has an exact or normalized match'));
    } else if (!reasons.some((r) => r.code === 'reviewer-contradiction')) {
      reasons.push(reason('rejected', 'no-supporting-judgment', 'no native assessment records that a matched passage supports this finding'));
    }
  }
  if (own.some((p) => ['ambiguous', 'not_found', 'invalid', 'incomplete'].includes(p.match.status))) flags.push('has-unmatched-or-ambiguous-passages');
  const judgments = new Set(assessments.filter((a) => ['supports', 'contradicts', 'insufficient', 'unclear'].includes(a.status)).map((a) => a.status));
  if (judgments.size > 1) flags.push('non-unanimous-judgments');

  const status = ['withheld', 'rejected', 'incomplete'].find((cls) => reasons.some((r) => r.class === cls)) || 'accepted';
  return { status, reasons, flags, doi, chosen: status === 'accepted' ? exact[0] : null };
}

function mapAccepted(packetId, finding, paper, chosen, doi) {
  const loss = [];
  const quote = chosen.p.quote;
  loss.push({ field: 'claim', disposition: 'mapped', source: 'finding.statement', reason: `wording origin ${finding.origin}; not attributed to the article authors` });
  loss.push({ field: 'claim_source_sentence', disposition: 'mapped-verbatim', source: `${chosen.p.passage_id}`, reason: `exact match; native assessment ${chosen.a.assessment_id} records "supports"; the match is not itself support` });
  loss.push({ field: 'doi', disposition: 'mapped', source: 'paper.identifiers.doi', reason: 'normalized to lower case without resolver prefix' });
  const population = finding.context.population;
  loss.push({ field: 'study_system', disposition: population === 'unknown' ? 'unknown-kept' : 'mapped', source: 'context.population', reason: population === 'unknown' ? 'the packet states the population is unknown; kept as the literal "unknown"' : 'population text carried as written' });
  loss.push({ field: 'effect_size', disposition: 'null-absent-in-packet', reason: 'the contract has no effect-size field; none is computed or imputed' });
  loss.push({ field: 'effect_size_source_sentence', disposition: 'null-absent-in-packet', reason: 'no effect size is imported, so no sentence is attached to one' });
  const n = selectN(finding, loss);
  loss.push({ field: 'replication_status', disposition: 'constant', reason: 'packet carries no replication data; independently-verified counts reviewers, not replications' });
  loss.push({ field: 'replication_evidence_dois', disposition: 'constant', reason: 'empty: no replication evidence in packet' });
  loss.push({ field: 'text_access', disposition: 'unknown-kept', reason: 'the packet does not record whether the passage comes from the abstract or the body, and this cannot be deduced from size or from a sentence appearing in both' });
  loss.push({ field: 'evidence', disposition: 'composed', source: 'context, numeric_results', reason: 'context and the packet\'s numeric results with their n-definitions, as written' });
  if (finding.numeric_results.some((r) => r.unit === 'unknown')) loss.push({ field: 'evidence', disposition: 'unit-unknown-kept', reason: 'a numeric result has unit "unknown"; kept as written' });
  return {
    phase2: {
      claim: finding.statement,
      claim_source_sentence: quote,
      evidence: describeEvidence(packetId, finding),
      effect_size: null,
      effect_size_source_sentence: null,
      n,
      study_system: population,
      replication_status: 'replication_unknown',
      replication_evidence_dois: [],
      doi,
      text_access: 'unknown',
    },
    loss,
  };
}

function lineageEntry(index, finding, paper, doi, chosen, passages, assessments, flags, loss) {
  const quoteOf = (p) => (p.quote_state === 'included' ? p.quote : null);
  return {
    package_index: index,
    doi,
    flags,
    finding: {
      finding_id: finding.finding_id,
      revision: finding.revision,
      statement: finding.statement,
      origin: finding.origin,
      export_state: finding.export_state,
      review_state: finding.review_state,
      verification_level: finding.verification_level,
      context: finding.context,
      numeric_results: finding.numeric_results.map((r) => ({
        ...r,
        value_appears_in_claim_source_sentence: isNumeric(chosen.p.quote, r.value),
      })),
      created_at: finding.created_at,
      producer_ids: finding.producer_ids,
    },
    article: {
      paper_id: paper.paper_id,
      identifiers: paper.identifiers,
      title: paper.title,
      authors: paper.authors,
      source_type: paper.source_type,
      rights: paper.rights,
      source_snapshot: paper.source_snapshot,
      producer_ids: paper.producer_ids,
    },
    claim_source_passage_id: chosen.p.passage_id,
    passages: passages.map((p) => ({
      passage_id: p.passage_id,
      quote: quoteOf(p),
      quote_state: p.quote_state,
      quote_sha256: p.quote_sha256,
      match: p.match,
      source: p.source,
      producer_ids: p.producer_ids,
    })),
    native_assessments: assessments.map((a) => ({
      assessment_id: a.assessment_id,
      passage_id: a.passage_id,
      protocol: a.protocol,
      status: a.status,
      rationale: a.rationale,
      reviewer_ref: a.reviewer_ref,
      assessed_at: a.assessed_at,
      assessed_snapshot_sha256: a.assessed_snapshot_sha256,
      producer_ids: a.producer_ids,
    })),
    field_report: loss,
  };
}

/**
 * Validate a packet directory and map it to a Phase 2 cluster package, a lineage sidecar and an import
 * report. Pure and deterministic: no clock, no network, no randomness. Returns `ok:false` with the
 * validation errors (and no outputs) for any packet-level defect.
 */
export function importPacket(packetDir, { minVerification = 'human-reviewed' } = {}) {
  if (!VERIFICATION_ORDER.includes(minVerification) || minVerification === 'unverified') {
    throw new Error(`minVerification must be one of ${VERIFICATION_ORDER.slice(1).join(', ')}`);
  }
  const validation = validatePacket(packetDir);
  if (!validation.valid) return { ok: false, validation };
  const { manifest, data, manifest_sha256: manifestSha, artifact_sha256: artifactSha } = validation.packet;
  const papers = new Map(data.papers.map((p) => [p.paper_id, p]));
  const passages = new Map(data.passages.map((p) => [p.passage_id, p]));
  const latestRevision = new Map();
  for (const f of data.findings) latestRevision.set(f.finding_id, Math.max(latestRevision.get(f.finding_id) || 0, f.revision));

  const accepted = [];
  const results = [];
  for (const finding of [...data.findings].sort(byFindingKey)) {
    const paper = papers.get(finding.paper_id);
    const own = finding.passage_ids.map((id) => passages.get(id));
    const assessments = data.assessments
      .filter((a) => a.finding_id === finding.finding_id && a.finding_revision === finding.revision)
      .sort((a, b) => (a.assessment_id < b.assessment_id ? -1 : 1));
    const evaluation = evaluate(finding, {
      paper,
      passages,
      assessments,
      threshold: minVerification,
      packetScope: manifest.access_scope.level,
      latest: latestRevision.get(finding.finding_id) === finding.revision,
    });
    const row = {
      finding_id: finding.finding_id,
      revision: finding.revision,
      paper_id: finding.paper_id,
      status: evaluation.status,
      reasons: evaluation.reasons.sort((a, b) => (a.code < b.code ? -1 : 1)),
      flags: evaluation.flags,
    };
    if (evaluation.status === 'accepted') {
      const mapped = mapAccepted(manifest.packet_id, finding, paper, evaluation.chosen, evaluation.doi);
      row.package_index = accepted.length;
      row.field_report = mapped.loss;
      accepted.push({ finding, paper, own, assessments, evaluation, mapped });
    }
    results.push(row);
  }

  const packetInfo = {
    packet_id: manifest.packet_id,
    schema_version: manifest.schema_version,
    manifest_sha256: manifestSha,
    artifact_sha256: Object.fromEntries(Object.entries(artifactSha).filter(([, v]) => v).sort()),
    created_at: manifest.created_at,
    creation_method: manifest.creation_method,
    producer: manifest.producer,
    access_scope: manifest.access_scope,
    export_status: manifest.export_status,
    licenses: manifest.licenses,
  };
  const importerInfo = { ...IMPORTER, min_verification: minVerification, mode: 'fixed_corpus_import' };

  const lineage = {
    schema_version: LINEAGE_SCHEMA_VERSION,
    immutable: true,
    importer: importerInfo,
    packet: packetInfo,
    statements_not_made: NOT_STATED,
    entries: accepted.map((a, i) => lineageEntry(i, a.finding, a.paper, a.evaluation.doi, a.evaluation.chosen, a.own, a.assessments, a.evaluation.flags, a.mapped.loss)),
  };
  const lineageText = prettyJson(lineage);
  const lineageSha = sha256(Buffer.from(lineageText, 'utf8'));

  const uniqueDois = new Set(accepted.map((a) => a.evaluation.doi));
  const phase2 = {
    evidence_artifact_id: `source-evidence-packet:${manifest.packet_id}:${manifestSha.slice(7, 23)}`,
    cluster_source: `source-evidence-packet:${manifest.packet_id}`,
    findings: accepted.map((a) => a.mapped.phase2),
    conflicts: [],
    conflict_assessment: {
      status: 'not_assessed',
      basis: 'fixed-corpus import performs no cross-paper conflict detection; an empty conflicts[] means not assessed, not that no conflict exists',
    },
    unreplicated_claims: [],
    evidence_gaps: [],
    strongest_evidence: {},
    weakest_evidence_cited: {},
    figure_data: [],
    search_failures: [],
    papers_reviewed_count: uniqueDois.size,
    unique_papers: uniqueDois.size,
    total_findings: accepted.length,
    evidence_parameters_applied: { mode: 'fixed_corpus_import', min_papers_per_cluster: null, total_bibliography_target: null },
    pilot_exceptions: PILOT_EXCEPTIONS,
    import_provenance: {
      lineage_file: FILES.lineage,
      lineage_sha256: lineageSha,
      packet_id: manifest.packet_id,
      packet_manifest_sha256: manifestSha,
      importer: importerInfo,
    },
  };

  const tally = (pick) => results.reduce((acc, row) => {
    for (const key of pick(row)) acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const sorted = (obj) => Object.fromEntries(Object.entries(obj).sort());
  const report = {
    importer: importerInfo,
    packet: { packet_id: manifest.packet_id, manifest_sha256: manifestSha },
    outputs: { phase2: FILES.phase2, lineage: FILES.lineage, lineage_sha256: lineageSha },
    validation: { valid: true, warnings: validation.warnings, packet_counts: validation.counts },
    counts: {
      findings: Object.fromEntries(STATUSES.map((s) => [s, results.filter((r) => r.status === s).length])),
      by_reason: sorted(tally((row) => row.reasons.map((r) => `${r.class}:${r.code}`))),
      consumer_classes: {
        incompatible: results.filter((r) => r.status === 'rejected' || r.status === 'incomplete').length,
        restricted: results.filter((r) => r.status === 'withheld').length,
      },
      omitted_by_producer: manifest.export_status.withheld_counts,
      producer_export_state: manifest.export_status.state,
    },
    findings: results,
    pilot_exceptions: PILOT_EXCEPTIONS,
  };
  return {
    ok: true,
    validation,
    outputs: {
      [FILES.phase2]: prettyJson(phase2),
      [FILES.lineage]: lineageText,
      [FILES.report]: prettyJson(report),
    },
    phase2,
    lineage,
    report,
  };
}

/** Write outputs; refuses to overwrite any existing file whose bytes would change (the sidecar is immutable). */
export function writeImport(outDir, result) {
  fs.mkdirSync(outDir, { recursive: true });
  for (const [name, text] of Object.entries(result.outputs)) {
    const target = path.join(outDir, name);
    if (fs.existsSync(target) && fs.readFileSync(target, 'utf8') !== text) {
      throw new Error(`${target} already exists with different content; imports are immutable, choose a new output directory`);
    }
  }
  for (const [name, text] of Object.entries(result.outputs)) fs.writeFileSync(path.join(outDir, name), text);
  return Object.keys(result.outputs).map((name) => path.join(outDir, name));
}
