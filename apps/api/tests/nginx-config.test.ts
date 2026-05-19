import { describe, expect, it } from 'vitest';

import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';

const hasCommand = (command: string): boolean =>
  spawnSync('sh', ['-c', `command -v ${command} >/dev/null 2>&1`], { stdio: 'ignore' }).status ===
  0;

const dockerTest = hasCommand('docker') ? it : it.skip;

describe('NGINX Configuration', () => {
  dockerTest('is valid', { timeout: 120000 }, () => {
    const config = fs
      .readFileSync('apps/web/nginx.conf', 'utf-8')
      .replaceAll('http://api:4000', 'http://127.0.0.1:4000')
      .replaceAll('http://pgweb:8081', 'http://127.0.0.1:8081');

    // Pipe config via stdin — avoids volume mounts, which fail when this test
    // runs inside a container whose Docker CLI targets the host daemon via socket.
    const output = execSync(
      `docker run --rm -i nginxinc/nginx-unprivileged:1.28-alpine sh -c 'cat > /etc/nginx/conf.d/default.conf && nginx -t 2>&1'`,
      { encoding: 'utf-8', timeout: 90000, input: config },
    );
    expect(output).toContain('syntax is ok');
    expect(output).toContain('test is successful');
  });

  it('contains expected proxy rules', () => {
    const config = fs.readFileSync('apps/web/nginx.conf', 'utf-8');
    expect(config).toContain('proxy_pass http://api:4000;');
    expect(config).toContain('location /api/');
    expect(config).toContain('location ~ ^/(?<env_segment>[A-Za-z0-9_-]+)/dashboard/server$');
    expect(config).toContain(
      'return 302 $scheme://$http_host/$env_segment/developer-dashboard.html;',
    );
    expect(config).toContain(
      'rewrite ^/[A-Za-z0-9_-]+/dashboard/server$ /api/developer/runtime break;',
    );
    expect(config).toContain('location ~ ^/(?<env_segment>[A-Za-z0-9_-]+)/pgweb$');
    expect(config).toContain('return 302 $scheme://$http_host/$env_segment/pgweb/;');
    expect(config).toContain('location ~ ^/[A-Za-z0-9_-]+/pgweb(?:/.*)?$');
    expect(config).toContain('set $pgweb_upstream http://pgweb:8081;');
    expect(config).toContain('proxy_pass $pgweb_upstream;');
  });
});
