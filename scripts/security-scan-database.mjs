/* global process */

process.argv.push('--component', 'database');
await import('./security-component-scan.mjs');
