import test from 'node:test';
import assert from 'node:assert/strict';

import {
  activateConcernedText,
  bindHighlightLifecycle,
  findTextQuote,
  renderCitationContexts,
  trustBandText,
} from '../content/trust-claim-widget.mjs';

test('visible score bands use canonical TRUST wording', () => {
  assert.equal(trustBandText(null), 'Pending validation');
  assert.equal(trustBandText(85), 'High trust');
  assert.equal(trustBandText(84), 'Moderate trust');
  assert.equal(trustBandText(69), 'Low trust');
  assert.equal(trustBandText(49), 'Critical / unreliable');
});

test('runtime quote matcher fails closed on paraphrases and ambiguity', () => {
  assert.equal(findTextQuote('The exact prose.', 'A paraphrase.'), null);
  assert.equal(findTextQuote('same and same', 'same'), null);
  assert.deepEqual(findTextQuote('same and same', 'same', 'and '), { start: 9, end: 13 });
});

test('build-time target highlighting is coordinated and cleanup is idempotent', () => {
  const classes = new Set();
  const target = {
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
    },
  };
  const doc = {
    getElementById: (id) => (id === 'stable-target' ? target : null),
  };
  const el = { ownerDocument: doc };

  const active = activateConcernedText(el, { targetAnchor: 'stable-target' });
  assert.equal(active.highlighted, true);
  assert.equal(classes.has('tc-is-highlighted'), true);
  active.cleanup();
  active.cleanup();
  assert.equal(classes.has('tc-is-highlighted'), false);
});

test('hover binds only to the score badge while focus binds to the full control', () => {
  class FakeEventTarget {
    constructor() {
      this.listeners = new Map();
    }

    addEventListener(type, listener) {
      const listeners = this.listeners.get(type) || new Set();
      listeners.add(listener);
      this.listeners.set(type, listeners);
    }

    removeEventListener(type, listener) {
      this.listeners.get(type)?.delete(listener);
    }

    emit(type) {
      for (const listener of this.listeners.get(type) || []) listener();
    }
  }

  const classes = new Set();
  const exactTarget = {
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
    },
  };
  const doc = {
    getElementById: (id) => (id === 'exact-target' ? exactTarget : null),
  };
  const el = { ownerDocument: doc };
  const control = new FakeEventTarget();
  const scoreBadge = new FakeEventTarget();
  const status = { textContent: '' };
  const cleanup = bindHighlightLifecycle(
    control,
    scoreBadge,
    el,
    { targetAnchor: 'exact-target' },
    status,
  );

  control.emit('mouseenter');
  assert.equal(classes.has('tc-is-highlighted'), false);

  scoreBadge.emit('mouseenter');
  assert.equal(classes.has('tc-is-highlighted'), true);
  assert.match(status.textContent, /exact text scored/);
  scoreBadge.emit('mouseleave');
  assert.equal(classes.has('tc-is-highlighted'), false);

  control.emit('focus');
  assert.equal(classes.has('tc-is-highlighted'), true);
  scoreBadge.emit('mouseenter');
  scoreBadge.emit('mouseleave');
  assert.equal(classes.has('tc-is-highlighted'), true);
  control.emit('blur');
  assert.equal(classes.has('tc-is-highlighted'), false);

  cleanup();
  scoreBadge.emit('mouseenter');
  control.emit('focus');
  assert.equal(classes.has('tc-is-highlighted'), false);
});

test('citation contexts expose verified passages and atom attribution', () => {
  const html = renderCitationContexts([{
    cite_key: 'Cardin2009',
    doi: '10.1038/nature08002',
    role: 'direct_support',
    source_type: 'primary',
    bibliography_status: 'verified',
    integrity_status: 'verified_no_known_issue',
    direction_match: true,
    supports_claim_atoms: ['a1', 'a2'],
    passages: [{
      text: 'Exact source text.',
      passage_source: 'abstract',
      locator: 'Abstract',
      verification_status: 'verified',
      supports_claim_atoms: ['a1'],
    }],
  }]);
  assert.match(html, /Exact source text\./);
  assert.match(html, /atoms a1/);
  assert.match(html, /Attributed claim atoms: a1, a2/);
  assert.match(html, /bibliography verified/);
});
