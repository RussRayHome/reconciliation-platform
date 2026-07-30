// Copies src/styles/tokens.css into public/dashboard-styles/tokens.css.
// The Developer Dashboard is served by the tools server, which only sees
// public/ — this copy is the ONLY file shared with the app stylesheet tree.
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src/styles/tokens.css');
const dest = join(root, 'public/dashboard-styles/tokens.css');

const header = '/* GENERATED — edit src/styles/tokens.css and run sync:dashboard-tokens */\n';
writeFileSync(dest, header + readFileSync(src, 'utf8'));
console.log('dashboard tokens synced ->', dest);
