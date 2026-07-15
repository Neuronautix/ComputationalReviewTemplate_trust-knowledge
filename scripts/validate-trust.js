#!/usr/bin/env node

'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const RUBRIC_VERSION = '2.0.0';
const COMPONENTS = [
  'traceability',
  'robustness',
  'uncertainty_calibration',
  'source_integrity',
  'transferability_scope_control',
];
const CAP_REASONS = [
  'unsupported_citation',
  'direction_mismatch',
  'contradicted_without_caveat',
  'invented_reference',
  'missing_doi_empirical',
  'overextended_scope',
];
const SUPPORT_ROLES = new Set(['direct_support', 'partial_support']);
const ATTRIBUTION_TYPES = new Set(['methodological', 'definition']);

function exactText(value) {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
}

function normalizeClaim(value) {
  return exactText(value)
    .toLocaleLowerCase('en-US')
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function claimId(sectionId, claimText) {
  const preimage = `${sectionId}\n${exactText(claimText)}`;
  return `clm_${crypto.createHash('sha256').update(preimage, 'utf8').digest('hex').slice(0, 16)}`;
}

function labelFor(score) {
  if (score >= 85) return 'high_trust';
  if (score >= 70) return 'moderate_trust';
  if (score >= 50) return 'low_trust';
  return 'critical_or_unreliable';
}

function parseJson(root, relativePath, errors) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
  } catch (error) {
    errors.push(`${relativePath}: invalid or unreadable JSON (${error.message})`);
    return null;
  }
}

function schemaTypeMatches(value, type) {
  if (type === 'null') return value === null;
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === type;
}

function schemaPointer(schema, fragment) {
  if (!fragment || fragment === '#') return schema;
  return fragment.replace(/^#\//, '').split('/').reduce((current, token) => (
    current?.[token.replace(/~1/g, '/').replace(/~0/g, '~')]
  ), schema);
}

function validateSchema(value, schema, registry = {}, schemaName = '', location = '$') {
  if (!schema || typeof schema !== 'object') return [`${location}: invalid schema node`];
  if (schema.$ref) {
    const [filePart, fragment = ''] = schema.$ref.split('#');
    const targetName = filePart ? path.basename(filePart) : schemaName;
    const targetDocument = filePart ? registry[targetName] : registry[schemaName] || schema;
    const target = schemaPointer(targetDocument, fragment ? `#${fragment}` : '#');
    return target
      ? validateSchema(value, target, registry, targetName, location)
      : [`${location}: unresolved schema reference ${schema.$ref}`];
  }
  if (schema.anyOf) {
    const branchErrors = schema.anyOf.map((branch) => validateSchema(value, branch, registry, schemaName, location));
    return branchErrors.some((candidate) => candidate.length === 0)
      ? []
      : [`${location}: does not match any allowed schema`];
  }

  const errors = [];
  if (Object.hasOwn(schema, 'const') && !sameJson(value, schema.const)) errors.push(`${location}: must equal ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.some((candidate) => sameJson(value, candidate))) errors.push(`${location}: value is outside enum`);
  if (schema.type) {
    const allowedTypes = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!allowedTypes.some((type) => schemaTypeMatches(value, type))) {
      errors.push(`${location}: expected ${allowedTypes.join('|')}`);
      return errors;
    }
  }

  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const required of schema.required || []) {
      if (!Object.hasOwn(value, required)) errors.push(`${location}: missing required property ${required}`);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(schema.properties || {}, key)) errors.push(`${location}.${key}: additional property is not allowed`);
      }
    }
    for (const [key, childSchema] of Object.entries(schema.properties || {})) {
      if (Object.hasOwn(value, key)) errors.push(...validateSchema(value[key], childSchema, registry, schemaName, `${location}.${key}`));
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${location}: requires at least ${schema.minItems} item(s)`);
    if (schema.uniqueItems) {
      const serialized = value.map((item) => JSON.stringify(item));
      if (new Set(serialized).size !== serialized.length) errors.push(`${location}: items must be unique`);
    }
    if (schema.items) value.forEach((item, index) => errors.push(...validateSchema(item, schema.items, registry, schemaName, `${location}[${index}]`)));
  }

  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${location}: shorter than minLength ${schema.minLength}`);
    if (schema.pattern && !(new RegExp(schema.pattern, 'u')).test(value)) errors.push(`${location}: does not match ${schema.pattern}`);
    if (schema.format === 'date-time' && !Number.isFinite(Date.parse(value))) errors.push(`${location}: invalid date-time`);
    if (schema.format === 'uri') {
      try { new URL(value); } catch { errors.push(`${location}: invalid URI`); }
    }
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${location}: below minimum ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${location}: above maximum ${schema.maximum}`);
    if (schema.multipleOf !== undefined && Math.abs(value / schema.multipleOf - Math.round(value / schema.multipleOf)) > Number.EPSILON) {
      errors.push(`${location}: must be a multiple of ${schema.multipleOf}`);
    }
  }
  return errors;
}

function parseBibliography(text) {
  const entries = new Map();
  const entryPattern = /@[A-Za-z]+\s*\{\s*([^,\s]+)\s*,([\s\S]*?)(?=\n\s*@[A-Za-z]+\s*\{|\s*$)/g;
  for (const match of text.matchAll(entryPattern)) {
    const doiMatch = match[2].match(/\bdoi\s*=\s*[\{\"]([^\}\"]+)[\}\"]/i);
    const authorMatch = match[2].match(/\bauthor\s*=\s*\{([^\r\n]*)\}\s*,?\s*$/im);
    const authors = authorMatch
      ? authorMatch[1].split(/\s+and\s+/i).map((author) => exactText(author)).filter(Boolean)
      : [];
    entries.set(match[1], {
      doi: doiMatch ? doiMatch[1].trim().toLowerCase() : null,
      authors,
    });
  }
  return entries;
}

function canonicalAuthor(author) {
  return author
    .normalize('NFKD')
    .toLocaleLowerCase('en-US')
    .replace(/\\['"`^~=.]?/g, '')
    .replace(/[{}\p{P}\p{S}\s]+/gu, ' ')
    .trim();
}

function stripInlineMarkdown(text) {
  return text
    .replace(/\{cite(?::[a-z]+)?\}`[^`]+`/gi, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/<[^>]+>/g, '');
}

function contentParagraphs(markdown) {
  const withoutDirectives = markdown.replace(/:::\{trust-claim\}[\s\S]*?^:::\s*$/gm, '');
  return withoutDirectives
    .split(/\r?\n\s*\r?\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph && !/^(?:\([^\n]+\)=|#{1,6}\s|\*[^\n]+\*$)/.test(paragraph))
    .map((paragraph) => exactText(stripInlineMarkdown(paragraph)))
    .filter(Boolean);
}

function parseTrustDirectives(markdown) {
  const directives = [];
  const pattern = /:::\{trust-claim\}\s*\r?\n([\s\S]*?)^:::\s*$/gm;
  for (const block of markdown.matchAll(pattern)) {
    const options = {};
    for (const line of block[1].split(/\r?\n/)) {
      const match = line.match(/^:([a-z0-9-]+):\s*(.*?)\s*$/i);
      if (!match) continue;
      let value = match[2];
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      options[match[1]] = value;
    }
    directives.push(options);
  }
  return directives;
}

function isVerifiedPassage(passage) {
  const verifiedAt = Date.parse(passage.verified_at);
  return passage.verification_status === 'verified'
    && Boolean(passage.locator)
    && /^https:\/\//.test(passage.verification_source || '')
    && Number.isFinite(verifiedAt)
    && verifiedAt <= Date.now();
}

function verifiedPassage(context) {
  return Array.isArray(context.passages) && context.passages.some(isVerifiedPassage);
}

function isEligible(context) {
  return context.bibliography_status === 'verified'
    && context.integrity_status === 'verified_no_known_issue'
    && context.direction_match === true
    && SUPPORT_ROLES.has(context.role)
    && verifiedPassage(context)
    && Array.isArray(context.supports_claim_atoms)
    && context.supports_claim_atoms.length > 0;
}

function passageAtoms(context) {
  return new Set((context.passages || [])
    .filter(isVerifiedPassage)
    .flatMap((passage) => passage.supports_claim_atoms || []));
}

function coveredAtoms(contexts) {
  return new Set(contexts.flatMap((context) => [...passageAtoms(context)]));
}

function deriveEvidenceRelation(claim) {
  if (claim.scope_status === 'overextended') return 'overextended';
  if ((claim.conflicts || []).length > 0
      || claim.citation_contexts.some((context) => context.role === 'contradictory')) return 'conflicted';

  const atomIds = claim.claim_atoms.map((atom) => atom.atom_id);
  const eligibleCoverage = coveredAtoms(claim.citation_contexts.filter(isEligible));
  if (atomIds.length > 0 && atomIds.every((atomId) => eligibleCoverage.has(atomId))) {
    return 'directly_supported';
  }
  if (eligibleCoverage.size > 0) return 'partially_supported';

  const indirectContexts = claim.citation_contexts.filter((context) => (
    ['background', 'method_reference', 'review_context'].includes(context.role)
      || ['systematic_review', 'narrative_review'].includes(context.source_type)
  ) && context.bibliography_status === 'verified'
    && context.direction_match === true
    && verifiedPassage(context));
  if (coveredAtoms(indirectContexts).size > 0) return 'indirectly_supported';
  return 'unsupported';
}

function matchedMarkers(text, pattern) {
  return [...text.matchAll(pattern)].map((match) => match[0]);
}

function deriveWordingBasis(claim) {
  const contestedMarkers = matchedMarkers(
    claim.claim_text,
    /\b(?:contested|conflicting|inconsistent|mixed evidence|disagree(?:s|d)?|however)\b/giu,
  );
  if (contestedMarkers.length > 0) {
    return { wording_strength: 'contested', rule_id: 'SURFACE_CONFLICT', markers: contestedMarkers };
  }

  const attributionMarkers = matchedMarkers(
    claim.claim_text,
    /\b(?:propose|proposes|proposed|argue|argues|argued|reported|described|defined|introduced|added)\b/giu,
  );
  if (ATTRIBUTION_TYPES.has(claim.claim_type) && attributionMarkers.length > 0) {
    return { wording_strength: 'unqualified', rule_id: 'SURFACE_ATTRIBUTION', markers: attributionMarkers };
  }

  const qualifiedMarkers = matchedMarkers(
    claim.claim_text,
    /\b(?:indicate(?:s|d)?|suggest(?:s|ed)?|can|could|may|might|likely|possibly|appear(?:s|ed)?|seem(?:s|ed)?|uncertain)\b/giu,
  );
  if (qualifiedMarkers.length > 0) {
    return { wording_strength: 'qualified', rule_id: 'SURFACE_HEDGE', markers: qualifiedMarkers };
  }
  return { wording_strength: 'unqualified', rule_id: 'SURFACE_UNQUALIFIED', markers: [] };
}

function scoreTraceability(claim, bibliography) {
  const contextByKey = new Map(claim.citation_contexts.map((context) => [context.cite_key, context]));
  const unresolved = claim.citation_keys.length === 0
    || claim.citation_keys.some((key) => {
      const context = contextByKey.get(key);
      const bib = bibliography.get(key);
      return !context || !bib || !context.doi || !bib.doi
        || context.doi.toLowerCase() !== bib.doi
        || ['missing', 'mismatch', 'invented'].includes(context.bibliography_status);
    });
  if (unresolved) return [0, 'T0_UNRESOLVED'];

  const supporting = claim.citation_contexts.filter((context) => SUPPORT_ROLES.has(context.role));
  const eligible = supporting.filter(isEligible);
  if (eligible.length === 0) return [1, 'T1_METADATA_ONLY'];
  if (supporting.some((context) => !verifiedPassage(context))) return [2, 'T2_PARTIAL_RECORD'];

  const coverage = coveredAtoms(eligible);
  if (claim.claim_atoms.some((atom) => !coverage.has(atom.atom_id))) return [3, 'T3_ATOMS_INCOMPLETE'];
  return [4, 'T4_ATOM_LEVEL'];
}

function scoreRobustness(claim) {
  const eligible = claim.citation_contexts.filter(isEligible);
  const atomIds = claim.claim_atoms.map((atom) => atom.atom_id);
  const coverage = coveredAtoms(eligible);

  if (ATTRIBUTION_TYPES.has(claim.claim_type)) {
    if (eligible.length === 0) return [0, 'R0_ATTRIBUTION_UNSUPPORTED'];
    if (eligible.every((context) => context.source_type !== 'primary')) return [1, 'R1_ATTRIBUTION_INDIRECT'];
    if (atomIds.some((atomId) => !coverage.has(atomId))) return [2, 'R2_ATTRIBUTION_PARTIAL'];
    const oneOriginCoversAll = eligible.some((context) => context.source_type === 'primary'
      && context.role === 'direct_support'
      && atomIds.every((atomId) => passageAtoms(context).has(atomId)));
    if (!oneOriginCoversAll) return [3, 'R3_ATTRIBUTION_COMPLETE'];
    if (claim.conflicts.length === 0) return [4, 'R4_ORIGINATING_SOURCE'];
    return [3, 'R3_ATTRIBUTION_COMPLETE'];
  }

  if (eligible.length === 0) return [0, 'R0_NO_SUPPORT'];
  if (atomIds.some((atomId) => !coverage.has(atomId))) return [1, 'R1_SOME_ATOMS'];
  const groups = new Set(eligible.map((context) => context.independence_group).filter(Boolean));
  if (groups.size < 2) return [2, 'R2_SINGLE_GROUP'];
  const groupsByAtom = new Map(atomIds.map((atomId) => [atomId, new Set()]));
  for (const context of eligible) {
    if (!context.independence_group) continue;
    for (const atomId of passageAtoms(context)) groupsByAtom.get(atomId)?.add(context.independence_group);
  }
  if ([...groupsByAtom.values()].some((atomGroups) => atomGroups.size < 2)) return [3, 'R3_CONVERGENT'];
  if (claim.conflicts.length === 0) return [4, 'R4_REPLICATED_PER_ATOM'];
  return [3, 'R3_CONVERGENT'];
}

function scoreUncertainty(claim) {
  const relation = deriveEvidenceRelation(claim);
  if (claim.wording_strength !== deriveWordingBasis(claim).wording_strength) return [0, 'U0_OVERSTATED'];
  if (relation === 'directly_supported') return [4, 'U4_EXACT_CALIBRATION'];
  if (['partially_supported', 'indirectly_supported'].includes(relation) && claim.wording_strength === 'qualified') {
    return [3, 'U3_CALIBRATED'];
  }
  if (relation === 'conflicted' && claim.wording_strength === 'contested') return [2, 'U2_CONFLICT_DISCLOSED'];
  if (['unsupported', 'overextended'].includes(relation) && claim.wording_strength === 'qualified') return [1, 'U1_WEAK_HEDGE'];
  return [0, 'U0_OVERSTATED'];
}

function scoreSourceIntegrity(claim) {
  const relied = claim.citation_contexts.filter((context) => SUPPORT_ROLES.has(context.role));
  if (relied.some((context) => ['invented', 'mismatch'].includes(context.bibliography_status)
      || ['retracted', 'expression_of_concern'].includes(context.integrity_status)
      || context.direction_match === false)) return [0, 'S0_COMPROMISED'];
  if (relied.length === 0 || relied.some((context) => ['missing', 'unverified'].includes(context.bibliography_status) || !context.doi)) {
    return [1, 'S1_UNRESOLVED'];
  }
  if (relied.every((context) => context.integrity_status === 'not_checked')) return [2, 'S2_UNCHECKED'];
  if (relied.some((context) => context.integrity_status !== 'verified_no_known_issue' || context.source_type !== 'primary')) {
    return [3, 'S3_MIXED_CHECKS'];
  }
  if (relied.every((context) => verifiedPassage(context))) return [4, 'S4_VERIFIED_PRIMARY'];
  return [3, 'S3_MIXED_CHECKS'];
}

function scoreScope(claim) {
  if (claim.scope_status === 'overextended') return [0, 'X0_OVEREXTENDED'];
  if (claim.scope_status === 'unverified' || claim.citation_contexts.some((context) => SUPPORT_ROLES.has(context.role) && context.scope_match === 'unverified')) {
    return [1, 'X1_SCOPE_UNKNOWN'];
  }
  if (claim.scope_status === 'major_difference_qualified') return [2, 'X2_MAJOR_QUALIFIER'];
  if (claim.scope_status === 'minor_difference_qualified') return [3, 'X3_MINOR_QUALIFIER'];
  const eligible = claim.citation_contexts.filter(isEligible);
  if (claim.scope_status === 'matched' && eligible.every((context) => ['exact', 'not_applicable'].includes(context.scope_match))) {
    return [4, 'X4_SCOPE_MATCHED'];
  }
  return [1, 'X1_SCOPE_UNKNOWN'];
}

function deriveCapReasons(claim) {
  const contexts = claim.citation_contexts;
  const empirical = ['empirical', 'causal', 'comparative'].includes(claim.claim_type);
  const reasons = [];
  if (contexts.length === 0 || deriveEvidenceRelation(claim) === 'unsupported'
      || contexts.some((context) => context.role === 'unverified' || context.bibliography_status === 'missing')) {
    reasons.push('unsupported_citation');
  }
  if (contexts.some((context) => context.direction_match === false)) reasons.push('direction_mismatch');
  if (claim.conflicts.length && claim.wording_strength !== 'contested') reasons.push('contradicted_without_caveat');
  if (contexts.some((context) => context.bibliography_status === 'invented')) reasons.push('invented_reference');
  if (empirical && (claim.dois.length === 0 || contexts.some((context) => SUPPORT_ROLES.has(context.role) && !context.doi))) reasons.push('missing_doi_empirical');
  if (claim.scope_status === 'overextended') reasons.push('overextended_scope');
  return CAP_REASONS.filter((reason) => reasons.includes(reason));
}

function expectedScores(claim, bibliography) {
  return {
    traceability: scoreTraceability(claim, bibliography),
    robustness: scoreRobustness(claim),
    uncertainty_calibration: scoreUncertainty(claim),
    source_integrity: scoreSourceIntegrity(claim),
    transferability_scope_control: scoreScope(claim),
  };
}

function scoreBasis(claim) {
  const eligible = claim.citation_contexts.filter(isEligible);
  const atomSupport = Object.fromEntries(claim.claim_atoms.map((atom) => [
    atom.atom_id,
    eligible
      .filter((context) => passageAtoms(context).has(atom.atom_id))
      .map((context) => context.cite_key),
  ]));
  const independenceGroupsByAtom = Object.fromEntries(claim.claim_atoms.map((atom) => [
    atom.atom_id,
    [...new Set(eligible
      .filter((context) => passageAtoms(context).has(atom.atom_id))
      .map((context) => context.independence_group)
      .filter(Boolean))],
  ]));
  return {
    claim_text: claim.claim_text,
    eligible_citations: eligible.map((context) => ({
      cite_key: context.cite_key,
      doi: context.doi,
      role: context.role,
      source_type: context.source_type,
      supports_claim_atoms: context.supports_claim_atoms,
      verified_passage_locators: context.passages
        .filter(isVerifiedPassage)
        .map((passage) => passage.locator),
      independence_group: context.independence_group,
      scope_match: context.scope_match,
    })),
    atom_support: atomSupport,
    independence_groups_by_atom: independenceGroupsByAtom,
    derived_evidence_relation: deriveEvidenceRelation(claim),
    wording_strength: claim.wording_strength,
    wording_basis: deriveWordingBasis(claim),
    modality: claim.modality,
    scope_status: claim.scope_status,
  };
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validateRepository(root = path.resolve(__dirname, '..')) {
  const errors = [];
  const graph = parseJson(root, 'knowledge/claim_graph.json', errors);
  const seed = parseJson(root, 'knowledge/claim_seed_index.json', errors);
  const index = parseJson(root, 'knowledge/claim_index.json', errors);
  const report = parseJson(root, 'knowledge/trust_score_report.json', errors);
  const gate = parseJson(root, 'provenance/gate_trust_scores.json', errors);
  const example = parseJson(root, 'knowledge/examples/claim_context.example.json', errors);
  const claimSchema = parseJson(root, 'knowledge/schemas/claim_context.schema.json', errors);
  const graphSchema = parseJson(root, 'knowledge/schemas/claim_graph.schema.json', errors);
  const trustSchema = parseJson(root, 'knowledge/schemas/trust_score.schema.json', errors);
  if (!graph || !seed || !index || !report || !gate || !example || !claimSchema || !graphSchema || !trustSchema) {
    return { errors, claims: 0 };
  }

  const schemaRegistry = {
    'claim_context.schema.json': claimSchema,
    'claim_graph.schema.json': graphSchema,
    'trust_score.schema.json': trustSchema,
  };
  for (const schemaError of validateSchema(graph, graphSchema, schemaRegistry, 'claim_graph.schema.json')) {
    errors.push(`claim_graph schema: ${schemaError}`);
  }
  for (const schemaError of validateSchema(example, claimSchema, schemaRegistry, 'claim_context.schema.json')) {
    errors.push(`claim_context example schema: ${schemaError}`);
  }

  for (const [name, artifact] of [['graph', graph], ['index', index], ['report', report], ['gate', gate]]) {
    if (artifact.schema_version !== RUBRIC_VERSION) errors.push(`${name}: schema_version must be ${RUBRIC_VERSION}`);
    if (artifact.rubric_version !== RUBRIC_VERSION) errors.push(`${name}: rubric_version must be ${RUBRIC_VERSION}`);
  }
  if (seed.schema_version !== RUBRIC_VERSION) errors.push(`seed: schema_version must be ${RUBRIC_VERSION}`);

  const bibliographyPath = path.join(root, 'content/references.bib');
  const bibliography = parseBibliography(fs.readFileSync(bibliographyPath, 'utf8'));
  const claimIds = new Set();
  const contextCount = graph.claims.reduce((sum, claim) => sum + claim.citation_contexts.length, 0);
  const passageCount = graph.claims.reduce((sum, claim) => sum + claim.citation_contexts.reduce((inner, context) => inner + context.passages.filter(isVerifiedPassage).length, 0), 0);

  for (const claim of graph.claims) {
    const prefix = claim.claim_id || '<missing-id>';
    const expectedId = claimId(claim.section_id, claim.claim_text);
    if (claim.claim_id !== expectedId) errors.push(`${prefix}: deterministic ID should be ${expectedId}`);
    if (claimIds.has(claim.claim_id)) errors.push(`${prefix}: duplicate claim_id`);
    claimIds.add(claim.claim_id);
    if (claim.normalized_claim !== normalizeClaim(claim.claim_text)) errors.push(`${prefix}: normalized_claim mismatch`);
    if (!Array.isArray(claim.claim_atoms) || claim.claim_atoms.length === 0) errors.push(`${prefix}: claim_atoms must not be empty`);
    const atomIds = new Set();
    for (const atom of claim.claim_atoms || []) {
      if (atomIds.has(atom.atom_id)) errors.push(`${prefix}: duplicate atom ${atom.atom_id}`);
      atomIds.add(atom.atom_id);
      if (!claim.claim_text.includes(atom.text)) errors.push(`${prefix}: atom ${atom.atom_id} is not an exact claim_text substring`);
    }

    const contextKeys = claim.citation_contexts.map((context) => context.cite_key);
    const contextDois = claim.citation_contexts.map((context) => context.doi).filter(Boolean);
    if (new Set(claim.citation_keys).size !== claim.citation_keys.length) errors.push(`${prefix}: duplicate citation_keys`);
    if (new Set(contextKeys).size !== contextKeys.length) errors.push(`${prefix}: duplicate citation_context cite_key`);
    if (new Set(claim.dois.map((doi) => doi.toLowerCase())).size !== claim.dois.length) errors.push(`${prefix}: duplicate DOIs`);
    if (!sameJson(claim.citation_keys, contextKeys)) errors.push(`${prefix}: citation_keys must match citation_context order`);
    if (!sameJson(claim.dois, contextDois)) errors.push(`${prefix}: dois must match citation_context order`);
    for (const context of claim.citation_contexts) {
      const bib = bibliography.get(context.cite_key);
      if (!bib) errors.push(`${prefix}: citation ${context.cite_key} is absent from content/references.bib`);
      else if ((context.doi || '').toLowerCase() !== bib.doi) errors.push(`${prefix}: citation ${context.cite_key} DOI differs from bibliography`);
      for (const atomId of context.supports_claim_atoms || []) {
        if (!atomIds.has(atomId)) errors.push(`${prefix}: citation ${context.cite_key} references unknown atom ${atomId}`);
      }
      for (const passage of context.passages || []) {
        const words = exactText(passage.text).split(' ').length;
        if (words > 25) errors.push(`${prefix}: ${context.cite_key} passage exceeds 25 words (${words})`);
        if (!passage.locator) errors.push(`${prefix}: ${context.cite_key} passage lacks locator`);
        if (!Array.isArray(passage.supports_claim_atoms) || passage.supports_claim_atoms.length === 0) {
          errors.push(`${prefix}: ${context.cite_key} passage lacks atom attribution`);
        }
        for (const atomId of passage.supports_claim_atoms || []) {
          if (!atomIds.has(atomId)) errors.push(`${prefix}: ${context.cite_key} passage references unknown atom ${atomId}`);
        }
        if (passage.verification_status === 'verified') {
          if (typeof passage.verification_source !== 'string' || !/^https:\/\//.test(passage.verification_source)) {
            errors.push(`${prefix}: ${context.cite_key} verified passage requires an HTTPS verification_source`);
          }
          const verifiedAt = Date.parse(passage.verified_at);
          if (!Number.isFinite(verifiedAt) || verifiedAt > Date.now()) {
            errors.push(`${prefix}: ${context.cite_key} passage verified_at is invalid or in the future`);
          }
        }
      }
      const contextAtoms = [...new Set(context.supports_claim_atoms || [])].sort();
      const mappedPassageAtoms = [...passageAtoms(context)].sort();
      if (!sameJson(contextAtoms, mappedPassageAtoms)) {
        errors.push(`${prefix}: ${context.cite_key} context atoms must equal verified passage atom union`);
      }
      if (context.integrity_status === 'verified_no_known_issue') {
        const checked = Date.parse(context.integrity_checked_at);
        if (!Number.isFinite(checked) || checked > Date.now()) errors.push(`${prefix}: ${context.cite_key} integrity_checked_at is invalid or in the future`);
        if (typeof context.integrity_check_source !== 'string' || !/^https:\/\//.test(context.integrity_check_source)) {
          errors.push(`${prefix}: ${context.cite_key} verified integrity status requires an HTTPS integrity_check_source`);
        }
      }
      if (SUPPORT_ROLES.has(context.role) && !exactText(context.independence_basis || '')) {
        errors.push(`${prefix}: ${context.cite_key} supporting citation requires independence_basis`);
      }
    }

    const supportingContexts = claim.citation_contexts.filter((context) => SUPPORT_ROLES.has(context.role));
    for (let leftIndex = 0; leftIndex < supportingContexts.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < supportingContexts.length; rightIndex += 1) {
        const left = supportingContexts[leftIndex];
        const right = supportingContexts[rightIndex];
        if (!left.independence_group || !right.independence_group || left.independence_group === right.independence_group) continue;
        const leftAuthors = new Set((bibliography.get(left.cite_key)?.authors || []).map(canonicalAuthor));
        const sharedAuthors = (bibliography.get(right.cite_key)?.authors || [])
          .map(canonicalAuthor)
          .filter((author) => author && leftAuthors.has(author));
        if (sharedAuthors.length > 0) {
          errors.push(`${prefix}: ${left.cite_key} and ${right.cite_key} use different independence groups but share author(s): ${sharedAuthors.join(', ')}`);
        }
      }
    }

    const evidenceRelation = deriveEvidenceRelation(claim);
    if (claim.evidence_relation !== evidenceRelation) {
      errors.push(`${prefix}: evidence_relation should be derived as ${evidenceRelation}`);
    }
    const wordingBasis = deriveWordingBasis(claim);
    if (claim.wording_strength !== wordingBasis.wording_strength) {
      errors.push(`${prefix}: wording_strength should be ${wordingBasis.wording_strength} from ${wordingBasis.rule_id}`);
    }

    const expected = expectedScores(claim, bibliography);
    for (const component of COMPONENTS) {
      const stored = claim.trust_score.components[component];
      const [score, ruleId] = expected[component];
      if (!stored || stored.score !== score || stored.rule_id !== ruleId) {
        errors.push(`${prefix}: ${component} should be ${score}/${ruleId}`);
      }
    }
    const rawScore = 5 * COMPONENTS.reduce((sum, component) => sum + expected[component][0], 0);
    const capReasons = deriveCapReasons(claim);
    const overall = capReasons.length ? Math.min(rawScore, 60) : rawScore;
    const score = claim.trust_score;
    if (score.rubric_version !== RUBRIC_VERSION) errors.push(`${prefix}: trust_score rubric_version mismatch`);
    if (score.raw_score !== rawScore) errors.push(`${prefix}: raw_score should be ${rawScore}`);
    if (score.overall_score !== overall) errors.push(`${prefix}: overall_score should be ${overall}`);
    if (score.trust_label !== labelFor(overall)) errors.push(`${prefix}: trust_label should be ${labelFor(overall)}`);
    if (score.capped !== (capReasons.length > 0)) errors.push(`${prefix}: capped flag mismatch`);
    if (score.cap_value !== (capReasons.length ? 60 : null)) errors.push(`${prefix}: cap_value mismatch`);
    if (!sameJson(score.cap_reasons, capReasons)) errors.push(`${prefix}: cap_reasons mismatch`);
    if (score.cap_reason !== (capReasons[0] || null)) errors.push(`${prefix}: cap_reason mismatch`);
    if (score.computed_from !== 'validator') errors.push(`${prefix}: computed_from must be validator`);
    if (['high_trust', 'moderate_trust'].includes(score.trust_label) && claim.human_review_required) {
      errors.push(`${prefix}: high/moderate claim cannot require unresolved human review`);
    }

    const sourcePath = path.join(root, claim.source_file);
    if (!fs.existsSync(sourcePath)) {
      errors.push(`${prefix}: source_file does not exist`);
    } else {
      const markdown = fs.readFileSync(sourcePath, 'utf8');
      const paragraphs = contentParagraphs(markdown);
      const paragraph = paragraphs[claim.paragraph_index - 1];
      if (!paragraph || !paragraph.includes(claim.claim_text)) errors.push(`${prefix}: claim_text is not an exact excerpt of paragraph_index ${claim.paragraph_index}`);
      const directive = parseTrustDirectives(markdown).find((item) => item['claim-id'] === claim.claim_id);
      if (!directive) errors.push(`${prefix}: no matching trust-claim directive`);
      else {
        if (directive.claim !== claim.claim_text) errors.push(`${prefix}: directive claim is not exact`);
        const cites = (directive.cites || '').split(',').map((value) => value.trim()).filter(Boolean);
        if (!sameJson(cites, claim.citation_keys)) errors.push(`${prefix}: directive cites mismatch`);
        if (directive['claim-type'] !== claim.claim_type) errors.push(`${prefix}: directive claim-type mismatch`);
        if (directive.modality !== claim.modality) errors.push(`${prefix}: directive modality mismatch`);
        for (const forbidden of ['score', 'trust-label', 'cap-reason']) {
          if (Object.hasOwn(directive, forbidden)) errors.push(`${prefix}: directive must not contain writer-assigned :${forbidden}:`);
        }
      }
    }
  }

  for (const edge of graph.edges) {
    const claim = graph.claims.find((candidate) => candidate.claim_id === edge.source_claim_id);
    if (!claim) {
      errors.push(`edge: unknown source_claim_id ${edge.source_claim_id}`);
      continue;
    }
    const context = claim.citation_contexts.find((candidate) => candidate.cite_key === edge.target);
    if (edge.target_type === 'citation' && !context) errors.push(`edge: ${edge.source_claim_id} -> ${edge.target} lacks citation_context`);
    if (context) {
      const expectedRelation = context.role === 'direct_support' ? 'supports' : context.role === 'partial_support' ? 'partially_supports' : null;
      const expectedWeight = context.role === 'direct_support' ? 1 : context.role === 'partial_support' ? 0.5 : null;
      if (expectedRelation && (edge.relation !== expectedRelation || edge.weight !== expectedWeight)) {
        errors.push(`edge: ${edge.source_claim_id} -> ${edge.target} relation/weight mismatch`);
      }
    }
  }
  for (const claim of graph.claims) {
    for (const context of claim.citation_contexts.filter((candidate) => SUPPORT_ROLES.has(candidate.role))) {
      if (!graph.edges.some((edge) => edge.source_claim_id === claim.claim_id && edge.target === context.cite_key)) {
        errors.push(`${claim.claim_id}: missing graph edge for ${context.cite_key}`);
      }
    }
  }

  const expectedSummary = {
    total_claims: graph.claims.length,
    high_trust: graph.claims.filter((claim) => claim.trust_score.trust_label === 'high_trust').length,
    moderate_trust: graph.claims.filter((claim) => claim.trust_score.trust_label === 'moderate_trust').length,
    low_trust: graph.claims.filter((claim) => claim.trust_score.trust_label === 'low_trust').length,
    critical_or_unreliable: graph.claims.filter((claim) => claim.trust_score.trust_label === 'critical_or_unreliable').length,
    needs_human_review: graph.claims.filter((claim) => claim.human_review_required).length,
  };
  if (!sameJson(graph.summary, expectedSummary)) errors.push('claim_graph: summary mismatch');

  if (seed.claims.length !== graph.claims.length) errors.push('claim_seed_index: claim count mismatch');
  for (const claim of graph.claims) {
    const seeded = seed.claims.find((candidate) => candidate.claim_id === claim.claim_id);
    if (!seeded) errors.push(`claim_seed_index: missing ${claim.claim_id}`);
    else {
      for (const field of ['section_id', 'claim_text', 'normalized_claim', 'claim_type', 'modality', 'validation_status']) {
        if (seeded[field] !== claim[field]) errors.push(`claim_seed_index: ${claim.claim_id} ${field} mismatch`);
      }
      if (!sameJson(seeded.citation_keys, claim.citation_keys) || !sameJson(seeded.dois, claim.dois)) errors.push(`claim_seed_index: ${claim.claim_id} citation mismatch`);
    }

    const indexed = index.claims_by_id[claim.claim_id];
    if (!indexed) errors.push(`claim_index: missing ${claim.claim_id}`);
    else {
      const expectedIndex = {
        source_file: claim.source_file,
        section_id: claim.section_id,
        paragraph_index: claim.paragraph_index,
        sentence_index: claim.sentence_index,
        claim_text: claim.claim_text,
        citation_keys: claim.citation_keys,
        overall_score: claim.trust_score.overall_score,
        trust_label: claim.trust_score.trust_label,
        human_review_required: claim.human_review_required,
      };
      if (!sameJson(indexed, expectedIndex)) errors.push(`claim_index: ${claim.claim_id} record mismatch`);
    }

    const reported = report.claims.find((candidate) => candidate.claim_id === claim.claim_id);
    if (!reported) errors.push(`trust_score_report: missing ${claim.claim_id}`);
    else {
      const componentScores = Object.fromEntries(COMPONENTS.map((component) => [component, claim.trust_score.components[component].score]));
      const componentRules = Object.fromEntries(COMPONENTS.map((component) => [component, claim.trust_score.components[component].rule_id]));
      if (!sameJson(reported.component_scores, componentScores) || !sameJson(reported.component_rules, componentRules)) errors.push(`trust_score_report: ${claim.claim_id} component mismatch`);
      if (!sameJson(reported.score_basis, scoreBasis(claim))) errors.push(`trust_score_report: ${claim.claim_id} score_basis mismatch`);
      for (const field of ['raw_score', 'overall_score', 'trust_label', 'capped']) {
        if (reported[field] !== claim.trust_score[field]) errors.push(`trust_score_report: ${claim.claim_id} ${field} mismatch`);
      }
      if (!sameJson(reported.cap_reasons, claim.trust_score.cap_reasons)) errors.push(`trust_score_report: ${claim.claim_id} cap_reasons mismatch`);
    }
  }
  if (Object.keys(index.claims_by_id).length !== graph.claims.length) errors.push('claim_index: unexpected claim records');

  const scores = graph.claims.map((claim) => claim.trust_score.overall_score);
  const expectedReportSummary = {
    total_claims: graph.claims.length,
    mean_overall_score: scores.reduce((sum, score) => sum + score, 0) / scores.length,
    minimum_overall_score: Math.min(...scores),
    maximum_overall_score: Math.max(...scores),
    high_trust: expectedSummary.high_trust,
    moderate_trust: expectedSummary.moderate_trust,
    low_trust: expectedSummary.low_trust,
    critical_or_unreliable: expectedSummary.critical_or_unreliable,
    capped_claims: graph.claims.filter((claim) => claim.trust_score.capped).length,
    needs_human_review: expectedSummary.needs_human_review,
  };
  if (!sameJson(report.summary, expectedReportSummary)) errors.push('trust_score_report: summary mismatch');

  if (gate.status !== 'pass' || gate.failures.length !== 0) errors.push('gate_trust_scores: committed gate must be passing with no failures');
  if (Object.values(gate.checks).some((value) => value !== true)) errors.push('gate_trust_scores: all checks must be true');
  const expectedCounts = { claims: graph.claims.length, citation_contexts: contextCount, verified_passages: passageCount, failures: 0 };
  if (!sameJson(gate.counts, expectedCounts)) errors.push('gate_trust_scores: counts mismatch');

  return { errors, claims: graph.claims.length, citationContexts: contextCount, verifiedPassages: passageCount };
}

if (require.main === module) {
  const result = validateRepository();
  if (result.errors.length) {
    console.error(`TRUST validation failed (${result.errors.length} error${result.errors.length === 1 ? '' : 's'}):`);
    for (const error of result.errors) console.error(`- ${error}`);
    process.exitCode = 1;
  } else {
    console.log(`TRUST validation passed: ${result.claims} claims, ${result.citationContexts} citation contexts, ${result.verifiedPassages} verified passages.`);
  }
}

module.exports = {
  claimId,
  exactText,
  labelFor,
  normalizeClaim,
  parseBibliography,
  deriveEvidenceRelation,
  deriveWordingBasis,
  scoreRobustness,
  scoreBasis,
  isVerifiedPassage,
  validateSchema,
  validateRepository,
};
