import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';

// ESM-safe __dirname (package.json has "type": "module")
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// task-180 (B5): pull product version from package.json so the header /
// sidebar / SDK pages never carry a hardcoded "v3.2.0" again.
const pkgJson = JSON.parse(
  readFileSync(path.resolve(__dirname, './package.json'), 'utf-8'),
) as { version: string };
const NV_VERSION = `v${pkgJson.version}`;

const NV_GATEWAY_PORT = process.env.NYV_PORT_GATEWAY || '5000';
const NV_GATEWAY_ORIGIN = `http://localhost:${NV_GATEWAY_PORT}`;

export default defineConfig({
  define: {
    __NV_VERSION__: JSON.stringify(NV_VERSION),
    'import.meta.env.VITE_NV_VERSION': JSON.stringify(NV_VERSION),
  },
  plugins: [react()],
  root: './client',
  base: '/',
  // Vite's `root` is ./client/, so PostCSS would normally search ./client/ first
  // and miss the project-root config — that quietly leaves @tailwind directives
  // unprocessed and yields a CSS bundle with zero utilities. Pin it explicitly.
  css: {
    postcss: path.resolve(__dirname, './postcss.config.js'),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './client/src'),
      '@shared': path.resolve(__dirname, './shared'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5000,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: NV_GATEWAY_ORIGIN,
        changeOrigin: true,
      },
      '/ns': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        ws: true,
      },
      '/health': {
        target: NV_GATEWAY_ORIGIN,
        changeOrigin: true,
      },
      '/professional': {
        target: 'http://localhost:5002',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: '../dist/public',
    emptyOutDir: true,
    sourcemap: false,
  },
});
