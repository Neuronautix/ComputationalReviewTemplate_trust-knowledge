import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createTrustClaimTransform,
  findTextQuote,
} from '../plugins/trust-claim-plugin.mjs';

test('text quotes normalize typography and whitespace but preserve raw offsets', () => {
  const text = 'Lead: “model cards”\nreport subgroup performance.';
  const range = findTextQuote(text, '"model cards" report subgroup performance');
  assert.deepEqual(range, {
    start: text.indexOf('“'),
    end: text.length - 1,
  });
  assert.equal(text.slice(range.start, range.end), '“model cards”\nreport subgroup performance');
});

test('ambiguous quotes fail closed unless prefix or suffix identifies one', () => {
  const text = 'First repeated claim. Later repeated claim.';
  assert.equal(findTextQuote(text, 'repeated claim'), null);
  assert.deepEqual(findTextQuote(text, 'repeated claim', 'Later '), {
    start: text.lastIndexOf('repeated'),
    end: text.length - 1,
  });
});

test('transform wraps one exact selection across inline formatting with a stable anchor', () => {
  const tree = {
    type: 'root',
    children: [
      {
        type: 'paragraph',
        children: [
          { type: 'text', value: 'Before exact ' },
          { type: 'strong', children: [{ type: 'text', value: 'claim text' }] },
          { type: 'text', value: ' after.' },
        ],
      },
      {
        type: 'trust-claim',
        claimId: 'clm_demo',
        claimText: 'exact claim text',
        kbPath: 'missing.json',
      },
    ],
  };

  createTrustClaimTransform()(tree, { path: 'content/test.md' });

  const target = tree.children[0].children[1];
  const widget = tree.children[1].children[0];
  assert.equal(target.type, 'span');
  assert.equal(target.identifier, 'trust-claim-target-clm-demo');
  assert.equal(target.class, 'trust-claim-target');
  assert.equal(target.children[0].value, 'exact ');
  assert.equal(target.children[1].type, 'strong');
  assert.equal(widget.id, 'trust-claim-target-clm-demo-widget');
  assert.equal(widget.model.targetAnchor, target.identifier);
  assert.equal(widget.model.scopeAnchor, '');
});

test('paraphrased claims create only a scope anchor and never claim the paragraph', () => {
  const tree = {
    type: 'root',
    children: [
      { type: 'paragraph', children: [{ type: 'text', value: 'The prose says something precise.' }] },
      {
        type: 'trust-claim',
        claimId: 'clm_paraphrase',
        claimText: 'A different summary of the prose.',
        kbPath: 'missing.json',
      },
    ],
  };

  createTrustClaimTransform()(tree, { path: 'content/test.md' });

  const scope = tree.children[0].children[0];
  const model = tree.children[1].children[0].model;
  assert.equal(scope.class, 'trust-claim-scope');
  assert.equal(scope.identifier, 'trust-claim-scope-clm-paraphrase');
  assert.equal(model.targetAnchor, '');
  assert.equal(model.scopeAnchor, scope.identifier);
});

test('explicit target ids do not rewrite adjacent prose', () => {
  const paragraph = { type: 'paragraph', children: [{ type: 'text', value: 'Adjacent prose.' }] };
  const tree = {
    type: 'root',
    children: [
      paragraph,
      {
        type: 'trust-claim',
        claimId: 'clm_explicit',
        claimText: 'A semantic claim.',
        targetId: 'author-owned-target',
        kbPath: 'missing.json',
      },
    ],
  };

  createTrustClaimTransform()(tree, { path: 'content/test.md' });

  assert.deepEqual(tree.children[0], paragraph);
  const model = tree.children[1].children[0].model;
  assert.equal(model.targetId, 'author-owned-target');
  assert.equal(model.quote, '');
});

test('repeated claim ids receive unique target and widget ids', () => {
  const tree = {
    type: 'root',
    children: [
      { type: 'paragraph', children: [{ type: 'text', value: 'First exact claim.' }] },
      {
        type: 'trust-claim',
        claimId: 'clm_repeat',
        claimText: 'First exact claim.',
        kbPath: 'missing.json',
      },
      { type: 'paragraph', children: [{ type: 'text', value: 'Second exact claim.' }] },
      {
        type: 'trust-claim',
        claimId: 'clm_repeat',
        claimText: 'Second exact claim.',
        kbPath: 'missing.json',
      },
    ],
  };

  createTrustClaimTransform()(tree, { path: 'content/test.md' });

  assert.equal(tree.children[0].children[0].identifier, 'trust-claim-target-clm-repeat');
  assert.equal(tree.children[1].children[0].id, 'trust-claim-target-clm-repeat-widget');
  assert.equal(tree.children[2].children[0].identifier, 'trust-claim-target-clm-repeat-2');
  assert.equal(tree.children[3].children[0].id, 'trust-claim-target-clm-repeat-2-widget');
});

test('overlapping claims preserve the first anchor and use a quote scope for the second', () => {
  const tree = {
    type: 'root',
    children: [
      { type: 'paragraph', children: [{ type: 'text', value: 'Alpha beta gamma delta.' }] },
      {
        type: 'trust-claim',
        claimId: 'clm_first',
        claimText: 'Alpha beta gamma',
        kbPath: 'missing.json',
      },
      {
        type: 'trust-claim',
        claimId: 'clm_second',
        claimText: 'beta gamma delta',
        kbPath: 'missing.json',
      },
    ],
  };

  createTrustClaimTransform()(tree, { path: 'content/test.md' });

  const scope = tree.children[0].children[0];
  const firstTarget = scope.children[0];
  const secondModel = tree.children[2].children[0].model;
  assert.equal(scope.class, 'trust-claim-scope');
  assert.equal(firstTarget.identifier, 'trust-claim-target-clm-first');
  assert.equal(secondModel.targetAnchor, '');
  assert.equal(secondModel.scopeAnchor, 'trust-claim-scope-clm-second');
  assert.equal(secondModel.quote, 'beta gamma delta');
});
