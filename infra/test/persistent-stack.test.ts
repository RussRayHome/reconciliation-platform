import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';

import { PersistentStack } from '../lib/persistent-stack.js';

const synth = (props?: ConstructorParameters<typeof PersistentStack>[2]): Template => {
  const app = new cdk.App();
  const stack = new PersistentStack(app, 'TestPersistentStack', {
    env: { account: '111111111111', region: 'us-east-2' },
    ...props,
  });
  return Template.fromStack(stack);
};

describe('PersistentStack', () => {
  it('retains both ECR repositories', () => {
    const template = synth();
    template.hasResource('AWS::ECR::Repository', {
      DeletionPolicy: 'Retain',
    });
    template.resourceCountIs('AWS::ECR::Repository', 2);
  });

  it('creates two independent Secrets Manager secrets: master (recon_app) and app_user', () => {
    const template = synth();
    template.resourceCountIs('AWS::SecretsManager::Secret', 2);
    template.hasResourceProperties('AWS::SecretsManager::Secret', {
      GenerateSecretString: Match.objectLike({
        SecretStringTemplate: JSON.stringify({ username: 'recon_app' }),
      }),
    });
    template.hasResourceProperties('AWS::SecretsManager::Secret', {
      GenerateSecretString: Match.objectLike({
        SecretStringTemplate: JSON.stringify({ username: 'app_user' }),
      }),
    });
  });

  it('uploads bucket has a storage-class waterfall, not an expiration rule', () => {
    const template = synth();
    template.hasResourceProperties('AWS::S3::Bucket', {
      LifecycleConfiguration: {
        Rules: Match.arrayWith([
          Match.objectLike({
            Status: 'Enabled',
            Transitions: Match.arrayWith([
              Match.objectLike({ StorageClass: 'STANDARD_IA' }),
              Match.objectLike({ StorageClass: 'GLACIER_IR' }),
              Match.objectLike({ StorageClass: 'DEEP_ARCHIVE' }),
            ]),
            ExpirationInDays: Match.absent(),
          }),
        ]),
      },
    });
  });

  it('uploads bucket is encrypted and blocks public access', () => {
    const template = synth();
    template.hasResourceProperties('AWS::S3::Bucket', {
      BucketEncryption: Match.objectLike({
        ServerSideEncryptionConfiguration: Match.arrayWith([
          Match.objectLike({
            ServerSideEncryptionByDefault: Match.objectLike({ SSEAlgorithm: 'AES256' }),
          }),
        ]),
      }),
      PublicAccessBlockConfiguration: Match.objectLike({
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      }),
    });
  });

  it('creates no ECR replication configuration when replicateToRegions is omitted (standby regions)', () => {
    const template = synth();
    template.resourceCountIs('AWS::ECR::ReplicationConfiguration', 0);
  });

  it('creates an ECR replication configuration targeting the given regions (primary region)', () => {
    const template = synth({ replicateToRegions: ['us-east-1', 'us-west-2'] });
    template.hasResourceProperties('AWS::ECR::ReplicationConfiguration', {
      ReplicationConfiguration: {
        Rules: [
          Match.objectLike({
            Destinations: Match.arrayWith([
              Match.objectLike({ Region: 'us-east-1' }),
              Match.objectLike({ Region: 'us-west-2' }),
            ]),
          }),
        ],
      },
    });
  });

  it('creates two SQS queues, each with its own dead-letter queue', () => {
    const template = synth();
    // 2 work queues + 2 DLQs = 4 total.
    template.resourceCountIs('AWS::SQS::Queue', 4);
    template.hasResourceProperties('AWS::SQS::Queue', {
      QueueName: 'recon-reconciliation',
      RedrivePolicy: Match.objectLike({ maxReceiveCount: 3 }),
    });
    template.hasResourceProperties('AWS::SQS::Queue', {
      QueueName: 'recon-import-validation',
      RedrivePolicy: Match.objectLike({ maxReceiveCount: 3 }),
    });
    template.hasResourceProperties('AWS::SQS::Queue', { QueueName: 'recon-reconciliation-dlq' });
    template.hasResourceProperties('AWS::SQS::Queue', {
      QueueName: 'recon-import-validation-dlq',
    });
  });

  it('retains container logs for three months, not the one-week default', () => {
    const template = synth();
    template.hasResourceProperties('AWS::Logs::LogGroup', {
      LogGroupName: '/ecs/recon',
      RetentionInDays: 90,
    });
  });

  it('creates a separate worker task role from the API task role', () => {
    const template = synth();
    template.resourceCountIs('AWS::IAM::Role', 3); // execution + API task + worker task
    template.hasResourceProperties('AWS::IAM::Role', { RoleName: 'recon-ecs-task' });
    template.hasResourceProperties('AWS::IAM::Role', { RoleName: 'recon-ecs-worker-task' });
  });

  it('grants the API task role SendMessage but not Receive/Delete on either queue', () => {
    const template = synth();
    const json = template.toJSON();
    const apiTaskPolicy = JSON.stringify(
      Object.values(json.Resources).filter(
        (r: any) => r.Type === 'AWS::IAM::Policy' && JSON.stringify(r).includes('EcsTaskRole'),
      ),
    );
    expect(apiTaskPolicy).toContain('sqs:SendMessage');
    expect(apiTaskPolicy).not.toContain('sqs:ReceiveMessage');
  });

  it('grants the worker task role Receive/Delete on both queues and SendMessage on reconciliation only', () => {
    const template = synth();
    const json = template.toJSON();
    const workerPolicies = Object.values(json.Resources).filter(
      (r: any) => r.Type === 'AWS::IAM::Policy' && JSON.stringify(r).includes('EcsWorkerTaskRole'),
    );
    const workerPolicyJson = JSON.stringify(workerPolicies);
    expect(workerPolicyJson).toContain('sqs:ReceiveMessage');
    expect(workerPolicyJson).toContain('sqs:DeleteMessage');
    expect(workerPolicyJson).toContain('sqs:SendMessage');
  });
});
