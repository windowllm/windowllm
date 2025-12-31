import { defineConfig } from 'vite';
import { resolve } from 'path';
import { readFileSync, writeFileSync } from 'fs';

// Build background separately as IIFE since Safari service workers don't support ES modules well
import { build } from 'vite';

async function buildBackground() {
  await build({
    configFile: false,
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

async function buildContentAndInject() {
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

  // Build inject script as IIFE
  await build({
    configFile: false,
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      lib: {
        entry: resolve(__dirname, 'src/inject.ts'),
        name: 'inject',
        fileName: () => 'inject.js',
        formats: ['iife'],
      },
      sourcemap: true,
      minify: true,
    },
  });
}

function inlineInjectIntoContent() {
  const distDir = resolve(__dirname, 'dist');
  const injectPath = resolve(distDir, 'inject.js');
  const contentPath = resolve(distDir, 'content.js');

  try {
    // Read the inject script (remove sourcemap comment)
    let injectCode = readFileSync(injectPath, 'utf-8');
    injectCode = injectCode.replace(/\/\/# sourceMappingURL=.*$/m, '').trim();

    // Read content script
    let contentCode = readFileSync(contentPath, 'utf-8');

    // Replace the async script loading with inline script
    // Handle both minified and non-minified patterns
    contentCode = contentCode.replace(
      /e\.src\s*=\s*chrome\.runtime\.getURL\(["']inject\.js["']\)/,
      `e.textContent = ${JSON.stringify(injectCode)}`
    );

    // Write modified content script
    writeFileSync(contentPath, contentCode);
    console.log('Inlined inject.js into content.js for synchronous execution');
  } catch (error) {
    console.warn('Failed to inline inject script:', error);
  }
}

export default defineConfig({
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

        // Now inline inject.js into content.js
        inlineInjectIntoContent();
      },
    },
  ],
});
