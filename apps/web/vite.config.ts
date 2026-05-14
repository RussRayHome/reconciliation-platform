import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const rewriteEnvironmentDashboardPath = (url: string | undefined): string | null => {
  if (!url) {
    return null;
  }

  const [pathname, query = ''] = url.split('?', 2);

  if (!pathname || !/^\/[A-Za-z0-9_-]+\/developer-dashboard\.html$/.test(pathname)) {
    return null;
  }

  return query ? `/developer-dashboard.html?${query}` : '/developer-dashboard.html';
};

const environmentDashboardRewritePlugin = (): Plugin => ({
  name: 'environment-dashboard-rewrite',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      const rewrittenUrl = rewriteEnvironmentDashboardPath(req.url);

      if (rewrittenUrl) {
        req.url = rewrittenUrl;
      }

      next();
    });
  },
  configurePreviewServer(server) {
    server.middlewares.use((req, _res, next) => {
      const rewrittenUrl = rewriteEnvironmentDashboardPath(req.url);

      if (rewrittenUrl) {
        req.url = rewrittenUrl;
      }

      next();
    });
  },
});

export default defineConfig({
  plugins: [react(), environmentDashboardRewritePlugin()],
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
