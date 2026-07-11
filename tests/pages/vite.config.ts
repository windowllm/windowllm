import { defineConfig } from 'vite';
import { resolve } from 'path';
import fs from 'fs';

// Check if we have local certificates for HTTPS
const certsDir = resolve(__dirname, '../../.certs');
const hasLocalCerts = fs.existsSync(resolve(certsDir, 'key.pem')) &&
                       fs.existsSync(resolve(certsDir, 'cert.pem'));

export default defineConfig({
  root: __dirname,
  server: {
    port: 3101,
    strictPort: true,
    // VITE_HOST_ALL binds all interfaces so a VM (Safari tests) can reach the
    // host via its gateway IP; otherwise host to the loopback hostname.
    host: process.env.VITE_HOST_ALL ? true : 'test.localhost',
    allowedHosts: ['.localhost', '.test'],
    ...(hasLocalCerts && {
      https: {
        key: fs.readFileSync(resolve(certsDir, 'key.pem')),
        cert: fs.readFileSync(resolve(certsDir, 'cert.pem')),
      },
    }),
    headers: {
      'Access-Control-Allow-Origin': '*',
    },
  },
  build: {
    outDir: resolve(__dirname, 'dist'),
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
      },
    },
  },
});
