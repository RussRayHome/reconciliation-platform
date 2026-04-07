import { describe, expect, it } from 'vitest';

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('NGINX Configuration', () => {
  it('is valid', () => {
    const config = fs.readFileSync('apps/web/nginx.conf', 'utf-8');
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nginx-config-'));
    const tempConfigPath = path.join(tempDir, 'default.conf');

    fs.writeFileSync(tempConfigPath, config.replace('http://api:4000', 'http://127.0.0.1:4000'));

    try {
      const output = execSync(
        `docker run --rm -v "${tempConfigPath}:/etc/nginx/conf.d/default.conf:ro" nginxinc/nginx-unprivileged:1.28-alpine nginx -t 2>&1`,
        { encoding: 'utf-8' },
      );
      expect(output).toContain('syntax is ok');
      expect(output).toContain('test is successful');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('contains expected proxy rules', () => {
    const config = fs.readFileSync('apps/web/nginx.conf', 'utf-8');
    expect(config).toContain('proxy_pass http://api:4000;');
    expect(config).toContain('location /api/');
  });
});