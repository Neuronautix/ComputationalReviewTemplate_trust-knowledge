// Offline descriptor only: reading local bytes never confers source access.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { assertSchemaValid } from '../release-artifacts/json-schema.mjs';

const schema = JSON.parse(fs.readFileSync(new URL('../../docs/contracts/project-artifacts/v0.1/manifest.schema.json', import.meta.url)));
const fail = (message) => { throw new Error(message); };
const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
export const serializeManifest = (value) => `${JSON.stringify(canonical(value), null, 2)}\n`;

export function buildManifest(declaration, root) {
  assertSchemaValid(declaration, schema, 'project artifacts');
  const base = fs.realpathSync(root);
  const ids = new Set();
  const paths = new Set();
  for (const artifact of declaration.artifacts) {
    if (ids.has(artifact.id) || paths.has(artifact.path)) fail('duplicate artifact id or path');
    ids.add(artifact.id); paths.add(artifact.path);
    if (artifact.clearance !== 'current') fail('withdrawn artifact clearance');
    // POSIX relative identifiers are portable; no Windows drives, URL, query,
    // traversal, hidden credential/config files or ambiguous separators.
    if (!/^[A-Za-z0-9_-][A-Za-z0-9_./-]*(?![\s\S])/.test(artifact.path)
        || artifact.path.split('/').some((part) => !part || part === '.' || part === '..' || part.startsWith('.')))
      fail('unsafe artifact path');
    const target = fs.realpathSync(path.resolve(base, artifact.path));
    const relative = path.relative(base, target);
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) fail('artifact escapes root');
    if (!fs.statSync(target).isFile()) fail('artifact must be a regular file');
    const bytes = fs.readFileSync(target);
    if (bytes.length !== artifact.bytes || createHash('sha256').update(bytes).digest('hex') !== artifact.sha256)
      fail('artifact byte length or SHA-256 mismatch');
    if (artifact.kind === 'reviewed-release' && artifact.state !== 'released') fail('release artifact must declare released state');
    if (artifact.visibility === 'public' && (artifact.rights.redistribution !== 'allowed' || artifact.state !== 'released'))
      fail('public artifact requires released state and explicit redistribution rights');
  }
  // Copy and sort only: no input mutation, runtime time, inferred identities,
  // publication approval or TRUST/SEIP conversion.
  const result = structuredClone(declaration);
  result.artifacts.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  return canonical(result);
}

// Node resolves import.meta.url through symlinks, but preserves argv[1].
function isEntryPoint() {
  try {
    return Boolean(process.argv[1]) && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false; // Library imports need not have an existing script argv[1].
  }
}

if (isEntryPoint()) {
  try {
    const [declarationPath, root, output, ...extra] = process.argv.slice(2);
    if (!declarationPath || !root || !output || extra.length) fail('Usage: node scripts/project-artifacts/build.mjs DECLARATION ROOT PRIVATE_OUTPUT');
    const value = buildManifest(JSON.parse(fs.readFileSync(declarationPath, 'utf8')), root);
    // Never print metadata or copy protected contents; never overwrite an
    // existing output/symlink. Owner-only mode is best effort, not provider ACL.
    fs.writeFileSync(output, serializeManifest(value), { flag: 'wx', mode: 0o600 });
  } catch {
    console.error('Artifact manifest rejected; verify schema, local paths, clearance, rights and exact bytes.');
    process.exitCode = 1;
  }
}
