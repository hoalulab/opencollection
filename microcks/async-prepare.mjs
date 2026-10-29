// Import-only adaptations for Microcks 1.15.0. Canonical AsyncAPI contracts stay unchanged.
// Microcks periodically publishes examples; this is not broker auth, subscription or heartbeat emulation.

function resolve(spec, node) {
  const seen = new Set();
  while (node?.$ref) {
    const ref = node.$ref;
    if (!ref.startsWith('#/')) throw new Error(`Bundle AsyncAPI before importing: external reference ${ref}`);
    if (seen.has(ref)) throw new Error(`Circular AsyncAPI reference ${ref}`);
    seen.add(ref);
    node = ref.slice(2).split('/').reduce((value, key) => value?.[key.replace(/~1/g, '/').replace(/~0/g, '~')], spec);
    if (!node) throw new Error(`Unresolved AsyncAPI reference ${ref}`);
  }
  return node;
}

export function prepareAsync(spec, broker) {
  if (!['dnse', 'ssi', 'tcbs'].includes(broker)) throw new Error(`Unknown async broker ${broker}`);
  if (spec?.asyncapi !== '3.0.0' || !spec.channels || !spec.operations) {
    throw new Error(`${broker}: expected a bundled AsyncAPI 3.0.0 contract`);
  }
  const copy = structuredClone(spec);
  for (const channelRef of Object.values(copy.channels)) {
    const channel = resolve(copy, channelRef);
    // The importer reads channel bindings, not servers[].protocol (wss alone is insufficient).
    channel.bindings = { ...channel.bindings, ws: { method: 'GET', bindingVersion: '0.1.0' } };
  }

  const framed = new WeakSet();
  const operations = {};
  for (const [name, operation] of Object.entries(copy.operations)) {
    const messages = operation.messages ?? [];
    for (const [index, messageRef] of messages.entries()) {
      const message = resolve(copy, messageRef);
      if (broker === 'tcbs' && operation.action === 'send' && message.examples?.length && !framed.has(message)) {
        // TCBS contracts deliberately describe the decoded JSON body. Restore the documented
        // text-frame prefix on the import copy; never JSON-quote a complete pipe-delimited frame.
        const prefix = message.description?.match(/`([^`]*?)\{JSON_PAYLOAD\}`/)?.[1];
        if (!prefix) throw new Error(`tcbs ${name}: missing documented wire prefix`);
        message.examples = message.examples.map((example) => {
          if (!example.payload || typeof example.payload !== 'object') {
            throw new Error(`tcbs ${name}: expected a decoded JSON example`);
          }
          let wirePrefix = prefix;
          if (wirePrefix.includes('<SYMBOL>')) {
            if (typeof example.payload.symbol !== 'string') throw new Error(`tcbs ${name}: missing sample symbol`);
            wirePrefix = wirePrefix.replace('<SYMBOL>', example.payload.symbol);
          }
          return { ...example, payload: wirePrefix + JSON.stringify(example.payload) };
        });
        message.contentType = 'text/plain';
        message.payload = { type: 'string', description: 'Documented TCBS pipe-delimited WebSocket text frame.' };
        framed.add(message);
      }
      if (operation.action !== 'send') continue;
      // AsyncAPI3Importer.buildEventMessages in 1.15.0 overwrites, rather than appends,
      // each message's examples. One SEND operation per message preserves every example.
      const suffix = messageRef.$ref?.split('/').at(-1) ?? String(index + 1);
      const preparedName = messages.length > 1 ? `${name}__${suffix}` : name;
      if (Object.hasOwn(operations, preparedName) || (preparedName !== name && Object.hasOwn(copy.operations, preparedName))) {
        throw new Error(`${broker}: generated operation collision ${preparedName}`);
      }
      operations[preparedName] = {
        ...operation,
        messages: [messageRef],
        'x-microcks-operation': {
          ...operation['x-microcks-operation'],
          frequency: message.examples?.length ? 3 : 0,
        },
      };
    }
    if (operation.action !== 'send' || messages.length === 0) {
      operations[name] = {
        ...operation,
        'x-microcks-operation': { ...operation['x-microcks-operation'], frequency: 0 },
      };
    }
  }
  copy.operations = operations;
  return copy;
}
