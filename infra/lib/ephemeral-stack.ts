import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as route53 from 'aws-cdk-lib/aws-route53';
import type { Construct } from 'constructs';
import { APP, API_PORT, DB_NAME, DB_USER, DOMAIN_NAME, WEB_PORT } from './config.js';
import type { PersistentStack } from './persistent-stack.js';

interface EphemeralStackProps extends cdk.StackProps {
  persistent: PersistentStack;
}

/**
 * Ephemeral runtime infrastructure stack for deployable API/Web services and database compute.
 *
 * This stack depends on `PersistentStack` for shared resources while allowing the runtime
 * environment to be safely recreated or restored from snapshots.
 */
export class EphemeralStack extends cdk.Stack {
  /**
   * Creates runtime networking, database, ECS services, and load-balancer routing.
   */
  constructor(scope: Construct, id: string, props: EphemeralStackProps) {
    super(scope, id, props);

    const { persistent } = props;

    // Pass -c rdsSnapshotId=<id> to cdk deploy to restore from a snapshot
    const snapshotId = this.node.tryGetContext('rdsSnapshotId') as string | undefined;

    // VPC — single NAT Gateway to minimize cost (~$33/month vs ~$66 for two)
    const vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        { name: 'Public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: 'Private', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
      ],
    });

    // Security groups
    const albSg = new ec2.SecurityGroup(this, 'AlbSg', {
      vpc,
      description: 'ALB — allow HTTP/HTTPS inbound',
    });
    albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80));
    albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443));

    const ecsSg = new ec2.SecurityGroup(this, 'EcsSg', {
      vpc,
      description: 'ECS Fargate tasks (API, web) — reachable from the ALB',
    });
    ecsSg.addIngressRule(albSg, ec2.Port.allTcp());

    // Separate from ecsSg: the worker never sits behind the ALB and never receives inbound
    // traffic at all -- it only makes outbound calls (RDS, S3, SQS), which security groups allow
    // by default. No ingress rule needed or added.
    const workerSg = new ec2.SecurityGroup(this, 'WorkerSg', {
      vpc,
      description: 'Worker Fargate tasks — outbound only, never behind the ALB',
    });

    const dbSg = new ec2.SecurityGroup(this, 'DbSg', {
      vpc,
      description: 'RDS — ECS tasks only',
    });
    dbSg.addIngressRule(ecsSg, ec2.Port.tcp(5432));
    dbSg.addIngressRule(workerSg, ec2.Port.tcp(5432));

    // RDS PostgreSQL 16
    // On first deploy: fresh instance using the persisted secret for credentials.
    // On rebuild after teardown: pass -c rdsSnapshotId=<id> to restore from snapshot;
    // CDK rotates the master password to match the persisted secret so they stay in sync.
    const dbCommonProps = {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_16,
      }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [dbSg],
      databaseName: DB_NAME,
      storageEncrypted: true,
      multiAz: false,
      // Manual snapshots (teardown.sh, dr-snapshot-copy.sh) are the primary DR mechanism, but a
      // 1-day automated-backup window costs nothing extra at this instance size and is a safety
      // net against any destroy path that skips the manual snapshot step (e.g. a bare
      // `cdk destroy` instead of teardown.sh, or a stack update that replaces the instance).
      backupRetention: cdk.Duration.days(1),
      deletionProtection: false,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    };

    // Deliberately fromPassword(), not fromSecret(): fromSecret() has the RDS L2 construct call
    // secret.attach(this) internally, creating a SecretTargetAttachment as a child of
    // persistent.dbSecret (i.e. owned by PersistentStack) that references this Database
    // instance's ref (owned by EphemeralStack) -- since EphemeralStack already depends on
    // PersistentStack for the secret/roles, that reverse reference is a circular stack
    // dependency. fromPassword() resolves the exact same SecretValue token into
    // MasterUserPassword (so the "CDK rotates the master password to match the persisted secret"
    // behavior above is unchanged) without ever setting Credentials.secret, so attach() never
    // fires. The only thing lost is the formal secret<->instance attachment metadata, which only
    // matters for Secrets Manager's automatic rotation tooling -- not configured here.
    const dbPassword = persistent.dbSecret.secretValueFromJson('password');
    const db = snapshotId
      ? new rds.DatabaseInstanceFromSnapshot(this, 'Database', {
          ...dbCommonProps,
          snapshotIdentifier: snapshotId,
          credentials: rds.SnapshotCredentials.fromPassword(dbPassword),
        })
      : new rds.DatabaseInstance(this, 'Database', {
          ...dbCommonProps,
          credentials: rds.Credentials.fromPassword(DB_USER, dbPassword),
        });

    // ECS Cluster
    const cluster = new ecs.Cluster(this, 'Cluster', {
      vpc,
      clusterName: `${APP}-cluster`,
    });

    // Shared log group lives on PersistentStack -- see its own doc comment for why (avoids a
    // circular stack dependency with the executionRole this stack already pulls from there).
    const logGroup = persistent.logGroup;

    // API task definition — DB_HOST/DB_PORT/DB_NAME are plaintext env vars; DB_USERNAME/DB_PASSWORD
    // come from Secrets Manager, and deliberately from appUserSecret (app_user), not dbSecret
    // (recon_app) — mirrors compose.yaml's API_DATABASE_URL, so RLS (ADR-0001) is actually
    // enforced here instead of the migration/owner role bypassing it. dbSecret (recon_app) is used
    // only for the RDS master credentials below and for running migrations, never handed to the
    // API container. Update packages/config to assemble API_DATABASE_URL from these.
    //
    // TODO(migrations): this stack has no equivalent of compose.yaml's `migrate` service. It used
    // to rely on RUN_DB_MIGRATIONS_ON_BOOT so the API task self-migrated on boot; that path was
    // removed when the repo moved to Liquibase (packages/persistence/liquibase). Until this stack
    // gets its own one-off ECS task (or a CDK custom resource) running the Liquibase image against
    // `db` before apiService starts, this database will NOT be migrated automatically on deploy —
    // run the Liquibase image manually against `db.dbInstanceEndpointAddress` first, then
    // `ALTER ROLE app_user WITH PASSWORD '<appUserSecret value>'` (see README.md).
    const apiTask = new ecs.FargateTaskDefinition(this, 'ApiTask', {
      executionRole: persistent.executionRole,
      taskRole: persistent.taskRole,
      cpu: 512,
      memoryLimitMiB: 1024,
    });

    apiTask.addContainer('api', {
      image: ecs.ContainerImage.fromEcrRepository(persistent.apiRepo, 'latest'),
      portMappings: [{ containerPort: API_PORT }],
      environment: {
        PORT: String(API_PORT),
        RECON_PERSISTENCE_BACKEND: 'postgres',
        DB_HOST: db.dbInstanceEndpointAddress,
        DB_PORT: '5432',
        DB_NAME: DB_NAME,
        PG_POOL_MAX: '10',
        PG_IDLE_TIMEOUT_MS: '30000',
        PG_STATEMENT_TIMEOUT_MS: '60000',
        LOG_LEVEL: 'info',
        MAX_UPLOAD_MB: '10',
        RECONCILIATION_RUN_STORE_PATH: '/var/lib/reconciliation/latest-reconciliation-run.json',
        // Declared ahead of app support: apps/api doesn't read RECON_BLOB_STORAGE_BACKEND,
        // UPLOADS_BUCKET_NAME, QUEUE_BACKEND, or the queue URLs yet (S3BlobStorage and an SQS
        // queue implementation are separate, not-yet-built app-code changes). The bucket, queues,
        // and their IAM grants already exist and are correctly configured, ready for the
        // application code to catch up to.
        UPLOADS_BUCKET_NAME: persistent.uploadsBucket.bucketName,
        RECON_BLOB_STORAGE_BACKEND: 's3',
        // The API only ever enqueues (see workerTaskRole's own doc comment for why consuming is
        // worker-only) -- QUEUE_BACKEND picks SQS here vs. the Redis-backed BullMQ queues
        // Dev/Stage uses (reconciliationQueue.ts / importValidationQueue.ts).
        QUEUE_BACKEND: 'sqs',
        RECONCILIATION_QUEUE_URL: persistent.reconciliationQueue.queueUrl,
        IMPORT_VALIDATION_QUEUE_URL: persistent.importValidationQueue.queueUrl,
      },
      secrets: {
        DB_USERNAME: ecs.Secret.fromSecretsManager(persistent.appUserSecret, 'username'),
        DB_PASSWORD: ecs.Secret.fromSecretsManager(persistent.appUserSecret, 'password'),
      },
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'api', logGroup }),
      healthCheck: {
        command: ['CMD-SHELL', `curl -f http://localhost:${API_PORT}/api/health || exit 1`],
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        retries: 3,
        startPeriod: cdk.Duration.seconds(60),
      },
    });

    // Web (Nginx) task definition
    const webTask = new ecs.FargateTaskDefinition(this, 'WebTask', {
      executionRole: persistent.executionRole,
      taskRole: persistent.taskRole,
      cpu: 256,
      memoryLimitMiB: 512,
    });

    webTask.addContainer('web', {
      image: ecs.ContainerImage.fromEcrRepository(persistent.webRepo, 'latest'),
      portMappings: [{ containerPort: WEB_PORT }],
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'web', logGroup }),
    });

    // ALB with path-based routing: /api/* → api, /* → web
    const alb = new elbv2.ApplicationLoadBalancer(this, 'Alb', {
      vpc,
      internetFacing: true,
      securityGroup: albSg,
    });

    const apiTg = new elbv2.ApplicationTargetGroup(this, 'ApiTg', {
      vpc,
      port: API_PORT,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      healthCheck: {
        path: '/api/health',
        healthyHttpCodes: '200',
      },
    });

    const webTg = new elbv2.ApplicationTargetGroup(this, 'WebTg', {
      vpc,
      port: WEB_PORT,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      healthCheck: { path: '/' },
    });

    // ACM cert for the shared apex domain, DNS-validated against the hosted zone DnsStack owns.
    // fromLookup (not a cross-region CDK token -- DnsStack lives in a different region/stack, and
    // cross-region references aren't natively supported the same way same-region cross-stack
    // references are) requires the zone to already exist, so DnsStack must be deployed first.
    const hostedZone = route53.HostedZone.fromLookup(this, 'Zone', { domainName: DOMAIN_NAME });
    const certificate = new acm.Certificate(this, 'Certificate', {
      domainName: DOMAIN_NAME,
      validation: acm.CertificateValidation.fromDns(hostedZone),
    });

    const listener = alb.addListener('HttpsListener', {
      port: 443,
      certificates: [certificate],
      open: false,
    });

    listener.addTargetGroups('WebDefault', { targetGroups: [webTg] });
    listener.addAction('ApiRoute', {
      priority: 10,
      conditions: [elbv2.ListenerCondition.pathPatterns(['/api/*'])],
      action: elbv2.ListenerAction.forward([apiTg]),
    });

    // Plain HTTP always redirects to HTTPS rather than serving traffic directly.
    alb.addListener('HttpRedirectListener', {
      port: 80,
      open: false,
      defaultAction: elbv2.ListenerAction.redirect({
        protocol: 'HTTPS',
        port: '443',
        permanent: true,
      }),
    });

    // ECS Fargate services
    const apiService = new ecs.FargateService(this, 'ApiService', {
      cluster,
      taskDefinition: apiTask,
      desiredCount: 1,
      securityGroups: [ecsSg],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      assignPublicIp: false,
      serviceName: `${APP}-api`,
    });
    apiService.attachToApplicationTargetGroup(apiTg);

    const webService = new ecs.FargateService(this, 'WebService', {
      cluster,
      taskDefinition: webTask,
      desiredCount: 1,
      securityGroups: [ecsSg],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      assignPublicIp: false,
      serviceName: `${APP}-web`,
    });
    webService.attachToApplicationTargetGroup(webTg);

    // Worker task definition — same image as the API (whichever mode it runs in is picked by
    // PROCESS_MODE at container start, an app-code change not yet built), but no portMappings and
    // no ALB target group attachment: it never receives inbound traffic, only pulls from SQS.
    // Deliberately a separate service from apiService -- this is what actually keeps heavy
    // reconciliation/validation work from stalling the API's ability to accept new requests, since
    // both currently run in the same Node.js process together in apps/api's code today (see
    // README.md's queueing section). Same executionRole as the API (image pull, log write, secret
    // resolution -- not request-scoped); a distinct workerTaskRole (see its own doc comment).
    const workerTask = new ecs.FargateTaskDefinition(this, 'WorkerTask', {
      executionRole: persistent.executionRole,
      taskRole: persistent.workerTaskRole,
      cpu: 512,
      memoryLimitMiB: 1024,
    });

    workerTask.addContainer('worker', {
      image: ecs.ContainerImage.fromEcrRepository(persistent.apiRepo, 'latest'),
      environment: {
        PROCESS_MODE: 'worker',
        QUEUE_BACKEND: 'sqs',
        RECONCILIATION_QUEUE_URL: persistent.reconciliationQueue.queueUrl,
        IMPORT_VALIDATION_QUEUE_URL: persistent.importValidationQueue.queueUrl,
        RECON_PERSISTENCE_BACKEND: 'postgres',
        DB_HOST: db.dbInstanceEndpointAddress,
        DB_PORT: '5432',
        DB_NAME: DB_NAME,
        PG_POOL_MAX: '10',
        PG_IDLE_TIMEOUT_MS: '30000',
        PG_STATEMENT_TIMEOUT_MS: '60000',
        LOG_LEVEL: 'info',
        UPLOADS_BUCKET_NAME: persistent.uploadsBucket.bucketName,
        RECON_BLOB_STORAGE_BACKEND: 's3',
        RECONCILIATION_RUN_STORE_PATH: '/var/lib/reconciliation/latest-reconciliation-run.json',
      },
      secrets: {
        DB_USERNAME: ecs.Secret.fromSecretsManager(persistent.appUserSecret, 'username'),
        DB_PASSWORD: ecs.Secret.fromSecretsManager(persistent.appUserSecret, 'password'),
      },
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'worker', logGroup }),
    });

    const workerService = new ecs.FargateService(this, 'WorkerService', {
      cluster,
      taskDefinition: workerTask,
      desiredCount: 1,
      securityGroups: [workerSg],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      assignPublicIp: false,
      serviceName: `${APP}-worker`,
    });

    // Auto-scale on queue backlog, not CPU/memory -- this is what actually delivers "many
    // concurrent uploads don't slow down": as either queue backs up, ECS adds worker tasks to
    // drain it, then scales back down once it clears. Two independent target-tracking policies
    // (one per queue) on the same scalable target -- ECS satisfies whichever wants more capacity.
    // targetValue (messages) is a proposed starting point -- pass -c workerScalingTarget=<n> to
    // tune per-deploy once there's real traffic, without a code change.
    const workerScalingTarget = Number(this.node.tryGetContext('workerScalingTarget') ?? 10);
    const workerScaling = workerService.autoScaleTaskCount({ minCapacity: 1, maxCapacity: 5 });
    workerScaling.scaleToTrackCustomMetric('ReconciliationBacklogScaling', {
      metric: persistent.reconciliationQueue.metricApproximateNumberOfMessagesVisible(),
      targetValue: workerScalingTarget,
    });
    workerScaling.scaleToTrackCustomMetric('ImportValidationBacklogScaling', {
      metric: persistent.importValidationQueue.metricApproximateNumberOfMessagesVisible(),
      targetValue: workerScalingTarget,
    });

    new cdk.CfnOutput(this, 'AppUrl', {
      value: `https://${DOMAIN_NAME}`,
      description: 'Application URL — /api/* routes to API, /* routes to Web',
    });
    new cdk.CfnOutput(this, 'AlbDnsName', {
      value: alb.loadBalancerDnsName,
      description:
        "This region's ALB DNS name — feed into DnsStack's activeRegionAlbDnsName context " +
        'param (on first deploy or a DR failover) to point the apex domain at this region.',
    });
  }
}
