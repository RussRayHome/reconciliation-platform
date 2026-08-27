import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';

import { REGIONS } from '../lib/config.js';
import { EphemeralStack } from '../lib/ephemeral-stack.js';
import { PersistentStack } from '../lib/persistent-stack.js';

const ACCOUNT = '111111111111';

describe('EphemeralStack', () => {
  // Drift review finding #06 (CDK snapshots) -- see PersistentStack's own snapshot test for why
  // this is a separate mechanism from the targeted assertions below, not a replacement for them.
  it('matches the synthesized CloudFormation template snapshot', () => {
    const app = new cdk.App();
    const persistent = new PersistentStack(app, 'TestPersistentStack', {
      env: { account: ACCOUNT, region: 'us-east-2' },
    });
    const ephemeral = new EphemeralStack(app, 'TestEphemeralStack', {
      env: { account: ACCOUNT, region: 'us-east-2' },
      persistent,
    });
    const template = Template.fromStack(ephemeral);

    expect(template.toJSON()).toMatchSnapshot();
  });

  it('connects the API container as app_user, not the recon_app master secret', () => {
    const app = new cdk.App();
    const persistent = new PersistentStack(app, 'TestPersistentStack', {
      env: { account: ACCOUNT, region: 'us-east-2' },
    });
    const ephemeral = new EphemeralStack(app, 'TestEphemeralStack', {
      env: { account: ACCOUNT, region: 'us-east-2' },
      persistent,
    });
    const template = Template.fromStack(ephemeral);

    template.hasResourceProperties('AWS::ECS::TaskDefinition', {
      ContainerDefinitions: Match.arrayWith([
        Match.objectLike({
          Name: 'api',
          Secrets: Match.arrayWith([
            Match.objectLike({ Name: 'DB_USERNAME' }),
            Match.objectLike({ Name: 'DB_PASSWORD' }),
          ]),
          Environment: Match.arrayWith([
            Match.objectLike({ Name: 'RECON_BLOB_STORAGE_BACKEND', Value: 's3' }),
          ]),
        }),
      ]),
    });

    // The Secrets ARNs must reference AppUserSecret's logical id, not DbSecret's -- Template's
    // matcher can't easily assert "not this ARN," so assert the container references some secret
    // whose CloudFormation logical id contains "AppUserSecret".
    const json = template.toJSON();
    const apiContainerSecrets = JSON.stringify(
      Object.values(json.Resources).find(
        (r: any) =>
          r.Type === 'AWS::ECS::TaskDefinition' &&
          r.Properties.ContainerDefinitions.some((c: any) => c.Name === 'api'),
      ),
    );
    expect(apiContainerSecrets).toContain('AppUserSecret');
    expect(apiContainerSecrets).not.toContain('DbSecret');
  });

  it('serves HTTPS with an ACM certificate and redirects plain HTTP', () => {
    const app = new cdk.App();
    const persistent = new PersistentStack(app, 'TestPersistentStack', {
      env: { account: ACCOUNT, region: 'us-east-2' },
    });
    const ephemeral = new EphemeralStack(app, 'TestEphemeralStack', {
      env: { account: ACCOUNT, region: 'us-east-2' },
      persistent,
    });
    const template = Template.fromStack(ephemeral);

    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::Listener', {
      Port: 443,
      Protocol: 'HTTPS',
    });
    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::Listener', {
      Port: 80,
      DefaultActions: Match.arrayWith([
        Match.objectLike({
          Type: 'redirect',
          RedirectConfig: Match.objectLike({ Protocol: 'HTTPS', Port: '443' }),
        }),
      ]),
    });
    template.resourceCountIs('AWS::CertificateManager::Certificate', 1);
  });

  it('runs the worker as its own service, not behind the ALB, with its own security group', () => {
    const app = new cdk.App();
    const persistent = new PersistentStack(app, 'TestPersistentStack', {
      env: { account: ACCOUNT, region: 'us-east-2' },
    });
    const ephemeral = new EphemeralStack(app, 'TestEphemeralStack', {
      env: { account: ACCOUNT, region: 'us-east-2' },
      persistent,
    });
    const template = Template.fromStack(ephemeral);

    // 3 services total: api, web, worker.
    template.resourceCountIs('AWS::ECS::Service', 3);

    template.hasResourceProperties('AWS::ECS::TaskDefinition', {
      ContainerDefinitions: Match.arrayWith([
        Match.objectLike({
          Name: 'worker',
          PortMappings: Match.absent(),
          Environment: Match.arrayWith([
            Match.objectLike({ Name: 'PROCESS_MODE', Value: 'worker' }),
            Match.objectLike({ Name: 'QUEUE_BACKEND', Value: 'sqs' }),
          ]),
        }),
      ]),
    });

    // The worker's security group allows no ingress at all -- it never sits behind the ALB.
    template.hasResourceProperties('AWS::EC2::SecurityGroup', {
      GroupDescription: Match.stringLikeRegexp('Worker Fargate tasks'),
      SecurityGroupIngress: Match.absent(),
    });
  });

  it('scales the worker on queue backlog, targeting both queues', () => {
    const app = new cdk.App();
    const persistent = new PersistentStack(app, 'TestPersistentStack', {
      env: { account: ACCOUNT, region: 'us-east-2' },
    });
    const ephemeral = new EphemeralStack(app, 'TestEphemeralStack', {
      env: { account: ACCOUNT, region: 'us-east-2' },
      persistent,
    });
    const template = Template.fromStack(ephemeral);

    template.resourceCountIs('AWS::ApplicationAutoScaling::ScalingPolicy', 2);
    template.hasResourceProperties('AWS::ApplicationAutoScaling::ScalableTarget', {
      MinCapacity: 1,
      MaxCapacity: 5,
    });
  });

  it('synths all three DR regions together without a circular dependency (PR #129 regression)', () => {
    const app = new cdk.App();

    for (const region of REGIONS) {
      const env = { account: ACCOUNT, region: region.code };
      const persistent = new PersistentStack(app, `TestPersistentStack-${region.code}`, {
        env,
        replicateToRegions: region.primary
          ? REGIONS.filter((r) => !r.primary).map((r) => r.code)
          : undefined,
      });
      new EphemeralStack(app, `TestEphemeralStack-${region.code}`, { env, persistent });
    }

    // DependencyCycle errors only surface at synth time -- this is the direct regression guard.
    expect(() => app.synth()).not.toThrow();
  });
});
