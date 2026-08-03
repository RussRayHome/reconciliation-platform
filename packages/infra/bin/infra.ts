#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { EphemeralStack } from '../lib/ephemeral-stack.js';
import { PersistentStack } from '../lib/persistent-stack.js';
import { env } from '../lib/config.js';

const app = new cdk.App();

const persistent = new PersistentStack(app, 'ReconPersistentStack', {
  env,
  description: 'Recon PROD — persistent resources (ECR, S3, IAM, DB secret). Never destroy.',
});

new EphemeralStack(app, 'ReconEphemeralStack', {
  env,
  persistent,
  description:
    'Recon PROD — ephemeral compute (VPC, NAT, RDS, ECS, ALB). Safe to destroy when idle.',
});
