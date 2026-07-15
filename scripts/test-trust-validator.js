#!/usr/bin/env node

'use strict';

const assert = require('node:assert/strict');
const {
  claimId,
  deriveEvidenceRelation,
  deriveWordingBasis,
  exactText,
  labelFor,
  isVerifiedPassage,
  normalizeClaim,
  parseBibliography,
  scoreRobustness,
  validateSchema,
  validateRepository,
} = require('./validate-trust.js');

const exact = 'Optogenetic studies in mice indicate gamma rhythms.';
assert.equal(exactText(`  ${exact.replaceAll(' ', '  ')}  `), exact);
assert.equal(normalizeClaim("Model's gamma-cycle response."), 'model s gamma cycle response');
assert.match(claimId('sec-test', exact), /^clm_[a-f0-9]{16}$/);
assert.equal(claimId('sec-test', exact), claimId('sec-test', ` ${exact} `));
assert.notEqual(claimId('sec-test', exact), claimId('sec-other', exact));

assert.equal(labelFor(100), 'high_trust');
assert.equal(labelFor(85), 'high_trust');
assert.equal(labelFor(84), 'moderate_trust');
assert.equal(labelFor(70), 'moderate_trust');
assert.equal(labelFor(69), 'low_trust');
assert.equal(labelFor(50), 'low_trust');
assert.equal(labelFor(49), 'critical_or_unreliable');

const bibliography = parseBibliography('@article{One,\n  author={Smith, Ada and Jones, Ben},\n  title={One},\n  doi={10.1000/ABC}\n}\n');
assert.equal(bibliography.get('One').doi, '10.1000/abc');
assert.deepEqual(bibliography.get('One').authors, ['Smith, Ada', 'Jones, Ben']);

const empirical = {
  claim_type: 'empirical',
  claim_atoms: [{ atom_id: 'a1' }, { atom_id: 'a2' }],
  conflicts: [],
  citation_contexts: [
    {
      role: 'direct_support', source_type: 'primary', bibliography_status: 'verified',
      integrity_status: 'verified_no_known_issue', direction_match: true,
      passages: [{
        verification_status: 'verified', locator: 'Abstract',
        verification_source: 'https://example.org/one', verified_at: '2025-01-01T00:00:00Z',
        supports_claim_atoms: ['a1', 'a2'],
      }],
      supports_claim_atoms: ['a1', 'a2'], independence_group: 'group-1',
    },
    {
      role: 'partial_support', source_type: 'primary', bibliography_status: 'verified',
      integrity_status: 'verified_no_known_issue', direction_match: true,
      passages: [{
        verification_status: 'verified', locator: 'Abstract',
        verification_source: 'https://example.org/two', verified_at: '2025-01-01T00:00:00Z',
        supports_claim_atoms: ['a1'],
      }],
      supports_claim_atoms: ['a1'], independence_group: 'group-2',
    },
  ],
};
assert.deepEqual(scoreRobustness(empirical), [3, 'R3_CONVERGENT']);
assert.equal(deriveEvidenceRelation({ ...empirical, scope_status: 'matched' }), 'directly_supported');
assert.equal(deriveEvidenceRelation({ ...empirical, scope_status: 'overextended' }), 'overextended');
assert.equal(isVerifiedPassage({
  verification_status: 'verified', locator: 'Abstract', verification_source: 'https://example.org', verified_at: '2999-01-01T00:00:00Z',
}), false);
const mixedPassageValidity = {
  ...empirical,
  scope_status: 'matched',
  citation_contexts: [{
    ...empirical.citation_contexts[0],
    passages: [
      { ...empirical.citation_contexts[0].passages[0], supports_claim_atoms: ['a1'] },
      {
        verification_status: 'verified', locator: 'Abstract', verification_source: 'https://example.org/one',
        verified_at: '2999-01-01T00:00:00Z', supports_claim_atoms: ['a2'],
      },
    ],
  }],
};
assert.equal(deriveEvidenceRelation(mixedPassageValidity), 'partially_supported');

assert.deepEqual(
  deriveWordingBasis({ claim_text: 'Studies indicate the treatment may help.', claim_type: 'empirical' }),
  { wording_strength: 'qualified', rule_id: 'SURFACE_HEDGE', markers: ['indicate', 'may'] },
);
assert.deepEqual(
  deriveWordingBasis({ claim_text: 'The authors proposed a method they argued could help.', claim_type: 'methodological' }),
  { wording_strength: 'unqualified', rule_id: 'SURFACE_ATTRIBUTION', markers: ['proposed', 'argued'] },
);

assert.deepEqual(validateSchema(
  { score: 4 },
  { type: 'object', additionalProperties: false, required: ['score'], properties: { score: { type: 'integer', maximum: 4 } } },
), []);
assert.match(validateSchema(
  { score: 5, override: true },
  { type: 'object', additionalProperties: false, required: ['score'], properties: { score: { type: 'integer', maximum: 4 } } },
).join('\n'), /additional property|above maximum/);

const repository = validateRepository();
assert.deepEqual(repository.errors, [], repository.errors.join('\n'));
console.log('TRUST validator tests passed.');
