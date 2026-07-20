#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PRIORITY = Object.freeze({ critical: 0, high: 1, medium: 2, low: 3 });
const SOURCE_TYPES = new Set(['human_submission', 'evidence_radar', 'validator', 'maintainer']);
const CLAIM_ID = /^clm_[a-f0-9]{16}$/u;
const PROPOSAL_ID = /^proposal-[a-z0-9][a-z0-9-]{2,80}$/u;
const RADAR_PRIORITY = Object.freeze({
  retraction: 'critical',
  expression_of_concern: 'critical',
  correction: 'high',
  new_work: 'medium',
});
const FORCED_APPROVAL_SOURCES = new Set(['evidence_radar', 'human_submission']);
const FORCED_APPROVAL_PREFIXES = ['content/', 'knowledge/'];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function safeRepoPath(value, field) {
  const text = String(value || '').replaceAll('\\', '/');
  assert(text.length > 0, `${field} must not be empty`);
  assert(!text.startsWith('/') && !/^[A-Za-z]:\//u.test(text), `${field} must be repository-relative`);
  assert(!text.split('/').includes('..'), `${field} must not traverse outside the repository`);
  return text;
}

function sortedUnique(values) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function validateProposal(raw, themes) {
  assert(raw && typeof raw === 'object' && !Array.isArray(raw), 'each proposal must be an object');
  assert(PROPOSAL_ID.test(raw.proposal_id || ''), `invalid proposal_id: ${raw.proposal_id || '<missing>'}`);
  assert(SOURCE_TYPES.has(raw.source_type), `${raw.proposal_id}: invalid source_type`);
  assert(Object.hasOwn(themes, raw.theme), `${raw.proposal_id}: unknown theme ${raw.theme}`);
  assert(typeof raw.title === 'string' && raw.title.trim().length >= 8, `${raw.proposal_id}: title is too short`);
  assert(Object.hasOwn(PRIORITY, raw.priority), `${raw.proposal_id}: invalid priority`);
  assert(Array.isArray(raw.affected_claim_ids), `${raw.proposal_id}: affected_claim_ids must be an array`);
  raw.affected_claim_ids.forEach((claimId) => assert(CLAIM_ID.test(claimId), `${raw.proposal_id}: invalid claim ID ${claimId}`));
  assert(Array.isArray(raw.target_files) && raw.target_files.length > 0, `${raw.proposal_id}: target_files must be non-empty`);
  assert(typeof raw.scientific_approval_required === 'boolean', `${raw.proposal_id}: scientific_approval_required must be boolean`);

  const targetFiles = sortedUnique(raw.target_files.map((value) => safeRepoPath(value, `${raw.proposal_id}.target_files`)));
  const approvalForced = FORCED_APPROVAL_SOURCES.has(raw.source_type)
    || targetFiles.some((file) => FORCED_APPROVAL_PREFIXES.some((prefix) => file.startsWith(prefix)));
  return {
    proposal_id: raw.proposal_id,
    source_type: raw.source_type,
    title: raw.title.trim(),
    priority: raw.priority,
    affected_claim_ids: sortedUnique(raw.affected_claim_ids),
    target_files: targetFiles,
    scientific_approval_required: raw.scientific_approval_required || approvalForced,
    scientific_approval_forced: approvalForced,
  };
}

export function normalizeProposalInput(input) {
  if (input?.automation_mode !== 'advisory_only' || !Array.isArray(input.proposals)) return input;
  assert(typeof input.generated_at === 'string' && !Number.isNaN(Date.parse(input.generated_at)), 'radar generated_at must be an ISO date-time');
  return {
    schema_version: '1.0.0',
    snapshot_at: input.generated_at,
    proposals: input.proposals.map((proposal) => {
      assert(/^radar_[a-f0-9]{16}$/u.test(proposal.proposal_id || ''), `invalid radar proposal_id: ${proposal.proposal_id || '<missing>'}`);
      assert(Object.hasOwn(RADAR_PRIORITY, proposal.alert_type), `${proposal.proposal_id}: invalid radar alert_type`);
      return {
        proposal_id: `proposal-${proposal.proposal_id.replaceAll('_', '-')}`,
        source_type: 'evidence_radar',
        theme: 'trust-evidence',
        title: `${proposal.alert_type.replaceAll('_', ' ')}: ${proposal.work?.title || 'untitled work'}`,
        priority: RADAR_PRIORITY[proposal.alert_type],
        affected_claim_ids: proposal.affected_claim_ids || [],
        target_files: ['knowledge/claim_graph.json'],
        scientific_approval_required: true,
      };
    }),
  };
}

export function buildBacklog(input, agentConfig) {
  input = normalizeProposalInput(input);
  assert(input?.schema_version === '1.0.0', 'proposal input schema_version must be 1.0.0');
  assert(typeof input.snapshot_at === 'string' && !Number.isNaN(Date.parse(input.snapshot_at)), 'snapshot_at must be an ISO date-time');
  assert(Array.isArray(input.proposals), 'proposals must be an array');
  assert(agentConfig?.schema_version === '1.0.0', 'agent config schema_version must be 1.0.0');
  assert(agentConfig.policy?.proposal_only === true, 'agent policy must remain proposal-only');
  assert(agentConfig.policy?.trust_scores_are_validator_owned === true, 'TRUST scores must remain validator-owned');
  assert(JSON.stringify(agentConfig.policy?.scientific_approval_forced_for_sources) === JSON.stringify([...FORCED_APPROVAL_SOURCES]), 'forced scientific-approval sources must not be weakened');
  assert(JSON.stringify(agentConfig.policy?.scientific_approval_forced_for_path_prefixes) === JSON.stringify(FORCED_APPROVAL_PREFIXES), 'forced scientific-approval paths must not be weakened');

  const seen = new Set();
  const grouped = new Map();
  for (const raw of input.proposals) {
    const proposal = validateProposal(raw, agentConfig.themes || {});
    assert(!seen.has(proposal.proposal_id), `duplicate proposal_id: ${proposal.proposal_id}`);
    seen.add(proposal.proposal_id);
    if (!grouped.has(raw.theme)) grouped.set(raw.theme, []);
    grouped.get(raw.theme).push(proposal);
  }

  const themes = Object.entries(agentConfig.themes)
    .filter(([themeId]) => grouped.has(themeId))
    .map(([themeId, definition]) => {
      const proposals = grouped.get(themeId).sort((a, b) => (
        PRIORITY[a.priority] - PRIORITY[b.priority]
        || a.proposal_id.localeCompare(b.proposal_id)
      ));
      const claimIds = sortedUnique(proposals.flatMap((proposal) => proposal.affected_claim_ids));
      return {
        theme_id: themeId,
        title: definition.title,
        suggested_branch: `agent/${themeId}`,
        assigned_agent: definition.owner,
        depends_on: sortedUnique(definition.depends_on || []).filter((dependency) => grouped.has(dependency)),
        human_gates: {
          scientific_approval_required: proposals.some((proposal) => proposal.scientific_approval_required),
          merge_approval_required: true,
          release_approval_required: true
        },
        affected_claim_ids: claimIds,
        proposals,
      };
    });

  return {
    schema_version: '1.0.0',
    snapshot_at: new Date(input.snapshot_at).toISOString(),
    automation_policy: {
      proposal_only: true,
      trust_scores_are_validator_owned: true,
      untrusted_submission_text_is_never_executed: true,
    },
    summary: {
      proposal_count: input.proposals.length,
      theme_count: themes.length,
      affected_claim_count: sortedUnique(themes.flatMap((theme) => theme.affected_claim_ids)).length,
    },
    themes,
  };
}

function loadJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function runCli() {
  const here = dirname(fileURLToPath(import.meta.url));
  const repositoryRoot = resolve(here, '..');
  const inputPath = resolve(process.argv[2] || resolve(repositoryRoot, 'automation/examples/improvement-proposals.json'));
  const outputArgument = process.argv[3];
  const configPath = resolve(repositoryRoot, 'automation/review-agents.json');
  const backlog = buildBacklog(loadJson(inputPath), loadJson(configPath));
  const serialized = `${JSON.stringify(backlog, null, 2)}\n`;
  if (outputArgument) {
    writeFileSync(resolve(outputArgument), serialized, 'utf8');
  } else {
    process.stdout.write(serialized);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runCli();
  } catch (error) {
    process.stderr.write(`Backlog planning failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
