export const APP = 'recon' as const;

export const DB_NAME = 'reconciliation_platform';
export const DB_USER = 'recon_app';
export const API_PORT = 4000;
export const WEB_PORT = 8080;

export const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
};
