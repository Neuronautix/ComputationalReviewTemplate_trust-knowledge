import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

function optionText(value) {
  const text = String(value || '').trim();
  if (text.length >= 2) {
    const first = text[0];
    const last = text[text.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return text.slice(1, -1);
    }
  }
  return text;
}

const trustClaimDirective = {
  name: 'trust-claim',
  doc: 'Render a claim-level TRUST margin tag with expandable evidence context.',
  options: {
    'claim-id': { type: String },
    claim: { type: String },
    cites: { type: String },
    'claim-type': { type: String },
    modality: { type: String },
    score: { type: String },
    'kb-path': { type: String },
    interaction: { type: String },
    // W3C TextQuoteSelector-style fields. `quote` is the exact prose to mark;
    // prefix/suffix disambiguate repeated text without becoming highlighted.
    quote: { type: String },
    prefix: { type: String },
    suffix: { type: String },
    // An explicit element id is useful when the concerned text is already
    // wrapped by the author. Without a quote, that element is the exact target.
    'target-id': { type: String },
  },
  run(data) {
    return [{
      type: 'trust-claim',
      claimId: data.options?.['claim-id'] || null,
      claimText: optionText(data.options?.claim),
      cites: data.options?.cites || '',
      claimType: data.options?.['claim-type'] || '',
      modality: data.options?.modality || '',
      provisionalScore: data.options?.score || null,
      kbPath: data.options?.['kb-path'] || '../knowledge/claim_graph.json',
      interaction: data.options?.interaction || 'slideout',
      quote: optionText(data.options?.quote),
      prefix: optionText(data.options?.prefix),
      suffix: optionText(data.options?.suffix),
      targetId: optionText(data.options?.['target-id']),
    }];
  },
};

function parseCiteList(citesRaw) {
  if (!citesRaw) return [];
  return String(citesRaw)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function normalizeCharacter(character) {
  if (/\s/u.test(character)) return ' ';
  if (/[\u2018\u2019\u201A\u201B]/u.test(character)) return "'";
  if (/[\u201C\u201D\u201E\u201F]/u.test(character)) return '"';
  if (/[\u2010-\u2015\u2212]/u.test(character)) return '-';
  if (character === '\u00AD') return '';
  return character.normalize('NFKC');
}

/** Normalize typography/whitespace while retaining offsets into source text. */
export function normalizeTextWithMap(value) {
  const source = String(value || '');
  let text = '';
  const starts = [];
  const ends = [];

  for (let rawStart = 0; rawStart < source.length;) {
    const codePoint = source.codePointAt(rawStart);
    const character = String.fromCodePoint(codePoint);
    const rawEnd = rawStart + character.length;
    const normalized = normalizeCharacter(character);

    for (const outputCharacter of normalized) {
      if (outputCharacter === ' ' && text.endsWith(' ')) {
        ends[ends.length - 1] = rawEnd;
        continue;
      }
      text += outputCharacter;
      starts.push(rawStart);
      ends.push(rawEnd);
    }
    rawStart = rawEnd;
  }

  return { text, starts, ends };
}

function normalizedSelector(value) {
  return normalizeTextWithMap(value).text.trim();
}

/**
 * Resolve a unique TextQuoteSelector against plain text. Ambiguous or missing
 * selectors intentionally return null rather than selecting a whole paragraph.
 */
export function findTextQuote(text, quote, prefix = '', suffix = '') {
  const haystack = normalizeTextWithMap(text);
  const exact = normalizedSelector(quote);
  if (!exact) return null;

  const before = normalizedSelector(prefix);
  const after = normalizedSelector(suffix);
  const matches = [];
  let from = 0;

  while (from <= haystack.text.length - exact.length) {
    const index = haystack.text.indexOf(exact, from);
    if (index === -1) break;
    const prefixMatches = !before || haystack.text.slice(0, index).trimEnd().endsWith(before);
    const suffixMatches = !after || haystack.text.slice(index + exact.length).trimStart().startsWith(after);
    if (prefixMatches && suffixMatches) matches.push(index);
    from = index + 1;
  }

  if (matches.length !== 1) return null;
  const normalizedStart = matches[0];
  return {
    start: haystack.starts[normalizedStart],
    end: haystack.ends[normalizedStart + exact.length - 1],
  };
}

function textContent(node) {
  if (!node || typeof node !== 'object') return '';
  if (typeof node.value === 'string') return node.value;
  if (!Array.isArray(node.children)) return '';
  return node.children.map(textContent).join('');
}

function cloneWithChildren(node, children) {
  if (children.length === 0) return null;
  return { ...node, children };
}

/** Split an inline AST node into before/selected/after fragments. */
function splitInlineNode(node, selectionStart, selectionEnd) {
  if (typeof node?.value === 'string') {
    const length = node.value.length;
    const start = Math.max(0, Math.min(length, selectionStart));
    const end = Math.max(start, Math.min(length, selectionEnd));
    const make = (value) => (value ? { ...node, value } : null);
    return [
      make(node.value.slice(0, start)),
      make(node.value.slice(start, end)),
      make(node.value.slice(end)),
    ];
  }

  if (!Array.isArray(node?.children)) return [node, null, null];

  const buckets = [[], [], []];
  let offset = 0;
  for (const child of node.children) {
    const length = textContent(child).length;
    const parts = splitInlineNode(child, selectionStart - offset, selectionEnd - offset);
    parts.forEach((part, index) => {
      if (part) buckets[index].push(part);
    });
    offset += length;
  }

  return buckets.map((children) => cloneWithChildren(node, children));
}

function wrapParagraphSelection(paragraph, range, targetAnchor) {
  const synthetic = { type: 'span', children: paragraph.children || [] };
  const [before, selected, after] = splitInlineNode(synthetic, range.start, range.end);
  if (!selected?.children?.length) return false;

  paragraph.children = [
    ...(before?.children || []),
    {
      type: 'span',
      identifier: targetAnchor,
      class: 'trust-claim-target',
      children: selected.children,
    },
    ...(after?.children || []),
  ];
  return true;
}

function wrapParagraphScope(paragraph, scopeAnchor) {
  paragraph.children = [{
    type: 'span',
    identifier: scopeAnchor,
    class: 'trust-claim-scope',
    children: paragraph.children || [],
  }];
}

function stableToken(value, fallback) {
  const normalized = String(value || '')
    .toLowerCase()
    // MyST normalizes identifiers before emitting their html_id. Restricting
    // ourselves to the same safe alphabet keeps model and DOM ids identical.
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

function loadKbClaim(node, docDir) {
  const kbPath = resolve(docDir, node.kbPath || '../knowledge/claim_graph.json');
  try {
    const kb = JSON.parse(readFileSync(kbPath, 'utf-8'));
    if (node.claimId && Array.isArray(kb.claims)) {
      return kb.claims.find((claim) => claim.claim_id === node.claimId) || null;
    }
  } catch {
    // Missing/incomplete knowledge data renders as an unverified claim card.
  }
  return null;
}

function selectorFrom(node, kbClaim) {
  const kbSelector = kbClaim?.text_quote_selector || kbClaim?.selector || {};
  return {
    quote: node.quote || kbSelector.exact || kbSelector.quote || '',
    prefix: node.prefix || kbSelector.prefix || '',
    suffix: node.suffix || kbSelector.suffix || '',
    targetId: node.targetId || kbSelector.target_id || kbSelector.targetId || '',
  };
}

function previousParagraph(children, claimIndex) {
  for (let index = claimIndex - 1; index >= 0; index -= 1) {
    const candidate = children[index];
    if (candidate?.type === 'paragraph') return candidate;
    if (candidate?.type !== 'trust-claim' && candidate?.class !== 'trust-claim-aside') return null;
  }
  return null;
}

export function createTrustClaimTransform() {
  return (tree, vfile) => {
    const docDir = vfile?.path ? dirname(vfile.path) : process.cwd();
    let occurrence = 0;

    function toAnywidget(node, kbClaim, targeting) {
      const claimText = kbClaim?.claim_text || node.claimText || '';
      const trustScore = kbClaim?.trust_score?.overall_score ?? (node.provisionalScore ? Number(node.provisionalScore) : null);
      const trustLabel = kbClaim?.trust_score?.trust_label || 'pending_validation';
      const evidenceRelation = kbClaim?.evidence_relation || 'unverified';
      const citationContexts = kbClaim?.citation_contexts || [];

      return {
        type: 'anywidget',
        id: `${targeting.targetAnchor || targeting.scopeAnchor || `trust-claim-${occurrence}`}-widget`,
        class: 'trust-claim-widget',
        esm: './trust-claim-widget.mjs',
        css: './trust-claim-widget.css',
        model: {
          claimId: node.claimId || null,
          claimText,
          cites: JSON.stringify(kbClaim?.citation_keys || parseCiteList(node.cites)),
          claimType: kbClaim?.claim_type || node.claimType || '',
          modality: kbClaim?.modality || node.modality || '',
          trustScore,
          trustLabel,
          evidenceRelation,
          citationContexts: JSON.stringify(citationContexts),
          rationale: kbClaim?.trust_score?.components || null,
          humanReviewRequired: kbClaim?.human_review_required || false,
          interactionMode: node.interaction || 'slideout',
          targetAnchor: targeting.targetAnchor || '',
          scopeAnchor: targeting.scopeAnchor || '',
          targetId: targeting.targetId || '',
          quote: targeting.quote || '',
          prefix: targeting.prefix || '',
          suffix: targeting.suffix || '',
        },
      };
    }

    function walk(node) {
      if (!node || !Array.isArray(node.children)) return;
      for (let index = 0; index < node.children.length; index += 1) {
        const child = node.children[index];
        if (!child) continue;
        if (child.type !== 'trust-claim') {
          walk(child);
          continue;
        }

        occurrence += 1;
        const kbClaim = loadKbClaim(child, docDir);
        const selector = selectorFrom(child, kbClaim);
        const token = stableToken(child.claimId, `claim-${occurrence}`);
        const generatedTarget = `trust-claim-target-${token}`;
        const generatedScope = `trust-claim-scope-${token}`;
        const paragraph = previousParagraph(node.children, index);
        const fallbackQuote = selector.quote || child.claimText || kbClaim?.claim_text || '';
        const targeting = {
          ...selector,
          quote: fallbackQuote,
          targetAnchor: '',
          scopeAnchor: '',
        };

        if (selector.targetId) {
          // The author explicitly owns this anchor; do not rewrite nearby prose.
          targeting.targetId = selector.targetId;
          targeting.quote = selector.quote;
        } else if (paragraph) {
          const range = findTextQuote(textContent(paragraph), fallbackQuote, selector.prefix, selector.suffix);
          if (range && wrapParagraphSelection(paragraph, range, generatedTarget)) {
            targeting.targetAnchor = generatedTarget;
          } else {
            // A scope is an address, not a highlight. Runtime still requires a
            // unique quote match and will fail closed if the claim is paraphrased.
            wrapParagraphScope(paragraph, generatedScope);
            targeting.scopeAnchor = generatedScope;
          }
        }

        node.children[index] = {
          type: 'aside',
          kind: 'margin',
          class: 'trust-claim-aside',
          children: [toAnywidget(child, kbClaim, targeting)],
        };
      }
    }

    walk(tree);
  };
}

const trustClaimTransform = {
  name: 'trust-claim-data-loader',
  stage: 'document',
  plugin: createTrustClaimTransform,
};

export default {
  name: 'Trust Claim Plugin',
  directives: [trustClaimDirective],
  transforms: [trustClaimTransform],
};
