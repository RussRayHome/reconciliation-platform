import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export default defineConfig({
  plugins: [react()],
  resolve: {
    tsconfigPaths: true,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('recharts')) return 'charts';
            if (
              id.includes('react') ||
              id.includes('react-dom') ||
              id.includes('@tanstack/react-query')
            ) {
              return 'vendor';
            }
          }
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
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
  },
});
