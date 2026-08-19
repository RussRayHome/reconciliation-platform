#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { DnsStack } from '../lib/dns-stack.js';
import { EphemeralStack } from '../lib/ephemeral-stack.js';
import { PersistentStack } from '../lib/persistent-stack.js';
import { account, REGIONS } from '../lib/config.js';

const app = new cdk.App();

// Region-agnostic: the one stack that survives every DR failover. On the very first deploy,
// before any EphemeralStack exists, this creates the zone with no record yet. Once a region's
// EphemeralStack is up, redeploy this stack with -c activeRegionAlbDnsName=<AlbDnsName output>
// and -c activeRegion=<region code> to point the apex domain at it -- see infra/README.md.
new DnsStack(app, 'ReconDnsStack', {
  env: { account, region: 'us-east-1' },
  description: 'Recon PROD — Route53 hosted zone and apex record for the active region.',
  activeRegionAlbDnsName: app.node.tryGetContext('activeRegionAlbDnsName') as string | undefined,
  activeRegion: app.node.tryGetContext('activeRegion') as string | undefined,
});

// One Persistent+Ephemeral stack pair per DR region. Defining all three regions costs nothing --
// CDK only provisions what you actually `cdk deploy <stack-id>`. Day-to-day, only the primary
// region's two stacks are deployed; standby regions exist as ready-to-deploy code (cold standby).
for (const region of REGIONS) {
  const env = { account, region: region.code };
  const suffix = `-${region.code}`;

  const persistent = new PersistentStack(app, `ReconPersistentStack${suffix}`, {
    env,
    description: `Recon PROD (${region.label}) — persistent resources (ECR, S3, IAM, secrets). Never destroy.`,
    replicateToRegions: region.primary
      ? REGIONS.filter((r) => !r.primary).map((r) => r.code)
      : undefined,
  });

  new EphemeralStack(app, `ReconEphemeralStack${suffix}`, {
    env,
    persistent,
    description:
      `Recon PROD (${region.label}) — ephemeral compute (VPC, NAT, RDS, ECS, ALB). ` +
      (region.primary ? 'The live region.' : 'Cold standby — deploy only during a DR failover.'),
  });
}
