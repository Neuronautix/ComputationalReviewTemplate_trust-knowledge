import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { isCanonicalJsonLine, isCanonicalManifest, sha256 } from '../scripts/source-evidence/canonical.mjs';
import { main } from '../scripts/import-source-evidence-packet.mjs';
import { FILES, importPacket, normalizeDoi, writeImport } from '../scripts/source-evidence/import.mjs';
import { conflictsDeclared, curateIdentitySection, phase2ImportGate, phase5Gate } from '../scripts/source-evidence/phase-gates.mjs';
import { validatePacket } from '../scripts/source-evidence/validate.mjs';
import { buildG2 } from './fixtures/source-evidence-packet/build-g2-fixture.mjs';
import { mutatedCopy, readPacketRecords } from './helpers/sep-packet.mjs';

const FIXTURES = path.resolve('tests/fixtures/source-evidence-packet');
const G2 = path.join(FIXTURES, 'g2-pilot');
const CANONICAL = path.join(FIXTURES, 'upstream-valid/canonical');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sep-import-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));
let counter = 0;
const scratch = (name) => path.join(TMP, `${name}-${counter += 1}`);
const codes = (result) => [...new Set(result.errors.map((e) => e.code))].sort();
const readText = (dir, name) => fs.readFileSync(path.join(dir, name), 'utf8');
const readJson = (dir, name) => JSON.parse(readText(dir, name));
const byId = (rows) => Object.fromEntries(rows.map((r) => [r.finding_id, r]));

function run(args) {
  let out = '';
  let err = '';
  const code = main(args, { out: (s) => { out += s; }, err: (s) => { err += s; } });
  return { code, out, err };
}

test('validator reproduces the producer reference validator on every upstream fixture', () => {
  assert.equal(validatePacket(CANONICAL).valid, true);
  const cases = fs.readdirSync(path.join(FIXTURES, 'upstream-invalid')).sort();
  assert.ok(cases.length >= 30);
  for (const name of cases) {
    const dir = path.join(FIXTURES, 'upstream-invalid', name);
    const expected = JSON.parse(readText(dir, 'expected.json')).errors.sort();
    const result = validatePacket(dir, { ignoreFiles: ['expected.json'] });
    assert.equal(result.valid, false, name);
    assert.deepEqual(codes(result), expected, name);
  }
});

test('private and embargoed packets are refused by default and only warn with allowRestricted', () => {
  for (const name of ['private-packet', 'embargoed-packet']) {
    const dir = path.join(FIXTURES, 'upstream-invalid', name);
    assert.ok(codes(validatePacket(dir, { ignoreFiles: ['expected.json'] })).includes('private-packet-not-exportable'));
    const relaxed = validatePacket(dir, { allowRestricted: true, ignoreFiles: ['expected.json'] });
    assert.equal(relaxed.valid, true);
    assert.equal(relaxed.warnings[0].code, 'private-packet-not-exportable');
  }
  const refused = importPacket(path.join(FIXTURES, 'upstream-invalid/private-packet'));
  assert.equal(refused.ok, false);
  assert.equal(refused.outputs, undefined);
});

test('canonical-encoding check ignores number spelling but not layout', () => {
  assert.equal(isCanonicalJsonLine('{"a":12.0,"b":1e-7}', { a: 12, b: 1e-7 }), true);
  assert.equal(isCanonicalJsonLine('{"b":1,"a":2}', { a: 2, b: 1 }), false);
  assert.equal(isCanonicalJsonLine('{"a": 1}', { a: 1 }), false);
  assert.equal(isCanonicalManifest('{\n  "a": 1\n}\n', { a: 1 }), true);
  assert.equal(isCanonicalManifest('{\n  "a": 1\n}', { a: 1 }), false);
});

test('G2: two findings from one article and one from another import with exact source and reviewer provenance', () => {
  const result = importPacket(G2);
  assert.equal(result.ok, true);
  const { phase2, lineage, report } = result;
  assert.deepEqual(report.counts.findings, { accepted: 3, rejected: 3, withheld: 1, incomplete: 1 });
  assert.deepEqual(phase2.findings.map((f) => f.doi), ['10.0000/g2.a', '10.0000/g2.a', '10.0000/g2.c']);
  assert.equal(phase2.unique_papers, 2);

  const records = readPacketRecords(G2);
  const passages = Object.fromEntries(records.passages.map((p) => [p.passage_id, p]));
  const assessments = Object.fromEntries(records.assessments.map((a) => [a.assessment_id, a]));
  const manifestBytes = fs.readFileSync(path.join(G2, 'manifest.json'));
  assert.equal(lineage.packet.manifest_sha256, sha256(manifestBytes));
  assert.deepEqual(Object.keys(lineage.packet.artifact_sha256), ['assessments.jsonl', 'findings.jsonl', 'papers.jsonl', 'passages.jsonl']);

  lineage.entries.forEach((entry, i) => {
    const finding = phase2.findings[i];
    const source = passages[entry.claim_source_passage_id];
    assert.equal(entry.package_index, i);
    assert.equal(finding.claim_source_sentence, source.quote, 'quote is carried verbatim');
    assert.equal(entry.passages.find((p) => p.passage_id === source.passage_id).quote_sha256, source.quote_sha256);
    assert.deepEqual(entry.passages.find((p) => p.passage_id === source.passage_id).match, source.match);
    assert.deepEqual(entry.passages.find((p) => p.passage_id === source.passage_id).source, source.source);
    assert.equal(entry.article.source_snapshot.sha256, records.papers.find((p) => p.paper_id === entry.article.paper_id).source_snapshot.sha256);
    for (const native of entry.native_assessments) {
      const original = assessments[native.assessment_id];
      assert.deepEqual(native, {
        assessment_id: original.assessment_id,
        passage_id: original.passage_id,
        protocol: 'seip-support-v1',
        status: original.status,
        rationale: original.rationale,
        reviewer_ref: original.reviewer_ref,
        assessed_at: original.assessed_at,
        assessed_snapshot_sha256: original.assessed_snapshot_sha256,
        producer_ids: original.producer_ids,
      });
    }
  });
  const first = lineage.entries[0];
  assert.equal(first.finding.finding_id, 'finding:g2-a-f1');
  assert.deepEqual(first.native_assessments.map((a) => a.reviewer_ref), ['rv-0123456789abcdef', 'rv-fedcba9876543210']);
  assert.deepEqual(first.finding.producer_ids.evidence_refs, ['evidence-g2-a-p1']);
  assert.equal(first.finding.numeric_results[0].value_appears_in_claim_source_sentence, true);
  assert.equal(result.phase2.import_provenance.lineage_sha256, sha256(Buffer.from(result.outputs[FILES.lineage], 'utf8')));
});

test('the two findings of one article stay distinct and keep their own context, passages and verification', () => {
  const { lineage } = importPacket(G2);
  const [f1, f2] = lineage.entries;
  assert.notEqual(f1.finding.finding_id, f2.finding.finding_id);
  assert.notEqual(f1.finding.context.time, f2.finding.context.time);
  assert.notEqual(f1.claim_source_passage_id, f2.claim_source_passage_id);
  assert.equal(f1.finding.verification_level, 'independently-verified');
  assert.equal(f2.finding.verification_level, 'source-verified');
  assert.ok(f2.flags.includes('has-unmatched-or-ambiguous-passages'));
  assert.equal(f2.passages.find((p) => p.passage_id === 'passage:g2-a-p3').match.status, 'ambiguous');
});

test('Phase 2 mapping keeps N definition, never invents effect size, replication or text access', () => {
  const { phase2, report, lineage } = importPacket(G2);
  const [f1, f2, f3] = phase2.findings;
  assert.equal(f1.n, 12);
  assert.match(f1.evidence, /n=12, n-definition=experimental-unit/u);
  assert.equal(f2.n, null);
  assert.equal(f3.n, null, 'an article-level N is not relabelled as an experimental-unit N');
  assert.match(f3.evidence, /n=40, n-definition=article-level/u);
  assert.equal(lineage.entries[2].finding.numeric_results[0].n.definition, 'article-level');
  for (const f of phase2.findings) {
    assert.equal(f.effect_size, null);
    assert.equal(f.effect_size_source_sentence, null);
    assert.equal(f.replication_status, 'replication_unknown');
    assert.deepEqual(f.replication_evidence_dois, []);
    assert.equal(f.text_access, 'unknown');
    assert.deepEqual(Object.keys(f).sort(), ['claim', 'claim_source_sentence', 'doi', 'effect_size', 'effect_size_source_sentence', 'evidence', 'n', 'replication_evidence_dois', 'replication_status', 'study_system', 'text_access']);
  }
  const nLoss = report.findings.filter((f) => f.status === 'accepted').map((f) => f.field_report.find((x) => x.field === 'n').disposition);
  assert.deepEqual(nLoss, ['mapped', 'null-absent-in-packet', 'null-not-comparable']);
  assert.equal(report.findings[0].field_report.find((x) => x.field === 'text_access').disposition, 'unknown-kept');
});

test('every non-accepted record has an explicit status and reasons, and is absent from the outputs', () => {
  const { report, phase2, outputs } = importPacket(G2);
  const rows = byId(report.findings);
  const reasonCodes = (id) => rows[id].reasons.map((r) => r.code);
  assert.equal(rows['finding:g2-a-f3'].status, 'rejected');
  assert.ok(reasonCodes('finding:g2-a-f3').includes('ambiguous-passage'));
  assert.ok(reasonCodes('finding:g2-a-f3').includes('unreviewed'));
  assert.deepEqual(reasonCodes('finding:g2-a-f4'), ['reviewer-contradiction']);
  assert.equal(rows['finding:g2-b-f1'].status, 'withheld');
  assert.ok(reasonCodes('finding:g2-b-f1').includes('source-unavailable'));
  assert.ok(reasonCodes('finding:g2-b-f1').includes('missing-doi'));
  assert.equal(rows['finding:g2-c-f2'].status, 'incomplete');
  assert.deepEqual(reasonCodes('finding:g2-c-f2'), ['source-sentence-not-verbatim']);
  assert.equal(rows['finding:g2-d-f1'].status, 'rejected');
  assert.deepEqual(reasonCodes('finding:g2-d-f1'), ['missing-doi']);
  assert.equal(phase2.findings.length, 3);
  for (const fragment of ['well tolerated', 'raised marker Z', 'Synthetic treatment U']) {
    assert.equal(outputs[FILES.phase2].includes(fragment) || outputs[FILES.lineage].includes(fragment), false, fragment);
  }
  assert.equal(report.counts.consumer_classes.restricted, 1);
});

test('the verification threshold is configurable and defaults to human-reviewed', () => {
  const strict = importPacket(G2, { minVerification: 'source-verified' });
  assert.deepEqual(strict.report.counts.findings.accepted, 2);
  const rows = byId(strict.report.findings);
  assert.ok(rows['finding:g2-c-f1'].reasons.some((r) => r.code === 'verification-below-threshold'));
  assert.throws(() => importPacket(G2, { minVerification: 'unverified' }), /minVerification/u);
});

test('the producer canonical fixture imports its one approved finding and accounts for the rest', () => {
  const { report, phase2 } = importPacket(CANONICAL);
  assert.deepEqual(report.counts.findings, { accepted: 1, rejected: 1, withheld: 1, incomplete: 0 });
  assert.equal(phase2.findings[0].claim_source_sentence, 'treatment X lowered marker Y at day 14');
  assert.equal(phase2.findings[0].n, 12);
  const rows = byId(report.findings);
  assert.equal(rows['finding:synth-b-f1'].status, 'withheld');
  assert.equal(rows['finding:synth-a-f2'].status, 'rejected');
});

test('idempotent replay: identical input bytes yield identical files and digests', () => {
  const a = scratch('replay-a');
  const b = scratch('replay-b');
  const moved = scratch('moved-packet');
  fs.cpSync(G2, moved, { recursive: true });
  assert.equal(run(['--packet', G2, '--out', a, '--check-gates']).code, 0);
  assert.equal(run(['--packet', moved, '--out', b, '--check-gates']).code, 0);
  for (const name of Object.values(FILES)) {
    assert.equal(readText(a, name), readText(b, name), name);
    assert.equal(sha256(fs.readFileSync(path.join(a, name))), sha256(fs.readFileSync(path.join(b, name))));
  }
  assert.equal(run(['--packet', G2, '--out', a]).code, 0, 're-running into the same directory is a no-op');
});

test('imports are immutable: a different result is never written over an existing sidecar', () => {
  const dir = scratch('immutable');
  writeImport(dir, importPacket(G2));
  const other = importPacket(G2, { minVerification: 'source-verified' });
  assert.throws(() => writeImport(dir, other), /imports are immutable/u);
  const refused = run(['--packet', G2, '--out', dir, '--min-verification', 'source-verified']);
  assert.equal(refused.code, 1);
  assert.match(refused.err, /immutable/u);
});

test('fixture generator is deterministic and the committed G2 packet is current', () => {
  const dir = scratch('g2-rebuild');
  buildG2(dir);
  for (const name of fs.readdirSync(G2)) assert.equal(readText(dir, name), readText(G2, name), name);
});

test('corrupt hash, length, version and bytes fail closed with no outputs', () => {
  const tamper = scratch('tamper');
  fs.cpSync(G2, tamper, { recursive: true });
  const file = path.join(tamper, 'passages.jsonl');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('lowered marker Y by 2.5', 'lowered marker Y by 9.5'));
  let result = validatePacket(tamper);
  assert.ok(codes(result).includes('artifact-hash-mismatch'));
  assert.ok(codes(result).includes('quote-hash-mismatch'));
  assert.equal(importPacket(tamper).ok, false);

  const version = scratch('version');
  fs.cpSync(G2, version, { recursive: true });
  const manifestPath = path.join(version, 'manifest.json');
  fs.writeFileSync(manifestPath, fs.readFileSync(manifestPath, 'utf8').replace('source-evidence-packet/0.1.0', 'source-evidence-packet/0.2.0'));
  result = validatePacket(version);
  assert.deepEqual(codes(result), ['unsupported-schema-version']);

  const out = scratch('refused-out');
  const cli = run(['--packet', tamper, '--out', out]);
  assert.equal(cli.code, 1);
  assert.equal(fs.existsSync(out), false, 'nothing is written for a refused packet');
  assert.match(cli.err, /artifact-hash-mismatch/u);
});

test('cross-paper links fail: finding to foreign passage, and assessment to a passage the finding does not cite', () => {
  const foreign = scratch('foreign-passage');
  mutatedCopy(G2, foreign, (records) => {
    records.findings.find((f) => f.finding_id === 'finding:g2-a-f1').passage_ids = ['passage:g2-c-p1'];
  });
  assert.ok(codes(validatePacket(foreign)).includes('passage-paper-mismatch'));
  assert.equal(importPacket(foreign).ok, false);

  const assessment = scratch('foreign-assessment');
  mutatedCopy(G2, assessment, (records) => {
    records.assessments.find((a) => a.assessment_id === 'assessment:g2-6').passage_id = 'passage:g2-a-p1';
  });
  assert.ok(codes(validatePacket(assessment)).includes('assessment-cross-link'));
  assert.equal(importPacket(assessment).ok, false);

  const unciting = scratch('uncited-passage');
  mutatedCopy(G2, unciting, (records) => {
    records.assessments.find((a) => a.assessment_id === 'assessment:g2-3').passage_id = 'passage:g2-a-p1';
  });
  assert.ok(codes(validatePacket(unciting)).includes('assessment-cross-link'));
});

test('mismatched review and dangling references fail', () => {
  const stale = scratch('stale-review');
  mutatedCopy(G2, stale, (records) => {
    records.assessments.find((a) => a.assessment_id === 'assessment:g2-1').assessed_snapshot_sha256 = sha256(Buffer.from('another snapshot'));
  });
  assert.ok(codes(validatePacket(stale)).includes('assessed-snapshot-mismatch'));

  const dangling = scratch('dangling');
  mutatedCopy(G2, dangling, (records) => {
    records.findings.find((f) => f.finding_id === 'finding:g2-a-f2').passage_ids.push('passage:nowhere');
  });
  assert.ok(codes(validatePacket(dangling)).includes('dangling-passage-ref'));
});

test('restricted and private content is withheld or refused, never published', () => {
  const restrictedScope = scratch('restricted-scope');
  mutatedCopy(G2, restrictedScope, (records, manifest) => { manifest.access_scope = { level: 'restricted', redistributable_full_text: false }; });
  const restricted = importPacket(restrictedScope);
  assert.equal(restricted.ok, true);
  assert.deepEqual(restricted.report.counts.findings.accepted, 0);
  assert.equal(restricted.phase2.findings.length, 0);
  assert.ok(restricted.report.findings.every((f) => f.reasons.some((r) => r.code === 'packet-scope-restricted')));
  assert.equal(restricted.outputs[FILES.lineage].includes('treatment X lowered'), false);

  const embargoed = scratch('embargoed');
  mutatedCopy(G2, embargoed, (records, manifest) => {
    manifest.access_scope = { embargo_until: '2027-01-01T00:00:00Z', level: 'embargoed', redistributable_full_text: false };
  });
  assert.ok(codes(validatePacket(embargoed)).includes('private-packet-not-exportable'));
  assert.equal(importPacket(embargoed).ok, false);

  const leak = scratch('leak');
  mutatedCopy(G2, leak, (records) => {
    records.papers.find((p) => p.paper_id === 'paper:g2-c').rights.redistribution = 'restricted';
  });
  assert.ok(codes(validatePacket(leak)).includes('restricted-quote-leak'));
});

test('a paper whose rights are not redistributable cannot reach the outputs even if the producer approved it', () => {
  const dir = scratch('metadata-only');
  mutatedCopy(G2, dir, (records) => {
    const paper = records.papers.find((p) => p.paper_id === 'paper:g2-c');
    paper.rights.redistribution = 'metadata-only';
    for (const p of records.passages.filter((x) => x.paper_id === 'paper:g2-c')) {
      p.quote_state = 'withheld-rights';
      p.quote = 'withheld';
    }
  });
  const result = importPacket(dir);
  assert.equal(result.ok, true);
  assert.deepEqual(result.phase2.findings.map((f) => f.doi), ['10.0000/g2.a', '10.0000/g2.a']);
  const rows = byId(result.report.findings);
  assert.equal(rows['finding:g2-c-f1'].status, 'withheld');
  assert.ok(rows['finding:g2-c-f1'].reasons.some((r) => r.code === 'paper-rights-not-redistributable'));
  for (const text of Object.values(result.outputs)) assert.equal(text.includes('7.1 mg/dL'), false);
});

test('partial packets stay partial and producer-withheld counts are reported separately from rejections', () => {
  const dir = scratch('partial');
  mutatedCopy(G2, dir, (records, manifest) => {
    manifest.export_status = { reasons: ['2 findings embargoed by the producer'], state: 'partial', withheld_counts: { assessments: 0, findings: 2, papers: 0, passages: 0 } };
  });
  const { report } = importPacket(dir);
  assert.deepEqual(report.counts.omitted_by_producer, { assessments: 0, findings: 2, papers: 0, passages: 0 });
  assert.equal(report.counts.producer_export_state, 'partial');
  const claimed = scratch('complete-claimed');
  mutatedCopy(G2, claimed, (records, manifest) => {
    manifest.export_status = { reasons: [], state: 'complete', withheld_counts: { assessments: 0, findings: 2, papers: 0, passages: 0 } };
  });
  assert.ok(codes(validatePacket(claimed)).includes('completeness-fabricated'));
});

test('null or unknown N, unit and context are kept honest rather than defaulted', () => {
  const dir = scratch('unknown-n');
  mutatedCopy(G2, dir, (records) => {
    const f = records.findings.find((x) => x.finding_id === 'finding:g2-a-f1');
    f.numeric_results = [
      { n: { definition: 'unknown', value: 12 }, name: 'mean difference', unit: 'unknown', value: -2.5 },
    ];
    f.context.population = 'unknown';
  });
  const { phase2, report } = importPacket(dir);
  assert.equal(phase2.findings[0].n, null);
  assert.equal(phase2.findings[0].study_system, 'unknown');
  const fields = byId(report.findings)['finding:g2-a-f1'].field_report;
  assert.equal(fields.find((x) => x.field === 'study_system').disposition, 'unknown-kept');
  assert.equal(fields.find((x) => x.field === 'n').disposition, 'null-not-comparable');
});

test('a numeric value absent from the source passage is flagged, not asserted as sourced', () => {
  const dir = scratch('number-missing');
  mutatedCopy(G2, dir, (records) => {
    records.findings.find((x) => x.finding_id === 'finding:g2-a-f1').numeric_results[0].value = -3.9;
  });
  const { lineage } = importPacket(dir);
  assert.equal(lineage.entries[0].finding.numeric_results[0].value_appears_in_claim_source_sentence, false);
});

test('revisions are never collapsed: only the latest revision of a finding can be imported', () => {
  const dir = scratch('revisions');
  mutatedCopy(G2, dir, (records) => {
    const f1 = records.findings.find((x) => x.finding_id === 'finding:g2-a-f1');
    records.findings.push({ ...structuredClone(f1), revision: 2, export_state: 'proposed', review_state: 'unreviewed', verification_level: 'unverified', statement: 'Treatment X lowered marker Y at day 14 (revised wording).' });
  });
  const { report } = importPacket(dir);
  const rev1 = report.findings.find((f) => f.finding_id === 'finding:g2-a-f1' && f.revision === 1);
  assert.equal(rev1.status, 'rejected');
  assert.ok(rev1.reasons.some((r) => r.code === 'superseded-revision'));
});

test('findings are never merged by text, even when two share a sentence', () => {
  const dir = scratch('twins');
  mutatedCopy(G2, dir, (records) => {
    const f1 = records.findings.find((x) => x.finding_id === 'finding:g2-a-f1');
    records.findings.push({ ...structuredClone(f1), finding_id: 'finding:g2-a-f1-twin' });
    records.assessments.push(...records.assessments.filter((a) => a.finding_id === 'finding:g2-a-f1').map((a) => ({ ...a, assessment_id: `${a.assessment_id}-twin`, finding_id: 'finding:g2-a-f1-twin' })));
  });
  const { phase2 } = importPacket(dir);
  assert.equal(phase2.findings.length, 4);
});

test('outputs carry no TRUST, replication or full-text fields and no reviewer identity beyond the pseudonym', () => {
  const { outputs, lineage } = importPacket(G2);
  const serialized = Object.values(outputs).join('\n');
  for (const forbidden of ['trust_score', '"overall_score"', '"trust_level"', '"claim_type"', 'independently_replicated']) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
  assert.ok(lineage.entries.every((e) => e.article.rights.full_text_included === false), 'no full text is ever carried');
  assert.equal(/@[a-z0-9-]+\.[a-z]{2,}/iu.test(serialized), false, 'no email-like strings');
  const refs = new Set(lineage.entries.flatMap((e) => e.native_assessments.map((a) => a.reviewer_ref)));
  for (const ref of refs) assert.match(ref, /^rv-[0-9a-f]{16,64}$/u);
  assert.ok(lineage.statements_not_made.some((s) => /not semantic support/u.test(s)));
  assert.ok(lineage.statements_not_made.some((s) => /not ComputationalReviewTemplate TRUST/u.test(s)));
  assert.deepEqual(lineage.entries[0].native_assessments.map((a) => a.status), ['supports', 'supports']);
});

test('Gate G2: imported packages pass the Phase 2 import gate and the Phase 5 shape and curation gates', () => {
  const { phase2, outputs } = importPacket(G2);
  const lineageBytes = Buffer.from(outputs[FILES.lineage], 'utf8');
  const phase2Gate = phase2ImportGate(phase2, lineageBytes);
  assert.equal(phase2Gate.gate, 'pass', JSON.stringify(phase2Gate.checks));
  assert.ok(phase2Gate.exempt.length > 0, 'pilot corpus-size exceptions are listed, not hidden');
  assert.ok(phase2Gate.exempt.some((e) => e.check === 'PAPER_COUNT_FLOOR' && e.category === 'fixed-corpus'));
  const section = curateIdentitySection(phase2);
  const gate = phase5Gate([section], [phase2], { [phase2.evidence_artifact_id]: lineageBytes });
  assert.equal(gate.gate, 'pass', JSON.stringify(gate));
  assert.equal(gate.aggregate_results.ALL_CONFLICTS_ASSIGNED, 'pass');
});

test('Phase 5 gates still reject what they always rejected', () => {
  const { phase2, outputs } = importPacket(G2);
  const lineageBytes = Buffer.from(outputs[FILES.lineage], 'utf8');
  const lineageMap = { [phase2.evidence_artifact_id]: lineageBytes };
  const scaffold = { section_id: 'section_02', section_plan: {}, figure_specs: [], figure_style_guide: {} };
  assert.match(phase5Gate([scaffold], [phase2], lineageMap).shape_errors[0], /WRONG_ARTIFACT_TYPE/u);
  assert.match(phase5Gate([{ section_id: 'section_02', findings: [] }], [phase2], lineageMap).shape_errors[0], /SCHEMA_INVALID/u);

  const strings = curateIdentitySection(phase2);
  strings.findings = strings.findings.map((f) => f.cite_key);
  assert.equal(phase5Gate([strings], [phase2], lineageMap).per_section_results.section_02.FINDINGS_ARE_OBJECTS, 'fail');

  const dupes = curateIdentitySection(phase2);
  dupes.findings[1] = { ...dupes.findings[1], claim_source_sentence: dupes.findings[0].claim_source_sentence };
  assert.equal(phase5Gate([dupes], [phase2], lineageMap).per_section_results.section_02.NO_INTRA_SECTION_DUPLICATES, 'fail');

  const dropped = curateIdentitySection(phase2);
  dropped.findings = dropped.findings.slice(0, 1);
  const lossy = phase5Gate([dropped], [phase2], lineageMap);
  assert.equal(lossy.gate, 'fail');
  assert.equal(lossy.aggregate_results.ZERO_LOSS, 'fail');
  assert.equal(lossy.aggregate_results.ANTI_COMPRESSION, 'fail');

  const conflicting = structuredClone(phase2);
  conflicting.conflicts = [{ paper_a_doi: '10.0000/g2.a', paper_b_doi: '10.0000/g2.c', paper_a_claim: 'x', paper_b_claim: 'y', nature_of_conflict: 'z', resolution_status: 'unresolved' }];
  const unassigned = curateIdentitySection(phase2);
  assert.equal(phase5Gate([unassigned], [conflicting], lineageMap).aggregate_results.ALL_CONFLICTS_ASSIGNED, 'fail');
});

test('text_access "unknown" is accepted only for a package whose lineage sidecar hash verifies', () => {
  const { phase2, outputs } = importPacket(G2);
  const lineageBytes = Buffer.from(outputs[FILES.lineage], 'utf8');
  const section = curateIdentitySection(phase2);
  const key = phase2.evidence_artifact_id;
  assert.equal(phase5Gate([section], [phase2], {}).per_section_results.section_02.TEXT_ACCESS_VALID, 'fail', 'no sidecar supplied');
  const tampered = Buffer.from(`${outputs[FILES.lineage]} `, 'utf8');
  assert.equal(phase5Gate([section], [phase2], { [key]: tampered }).per_section_results.section_02.TEXT_ACCESS_VALID, 'fail', 'sidecar changed after import');
  const native = structuredClone(phase2);
  delete native.import_provenance;
  const nativeSection = curateIdentitySection(native);
  assert.equal(phase5Gate([nativeSection], [native], { [key]: lineageBytes }).per_section_results.section_02.TEXT_ACCESS_VALID, 'fail', 'native packages keep fulltext|abstract_only');
  const labelled = structuredClone(phase2);
  labelled.findings.forEach((f) => { f.text_access = 'abstract_only'; });
  assert.equal(phase5Gate([curateIdentitySection(labelled)], [labelled], { [key]: lineageBytes }).per_section_results.section_02.TEXT_ACCESS_VALID, 'pass');
});

test('a legitimate empty conflict set is accepted only when declared, in imports and in native packages', () => {
  const { phase2 } = importPacket(G2);
  assert.deepEqual(phase2.conflicts, []);
  assert.equal(phase2.conflict_assessment.status, 'not_assessed');
  assert.equal(conflictsDeclared(phase2), true);
  assert.equal(conflictsDeclared({ conflicts: [] }), false, 'a bare empty array is not a declaration');
  assert.equal(conflictsDeclared({ conflicts: [], conflict_assessment: { status: 'none_found', basis: '' } }), false);
  assert.equal(conflictsDeclared({ conflicts: [], conflict_assessment: { status: 'none_found', basis: 'contradiction queries q1-q4 returned no opposing primary study' } }), true);
  assert.equal(conflictsDeclared({ conflicts: [{ paper_a_doi: 'a', paper_b_doi: 'b' }] }), true, 'non-empty conflict sets behave as before');
});

test('DOI normalisation accepts resolver URLs and rejects non-DOIs', () => {
  assert.equal(normalizeDoi('https://doi.org/10.0000/ABC.1'), '10.0000/abc.1');
  assert.equal(normalizeDoi('10.0000/G2.C'), '10.0000/g2.c');
  assert.equal(normalizeDoi('not-available'), null);
  assert.equal(normalizeDoi('PMC123'), null);
});

test('CLI: usage errors, validate-only and the frozen example command', () => {
  assert.equal(run([]).code, 2);
  assert.equal(run(['--bogus']).code, 2);
  assert.equal(run(['--packet', G2]).code, 2);
  assert.equal(run(['--packet', G2, '--out', scratch('bad-min'), '--min-verification', 'bogus']).code, 2);
  const validateOnly = run(['--packet', G2, '--validate-only']);
  assert.equal(validateOnly.code, 0);
  assert.equal(JSON.parse(validateOnly.out).valid, true);
  assert.equal(run(['--packet', path.join(FIXTURES, 'upstream-invalid/revision-gap'), '--validate-only']).code, 1);

  // Frozen example command (docs/SOURCE_EVIDENCE_IMPORT.md): the digests below are the contract for G2 replay.
  const out = scratch('frozen');
  const result = run(['--packet', G2, '--out', out, '--check-gates']);
  assert.equal(result.code, 0, result.err);
  const summary = JSON.parse(result.out);
  assert.deepEqual(summary.findings, { accepted: 3, rejected: 3, withheld: 1, incomplete: 1 });
  assert.equal(summary.gates.phase5.gate, 'pass');
  assert.equal(sha256(fs.readFileSync(path.join(out, FILES.lineage))), FROZEN_DIGESTS.lineage);
  assert.equal(sha256(fs.readFileSync(path.join(out, FILES.phase2))), FROZEN_DIGESTS.phase2);
  assert.equal(sha256(fs.readFileSync(path.join(out, FILES.report))), FROZEN_DIGESTS.report);
});

test('importing is opt-in: no native pipeline script or skill invokes the importer', () => {
  const needle = /import-source-evidence-packet|source-evidence\/import/u;
  const roots = ['scripts', 'plugins', 'automation', '.github/workflows', 'skills'];
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  const hits = roots.flatMap((r) => (fs.existsSync(r) ? walk(r) : []))
    .filter((f) => !f.startsWith('scripts/source-evidence') && f !== 'scripts/import-source-evidence-packet.mjs')
    .filter((f) => needle.test(fs.readFileSync(f, 'utf8')));
  // Only CI and skill documentation mention it; no script or plugin calls it.
  assert.deepEqual(hits.sort(), [
    '.github/workflows/source-evidence-import.yml',
    'skills/comprev-evidence-gathering.md',
    'skills/comprev-evidence-validator.md',
  ]);
});

const FROZEN_DIGESTS = {
  lineage: 'sha256:e8cb92f863f442efebec3af4333d45fe856c78ddba843e2649ebd63fabbfdfd8',
  phase2: 'sha256:963c5c06f99fc08401a3a1d7a4932555b99bf8836b6f7df1564b05bff31bdd96',
  report: 'sha256:e743f4a9ce8ad2676db76c8d2fd3101121399c10d9e50c370711330b431fdd09',
};
