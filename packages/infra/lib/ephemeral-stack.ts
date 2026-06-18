import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as rds from 'aws-cdk-lib/aws-rds';
import type { Construct } from 'constructs';
import { APP, API_PORT, DB_NAME, WEB_PORT } from './config.js';
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
      description: 'ALB — allow HTTP inbound',
    });
    albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80));

    const ecsSg = new ec2.SecurityGroup(this, 'EcsSg', {
      vpc,
      description: 'ECS Fargate tasks',
    });
    ecsSg.addIngressRule(albSg, ec2.Port.allTcp());

    const dbSg = new ec2.SecurityGroup(this, 'DbSg', {
      vpc,
      description: 'RDS — ECS tasks only',
    });
    dbSg.addIngressRule(ecsSg, ec2.Port.tcp(5432));

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
      // No automated backups — snapshots are taken manually before teardown
      backupRetention: cdk.Duration.days(0),
      deletionProtection: false,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    };

    const db = snapshotId
      ? new rds.DatabaseInstanceFromSnapshot(this, 'Database', {
          ...dbCommonProps,
          snapshotIdentifier: snapshotId,
          credentials: rds.SnapshotCredentials.fromSecret(persistent.dbSecret),
        })
      : new rds.DatabaseInstance(this, 'Database', {
          ...dbCommonProps,
          credentials: rds.Credentials.fromSecret(persistent.dbSecret),
        });

    // ECS Cluster
    const cluster = new ecs.Cluster(this, 'Cluster', {
      vpc,
      clusterName: `${APP}-cluster`,
    });

    const logGroup = new logs.LogGroup(this, 'LogGroup', {
      logGroupName: `/ecs/${APP}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // API task definition — DB_HOST/DB_PORT/DB_NAME are plaintext env vars; DB_USERNAME/DB_PASSWORD
    // come from Secrets Manager. Update packages/config to assemble API_DATABASE_URL from these.
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
        RUN_DB_MIGRATIONS_ON_BOOT: 'true',
        RECONCILIATION_RUN_STORE_PATH: '/var/lib/reconciliation/latest-reconciliation-run.json',
      },
      secrets: {
        DB_USERNAME: ecs.Secret.fromSecretsManager(persistent.dbSecret, 'username'),
        DB_PASSWORD: ecs.Secret.fromSecretsManager(persistent.dbSecret, 'password'),
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

    const listener = alb.addListener('HttpListener', { port: 80, open: false });
    albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80));

    listener.addTargetGroups('WebDefault', { targetGroups: [webTg] });
    listener.addAction('ApiRoute', {
      priority: 10,
      conditions: [elbv2.ListenerCondition.pathPatterns(['/api/*'])],
      action: elbv2.ListenerAction.forward([apiTg]),
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

    new cdk.CfnOutput(this, 'AppUrl', {
      value: `http://${alb.loadBalancerDnsName}`,
      description: 'Application URL — /api/* routes to API, /* routes to Web',
    });
  }
}
