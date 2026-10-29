#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { prepareAsync } from './async-prepare.mjs';

const apiBase = new URL(process.env.MICROCKS_URL || 'http://localhost:8585');
const minionBase = new URL(process.env.MICROCKS_ASYNC_URL || 'http://localhost:8586');
const eventTimeoutMs = 15000;

// These are complete published contract examples, not generated market data. No client
// auth/subscribe/heartbeat is sent: Microcks replays examples on independent mock endpoints.
const cases = [
  {
    broker: 'dnse',
    operation: 'onTradeUpdates',
    expected: {
      T: 't', boardId: 'G1', grossTradeAmount: 205.111605, highestPrice: 21.2,
      isin: 'VN000000HPG4', lowestPrice: 20.9, marketId: 'STO', matchPrice: 21.05,
      matchQtty: 90, multicastReceiveTime: { Nanos: 687300758, Seconds: 1787120768 },
      openPrice: 21.1, symbol: 'HPG', time: { Nanos: 35000000, Seconds: 1787120771 },
      totalVolumeTraded: 976440, tradingSessionId: '40',
    },
  },
  {
    broker: 'ssi',
    operation: 'onTradeUpdates',
    expected: {
      channel: 'DATA', topic: 'trade.SSI@tick',
      data: {
        s: 'SSI', t: '2026/07/29 09:15:32', p: '45.50', q: '1000', a: '45.35',
        si: 'B', o: '45.00', h: '45.80', l: '44.90', v: '1250000',
      },
    },
  },
  {
    broker: 'tcbs',
    operation: 'receiveCashMarketData__tradeUpdate',
    // Check the entire raw text frame, including prefix, JSON field order and numeric strings.
    expected: 's|6|{"symbol":"TCB","matchPrice":"24550","matchQtty":"5000","change":200,"changePercent":0.8213552361,"totalVolume":"9745500","totalValue":"240774655000"}',
  },
];

function resolve(spec, node) {
  const seen = new Set();
  while (node?.$ref) {
    const ref = node.$ref;
    assert.ok(ref.startsWith('#/'), `External reference ${ref}; run npm run bundle:asyncapi`);
    assert.ok(!seen.has(ref), `Circular reference ${ref}`);
    seen.add(ref);
    node = ref.slice(2).split('/').reduce((value, key) => value?.[key.replace(/~1/g, '/').replace(/~0/g, '~')], spec);
    assert.ok(node, `Unresolved reference ${ref}`);
  }
  return node;
}

async function getServices() {
  const response = await fetch(new URL('/api/services?page=0&size=100', apiBase), {
    signal: AbortSignal.timeout(10000), redirect: 'error', headers: { Accept: 'application/json' },
  });
  assert.equal(response.status, 200, `Microcks service discovery returned HTTP ${response.status}`);
  const services = await response.json();
  assert.ok(Array.isArray(services), 'Microcks service discovery must return an array');
  assert.ok(services.length < 100, 'Service discovery exceeds this local smoke runtime capacity');
  return services;
}

function endpoint(service, operation) {
  assert.equal(operation.method, 'SEND', `Not an outgoing operation: ${operation.name}`);
  assert.ok(operation.bindings?.WS, `Missing WS binding: ${operation.name}`);
  assert.equal(operation.defaultDelay, 3, `Missing replay frequency: ${operation.name}`);
  assert.notEqual(operation.dispatcher, 'URI_PARTS', 'This smoke expects a fixed-address operation');
  // Exact 1.15.0 naming, not the broker's canonical URL:
  // https://github.com/microcks/microcks/blob/1.15.0/minions/async/src/main/java/io/github/microcks/minion/async/producer/WebSocketProducerManager.java
  // ProducerManager.getDestinationOperationPart removes the SEND action from the name.
  // Literal '+' is required: WebSocketSessionRegistry keys paths before form-style decoding.
  const path = [service.name, service.version, operation.name.replace(/^SEND /, '')]
    .map((part) => encodeURIComponent(part).replace(/%20/g, '+')).join('/');
  const url = new URL(`/api/ws/${path}`, minionBase);
  assert.ok(['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol), 'Invalid async-minion URL protocol');
  url.protocol = ['https:', 'wss:'].includes(url.protocol) ? 'wss:' : 'ws:';
  return url;
}

async function assertEvent(url, sample) {
  let socket;
  try {
    await new Promise((resolveEvent, reject) => {
      const timer = setTimeout(() => reject(new Error(`No event within ${eventTimeoutMs}ms: ${url}`)), eventTimeoutMs);
      const finish = (error) => {
        clearTimeout(timer);
        if (error) reject(error);
        else resolveEvent();
      };
      try {
        socket = new WebSocket(url);
        socket.addEventListener('message', ({ data }) => {
          try {
            assert.equal(typeof data, 'string', 'Expected a WebSocket text frame');
            const received = sample.broker === 'tcbs' ? data : JSON.parse(data);
            assert.deepEqual(received, sample.expected, `${sample.broker}: unexpected server event`);
            finish();
          } catch (error) {
            finish(error);
          }
        }, { once: true });
        socket.addEventListener('error', () => finish(new Error(`WebSocket connection error: ${url}`)), { once: true });
        socket.addEventListener('close', ({ code, reason }) => {
          finish(new Error(`WebSocket closed before a valid event (${code} ${reason}): ${url}`));
        }, { once: true });
      } catch (error) {
        finish(error);
      }
    });
  } finally {
    // Always initiate close, even after malformed data or a connect timeout. The executable
    // exits explicitly below so an unavailable peer cannot hold the process in closing state.
    if (socket && socket.readyState !== WebSocket.CLOSED) {
      try { socket.close(1000, 'Smoke complete'); } catch { /* A failed handshake is already reported. */ }
    }
  }
}

async function main() {
  assert.equal(process.argv.length, 2, 'Usage: node microcks/async-smoke.mjs');
  for (const sample of cases) {
    const source = new URL(`../dist/${sample.broker}.asyncapi.yaml`, import.meta.url);
    let spec;
    try {
      spec = prepareAsync(parse(await readFile(source, 'utf8')), sample.broker);
    } catch (error) {
      throw new Error(`${sample.broker}: cannot read async bundle; run npm run bundle:asyncapi`, { cause: error });
    }
    assert.ok(spec.info?.title && spec.info?.version, `${sample.broker}: invalid service metadata`);
    const operation = spec.operations[sample.operation];
    assert.ok(operation, `${sample.broker}: missing sample operation ${sample.operation}`);
    assert.equal(operation.messages.length, 1, 'Prepared operations must contain exactly one message');
    const message = resolve(spec, operation.messages[0]);
    assert.deepEqual(message.examples?.[0]?.payload, sample.expected, `${sample.broker}: source sample changed`);
    sample.spec = spec;
  }

  const services = await getServices();
  for (const sample of cases) {
    const matching = services.filter((service) => service.name === sample.spec.info.title && service.version === sample.spec.info.version);
    assert.equal(matching.length, 1, `${sample.broker}: expected exactly one imported AsyncAPI service`);
    const [service] = matching;
    assert.equal(service.type, 'EVENT', `${sample.broker}: expected an AsyncAPI event service`);
    const operations = service.operations?.filter((operation) => operation.name === `SEND ${sample.operation}`);
    assert.equal(operations?.length, 1, `${sample.broker}: missing imported SEND operation ${sample.operation}`);
    const url = endpoint(service, operations[0]);
    await assertEvent(url, sample);
    console.log(`PASS ${sample.broker} WebSocket ${url}`);
  }
  console.log('PASS 3/3 Microcks WebSocket event mocks');
}

// Native WebSocket has no terminate(). Explicit exit bounds failed handshakes and unresponsive
// close handshakes; each socket is closed in finally and no background retry loop remains.
main().then(() => process.exit(0), (error) => {
  console.error(`FAIL Microcks async smoke: ${error.stack ?? error}`);
  if (error.cause) console.error(error.cause);
  process.exit(1);
});
