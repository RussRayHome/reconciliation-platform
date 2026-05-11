/* global process */

process.argv.push('--component', 'container');
await import('./security-component-scan.mjs');
