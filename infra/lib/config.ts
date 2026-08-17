export const APP = 'recon' as const;

export const DB_NAME = 'reconciliation_platform';
export const DB_USER = 'recon_app';
export const APP_USER = 'app_user';
export const API_PORT = 4000;
export const WEB_PORT = 8080;

export const DOMAIN_NAME = 'rb-kinneysoft.com';

export interface RegionConfig {
  /** AWS region code, e.g. 'us-east-2'. */
  readonly code: string;
  /** Human-readable label used in stack IDs, e.g. 'Ohio'. */
  readonly label: string;
  /** The live region serving production traffic. Exactly one entry must be primary. */
  readonly primary: boolean;
}

/**
 * DR posture: one primary (live) region, two cold standby regions defined in code but not
 * deployed day-to-day. Failover means deploying a standby from a cross-region-copied RDS
 * snapshot, not flipping a switch on something already running -- see infra/README.md.
 */
export const REGIONS: readonly RegionConfig[] = [
  { code: 'us-east-2', label: 'Ohio', primary: true },
  { code: 'us-east-1', label: 'Virginia', primary: false },
  { code: 'us-west-2', label: 'Oregon', primary: false },
];

export const primaryRegion = (): RegionConfig => {
  const primary = REGIONS.find((r) => r.primary);
  if (!primary) {
    throw new Error('REGIONS must contain exactly one primary region');
  }
  return primary;
};

export const account = process.env.CDK_DEFAULT_ACCOUNT;
