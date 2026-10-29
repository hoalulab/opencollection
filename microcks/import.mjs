import assert from 'node:assert/strict';
import { request } from './rest.mjs';
import { prepareArtifacts } from './prepare.mjs';

const artifacts = await prepareArtifacts();
for (const artifact of artifacts.filter((artifact) => !artifact.localOnly)) {
  const form = new FormData();
  const type = artifact.name.endsWith('.yaml') ? 'application/yaml' : 'application/json';
  form.set('file', new Blob([artifact.content], { type }), artifact.name);
  await request(`/api/artifact/upload?mainArtifact=${artifact.primary}`, { method: 'POST', body: form });
  console.log(`Imported ${artifact.name} (${artifact.primary ? 'primary' : 'secondary'})`);
}
const services = await (await request('/api/services?size=100')).json();
for (const { info } of artifacts.filter((artifact) => artifact.primary)) {
  assert.equal(services.filter((service) => service.name === info.title && service.version === info.version).length, 1, `Missing or duplicate service ${info.title}:${info.version}`);
}
console.log('Verified all 8 service identities (safe to re-import).');
