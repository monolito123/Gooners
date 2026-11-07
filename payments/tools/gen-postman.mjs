// Generates a Postman collection (v2.1) from api/openapi.yaml: every operation the platform
// serves, by tag, with the API key, Api-Version and Idempotency-Key headers set and a request
// body built from the schema's examples, defaults and required fields. Planned operations are
// left out. `node gen-postman.mjs` writes api/goonerspay.postman_collection.json; `--check`
// exits 1 when it is out of date (npm run check runs it). Bodies come from the request
// examples in docs/02 when one fits the operation's schema.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import YAML from 'yaml';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'api', 'goonerspay.postman_collection.json');
const oas = YAML.parse(readFileSync(join(root, 'api', 'openapi.yaml'), 'utf8'));
const deref = (o) => {
  while (o && o.$ref) o = o.$ref.slice(2).split('/').reduce((a, k) => a[k], oas);
  return o;
};

// The request examples of docs/02: a body is the example that validates against the operation's
// schema, names no field the schema does not, and has the most fields.
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema({ $id: 'oas', components: oas.components });
const rewrite = (v) => (Array.isArray(v) ? v.map(rewrite) : v && typeof v === 'object'
  ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === '$ref' && typeof x === 'string' && x.startsWith('#/') ? 'oas' + x : rewrite(x)])) : v);
const docExamples = [...readFileSync(join(root, 'docs', '02-api-reference.md'), 'utf8').matchAll(/```json\n([\s\S]*?)```/g)]
  .map((m) => { try { return JSON.parse(m[1]); } catch { return null; } })
  .filter((v) => v && typeof v === 'object' && !Array.isArray(v));
function fromDocs(schema) {
  const s = deref(schema);
  const props = Object.assign({}, s.properties, ...(s.allOf || []).map((x) => deref(x).properties || {}));
  if (!Object.keys(props).length) return null;
  const validate = ajv.compile(rewrite(s));
  const fits = docExamples.filter((v) => Object.keys(v).length && Object.keys(v).every((k) => k in props) && validate(v));
  return fits.sort((a, b) => Object.keys(b).length - Object.keys(a).length)[0] ?? null;
}

// A request body to start from: examples first, then defaults, then the required fields.
function sample(schema, depth = 0) {
  schema = deref(schema);
  if (!schema || depth > 6) return null;
  if (schema.example !== undefined) return schema.example;
  if (schema.examples?.length) return schema.examples[0];
  if (schema.default !== undefined) return schema.default;
  if (schema.const !== undefined) return schema.const;
  if (schema.enum) return schema.enum[0];
  if (schema.allOf) return Object.assign({}, ...schema.allOf.map((s) => sample(s, depth + 1) || {}));
  if (schema.oneOf || schema.anyOf) return sample((schema.oneOf || schema.anyOf)[0], depth + 1);
  const type = Array.isArray(schema.type) ? schema.type.find((t) => t !== 'null') : schema.type;
  switch (type) {
    case 'object': {
      const o = {};
      for (const k of schema.required || []) o[k] = sample(schema.properties?.[k] ?? {}, depth + 1);
      return o;
    }
    case 'array':
      return schema.items ? [sample(schema.items, depth + 1)] : [];
    case 'integer':
    case 'number':
      return schema.minimum ?? 0;
    case 'boolean':
      return false;
    case 'string':
      return schema.format === 'date' ? '2026-11-06' : schema.format === 'date-time' ? '2026-11-06T12:00:00Z' : schema.format === 'uri' ? 'https://example.com/hook' : '';
    default:
      return null;
  }
}

const version = oas.components.parameters.ApiVersion.schema.example;
const folders = new Map();
for (const [path, ops] of Object.entries(oas.paths)) {
  for (const [method, op] of Object.entries(ops)) {
    if (!['get', 'post', 'put', 'patch', 'delete'].includes(method) || op['x-goonerspay-availability'] === 'planned') continue;
    const params = (op.parameters || []).map(deref);
    const header = [{ key: 'Api-Version', value: version }];
    if (params.some((p) => p.name === 'Idempotency-Key')) header.push({ key: 'Idempotency-Key', value: '{{$guid}}' });
    const segments = path.split('/').filter(Boolean).map((s) => s.replace(/^\{(.+)\}$/, ':$1'));
    const url = {
      raw: '{{baseUrl}}/' + segments.join('/'),
      host: ['{{baseUrl}}'],
      path: segments,
    };
    const vars = segments.filter((s) => s.startsWith(':')).map((s) => ({ key: s.slice(1), value: '' }));
    if (vars.length) url.variable = vars;
    const query = params.filter((p) => p.in === 'query').map((p) => ({ key: p.name, value: '', disabled: true, description: p.description || '' }));
    if (query.length) url.query = query;
    const request = { method: method.toUpperCase(), header, url, description: [op.summary, op.description].filter(Boolean).join('\n\n') };
    const body = deref(op.requestBody)?.content;
    if (body?.['application/json']) {
      header.push({ key: 'Content-Type', value: 'application/json' });
      const schema = body['application/json'].schema;
      request.body = { mode: 'raw', raw: JSON.stringify(fromDocs(schema) ?? sample(schema), null, 2), options: { raw: { language: 'json' } } };
    }
    // Open routes authenticate their own way: an enrollment code, a NIP-98 event, a signature.
    if (Array.isArray(op.security) && op.security.length === 0) request.auth = { type: 'noauth' };
    const tag = op.tags?.[0] || 'other';
    if (!folders.has(tag)) folders.set(tag, []);
    folders.get(tag).push({ name: op.summary || `${method.toUpperCase()} ${path}`, request });
  }
}
const tagInfo = Object.fromEntries((oas.tags || []).map((t) => [t.name, t.description]));
const collection = {
  info: {
    name: 'goonersPAY API',
    description: `Generated from api/openapi.yaml (${version}) by tools/gen-postman.mjs. Set baseUrl (the sandbox, or http://localhost:8080 for a local stack) and apiKey (sk_test_…) in the collection variables; see docs/10-integration-guide.md.`,
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{apiKey}}', type: 'string' }] },
  variable: [{ key: 'baseUrl', value: 'http://localhost:8080' }, { key: 'apiKey', value: 'sk_test_' }],
  item: [...folders].map(([name, item]) => ({ name, description: tagInfo[name] || '', item })),
};
const text = JSON.stringify(collection, null, 2) + '\n';
if (process.argv.includes('--check')) {
  if (!existsSync(out) || readFileSync(out, 'utf8') !== text) {
    console.error('stale: api/goonerspay.postman_collection.json (run npm run postman)');
    process.exit(1);
  }
} else {
  writeFileSync(out, text);
  console.log(`wrote api/goonerspay.postman_collection.json: ${[...folders.values()].reduce((a, f) => a + f.length, 0)} requests in ${folders.size} folders`);
}
