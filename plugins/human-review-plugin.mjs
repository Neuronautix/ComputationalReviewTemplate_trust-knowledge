import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { validateContract } = require('../scripts/validate-community-contracts.js');
const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APPROVED_COMMUNITY_ROOT = resolve(REPOSITORY_ROOT, 'community');

function optionText(value) {
  const text = String(value || '').trim();
  if (text.length >= 2) {
    const first = text[0];
    const last = text[text.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return text.slice(1, -1);
    }
  }
  return text;
}

function parseList(value) {
  return String(value || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

const humanReviewsDirective = {
  name: 'human-reviews',
  doc: 'Render accepted human submissions beside a canonical TRUST claim without changing its score.',
  options: {
    'claim-id': { type: String },
    'review-version': { type: String },
    'release-manifest-sha256': { type: String },
    'submissions-path': { type: String },
    'submission-ids': { type: String },
  },
  run(data) {
    return [{
      type: 'human-reviews',
      claimId: optionText(data.options?.['claim-id']),
      reviewVersion: optionText(data.options?.['review-version']),
      releaseManifestSha256: optionText(data.options?.['release-manifest-sha256']),
      submissionsPath: optionText(data.options?.['submissions-path']) || '../community/human_submissions.json',
      submissionIds: parseList(data.options?.['submission-ids']),
    }];
  },
};

function normalizeCharacter(character) {
  if (/\s/u.test(character)) return ' ';
  if (/[\u2018\u2019\u201A\u201B]/u.test(character)) return "'";
  if (/[\u201C\u201D\u201E\u201F]/u.test(character)) return '"';
  if (/[\u2010-\u2015\u2212]/u.test(character)) return '-';
  if (character === '\u00AD') return '';
  return character.normalize('NFKC');
}

function normalizeText(value) {
  let result = '';
  for (const character of String(value || '')) {
    const normalized = normalizeCharacter(character);
    for (const outputCharacter of normalized) {
      if (outputCharacter === ' ' && result.endsWith(' ')) continue;
      result += outputCharacter;
    }
  }
  return result.trim();
}

/** W3C TextQuoteSelector-style exact/prefix/suffix matching. */
export function findTextQuote(text, exact, prefix = '', suffix = '') {
  const haystack = normalizeText(text);
  const quote = normalizeText(exact);
  const before = normalizeText(prefix);
  const after = normalizeText(suffix);
  if (!quote) return null;

  const matches = [];
  let from = 0;
  while (from <= haystack.length - quote.length) {
    const index = haystack.indexOf(quote, from);
    if (index === -1) break;
    const prefixMatches = !before || haystack.slice(0, index).trimEnd().endsWith(before);
    const suffixMatches = !after || haystack.slice(index + quote.length).trimStart().startsWith(after);
    if (prefixMatches && suffixMatches) matches.push({ start: index, end: index + quote.length });
    from = index + 1;
  }
  return matches.length === 1 ? matches[0] : null;
}

function textContent(node) {
  if (!node || typeof node !== 'object') return '';
  if (typeof node.value === 'string') return node.value;
  if (!Array.isArray(node.children)) return '';
  return node.children.map(textContent).join('');
}

function classNames(node) {
  return String(node?.class || '').split(/\s+/u).filter(Boolean);
}

function stableToken(value, fallback) {
  const token = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
  return token || fallback;
}

function previousParagraph(children, index) {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const candidate = children[cursor];
    if (candidate?.type === 'paragraph') return candidate;
    if (candidate?.type === 'aside') continue;
    return null;
  }
  return null;
}

function previousTrustModel(children, index, claimId) {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const candidate = children[cursor];
    if (candidate?.type === 'paragraph') return null;
    if (!classNames(candidate).includes('trust-claim-aside')) continue;
    const widget = candidate.children?.find((child) => child?.type === 'anywidget');
    if (!widget?.model || widget.model.claimId !== claimId) return null;
    return widget.model;
  }
  return null;
}

function ensureParagraphScope(paragraph, claimId, occurrence) {
  if (!paragraph) return '';
  const identifier = `human-review-scope-${stableToken(claimId, `claim-${occurrence}`)}`;
  const existing = paragraph.children?.find((child) => child?.identifier === identifier);
  if (existing) return identifier;
  paragraph.children = [{
    type: 'span',
    identifier,
    class: 'human-review-scope',
    children: paragraph.children || [],
  }];
  return identifier;
}

function sourcePathFrom(vfile) {
  const normalized = String(vfile?.path || '').replaceAll('\\', '/');
  const contentIndex = normalized.lastIndexOf('/content/');
  if (contentIndex >= 0) return normalized.slice(contentIndex + 1);
  return normalized.replace(/^\.\//u, '');
}

function sourceDigestFrom(vfile) {
  try {
    const source = vfile?.value != null
      ? (Buffer.isBuffer(vfile.value) ? vfile.value : Buffer.from(String(vfile.value), 'utf8'))
      : readFileSync(vfile.path);
    return createHash('sha256').update(source).digest('hex');
  } catch {
    return '';
  }
}

function pluginError(message) {
  return new Error(`human-review-plugin: ${message}`);
}

function assertInsideDirectory(candidate, approvedRoot) {
  const pathFromRoot = relative(approvedRoot, candidate);
  if (!pathFromRoot || pathFromRoot.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || pathFromRoot === '..' || isAbsolute(pathFromRoot)) {
    throw pluginError(`submissions-path must resolve to a JSON file inside ${approvedRoot}; received ${candidate}`);
  }
}

/** Resolve a submission collection inside the repository community directory. */
export function resolveSubmissionsPath(submissionsPath, docDir, approvedRoot = APPROVED_COMMUNITY_ROOT) {
  if (!String(submissionsPath || '').trim()) {
    throw pluginError('missing required :submissions-path: option');
  }
  let canonicalRoot;
  try {
    canonicalRoot = realpathSync(approvedRoot);
  } catch (error) {
    throw pluginError(`approved community directory is unavailable (${approvedRoot}): ${error.message}`);
  }

  const lexicalCandidate = resolve(docDir, submissionsPath);
  assertInsideDirectory(lexicalCandidate, resolve(approvedRoot));
  if (extname(lexicalCandidate).toLowerCase() !== '.json') {
    throw pluginError(`submissions-path must name a .json file inside community/: ${submissionsPath}`);
  }

  let canonicalCandidate;
  try {
    canonicalCandidate = realpathSync(lexicalCandidate);
    if (!statSync(canonicalCandidate).isFile()) throw new Error('path is not a regular file');
  } catch (error) {
    throw pluginError(`cannot read submissions-path ${submissionsPath}: ${error.message}`);
  }
  assertInsideDirectory(canonicalCandidate, canonicalRoot);
  return canonicalCandidate;
}

function readHumanSubmissionSchema(approvedRoot) {
  const schemaPath = resolve(approvedRoot, 'schemas', 'human_submission.schema.json');
  try {
    return JSON.parse(readFileSync(schemaPath, 'utf8'));
  } catch (error) {
    throw pluginError(`cannot load canonical human-submission schema ${schemaPath}: ${error.message}`);
  }
}

/** Load and contract-validate every record claiming accepted status. */
export function loadSubmissionCollection(node, docDir, approvedRoot = APPROVED_COMMUNITY_ROOT) {
  const collectionPath = resolveSubmissionsPath(node.submissionsPath, docDir, approvedRoot);
  let data;
  try {
    data = JSON.parse(readFileSync(collectionPath, 'utf8'));
  } catch (error) {
    throw pluginError(`malformed JSON in ${collectionPath}: ${error.message}`);
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw pluginError(`submission collection ${collectionPath} must be a JSON object envelope`);
  }
  if (data.schema_version !== '1.0.0' || !Array.isArray(data.submissions)) {
    throw pluginError(`submission collection ${collectionPath} requires schema_version "1.0.0" and a submissions array`);
  }

  const humanSchema = readHumanSubmissionSchema(approvedRoot);
  const acceptedRevisionKeys = new Set();
  for (const [index, submission] of data.submissions.entries()) {
    if (submission?.moderation?.state !== 'accepted') continue;
    const errors = validateContract(submission, humanSchema);
    if (errors.length > 0) {
      const recordLabel = submission?.submission_id || `record ${index + 1}`;
      throw pluginError(`accepted submission ${recordLabel} in ${collectionPath} violates the public contract:\n- ${errors.join('\n- ')}`);
    }
    const revisionKey = `${submission.submission_id}@${submission.revision}`;
    if (acceptedRevisionKeys.has(revisionKey)) {
      throw pluginError(`duplicate accepted submission revision ${revisionKey} in ${collectionPath}`);
    }
    acceptedRevisionKeys.add(revisionKey);
  }
  return data.submissions;
}

/** Acceptance is semantic: a state flag alone is not enough. */
export function isAcceptedSubmission(submission) {
  if (submission?.moderation?.state !== 'accepted') return false;
  if (!Number.isInteger(submission?.revision) || submission.revision < 1) return false;
  const createdAt = Date.parse(submission?.created_at || '');
  if (!Number.isFinite(createdAt)) return false;
  return (submission.moderation.events || []).some((event) => (
    event?.event === 'accepted'
    && Number.isFinite(Date.parse(event.at || ''))
    && Date.parse(event.at) >= createdAt
  ));
}

function publicSubmission(submission, selector, anchorStatus, orphanReason) {
  const reviewer = submission.submitter || {};
  const content = submission.content || {};
  return {
    submissionId: submission.submission_id,
    revision: submission.revision,
    reviewer: {
      displayName: reviewer.display_name || 'Anonymous reviewer',
      visibility: reviewer.visibility || 'pseudonymous',
      orcid: reviewer.orcid || '',
    },
    reviewVersion: submission.target.review_version,
    releaseManifestSha256: submission.target.release_manifest_sha256,
    payloadSha256: submission.provenance?.payload_sha256 || '',
    editorialStatus: submission.moderation.state,
    content: {
      kind: content.kind || 'comment',
      title: content.title || 'Human review comment',
      body: content.body_markdown || '',
      stance: content.stance || 'no_position',
      recommendation: content.recommendation || 'not_applicable',
      confidence: content.confidence ?? null,
    },
    selector: {
      ...selector,
      anchorStatus,
      orphanReason: orphanReason || '',
    },
  };
}

export function prepareAcceptedSubmissions(records, context) {
  const selectedIds = new Set(context.submissionIds || []);
  const requireIds = selectedIds.size > 0;
  const output = [];

  for (const submission of records || []) {
    if (!isAcceptedSubmission(submission)) continue;
    if (requireIds && !selectedIds.has(submission.submission_id)) continue;
    if (submission.target?.review_version !== context.reviewVersion) continue;
    if (submission.target?.release_manifest_sha256 !== context.releaseManifestSha256) continue;

    const target = submission.target?.selector || {};
    if (target.kind === 'claim') {
      if (target.claim_id !== context.claimId) continue;
      const trust = context.trustModel || {};
      const hasCanonicalTarget = Boolean(
        trust.claimId === context.claimId
        && (trust.targetAnchor || trust.targetId || (trust.scopeAnchor && trust.quote)),
      );
      const selector = {
        kind: 'claim',
        targetAnchor: trust.targetAnchor || '',
        targetId: trust.targetId || '',
        scopeAnchor: trust.scopeAnchor || '',
        exact: trust.quote || '',
        prefix: trust.prefix || '',
        suffix: trust.suffix || '',
      };
      output.push(publicSubmission(
        submission,
        selector,
        hasCanonicalTarget ? 'current' : 'orphaned',
        hasCanonicalTarget ? '' : 'The canonical TRUST target is unavailable in this rendered version.',
      ));
      continue;
    }

    if (target.kind !== 'text' || !requireIds) continue;
    const samePath = target.source_path === context.sourcePath;
    const sameDigest = target.source_sha256 === context.sourceDigest;
    const exactMatch = samePath && sameDigest
      ? findTextQuote(context.paragraphText, target.exact_quote, target.prefix, target.suffix)
      : null;
    let orphanReason = '';
    if (!samePath) orphanReason = 'The annotation targets a different source file.';
    else if (!sameDigest) orphanReason = 'The source file changed after this annotation was accepted.';
    else if (!exactMatch) orphanReason = 'The exact text is missing or ambiguous in this rendered version.';

    output.push(publicSubmission(submission, {
      kind: 'text',
      targetAnchor: '',
      targetId: '',
      scopeAnchor: context.scopeAnchor || '',
      exact: target.exact_quote || '',
      prefix: target.prefix || '',
      suffix: target.suffix || '',
    }, exactMatch ? 'current' : 'orphaned', orphanReason));
  }

  return output;
}

function validateDirectiveNode(node) {
  if (!/^clm_[a-f0-9]{16}$/u.test(node.claimId || '')) {
    throw pluginError('required :claim-id: must use canonical clm_[a-f0-9]{16} syntax');
  }
  if (!/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u.test(node.reviewVersion || '')) {
    throw pluginError('required :review-version: must be an exact semantic version such as 1.2.0');
  }
  if (!/^[a-f0-9]{64}$/u.test(node.releaseManifestSha256 || '')) {
    throw pluginError('required :release-manifest-sha256: must be 64 lowercase hexadecimal characters');
  }
  if (new Set(node.submissionIds || []).size !== (node.submissionIds || []).length) {
    throw pluginError(':submission-ids: contains a duplicate identifier');
  }
}

function assertExplicitSelectionsResolved(node, prepared) {
  if (!node.submissionIds?.length) return;
  const renderedIds = new Set(prepared.map((submission) => submission.submissionId));
  const unresolved = node.submissionIds.filter((submissionId) => !renderedIds.has(submissionId));
  if (unresolved.length > 0) {
    throw pluginError(
      `selected submission(s) ${unresolved.join(', ')} are missing, not accepted, or do not match the declared claim/version/release manifest`,
    );
  }
}

export function createHumanReviewTransform() {
  return (tree, vfile) => {
    const docDir = vfile?.path ? dirname(vfile.path) : process.cwd();
    const sourcePath = sourcePathFrom(vfile);
    const sourceDigest = sourceDigestFrom(vfile);
    let occurrence = 0;

    function walk(node) {
      if (!node || !Array.isArray(node.children)) return;
      for (let index = 0; index < node.children.length; index += 1) {
        const child = node.children[index];
        if (!child) continue;
        if (child.type !== 'human-reviews') {
          walk(child);
          continue;
        }

        occurrence += 1;
        validateDirectiveNode(child);
        const paragraph = previousParagraph(node.children, index);
        const trustModel = previousTrustModel(node.children, index, child.claimId);
        const scopeAnchor = ensureParagraphScope(paragraph, child.claimId, occurrence);
        const records = loadSubmissionCollection(child, docDir);
        const submissions = prepareAcceptedSubmissions(records, {
          claimId: child.claimId,
          reviewVersion: child.reviewVersion,
          releaseManifestSha256: child.releaseManifestSha256,
          submissionIds: child.submissionIds,
          sourcePath,
          sourceDigest,
          paragraphText: textContent(paragraph),
          scopeAnchor,
          trustModel,
        });
        assertExplicitSelectionsResolved(child, submissions);

        const token = stableToken(child.claimId, `claim-${occurrence}`);
        const instanceId = `human-reviews-${token}-${occurrence}`;
        node.children[index] = {
          type: 'aside',
          kind: 'margin',
          class: 'human-review-aside',
          children: [{
            type: 'anywidget',
            id: instanceId,
            class: 'human-review-widget',
            esm: './human-review-widget.mjs',
            css: './human-review-widget.css',
            model: {
              claimId: child.claimId,
              instanceId,
              reviewVersion: child.reviewVersion,
              releaseManifestSha256: child.releaseManifestSha256,
              submissions: JSON.stringify(submissions),
              layerNotice: 'Human assessments are separate from and never modify the computational TRUST score.',
            },
          }],
        };
      }
    }

    walk(tree);
  };
}

const humanReviewTransform = {
  name: 'human-review-data-loader',
  stage: 'document',
  plugin: createHumanReviewTransform,
};

export default {
  name: 'Human Review Plugin',
  directives: [humanReviewsDirective],
  transforms: [humanReviewTransform],
};
