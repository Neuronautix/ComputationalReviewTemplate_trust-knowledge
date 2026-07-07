import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

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
  },
  run(data) {
    return [{
      type: 'trust-claim',
      claimId: data.options?.['claim-id'] || null,
      claimText: data.options?.claim || '',
      cites: data.options?.cites || '',
      claimType: data.options?.['claim-type'] || '',
      modality: data.options?.modality || '',
      provisionalScore: data.options?.score || null,
      kbPath: data.options?.['kb-path'] || '../knowledge/claim_graph.json',
      interaction: data.options?.interaction || 'slideout',
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

const trustClaimTransform = {
  name: 'trust-claim-data-loader',
  stage: 'document',
  plugin: () => (tree, vfile) => {
    function transform(node) {
      if (!node) return;

      if (node.type === 'trust-claim') {
        const docDir = vfile?.path ? dirname(vfile.path) : process.cwd();
        const kbPath = resolve(docDir, node.kbPath || '../knowledge/claim_graph.json');

        let kbClaim = null;
        try {
          const kbRaw = readFileSync(kbPath, 'utf-8');
          const kb = JSON.parse(kbRaw);
          if (node.claimId && Array.isArray(kb.claims)) {
            kbClaim = kb.claims.find((c) => c.claim_id === node.claimId) || null;
          }
        } catch {
          kbClaim = null;
        }

        const claimText = kbClaim?.claim_text || node.claimText || '';
        const trustScore = kbClaim?.trust_score?.overall_score ?? (node.provisionalScore ? Number(node.provisionalScore) : null);
        const trustLabel = kbClaim?.trust_score?.trust_label || 'pending_validation';
        const evidenceRelation = kbClaim?.evidence_relation || 'unverified';
        const citationContexts = kbClaim?.citation_contexts || [];

        node.type = 'anywidget';
        node.id = `trust-claim-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        node.esm = './trust-claim-widget.mjs';
        node.css = './trust-claim-widget.css';
        node.model = {
          claimId: node.claimId || null,
          claimText,
          cites: JSON.stringify(kbClaim?.citation_keys || parseCiteList(node.cites)),
          claimType: kbClaim?.claim_type || node.claimType || '',
          modality: kbClaim?.modality || node.modality || '',
          trustScore: trustScore,
          trustLabel,
          evidenceRelation,
          citationContexts: JSON.stringify(citationContexts),
          rationale: kbClaim?.trust_score?.components || null,
          humanReviewRequired: kbClaim?.human_review_required || false,
          interactionMode: node.interaction || 'slideout',
        };
      }

      if (node.children) {
        for (const child of node.children) transform(child);
      }
    }

    transform(tree);
  },
};

export default {
  name: 'Trust Claim Plugin',
  directives: [trustClaimDirective],
  transforms: [trustClaimTransform],
};
