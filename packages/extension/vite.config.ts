import { defineConfig } from 'vite';
import { resolve } from 'path';

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

// Note: inject.js is loaded directly via "world": "MAIN" in Chrome manifest
// Firefox/Safari use the fallback in content.ts which loads via script.src

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

      },
    },
  ],
});
