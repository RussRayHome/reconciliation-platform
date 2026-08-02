/** Single source of truth for all route paths (pre-auth and in-app workspace), relative to the router basename. */
export const routePaths = {
  login: '/login',
  forgotPassword: '/forgot-password',
  signup: '/signup',
  support: '/support',
  importFiles: '/',
  reconSummary: '/recon-summary',
  probableMatches: '/probable-matches',
  exceptions: '/exceptions',
  export: '/export',
  developer: '/developer',
  mappingFields: '/mapping/fields',
  mappingUpload: '/mapping/upload',
  accountProfile: '/account/profile',
  accountSecurity: '/account/security',
  accountBilling: '/account/billing',
  accountNotification: '/account/notification',
  accountPreferences: '/account/preferences',
  documentationRulebook: '/documentation/rulebook',
} as const;

export type RoutePath = (typeof routePaths)[keyof typeof routePaths];
