import { readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

const [manifestPath] = process.argv.slice(2);

if (!manifestPath) {
  throw new Error('Usage: prepare-extension-manifest.mjs <manifest>');
}

const sourcePath = resolve(manifestPath);
const outputPath = resolve('dist/manifest.json');
const manifest = JSON.parse(await readFile(sourcePath, 'utf8'));
const version = process.env.WINDOWLLM_EXTENSION_VERSION ?? manifest.version;

// Safari's generated app requires at most three numeric components. Keeping the
// shared build within this stricter limit also produces valid Chrome and Firefox
// extension versions.
const components = version.split('.');
const validVersion = components.length >= 1
  && components.length <= 3
  && components.every((component) => /^\d+$/.test(component)
    && (component === '0' || !component.startsWith('0'))
    && Number(component) <= 65535);

if (!validVersion) {
  throw new Error(`Invalid browser extension version: ${version}`);
}

manifest.version = version;
await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Prepared ${basename(sourcePath)} as ${outputPath} (version ${version})`);
