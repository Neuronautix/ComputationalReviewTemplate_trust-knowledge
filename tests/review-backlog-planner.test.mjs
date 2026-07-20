import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import { buildBacklog } from '../scripts/plan-review-backlog.mjs';
import { buildProposal } from '../scripts/evidence-radar.mjs';

const config = JSON.parse(readFileSync(resolve('automation/review-agents.json'), 'utf8'));
const example = JSON.parse(readFileSync(resolve('automation/examples/improvement-proposals.json'), 'utf8'));
const radarConfig = JSON.parse(readFileSync(resolve('config/evidence-radar.json'), 'utf8'));
const radarFeed = JSON.parse(readFileSync(resolve('tests/fixtures/evidence-radar/feed.json'), 'utf8'));
const claimIndexText = readFileSync(resolve('knowledge/claim_index.json'), 'utf8');
const claimIndex = JSON.parse(claimIndexText);
const radarProvenance = { claim_index_sha256: crypto.createHash('sha256').update(claimIndexText).digest('hex') };

test('planner produces deterministic themed proposals without granting merge authority', () => {
  const first = buildBacklog(example, config);
  const second = buildBacklog(structuredClone(example), structuredClone(config));
  assert.deepEqual(first, second);
  assert.equal(first.summary.proposal_count, 3);
  assert.deepEqual(first.themes.map((theme) => theme.theme_id), [
    'human-review-ui',
    'trust-evidence',
    'release-artifacts',
  ]);
  assert.ok(first.themes.every((theme) => theme.human_gates.merge_approval_required));
  assert.equal(first.automation_policy.trust_scores_are_validator_owned, true);
});

test('planner orders critical proposals before lower priorities', () => {
  const input = structuredClone(example);
  input.proposals.push({
    ...structuredClone(input.proposals[1]),
    proposal_id: 'proposal-lower-priority',
    priority: 'low',
  });
  const backlog = buildBacklog(input, config);
  const evidenceTheme = backlog.themes.find((theme) => theme.theme_id === 'trust-evidence');
  assert.deepEqual(evidenceTheme.proposals.map((proposal) => proposal.priority), ['critical', 'low']);
});

test('planner rejects traversal targets and duplicate proposal IDs', () => {
  const traversal = structuredClone(example);
  traversal.proposals[0].target_files = ['../secrets.txt'];
  assert.throws(() => buildBacklog(traversal, config), /must not traverse/u);

  const duplicate = structuredClone(example);
  duplicate.proposals.push(structuredClone(duplicate.proposals[0]));
  assert.throws(() => buildBacklog(duplicate, config), /duplicate proposal_id/u);
});

test('planner rejects policy changes that let agents own TRUST scores', () => {
  const unsafeConfig = structuredClone(config);
  unsafeConfig.policy.trust_scores_are_validator_owned = false;
  assert.throws(() => buildBacklog(example, unsafeConfig), /TRUST scores must remain validator-owned/u);
});

test('planner directly consumes an advisory Evidence Radar artifact', () => {
  const radar = buildProposal(radarConfig, radarFeed, { fixture: true, ...radarProvenance }, claimIndex);
  const backlog = buildBacklog(radar, config);
  assert.equal(backlog.summary.proposal_count, 2);
  assert.deepEqual(backlog.themes.map((theme) => theme.theme_id), ['trust-evidence']);
  assert.ok(backlog.themes[0].proposals.every((proposal) => proposal.source_type === 'evidence_radar'));
  assert.ok(backlog.themes[0].proposals.every((proposal) => proposal.scientific_approval_required));
});

test('scientific approval cannot be disabled for protected sources or paths', () => {
  const adversarial = structuredClone(example);
  adversarial.proposals = [
    { ...adversarial.proposals[1], proposal_id: 'proposal-radar-bypass', scientific_approval_required: false },
    { ...adversarial.proposals[0], proposal_id: 'proposal-human-bypass', source_type: 'human_submission', target_files: ['docs/comment.md'], scientific_approval_required: false },
    { ...adversarial.proposals[2], proposal_id: 'proposal-content-bypass', target_files: ['content/section.md'], scientific_approval_required: false },
    { ...adversarial.proposals[2], proposal_id: 'proposal-knowledge-bypass', target_files: ['knowledge/claim_graph.json'], scientific_approval_required: false },
  ];
  const backlog = buildBacklog(adversarial, config);
  const proposals = backlog.themes.flatMap((theme) => theme.proposals);
  assert.ok(proposals.every((proposal) => proposal.scientific_approval_required));
  assert.ok(proposals.every((proposal) => proposal.scientific_approval_forced));
});

test('planner rejects policy configurations that weaken forced approval', () => {
  const unsafe = structuredClone(config);
  unsafe.policy.scientific_approval_forced_for_sources = [];
  assert.throws(() => buildBacklog(example, unsafe), /must not be weakened/);
});
