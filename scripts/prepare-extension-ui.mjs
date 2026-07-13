import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const vaultDist = resolve(root, 'packages/vault/dist');
const extensionDist = resolve(root, 'packages/extension/dist');

await mkdir(extensionDist, { recursive: true });
await cp(resolve(vaultDist, 'assets'), resolve(extensionDist, 'assets'), { recursive: true });

for (const [source, target] of [
  ['extension-popup.html', 'popup.html'],
  ['extension-options.html', 'options.html'],
]) {
  const html = await readFile(resolve(vaultDist, source), 'utf8');
  await writeFile(resolve(extensionDist, target), html.replaceAll('/assets/', 'assets/'));
}
