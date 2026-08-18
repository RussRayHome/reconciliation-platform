import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';

import { DnsStack } from '../lib/dns-stack.js';
import { DOMAIN_NAME } from '../lib/config.js';

describe('DnsStack', () => {
  it('creates the hosted zone with no record when no active region is given (first deploy)', () => {
    const app = new cdk.App();
    const stack = new DnsStack(app, 'TestDnsStack', {
      env: { account: '111111111111', region: 'us-east-1' },
    });
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::Route53::HostedZone', {
      Name: `${DOMAIN_NAME}.`,
    });
    template.resourceCountIs('AWS::Route53::RecordSet', 0);
  });

  it('creates an apex alias record pointing at the active region ALB when given', () => {
    const app = new cdk.App();
    const stack = new DnsStack(app, 'TestDnsStack', {
      env: { account: '111111111111', region: 'us-east-1' },
      activeRegionAlbDnsName: 'my-alb-123.us-east-2.elb.amazonaws.com',
      activeRegion: 'us-east-2',
    });
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::Route53::RecordSet', {
      Name: `${DOMAIN_NAME}.`,
      Type: 'A',
      AliasTarget: Match.objectLike({
        DNSName: 'my-alb-123.us-east-2.elb.amazonaws.com',
        HostedZoneId: 'Z3AADJGX6KTTL2',
        EvaluateTargetHealth: true,
      }),
    });
  });

  it('throws for an active region with no known ALB hosted zone id', () => {
    const app = new cdk.App();
    expect(
      () =>
        new DnsStack(app, 'TestDnsStack', {
          env: { account: '111111111111', region: 'us-east-1' },
          activeRegionAlbDnsName: 'my-alb.example.com',
          activeRegion: 'eu-west-1',
        }),
    ).toThrow(/No known ALB hosted zone id/);
  });
});
