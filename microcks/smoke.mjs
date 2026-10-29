import assert from 'node:assert/strict';
import { baseUrl, brokers, request, restScenarios, validator } from './rest.mjs';

const services = await (await request('/api/services?size=100')).json();
for (const broker of brokers) {
  const { spec, scenarios } = await restScenarios(broker);
  const validate = validator(spec);
  const prefix = `${baseUrl}/rest/${encodeURIComponent(spec.info.title)}/${encodeURIComponent(spec.info.version)}`;
  const service = services.find((entry) => entry.name === spec.info.title && entry.version === spec.info.version);
  assert.ok(service, `${broker}: missing service`);
  const detail = await (await request(`/api/services/${service.id}?messages=true`)).json();
  for (const scenario of scenarios) {
    const url = new URL(`${prefix}${scenario.resource}`);
    url.searchParams.set('x-microcks-scenario', scenario.scenario);
    const pair = detail.messagesMap[scenario.name]?.find((entry) => entry.name === scenario.scenario);
    assert.ok(pair, `${broker}: missing persisted sample ${scenario.name} ${scenario.scenario}`);
    // The UI substitutes path placeholders from dispatchCriteria, not request parameters.
    const criteria = pair.response.dispatchCriteria;
    assert.equal(typeof criteria, 'string', `${broker}: missing UI dispatch criteria`);
    const separator = criteria.indexOf('?');
    const pathCriteria = separator < 0 ? criteria : criteria.slice(0, separator);
    const queryCriteria = separator < 0 ? '' : criteria.slice(separator + 1).replaceAll('?', '&');
    const parts = Object.fromEntries(pathCriteria.split('/').filter(Boolean).map((part) => {
      const equal = part.indexOf('=');
      return [part.slice(0, equal), part.slice(equal + 1)];
    }));
    const uiPath = scenario.name.slice(scenario.name.indexOf(' ') + 1).replace(/\{([^}]+)\}/g, (_, key) => {
      assert.ok(Object.hasOwn(parts, key), `${broker}: UI URL lacks path part ${key}`);
      return parts[key];
    });
    const uiUrl = new URL(`${prefix}${uiPath}${queryCriteria ? `?${queryCriteria}` : ''}`);
    assert.equal(uiUrl.pathname, url.pathname, `${broker}: UI path differs from request`);
    assert.deepEqual([...uiUrl.searchParams].sort(), [...url.searchParams].sort(), `${broker}: UI query differs from request`);
    const response = await fetch(url, {
      method: scenario.method.toUpperCase(),
      headers: { ...scenario.headers, ...(scenario.requestMedia ? { 'content-type': scenario.requestMedia } : {}) },
      ...(scenario.body !== undefined ? { body: JSON.stringify(scenario.body) } : {}),
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    const context = `${broker} ${scenario.name} ${scenario.scenario}`;
    assert.equal(response.status, scenario.status, `${context}: ${await response.clone().text()}`);
    if (scenario.mediaType) {
      assert.ok(response.headers.get('content-type')?.includes(scenario.mediaType), `${context}: content-type`);
      const text = await response.text();
      const actual = scenario.mediaType.includes('json') ? JSON.parse(text) : text;
      assert.deepEqual(actual, scenario.expected ?? '', `${context}: wrong scenario payload`);
      if (scenario.schema) validate(scenario.schema, actual, context);
    } else {
      assert.equal(await response.text(), '', `${context}: expected no content`);
    }
  }
  // Default success works without the mock-only scenario query parameter.
  const normal = scenarios.find((scenario) => scenario.method === 'get' && scenario.status === 200);
  assert.ok(normal, `${broker}: no read-only smoke candidate`);
  const response = await fetch(`${prefix}${normal.resource}`, { headers: normal.headers, redirect: 'error', signal: AbortSignal.timeout(10_000) });
  assert.equal(response.status, normal.status, `${broker}: default scenario`);
  assert.deepEqual(await response.json(), normal.expected, `${broker}: default payload`);
  console.log(`PASS ${broker}: ${scenarios.length} REST scenarios + default dispatch`);
}
