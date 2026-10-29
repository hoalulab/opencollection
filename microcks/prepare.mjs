import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { parse, stringify } from 'yaml';
import { brokers, restScenarios, validator } from './rest.mjs';
import { prepareAsync } from './async-prepare.mjs';

export async function prepareArtifacts() {
  const artifacts = [];
  for (const broker of brokers) {
    const { spec, examples, scenarios } = await restScenarios(broker);
    const validate = validator(spec);
    for (const scenario of scenarios) {
      if (scenario.schema) validate(scenario.schema, scenario.expected, `${broker} ${scenario.name} ${scenario.status}`);
    }
    // Samples are imported only through the paired secondary dataset.
    const contract = JSON.parse(JSON.stringify(spec, (key, value) =>
      ['example', 'examples', 'default'].includes(key) ? undefined : value));
    artifacts.push({ name: `${broker}.openapi.json`, content: JSON.stringify(contract, null, 2), primary: true, info: spec.info });
    // Microcks parses YAML 1.1: quote strings such as 20260312_241 to preserve IDs.
    artifacts.push({ name: `${broker}.examples.yaml`, content: stringify(examples, { version: '1.1' }), primary: false, info: spec.info });
    artifacts.push({ name: `${broker}.sources.json`, content: JSON.stringify(scenarios.map(({ name, scenario, source, resource }) => ({ operation: name, scenario, responseSource: source, resource })), null, 2), primary: false, info: spec.info, localOnly: true });
    console.log(`Prepared ${broker}: ${Object.keys(examples.operations).length} REST operations, ${scenarios.length} scenarios`);
  }
  for (const broker of ['dnse', 'ssi', 'tcbs']) {
    const spec = parse(await readFile(new URL(`../dist/${broker}.asyncapi.yaml`, import.meta.url), 'utf8'));
    artifacts.push({ name: `${broker}.asyncapi.json`, content: JSON.stringify(prepareAsync(spec, broker), null, 2), primary: true, info: spec.info });
    console.log(`Prepared ${broker}: AsyncAPI ${spec.info.version}`);
  }
  // Validate every dataset before writing artifacts or starting any upload.
  const directory = new URL('../dist/microcks/', import.meta.url);
  await mkdir(directory, { recursive: true });
  for (const artifact of artifacts) await writeFile(new URL(artifact.name, directory), artifact.content);
  return artifacts;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await prepareArtifacts();
}
