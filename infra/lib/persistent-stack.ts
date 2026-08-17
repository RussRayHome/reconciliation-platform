import * as cdk from 'aws-cdk-lib';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import type { Construct } from 'constructs';
import { APP, APP_USER, DB_USER } from './config.js';

export interface PersistentStackProps extends cdk.StackProps {
  /** Region codes to replicate ECR images to (the app account's other DR regions). Only the
   *  primary region's instantiation of this stack should pass a non-empty list -- standby
   *  regions receive replicated images, they don't originate any. */
  readonly replicateToRegions?: string[];
}

/**
 * Long-lived infrastructure resources shared across ephemeral environment deployments.
 *
 * This stack provisions durable repositories, storage, IAM roles, and database credentials
 * that are referenced by runtime stacks and retained across teardown/recreate cycles.
 */
export class PersistentStack extends cdk.Stack {
  /** ECR repository used for API image pushes and deployments. */
  readonly apiRepo: ecr.Repository;
  /** ECR repository used for web image pushes and deployments. */
  readonly webRepo: ecr.Repository;
  /** S3 bucket for uploaded source workbooks and related artifacts. */
  readonly uploadsBucket: s3.Bucket;
  /** ECS execution role used for pulling images and publishing container logs. */
  readonly executionRole: iam.Role;
  /** ECS task role for the API service: enqueues jobs (SendMessage) but never consumes them. */
  readonly taskRole: iam.Role;
  /** ECS task role for the worker service: consumes both queues (Receive/Delete), plus
   *  SendMessage on reconciliationQueue only -- the import-validation worker chains into
   *  reconciliation once a run is approved (triggerMatchingForImportRun), so it needs to enqueue
   *  there itself. Deliberately separate from taskRole: the API never consumes, the worker never
   *  needs SendMessage on importValidationQueue -- least-privilege per service, not one shared
   *  do-everything role. */
  readonly workerTaskRole: iam.Role;
  /** SQS queue for reconciliation (matching) jobs -- production's replacement for the
   *  Redis-backed BullMQ queue Dev/Stage uses (see reconciliationQueue.ts). Standard queue: no
   *  evidence ordering matters, and BullMQ's own default isn't FIFO either. */
  readonly reconciliationQueue: sqs.Queue;
  /** SQS queue for file-import validation jobs -- production's replacement for
   *  importValidationQueue.ts's BullMQ queue. */
  readonly importValidationQueue: sqs.Queue;
  /** Secret containing the database master/owner (recon_app) credentials used by migrations. */
  readonly dbSecret: secretsmanager.Secret;
  /** Secret containing the least-privilege runtime role (app_user) credentials the API connects
   *  as -- mirrors the credential Docker/local already uses (compose.yaml's API_DATABASE_URL),
   *  so RLS (ADR-0001) is actually enforced in production instead of the master role bypassing
   *  it. Postgres itself doesn't learn this generated password automatically: run
   *  `ALTER ROLE app_user WITH PASSWORD '<value>'` once per fresh database -- see README.md. */
  readonly appUserSecret: secretsmanager.Secret;
  /** Shared ECS container log group. Lives here, not in EphemeralStack, so the write grant to
   * executionRole (also defined here) stays a same-stack reference -- granting write access to a
   * log group owned by EphemeralStack while EphemeralStack's task definitions already depend on
   * this stack's executionRole creates a circular stack dependency (ReconEphemeralStack needs
   * executionRole from ReconPersistentStack; the log-group grant would need ReconPersistentStack
   * to reference a resource from ReconEphemeralStack). */
  readonly logGroup: logs.LogGroup;

  /**
   * Creates the persistent baseline infrastructure resources for the platform.
   */
  constructor(scope: Construct, id: string, props?: PersistentStackProps) {
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

    // Registry-wide replication (not per-repository) to the other DR regions, so images pushed
    // once to the primary region's ECR are already present in standby regions before a real
    // failover happens -- avoids a "rebuild and push images" step in incident response.
    if (props?.replicateToRegions && props.replicateToRegions.length > 0) {
      new ecr.CfnReplicationConfiguration(this, 'EcrReplication', {
        replicationConfiguration: {
          rules: [
            {
              destinations: props.replicateToRegions.map((region) => ({
                region,
                registryId: cdk.Stack.of(this).account,
              })),
            },
          ],
        },
      });
    }

    // S3 — durable originals (financial source documents): a storage-class waterfall moves older
    // files into cheaper tiers over time rather than deleting them. Day-thresholds are a proposed
    // default, easy to tune.
    this.uploadsBucket = new s3.Bucket(this, 'UploadsBucket', {
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      encryption: s3.BucketEncryption.S3_MANAGED,
      lifecycleRules: [
        {
          transitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: cdk.Duration.days(30),
            },
            {
              storageClass: s3.StorageClass.GLACIER_INSTANT_RETRIEVAL,
              transitionAfter: cdk.Duration.days(90),
            },
            {
              storageClass: s3.StorageClass.DEEP_ARCHIVE,
              transitionAfter: cdk.Duration.days(365),
            },
          ],
        },
      ],
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

    this.workerTaskRole = new iam.Role(this, 'EcsWorkerTaskRole', {
      roleName: `${APP}-ecs-worker-task`,
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });
    this.uploadsBucket.grantReadWrite(this.workerTaskRole);

    // SQS — production's queue backend (Dev/Stage stays on the Redis-backed BullMQ queues in
    // apps/api/src/services/reconciliationQueue.ts / importValidationQueue.ts; QUEUE_BACKEND
    // picks between them at runtime). One DLQ per queue: after maxReceiveCount failed attempts, a
    // message moves to the DLQ instead of retrying forever. visibilityTimeout is generous because
    // reconciliation/validation jobs can run long -- too short and ECS would see the same message
    // redelivered to a second worker while the first is still processing it.
    const reconciliationDlq = new sqs.Queue(this, 'ReconciliationDlq', {
      queueName: `${APP}-reconciliation-dlq`,
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      retentionPeriod: cdk.Duration.days(14),
    });
    this.reconciliationQueue = new sqs.Queue(this, 'ReconciliationQueue', {
      queueName: `${APP}-reconciliation`,
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      visibilityTimeout: cdk.Duration.minutes(15),
      deadLetterQueue: { queue: reconciliationDlq, maxReceiveCount: 3 },
    });

    const importValidationDlq = new sqs.Queue(this, 'ImportValidationDlq', {
      queueName: `${APP}-import-validation-dlq`,
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      retentionPeriod: cdk.Duration.days(14),
    });
    this.importValidationQueue = new sqs.Queue(this, 'ImportValidationQueue', {
      queueName: `${APP}-import-validation`,
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      visibilityTimeout: cdk.Duration.minutes(15),
      deadLetterQueue: { queue: importValidationDlq, maxReceiveCount: 3 },
    });

    // API enqueues onto either queue (POST /api/reconciliation/run -> reconciliationQueue
    // directly; the import pipeline -> importValidationQueue), but never consumes.
    this.reconciliationQueue.grantSendMessages(this.taskRole);
    this.importValidationQueue.grantSendMessages(this.taskRole);

    // Worker consumes both queues, and additionally enqueues onto reconciliationQueue itself --
    // once an import run is approved, the worker chains straight into triggering a reconciliation
    // job (triggerMatchingForImportRun in apps/api/src/app.ts) without going back through the API.
    this.reconciliationQueue.grantConsumeMessages(this.workerTaskRole);
    this.importValidationQueue.grantConsumeMessages(this.workerTaskRole);
    this.reconciliationQueue.grantSendMessages(this.workerTaskRole);

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

    // app_user secret — see the field's own doc comment. Generated independently of dbSecret:
    // app_user is a distinct Postgres role from recon_app, with its own password.
    this.appUserSecret = new secretsmanager.Secret(this, 'AppUserSecret', {
      secretName: `${APP}/app-user-credentials`,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: APP_USER }),
        generateStringKey: 'password',
        excludePunctuation: true,
        passwordLength: 32,
      },
    });
    this.appUserSecret.grantRead(this.taskRole);
    this.appUserSecret.grantRead(this.workerTaskRole);
    this.appUserSecret.grantRead(this.executionRole);

    // Container log group -- see the field's own doc comment for why this lives here rather
    // than in EphemeralStack (which creates the task definitions that write to it).
    this.logGroup = new logs.LogGroup(this, 'LogGroup', {
      logGroupName: `/ecs/${APP}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Outputs — ECR push URIs printed after `cdk deploy ReconPersistentStack`
    new cdk.CfnOutput(this, 'ApiRepoUri', { value: this.apiRepo.repositoryUri });
    new cdk.CfnOutput(this, 'WebRepoUri', { value: this.webRepo.repositoryUri });
    new cdk.CfnOutput(this, 'UploadsBucketName', { value: this.uploadsBucket.bucketName });
    new cdk.CfnOutput(this, 'ReconciliationQueueUrl', { value: this.reconciliationQueue.queueUrl });
    new cdk.CfnOutput(this, 'ImportValidationQueueUrl', {
      value: this.importValidationQueue.queueUrl,
    });
  }
}
