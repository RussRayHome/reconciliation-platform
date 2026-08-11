import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// packages/core/src/security -> repo root.
const REPO_ROOT = resolve(__dirname, '../../../..');

const SCANNED_EXTENSIONS = new Set(['.css', '.html', '.ts', '.tsx']);
const SKIPPED_DIRS = new Set(['node_modules', 'dist', 'coverage', '.turbo']);

// Matches the actual load-bearing syntax that makes a browser or bundler fetch a static asset
// from a remote host: an external CSS @import, a CSS url(...) pointing off-origin (self-hosted
// assets use relative paths, never a protocol), or an HTML script/link tag loading from another
// host. This deliberately does NOT match .ts/.tsx source: those legitimately construct `new
// URL('https://...')` for runtime API calls (e.g. developer-dashboard-api's GitHub OAuth client)
// that have nothing to do with the bug class this guards against -- assets baked into the shipped
// bundle. It's also narrower than "contains http://" for the files it does check -- a naive
// substring scan would flag legitimate doc-comment references, e.g. fonts.css's own regeneration
// instructions, which link to the Google Fonts API that produced the self-hosted files it replaced.
const CSS_ASSET_PATTERN = /@import\s*(?:url\()?['"]?https?:\/\/|url\(\s*['"]?https?:\/\//;
const HTML_ASSET_PATTERN = /<script[^>]*\ssrc=['"]https?:\/\/|<link[^>]*\shref=['"]https?:\/\//i;

const patternForFile = (filePath: string): RegExp | null => {
  if (filePath.endsWith('.css')) return CSS_ASSET_PATTERN;
  // .tsx can contain literal <script>/<link> JSX; plain .ts cannot and is skipped, since it's
  // where the new URL('https://...') false positive (see above) would otherwise show up.
  if (filePath.endsWith('.html') || filePath.endsWith('.tsx')) return HTML_ASSET_PATTERN;
  return null;
};

const walk = (dir: string, files: string[]): void => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIPPED_DIRS.has(entry.name)) continue;
      walk(join(dir, entry.name), files);
      continue;
    }
    const ext = entry.name.slice(entry.name.lastIndexOf('.'));
    if (SCANNED_EXTENSIONS.has(ext)) files.push(join(dir, entry.name));
  }
};

const collectSourceFiles = (): string[] => {
  const files: string[] = [];
  for (const group of ['apps', 'packages']) {
    for (const name of readdirSync(join(REPO_ROOT, group))) {
      const srcDir = join(REPO_ROOT, group, name, 'src');
      if (statSync(srcDir, { throwIfNoEntry: false })?.isDirectory()) walk(srcDir, files);

      const indexHtml = join(REPO_ROOT, group, name, 'index.html');
      if (statSync(indexHtml, { throwIfNoEntry: false })?.isFile()) files.push(indexHtml);
    }
  }
  return files;
};

// This is the regression test for ISSUE-110, the bug that broke e2e-visual CI:
// apps/web/src/styles/index.css
// used to open with a CSS @import of a Google-hosted font stylesheet, an external CDN fetch that
// raced font-loading against the visual-baseline screenshots. All application assets -- fonts,
// styles, scripts -- must ship inside the bundle, not be fetched from a third party at runtime.
// See the CSP header in apps/web/nginx.conf for the browser-enforced backstop.
describe('no external asset sources in application code', () => {
  const sourceFiles = collectSourceFiles();
  const checkedFiles = sourceFiles.filter((filePath) => patternForFile(filePath) !== null);

  it('found source files to scan', () => {
    expect(checkedFiles.length).toBeGreaterThan(30);
  });

  it.each(checkedFiles)('does not reference an external asset source: %s', (filePath) => {
    const pattern = patternForFile(filePath) as RegExp;
    const contents = readFileSync(filePath, 'utf-8');
    const match = contents.match(pattern);
    const relativePath = filePath.slice(REPO_ROOT.length + 1);
    expect(match, `${relativePath} references an external source: ${match?.[0]}`).toBeNull();
  });
});
