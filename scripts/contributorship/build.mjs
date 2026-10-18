#!/usr/bin/env node
// Contributorship and source-finding credit lineage companion (`comprev.contributorship/1`).
//
//   node scripts/contributorship/build.mjs --config contributorship.config.json [--out-dir dir]
//
// The config names, relative to itself: `declarations` (`comprev.contribution-declarations/1`),
// `claim_graph`, optional `authors` (a MyST author file, read only) and `sources[]`, each an S2
// `source-evidence-lineage.json` with its reviewed `comprev.claim-finding-map/1`.
//
// Three outputs, all deterministic (no clock, no network):
//  * contributorship.private.json — the full record, for the authorised workspace only;
//  * contributorship.public.json  — the projection of the private record through PUBLIC_ALLOWLIST,
//    keeping only records whose disclosure is cleared;
//  * contributorship-release-report.json — what was withheld and why (private: it names ids).
//
// Credit channels are kept apart and never merged:
//  * human contributors: the 14 CRediT roles only, with degree, status and the source of the assertion;
//  * software agents: production.agent_runs (name, version, workflow role, producer) — never a person,
//    an ORCID or a CRediT role;
//  * source findings: credited through their reviewed claim→finding mapping, packet manifest digest,
//    finding revision and passage hashes. Cited-work authors are bibliographic; source curators stay
//    source-native and are never authors of this review. DOI equality alone credits nothing.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseMiniYaml } from '../../plugins/authorship-plugin.mjs';
import { assertSchemaValid } from '../release-artifacts/json-schema.mjs';
import { compareText, invariant, isObject, parseArgs, writeText } from '../release-artifacts/lib.mjs';
import { prettyJson, sha256 } from '../source-evidence/canonical.mjs';
import { validateClaimFindingMap } from '../source-evidence/lineage-to-links.mjs';
import { CREDIT_STANDARD, DEGREES, creditRole, isValidOrcid, normalizeLegacyRole, roleOrder } from './credit-roles.mjs';

export const CONTRIBUTORSHIP_SCHEMA = 'comprev.contributorship/1';
export const DECLARATIONS_SCHEMA = 'comprev.contribution-declarations/1';
export const RELEASE_REPORT_SCHEMA = 'comprev.contributorship-release-report/1';
export const OUTPUT_FILES = Object.freeze({
  private: 'contributorship.private.json',
  public: 'contributorship.public.json',
  report: 'contributorship-release-report.json',
});

const CONTRACT_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../docs/contracts/contributorship/v1');
export const loadSchema = (name) => JSON.parse(readFileSync(join(CONTRACT_DIR, `${name}.schema.json`), 'utf8'));

/**
 * The only fields a public companion may carry, per record type. A public record is the private record
 * restricted to these keys; nothing is renamed, recomputed or added. Some fields additionally need a
 * disclosure grant (`requires`) or a rights condition (`when`), applied in `projectPublic`.
 */
export const PUBLIC_ALLOWLIST = Object.freeze({
  document: ['schema', 'visibility', 'credit_standard', 'subject', 'contributors', 'credit_assertions', 'production', 'source_credit', 'relation_proposals'],
  subject: ['review_id', 'version', 'claim_graph_sha256'],
  contributor: ['id', 'kind', 'display_name', 'orcid', 'credit_statement'],
  orcid: ['id', 'status'],
  credit_assertion: ['assertion_id', 'contributor', 'role', 'role_label', 'role_uri', 'degree', 'status', 'source_kind', 'asserted_at', 'target'],
  production: ['agent_runs'],
  agent_run: ['agent_id', 'kind', 'name', 'version', 'workflow_role', 'producer', 'credit_channel'],
  source_credit: ['claim_id', 'findings'],
  source_finding: ['finding_id', 'finding_revision', 'phase2_finding_sha256', 'binding', 'packet', 'cited_work', 'passage_disclosure', 'passages', 'source_assessments', 'source_curation'],
  packet: ['packet_id', 'manifest_sha256'],
  cited_work: ['credit_kind', 'cite_key', 'doi', 'authors'],
  passage: ['passage_id', 'quote_sha256'],
  source_assessment: ['assessment_id', 'protocol', 'status'],
  source_curation: ['credit_channel', 'review_authorship'],
  relation_proposal: ['relation_id', 'proposed_by', 'predicate', 'claim_id', 'finding_refs'],
  finding_ref: ['finding_id', 'finding_revision'],
});
const PUBLIC_ASSERTION_STATUSES = new Set(['declared', 'confirmed']);

const byKey = (key) => (a, b) => compareText(a[key], b[key]);
const pick = (record, keys) => Object.fromEntries(keys.filter((key) => Object.hasOwn(record, key)).map((key) => [key, record[key]]));
const findingKey = (id, revision) => `${id}@${revision}`;
// Same normalisation lineage-to-links uses when it checks that a mapped claim cites the finding's paper.
const normalizeDoi = (doi) => String(doi ?? '').trim().replace(/^(?:doi:\s*|https?:\/\/(?:dx\.)?doi\.org\/)/iu, '').toLowerCase();

function unique(values, label) {
  const seen = new Set();
  for (const value of values) {
    invariant(!seen.has(value), `${label}: duplicate ${value}`);
    seen.add(value);
  }
}

/** Read the MyST author file into separate human and software-agent entries, keeping its labels verbatim. */
export function readLegacyAuthors(yamlText, sourcePath = 'content/authors.yml') {
  const data = parseMiniYaml(yamlText);
  const entries = data?.project?.contributors ?? data?.contributors ?? [];
  invariant(Array.isArray(entries), `${sourcePath}: contributors must be a list`);
  return entries.map((entry, index) => {
    invariant(isObject(entry) && typeof entry.id === 'string' && entry.id, `${sourcePath}: contributors[${index}] needs an id`);
    const labels = [
      ...(entry.roles ?? []).map((label) => ({ field: 'roles', label, level: null })),
      ...(entry.credit_levels ?? []).map((level) => ({ field: 'credit_levels', label: level?.role, level: level?.level ?? null })),
    ].map((item, position) => {
      const role = normalizeLegacyRole(item.label);
      return {
        field: item.field,
        position,
        label: item.label ?? null,
        level: item.level,
        mapped_role: role,
        mapping: role === null ? 'unmappable' : creditRole(role).label === item.label ? 'exact' : 'normalized',
      };
    });
    return {
      id: entry.id,
      name: typeof entry.name === 'string' ? entry.name : null,
      orcid: typeof entry.orcid === 'string' ? entry.orcid : null,
      is_ai_tool: entry.is_ai_tool === true,
      labels,
      source_ref: `${sourcePath}#${entry.id}`,
    };
  });
}

function approvalIndex(declarations) {
  const index = new Map();
  for (const approval of declarations.disclosure_approvals) {
    const key = `${approval.subject_kind}|${approval.subject_id}`;
    index.set(key, [...(index.get(key) ?? []), approval]);
  }
  return index;
}

/**
 * Decide disclosure for one subject. An approval counts only for this exact subject version and only
 * with every required party's grant; anything less keeps the subject private.
 */
function clearance(approvals, kind, id, version, parties) {
  const all = approvals.get(`${kind}|${id}`) ?? [];
  if (all.length === 0) return { cleared: false, reason: 'no-approval', approval_ids: [], fields: [] };
  const current = all.filter((approval) => approval.subject_version === version);
  if (current.length === 0) return { cleared: false, reason: 'approval-for-other-version', approval_ids: [], fields: [] };
  const valid = current.filter((approval) => parties.every((party) => approval.grants.some((grant) => grant.party === party)));
  if (valid.length === 0) return { cleared: false, reason: 'missing-required-grant', approval_ids: [], fields: [] };
  return {
    cleared: true,
    reason: null,
    approval_ids: valid.map((approval) => approval.approval_id).sort(compareText),
    fields: [...new Set(valid.flatMap((approval) => approval.fields ?? []))].sort(compareText),
  };
}

function validateDeclarations(declarations, claimIds) {
  assertSchemaValid(declarations, loadSchema('contribution-declarations'), 'contribution declarations');
  const people = new Set(declarations.contributors.map((c) => c.id));
  const agents = new Set(declarations.agent_runs.map((a) => a.agent_id));
  unique([...people, ...agents], 'contributor and agent ids');
  unique(declarations.contributors.map((c) => c.id), 'contributor ids');
  unique(declarations.agent_runs.map((a) => a.agent_id), 'agent ids');
  unique(declarations.credit_assertions.map((a) => a.assertion_id), 'credit assertion ids');
  unique(declarations.relation_proposals.map((r) => r.relation_id), 'relation proposal ids');
  unique(declarations.disclosure_approvals.map((a) => a.approval_id), 'disclosure approval ids');
  unique(declarations.source_origins.map((o) => o.origin_id), 'source origin ids');
  unique(declarations.source_origins.map((o) => o.packet_id), 'source origin packet ids');
  for (const contributor of declarations.contributors) {
    if (contributor.orcid) invariant(isValidOrcid(contributor.orcid.id), `contributor ${contributor.id}: ORCID ${contributor.orcid.id} fails its check digit`);
  }
  const seenRoles = new Set();
  for (const assertion of declarations.credit_assertions) {
    const label = `credit assertion ${assertion.assertion_id}`;
    invariant(!agents.has(assertion.contributor), `${label}: ${assertion.contributor} is a software agent; agents are credited through production.agent_runs, never with CRediT roles`);
    invariant(people.has(assertion.contributor), `${label}: unknown contributor ${assertion.contributor}`);
    invariant(creditRole(assertion.role), `${label}: ${JSON.stringify(assertion.role)} is not one of the 14 ${CREDIT_STANDARD} roles (use its slug)`);
    if (assertion.target.kind === 'claim') invariant(claimIds.has(assertion.target.claim_id), `${label}: claim ${assertion.target.claim_id} is not in the bound claim graph`);
    const scope = `${assertion.contributor}|${assertion.role}|${assertion.target.claim_id ?? 'review'}`;
    invariant(!seenRoles.has(scope), `${label}: ${assertion.contributor} already has a ${assertion.role} assertion for this target`);
    seenRoles.add(scope);
  }
  for (const proposal of declarations.relation_proposals) {
    invariant(people.has(proposal.proposed_by), `relation proposal ${proposal.relation_id}: proposer ${proposal.proposed_by} is not a human contributor`);
    if (proposal.claim_id) invariant(claimIds.has(proposal.claim_id), `relation proposal ${proposal.relation_id}: claim ${proposal.claim_id} is not in the bound claim graph`);
  }
  const subjects = {
    contributor: people,
    'source-origin': new Set(declarations.source_origins.map((o) => o.origin_id)),
    'relation-proposal': new Set(declarations.relation_proposals.map((r) => r.relation_id)),
  };
  for (const approval of declarations.disclosure_approvals) {
    invariant(subjects[approval.subject_kind].has(approval.subject_id), `disclosure approval ${approval.approval_id}: unknown ${approval.subject_kind} ${approval.subject_id}`);
    invariant(approval.subject_kind === 'contributor' || approval.fields === undefined, `disclosure approval ${approval.approval_id}: fields apply to contributors only`);
    unique(approval.grants.map((grant) => grant.party), `disclosure approval ${approval.approval_id} grant parties`);
  }
}

function buildContributors(declarations, legacy) {
  const contributors = declarations.contributors.map((c) => ({
    id: c.id,
    kind: 'person',
    display_name: c.display_name,
    orcid: c.orcid ? { ...c.orcid } : null,
    legacy_author_id: c.legacy_author_id ?? null,
  }));
  const agentRuns = declarations.agent_runs.map((a) => ({
    agent_id: a.agent_id,
    kind: 'software-agent',
    name: a.name,
    version: a.version,
    workflow_role: a.workflow_role,
    producer: a.producer,
    credit_channel: 'production',
    legacy_author_id: a.legacy_author_id ?? null,
    legacy_role_labels: [],
  }));
  const legacyIds = new Set(legacy.map((entry) => entry.id));
  for (const holder of [...contributors, ...agentRuns]) {
    if (holder.legacy_author_id) invariant(legacyIds.has(holder.legacy_author_id), `${holder.id ?? holder.agent_id}: legacy_author_id ${holder.legacy_author_id} is not in the author file`);
  }
  const legacyLabels = [];
  const legacyAssertions = [];
  for (const entry of legacy) {
    if (entry.is_ai_tool) {
      invariant(!contributors.some((c) => c.legacy_author_id === entry.id), `${entry.id} is an AI tool in the author file and cannot be declared as a human contributor`);
      let run = agentRuns.find((a) => a.legacy_author_id === entry.id);
      if (!run) {
        // Only what the file states; version, role and producer are not inferred from free text.
        run = { agent_id: entry.id, kind: 'software-agent', name: entry.name ?? entry.id, version: null, workflow_role: null, producer: null, credit_channel: 'production', legacy_author_id: entry.id, legacy_role_labels: [] };
        agentRuns.push(run);
      }
      run.legacy_role_labels = entry.labels.map((label) => ({ ...label, credit_eligible: false }));
      continue;
    }
    let person = contributors.find((c) => c.legacy_author_id === entry.id);
    if (!person) {
      invariant(entry.name, `${entry.source_ref}: a human contributor needs a name`);
      person = { id: entry.id, kind: 'person', display_name: entry.name, orcid: null, legacy_author_id: entry.id };
      if (entry.orcid) {
        invariant(isValidOrcid(entry.orcid), `${entry.source_ref}: ORCID ${entry.orcid} fails its check digit`);
        // An ORCID typed into a file is a claim; verification needs a declared check.
        person.orcid = { id: entry.orcid, status: 'claimed' };
      }
      contributors.push(person);
    } else if (!person.orcid && entry.orcid) {
      invariant(isValidOrcid(entry.orcid), `${entry.source_ref}: ORCID ${entry.orcid} fails its check digit`);
      person.orcid = { id: entry.orcid, status: 'claimed' };
    }
    for (const label of entry.labels) legacyLabels.push({ contributor: person.id, source_ref: entry.source_ref, ...label, credit_eligible: label.mapped_role !== null });
    const declared = new Set(declarations.credit_assertions.filter((a) => a.contributor === person.id && a.target.kind === 'review').map((a) => a.role));
    const roles = [...new Set(entry.labels.map((label) => label.mapped_role).filter(Boolean))].filter((role) => !declared.has(role));
    for (const role of roles) {
      const levels = [...new Set(entry.labels.filter((label) => label.mapped_role === role && DEGREES.includes(label.level)).map((label) => label.level))];
      legacyAssertions.push({
        assertion_id: `legacy:${entry.id}:${role}`,
        contributor: person.id,
        role,
        degree: levels.length === 1 ? levels[0] : null,
        status: 'declared',
        status_ref: null,
        source_kind: 'legacy-author-file',
        source_ref: entry.source_ref,
        asserted_at: null,
        target: { kind: 'review' },
      });
    }
  }
  unique([...contributors.map((c) => c.id), ...agentRuns.map((a) => a.agent_id)], 'contributor and agent ids');
  return { contributors, agentRuns, legacyLabels, legacyAssertions };
}

function creditStatement(name, assertions) {
  const parts = assertions
    .filter((a) => PUBLIC_ASSERTION_STATUSES.has(a.status) && a.target.kind === 'review')
    .sort((a, b) => roleOrder(a.role) - roleOrder(b.role))
    .map((a) => (a.degree ? `${a.role_label} (${a.degree})` : a.role_label));
  return parts.length ? `${name}: ${parts.join(', ')}.` : null;
}

function buildSourceCredit(sources, claimGraph, origins) {
  const originByPacket = new Map(origins.map((origin) => [origin.packet_id, origin]));
  const findings = new Map();
  const byClaim = new Map();
  const seenPackets = new Set();
  for (const [index, source] of sources.entries()) {
    const lineage = JSON.parse(Buffer.from(source.lineageBytes).toString('utf8'));
    invariant(isObject(lineage) && lineage.schema_version === 'source-evidence-lineage/0.1.0', `sources[${index}]: not a source-evidence-lineage/0.1.0 file`);
    const packetId = lineage.packet?.packet_id;
    const origin = originByPacket.get(packetId);
    invariant(origin, `sources[${index}]: packet ${packetId} has no declared source origin; declare whether it is public or private`);
    invariant(!seenPackets.has(packetId), `sources[${index}]: packet ${packetId} is given twice`);
    seenPackets.add(packetId);
    const lineageSha = sha256(Buffer.from(source.lineageBytes));
    for (const entry of lineage.entries) findings.set(findingKey(entry.finding.finding_id, entry.finding.revision), { entry, origin });
    // Fails closed unless the map is bound to these lineage bytes, these finding digests and claims that cite the paper.
    const mappings = validateClaimFindingMap(source.claimFindingMap, lineage, source.lineageBytes, claimGraph);
    for (const mapping of mappings) {
      const entry = lineage.entries.find((e) => e.finding.finding_id === mapping.finding_id && e.finding.revision === mapping.finding_revision);
      const citeKey = claimGraph.claims.find((c) => c.claim_id === mapping.claim_id).citation_contexts
        .find((context) => normalizeDoi(context.doi) && normalizeDoi(context.doi) === normalizeDoi(entry.doi))?.cite_key ?? null;
      const rightsAllow = entry.article.rights?.redistribution === 'allowed';
      const finding = {
        finding_id: entry.finding.finding_id,
        finding_revision: entry.finding.revision,
        phase2_finding_sha256: entry.phase2_finding_sha256,
        binding: 'reviewed-mapping',
        origin_id: origin.origin_id,
        decision_ref: mapping.decision_ref,
        mapped_at: mapping.asserted_at,
        lineage_sha256: lineageSha,
        packet: { packet_id: lineage.packet.packet_id, manifest_sha256: lineage.packet.manifest_sha256 },
        cited_work: { credit_kind: 'bibliographic-citation', cite_key: citeKey, doi: entry.doi, authors: [...entry.article.authors] },
        passage_disclosure: rightsAllow ? 'rights-allow' : 'rights-restricted',
        // Hashes and ids only; quotation text is never copied, not even into the private companion.
        passages: entry.passages.map((p) => ({ passage_id: p.passage_id, quote_sha256: p.quote_sha256 })).sort(byKey('passage_id')),
        source_assessments: entry.native_assessments
          .map((a) => ({ assessment_id: a.assessment_id, protocol: a.protocol, status: a.status, curator_ref: a.reviewer_ref, curator_ref_kind: 'source-native-pseudonym' }))
          .sort(byKey('assessment_id')),
        source_curation: { credit_channel: 'source-native', review_authorship: false },
      };
      byClaim.set(mapping.claim_id, [...(byClaim.get(mapping.claim_id) ?? []), finding]);
    }
  }
  const sourceCredit = [...byClaim.entries()].map(([claimId, list]) => ({
    claim_id: claimId,
    findings: list.sort((a, b) => compareText(a.finding_id, b.finding_id) || a.finding_revision - b.finding_revision),
  })).sort(byKey('claim_id'));
  return { sourceCredit, findings };
}

/** Build the private companion from validated inputs. */
export function buildPrivate({ declarations, claimGraphBytes, authorsYaml, authorsPath = 'content/authors.yml', sources = [] }) {
  const claimGraph = JSON.parse(Buffer.from(claimGraphBytes).toString('utf8'));
  invariant(isObject(claimGraph) && Array.isArray(claimGraph.claims), 'claim graph must have a claims array');
  const claimIds = new Set(claimGraph.claims.map((claim) => claim.claim_id));
  validateDeclarations(declarations, claimIds);
  const version = declarations.subject.version;
  const approvals = approvalIndex(declarations);
  const legacy = authorsYaml === undefined ? [] : readLegacyAuthors(authorsYaml, authorsPath);
  const { contributors, agentRuns, legacyLabels, legacyAssertions } = buildContributors(declarations, legacy);

  const assertions = [
    ...declarations.credit_assertions.map((a) => ({
      assertion_id: a.assertion_id,
      contributor: a.contributor,
      role: a.role,
      degree: a.degree ?? null,
      status: a.status,
      status_ref: a.status_ref ?? null,
      source_kind: a.source_kind,
      source_ref: a.source_ref,
      asserted_at: a.asserted_at,
      target: { ...a.target },
    })),
    ...legacyAssertions,
  ].map((a) => {
    const role = creditRole(a.role);
    return { ...a, role_label: role.label, role_uri: role.uri };
  }).sort(byKey('assertion_id'));
  unique(assertions.map((a) => a.assertion_id), 'credit assertion ids');

  for (const person of contributors) {
    const decision = clearance(approvals, 'contributor', person.id, version, ['individual', 'controller']);
    const cleared = decision.cleared && decision.fields.includes('display_name');
    person.credit_statement = creditStatement(person.display_name, assertions.filter((a) => a.contributor === person.id));
    person.disclosure = {
      public: cleared,
      reason: cleared ? null : decision.reason ?? 'display-name-not-approved',
      approved_fields: cleared ? decision.fields : [],
      approval_ids: decision.approval_ids,
    };
  }
  contributors.sort(byKey('id'));
  agentRuns.sort(byKey('agent_id'));

  const origins = declarations.source_origins.map((origin) => {
    const decision = origin.visibility === 'public'
      ? { cleared: true, reason: null, approval_ids: [] }
      : clearance(approvals, 'source-origin', origin.origin_id, version, ['controller']);
    return {
      origin_id: origin.origin_id,
      packet_id: origin.packet_id,
      visibility: origin.visibility,
      project_ref: origin.project_ref ?? null,
      project_title: origin.project_title ?? null,
      disclosure: { public: decision.cleared, reason: decision.reason, approval_ids: decision.approval_ids },
    };
  }).sort(byKey('origin_id'));
  const originById = new Map(origins.map((origin) => [origin.origin_id, origin]));
  const originCleared = new Map(origins.map((origin) => [origin.origin_id, origin.disclosure.public]));

  const { sourceCredit, findings } = buildSourceCredit(sources, claimGraph, declarations.source_origins);
  for (const claim of sourceCredit) {
    // A claim's source credit is published whole or not at all: never a public evidence claim with hidden sources.
    const blocked = claim.findings.filter((f) => !originCleared.get(f.origin_id));
    claim.disclosure = {
      public: blocked.length === 0,
      reason: blocked.length ? 'uncleared-private-origin' : null,
      approval_ids: [...new Set(claim.findings.flatMap((f) => originById.get(f.origin_id).disclosure.approval_ids))].sort(compareText),
    };
  }

  const publicPeople = new Set(contributors.filter((c) => c.disclosure.public).map((c) => c.id));
  const relations = declarations.relation_proposals.map((proposal) => {
    const refs = proposal.finding_refs.map((ref) => ({ finding_id: ref.finding_id, finding_revision: ref.finding_revision }))
      .sort((a, b) => compareText(a.finding_id, b.finding_id) || a.finding_revision - b.finding_revision);
    const originIds = refs.map((ref) => {
      const known = findings.get(findingKey(ref.finding_id, ref.finding_revision));
      invariant(known, `relation proposal ${proposal.relation_id}: ${ref.finding_id} revision ${ref.finding_revision} is not in any supplied lineage`);
      return known.origin.origin_id;
    });
    const decision = clearance(approvals, 'relation-proposal', proposal.relation_id, version, ['controller']);
    const reason = !originIds.every((id) => originCleared.get(id))
      ? 'uncleared-private-origin'
      : !publicPeople.has(proposal.proposed_by)
        ? 'proposer-not-disclosed'
        : decision.reason;
    return {
      relation_id: proposal.relation_id,
      proposed_by: proposal.proposed_by,
      predicate: proposal.predicate,
      ...(proposal.claim_id ? { claim_id: proposal.claim_id } : {}),
      finding_refs: refs,
      proposed_at: proposal.proposed_at,
      rationale: proposal.rationale ?? null,
      disclosure: { public: reason === null, reason, approval_ids: decision.approval_ids },
    };
  }).sort(byKey('relation_id'));

  return {
    schema: CONTRIBUTORSHIP_SCHEMA,
    visibility: 'private',
    credit_standard: CREDIT_STANDARD,
    subject: { review_id: declarations.subject.review_id, version, claim_graph_sha256: sha256(Buffer.from(claimGraphBytes)) },
    contributors,
    credit_assertions: assertions,
    legacy_role_labels: legacyLabels,
    production: { agent_runs: agentRuns },
    source_origins: origins,
    source_credit: sourceCredit,
    relation_proposals: relations,
  };
}

/** The public companion: cleared records only, each restricted to PUBLIC_ALLOWLIST. */
export function projectPublic(privateDoc) {
  const A = PUBLIC_ALLOWLIST;
  const people = new Map(privateDoc.contributors.filter((c) => c.disclosure.public).map((c) => [c.id, c]));
  const contributors = [...people.values()].map((c) => {
    const fields = new Set(c.disclosure.approved_fields);
    const out = pick(c, A.contributor.filter((key) => (key === 'orcid' ? fields.has('orcid') && c.orcid : key !== 'credit_statement' || fields.has('credit_assertions'))));
    if (out.orcid) out.orcid = pick(c.orcid, A.orcid);
    return out;
  });
  const assertions = privateDoc.credit_assertions
    .filter((a) => PUBLIC_ASSERTION_STATUSES.has(a.status) && people.get(a.contributor)?.disclosure.approved_fields.includes('credit_assertions'))
    .map((a) => pick(a, A.credit_assertion));
  const sourceCredit = privateDoc.source_credit.filter((claim) => claim.disclosure.public).map((claim) => ({
    ...pick(claim, A.source_credit),
    findings: claim.findings.map((f) => ({
      ...pick(f, A.source_finding.filter((key) => key !== 'passages' || f.passage_disclosure === 'rights-allow')),
      packet: pick(f.packet, A.packet),
      cited_work: pick(f.cited_work, A.cited_work),
      ...(f.passage_disclosure === 'rights-allow' ? { passages: f.passages.map((p) => pick(p, A.passage)) } : {}),
      source_assessments: f.source_assessments.map((s) => pick(s, A.source_assessment)),
      source_curation: pick(f.source_curation, A.source_curation),
    })),
  }));
  const relations = privateDoc.relation_proposals.filter((r) => r.disclosure.public).map((r) => ({
    ...pick(r, A.relation_proposal),
    finding_refs: r.finding_refs.map((ref) => pick(ref, A.finding_ref)),
  }));
  return {
    ...pick(privateDoc, A.document),
    visibility: 'public',
    subject: pick(privateDoc.subject, A.subject),
    contributors,
    credit_assertions: assertions,
    production: { agent_runs: privateDoc.production.agent_runs.map((a) => pick(a, A.agent_run)) },
    source_credit: sourceCredit,
    relation_proposals: relations,
  };
}

/** Release report for the controller: what is public, what stays private and why. Names ids, so it is private. */
export function releaseReport(privateDoc, publicDoc) {
  const withheld = (records, idKey) => records.filter((r) => !r.disclosure.public).map((r) => ({ id: r[idKey], reason: r.disclosure.reason })).sort(byKey('id'));
  const publicPeople = new Set(publicDoc.contributors.map((c) => c.id));
  const publicAssertions = new Set(publicDoc.credit_assertions.map((a) => a.assertion_id));
  return {
    schema: RELEASE_REPORT_SCHEMA,
    visibility: 'private',
    subject: privateDoc.subject,
    allowlist_sha256: sha256(Buffer.from(prettyJson(PUBLIC_ALLOWLIST))),
    private_sha256: sha256(Buffer.from(prettyJson(privateDoc))),
    public_sha256: sha256(Buffer.from(prettyJson(publicDoc))),
    public_counts: {
      contributors: publicDoc.contributors.length,
      credit_assertions: publicDoc.credit_assertions.length,
      agent_runs: publicDoc.production.agent_runs.length,
      source_credit_claims: publicDoc.source_credit.length,
      relation_proposals: publicDoc.relation_proposals.length,
    },
    withheld: {
      contributors: withheld(privateDoc.contributors, 'id'),
      orcids: privateDoc.contributors.filter((c) => publicPeople.has(c.id) && c.orcid && !c.disclosure.approved_fields.includes('orcid')).map((c) => ({ id: c.id, reason: 'orcid-not-approved' })),
      credit_assertions: privateDoc.credit_assertions.filter((a) => !publicAssertions.has(a.assertion_id)).map((a) => ({
        id: a.assertion_id,
        reason: !PUBLIC_ASSERTION_STATUSES.has(a.status) ? `status-${a.status}` : publicPeople.has(a.contributor) ? 'assertions-not-approved' : 'contributor-withheld',
      })),
      source_credit_claims: withheld(privateDoc.source_credit, 'claim_id'),
      source_origins: withheld(privateDoc.source_origins, 'origin_id'),
      relation_proposals: withheld(privateDoc.relation_proposals, 'relation_id'),
      passages: privateDoc.source_credit.filter((c) => c.disclosure.public).flatMap((c) => c.findings)
        .filter((f) => f.passage_disclosure !== 'rights-allow').map((f) => ({ id: findingKey(f.finding_id, f.finding_revision), reason: f.passage_disclosure })),
    },
  };
}

/** Schema-check a companion and, given both, prove the public one is exactly the allowlisted projection. */
export function validateCompanions({ privateDoc, publicDoc, report }) {
  if (privateDoc) assertSchemaValid(privateDoc, loadSchema('contributorship.private'), 'private contributorship companion');
  if (publicDoc) assertSchemaValid(publicDoc, loadSchema('contributorship.public'), 'public contributorship companion');
  if (report) assertSchemaValid(report, loadSchema('contributorship-release-report'), 'contributorship release report');
  if (privateDoc && publicDoc) {
    invariant(prettyJson(projectPublic(privateDoc)) === prettyJson(publicDoc), 'public companion is not the allowlisted projection of the private companion');
  }
  for (const doc of [privateDoc, publicDoc].filter(Boolean)) {
    const people = new Set(doc.contributors.map((c) => c.id));
    for (const a of doc.credit_assertions) {
      const role = creditRole(a.role);
      invariant(role && role.label === a.role_label && role.uri === a.role_uri, `${a.assertion_id}: role ${a.role} is not a ${CREDIT_STANDARD} role`);
      invariant(people.has(a.contributor), `${a.assertion_id}: contributor ${a.contributor} is absent`);
    }
    for (const agent of doc.production.agent_runs) invariant(!people.has(agent.agent_id), `${agent.agent_id} is both a software agent and a person`);
    for (const c of doc.contributors) {
      if (c.orcid) invariant(isValidOrcid(c.orcid.id), `${c.id}: invalid ORCID`);
    }
  }
  return true;
}

/** Build all three outputs as canonical bytes. */
export function buildContributorship(inputs) {
  const privateDoc = buildPrivate(inputs);
  const publicDoc = projectPublic(privateDoc);
  const report = releaseReport(privateDoc, publicDoc);
  validateCompanions({ privateDoc, publicDoc, report });
  return {
    privateDoc,
    publicDoc,
    report,
    files: new Map([
      [OUTPUT_FILES.private, prettyJson(privateDoc)],
      [OUTPUT_FILES.public, prettyJson(publicDoc)],
      [OUTPUT_FILES.report, prettyJson(report)],
    ]),
  };
}

/** Resolve a config file (paths relative to it) into builder inputs. */
export function readConfig(configPath) {
  const base = dirname(resolve(configPath));
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const at = (path) => resolve(base, path);
  invariant(isObject(config) && config.declarations && config.claim_graph, 'config needs declarations and claim_graph');
  return {
    declarations: JSON.parse(readFileSync(at(config.declarations), 'utf8')),
    claimGraphBytes: readFileSync(at(config.claim_graph)),
    authorsYaml: config.authors ? readFileSync(at(config.authors), 'utf8') : undefined,
    authorsPath: config.authors_label ?? config.authors ?? undefined,
    sources: (config.sources ?? []).map((source) => ({
      lineageBytes: readFileSync(at(source.lineage)),
      claimFindingMap: JSON.parse(readFileSync(at(source.claim_finding_map), 'utf8')),
    })),
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2), ['config']);
  const { files, report } = buildContributorship(readConfig(args.config));
  const outDir = resolve(args['out-dir'] ?? '.');
  for (const [name, text] of files) writeText(join(outDir, name), text);
  const counts = report.public_counts;
  process.stdout.write(`Wrote ${[...files.keys()].join(', ')} to ${outDir}\n`
    + `Public: ${counts.contributors} contributor(s), ${counts.credit_assertions} CRediT assertion(s), ${counts.agent_runs} agent run(s), `
    + `${counts.source_credit_claims} claim(s) with source credit, ${counts.relation_proposals} relation proposal(s).\n`
    + `Keep ${OUTPUT_FILES.private} and ${OUTPUT_FILES.report} out of public artifacts.\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
