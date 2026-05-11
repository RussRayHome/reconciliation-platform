/* global process */

process.argv.push('--component', 'web');
await import('./security-component-scan.mjs');
