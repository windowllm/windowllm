import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { firefox } from 'playwright';

import { startExtensionE2EServer } from '../server.mjs';

const root = process.cwd();
const extensionPath = resolve(root, 'packages/extension/dist');
const manifest = JSON.parse(await readFile(resolve(extensionPath, 'manifest.json'), 'utf8'));
if (manifest.manifest_version !== 2) {
  throw new Error(`Firefox E2E expected a Manifest V2 build, got V${manifest.manifest_version}`);
}

const webExt = resolve(root, 'node_modules/.bin', process.platform === 'win32' ? 'web-ext.cmd' : 'web-ext');
const firefoxBinary = process.env.FIREFOX_BINARY || firefox.executablePath();
const server = await startExtensionE2EServer();
let output = '';

const webExtArguments = [
  'run',
  `--source-dir=${extensionPath}`,
  `--firefox=${firefoxBinary}`,
  `--start-url=${server.url}/?runner=firefox`,
  '--no-reload',
  '--no-input',
  '--args=-headless',
];
if (process.env.EXTENSION_E2E_VERBOSE) webExtArguments.push('--verbose');

const child = spawn(webExt, webExtArguments, {
  cwd: root,
  detached: process.platform !== 'win32',
  env: { ...process.env, MOZ_HEADLESS: '1', NO_COLOR: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

for (const stream of [child.stdout, child.stderr]) {
  stream.setEncoding('utf8');
  stream.on('data', chunk => {
    output += chunk;
    if (process.env.EXTENSION_E2E_VERBOSE) process.stderr.write(chunk);
  });
}

async function stopFirefox() {
  if (child.exitCode !== null) return;
  const signal = process.platform === 'win32' || !child.pid
    ? (name) => child.kill(name)
    : (name) => process.kill(-child.pid, name);
  signal('SIGINT');
  await Promise.race([
    new Promise(resolveExit => child.once('exit', resolveExit)),
    new Promise(resolveTimeout => setTimeout(resolveTimeout, 3_000)),
  ]);
  if (child.exitCode === null) signal('SIGKILL');
}

try {
  const earlyExit = new Promise((_, reject) => {
    child.once('exit', code => reject(new Error(`web-ext exited before reporting results (code ${code})\n${output}`)));
  });
  const timeout = new Promise((_, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Firefox extension E2E timed out\n${output}`)),
      60_000,
    );
    timer.unref();
  });
  const report = await Promise.race([server.result, earlyExit, timeout]);

  const failed = report.tests.filter(test => test.status === 'fail');
  if (!report.userAgent.includes('Firefox/')) {
    throw new Error(`Expected a Firefox user agent, got ${report.userAgent}`);
  }
  if (failed.length > 0) {
    throw new Error(`Firefox extension contract failures:\n${JSON.stringify(failed, null, 2)}`);
  }
  if (server.metrics.tags < 1 || server.metrics.completions < 1 || server.metrics.streams < 1) {
    throw new Error(`Provider adapter was not exercised: ${JSON.stringify(server.metrics)}`);
  }

  for (const test of report.tests) {
    console.log(`  PASS [${test.scope}] ${test.name}`);
  }
  console.log(`[firefox-extension] ${report.passed} passed; provider requests ${JSON.stringify(server.metrics)}`);
} finally {
  await stopFirefox();
  await server.close();
}
