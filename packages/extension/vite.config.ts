import { defineConfig } from 'vite';
import { resolve } from 'path';
import { readFileSync, writeFileSync } from 'fs';

// Build background separately as IIFE since Safari service workers don't support ES modules well
import { build } from 'vite';

const extensionE2EDefines = {
  __WINDOWLLM_EXTENSION_E2E__: JSON.stringify(process.env.WINDOWLLM_EXTENSION_E2E === '1'),
  __WINDOWLLM_EXTENSION_E2E_URL__: JSON.stringify(
    process.env.WINDOWLLM_EXTENSION_E2E_URL || 'http://127.0.0.1:3199',
  ),
};

async function buildBackground() {
  await build({
    configFile: false,
    define: extensionE2EDefines,
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      lib: {
        entry: resolve(__dirname, 'src/background.ts'),
        name: 'background',
        fileName: () => 'background.js',
        formats: ['iife'],
      },
      sourcemap: true,
      minify: true,
    },
  });
}

// Note: inject.js is loaded directly via "world": "MAIN" in Chrome manifest
// Firefox/Safari use the fallback in content.ts which loads via script.src

export default defineConfig({
  define: extensionE2EDefines,
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Use lib mode with inject as entry
    lib: {
      entry: resolve(__dirname, 'src/inject.ts'),
      name: 'inject',
      fileName: () => 'inject.js',
      formats: ['iife'],
    },
    sourcemap: true,
    minify: true,
  },
  plugins: [
    {
      name: 'build-all-iife',
      async closeBundle() {
        // Build background script
        await buildBackground();

        // Build content script as IIFE
        await build({
          configFile: false,
          build: {
            outDir: 'dist',
            emptyOutDir: false,
            lib: {
              entry: resolve(__dirname, 'src/content.ts'),
              name: 'content',
              fileName: () => 'content.js',
              formats: ['iife'],
            },
            sourcemap: true,
            minify: true,
          },
        });

        // Inline the built inject.js source into content.js so Firefox/Safari
        // can execute it SYNCHRONOUSLY (see content.ts). content.ts carries the
        // literal placeholder '__WINDOWLLM_INJECT_SOURCE__'; replace it with the
        // JSON-encoded inject bundle. Chrome ignores this path (world:MAIN).
        const contentPath = resolve(__dirname, 'dist/content.js');
        const injectSource = readFileSync(resolve(__dirname, 'dist/inject.js'), 'utf8');
        const placeholder = '__WINDOWLLM_INJECT_SOURCE__';
        let content = readFileSync(contentPath, 'utf8');
        // The minifier keeps the string literal; replace both quote styles.
        content = content
          .split(`"${placeholder}"`).join(JSON.stringify(injectSource))
          .split(`'${placeholder}'`).join(JSON.stringify(injectSource));
        writeFileSync(contentPath, content);
      },
    },
  ],
});
