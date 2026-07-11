import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import fs from 'fs';

// Check if we have local certificates for HTTPS
const certsDir = resolve(__dirname, '../../.certs');
const hasLocalCerts = fs.existsSync(resolve(certsDir, 'key.pem')) &&
                       fs.existsSync(resolve(certsDir, 'cert.pem'));

// Path to the client library
const clientDistDir = resolve(__dirname, '../client/dist');

// Plugin to serve the llm.js client library and handle SPA routing
function serveClientLibrary(): Plugin {
  return {
    name: 'serve-client-library',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        // Serve client library
        if (req.url === '/llm.js') {
          const clientPath = resolve(clientDistDir, 'llm.iife.js');
          if (fs.existsSync(clientPath)) {
            res.setHeader('Content-Type', 'application/javascript');
            res.setHeader('Access-Control-Allow-Origin', '*');
            fs.createReadStream(clientPath).pipe(res);
            return;
          }
          res.setHeader('Content-Type', 'application/javascript');
          res.end(`console.error('WindowLLM: Client library not built. Run npm run build --workspace=@windowllm/client first.');`);
          return;
        }

        // SPA fallback: serve index.html for /unlock route
        if (req.url?.startsWith('/unlock')) {
          req.url = '/index.html';
        }

        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), serveClientLibrary()],
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  css: {
    postcss: resolve(__dirname, 'postcss.config.js'),
  },
  build: {
    sourcemap: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        frame: resolve(__dirname, 'frame.html'),
        'extension-popup': resolve(__dirname, 'extension-popup.html'),
        'extension-options': resolve(__dirname, 'extension-options.html'),
      },
    },
  },
  server: {
    port: parseInt(process.env.VITE_PORT || '3000', 10),
    strictPort: true,
    // VITE_HOST_ALL binds all interfaces so a VM (Safari tests) can reach the
    // host via its gateway IP; otherwise host to the loopback hostname.
    host: process.env.VITE_HOST_ALL ? true : 'windowllm.localhost',
    allowedHosts: ['.localhost', '.test'],
    ...(hasLocalCerts && {
      https: {
        key: fs.readFileSync(resolve(certsDir, 'key.pem')),
        cert: fs.readFileSync(resolve(certsDir, 'cert.pem')),
      },
    }),
  },
});
