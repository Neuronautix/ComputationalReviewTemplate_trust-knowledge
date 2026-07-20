import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve, sep } from 'node:path';
import { mkdirSync } from 'node:fs';

export const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
export const CLAIM_ID_PATTERN = /^clm_[a-f0-9]{16}$/u;
export const VERSION_PATTERN = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u;
export const COMPONENT_NAMES = [
  'traceability',
  'robustness',
  'uncertainty_calibration',
  'source_integrity',
  'transferability_scope_control',
];

export const SOURCE_NATIVE_ORIGIN = 'source_native_trust';
export const CURRENT_ASSESSMENT_PROJECTION = 'claim_object_current_behavior';

export function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

export function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function writeText(path, value) {
  mkdirSync(dirname(resolve(path)), { recursive: true });
  writeFileSync(path, value, 'utf8');
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function sha256File(path) {
  return sha256(readFileSync(path));
}

export function parseArgs(argv, required = []) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    invariant(token.startsWith('--'), `Unexpected argument: ${token}`);
    const key = token.slice(2);
    invariant(key.length > 0 && !Object.hasOwn(args, key), `Duplicate or empty option: ${token}`);
    const value = argv[index + 1];
    invariant(value !== undefined && !value.startsWith('--'), `Missing value for ${token}`);
    args[key] = value;
    index += 1;
  }
  for (const key of required) invariant(args[key], `Missing required --${key}`);
  return args;
}

export function safeRelativePath(baseDir, relativePath, label = 'path') {
  invariant(typeof relativePath === 'string' && relativePath.length > 0, `${label} must be non-empty`);
  invariant(!isAbsolute(relativePath), `${label} must be relative`);
  invariant(!relativePath.includes('\\'), `${label} must use forward slashes`);
  const segments = relativePath.split('/');
  invariant(segments.every((segment) => segment && segment !== '.' && segment !== '..'), `${label} is unsafe`);
  const root = resolve(baseDir);
  const target = resolve(root, ...segments);
  invariant(target === root || target.startsWith(`${root}${sep}`), `${label} escapes the base directory`);
  return target;
}

export function compareSemver(left, right) {
  invariant(VERSION_PATTERN.test(left), `Invalid semantic version: ${left}`);
  invariant(VERSION_PATTERN.test(right), `Invalid semantic version: ${right}`);
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

export function unique(values, label) {
  invariant(new Set(values).size === values.length, `${label} must be unique`);
}

export function sortedUnique(values) {
  return [...new Set(values)].sort(compareText);
}

export function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function validateReleaseRef(release, label = 'release') {
  invariant(isObject(release), `${label} must be an object`);
  invariant(/^review-[a-z0-9][a-z0-9-]{2,63}$/u.test(release.review_id), `${label}.review_id is invalid`);
  invariant(/^release-[a-z0-9][a-z0-9-]{7,95}$/u.test(release.release_id), `${label}.release_id is invalid`);
  invariant(VERSION_PATTERN.test(release.version), `${label}.version is invalid`);
  invariant(SHA256_PATTERN.test(release.manifest_sha256), `${label}.manifest_sha256 is invalid`);
  invariant(Number.isFinite(Date.parse(release.frozen_at)), `${label}.frozen_at is invalid`);
}

export function validateSourceNativeProvenance(provenance, label = 'source_native_provenance') {
  invariant(isObject(provenance), `${label} must be an object`);
  invariant(/^https:\/\//u.test(provenance.originating_repository || ''), `${label}.originating_repository must be an HTTPS URL`);
  invariant(typeof provenance.rubric_version === 'string' && provenance.rubric_version.length > 0, `${label}.rubric_version is required`);
  invariant(typeof provenance.method_version === 'string' && provenance.method_version.length > 0, `${label}.method_version is required`);
  invariant(provenance.semantic_origin === SOURCE_NATIVE_ORIGIN, `${label}.semantic_origin must be ${SOURCE_NATIVE_ORIGIN}`);
  invariant(provenance.oratlas_re_adjudicated === false, `${label}.oratlas_re_adjudicated must be false`);
  invariant(provenance.assessment_unit?.decision_id === 'D01', `${label}.assessment_unit must reference D01`);
  invariant(provenance.assessment_unit?.status === 'proposed', `${label}.assessment_unit.status must remain proposed`);
  invariant(provenance.assessment_unit?.projection === CURRENT_ASSESSMENT_PROJECTION, `${label}.assessment_unit.projection must describe current storage behavior`);
  invariant(provenance.disagreement?.decision_id === 'D09', `${label}.disagreement must reference D09`);
  invariant(provenance.disagreement?.status === 'proposed', `${label}.disagreement.status must remain proposed`);
  invariant(provenance.disagreement?.representation === 'not_available', `${label}.disagreement.representation must be not_available`);
  invariant(provenance.disagreement?.aggregation_performed === false, `${label}.disagreement.aggregation_performed must be false`);
  invariant(provenance.export_semantics?.decision_id === 'D11', `${label}.export_semantics must reference D11`);
  invariant(provenance.export_semantics?.status === 'proposed', `${label}.export_semantics.status must remain proposed`);
  return provenance;
}

export function validateTrustSnapshot(trust, label) {
  invariant(isObject(trust), `${label} must be an object`);
  invariant(typeof trust.rubric_version === 'string' && trust.rubric_version.length > 0, `${label}.rubric_version is required`);
  invariant(SHA256_PATTERN.test(trust.report_sha256), `${label}.report_sha256 is invalid`);
  invariant(isObject(trust.component_scores), `${label}.component_scores must be an object`);
  for (const component of COMPONENT_NAMES) {
    invariant(Number.isInteger(trust.component_scores[component])
      && trust.component_scores[component] >= 0
      && trust.component_scores[component] <= 4, `${label}.${component} must be an integer from 0 to 4`);
  }
  invariant(Number.isInteger(trust.overall_score)
    && trust.overall_score >= 0
    && trust.overall_score <= 100, `${label}.overall_score must be an integer from 0 to 100`);
  invariant(typeof trust.trust_label === 'string' && trust.trust_label.length > 0, `${label}.trust_label is required`);
}

export function validateSnapshot(snapshot, label = 'snapshot') {
  invariant(isObject(snapshot), `${label} must be an object`);
  invariant(snapshot.schema_version === '1.0.0', `${label}.schema_version must be 1.0.0`);
  validateSourceNativeProvenance(snapshot.source_native_provenance, `${label}.source_native_provenance`);
  validateReleaseRef(snapshot.release, `${label}.release`);
  invariant(Array.isArray(snapshot.claims), `${label}.claims must be an array`);
  invariant(Array.isArray(snapshot.anchors), `${label}.anchors must be an array`);
  unique(snapshot.claims.map((claim) => claim.claim_id), `${label} claim IDs`);
  unique(snapshot.anchors.map((anchor) => anchor.anchor_id), `${label} anchor IDs`);
  const claimIds = new Set(snapshot.claims.map((claim) => claim.claim_id));
  for (const [index, claim] of snapshot.claims.entries()) {
    const prefix = `${label}.claims[${index}]`;
    invariant(CLAIM_ID_PATTERN.test(claim.claim_id), `${prefix}.claim_id is invalid`);
    invariant(Array.isArray(claim.supersedes_claim_ids), `${prefix}.supersedes_claim_ids must be an array`);
    unique(claim.supersedes_claim_ids, `${prefix}.supersedes_claim_ids`);
    invariant(claim.supersedes_claim_ids.every((id) => CLAIM_ID_PATTERN.test(id)), `${prefix}.supersedes_claim_ids contains an invalid ID`);
    invariant(typeof claim.claim_text === 'string' && claim.claim_text.length > 0, `${prefix}.claim_text is required`);
    invariant(Array.isArray(claim.citation_keys), `${prefix}.citation_keys must be an array`);
    unique(claim.citation_keys, `${prefix}.citation_keys`);
    invariant(isObject(claim.evidence_basis), `${prefix}.evidence_basis must be an object`);
    invariant(isObject(claim.source) && typeof claim.source.path === 'string'
      && SHA256_PATTERN.test(claim.source.sha256), `${prefix}.source is invalid`);
    validateTrustSnapshot(claim.trust, `${prefix}.trust`);
    invariant(Array.isArray(claim.human_decision_references), `${prefix}.human_decision_references must be an array`);
    unique(claim.human_decision_references, `${prefix}.human_decision_references`);
    invariant(Array.isArray(claim.relations), `${prefix}.relations must be an array`);
    for (const relation of claim.relations) {
      invariant(['supports', 'contradicts', 'qualifies'].includes(relation.predicate), `${prefix} has an invalid relation predicate`);
      invariant(CLAIM_ID_PATTERN.test(relation.target_claim_id), `${prefix} has an invalid relation target`);
      invariant(claimIds.has(relation.target_claim_id), `${prefix} relation target is absent from the snapshot`);
    }
  }
  for (const [index, anchor] of snapshot.anchors.entries()) {
    const prefix = `${label}.anchors[${index}]`;
    invariant(typeof anchor.anchor_id === 'string' && anchor.anchor_id.length > 0, `${prefix}.anchor_id is required`);
    invariant(isObject(anchor.selector), `${prefix}.selector must be an object`);
    invariant(['claim', 'text'].includes(anchor.selector.kind), `${prefix}.selector.kind is invalid`);
    if (anchor.selector.kind === 'claim') {
      invariant(CLAIM_ID_PATTERN.test(anchor.selector.claim_id), `${prefix}.selector.claim_id is invalid`);
      invariant(claimIds.has(anchor.selector.claim_id), `${prefix}.selector.claim_id is absent from the snapshot`);
    } else {
      invariant(typeof anchor.selector.source_path === 'string' && anchor.selector.source_path.length > 0, `${prefix}.selector.source_path is required`);
      invariant(SHA256_PATTERN.test(anchor.selector.source_sha256), `${prefix}.selector.source_sha256 is invalid`);
      invariant(typeof anchor.selector.exact_quote === 'string' && anchor.selector.exact_quote.length > 0, `${prefix}.selector.exact_quote is required`);
    }
    invariant(Array.isArray(anchor.human_decision_references), `${prefix}.human_decision_references must be an array`);
  }
  return snapshot;
}

export function validateFrozenTrustReport(snapshot, report, reportDigest, label = 'trust_report') {
  invariant(SHA256_PATTERN.test(reportDigest), `${label} digest is invalid`);
  invariant(isObject(report), `${label} must be an object`);
  invariant(typeof report.schema_version === 'string' && report.schema_version.length > 0, `${label}.schema_version is required`);
  invariant(typeof report.rubric_version === 'string' && report.rubric_version.length > 0, `${label}.rubric_version is required`);
  validateSourceNativeProvenance(report.source_native_provenance, `${label}.source_native_provenance`);
  invariant(report.source_native_provenance.rubric_version === report.rubric_version, `${label} source-native rubric version differs from report`);
  invariant(deepEqual(snapshot.source_native_provenance, report.source_native_provenance), `${label} source-native provenance differs from snapshot`);
  invariant(Number.isFinite(Date.parse(report.generated_at)), `${label}.generated_at is invalid`);
  invariant(report.release_id === snapshot.release.release_id, `${label}.release_id differs from the snapshot`);
  invariant(Date.parse(report.generated_at) <= Date.parse(snapshot.release.frozen_at), `${label} was generated after the release froze`);
  invariant(Array.isArray(report.claims), `${label}.claims must be an array`);
  unique(report.claims.map((claim) => claim.claim_id), `${label} claim IDs`);
  invariant(report.claims.length === snapshot.claims.length, `${label} claim count differs from the snapshot`);
  const reportClaims = new Map(report.claims.map((claim) => [claim.claim_id, claim]));
  for (const claim of snapshot.claims) {
    const reported = reportClaims.get(claim.claim_id);
    invariant(reported, `${label} lacks ${claim.claim_id}`);
    invariant(claim.trust.report_sha256 === reportDigest, `${claim.claim_id} does not reference the verified ${label} digest`);
    invariant(claim.trust.rubric_version === report.rubric_version, `${claim.claim_id} rubric version differs from ${label}`);
    invariant(deepEqual(claim.trust.component_scores, reported.component_scores), `${claim.claim_id} component scores differ from ${label}`);
    invariant(claim.trust.overall_score === reported.overall_score, `${claim.claim_id} overall score differs from ${label}`);
    invariant(claim.trust.trust_label === reported.trust_label, `${claim.claim_id} trust label differs from ${label}`);
  }
  return report;
}

export function deepEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function setDiff(before, after) {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  return {
    added: sortedUnique(after.filter((value) => !beforeSet.has(value))),
    removed: sortedUnique(before.filter((value) => !afterSet.has(value))),
  };
}
