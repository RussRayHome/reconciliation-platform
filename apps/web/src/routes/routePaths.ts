/** Single source of truth for all route paths (pre-auth and in-app workspace), relative to the router basename. */
export const routePaths = {
  login: '/login',
  forgotPassword: '/forgot-password',
  signup: '/signup',
  support: '/support',
  /** Alias for importFilesBank -- the two are deliberately the same string (R1 WP2), so every
   * existing '/' call site (NavItemLink's `end` special-case, the legacy ?tab=&view= redirect
   * guard, the initial-landing redirect, the in-app catch-all) keeps working unmodified: it just
   * now resolves to what's explicitly the Bank Statements tab. */
  importFiles: '/',
  importFilesBank: '/',
  importFilesBilling: '/imports/billing',
  reconSummary: '/recon-summary',
  probableMatches: '/probable-matches',
  exceptions: '/exceptions',
  export: '/export',
  openItemsSchedule: '/open-items',
  mappingProfiles: '/mapping/profiles',
  mappingCreate: '/mapping/create',
  mappingVersions: '/mapping/versions',
  mappingRules: '/mapping/rules',
  mappingRulesVersions: '/mapping/rules/versions',
  mappingHistory: '/mapping/history',
  /** N1: one consolidated Pending approvals inbox, replacing the five per-type rail children.
   * The five approvalsXxx paths below stay declared as one-release redirects to the object each
   * used to shadow (see App.tsx) -- never rail-linked again, but never dead either. */
  approvals: '/approvals',
  approvalsImports: '/approvals/imports',
  approvalsMappingProfiles: '/approvals/mapping-profiles',
  approvalsMatchingRules: '/approvals/matching-rules',
  approvalsExceptionResolutions: '/approvals/exception-resolutions',
  approvalsReportDistribution: '/approvals/report-distribution',
  approvalsPolicy: '/approvals/policy',
  accountProfile: '/account/profile',
  accountSecurity: '/account/security',
  accountBilling: '/account/billing',
  accountNotification: '/account/notification',
  accountPreferences: '/account/preferences',
  documentationRunBook: '/documentation/run-book',
} as const;

export type RoutePath = (typeof routePaths)[keyof typeof routePaths];
