import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'WindowLLM',
      fileName: 'llm',
      formats: ['es', 'iife'],
    },
    rollupOptions: {
      output: {
        // Ensure the IIFE version exposes nothing globally
        // (it self-installs to window.llm)
        extend: true,
      },
    },
    sourcemap: true,
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: false, // Keep console for debugging
      },
    },
  },
});
