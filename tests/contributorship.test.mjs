import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import authorshipPlugin from '../plugins/authorship-plugin.mjs';
import {
  OUTPUT_FILES, PUBLIC_ALLOWLIST, buildContributorship, buildPrivate, loadSchema, projectPublic, readConfig, readLegacyAuthors, validateCompanions,
} from '../scripts/contributorship/build.mjs';
import { CREDIT_ROLES, isValidOrcid, normalizeLegacyRole } from '../scripts/contributorship/credit-roles.mjs';
import { sha256 } from '../scripts/source-evidence/canonical.mjs';
import { CLAIM_1, CLAIM_2, generate } from './fixtures/contributorship/build-fixture.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = join(ROOT, 'tests/fixtures/contributorship');
const read = (rel) => readFileSync(join(FIXTURE, rel), 'utf8');
const clone = (value) => JSON.parse(JSON.stringify(value));
const inputs = () => readConfig(join(FIXTURE, 'config.json'));
const build = (mutate = (x) => x) => buildContributorship(mutate(inputs()));

/** Rewrite one source's lineage and re-bind its reviewed map to the new bytes, as a real re-import would. */
function rebindSource(source, mutateLineage) {
  const lineage = JSON.parse(Buffer.from(source.lineageBytes).toString('utf8'));
  mutateLineage(lineage);
  const lineageBytes = Buffer.from(`${JSON.stringify(lineage, null, 2)}\n`, 'utf8');
  return { lineageBytes, claimFindingMap: { ...source.claimFindingMap, lineage_sha256: sha256(lineageBytes) } };
}

test('the committed fixture and golden outputs are exactly what the generator and builder produce', () => {
  for (const [rel, text] of generate()) assert.equal(read(rel), text, `${rel} is stale`);
  const { files } = build();
  for (const [name, text] of files) assert.equal(read(`expected/${name}`), text, `expected/${name} is stale`);
});

test('the CLI writes the same three files', () => {
  const out = mkdtempSync(join(tmpdir(), 'crt17-cli-'));
  execFileSync(process.execPath, [join(ROOT, 'scripts/contributorship/build.mjs'), '--config', join(FIXTURE, 'config.json'), '--out-dir', out]);
  for (const name of Object.values(OUTPUT_FILES)) assert.equal(readFileSync(join(out, name), 'utf8'), read(`expected/${name}`));
});

test('exactly the 14 ANSI/NISO Z39.104-2022 roles, with legacy spellings normalised but never guessed', () => {
  assert.deepEqual(CREDIT_ROLES.map((r) => r.label), [
    'Conceptualization', 'Data curation', 'Formal analysis', 'Funding acquisition', 'Investigation', 'Methodology', 'Project administration',
    'Resources', 'Software', 'Supervision', 'Validation', 'Visualization', 'Writing – original draft', 'Writing – review & editing',
  ]);
  for (const role of CREDIT_ROLES) assert.equal(role.uri, `https://credit.niso.org/contributor-roles/${role.slug}/`);
  assert.equal(normalizeLegacyRole('Writing – Original Draft'), 'writing-original-draft');
  assert.equal(normalizeLegacyRole('writing - review & editing'), 'writing-review-editing');
  assert.equal(normalizeLegacyRole('Formal Analysis'), 'formal-analysis');
  assert.equal(normalizeLegacyRole('Visualisation'), 'visualization');
  for (const label of ['Statistics', 'Writing', 'Review', 'Editing', 'Lead author', 'Peer review', '', null]) assert.equal(normalizeLegacyRole(label), null, String(label));

  const { privateDoc } = build();
  const statistics = privateDoc.legacy_role_labels.find((label) => label.label === 'Statistics');
  assert.deepEqual([statistics.mapped_role, statistics.mapping, statistics.credit_eligible], [null, 'unmappable', false]);
  assert.ok(privateDoc.legacy_role_labels.some((label) => label.label === 'Writing - Review & Editing' && label.mapping === 'normalized'));
  // The unmappable label creates no assertion, and no role outside the standard appears anywhere.
  assert.ok(privateDoc.credit_assertions.every((a) => CREDIT_ROLES.some((role) => role.slug === a.role)));
  assert.ok(!JSON.stringify(privateDoc.credit_assertions).includes('Statistics'));
});

test('an invented or misspelt role in declarations is rejected rather than mapped', () => {
  for (const role of ['statistics', 'Conceptualization', 'writing']) {
    assert.throws(() => build((i) => {
      i.declarations.credit_assertions[0].role = role;
      return i;
    }), /is not one of the 14 ANSI\/NISO Z39\.104-2022 roles/u);
  }
});

test('mixed human + agent review: agents are production records only, never people, ORCIDs or CRediT holders', () => {
  const { privateDoc, publicDoc } = build();
  const people = privateDoc.contributors.map((c) => c.id);
  assert.ok(!people.includes('ai-pipeline'));
  const agent = publicDoc.production.agent_runs.find((a) => a.agent_id === 'ai-pipeline');
  assert.deepEqual(agent, {
    agent_id: 'ai-pipeline', credit_channel: 'production', kind: 'software-agent', name: 'Claude', producer: 'Anthropic', version: 'synthetic-model-version', workflow_role: 'evidence-gathering-and-drafting',
  });
  const legacy = privateDoc.production.agent_runs.find((a) => a.agent_id === 'ai-pipeline').legacy_role_labels;
  assert.ok(legacy.length > 0 && legacy.every((label) => label.credit_eligible === false));
  assert.ok(!privateDoc.credit_assertions.some((a) => a.contributor === 'ai-pipeline'));

  assert.throws(() => build((i) => {
    i.declarations.credit_assertions[0].contributor = 'citation-verifier';
    return i;
  }), /software agent; agents are credited through production\.agent_runs/u);
  assert.throws(() => build((i) => {
    i.declarations.agent_runs[1].orcid = { id: '0000-0002-1825-0097', status: 'claimed' };
    return i;
  }), /agent_runs\[1\]\.orcid: additional property is not allowed/u);
  assert.throws(() => build((i) => {
    i.declarations.contributors.push({ id: 'claude-person', display_name: 'Claude', legacy_author_id: 'ai-pipeline' });
    return i;
  }), /AI tool in the author file and cannot be declared as a human contributor/u);
  assert.throws(() => build((i) => {
    i.declarations.agent_runs[1].agent_id = 'person-a';
    return i;
  }), /duplicate person-a/u);
});

test('the real content/authors.yml maps to one production agent and no human contributor', () => {
  const declarations = { schema: 'comprev.contribution-declarations/1', subject: { review_id: 'review-template-check', version: '0.1.0' }, contributors: [], credit_assertions: [], agent_runs: [], source_origins: [], relation_proposals: [], disclosure_approvals: [] };
  const { privateDoc, publicDoc } = buildContributorship({
    declarations,
    claimGraphBytes: readFileSync(join(ROOT, 'knowledge/claim_graph.json')),
    authorsYaml: readFileSync(join(ROOT, 'content/authors.yml'), 'utf8'),
  });
  assert.deepEqual(privateDoc.contributors, []);
  assert.deepEqual(publicDoc.contributors, []);
  const [agent] = privateDoc.production.agent_runs;
  assert.equal(privateDoc.production.agent_runs.length, 1);
  assert.deepEqual([agent.agent_id, agent.name, agent.version, agent.workflow_role, agent.producer], ['ai-pipeline', 'Claude', null, null, null]);
  // Historical labels are kept verbatim, every one maps to a CRediT role, and none earns CRediT credit.
  assert.deepEqual(agent.legacy_role_labels.map((l) => [l.label, l.mapped_role, l.level]), [
    ['Investigation', 'investigation', null], ['Data Curation', 'data-curation', null], ['Writing – original draft', 'writing-original-draft', null],
    ['Visualization', 'visualization', null], ['Formal Analysis', 'formal-analysis', null],
    ['Investigation', 'investigation', 'lead'], ['Data Curation', 'data-curation', 'lead'], ['Writing – Original Draft', 'writing-original-draft', 'lead'],
    ['Visualization', 'visualization', 'equal'], ['Formal Analysis', 'formal-analysis', 'lead'],
  ]);
  assert.ok(agent.legacy_role_labels.every((l) => l.credit_eligible === false));
});

test('the MyST authorship widget output is unchanged', () => {
  const transform = authorshipPlugin.transforms[0].plugin({}, {});
  const node = { type: 'authorship-explorer', authorsPath: './authors.yml', height: '800px' };
  const tree = { type: 'root', children: [{ type: 'heading', identifier: 'abstract', children: [{ type: 'text', value: 'Abstract' }] }, node] };
  transform(tree, { path: join(ROOT, 'content/00_frontmatter.md') });
  assert.equal(node.type, 'anywidget');
  assert.equal(node.esm, './authorship-widget.mjs');
  assert.equal(node.model.sectionLabels, '{"abstract":"Abstract"}');
  // Digest of the widget payload produced by the plugin before this change (same file, same parser).
  assert.equal(createHash('sha256').update(node.model.authors).digest('hex'), 'f42d32287441e3a0916d1161e1e2e8dab782e4e07de2c81da8b4c0790faa10a5');
  assert.deepEqual(readLegacyAuthors(readFileSync(join(ROOT, 'content/authors.yml'), 'utf8')).map((e) => [e.id, e.is_ai_tool]), [['ai-pipeline', true]]);
});

test('verified and claimed ORCIDs stay distinct and are checked', () => {
  assert.ok(isValidOrcid('0000-0002-1825-0097'));
  assert.ok(!isValidOrcid('0000-0002-1825-0098'));
  const { privateDoc } = build();
  const orcid = (id) => privateDoc.contributors.find((c) => c.id === id).orcid;
  assert.equal(orcid('person-a').status, 'verified');
  assert.equal(orcid('person-a').verification.method, 'orcid-oauth');
  assert.deepEqual(orcid('person-b'), { id: '0000-0000-0000-001X', status: 'claimed' });
  // An ORCID typed into the author file is only ever a claim.
  assert.deepEqual(orcid('person-d'), { id: '0000-0000-0000-0036', status: 'claimed' });

  assert.throws(() => build((i) => {
    delete i.declarations.contributors[0].orcid.verification;
    return i;
  }), /contributors\[0\]\.orcid: missing verification/u);
  assert.throws(() => build((i) => {
    i.declarations.contributors[1].orcid.verification = clone(i.declarations.contributors[0].orcid.verification);
    return i;
  }), /contributors\[1\]\.orcid: matches a schema it must not match/u);
  assert.throws(() => build((i) => {
    i.declarations.contributors[1].orcid.id = '0000-0000-0000-0010';
    return i;
  }), /fails its check digit/u);
});

test('assertion status needs a decision reference except when merely declared', () => {
  assert.throws(() => build((i) => {
    delete i.declarations.credit_assertions[0].status_ref;
    return i;
  }), /credit_assertions\[0\]: missing status_ref/u);
  assert.throws(() => build((i) => {
    i.declarations.credit_assertions[1].status_ref = 'decision:x';
    return i;
  }), /credit_assertions\[1\]: matches a schema it must not match/u);
  assert.throws(() => build((i) => {
    i.declarations.credit_assertions[2].target.claim_id = 'clm_0000000000000000';
    return i;
  }), /is not in the bound claim graph/u);
  assert.throws(() => build((i) => {
    i.declarations.credit_assertions.push({ ...clone(i.declarations.credit_assertions[1]), assertion_id: 'a-dup' });
    return i;
  }), /already has a writing-original-draft assertion/u);
});

test('one review claim credits two source findings without making their curators review authors', () => {
  const { privateDoc, publicDoc } = build();
  const claim = publicDoc.source_credit.find((c) => c.claim_id === CLAIM_1);
  assert.deepEqual(claim.findings.map((f) => [f.finding_id, f.packet.packet_id, f.cited_work.cite_key]), [
    ['finding:alpha-f1', 'packet:crt17-alpha', 'synthAlpha2026'],
    ['finding:beta-f1', 'packet:crt17-beta', 'synthBeta2026'],
  ]);
  for (const finding of claim.findings) {
    assert.equal(finding.binding, 'reviewed-mapping');
    assert.deepEqual(finding.source_curation, { credit_channel: 'source-native', review_authorship: false });
    assert.equal(finding.cited_work.credit_kind, 'bibliographic-citation');
    assert.match(finding.packet.manifest_sha256, /^sha256:[a-f0-9]{64}$/u);
    assert.match(finding.phase2_finding_sha256, /^sha256:[a-f0-9]{64}$/u);
  }
  // Curator pseudonyms stay in the private record and are never contributors.
  const curators = privateDoc.source_credit.flatMap((c) => c.findings).flatMap((f) => f.source_assessments).map((a) => a.curator_ref);
  assert.deepEqual(curators.sort(), ['rv-a1a1a1a1a1a1a1a1', 'rv-b2b2b2b2b2b2b2b2', 'rv-c3c3c3c3c3c3c3c3']);
  const people = new Set(privateDoc.contributors.map((c) => c.id));
  assert.ok(curators.every((ref) => !people.has(ref)));
  assert.doesNotMatch(JSON.stringify(publicDoc), /rv-[a-f0-9]{16}/u);
  // Cited-work authors are bibliographic and never become contributors either.
  assert.ok(!privateDoc.contributors.some((c) => /Synthetic-(alpha|beta|gamma)/u.test(c.display_name)));
});

test('DOI equality alone credits nothing: only a reviewed mapping bound to the exact lineage does', () => {
  const unmapped = build((i) => {
    i.sources = i.sources.map((s) => ({ ...s, claimFindingMap: { ...s.claimFindingMap, mappings: [] } }));
    i.declarations.relation_proposals = [];
    i.declarations.disclosure_approvals = i.declarations.disclosure_approvals.filter((a) => a.subject_kind !== 'relation-proposal');
    return i;
  });
  // Every finding's DOI is cited by a claim, yet without a decision there is no source credit.
  assert.deepEqual(unmapped.privateDoc.source_credit, []);
  assert.throws(() => build((i) => {
    i.sources[0] = { ...i.sources[0], claimFindingMap: i.sources[1].claimFindingMap };
    return i;
  }), /bound to a different lineage sidecar/u);
  assert.throws(() => build((i) => {
    i.sources[0] = rebindSource(i.sources[0], (lineage) => { lineage.entries[0].phase2_finding_sha256 = `sha256:${'0'.repeat(64)}`; });
    return i;
  }), /phase2_finding_sha256 does not match/u);
  assert.throws(() => build((i) => {
    i.declarations.source_origins = i.declarations.source_origins.filter((o) => o.origin_id !== 'origin-alpha');
    return i;
  }), /packet packet:crt17-alpha has no declared source origin/u);
});

const PRIVATE_MARKERS = [
  'Synthetic Private Gamma Project', 'project:private-gamma-7f3a', 'origin-gamma', 'gamma', 'Synthetic Unpublished Collaborator C', 'person-c', 'person-e',
  '0000-0000-0000-001X', '0000-0000-0000-0028', '0000-0000-0000-0036', 'rv-', 'rationale', '[SYNTHETIC] alpha passage', 'passage text', 'consent:',
  'decision:', 'dispute:', 'withdrawal:', 'form:', 'decision_ref', 'lineage_sha256', 'rel-002', 'rel-003', 'approval', '"disclosure"', 'legacy_role_labels', 'source_origins',
];

test('nothing from an uncleared private origin, unpublished collaborator or rights-protected text reaches the public companion', () => {
  const { publicDoc, files } = build();
  const text = files.get(OUTPUT_FILES.public);
  for (const marker of PRIVATE_MARKERS) assert.ok(!text.includes(marker), `public companion leaks ${marker}`);
  assert.ok(!publicDoc.source_credit.some((c) => c.claim_id === CLAIM_2));
  // The private companion keeps them for the authorised workspace.
  const privateText = files.get(OUTPUT_FILES.private);
  for (const marker of ['Synthetic Private Gamma Project', 'project:private-gamma-7f3a', 'Synthetic Unpublished Collaborator C', 'rv-c3c3c3c3c3c3c3c3']) assert.ok(privateText.includes(marker));
  // Quotation text is copied nowhere, not even privately.
  for (const name of Object.values(OUTPUT_FILES)) assert.ok(!files.get(name).includes('passage text'), `${name} copies quotation text`);
});

test('if one of two origins behind a claim is private and uncleared, the claim publishes no source credit at all', () => {
  const { publicDoc, report, files } = build((i) => {
    Object.assign(i.declarations.source_origins.find((o) => o.origin_id === 'origin-beta'), { visibility: 'private', project_ref: 'project:private-beta-01', project_title: 'Synthetic Private Beta Project' });
    return i;
  });
  assert.deepEqual(publicDoc.source_credit, []);
  assert.deepEqual(publicDoc.relation_proposals, []);
  const text = files.get(OUTPUT_FILES.public);
  for (const marker of ['beta', 'alpha', 'Synthetic Private Beta Project', 'project:private-beta-01']) assert.ok(!text.includes(marker), `leaks ${marker}`);
  assert.deepEqual(report.withheld.source_credit_claims, [
    { id: CLAIM_1, reason: 'uncleared-private-origin' },
    { id: CLAIM_2, reason: 'uncleared-private-origin' },
  ]);

  // The source's controller approving this exact version restores it; an approval for another version does not.
  const approve = (version) => build((i) => {
    Object.assign(i.declarations.source_origins.find((o) => o.origin_id === 'origin-beta'), { visibility: 'private', project_ref: 'project:private-beta-01', project_title: 'Synthetic Private Beta Project' });
    i.declarations.disclosure_approvals.push({ approval_id: 'ap-beta', subject_kind: 'source-origin', subject_id: 'origin-beta', subject_version: version, grants: [{ party: 'controller', decision_ref: 'decision:beta-source', granted_at: '2026-09-09T00:00:00Z' }] });
    return i;
  });
  assert.deepEqual(approve('0.9.0').publicDoc.source_credit, []);
  const approved = approve('1.0.0');
  assert.deepEqual(approved.publicDoc.source_credit.map((c) => c.claim_id), [CLAIM_1]);
  assert.ok(!approved.files.get(OUTPUT_FILES.public).includes('Synthetic Private Beta Project'));
  assert.ok(!approved.files.get(OUTPUT_FILES.public).includes('project:private-beta-01'));
});

test('contributors need both the individual and the controller, for this version, before anything about them is public', () => {
  const { publicDoc, report } = build();
  assert.deepEqual(publicDoc.contributors.map((c) => c.id), ['person-a', 'person-b', 'person-d']);
  assert.deepEqual(report.withheld.contributors, [{ id: 'person-c', reason: 'missing-required-grant' }, { id: 'person-e', reason: 'approval-for-other-version' }]);
  // person-b approved name and roles but not the ORCID.
  assert.equal(publicDoc.contributors.find((c) => c.id === 'person-b').orcid, undefined);
  // Disputed and withdrawn assertions stay private.
  assert.deepEqual(publicDoc.credit_assertions.filter((a) => a.contributor === 'person-b').map((a) => a.assertion_id), ['a-004']);
  // Name only, no roles: the contributor is listed but no assertion or statement is published.
  const nameOnly = build((i) => {
    i.declarations.disclosure_approvals.find((a) => a.approval_id === 'ap-b').fields = ['display_name'];
    return i;
  }).publicDoc;
  assert.deepEqual(nameOnly.contributors.find((c) => c.id === 'person-b'), { display_name: 'Synthetic Person B', id: 'person-b', kind: 'person' });
  assert.ok(!nameOnly.credit_assertions.some((a) => a.contributor === 'person-b'));
  assert.throws(() => build((i) => {
    i.declarations.disclosure_approvals.find((a) => a.approval_id === 'ap-rel-001').fields = ['orcid'];
    return i;
  }), /fields apply to contributors only/u);
});

test('the public companion is exactly the allowlisted projection of the private one', () => {
  const { privateDoc, publicDoc, report } = build();
  assert.deepEqual(projectPublic(privateDoc), publicDoc);
  assert.ok(validateCompanions({ privateDoc, publicDoc, report }));
  // The public schema's closed objects and PUBLIC_ALLOWLIST name the same fields.
  const schema = loadSchema('contributorship.public');
  const keys = (def) => Object.keys(def.properties).sort();
  const pairs = [
    [schema, 'document'], [schema.$defs.contributor, 'contributor'], [schema.$defs.contributor.properties.orcid, 'orcid'], [schema.$defs.assertion, 'credit_assertion'],
    [schema.$defs.agentRun, 'agent_run'], [schema.$defs.sourceCredit, 'source_credit'], [schema.$defs.sourceFinding, 'source_finding'],
    [schema.$defs.sourceFinding.properties.packet, 'packet'], [schema.$defs.sourceFinding.properties.cited_work, 'cited_work'],
    [schema.$defs.sourceFinding.properties.passages.items, 'passage'], [schema.$defs.sourceFinding.properties.source_assessments.items, 'source_assessment'],
    [schema.$defs.sourceFinding.properties.source_curation, 'source_curation'], [schema.$defs.relationProposal, 'relation_proposal'],
    [schema.properties.subject, 'subject'], [schema.properties.production, 'production'],
  ];
  for (const [def, name] of pairs) assert.deepEqual(keys(def), [...PUBLIC_ALLOWLIST[name]].sort(), name);
  // Every public value is the private value, unchanged (only `visibility` differs by definition).
  const priv = new Map(privateDoc.contributors.map((c) => [c.id, c]));
  for (const c of publicDoc.contributors) for (const [k, v] of Object.entries(c)) assert.deepEqual(k === 'orcid' ? { id: priv.get(c.id).orcid.id, status: priv.get(c.id).orcid.status } : priv.get(c.id)[k], v);

  const tampered = clone(publicDoc);
  tampered.contributors[0].email = 'a@example.org';
  assert.throws(() => validateCompanions({ publicDoc: tampered }), /additional property is not allowed/u);
  const added = clone(publicDoc);
  added.contributors.push({ id: 'person-c', kind: 'person', display_name: 'Synthetic Unpublished Collaborator C' });
  assert.throws(() => validateCompanions({ privateDoc, publicDoc: added }), /not the allowlisted projection/u);
});

test('rights-restricted sources publish no passage hashes', () => {
  const { publicDoc, report } = build((i) => {
    i.sources[0] = rebindSource(i.sources[0], (lineage) => { lineage.entries[0].article.rights.redistribution = 'restricted'; });
    return i;
  });
  const alpha = publicDoc.source_credit[0].findings.find((f) => f.finding_id === 'finding:alpha-f1');
  assert.equal(alpha.passage_disclosure, 'rights-restricted');
  assert.equal(alpha.passages, undefined);
  assert.deepEqual(report.withheld.passages, [{ id: 'finding:alpha-f1@1', reason: 'rights-restricted' }]);
});

test('build is deterministic and independent of input order', () => {
  const reference = build().files;
  const shuffled = build((i) => {
    for (const key of ['contributors', 'credit_assertions', 'agent_runs', 'source_origins', 'relation_proposals', 'disclosure_approvals']) i.declarations[key].reverse();
    i.sources.reverse();
    return i;
  }).files;
  for (const name of Object.values(OUTPUT_FILES)) assert.equal(shuffled.get(name), reference.get(name), name);
});

test('credit lineage is kept apart from TRUST and source SEIP judgments', () => {
  const { files, privateDoc } = build();
  for (const name of Object.values(OUTPUT_FILES)) assert.doesNotMatch(files.get(name), /trust/iu, name);
  const assessments = privateDoc.source_credit.flatMap((c) => c.findings).flatMap((f) => f.source_assessments);
  assert.ok(assessments.every((a) => a.protocol === 'seip-support-v1'));
  // The builder writes nothing into the public review manifest or the ORAtlas export.
  assert.ok(!Object.values(OUTPUT_FILES).some((name) => /review-manifest|oratlas/u.test(name)));
});

test('the private release report names withheld records and is bound to both companions', () => {
  const { report, files } = build();
  assert.equal(report.visibility, 'private');
  assert.equal(report.private_sha256, sha256(Buffer.from(files.get(OUTPUT_FILES.private))));
  assert.equal(report.public_sha256, sha256(Buffer.from(files.get(OUTPUT_FILES.public))));
  assert.deepEqual(report.withheld.relation_proposals, [{ id: 'rel-002', reason: 'uncleared-private-origin' }, { id: 'rel-003', reason: 'proposer-not-disclosed' }]);
  assert.equal(buildPrivate(inputs()).visibility, 'private');
});

test('a finding id + revision supplied by two packets is rejected, whatever the input order', () => {
  const collide = (i) => {
    i.sources[2] = rebindSource(i.sources[2], (lineage) => { lineage.entries[0].finding.finding_id = 'finding:alpha-f1'; });
    return i;
  };
  const message = /finding:alpha-f1 revision 1 appears in both packet:crt17-alpha and packet:crt17-gamma/u;
  assert.throws(() => build(collide), message);
  assert.throws(() => build((i) => {
    collide(i).sources.reverse();
    return i;
  }), message);
});

test('the private schema keeps the verified-ORCID and status-reference invariants', () => {
  const { privateDoc } = build();
  const unverified = clone(privateDoc);
  delete unverified.contributors.find((c) => c.id === 'person-a').orcid.verification;
  assert.throws(() => validateCompanions({ privateDoc: unverified }), /contributors\[0\]\.orcid: missing verification/u);
  const claimedWithEvidence = clone(privateDoc);
  claimedWithEvidence.contributors.find((c) => c.id === 'person-b').orcid.verification = clone(privateDoc.contributors[0].orcid.verification);
  assert.throws(() => validateCompanions({ privateDoc: claimedWithEvidence }), /orcid: matches a schema it must not match/u);
  for (const id of ['a-001', 'a-005', 'a-006']) {
    const missing = clone(privateDoc);
    missing.credit_assertions.find((a) => a.assertion_id === id).status_ref = null;
    assert.throws(() => validateCompanions({ privateDoc: missing }), /status_ref: expected string; got null/u, id);
  }
  const declaredWithRef = clone(privateDoc);
  declaredWithRef.credit_assertions.find((a) => a.assertion_id === 'a-002').status_ref = 'decision:x';
  assert.throws(() => validateCompanions({ privateDoc: declaredWithRef }), /status_ref: expected null; got string/u);
});

test('a supplied release report must be the one recomputed from both companions', () => {
  const { privateDoc, publicDoc, report } = build();
  const stale = clone(report);
  stale.withheld.contributors = stale.withheld.contributors.filter((c) => c.id !== 'person-c');
  assert.throws(() => validateCompanions({ privateDoc, publicDoc, report: stale }), /release report does not match the supplied companions/u);
  const wrongDigest = clone(report);
  wrongDigest.public_sha256 = `sha256:${'0'.repeat(64)}`;
  assert.throws(() => validateCompanions({ privateDoc, publicDoc, report: wrongDigest }), /release report does not match/u);
  assert.throws(() => validateCompanions({ report }), /only be validated together with both companions/u);
});
