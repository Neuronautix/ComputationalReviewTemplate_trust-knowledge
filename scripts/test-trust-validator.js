#!/usr/bin/env node

'use strict';

const assert = require('node:assert/strict');
const {
  claimId,
  exactText,
  labelFor,
  normalizeClaim,
  parseBibliography,
  scoreRobustness,
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

const bibliography = parseBibliography('@article{One,\n  title={One},\n  doi={10.1000/ABC}\n}\n');
assert.equal(bibliography.get('One').doi, '10.1000/abc');

const empirical = {
  claim_type: 'empirical',
  claim_atoms: [{ atom_id: 'a1' }, { atom_id: 'a2' }],
  conflicts: [],
  citation_contexts: [
    {
      role: 'direct_support', source_type: 'primary', bibliography_status: 'verified',
      integrity_status: 'verified_no_known_issue', direction_match: true,
      passages: [{ verification_status: 'verified', locator: 'Abstract', supports_claim_atoms: ['a1', 'a2'] }],
      supports_claim_atoms: ['a1', 'a2'], independence_group: 'group-1',
    },
    {
      role: 'partial_support', source_type: 'primary', bibliography_status: 'verified',
      integrity_status: 'verified_no_known_issue', direction_match: true,
      passages: [{ verification_status: 'verified', locator: 'Abstract', supports_claim_atoms: ['a1'] }],
      supports_claim_atoms: ['a1'], independence_group: 'group-2',
    },
  ],
};
assert.deepEqual(scoreRobustness(empirical), [3, 'R3_CONVERGENT']);

const repository = validateRepository();
assert.deepEqual(repository.errors, [], repository.errors.join('\n'));
console.log('TRUST validator tests passed.');
