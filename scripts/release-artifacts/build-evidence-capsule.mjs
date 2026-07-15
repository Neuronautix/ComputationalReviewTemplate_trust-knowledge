#!/usr/bin/env node

import { statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  SHA256_PATTERN,
  compareText,
  invariant,
  isObject,
  parseArgs,
  readJson,
  safeRelativePath,
  sha256File,
  stableJson,
  unique,
  validateReleaseRef,
  writeText,
} from './lib.mjs';

const ROLE_TYPES = {
  code: ['File', 'SoftwareSourceCode'],
  data: ['File', 'Dataset'],
  environment: ['File', 'SoftwareApplication'],
  output: ['File', 'CreativeWork'],
};

const ACTION_STATUS = {
  passed: 'https://schema.org/CompletedActionStatus',
  failed: 'https://schema.org/FailedActionStatus',
  blocked: 'https://schema.org/PotentialActionStatus',
};

export function validateCapsuleDescriptor(descriptor) {
  invariant(isObject(descriptor), 'capsule descriptor must be an object');
  invariant(descriptor.schema_version === '1.0.0', 'capsule descriptor schema_version must be 1.0.0');
  invariant(/^capsule-[a-z0-9][a-z0-9-]{7,95}$/u.test(descriptor.capsule_id), 'capsule_id is invalid');
  validateReleaseRef(descriptor.release, 'release');
  invariant(Number.isFinite(Date.parse(descriptor.created_at)), 'created_at is invalid');
  invariant(Date.parse(descriptor.created_at) <= Date.parse(descriptor.release.frozen_at), 'created_at must not be later than the frozen release');
  invariant(/^https:\/\//u.test(descriptor.license), 'license must be an HTTPS URI');
  invariant(Object.hasOwn(ACTION_STATUS, descriptor.status), 'status must be passed, failed, or blocked');
  invariant(isObject(descriptor.execution), 'execution must be an object');
  invariant(Array.isArray(descriptor.execution.command) && descriptor.execution.command.length > 0, 'execution.command is required');
  invariant(descriptor.execution.command.every((part) => typeof part === 'string' && part.length > 0), 'execution.command entries must be non-empty strings');
  invariant(Number.isFinite(Date.parse(descriptor.execution.started_at)), 'execution.started_at is invalid');
  invariant(Number.isFinite(Date.parse(descriptor.execution.completed_at)), 'execution.completed_at is invalid');
  invariant(Date.parse(descriptor.execution.completed_at) >= Date.parse(descriptor.execution.started_at), 'execution.completed_at precedes started_at');
  invariant(Date.parse(descriptor.created_at) >= Date.parse(descriptor.execution.completed_at), 'created_at precedes execution completion');
  invariant(Number.isInteger(descriptor.execution.exit_code), 'execution.exit_code must be an integer');
  invariant(Array.isArray(descriptor.artifacts) && descriptor.artifacts.length >= 4, 'artifacts must contain code, data, environment, and output records');
  unique(descriptor.artifacts.map((artifact) => artifact.path), 'artifact paths');
  const roles = new Set();
  for (const [index, artifact] of descriptor.artifacts.entries()) {
    invariant(Object.hasOwn(ROLE_TYPES, artifact.role), `artifacts[${index}].role is invalid`);
    roles.add(artifact.role);
    invariant(typeof artifact.path === 'string' && artifact.path.length > 0, `artifacts[${index}].path is required`);
    invariant(typeof artifact.media_type === 'string' && artifact.media_type.includes('/'), `artifacts[${index}].media_type is invalid`);
    invariant(SHA256_PATTERN.test(artifact.expected_sha256), `artifacts[${index}].expected_sha256 is invalid`);
  }
  for (const role of Object.keys(ROLE_TYPES)) invariant(roles.has(role), `artifacts must include role ${role}`);
  if (descriptor.status === 'passed') invariant(descriptor.execution.exit_code === 0, 'passed capsules require exit_code 0');
  if (descriptor.status === 'failed') invariant(descriptor.execution.exit_code !== 0, 'failed capsules require a non-zero exit_code');
  return descriptor;
}

function roleRefs(files, role) {
  return files.filter((file) => file.role === role).map((file) => ({ '@id': file.path }));
}

export function buildEvidenceCapsule(descriptorInput, baseDir) {
  const descriptor = validateCapsuleDescriptor(descriptorInput);
  const files = [...descriptor.artifacts]
    .sort((a, b) => compareText(a.path, b.path))
    .map((artifact) => {
      const absolutePath = safeRelativePath(baseDir, artifact.path, `artifact ${artifact.path}`);
      const digest = sha256File(absolutePath);
      invariant(digest === artifact.expected_sha256, `Hash mismatch for ${artifact.path}`);
      return {
        ...artifact,
        sha256: digest,
        bytes: statSync(absolutePath).size,
      };
    });

  const crateId = `${descriptor.capsule_id}/`;
  const actionId = `${crateId}#execution`;
  const metadata = {
    '@id': 'ro-crate-metadata.json',
    '@type': 'CreativeWork',
    about: { '@id': './' },
    conformsTo: { '@id': 'https://w3id.org/ro/crate/1.3' },
  };
  const root = {
    '@id': './',
    '@type': 'Dataset',
    name: `Executable evidence capsule ${descriptor.capsule_id}`,
    identifier: descriptor.capsule_id,
    version: descriptor.release.version,
    datePublished: descriptor.created_at,
    license: { '@id': descriptor.license },
    conformsTo: [
      { '@id': 'https://w3id.org/ro/crate/1.3' },
      { '@id': 'https://w3id.org/workflowhub/workflow-ro-crate/1.0' },
    ],
    hasPart: files.map((file) => ({ '@id': file.path })),
    mentions: { '@id': actionId },
    'comprev:release': {
      '@id': `urn:sha256:${descriptor.release.manifest_sha256}`,
    },
    'comprev:status': descriptor.status,
  };
  const action = {
    '@id': actionId,
    '@type': 'CreateAction',
    name: descriptor.execution.command.join(' '),
    actionStatus: { '@id': ACTION_STATUS[descriptor.status] },
    startTime: descriptor.execution.started_at,
    endTime: descriptor.execution.completed_at,
    instrument: [
      ...roleRefs(files, 'code'),
      ...roleRefs(files, 'environment'),
    ],
    object: roleRefs(files, 'data'),
    result: roleRefs(files, 'output'),
    'comprev:command': descriptor.execution.command,
    'comprev:exitCode': descriptor.execution.exit_code,
  };
  const fileNodes = files.map((file) => ({
    '@id': file.path,
    '@type': ROLE_TYPES[file.role],
    name: file.path,
    encodingFormat: file.media_type,
    contentSize: file.bytes,
    'comprev:artifactRole': file.role,
    'comprev:sha256': file.sha256,
  }));
  return {
    '@context': [
      'https://w3id.org/ro/crate/1.3/context',
      {
        comprev: 'https://w3id.org/computational-review/terms/',
      },
    ],
    '@graph': [metadata, root, action, ...fileNodes],
  };
}

export function validateEvidenceCapsule(capsule) {
  invariant(isObject(capsule), 'capsule must be an object');
  invariant(Array.isArray(capsule['@context']), 'capsule @context must be an array');
  invariant(capsule['@context'].includes('https://w3id.org/ro/crate/1.3/context'), 'capsule lacks the RO-Crate 1.3 context');
  invariant(Array.isArray(capsule['@graph']), 'capsule @graph must be an array');
  const ids = capsule['@graph'].map((node) => node['@id']);
  unique(ids, 'RO-Crate node IDs');
  invariant(ids.includes('ro-crate-metadata.json') && ids.includes('./'), 'capsule lacks RO-Crate metadata/root nodes');
  const fileNodes = capsule['@graph'].filter((node) => node['comprev:artifactRole']);
  for (const role of Object.keys(ROLE_TYPES)) {
    invariant(fileNodes.some((node) => node['comprev:artifactRole'] === role), `capsule lacks ${role} file node`);
  }
  invariant(fileNodes.every((node) => SHA256_PATTERN.test(node['comprev:sha256'])), 'capsule contains an invalid file hash');
  const action = capsule['@graph'].find((node) => node['@type'] === 'CreateAction');
  invariant(action && action.actionStatus?.['@id'], 'capsule lacks execution status');
  return capsule;
}

function main() {
  const args = parseArgs(process.argv.slice(2), ['descriptor', 'base-dir', 'output']);
  const capsule = buildEvidenceCapsule(readJson(args.descriptor), args['base-dir']);
  validateEvidenceCapsule(capsule);
  writeText(args.output, stableJson(capsule));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
