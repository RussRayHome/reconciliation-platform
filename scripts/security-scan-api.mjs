/* global process */

process.argv.push('--component', 'api');
await import('./security-component-scan.mjs');
