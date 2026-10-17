// Mirror of the ORAtlas import contracts this exporter targets.
//
// The authoritative definitions are `packages/contracts/src/{artifacts,manifest,
// enums,identifiers,paths}.ts` in dhuzard/oratlas at ORATLAS_PINNED_COMMIT.
// scripts/oratlas/validate-with-oratlas.mjs checks this mirror against a real
// ORAtlas checkout and runs the real `extractKnowledgeWithOutcomes`, so any drift
// is caught there rather than trusted here.

export const ORATLAS_REPOSITORY = 'https://github.com/dhuzard/oratlas';
export const ORATLAS_PINNED_COMMIT = '9cd3a0c284400b30dd0044cf3acb24df1047275d';

export const MANIFEST_SCHEMA_VERSION = '1.0.0';

export const CLAIM_TYPES = [
  'empirical',
  'mechanistic',
  'methodological',
  'theoretical',
  'normative',
  'summary',
  'other',
  'synthesis',
  'model-derived',
  'translational',
  'study-design',
  'resource-capability',
  'hypothesis-capability',
  'provenance-limitation',
];

export const RELATION_TYPES = [
  'supports',
  'partially-supports',
  'contradicts',
  'contextualizes',
  'method-source',
  'background',
  'unclear',
];

export const REVIEW_TYPES = [
  'ai-synthesis',
  'computational-literature-review',
  'systematic-review',
  'scoping-review',
  'narrative-review',
  'meta-analysis',
  'other',
  'data-release',
];

export const LIMITS = {
  claim: { id: 120, text: 5000, section: 300, anchor: 300, method: 300 },
  citation: { id: 120, title: 1000, author: 300, authors: 200, source: 500, url: 1000 },
  relation: { id: 120, sourceLocation: 500, extractionMethod: 200 },
  maxRecords: 5000,
};

export const DOI_PATTERN = /^10\.\d{4,9}\/\S+$/u;
export const PMID_PATTERN = /^\d{1,9}$/u;
export const COMMIT_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const PATH_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;

export function isSafeRepoRelativePath(path) {
  if (typeof path !== 'string' || path.length === 0 || path.length > 512) return false;
  if (/[\u0000-\u001f\u007f]/u.test(path)) return false;
  if (path.includes('\\') || path.includes(':')) return false;
  if (path.startsWith('/') || path.startsWith('~')) return false;
  return path.split('/').every((segment) => segment && segment !== '.' && segment !== '..' && PATH_SEGMENT.test(segment));
}
