import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { generateCompatibilityReport } from '../scripts/review-compatibility-report.mjs';
import { applyEvidenceAvailability, loadEvidenceDirectory } from '../plugins/evidence-explorer-plugin.mjs';
import { importPacket } from '../scripts/source-evidence/import.mjs';
import { curateIdentitySection } from '../scripts/source-evidence/phase-gates.mjs';

// The generic compatibility report (ported from the template's evidence-contract work)
// applied to this fork: the TRUST claim graph is an extension reported verbatim, and
// Phase 5 packages are reported through the adapter that loaded them.

function evidenceLevel(result) {
  const loaded = result.diagnostics.loaded;
  return {
    status: result.status === 'not_provided' ? 'not_provided' : (result.diagnostics.rejected.length ? 'fail' : 'pass'),
    availability: result.status === 'not_provided' ? 'not_provided' : 'available',
    package_schema_versions: result.packages.length ? [...new Set(result.packages.map((p) => p.evidence_package_schema_version))] : [],
    loader_diagnostics: {
      discovered: result.status === 'not_provided' ? [] : result.diagnostics.discovered,
      loaded: result.status === 'not_provided' ? [] : loaded,
      rejected: result.status === 'not_provided' ? [] : result.diagnostics.rejected,
    },
  };
}

function trustValidation() {
  const run = spawnSync(process.execPath, ['scripts/validate-trust.js'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  return run.stdout.trim().split('\n').pop();
}

function report(evidence) {
  return generateCompatibilityReport({
    validator_version: 'trust-fork test',
    article_renderable: { status: 'pass', evidence: ['myst build --html'] },
    citation_aware: { status: 'pass', evidence: ['BIB_CITE_KEYS_RESOLVE'] },
    evidence_package_aware: evidence,
    claim_graph_aware: {
      status: 'pass',
      extensions: [{ name: 'trust-claim-graph', path: 'knowledge/claim_graph.json', validation_status: trustValidation() }],
    },
  }, { generatedAt: '2026-10-19T00:00:00.000Z' });
}

test('the template state reports a declared-absent Evidence Database and the TRUST graph verbatim', () => {
  const result = applyEvidenceAvailability(loadEvidenceDirectory(path.resolve('evidence')), 'not_provided');
  const generated = report(evidenceLevel(result));
  assert.equal(generated.evidence_package_aware.status, 'not_provided');
  assert.match(generated.claim_graph_aware.extensions[0].validation_status, /^TRUST validation passed/u);
  assert.doesNotMatch(JSON.stringify(generated), /overall_score|trust_label|high_trust/u);
});

test('an imported Phase 5 package is reported through the adapter that loaded it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compat-trust-'));
  try {
    const { phase2 } = importPacket(path.resolve('tests/fixtures/source-evidence-packet/g2-pilot'));
    fs.writeFileSync(path.join(dir, 'evidence_section_02.json'), JSON.stringify(curateIdentitySection(phase2)));
    const generated = report(evidenceLevel(applyEvidenceAvailability(loadEvidenceDirectory(dir), 'available')));
    assert.equal(generated.evidence_package_aware.status, 'pass');
    assert.deepEqual(generated.evidence_package_aware.loader_diagnostics.loaded,
      [{ file: 'evidence_section_02.json', compatibility: 'legacy-section-package' }]);
    assert.deepEqual(generated.evidence_package_aware.package_schema_versions, ['1.0.0']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
