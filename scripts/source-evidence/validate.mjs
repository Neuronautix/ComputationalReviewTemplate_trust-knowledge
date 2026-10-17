import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditJsonSchema, validateJsonSchema } from '../release-artifacts/json-schema.mjs';
import { isCanonicalJsonLine, isCanonicalManifest, sha256 } from './canonical.mjs';

/**
 * Offline validator for source-evidence-packet/0.1.0. It re-implements, in Node, the checks
 * of the producer's reference validator (Diggypaper docs/contracts/source-evidence-packet/
 * v0.1.0/validator/sep_validate.py) with the same error codes, and adds consumer-side
 * reference-integrity checks that the contract leaves to importers (codes marked "importer").
 */
export const SCHEMA_VERSION = 'source-evidence-packet/0.1.0';
export const SCHEMAS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../docs/contracts/source-evidence-packet/v0.1.0/schemas',
);

export const MANIFEST_FILE = 'manifest.json';
export const ARTIFACT_FILES = {
  papers: 'papers.jsonl',
  findings: 'findings.jsonl',
  passages: 'passages.jsonl',
  assessments: 'assessments.jsonl',
};
const SCHEMA_FILES = {
  [MANIFEST_FILE]: 'manifest.schema.json',
  'papers.jsonl': 'paper.schema.json',
  'findings.jsonl': 'finding.schema.json',
  'passages.jsonl': 'passage-evidence.schema.json',
  'assessments.jsonl': 'evidence-assessment.schema.json',
};
const ID_FIELDS = {
  'papers.jsonl': 'paper_id',
  'findings.jsonl': 'finding_id',
  'passages.jsonl': 'passage_id',
  'assessments.jsonl': 'assessment_id',
};
export const VERIFICATION_ORDER = ['unverified', 'human-reviewed', 'source-verified', 'independently-verified'];
export const JUDGMENT_STATUSES = new Set(['supports', 'contradicts', 'insufficient', 'unclear']);
const SUPPORT_OR_CONTRA = new Set(['supports', 'contradicts']);
export const GOOD_MATCH = new Set(['exact', 'normalized']);
const BAD_MATCH = new Set(['not_found', 'ambiguous', 'invalid', 'incomplete']);
const NOT_REDISTRIBUTABLE = new Set(['metadata-only', 'restricted', 'unknown']);
const CROSS_FIELD_CODES = [
  ['passages.jsonl', /^\$\.source\.(start|end)\b/u, 'match-offset-inconsistent'],
  ['passages.jsonl', /^\$\.quote\b/u, 'withheld-quote-inconsistent'],
];
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

let schemaCache;
function loadSchemas() {
  if (!schemaCache) {
    schemaCache = {};
    for (const [file, schemaFile] of Object.entries(SCHEMA_FILES)) {
      schemaCache[file] = auditJsonSchema(JSON.parse(fs.readFileSync(path.join(SCHEMAS_DIR, schemaFile), 'utf8')));
    }
  }
  return schemaCache;
}

class Report {
  constructor() {
    this.errors = [];
    this.warnings = [];
  }

  error(code, file, id, message) { this.errors.push({ code, file, id, message }); }

  warn(code, file, id, message) { this.warnings.push({ code, file, id, message }); }

  hasPrefix(prefix) { return this.errors.some((e) => e.code.startsWith(prefix)); }
}

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
function sortedUnique(items) {
  const seen = new Set();
  return items
    .filter((item) => {
      const key = JSON.stringify([item.code, item.file, item.id, item.message]);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => compare(a.code, b.code) || compare(a.file, b.file) || compare(a.id, b.id) || compare(a.message, b.message));
}

function ridOf(record, file, lineno) {
  const value = record && typeof record === 'object' ? record[ID_FIELDS[file]] : undefined;
  return typeof value === 'string' ? value : `line:${lineno}`;
}

function readRegular(directory, name, report) {
  const target = path.join(directory, name);
  let stat;
  try { stat = fs.lstatSync(target); } catch { return null; }
  if (!stat.isFile()) {
    report.error('unexpected-file', name, '-', `${name} is not a regular file`);
    return null;
  }
  if (stat.size > MAX_FILE_BYTES) {
    report.error('invalid-json', name, '-', `${name} exceeds the ${MAX_FILE_BYTES}-byte import limit`);
    return null;
  }
  return fs.readFileSync(target);
}

function readManifest(directory, report) {
  const raw = readRegular(directory, MANIFEST_FILE, report);
  if (raw === null) {
    if (!report.errors.length) report.error('artifact-missing', MANIFEST_FILE, '-', 'manifest.json is missing');
    return { manifest: null, raw: null };
  }
  let text;
  let manifest;
  try {
    text = UTF8.decode(raw);
    manifest = JSON.parse(text);
  } catch (error) {
    report.error('invalid-json', MANIFEST_FILE, '-', `manifest.json is not valid JSON: ${error.message}`);
    return { manifest: null, raw };
  }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    report.error('invalid-json', MANIFEST_FILE, '-', 'manifest.json must be a JSON object');
    return { manifest: null, raw };
  }
  if (!isCanonicalManifest(text, manifest)) {
    report.error('non-canonical-encoding', MANIFEST_FILE, '-', 'manifest.json must be sorted-key pretty JSON with LF line ends and a final newline');
  }
  return { manifest, raw };
}

function readJsonl(directory, file, report) {
  const raw = readRegular(directory, file, report);
  if (raw === null) return { records: null, raw: null };
  let text;
  try { text = UTF8.decode(raw); } catch (error) {
    report.error('invalid-json', file, '-', `file is not valid UTF-8: ${error.message}`);
    return { records: null, raw };
  }
  let canonical = !(text && !text.endsWith('\n')) && !text.includes('\r');
  const lines = text.split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  const records = [];
  let broken = false;
  lines.forEach((line, index) => {
    const lineno = index + 1;
    if (line === '') {
      report.error('invalid-json', file, `line:${lineno}`, 'blank line');
      broken = true;
      return;
    }
    let parsed;
    try { parsed = JSON.parse(line); } catch (error) {
      report.error('invalid-json', file, `line:${lineno}`, `line is not valid JSON: ${error.message}`);
      broken = true;
      return;
    }
    if (!isCanonicalJsonLine(line, parsed)) canonical = false;
    records.push([lineno, parsed]);
  });
  if (!canonical) {
    report.error('non-canonical-encoding', file, '-', 'JSONL must be one compact sorted-key JSON object per line, LF, final newline');
  }
  return { records: broken ? null : records, raw };
}

function gather(directory, manifest, report, ignoreFiles) {
  const schemas = loadSchemas();
  let usable = true;
  const artifacts = manifest.artifacts && typeof manifest.artifacts === 'object' ? manifest.artifacts : {};
  const declared = new Set([MANIFEST_FILE, ...Object.values(ARTIFACT_FILES)]);
  const crate = manifest.ro_crate;
  if (crate && typeof crate.path === 'string') declared.add(crate.path.split('/')[0]);
  for (const entry of fs.readdirSync(directory).sort()) {
    if (!declared.has(entry) && !ignoreFiles.includes(entry)) {
      report.error('unexpected-file', entry, '-', `${entry} is not declared by the manifest`);
    }
  }
  const data = {};
  const fileDigests = { [MANIFEST_FILE]: null };
  for (const [kind, file] of Object.entries(ARTIFACT_FILES)) {
    const { records, raw } = readJsonl(directory, file, report);
    const artifact = artifacts[kind] && typeof artifacts[kind] === 'object' ? artifacts[kind] : {};
    if (raw === null) {
      if (!report.errors.some((e) => e.file === file)) report.error('artifact-missing', file, '-', `${file} is missing`);
      usable = false;
      continue;
    }
    const digest = sha256(raw);
    fileDigests[file] = digest;
    if (digest !== artifact.sha256) {
      report.error('artifact-hash-mismatch', file, '-', `sha256 of file bytes is ${digest}, manifest declares ${artifact.sha256}`);
    }
    if (raw.length !== artifact.bytes) {
      report.error('artifact-length-mismatch', file, '-', `file has ${raw.length} bytes, manifest declares ${artifact.bytes}`);
    }
    if (records === null) {
      usable = false;
      continue;
    }
    if (records.length !== artifact.record_count) {
      report.error('record-count-mismatch', file, '-', `file has ${records.length} records, manifest declares ${artifact.record_count}`);
    }
    for (const [lineno, record] of records) {
      const errors = validateJsonSchema(record, schemas[file]);
      for (const message of errors) {
        report.error(`schema-invalid:${file}`, file, ridOf(record, file, lineno), message);
        for (const [crossFile, pattern, code] of CROSS_FIELD_CODES) {
          if (crossFile === file && pattern.test(message)) report.error(code, file, ridOf(record, file, lineno), message);
        }
      }
      if (errors.length) usable = false;
    }
    data[kind] = records.map(([, record]) => record);
  }
  if (crate && typeof crate.path === 'string') {
    const crateBytes = readRegular(directory, crate.path, report);
    if (crateBytes === null) report.error('artifact-missing', crate.path, '-', 'ro_crate file is missing');
    else if (sha256(crateBytes) !== crate.sha256) report.error('artifact-hash-mismatch', crate.path, '-', 'ro_crate sha256 does not match');
  }
  return { data: usable ? data : null, fileDigests };
}

function checkDuplicates(data, report) {
  for (const [kind, file] of Object.entries(ARTIFACT_FILES)) {
    const seen = new Set();
    for (const record of data[kind] || []) {
      const key = kind === 'findings' ? `${record.finding_id}@${record.revision}` : record[ID_FIELDS[file]];
      if (seen.has(key)) report.error('duplicate-id', file, key, `duplicate identifier ${key}`);
      seen.add(key);
    }
  }
}

function semanticChecks(manifest, data, allowRestricted, report) {
  const papers = new Map(data.papers.map((p) => [p.paper_id, p]));
  const passages = new Map(data.passages.map((p) => [p.passage_id, p]));
  const findingByKey = new Map(data.findings.map((f) => [`${f.finding_id}@${f.revision}`, f]));
  const assessmentsByRevision = new Map();
  for (const a of data.assessments) {
    const key = `${a.finding_id}@${a.finding_revision}`;
    assessmentsByRevision.set(key, [...(assessmentsByRevision.get(key) || []), a]);
  }
  const scope = manifest.access_scope;
  const status = manifest.export_status;
  const { state } = status;

  if (scope.level === 'private' || scope.level === 'embargoed') {
    const emit = allowRestricted ? report.warn.bind(report) : report.error.bind(report);
    emit('private-packet-not-exportable', MANIFEST_FILE, 'access_scope', `access_scope.level is ${scope.level}`);
  }
  if (scope.level === 'embargoed') {
    if (!scope.embargo_until) report.error('embargo-expired-or-missing', MANIFEST_FILE, 'access_scope', 'no embargo_until');
    else if (scope.embargo_until <= manifest.created_at) {
      report.error('embargo-expired-or-missing', MANIFEST_FILE, 'access_scope', 'embargo_until is not after created_at');
    }
  }
  if (state === 'complete' && Object.values(status.withheld_counts).some((v) => v > 0)) {
    report.error('completeness-fabricated', MANIFEST_FILE, 'export_status', 'state is complete but withheld_counts are non-zero');
  }
  if (state === 'withheld' && (Object.values(manifest.artifacts).some((a) => a.record_count !== 0) || !status.reasons.length)) {
    report.error('silent-omission', MANIFEST_FILE, 'export_status', 'state withheld requires zero records and non-empty reasons');
  }

  for (const paper of data.papers) {
    if (paper.rights.full_text_included === true) report.error('full-text-flag', 'papers.jsonl', paper.paper_id, 'full_text_included is true');
  }

  for (const passage of data.passages) {
    const id = passage.passage_id;
    const paper = papers.get(passage.paper_id);
    if (!paper) report.error('dangling-paper-ref', 'passages.jsonl', id, `unknown ${passage.paper_id}`);
    else {
      if (passage.source.snapshot_ref !== paper.source_snapshot.snapshot_ref) {
        report.error('snapshot-ref-mismatch', 'passages.jsonl', id, 'passage snapshot_ref differs from paper source_snapshot.snapshot_ref');
      }
      if (passage.quote_state === 'included' && NOT_REDISTRIBUTABLE.has(paper.rights.redistribution)) {
        report.error('restricted-quote-leak', 'passages.jsonl', id, `quote included although redistribution is ${paper.rights.redistribution}`);
      }
    }
    const { start, end } = passage.source;
    if (GOOD_MATCH.has(passage.match.status)) {
      if (start === null || end === null || end <= start) {
        report.error('match-offset-inconsistent', 'passages.jsonl', id, 'exact/normalized match needs non-null offsets with end > start');
      }
    } else if (start !== null || end !== null) {
      report.error('match-offset-inconsistent', 'passages.jsonl', id, `match status ${passage.match.status} requires null offsets`);
    }
    if (passage.quote_state === 'included') {
      if (passage.quote === 'withheld') {
        report.error('withheld-quote-inconsistent', 'passages.jsonl', id, "quote_state included but quote is the literal 'withheld'");
      } else if (sha256(Buffer.from(passage.quote, 'utf8')) !== passage.quote_sha256) {
        report.error('quote-hash-mismatch', 'passages.jsonl', id, 'sha256(quote) != quote_sha256');
      }
    } else if (passage.quote !== 'withheld') {
      report.error('withheld-quote-inconsistent', 'passages.jsonl', id, "quote_state withheld-rights requires quote to be the literal 'withheld'");
    }
  }

  const revisions = new Map();
  for (const f of data.findings) revisions.set(f.finding_id, [...(revisions.get(f.finding_id) || []), f.revision]);
  for (const id of [...revisions.keys()].sort()) {
    const sorted = [...revisions.get(id)].sort((a, b) => a - b);
    if (sorted.some((value, index) => value !== index + 1)) {
      report.error('revision-gap', 'findings.jsonl', id, `revisions [${sorted}] are not 1..${sorted.length}`);
    }
  }

  for (const f of data.findings) {
    const rid = `${f.finding_id}@${f.revision}`;
    const paper = papers.get(f.paper_id);
    if (!paper) report.error('dangling-paper-ref', 'findings.jsonl', rid, `unknown ${f.paper_id}`);
    const own = [];
    for (const passageId of f.passage_ids) {
      const passage = passages.get(passageId);
      if (!passage) {
        report.error('dangling-passage-ref', 'findings.jsonl', rid, `unknown ${passageId}`);
        if (state !== 'partial') {
          report.error('completeness-fabricated', 'findings.jsonl', rid, `references absent passage ${passageId} but export_status.state is ${state}`);
        }
        continue;
      }
      own.push(passage);
      if (passage.paper_id !== f.paper_id) {
        report.error('passage-paper-mismatch', 'findings.jsonl', rid, `passage ${passageId} belongs to ${passage.paper_id}, finding to ${f.paper_id}`);
      }
    }
    const assessments = assessmentsByRevision.get(rid) || [];
    const level = VERIFICATION_ORDER.indexOf(f.verification_level);
    const judged = assessments.filter((a) => JUDGMENT_STATUSES.has(a.status));
    const hasGoodPassage = own.some((p) => GOOD_MATCH.has(p.match.status));

    if (f.export_state === 'approved-for-export') {
      if (f.review_state !== 'human-reviewed') report.error('approved-without-review', 'findings.jsonl', rid, 'not human-reviewed');
      if (!hasGoodPassage) {
        report.error('unmatched-passage-approved', 'findings.jsonl', rid, 'no passage with match exact or normalized');
        if (own.some((p) => BAD_MATCH.has(p.match.status))) {
          report.error('ambiguous-passage-approved', 'findings.jsonl', rid, 'supported only by ambiguous/not_found/invalid/incomplete passages');
        }
      }
      if (paper && (paper.rights.redistribution === 'restricted' || paper.rights.redistribution === 'unknown')) {
        report.error('approved-in-restricted-packet', 'findings.jsonl', rid, `paper redistribution is ${paper.rights.redistribution}`);
      }
    }
    if (f.review_state === 'human-reviewed' && !assessments.length) {
      report.error('review-without-assessment', 'findings.jsonl', rid, 'no assessment');
    }

    const problems = [];
    if (f.verification_level === 'unverified' && f.review_state === 'human-reviewed' && judged.length) {
      problems.push('unverified conflicts with human-reviewed state and judgments');
    }
    if (level >= 1 && !judged.length) problems.push('needs >=1 supports/contradicts/insufficient/unclear assessment');
    if (level >= 2) {
      const captured = Boolean(paper) && paper.source_snapshot.state === 'captured';
      const matched = assessments.some((a) => SUPPORT_OR_CONTRA.has(a.status) && GOOD_MATCH.has(passages.get(a.passage_id)?.match.status));
      if (!(captured && matched)) {
        problems.push('needs a supports/contradicts assessment on an exact/normalized passage and a captured snapshot');
      }
    }
    if (level >= 3 && new Set(judged.map((a) => a.reviewer_ref)).size < 2) problems.push('needs >=2 distinct reviewer_refs with judgments');
    for (const problem of problems) report.error('verification-overclaim', 'findings.jsonl', rid, `${f.verification_level}: ${problem}`);
    if (level >= 2 && !judged.length) {
      report.error('quote-presence-as-support', 'findings.jsonl', rid, 'verification rests on quote presence; evidence assessments are only not_assessed/unknown/restricted or absent');
    }
  }

  for (const a of data.assessments) {
    const id = a.assessment_id;
    const known = [...findingByKey.values()].some((f) => f.finding_id === a.finding_id);
    if (!known) report.error('dangling-finding-ref', 'assessments.jsonl', id, a.finding_id);
    else if (!findingByKey.has(`${a.finding_id}@${a.finding_revision}`)) {
      report.error('dangling-revision-ref', 'assessments.jsonl', id, `${a.finding_id} has no revision ${a.finding_revision}`);
    }
    const passage = passages.get(a.passage_id);
    if (!passage) report.error('dangling-passage-ref', 'assessments.jsonl', id, a.passage_id);
    const finding = findingByKey.get(`${a.finding_id}@${a.finding_revision}`);
    if (finding) {
      const paper = papers.get(finding.paper_id);
      if (paper && a.assessed_snapshot_sha256 !== paper.source_snapshot.sha256) {
        report.error('assessed-snapshot-mismatch', 'assessments.jsonl', id, 'assessed_snapshot_sha256 differs from the paper snapshot sha256');
      }
      // importer: an assessment must judge a passage the finding itself cites, on the finding's own paper.
      if (passage && (passage.paper_id !== finding.paper_id || !finding.passage_ids.includes(a.passage_id))) {
        report.error('assessment-cross-link', 'assessments.jsonl', id, `assessment judges ${a.passage_id}, which is not a passage of ${a.finding_id}@${a.finding_revision} on ${finding.paper_id}`);
      }
    }
  }
}

function summarize(manifest, data, report) {
  const findings = data.findings || [];
  const tally = (key) => Object.fromEntries(
    Object.entries(findings.reduce((acc, f) => ({ ...acc, [f[key]]: (acc[f[key]] || 0) + 1 }), {})).sort(),
  );
  const kindOfFile = Object.fromEntries(Object.entries(ARTIFACT_FILES).map(([kind, file]) => [file, kind]));
  const rejected = Object.fromEntries(Object.keys(ARTIFACT_FILES).map((kind) => [kind, 0]));
  const seen = new Set();
  for (const e of report.errors) {
    const kind = kindOfFile[e.file];
    if (kind && e.id !== '-' && !seen.has(`${kind}/${e.id}`)) {
      seen.add(`${kind}/${e.id}`);
      rejected[kind] += 1;
    }
  }
  const withheld = manifest?.export_status?.withheld_counts || {};
  return {
    ...Object.fromEntries(Object.keys(ARTIFACT_FILES).map((kind) => [kind, (data[kind] || []).length])),
    findings_by_export_state: tally('export_state'),
    findings_by_verification: tally('verification_level'),
    omitted: Object.fromEntries(Object.keys(ARTIFACT_FILES).map((kind) => [kind, withheld[kind] || 0])),
    rejected,
  };
}

/**
 * Validate the packet directory. Never throws for malformed input: every defect becomes an
 * error entry sorted by (code, file, id). `packet` is set only when the packet is usable.
 */
export function validatePacket(directory, { allowRestricted = false, ignoreFiles = [] } = {}) {
  const report = new Report();
  let data = {};
  let manifest = null;
  let manifestBytes = null;
  let fileDigests = null;
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
    report.error('artifact-missing', directory, '-', 'packet directory does not exist');
  } else {
    ({ manifest, raw: manifestBytes } = readManifest(directory, report));
    if (manifest) {
      if (manifest.access_scope?.redistributable_full_text === true) {
        report.error('full-text-flag', MANIFEST_FILE, 'access_scope', 'access_scope.redistributable_full_text must be false');
      }
      if (manifest.schema_version !== SCHEMA_VERSION) {
        report.error('unsupported-schema-version', MANIFEST_FILE, 'schema_version', `expected ${SCHEMA_VERSION}, got ${JSON.stringify(manifest.schema_version)}`);
      } else {
        for (const message of validateJsonSchema(manifest, loadSchemas()[MANIFEST_FILE])) {
          report.error(`schema-invalid:${MANIFEST_FILE}`, MANIFEST_FILE, '-', message);
        }
        if (!report.hasPrefix('schema-invalid:')) {
          const gathered = gather(directory, manifest, report, ignoreFiles);
          fileDigests = gathered.fileDigests;
          if (gathered.data) {
            data = gathered.data;
            checkDuplicates(data, report);
            semanticChecks(manifest, data, allowRestricted, report);
          }
        }
      }
    }
  }
  const errors = sortedUnique(report.errors);
  const usable = errors.length === 0 && manifest !== null;
  return {
    valid: errors.length === 0,
    errors,
    warnings: sortedUnique(report.warnings),
    counts: summarize(manifest, data, { errors }),
    packet: usable
      ? { manifest, data, manifest_sha256: sha256(manifestBytes), artifact_sha256: fileDigests }
      : null,
  };
}
