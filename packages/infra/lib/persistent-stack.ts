import * as cdk from 'aws-cdk-lib';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import type { Construct } from 'constructs';
import { APP, DB_USER } from './config.js';

export class PersistentStack extends cdk.Stack {
  readonly apiRepo: ecr.Repository;
  readonly webRepo: ecr.Repository;
  readonly uploadsBucket: s3.Bucket;
  readonly executionRole: iam.Role;
  readonly taskRole: iam.Role;
  readonly dbSecret: secretsmanager.Secret;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ECR — lifecycle rule keeps only the 5 most recent images to limit storage cost
    this.apiRepo = new ecr.Repository(this, 'ApiRepo', {
      repositoryName: `${APP}-api`,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [{ maxImageCount: 5 }],
    });

    this.webRepo = new ecr.Repository(this, 'WebRepo', {
      repositoryName: `${APP}-web`,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [{ maxImageCount: 5 }],
    });

    // S3 — uploads expire after 30 days; increase if you need longer retention
    this.uploadsBucket = new s3.Bucket(this, 'UploadsBucket', {
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [{ expiration: cdk.Duration.days(30) }],
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
    });

    // IAM — ECS execution role (pulls images, writes logs); task role (app-level permissions)
    this.executionRole = new iam.Role(this, 'EcsExecutionRole', {
      roleName: `${APP}-ecs-execution`,
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
      ],
    });

    this.taskRole = new iam.Role(this, 'EcsTaskRole', {
      roleName: `${APP}-ecs-task`,
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });
    this.uploadsBucket.grantReadWrite(this.taskRole);

    // DB secret — persists across EphemeralStack destroy/recreate so the password
    // stays consistent with the RDS snapshot on restore
    this.dbSecret = new secretsmanager.Secret(this, 'DbSecret', {
      secretName: `${APP}/db-credentials`,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: DB_USER }),
        generateStringKey: 'password',
        excludePunctuation: true,
        passwordLength: 32,
      },
    });
    this.dbSecret.grantRead(this.taskRole);
    this.dbSecret.grantRead(this.executionRole);

    // Outputs — ECR push URIs printed after `cdk deploy ReconPersistentStack`
    new cdk.CfnOutput(this, 'ApiRepoUri', { value: this.apiRepo.repositoryUri });
    new cdk.CfnOutput(this, 'WebRepoUri', { value: this.webRepo.repositoryUri });
    new cdk.CfnOutput(this, 'UploadsBucketName', { value: this.uploadsBucket.bucketName });
  }
}
