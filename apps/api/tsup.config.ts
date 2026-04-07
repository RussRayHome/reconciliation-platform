import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/migrate.ts'],
  format: ['cjs'],
  outDir: 'dist',
  noExternal: ['@recon/config', '@recon/core', '@recon/domain', '@recon/persistence'],
});