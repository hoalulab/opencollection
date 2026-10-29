import assert from 'node:assert/strict';
import { request, restScenarios } from './rest.mjs';

const { spec, examples, scenarios } = await restScenarios('dnse');
const services = await (await request('/api/services?size=100')).json();
const service = services.find((s) => s.name === spec.info.title && s.version === spec.info.version);
assert.ok(service, 'DNSE service must be imported');
const detail = await (await request(`/api/services/${service.id}?messages=true`)).json();
for (const scenario of scenarios) {
  const pair = detail.messagesMap[scenario.name]?.find((entry) => entry.request?.name === scenario.scenario);
  assert.ok(pair, `Missing persisted request ${scenario.name} ${scenario.scenario}`);
  const expected = examples.operations[scenario.name][scenario.scenario];
  // Microcks stores path/query examples as name/value entries with string values.
  const actualParameters = Object.fromEntries((pair.request.queryParameters || []).map(({ name, value }) => [name, value]));
  const expectedParameters = Object.fromEntries(Object.entries(expected.request.parameters).map(([name, value]) => [name, String(value)]));
  assert.deepEqual(actualParameters, expectedParameters, `${scenario.name} ${scenario.scenario}`);
}
const stock = scenarios.find((s) => s.scenario === 'status-200-STOCK');
const derivative = scenarios.find((s) => s.scenario === 'status-200-DERIVATIVE');
const quote = scenarios.find((s) => s.name === 'GET /price/{symbol}/quotes' && s.status === 200);
for (const scenario of [quote, stock, derivative]) {
  const queryResource = scenario.resource + (scenario.resource.includes('?') ? '&' : '?') + `x-microcks-scenario=${scenario.scenario}`;
  const url = `/rest/${encodeURIComponent(spec.info.title)}/${spec.info.version}${queryResource}`;
  const response = await request(url, { headers: scenario.headers });
  assert.deepEqual(await response.json(), scenario.expected, scenario.name);
  console.log(`PASS ${scenario.scenario} ${scenario.resource}`);
}
console.log(`PASS ${scenarios.length} persisted DNSE request parameter sets`);
