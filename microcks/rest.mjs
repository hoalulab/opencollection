import { readFile } from 'node:fs/promises';
import { sample } from 'openapi-sampler';
import Ajv from 'ajv';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import RandExp from 'randexp';

export const brokers = ['dnse', 'entrade', 'fhsc', 'ssi', 'tcbs'];
export const methods = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];
export const baseUrl = process.env.MICROCKS_URL || 'http://localhost:8585';

export async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options, redirect: 'error', signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`${options.method || 'GET'} ${path}: ${response.status} ${await response.text()}`);
  return response;
}

export function resolve(spec, value) {
  while (value?.$ref) {
    if (!value.$ref.startsWith('#/')) throw new Error(`Unbundled reference ${value.$ref}`);
    value = value.$ref.slice(2).split('/').reduce((node, key) => node[key.replaceAll('~1', '/').replaceAll('~0', '~')], spec);
  }
  return value;
}

function syntheticSpec(spec, preserveExamples = false) {
  const clean = preserveExamples ? structuredClone(spec) : JSON.parse(JSON.stringify(spec, (key, value) => ['example', 'examples', 'default'].includes(key) ? undefined : value));
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.pattern && !node.enum && node.const === undefined) {
      const generator = new RandExp(node.pattern);
      generator.randInt = (min) => min;
      node.example = generator.gen();
    }
    if (node.anyOf?.some((branch) => branch.type === 'null') && !Object.hasOwn(node, 'example') && !node.examples) node.example = null;
    for (const child of Object.values(node)) visit(child);
  };
  visit(clean);
  return clean;
}

export function validator(spec) {
  const engine = spec.openapi.startsWith('3.1') ? new Ajv2020({ strict: false, allErrors: true, validateFormats: false }) : new Ajv({ strict: false, allErrors: true, validateFormats: false });
  addFormats(engine);
  return (schema, body, context) => {
    const validate = engine.compile({ ...schema, components: spec.components });
    if (!validate(body)) throw new Error(`${context}: ${engine.errorsText(validate.errors)}`);
  };
}

function exampleValue(spec, node, key) {
  if (!node) return undefined;
  if (node.examples && !Array.isArray(node.examples)) {
    const entry = node.examples[key] ?? node.examples.default;
    if (entry) {
      const example = resolve(spec, entry);
      if (!Object.hasOwn(example, 'value')) throw new Error('External-only examples must be bundled with a value');
      return structuredClone(example.value);
    }
    // Never silently pair a named response with an unrelated request example.
    return undefined;
  }
  if (Object.hasOwn(node, 'example')) return structuredClone(node.example);
  const schema = resolve(spec, node.schema);
  if (schema && Object.hasOwn(schema, 'example')) return structuredClone(schema.example);
  if (schema?.examples?.length) return structuredClone(schema.examples[0]);
  return undefined;
}

function responseSamples(spec, media, synthetic, useExamples, schemaExamples) {
  if (useExamples && media?.examples) {
    return Object.entries(media.examples).map(([key, entry]) => {
      const example = resolve(spec, entry);
      if (!Object.hasOwn(example, 'value')) throw new Error(`Response example ${key} has no value`);
      return { key, value: structuredClone(example.value), source: 'spec' };
    });
  }
  const explicit = useExamples ? exampleValue(spec, media, 'default') : undefined;
  if (explicit !== undefined) return [{ key: 'default', value: explicit, source: 'spec' }];
  return [{ key: 'default', value: media?.schema ? sample(media.schema, { skipWriteOnly: true, quiet: true }, synthetic) : undefined, source: media?.schema ? (schemaExamples ? 'schema-examples' : 'schema') : 'no-content' }];
}

export async function restScenarios(broker) {
  const spec = JSON.parse(await readFile(new URL(`../dist/${broker}.openapi.json`, import.meta.url), 'utf8'));
  const synthetic = syntheticSpec(spec, broker === 'fhsc');
  const useExamples = ['dnse', 'fhsc'].includes(broker);
  const validate = validator(spec);
  const scenarios = [];
  const examples = { apiVersion: 'mocks.microcks.io/v1alpha1', kind: 'APIExamples', metadata: { name: spec.info.title, version: spec.info.version }, operations: {} };
  for (const [path, item] of Object.entries(spec.paths)) {
    for (const method of methods) {
      const operation = item[method];
      if (!operation) continue;
      const name = `${method.toUpperCase()} ${path}`;
      // Operation parameters override inherited ones by (in, name), as OpenAPI specifies.
      const parameterMap = new Map();
      for (const raw of [...(item.parameters || []), ...(operation.parameters || [])]) {
        const parameter = resolve(spec, raw);
        parameterMap.set(`${parameter.in}:${parameter.name}`, parameter);
      }
      const entries = Object.entries(operation.responses).filter(([status]) => /^\d{3}$/.test(status)).sort(([a], [b]) => Number(a) - Number(b));
      if (!entries.some(([status]) => status.startsWith('2'))) throw new Error(`${broker} ${name}: no concrete success response`);
      const successResponse = resolve(spec, entries.find(([status]) => status.startsWith('2'))[1]);
      const successMedia = Object.values(successResponse.content || {})[0];
      const successKey = useExamples && successMedia?.examples ? Object.keys(successMedia.examples)[0] : 'default';
      examples.operations[name] = {};
      let defaultScenario;
      for (const [status, rawResponse] of entries) {
        const response = resolve(spec, rawResponse);
        const mediaType = Object.keys(response.content || {}).find((type) => type.includes('json')) || Object.keys(response.content || {})[0];
        const media = response.content?.[mediaType];
        const schema = media?.schema;
        for (const responseSample of responseSamples(spec, media, synthetic, useExamples, broker === 'fhsc')) {
          const scenario = `status-${status}${responseSample.key === 'default' ? '' : `-${responseSample.key}`}`;
          const pairingKey = responseSample.key === 'default' ? successKey : responseSample.key;
          const parameters = {};
          const headers = {};
          let resource = path;
          const query = new URLSearchParams();
          for (const parameter of parameterMap.values()) {
            const context = `${broker} ${name} ${scenario} ${parameter.in}:${parameter.name}`;
            let value = useExamples ? exampleValue(spec, parameter, pairingKey) : undefined;
            if (broker === 'fhsc' && value === undefined && !parameter.examples) {
              const parameterSchema = resolve(spec, parameter.schema);
              value = parameterSchema?.default ?? (parameterSchema?.enum?.length === 1 ? parameterSchema.enum[0] : undefined);
            }
            if (parameter.in === 'header' && ['content-type', 'accept'].includes(parameter.name.toLowerCase())) value ??= 'application/json';
            if (value === undefined) {
              if (useExamples && parameter.in !== 'header') {
                if (parameter.required || parameter.in === 'path') throw new Error(`${context}: missing explicit spec example`);
                continue;
              }
              if (useExamples && !parameter.required) continue;
              value = useExamples ? `mock-${parameter.name.toLowerCase()}` : sample(resolve(synthetic, parameter.schema) || { type: 'string' }, { quiet: true }, synthetic);
              // Microcks URI dispatch omits empty query values at runtime. Prefer a
              // concrete enum member for synthetic fixtures when the schema offers one.
              if (!useExamples && parameter.in === 'query' && value === '') {
                value = resolve(synthetic, parameter.schema)?.enum?.find((entry) => entry !== '') ?? value;
              }
            }
            if (useExamples && parameter.schema) validate(parameter.schema, value, context);
            if (parameter.in === 'path' || parameter.in === 'query') parameters[parameter.name] = value;
            if (parameter.in === 'path') resource = resource.replace(`{${parameter.name}}`, encodeURIComponent(String(value)));
            if (parameter.in === 'query') {
              if (Array.isArray(value) && parameter.explode !== false) for (const part of value) query.append(parameter.name, String(part));
              else query.set(parameter.name, String(value));
            }
            if (parameter.in === 'header') headers[parameter.name.toLowerCase()] = String(value);
          }
          if (/\{[^}]+\}/.test(resource)) throw new Error(`${broker} ${name}: unresolved path parameter`);
          const requestBody = resolve(spec, operation.requestBody);
          const requestMedia = Object.keys(requestBody?.content || {}).find((type) => type.includes('json'));
          const requestContent = requestBody?.content?.[requestMedia];
          let body = useExamples ? exampleValue(spec, requestContent, pairingKey) : undefined;
          if (body === undefined && requestContent?.schema) body = sample(requestContent.schema, { skipReadOnly: true, quiet: true }, useExamples ? spec : synthetic);
          if (useExamples && body !== undefined && requestContent?.schema) validate(requestContent.schema, body, `${name} request body`);
          const responseBody = responseSample.value;
          if (broker === 'fhsc' && responseSample.source === 'schema-examples' && schema?.$ref?.endsWith('/QuoteOhlcvHistoryResponse') && responseBody?.data) {
            // Shared OHLCV property examples describe several asset classes. Bind the
            // asset identity to this request, without inventing historical market prices.
            responseBody.data.symbol = parameters.symbol;
            if (parameters.resolution !== undefined) responseBody.data.resolution = parameters.resolution;
            if (!path.includes('/bonds/')) for (const bar of responseBody.data.series || []) delete bar.yield;
          }
          examples.operations[name][scenario] = {
            request: { parameters: { ...parameters, 'x-microcks-scenario': scenario }, headers, ...(body !== undefined ? { body } : {}) },
            response: { status, ...(mediaType ? { mediaType, body: responseBody ?? '' } : {}) },
          };
          scenarios.push({ name, method, resource: resource + (query.size ? `?${query}` : ''), headers, body, requestMedia, status: Number(status), mediaType, schema, expected: responseBody, scenario, source: responseSample.source });
          if (status.startsWith('2')) defaultScenario ??= scenario;
        }
      }
      const pathNames = [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]);
      const queryNames = [...parameterMap.values()].filter((parameter) => parameter.in === 'query').map((parameter) => parameter.name);
      queryNames.push('x-microcks-scenario');
      operation['x-microcks-operation'] = {
        dispatcher: 'FALLBACK',
        dispatcherRules: JSON.stringify({
          dispatcher: pathNames.length ? 'URI_ELEMENTS' : 'URI_PARAMS',
          dispatcherRules: (pathNames.length ? `${pathNames.join(' && ')} ?? ` : '') + queryNames.join(' && '),
          fallback: defaultScenario,
        }),
      };
    }
  }
  return { spec, examples, scenarios };
}
