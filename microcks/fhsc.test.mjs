import assert from 'node:assert/strict';
import test from 'node:test';
import { restScenarios, resolve } from './rest.mjs';

const { spec, scenarios } = await restScenarios('fhsc');

test('crypto history composes nested examples without another asset identity or bond yield', () => {
  const scenario = scenarios.find((entry) => entry.name === 'GET /market/quotes/cryptos/{symbol}/history' && entry.status === 200);
  assert.equal(scenario.source, 'schema-examples');
  assert.equal(scenario.expected.error_code, '0');
  assert.equal(scenario.expected.message, 'success');
  assert.equal(scenario.expected.data.symbol, 'BTC');
  assert.equal(scenario.expected.data.resolution, '1D');
  assert.equal(scenario.expected.data.series[0].t, 1717200000);
  assert.equal(scenario.expected.data.series[0].c, 193.42);
  assert.ok(!Object.hasOwn(scenario.expected.data.series[0], 'yield'));
  const url = new URL(scenario.resource, 'http://localhost');
  assert.equal(url.searchParams.get('from'), '1717200000');
  assert.equal(url.searchParams.get('to'), '1717545600');
});

test('full FHSC examples are kept verbatim rather than generated from property schemas', () => {
  const scenario = scenarios.find((entry) => entry.name === 'GET /trading/market/session' && entry.status === 200);
  const response = resolve(spec, spec.paths['/trading/market/session'].get.responses['200']);
  assert.equal(scenario.source, 'spec');
  assert.deepEqual(scenario.expected, response.content['application/json'].example);
  assert.equal(new URL(scenario.resource, 'http://localhost').searchParams.get('exchange'), scenario.expected.result.exchange);
});
