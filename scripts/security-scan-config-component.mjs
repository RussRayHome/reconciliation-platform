/* global process */

process.argv.push('--component', 'config');
await import('./security-component-scan.mjs');
