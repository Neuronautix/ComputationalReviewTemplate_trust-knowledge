#!/usr/bin/env node

'use strict';

// Dependency-free validator for the JSON Schema subset used by the public human
// submission and release manifest contracts. This is intentionally small enough
// to run in a bare template checkout. Production archive services should also
// validate the same schemas with a full Draft 2020-12 implementation.

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');

const ROOT = path.resolve(__dirname, '..');

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'));
}

function canonicalJsonSha256(relativePath) {
  const value = readJson(relativePath);
  const canonical = `${JSON.stringify(value, null, 2)}\n`;
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

function jsonType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value === 'number' ? 'number' : typeof value;
}

function resolvePointer(rootSchema, reference) {
  assert.match(reference, /^#\//, `only local JSON pointers are supported: ${reference}`);
  return reference.slice(2).split('/').reduce((value, rawToken) => {
    const token = rawToken.replaceAll('~1', '/').replaceAll('~0', '~');
    assert.ok(value && Object.hasOwn(value, token), `unresolved schema reference: ${reference}`);
    return value[token];
  }, rootSchema);
}

function isDateTime(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return false;
  return !Number.isNaN(Date.parse(value));
}

function isUri(value) {
  try {
    const parsed = new URL(value);
    return Boolean(parsed.protocol && parsed.href);
  } catch {
    return false;
  }
}

function validate(instance, schema, rootSchema, instancePath = '$', errors = []) {
  if (schema === true) return errors;
  if (schema === false) {
    errors.push(`${instancePath}: disallowed by schema`);
    return errors;
  }
  if (schema.$ref) return validate(instance, resolvePointer(rootSchema, schema.$ref), rootSchema, instancePath, errors);

  if (schema.allOf) {
    for (const part of schema.allOf) validate(instance, part, rootSchema, instancePath, errors);
  }
  if (schema.if) {
    const matchesIf = validate(instance, schema.if, rootSchema, instancePath, []).length === 0;
    if (matchesIf && schema.then) validate(instance, schema.then, rootSchema, instancePath, errors);
    if (!matchesIf && schema.else) validate(instance, schema.else, rootSchema, instancePath, errors);
  }
  if (schema.oneOf) {
    const matchingBranches = schema.oneOf.filter(
      (branch) => validate(instance, branch, rootSchema, instancePath, []).length === 0,
    ).length;
    if (matchingBranches !== 1) errors.push(`${instancePath}: expected exactly one oneOf match; got ${matchingBranches}`);
    return errors;
  }

  if (Object.hasOwn(schema, 'const') && !isDeepStrictEqual(instance, schema.const)) {
    errors.push(`${instancePath}: must equal ${JSON.stringify(schema.const)}`);
  }
  if (schema.enum && !schema.enum.some((allowed) => isDeepStrictEqual(instance, allowed))) {
    errors.push(`${instancePath}: must be one of ${schema.enum.map(JSON.stringify).join(', ')}`);
  }

  if (schema.type) {
    const allowedTypes = Array.isArray(schema.type) ? schema.type : [schema.type];
    const actualType = jsonType(instance);
    const typeMatches = allowedTypes.includes(actualType)
      || (actualType === 'integer' && allowedTypes.includes('number'));
    if (!typeMatches) {
      errors.push(`${instancePath}: expected ${allowedTypes.join('|')}; got ${actualType}`);
      return errors;
    }
  }

  if (typeof instance === 'string') {
    if (schema.minLength !== undefined && instance.length < schema.minLength) {
      errors.push(`${instancePath}: shorter than minLength ${schema.minLength}`);
    }
    if (schema.maxLength !== undefined && instance.length > schema.maxLength) {
      errors.push(`${instancePath}: longer than maxLength ${schema.maxLength}`);
    }
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(instance)) {
      errors.push(`${instancePath}: does not match ${schema.pattern}`);
    }
    if (schema.format === 'date-time' && !isDateTime(instance)) {
      errors.push(`${instancePath}: invalid date-time`);
    }
    if (schema.format === 'uri' && !isUri(instance)) {
      errors.push(`${instancePath}: invalid URI`);
    }
  }

  if (typeof instance === 'number') {
    if (schema.minimum !== undefined && instance < schema.minimum) {
      errors.push(`${instancePath}: below minimum ${schema.minimum}`);
    }
    if (schema.maximum !== undefined && instance > schema.maximum) {
      errors.push(`${instancePath}: above maximum ${schema.maximum}`);
    }
  }

  if (Array.isArray(instance)) {
    if (schema.minItems !== undefined && instance.length < schema.minItems) {
      errors.push(`${instancePath}: fewer than minItems ${schema.minItems}`);
    }
    if (schema.maxItems !== undefined && instance.length > schema.maxItems) {
      errors.push(`${instancePath}: more than maxItems ${schema.maxItems}`);
    }
    if (schema.uniqueItems) {
      for (let i = 0; i < instance.length; i += 1) {
        for (let j = i + 1; j < instance.length; j += 1) {
          if (isDeepStrictEqual(instance[i], instance[j])) errors.push(`${instancePath}: duplicate array items at ${i} and ${j}`);
        }
      }
    }
    if (schema.items) {
      instance.forEach((item, index) => validate(item, schema.items, rootSchema, `${instancePath}[${index}]`, errors));
    }
    if (schema.contains) {
      const matchingItems = instance.filter(
        (item) => validate(item, schema.contains, rootSchema, instancePath, []).length === 0,
      ).length;
      const minimum = schema.minContains ?? 1;
      const maximum = schema.maxContains ?? Number.POSITIVE_INFINITY;
      if (matchingItems < minimum || matchingItems > maximum) {
        errors.push(`${instancePath}: contains matched ${matchingItems} item(s); expected ${minimum}..${maximum}`);
      }
    }
  }

  if (instance && typeof instance === 'object' && !Array.isArray(instance)) {
    for (const key of schema.required || []) {
      if (!Object.hasOwn(instance, key)) errors.push(`${instancePath}: missing required property ${key}`);
    }
    for (const [key, value] of Object.entries(instance)) {
      if (schema.properties && Object.hasOwn(schema.properties, key)) {
        validate(value, schema.properties[key], rootSchema, `${instancePath}.${key}`, errors);
      } else if (schema.additionalProperties === false) {
        errors.push(`${instancePath}: unexpected property ${key}`);
      } else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        validate(value, schema.additionalProperties, rootSchema, `${instancePath}.${key}`, errors);
      }
    }
  }

  return errors;
}

function validateHumanSubmissionSemantics(submission) {
  const errors = [];
  const createdAt = Date.parse(submission.created_at);
  const receivedAt = Date.parse(submission.provenance?.received_at);
  const events = submission.moderation?.events || [];

  if (Number.isFinite(createdAt) && Number.isFinite(receivedAt) && receivedAt < createdAt) {
    errors.push('$.provenance.received_at: must not precede created_at');
  }
  if (events.length > 0 && events[0].event !== 'submitted') {
    errors.push('$.moderation.events[0].event: first event must be submitted');
  }

  let previousAt = Number.NEGATIVE_INFINITY;
  events.forEach((event, index) => {
    const eventAt = Date.parse(event.at);
    if (Number.isFinite(createdAt) && Number.isFinite(eventAt) && eventAt < createdAt) {
      errors.push(`$.moderation.events[${index}].at: must not precede created_at`);
    }
    if (Number.isFinite(eventAt) && eventAt < previousAt) {
      errors.push(`$.moderation.events[${index}].at: moderation events must be chronological`);
    }
    if (Number.isFinite(eventAt)) previousAt = eventAt;
  });

  const finalEventsByState = {
    submitted: new Set(['submitted']),
    screening: new Set(['screening_started']),
    quarantined: new Set(['quarantined']),
    admitted: new Set(['admitted', 'revision_requested']),
    accepted: new Set(['accepted', 'corrected']),
    rejected: new Set(['rejected']),
    withdrawn: new Set(['withdrawn']),
  };
  const state = submission.moderation?.state;
  const finalEvent = events.at(-1)?.event;
  if (finalEventsByState[state] && !finalEventsByState[state].has(finalEvent)) {
    errors.push(`$.moderation.state: ${state} is inconsistent with final event ${finalEvent || '<missing>'}`);
  }
  if (state === 'accepted' && !events.some((event) => event.event === 'accepted')) {
    errors.push('$.moderation.events: accepted state requires an accepted event');
  }
  return errors;
}

function validateReleaseManifestSemantics(release) {
  const errors = [];
  const artifacts = release.artifacts || [];
  const requiredRoles = ['html_bundle', 'claim_graph', 'trust_report', 'provenance'];
  const roles = new Set(artifacts.map((artifact) => artifact.role));
  for (const role of requiredRoles) {
    if (!roles.has(role)) errors.push(`$.artifacts: missing required ${role} artifact`);
  }

  const paths = artifacts.map((artifact) => artifact.path);
  if (new Set(paths).size !== paths.length) errors.push('$.artifacts: artifact paths must be unique');

  const acceptedRefs = release.human_review?.accepted_submissions || [];
  const acceptedKeys = acceptedRefs.map((ref) => `${ref.submission_id}@${ref.revision}`);
  if (new Set(acceptedKeys).size !== acceptedKeys.length) {
    errors.push('$.human_review.accepted_submissions: submission ID/revision pairs must be unique');
  }

  const generatedAt = Date.parse(release.integrity?.generated_at);
  const releasedAt = Date.parse(release.released_at);
  if (Number.isFinite(generatedAt) && Number.isFinite(releasedAt) && generatedAt > releasedAt) {
    errors.push('$.integrity.generated_at: must not be later than released_at');
  }
  return errors;
}

function validateContract(instance, schema) {
  const errors = validate(instance, schema, schema);
  if (schema.title === 'Public human submission for a computational review') {
    errors.push(...validateHumanSubmissionSemantics(instance));
  } else if (schema.title === 'Computational review release manifest') {
    errors.push(...validateReleaseManifestSemantics(instance));
  }
  return errors;
}

function auditSchema(schema, rootSchema, schemaPath = '$', seen = new Set()) {
  if (!schema || typeof schema !== 'object' || seen.has(schema)) return;
  seen.add(schema);
  if (schema.$ref) resolvePointer(rootSchema, schema.$ref);
  if (schema.pattern) new RegExp(schema.pattern, 'u');
  for (const [key, child] of Object.entries(schema)) {
    if (key === 'examples' || key === 'default' || key === 'const' || key === 'enum') continue;
    if (Array.isArray(child)) child.forEach((part, index) => auditSchema(part, rootSchema, `${schemaPath}.${key}[${index}]`, seen));
    else if (child && typeof child === 'object') auditSchema(child, rootSchema, `${schemaPath}.${key}`, seen);
  }
}

function assertValid(label, value, schema) {
  const errors = validateContract(value, schema);
  assert.deepEqual(errors, [], `${label} should be valid:\n${errors.join('\n')}`);
}

function assertInvalid(label, value, schema) {
  const errors = validateContract(value, schema);
  assert.ok(errors.length > 0, `${label} should be invalid`);
}

function clone(value) {
  return structuredClone(value);
}

const contracts = [
  {
    name: 'human submission',
    schemaPath: 'community/schemas/human_submission.schema.json',
    examplePath: 'community/examples/human_submission.example.json',
  },
  {
    name: 'release manifest',
    schemaPath: 'community/schemas/release_manifest.schema.json',
    examplePath: 'community/examples/release_manifest.example.json',
  },
];

for (const contract of contracts) {
  contract.schema = readJson(contract.schemaPath);
  contract.example = readJson(contract.examplePath);
  assert.equal(contract.schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  auditSchema(contract.schema, contract.schema);
  assertValid(`${contract.name} example`, contract.example, contract.schema);
  console.log(`PASS ${contract.examplePath}`);
}

const human = contracts[0];
const release = contracts[1];
const exampleAcceptedRef = release.example.human_review.accepted_submissions.find(
  (ref) => ref.submission_id === human.example.submission_id && ref.revision === human.example.revision,
);
assert.ok(exampleAcceptedRef, 'release example must reference the exact human submission example revision');
assert.equal(
  exampleAcceptedRef.sha256,
  canonicalJsonSha256(contracts[0].examplePath),
  'release example accepted-submission digest must match canonical JSON',
);

const noConsent = clone(human.example);
noConsent.declarations.public_record_consent = false;
assertInvalid('submission without public-record consent', noConsent, human.schema);

const legacyClaimId = clone(human.example);
legacyClaimId.target.selector.claim_id = 'claim-example-001';
assertInvalid('submission with noncanonical claim ID', legacyClaimId, human.schema);

const missingRecommendation = clone(human.example);
delete missingRecommendation.content.recommendation;
assertInvalid('peer review without recommendation', missingRecommendation, human.schema);

const publicEmail = clone(human.example);
publicEmail.submitter.email = 'private@example.org';
assertInvalid('public submission containing an email field', publicEmail, human.schema);

const unsafeTextPath = clone(human.example);
unsafeTextPath.target.selector = {
  kind: 'text',
  source_path: 'content/../private.md',
  source_sha256: '7'.repeat(64),
  exact_quote: 'Example text',
};
assertInvalid('text selector with path traversal', unsafeTextPath, human.schema);

const undisclosedAi = clone(human.example);
undisclosedAi.declarations.ai_assistance.used = true;
assertInvalid('AI-assisted submission without disclosure', undisclosedAi, human.schema);

const inconsistentModeration = clone(human.example);
inconsistentModeration.moderation.state = 'accepted';
inconsistentModeration.moderation.events = [inconsistentModeration.moderation.events[0]];
assertInvalid('accepted submission without accepted event', inconsistentModeration, human.schema);

const outOfOrderModeration = clone(human.example);
outOfOrderModeration.moderation.events[1].at = '2026-07-15T09:00:00Z';
assertInvalid('submission with out-of-order moderation events', outOfOrderModeration, human.schema);

const receivedBeforeCreated = clone(human.example);
receivedBeforeCreated.provenance.received_at = '2026-07-15T09:00:00Z';
assertInvalid('submission received before it was created', receivedBeforeCreated, human.schema);

const unsafeArtifact = clone(release.example);
unsafeArtifact.artifacts[0].path = '../private.tar.gz';
assertInvalid('release with unsafe artifact path', unsafeArtifact, release.schema);

const shortCommit = clone(release.example);
shortCommit.source.commit = 'abc123';
assertInvalid('release with abbreviated commit', shortCommit, release.schema);

const duplicateInputs = clone(release.example);
duplicateInputs.human_review.accepted_submissions = [
  clone(release.example.human_review.accepted_submissions[0]),
  clone(release.example.human_review.accepted_submissions[0]),
];
duplicateInputs.human_review.accepted_submissions[1].sha256 = 'a'.repeat(64);
assertInvalid('release with duplicate accepted submission revisions', duplicateInputs, release.schema);

const mutableSubmissionRef = clone(release.example);
delete mutableSubmissionRef.human_review.accepted_submissions[0].sha256;
assertInvalid('release with an unhashed accepted submission revision', mutableSubmissionRef, release.schema);

const missingCoreArtifact = clone(release.example);
missingCoreArtifact.artifacts = missingCoreArtifact.artifacts.filter((artifact) => artifact.role !== 'trust_report');
assertInvalid('release without a core TRUST report artifact', missingCoreArtifact, release.schema);

const duplicateArtifactPath = clone(release.example);
duplicateArtifactPath.artifacts[1].path = duplicateArtifactPath.artifacts[0].path;
assertInvalid('release with duplicate artifact paths', duplicateArtifactPath, release.schema);

const generatedAfterRelease = clone(release.example);
generatedAfterRelease.integrity.generated_at = '2026-07-15T15:00:01Z';
assertInvalid('release generated after released_at', generatedAfterRelease, release.schema);

console.log('Community contract validator tests passed.');

module.exports = {
  auditSchema,
  validate,
  validateContract,
  validateHumanSubmissionSemantics,
  validateReleaseManifestSemantics,
};
