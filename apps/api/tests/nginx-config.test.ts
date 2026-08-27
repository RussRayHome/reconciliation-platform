import { beforeAll, describe, expect, it } from 'vitest';

import { execSync } from 'node:child_process';
import fs, { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { commandSucceeded, dockerGate, hasCommand } from './testHelpers/dockerGate';

// Must match apps/web/Dockerfile's actual runtime base image exactly -- drift review finding #08
// caught this file silently validating against a DIFFERENT tag (1.28-alpine) than what's shipped
// (mainline-alpine), so this test could never have caught a real nginx config regression even
// when it did run. mainline-alpine is a deliberately floating tag (Issue #205: lets `apk upgrade`
// pick up current CVE fixes at build time), not a bug to "fix" by pinning here.
const NGINX_TEST_IMAGE = 'nginxinc/nginx-unprivileged:mainline-alpine';

const hasDockerDaemon = hasCommand('docker') && commandSucceeded('docker info >/dev/null 2>&1');

const hasLocalDockerImage = (image: string): boolean => {
  if (!hasDockerDaemon) {
    return false;
  }

  return commandSucceeded(`docker image inspect ${image} >/dev/null 2>&1`, 3000);
};

const gate = dockerGate(
  hasLocalDockerImage(NGINX_TEST_IMAGE),
  `Docker with ${NGINX_TEST_IMAGE} pulled`,
);
const dockerTest = gate.test;

describe('NGINX Configuration', () => {
  beforeAll(gate.assertAvailable);

  dockerTest('is valid', { timeout: 90000 }, () => {
    const config = fs
      .readFileSync('apps/web/nginx.conf', 'utf-8')
      .replaceAll('http://api:4000', 'http://127.0.0.1:4000')
      .replaceAll('http://pgweb:8081', 'http://127.0.0.1:8081');

    // nginx.conf references a TLS cert/key (ssl_certificate/ssl_certificate_key) that piping the
    // config alone via stdin can't provide -- `nginx -t` genuinely tries to load them, so this
    // test previously failed outright the moment the skip that hid it (see dockerGate above) was
    // fixed. certs/dev/ is gitignored and may not exist on a fresh checkout, so this generates its
    // own throwaway self-signed cert rather than depending on it -- `nginx -t` only checks that
    // the files parse as valid PEM, not that they're trusted.
    //
    // Uses `docker create` + `docker cp` instead of a bind mount for the same reason the config
    // itself goes over stdin: a bind mount's HOST path has to exist on whatever daemon the Docker
    // CLI is actually talking to, which fails when that's a remote/different daemon (e.g. this
    // suite running inside its own container). `docker cp` streams file content over the Docker
    // API instead, so it works regardless of where the daemon lives.
    const scratchDir = mkdtempSync(join(tmpdir(), 'nginx-config-test-'));
    // /etc/nginx/certs/ isn't part of the base image (only /etc/nginx/conf.d/ ships by default),
    // and a single-file `docker cp` into a not-yet-existing directory fails outright -- copying an
    // entire local directory as one `docker cp` call DOES create the destination directory, so the
    // two cert files live in their own local subdirectory for that reason, not just tidiness.
    const certsDir = join(scratchDir, 'certs');
    fs.mkdirSync(certsDir);
    const certPath = join(certsDir, 'dev-cert.pem');
    const keyPath = join(certsDir, 'dev-key.pem');
    const configPath = join(scratchDir, 'default.conf');
    execSync(
      `openssl req -x509 -newkey rsa:2048 -sha256 -days 1 -nodes ` +
        `-keyout ${keyPath} -out ${certPath} -subj "/CN=localhost"`,
      { stdio: 'ignore' },
    );
    // openssl writes the key 600 (owner-only) by default; nginxinc/nginx-unprivileged runs nginx
    // as a non-root user that doesn't own a freshly docker-cp'd file, so it can't read it at that
    // mode. This is a throwaway cert regenerated and deleted every run (see the `finally` below),
    // not a real secret, so relaxing it is safe here specifically.
    fs.chmodSync(keyPath, 0o644);
    fs.writeFileSync(configPath, config, 'utf-8');

    const containerName = `nginx-config-test-${process.pid}`;
    try {
      execSync(
        `docker create --name ${containerName} ${NGINX_TEST_IMAGE} sh -c "nginx -t 2>&1"`,
        { stdio: 'ignore' },
      );
      execSync(`docker cp ${configPath} ${containerName}:/etc/nginx/conf.d/default.conf`);
      execSync(`docker cp ${certsDir} ${containerName}:/etc/nginx/certs`);
      const output = execSync(`docker start --attach ${containerName}`, {
        encoding: 'utf-8',
        timeout: 60000,
      });
      expect(output).toContain('syntax is ok');
      expect(output).toContain('test is successful');
    } finally {
      execSync(`docker rm -f ${containerName}`, { stdio: 'ignore' });
      rmSync(scratchDir, { recursive: true, force: true });
    }
  });

  it('contains expected proxy rules', () => {
    const config = fs.readFileSync('apps/web/nginx.conf', 'utf-8');
    expect(config).toContain('proxy_pass http://api:4000;');
    expect(config).toContain('location /api/');
    expect(config).toContain('location ~ ^/(?<env_segment>[A-Za-z0-9_-]+)/pgweb$');
    expect(config).toContain('return 302 $scheme://$http_host/$env_segment/pgweb/;');
    expect(config).toContain('location ~ ^/[A-Za-z0-9_-]+/pgweb(?:/.*)?$');
    expect(config).toContain('set $pgweb_upstream http://pgweb:8081;');
    expect(config).toContain('proxy_pass $pgweb_upstream;');
  });
});
