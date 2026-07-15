import { isDeepStrictEqual } from 'node:util';
import { invariant } from './lib.mjs';

const SUPPORTED_KEYWORDS = new Set([
  '$schema', '$id', '$ref', '$defs', 'title', 'description',
  'type', 'const', 'enum', 'required', 'properties', 'additionalProperties',
  'items', 'minItems', 'maxItems', 'uniqueItems', 'contains', 'minContains', 'maxContains',
  'minimum', 'maximum', 'minLength', 'maxLength', 'pattern', 'format',
  'allOf', 'oneOf',
]);

function jsonType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  if (typeof value === 'number') return 'number';
  return typeof value;
}

function pointer(root, reference) {
  invariant(reference.startsWith('#/'), `Only local JSON Schema references are supported: ${reference}`);
  return reference.slice(2).split('/').reduce((value, rawToken) => {
    const token = rawToken.replaceAll('~1', '/').replaceAll('~0', '~');
    invariant(value && Object.hasOwn(value, token), `Unresolved JSON Schema reference: ${reference}`);
    return value[token];
  }, root);
}

function isDateTime(value) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(value)
    && Number.isFinite(Date.parse(value));
}

function isUri(value) {
  try {
    const uri = new URL(value);
    return Boolean(uri.protocol);
  } catch {
    return false;
  }
}

export function validateJsonSchema(instance, schema, root = schema, path = '$', errors = []) {
  if (schema.$ref) return validateJsonSchema(instance, pointer(root, schema.$ref), root, path, errors);
  for (const part of schema.allOf || []) validateJsonSchema(instance, part, root, path, errors);
  if (schema.oneOf) {
    const matches = schema.oneOf.filter(
      (part) => validateJsonSchema(instance, part, root, path, []).length === 0,
    ).length;
    if (matches !== 1) errors.push(`${path}: expected exactly one oneOf branch; got ${matches}`);
    return errors;
  }
  if (Object.hasOwn(schema, 'const') && !isDeepStrictEqual(instance, schema.const)) {
    errors.push(`${path}: must equal ${JSON.stringify(schema.const)}`);
  }
  if (schema.enum && !schema.enum.some((allowed) => isDeepStrictEqual(instance, allowed))) {
    errors.push(`${path}: is outside enum`);
  }
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const actual = jsonType(instance);
    if (!types.includes(actual) && !(actual === 'integer' && types.includes('number'))) {
      errors.push(`${path}: expected ${types.join('|')}; got ${actual}`);
      return errors;
    }
  }
  if (typeof instance === 'string') {
    if (schema.minLength !== undefined && instance.length < schema.minLength) errors.push(`${path}: shorter than minLength`);
    if (schema.maxLength !== undefined && instance.length > schema.maxLength) errors.push(`${path}: longer than maxLength`);
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(instance)) errors.push(`${path}: does not match ${schema.pattern}`);
    if (schema.format === 'date-time' && !isDateTime(instance)) errors.push(`${path}: invalid date-time`);
    if (schema.format === 'uri' && !isUri(instance)) errors.push(`${path}: invalid URI`);
  }
  if (typeof instance === 'number') {
    if (schema.minimum !== undefined && instance < schema.minimum) errors.push(`${path}: below minimum`);
    if (schema.maximum !== undefined && instance > schema.maximum) errors.push(`${path}: above maximum`);
  }
  if (Array.isArray(instance)) {
    if (schema.minItems !== undefined && instance.length < schema.minItems) errors.push(`${path}: below minItems`);
    if (schema.maxItems !== undefined && instance.length > schema.maxItems) errors.push(`${path}: above maxItems`);
    if (schema.uniqueItems) {
      for (let left = 0; left < instance.length; left += 1) {
        for (let right = left + 1; right < instance.length; right += 1) {
          if (isDeepStrictEqual(instance[left], instance[right])) errors.push(`${path}: duplicate items at ${left} and ${right}`);
        }
      }
    }
    if (schema.items) instance.forEach((item, index) => validateJsonSchema(item, schema.items, root, `${path}[${index}]`, errors));
    if (schema.contains) {
      const matches = instance.filter(
        (item) => validateJsonSchema(item, schema.contains, root, path, []).length === 0,
      ).length;
      const minimum = schema.minContains ?? 1;
      const maximum = schema.maxContains ?? Number.POSITIVE_INFINITY;
      if (matches < minimum || matches > maximum) errors.push(`${path}: contains matched ${matches}; expected ${minimum}..${maximum}`);
    }
  }
  if (instance && typeof instance === 'object' && !Array.isArray(instance)) {
    for (const key of schema.required || []) {
      if (!Object.hasOwn(instance, key)) errors.push(`${path}: missing ${key}`);
    }
    for (const [key, value] of Object.entries(instance)) {
      if (schema.properties && Object.hasOwn(schema.properties, key)) {
        validateJsonSchema(value, schema.properties[key], root, `${path}.${key}`, errors);
      } else if (schema.additionalProperties === false) {
        errors.push(`${path}.${key}: additional property is not allowed`);
      } else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        validateJsonSchema(value, schema.additionalProperties, root, `${path}.${key}`, errors);
      }
    }
  }
  return errors;
}

function auditNode(schema, root, path, seen) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema) || seen.has(schema)) return;
  seen.add(schema);
  for (const keyword of Object.keys(schema)) {
    invariant(SUPPORTED_KEYWORDS.has(keyword), `${path}: unsupported JSON Schema keyword ${keyword}`);
  }
  if (schema.$ref) pointer(root, schema.$ref);
  if (schema.pattern) new RegExp(schema.pattern, 'u');
  for (const [key, child] of Object.entries(schema.properties || {})) auditNode(child, root, `${path}.properties.${key}`, seen);
  for (const [key, child] of Object.entries(schema.$defs || {})) auditNode(child, root, `${path}.$defs.${key}`, seen);
  if (schema.items && typeof schema.items === 'object') auditNode(schema.items, root, `${path}.items`, seen);
  if (schema.contains && typeof schema.contains === 'object') auditNode(schema.contains, root, `${path}.contains`, seen);
  if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
    auditNode(schema.additionalProperties, root, `${path}.additionalProperties`, seen);
  }
  for (const keyword of ['allOf', 'oneOf']) {
    (schema[keyword] || []).forEach((child, index) => auditNode(child, root, `${path}.${keyword}[${index}]`, seen));
  }
}

export function auditJsonSchema(schema) {
  invariant(schema?.$schema === 'https://json-schema.org/draft/2020-12/schema', 'Schema must declare Draft 2020-12');
  auditNode(schema, schema, '$', new Set());
  return schema;
}

export function assertSchemaValid(instance, schema, label = 'document') {
  auditJsonSchema(schema);
  const errors = validateJsonSchema(instance, schema);
  invariant(errors.length === 0, `${label} failed schema validation:\n${errors.join('\n')}`);
  return instance;
}
