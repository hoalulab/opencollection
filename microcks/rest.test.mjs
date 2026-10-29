import assert from 'node:assert/strict';
import test from 'node:test';
import { restScenarios, resolve } from './rest.mjs';

const { spec, examples, scenarios } = await restScenarios('dnse');

test('DNSE request examples override inherited schema defaults and enum order', () => {
  const quote = examples.operations['GET /price/{symbol}/quotes']['status-200'];
  assert.deepEqual(quote.request.parameters, {
    symbol: 'ACB', boardId: 'G1', from: '1785727927', to: '1785735127', limit: 100,
    'x-microcks-scenario': 'status-200',
  });
  assert.equal(quote.response.body.quotes[0].symbol, quote.request.parameters.symbol);
  const loan = examples.operations['GET /accounts/{accountNo}/loan-packages']['status-200'];
  assert.equal(loan.request.parameters.marketType, 'DERIVATIVE');
  assert.equal(loan.request.parameters.symbol, '41I1G4000');
  assert.ok(!Object.hasOwn(loan.request.parameters, 'X-Api-Key'));
  assert.ok(loan.request.headers['x-api-key']);
});

test('DNSE named executions keep path IDs and market query paired with response', () => {
  const operation = examples.operations['GET /accounts/{accountNo}/executions/{orderId}'];
  for (const [market, id] of [['STOCK', '1651'], ['DERIVATIVE', '26']]) {
    const pair = operation[`status-200-${market}`];
    assert.equal(pair.request.parameters.orderId, id);
    assert.equal(pair.request.parameters.marketType, market);
    assert.equal(String(pair.response.body.id), id);
    assert.equal(pair.response.body.marketType, market);
    assert.equal(pair.request.parameters.accountNo, pair.response.body.accountNo);
  }
});

test('unfiltered fixtures omit incompatible optional query examples', () => {
  const history = examples.operations['GET /accounts/{accountNo}/corporate-action-history']['status-200-unfiltered'];
  assert.deepEqual(history.request.parameters, { accountNo: '0001179019', pageIndex: 0, pageSize: 100, 'x-microcks-scenario': 'status-200-unfiltered' });
  const instruments = examples.operations['GET /instruments']['status-200'];
  assert.ok(!Object.hasOwn(instruments.request.parameters, 'marketId'));
  assert.ok(!Object.hasOwn(instruments.request.parameters, 'indexName'));
  const expected = examples.operations['GET /price/{symbol}/expected-price']['status-200'];
  assert.ok(!Object.hasOwn(expected.request.parameters, 'nextPageToken'));
  assert.ok(!Object.hasOwn(expected.request.parameters, 'limit'));
});

test('inherited path examples and overrides produce concrete matching URLs', () => {
  const get = scenarios.find((s) => s.name === 'GET /accounts/{accountNo}/orders/{orderId}' && s.status === 200);
  const put = scenarios.find((s) => s.name === 'PUT /accounts/{accountNo}/orders/{orderId}' && s.status === 200);
  assert.ok(get.resource.includes('/orders/966?'));
  assert.ok(put.resource.includes('/orders/1626?'));
  assert.ok(!scenarios.some((s) => /\{[^}]+\}/.test(s.resource)));
  const quote = scenarios.find((s) => s.name === 'GET /price/{symbol}/quotes' && s.status === 200);
  const media = resolve(spec, spec.paths['/price/{symbol}/quotes'].get.responses['200']).content['application/json'];
  assert.deepEqual(quote.expected, media.example);
});
