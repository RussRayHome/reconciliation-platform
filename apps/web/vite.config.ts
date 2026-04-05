import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', '@tanstack/react-query'],
          charts: ['recharts'],
        },
      },
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    fs: {
      allow: [workspaceRoot],
    },
    proxy: {
      '/api': {
        target: process.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:4000',
        changeOrigin: true
      }
    }
  },
  preview: {
    host: '127.0.0.1',
    port: 4173
  }
});
