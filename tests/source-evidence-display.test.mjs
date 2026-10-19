import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { sha256 } from '../scripts/source-evidence/canonical.mjs';
import { FILES, importPacket, phase2FindingDigest, writeImport } from '../scripts/source-evidence/import.mjs';
import { curateIdentitySection, phase5Gate } from '../scripts/source-evidence/phase-gates.mjs';
import explorerPlugin, {
  DISPLAY_FALLBACK_FINDING_FIELDS,
  DISPLAY_FINDING_FIELDS,
  applyEvidenceAvailability,
  explorerDataFromLoad,
  loadEvidenceDirectory,
} from '../plugins/evidence-explorer-plugin.mjs';

// Packet -> Phase 2 import -> Phase 5 identity curation -> Evidence Explorer payload.
// The explorer is a display adapter: it must leave the curated package, the
// lineage sidecar and every native value exactly as the import produced them.

const G2 = path.resolve('tests/fixtures/source-evidence-packet/g2-pilot');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sep-display-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

function snapshot(dir) {
  return Object.fromEntries(fs.readdirSync(dir).sort().map((name) => [name, fs.readFileSync(path.join(dir, name))]));
}

function bind(evidenceDir) {
  const node = { type: 'evidence-explorer', evidenceDir, evidenceAvailability: 'available', height: '700px' };
  const warnings = [];
  explorerPlugin.transforms[0].plugin({}, { fileWarn: (_vfile, message) => warnings.push(message) })(
    { type: 'root', children: [node] },
    { path: path.join(evidenceDir, 'page.md') },
  );
  assert.equal(node.type, 'anywidget');
  return { payload: JSON.parse(node.model.evidence_data), warnings };
}

function stage(name, sectionPackage) {
  const importDir = path.join(TMP, name, 'import');
  const evidenceDir = path.join(TMP, name, 'evidence');
  const result = importPacket(G2);
  assert.equal(result.ok, true);
  writeImport(importDir, result);
  fs.mkdirSync(evidenceDir, { recursive: true });
  const curated = sectionPackage(result.phase2);
  fs.writeFileSync(path.join(evidenceDir, 'evidence_section_02.json'), `${JSON.stringify(curated, null, 2)}\n`);
  return { result, importDir, evidenceDir, curated };
}

test('packet -> curation -> display keeps lineage, digests and native findings unchanged', () => {
  const { result, importDir, evidenceDir, curated } = stage('identity', (phase2) => curateIdentitySection(phase2));
  const before = { import: snapshot(importDir), evidence: snapshot(evidenceDir) };
  const lineageBytes = before.import[FILES.lineage];

  const { payload, warnings } = bind(evidenceDir);

  // Nothing on disk moved.
  assert.deepEqual(snapshot(importDir), before.import);
  assert.deepEqual(snapshot(evidenceDir), before.evidence);
  assert.equal(sha256(lineageBytes), curated.import_provenance.lineage_sha256);

  // The curated package still passes the Phase 5 gate after display, with its sidecar binding intact.
  const onDisk = JSON.parse(before.evidence['evidence_section_02.json']);
  const gate = phase5Gate([onDisk], [result.phase2], { [result.phase2.evidence_artifact_id]: lineageBytes });
  assert.equal(gate.gate, 'pass', JSON.stringify(gate));

  // Adapter and section metadata.
  assert.equal(payload.evidence_status, 'loaded');
  assert.deepEqual(payload.diagnostics.loaded, [{ file: 'evidence_section_02.json', compatibility: 'legacy-section-package' }]);
  assert.equal(payload.sections.length, 1);
  assert.equal(payload.sections[0].section, 2);
  assert.equal(payload.sections[0].section_id, 'section_02');
  assert.deepEqual(payload.sections[0].import_provenance, curated.import_provenance);

  // Every native finding field reaches the payload verbatim; only documented display fields are added.
  const added = new Set([...DISPLAY_FINDING_FIELDS, ...DISPLAY_FALLBACK_FINDING_FIELDS, 'sources']);
  const lineage = JSON.parse(lineageBytes.toString('utf8'));
  assert.equal(payload.findings.length, curated.findings.length);
  payload.findings.forEach((shown, index) => {
    const native = curated.findings[index];
    for (const [key, value] of Object.entries(native)) assert.deepEqual(shown[key], value, `findings[${index}].${key}`);
    for (const key of Object.keys(shown)) assert.ok(key in native || added.has(key), `unexpected payload field ${key}`);
    const stripped = Object.fromEntries(Object.entries(shown).filter(([key]) => key in native));
    assert.equal(phase2FindingDigest(stripped), lineage.entries[index].phase2_finding_sha256);
  });

  // Native seip-support-v1 judgments stay in the sidecar; the payload neither copies nor converts them.
  assert.ok(lineage.entries.some((entry) => JSON.stringify(entry).includes('seip-support-v1')));
  const serialized = JSON.stringify(payload);
  assert.doesNotMatch(serialized, /seip-support-v1|native_assessments|trust_score|trust_label/u);

  // identity curation declares no conflict assessment, so the empty Conflicts panel is reported.
  assert.ok(warnings.some((w) => /zero conflicts/u.test(w)), warnings.join(' | '));
});

test('a section that carries its conflict assessment shows it verbatim and does not warn', () => {
  const { evidenceDir, curated } = stage('declared', (phase2) => ({
    ...curateIdentitySection(phase2),
    conflict_assessment: phase2.conflict_assessment,
  }));
  const { payload, warnings } = bind(evidenceDir);
  assert.deepEqual(payload.sections[0].conflict_assessment, curated.conflict_assessment);
  assert.equal(payload.sections[0].conflict_assessment.status, 'not_assessed');
  assert.deepEqual(payload.conflicts, []);
  assert.deepEqual(warnings, []);
});

test('rights: a finding without an exportable quote gains no supporting passage text', () => {
  const { evidenceDir } = stage('rights', (phase2) => {
    const section = curateIdentitySection(phase2);
    delete section.findings[0].claim_source_sentence;
    return section;
  });
  const loaded = applyEvidenceAvailability(loadEvidenceDirectory(evidenceDir), 'available');
  const finding = explorerDataFromLoad(loaded).findings[0];
  assert.equal('supporting_passages' in finding.sources[0], false);
  assert.equal(finding.claim_source_sentence, '');
});
