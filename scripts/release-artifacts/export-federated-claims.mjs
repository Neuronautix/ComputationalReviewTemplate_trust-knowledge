#!/usr/bin/env node

import { pathToFileURL } from 'node:url';
import {
  compareText,
  invariant,
  parseArgs,
  readJson,
  sha256File,
  stableJson,
  unique,
  validateFrozenTrustReport,
  validateSnapshot,
  writeText,
} from './lib.mjs';

const RELATIONS = {
  supports: 'cito:supports',
  contradicts: 'cito:disagreesWith',
  qualifies: 'comprev:qualifies',
};

function claimUri(baseUri, snapshot, claimId) {
  return `${baseUri.replace(/\/$/u, '')}/reviews/${snapshot.release.review_id}/versions/${snapshot.release.version}/claims/${claimId}`;
}

export function exportFederatedClaims(snapshotInput, options = {}) {
  const snapshot = validateSnapshot(snapshotInput, 'snapshot');
  const baseUri = options.base_uri;
  invariant(typeof baseUri === 'string' && /^https:\/\//u.test(baseUri), 'base_uri must be HTTPS');
  const snapshotDigest = options.snapshot_sha256;
  invariant(/^[a-f0-9]{64}$/u.test(snapshotDigest), 'snapshot_sha256 is invalid');
  invariant(/^[a-f0-9]{64}$/u.test(options.verified_trust_report_sha256), 'verified_trust_report_sha256 is invalid');
  invariant(snapshot.claims.every((claim) => claim.trust.report_sha256 === options.verified_trust_report_sha256), 'snapshot does not reference the verified TRUST report');
  const nanopublications = [...snapshot.claims]
    .sort((a, b) => compareText(a.claim_id, b.claim_id))
    .map((claim) => {
      const uri = claimUri(baseUri, snapshot, claim.claim_id);
      const assertionId = `${uri}#assertion`;
      const provenanceId = `${uri}#provenance`;
      const publicationInfoId = `${uri}#publication-info`;
      const citationNodes = claim.evidence_basis.eligible_citations || [];
      return {
        '@id': uri,
        '@type': 'np:Nanopublication',
        'np:hasAssertion': {
          '@id': assertionId,
          '@graph': [
            {
              '@id': `${uri}#claim`,
              '@type': 'schema:Claim',
              'schema:identifier': claim.claim_id,
              'schema:text': claim.claim_text,
              'comprev:citationKey': claim.citation_keys,
              'comprev:evidenceRelation': claim.evidence_basis.derived_evidence_relation || null,
              'comprev:trustOverall': claim.trust.overall_score,
              'comprev:trustLabel': claim.trust.trust_label,
              'comprev:trustComponents': claim.trust.component_scores,
              'cito:isSupportedBy': citationNodes.map((citation) => ({
                '@id': citation.doi ? `https://doi.org/${citation.doi}` : `urn:citekey:${citation.cite_key}`,
              })),
            },
            ...claim.relations.map((relation) => ({
              '@id': `${uri}#claim`,
              [RELATIONS[relation.predicate]]: {
                '@id': `${claimUri(baseUri, snapshot, relation.target_claim_id)}#claim`,
              },
            })),
          ],
        },
        'np:hasProvenance': {
          '@id': provenanceId,
          '@graph': [
            {
              '@id': assertionId,
              'prov:wasDerivedFrom': [
                { '@id': `urn:sha256:${snapshot.release.manifest_sha256}` },
                { '@id': `urn:sha256:${snapshotDigest}` },
                { '@id': `urn:sha256:${claim.source.sha256}` },
                { '@id': `urn:sha256:${claim.trust.report_sha256}` },
              ],
              'prov:hadPrimarySource': { '@id': claim.source.path },
              'comprev:releaseId': snapshot.release.release_id,
            },
          ],
        },
        'np:hasPublicationInfo': {
          '@id': publicationInfoId,
          '@graph': [
            {
              '@id': uri,
              'dcterms:created': snapshot.release.frozen_at,
              'dcterms:identifier': uri,
              'dcterms:isVersionOf': `${baseUri.replace(/\/$/u, '')}/reviews/${snapshot.release.review_id}`,
              'schema:version': snapshot.release.version,
              'comprev:humanDecisionReference': claim.human_decision_references,
              'prov:wasAttributedTo': { '@id': 'https://w3id.org/computational-review/software/release-artifacts' },
            },
          ],
        },
      };
    });
  return {
    '@context': {
      np: 'http://www.nanopub.org/nschema#',
      prov: 'http://www.w3.org/ns/prov#',
      cito: 'http://purl.org/spar/cito/',
      dcterms: 'http://purl.org/dc/terms/',
      schema: 'https://schema.org/',
      comprev: 'https://w3id.org/computational-review/terms/',
    },
    '@id': `${baseUri.replace(/\/$/u, '')}/reviews/${snapshot.release.review_id}/versions/${snapshot.release.version}/claims`,
    '@type': 'schema:Dataset',
    'schema:version': snapshot.release.version,
    'dcterms:created': snapshot.release.frozen_at,
    'prov:wasDerivedFrom': { '@id': `urn:sha256:${snapshotDigest}` },
    '@graph': nanopublications,
  };
}

export function validateFederatedClaimExport(exported) {
  invariant(exported?.['@context']?.np && exported?.['@context']?.prov, 'claim export lacks RDF contexts');
  invariant(Array.isArray(exported['@graph']), 'claim export @graph must be an array');
  unique(exported['@graph'].map((nanopub) => nanopub['@id']), 'nanopublication IDs');
  for (const nanopub of exported['@graph']) {
    invariant(nanopub['@type'] === 'np:Nanopublication', `${nanopub['@id']} is not a nanopublication`);
    invariant(Array.isArray(nanopub['np:hasAssertion']?.['@graph']), `${nanopub['@id']} lacks an assertion graph`);
    invariant(Array.isArray(nanopub['np:hasProvenance']?.['@graph']), `${nanopub['@id']} lacks a provenance graph`);
    invariant(Array.isArray(nanopub['np:hasPublicationInfo']?.['@graph']), `${nanopub['@id']} lacks publication info`);
  }
  return exported;
}

function main() {
  const args = parseArgs(process.argv.slice(2), ['snapshot', 'trust-report', 'base-uri', 'output']);
  const snapshot = readJson(args.snapshot);
  const trustReportDigest = sha256File(args['trust-report']);
  validateFrozenTrustReport(snapshot, readJson(args['trust-report']), trustReportDigest);
  const exported = exportFederatedClaims(snapshot, {
    base_uri: args['base-uri'],
    snapshot_sha256: sha256File(args.snapshot),
    verified_trust_report_sha256: trustReportDigest,
  });
  validateFederatedClaimExport(exported);
  writeText(args.output, stableJson(exported));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
