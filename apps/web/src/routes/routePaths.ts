/** Single source of truth for all route paths (pre-auth and in-app workspace), relative to the router basename. */
export const routePaths = {
  login: '/login',
  forgotPassword: '/forgot-password',
  signup: '/signup',
  support: '/support',
  /** UI-4 (#403): the landing route. "Land on state, not on a blank upload form" -- a returning
   * user sees their run and its next action here, and only an organization with no runs at all is
   * forwarded to New run. `/` was the import screen until this phase. */
  runsHome: '/',
  /** Alias for importFilesBank -- the two are deliberately the same string (R1 WP2), so every
   * call site that names either keeps working when the value moves, as it did in UI-4. One of the
   * four dependents that note used to list is already gone: NavItemLink's `end` special-case went
   * with UI-13's exact-match rewrite. */
  importFiles: '/runs/new',
  importFilesBank: '/runs/new',
  importFilesBilling: '/imports/billing',
  apEntities: '/entities/ap',
  arEntities: '/entities/ar',
  reconSummary: '/recon-summary',
  probableMatches: '/probable-matches',
  exceptions: '/exceptions',
  export: '/export',
  openItemsSchedule: '/open-items',
  /** A-D1 (Issue #338): the bank account registry. Named `bankAccounts` and pathed `/accounts`
   * to keep it distinct from the `account*` routes below, which are the signed-in user's own
   * profile/security settings, not the organization's bank accounts. */
  bankAccounts: '/accounts',
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
