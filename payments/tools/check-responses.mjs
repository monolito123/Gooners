// Validates real API responses against the OpenAPI contract. The platform's end-to-end suite
// records every response it receives (GOONERSPAY_RECORD=file go test ./internal/e2e); this
// matches each to its operation and status in api/openapi.yaml and validates the body against
// the declared schema; a request the server accepted (2xx) must match its documented request
// schema too. A success status the contract does not list, a body that does not match its
// schema, or an accepted request the contract would call invalid, is a defect an integrator
// would hit: the check fails on it. Errors may fall to the operation's default Problem.
//
//   node check-responses.mjs responses.jsonl [--coverage] [--strict]
//
// --coverage lists the operations the suite never called; --strict fails on them too, so a new
// route ships with an end-to-end test.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import YAML from 'yaml';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const file = process.argv[2];
if (!file) {
  console.error('usage: node check-responses.mjs responses.jsonl [--coverage]');
  process.exit(2);
}
const openapi = YAML.parse(readFileSync(join(root, 'api', 'openapi.yaml'), 'utf8'));
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema({ $id: 'oas', components: openapi.components });

// Templates with more fixed segments win: /v1/merchants/{id}/summary before /v1/merchants/{id}.
const templates = Object.keys(openapi.paths)
  .map((t) => ({ t, re: new RegExp('^' + t.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{[^}]+\}/g, '[^/]+') + '$'), fixed: t.split('/').filter((s) => s && !s.startsWith('{')).length }))
  .sort((a, b) => b.fixed - a.fixed);
const rewrite = (v) => {
  if (Array.isArray(v)) return v.map(rewrite);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === '$ref' && typeof x === 'string' && x.startsWith('#/') ? 'oas' + x : rewrite(x)]));
  return v;
};
const deref = (o) => {
  while (o && o.$ref) o = o.$ref.slice(2).split('/').reduce((a, k) => a[k], openapi);
  return o;
};
const compiled = new Map();
const validatorFor = (key, schema) => {
  if (!compiled.has(key)) compiled.set(key, ajv.compile(rewrite(schema)));
  return compiled.get(key);
};

const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const failures = new Map(); // one line per defect, with how often it happened
const seen = new Set();
let checked = 0;
const fail = (key, msg) => failures.set(key, { msg, n: (failures.get(key)?.n || 0) + 1 });
for (const r of lines) {
  const tpl = templates.find((x) => x.re.test(r.path));
  const where = `${r.method} ${tpl ? tpl.t : r.path} → ${r.status}`;
  if (!tpl) {
    if (r.status !== 404) fail(where, 'path not in the contract'); // probes of unknown paths answer 404
    continue;
  }
  const op = openapi.paths[tpl.t][r.method.toLowerCase()];
  if (!op) {
    fail(where, 'method not in the contract');
    continue;
  }
  seen.add(`${r.method} ${tpl.t}`);
  const explicit = op.responses?.[String(r.status)] ?? op.responses?.[`${String(r.status)[0]}XX`];
  if (r.status < 300 && !explicit) {
    fail(where, `success status ${r.status} is not documented (documented: ${Object.keys(op.responses || {}).join(', ')})`);
    continue;
  }
  if (r.status < 300 && r.request && op.requestBody) {
    const rb = deref(op.requestBody);
    const media = rb.content?.[(r.request_type || 'application/json').split(';')[0].trim()] ?? rb.content?.['application/json'];
    let sent;
    try {
      sent = JSON.parse(r.request);
    } catch {
      sent = undefined;
    }
    if (media?.schema && sent !== undefined) {
      const v = validatorFor(`${r.method} ${tpl.t} request`, media.schema);
      checked++;
      if (!v(sent)) fail(`${r.method} ${tpl.t} request`, 'accepted by the server, invalid per the contract: ' + ajv.errorsText(v.errors.slice(0, 4)));
    }
  }
  const resp = deref(explicit ?? op.responses?.default);
  if (!resp) {
    fail(where, `status ${r.status} is not documented (documented: ${Object.keys(op.responses || {}).join(', ')})`);
    continue;
  }
  if (!r.body) {
    if (resp.content && r.status !== 204) fail(where, 'empty body where the contract declares one');
    continue;
  }
  const media = resp.content?.[r.content_type.split(';')[0].trim()] ?? resp.content?.['application/json'] ?? resp.content?.['application/problem+json'];
  if (!media?.schema) {
    fail(where, `no schema declared for ${r.content_type}`);
    continue;
  }
  let body;
  try {
    body = JSON.parse(r.body);
  } catch {
    fail(where, 'body is not JSON');
    continue;
  }
  const validate = validatorFor(`${r.method} ${tpl.t} ${r.status} ${r.content_type}`, media.schema);
  checked++;
  if (!validate(body)) fail(where, ajv.errorsText(validate.errors.slice(0, 4)));
}

const ops = Object.entries(openapi.paths).flatMap(([t, o]) => Object.keys(o).filter((m) => ['get', 'post', 'put', 'patch', 'delete'].includes(m) && !o[m]['x-goonerspay-availability']).map((m) => `${m.toUpperCase()} ${t}`));
const unexercised = ops.filter((o) => !seen.has(o));
console.log(`${lines.length} responses recorded; ${checked} bodies validated against their schemas; ${seen.size} of ${ops.length} available operations exercised.`);
const strict = process.argv.includes('--strict');
if ((strict || process.argv.includes('--coverage')) && unexercised.length) console.log('not exercised:\n  ' + unexercised.join('\n  '));
if (strict && unexercised.length) failures.set('coverage', { msg: `${unexercised.length} operations are not exercised by the end-to-end suite`, n: 1 });
if (failures.size) {
  console.log(`\n${failures.size} contract defects:`);
  for (const [k, { msg, n }] of failures) console.log(`  ✗ ${k}${n > 1 ? ` (×${n})` : ''}: ${msg}`);
  process.exit(1);
}
console.log('every recorded response matches the contract');
