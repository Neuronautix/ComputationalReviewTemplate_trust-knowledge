#!/usr/bin/env node

import {
  COMPONENT_NAMES,
  compareSemver,
  compareText,
  deepEqual,
  invariant,
  parseArgs,
  readJson,
  setDiff,
  sha256File,
  stableJson,
  unique,
  validateFrozenTrustReport,
  validateSourceNativeProvenance,
  validateReleaseRef,
  validateSnapshot,
  writeText,
} from './lib.mjs';
import { pathToFileURL } from 'node:url';

function claimState(claim) {
  if (!claim) return null;
  return {
    claim_id: claim.claim_id,
    claim_text: claim.claim_text,
    citation_keys: claim.citation_keys,
    evidence_basis: claim.evidence_basis,
    trust: claim.trust,
    human_decision_references: claim.human_decision_references,
  };
}

function semanticClaimState(claim) {
  const state = claimState(claim);
  if (!state) return null;
  return {
    ...state,
    trust: {
      rubric_version: state.trust.rubric_version,
      component_scores: state.trust.component_scores,
      overall_score: state.trust.overall_score,
      trust_label: state.trust.trust_label,
    },
  };
}

function comparison(before, after, status) {
  const beforeState = claimState(before);
  const afterState = claimState(after);
  const citationChanges = setDiff(before?.citation_keys || [], after?.citation_keys || []);
  const decisionChanges = setDiff(
    before?.human_decision_references || [],
    after?.human_decision_references || [],
  );
  const componentChanges = {};
  for (const component of COMPONENT_NAMES) {
    const oldScore = before?.trust.component_scores[component] ?? null;
    const newScore = after?.trust.component_scores[component] ?? null;
    if (oldScore !== newScore) componentChanges[component] = { before: oldScore, after: newScore };
  }
  return {
    comparison_id: `${before?.claim_id || 'none'}--${after?.claim_id || 'none'}`,
    status,
    before: beforeState,
    after: afterState,
    changes: {
      claim_text_changed: (before?.claim_text ?? null) !== (after?.claim_text ?? null),
      citations: citationChanges,
      evidence_basis_changed: !deepEqual(before?.evidence_basis ?? null, after?.evidence_basis ?? null),
      trust: {
        components: componentChanges,
        overall: before?.trust.overall_score === after?.trust.overall_score
          ? null
          : { before: before?.trust.overall_score ?? null, after: after?.trust.overall_score ?? null },
        label: before?.trust.trust_label === after?.trust.trust_label
          ? null
          : { before: before?.trust.trust_label ?? null, after: after?.trust.trust_label ?? null },
      },
      human_decision_references: decisionChanges,
    },
  };
}

function anchorChanges(before, after, claimMap) {
  const newerById = new Map(after.anchors.map((anchor) => [anchor.anchor_id, anchor]));
  const changes = [];
  for (const anchor of [...before.anchors].sort((a, b) => compareText(a.anchor_id, b.anchor_id))) {
    const newer = newerById.get(anchor.anchor_id) || null;
    let status = 'orphaned';
    if (newer) {
      const oldClaim = anchor.selector.kind === 'claim' ? anchor.selector.claim_id : null;
      const newClaim = newer.selector.kind === 'claim' ? newer.selector.claim_id : null;
      if (deepEqual(anchor.selector, newer.selector)) {
        status = 'current';
      } else if (oldClaim && newClaim && claimMap.get(oldClaim) === newClaim) {
        status = 'remapped';
      } else {
        invariant(false, `Anchor ${anchor.anchor_id} changed selector without explicit claim succession`);
      }
      newerById.delete(anchor.anchor_id);
    } else if (anchor.selector.kind === 'claim' && claimMap.has(anchor.selector.claim_id)) {
      status = 'orphaned';
    }
    changes.push({ anchor_id: anchor.anchor_id, status, before: anchor, after: newer });
  }
  for (const anchor of [...newerById.values()].sort((a, b) => compareText(a.anchor_id, b.anchor_id))) {
    changes.push({ anchor_id: anchor.anchor_id, status: 'added', before: null, after: anchor });
  }
  return changes;
}

export function buildScientificReviewDiff(beforeInput, afterInput, inputDigests = {}) {
  const before = validateSnapshot(beforeInput, 'from_snapshot');
  const after = validateSnapshot(afterInput, 'to_snapshot');
  invariant(before.release.review_id === after.release.review_id, 'Snapshots must describe the same review');
  invariant(compareSemver(before.release.version, after.release.version) < 0, 'The to-version must be newer than the from-version');
  invariant(before.release.release_id !== after.release.release_id, 'Immutable releases must have distinct release IDs');
  invariant(before.release.manifest_sha256 !== after.release.manifest_sha256, 'Immutable releases must have distinct manifest digests');
  for (const field of [
    'from_snapshot_sha256',
    'to_snapshot_sha256',
    'from_trust_report_sha256',
    'to_trust_report_sha256',
  ]) invariant(/^[a-f0-9]{64}$/u.test(inputDigests[field]), `${field} is required and must be SHA-256`);
  invariant(before.claims.every((claim) => claim.trust.report_sha256 === inputDigests.from_trust_report_sha256), 'from snapshot does not reference the verified TRUST report');
  invariant(after.claims.every((claim) => claim.trust.report_sha256 === inputDigests.to_trust_report_sha256), 'to snapshot does not reference the verified TRUST report');

  const beforeClaims = new Map(before.claims.map((claim) => [claim.claim_id, claim]));
  const afterClaims = new Map(after.claims.map((claim) => [claim.claim_id, claim]));
  const claimedAfterIds = new Set();
  const claimMap = new Map();
  const claims = [];

  for (const oldClaim of [...before.claims].sort((a, b) => compareText(a.claim_id, b.claim_id))) {
    const sameId = afterClaims.get(oldClaim.claim_id);
    const explicitSuccessors = [...afterClaims.values()].filter(
      (candidate) => candidate.supersedes_claim_ids.includes(oldClaim.claim_id),
    );
    invariant(explicitSuccessors.length <= 1, `Multiple old claims map to ${oldClaim.claim_id}`);
    invariant(!(sameId && explicitSuccessors.length > 0), `Retained and superseding claims both map from ${oldClaim.claim_id}`);
    const successor = sameId || explicitSuccessors[0];
    if (!successor) {
      claims.push(comparison(oldClaim, null, 'removed'));
      continue;
    }
    invariant(!claimedAfterIds.has(successor.claim_id), `Multiple old claims map to ${successor.claim_id}`);
    claimedAfterIds.add(successor.claim_id);
    claimMap.set(oldClaim.claim_id, successor.claim_id);
    const unchanged = oldClaim.claim_id === successor.claim_id
      && deepEqual(semanticClaimState(oldClaim), semanticClaimState(successor));
    claims.push(comparison(oldClaim, successor, unchanged ? 'unchanged' : 'modified'));
  }
  for (const newClaim of [...after.claims].sort((a, b) => compareText(a.claim_id, b.claim_id))) {
    if (!claimedAfterIds.has(newClaim.claim_id) && !beforeClaims.has(newClaim.claim_id)) {
      claims.push(comparison(null, newClaim, 'added'));
    }
  }

  const anchors = anchorChanges(before, after, claimMap);
  const statuses = ['added', 'removed', 'modified', 'unchanged'];
  const claimCounts = Object.fromEntries(statuses.map((status) => [
    status,
    claims.filter((claim) => claim.status === status).length,
  ]));
  return {
    schema_version: '1.0.0',
    artifact_type: 'scientific_review_version_diff',
    generated_at: after.release.frozen_at,
    from_release: before.release,
    to_release: after.release,
    immutable_inputs: {
      from_snapshot_sha256: inputDigests.from_snapshot_sha256 || null,
      to_snapshot_sha256: inputDigests.to_snapshot_sha256 || null,
      from_trust_report_sha256: inputDigests.from_trust_report_sha256,
      to_trust_report_sha256: inputDigests.to_trust_report_sha256,
    },
    methodology: {
      trust_recomputed: false,
      matching: 'same claim_id, then explicit supersedes_claim_ids',
    },
    source_native_provenance: after.source_native_provenance,
    summary: {
      claims: claimCounts,
      trust_overall_changed: claims.filter((claim) => claim.before && claim.after && claim.changes.trust.overall !== null).length,
      trust_overall_added_or_removed: claims.filter((claim) => !claim.before || !claim.after).length,
      evidence_basis_changed: claims.filter((claim) => claim.before && claim.after && claim.changes.evidence_basis_changed).length,
      evidence_basis_added_or_removed: claims.filter((claim) => !claim.before || !claim.after).length,
      human_decision_references_added: claims.reduce(
        (sum, claim) => sum + claim.changes.human_decision_references.added.length,
        0,
      ),
      orphaned_anchors: anchors.filter((anchor) => anchor.status === 'orphaned').length,
    },
    claims,
    anchor_changes: anchors,
    orphaned_anchors: anchors.filter((anchor) => anchor.status === 'orphaned'),
  };
}

export function validateScientificReviewDiff(diff) {
  invariant(diff?.schema_version === '1.0.0', 'scientific diff schema_version must be 1.0.0');
  invariant(diff?.artifact_type === 'scientific_review_version_diff', 'scientific diff artifact_type is invalid');
  validateReleaseRef(diff.from_release, 'from_release');
  validateReleaseRef(diff.to_release, 'to_release');
  invariant(compareSemver(diff.from_release.version, diff.to_release.version) < 0, 'scientific diff release order is invalid');
  invariant(diff.methodology?.trust_recomputed === false, 'scientific diff must not claim TRUST recomputation');
  validateSourceNativeProvenance(diff.source_native_provenance, 'scientific diff source_native_provenance');
  invariant(Array.isArray(diff.claims), 'scientific diff claims must be an array');
  invariant(Array.isArray(diff.anchor_changes), 'scientific diff anchor_changes must be an array');
  invariant(Array.isArray(diff.orphaned_anchors), 'scientific diff orphaned_anchors must be an array');
  unique(diff.claims.map((claim) => claim.comparison_id), 'scientific diff comparison IDs');
  unique(diff.anchor_changes.map((anchor) => anchor.anchor_id), 'scientific diff anchor IDs');
  invariant(diff.claims.every((claim) => ['added', 'removed', 'modified', 'unchanged'].includes(claim.status)), 'scientific diff has an invalid claim status');
  invariant(diff.orphaned_anchors.every((anchor) => anchor.status === 'orphaned'), 'orphaned_anchors contains a non-orphan');
  const orphanIds = diff.anchor_changes.filter((anchor) => anchor.status === 'orphaned').map((anchor) => anchor.anchor_id);
  invariant(deepEqual(orphanIds, diff.orphaned_anchors.map((anchor) => anchor.anchor_id)), 'orphaned anchor projection is inconsistent');
  return diff;
}

function cell(value) {
  return String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
}

export function renderScientificReviewDiffMarkdown(diff) {
  const lines = [
    '# Scientific review version diff',
    '',
    `From **${diff.from_release.version}** (${diff.from_release.release_id}) to **${diff.to_release.version}** (${diff.to_release.release_id}).`,
    '',
    '> TRUST values are compared from immutable inputs; this tool does not recompute them.',
    '',
    '## Summary',
    '',
    `- Claims: ${diff.summary.claims.added} added, ${diff.summary.claims.removed} removed, ${diff.summary.claims.modified} modified, ${diff.summary.claims.unchanged} unchanged.`,
    `- TRUST overall changed: ${diff.summary.trust_overall_changed}.`,
    `- TRUST records added or removed with claims: ${diff.summary.trust_overall_added_or_removed}.`,
    `- Evidence basis changed: ${diff.summary.evidence_basis_changed}.`,
    `- Evidence-basis records added or removed with claims: ${diff.summary.evidence_basis_added_or_removed}.`,
    `- Added human decision references: ${diff.summary.human_decision_references_added}.`,
    `- Orphaned anchors: ${diff.summary.orphaned_anchors}.`,
    '',
    '## Claims',
    '',
    '| Status | Before → after | Claim text | Citations | Evidence basis | TRUST components / overall | Human decisions |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const claim of diff.claims) {
    const beforeId = claim.before?.claim_id || '—';
    const afterId = claim.after?.claim_id || '—';
    const beforeText = claim.before?.claim_text || '';
    const afterText = claim.after?.claim_text || '';
    const text = claim.changes.claim_text_changed && beforeText && afterText
      ? `${beforeText} ⇒ ${afterText}`
      : afterText || beforeText;
    const citations = [
      claim.changes.citations.added.length ? `+${claim.changes.citations.added.join(', ')}` : '',
      claim.changes.citations.removed.length ? `-${claim.changes.citations.removed.join(', ')}` : '',
    ].filter(Boolean).join('; ') || 'unchanged';
    const componentTrust = Object.entries(claim.changes.trust.components)
      .map(([name, change]) => `${name} ${change.before ?? '—'}→${change.after ?? '—'}`);
    const overallTrust = claim.changes.trust.overall
      ? `overall ${claim.changes.trust.overall.before ?? '—'}→${claim.changes.trust.overall.after ?? '—'}`
      : `overall ${claim.after?.trust.overall_score ?? claim.before?.trust.overall_score ?? '—'}`;
    const trust = [...componentTrust, overallTrust].join('; ');
    const evidence = claim.changes.evidence_basis_changed ? 'changed' : 'unchanged';
    const decisions = [
      ...claim.changes.human_decision_references.added.map((value) => `+${value}`),
      ...claim.changes.human_decision_references.removed.map((value) => `-${value}`),
    ].join(', ') || 'unchanged';
    lines.push(`| ${claim.status} | ${beforeId} → ${afterId} | ${cell(text)} | ${cell(citations)} | ${evidence} | ${cell(trust)} | ${cell(decisions)} |`);
  }
  lines.push('', '## Orphaned anchors', '');
  if (diff.orphaned_anchors.length === 0) lines.push('None.');
  else for (const anchor of diff.orphaned_anchors) lines.push(`- \`${anchor.anchor_id}\`: ${JSON.stringify(anchor.before.selector)}`);
  lines.push('');
  return lines.join('\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2), ['from', 'to', 'from-trust-report', 'to-trust-report', 'json', 'markdown']);
  const before = readJson(args.from);
  const after = readJson(args.to);
  const fromTrustReportDigest = sha256File(args['from-trust-report']);
  const toTrustReportDigest = sha256File(args['to-trust-report']);
  validateFrozenTrustReport(before, readJson(args['from-trust-report']), fromTrustReportDigest, 'from_trust_report');
  validateFrozenTrustReport(after, readJson(args['to-trust-report']), toTrustReportDigest, 'to_trust_report');
  const diff = buildScientificReviewDiff(before, after, {
    from_snapshot_sha256: sha256File(args.from),
    to_snapshot_sha256: sha256File(args.to),
    from_trust_report_sha256: fromTrustReportDigest,
    to_trust_report_sha256: toTrustReportDigest,
  });
  validateScientificReviewDiff(diff);
  writeText(args.json, stableJson(diff));
  writeText(args.markdown, renderScientificReviewDiffMarkdown(diff));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
