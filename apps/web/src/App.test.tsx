// @vitest-environment jsdom

import type {
  ApprovalCountsByGroup,
  ApprovalRow,
  RuleCatalogResponse,
  ReconciliationAccount,
  RuleVersionsResponse,
  UserRole,
} from '@recon/domain';
import type * as ApiModule from './lib/api';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import App from './App';
import userEvent from '@testing-library/user-event';
import { formatCompactDate } from './lib/format';

// vi.hoisted's callback runs before any other top-level code in this file (same hoisting
// vi.mock factories get), so ACTIVE_RULE_VERSION_FIXTURE has to be built inside it rather than
// referenced from a `const` declared elsewhere in the file -- that `const` wouldn't have run yet.
const mockedApiState = vi.hoisted<{
  // Issue #154: drives getLatestImportRunRequest (GET /api/imports/runs/latest), the durable
  // cross-reload source -- unlike the old getLatestReconciliationRunRequest mock, `null` is a
  // real, valid answer (an idle/no-runs-yet organization), not an error condition.
  latestImportRunResponse: unknown;
  latestImportRunError: Error | null;
  latestImportRunPromise: Promise<unknown> | null;
  // Backs getReconciliationRunByIdRequest, used to resolve the full report once
  // resolveLatestRunPhase says the durable run 'succeeded'.
  matchingRunReportResponse: unknown;
  ruleVersionsResponse: RuleVersionsResponse | null;
  defaultRuleVersionsResponse: RuleVersionsResponse;
  rulesCatalogResponse: RuleCatalogResponse;
  mappingProfileNames: string[];
  // Backs getApprovalCountsRequest / getApprovalsRequest for the NavRail badge + inbox tests.
  approvalCounts: ApprovalCountsByGroup;
  approvalRows: ApprovalRow[];
  // A-D1 (Issue #338): the registered bank accounts a statement may be assigned to.
  accounts: ReconciliationAccount[];
}>(() => {
  // Default GET /api/rules/versions fixture: an already-published ACTIVE version with
  // overridesAppliedToEngine true, i.e. "Phase 0 engine wiring has shipped" -- most existing
  // tests care about role-based editability (ADMIN·EDITABLE vs READ-ONLY), not the NOT APPLIED
  // state specifically, so this keeps that scenario the default and lets tests that DO care
  // about NOT APPLIED override `mockedApiState.ruleVersionsResponse` explicitly.
  const activeVersion = {
    id: 'mcv-active-7',
    organizationId: 'test-org',
    versionNumber: 7,
    status: 'ACTIVE' as const,
    varianceOverrides: {},
    createdBy: 'mortega',
    createdAt: '2026-08-01T00:00:00.000Z',
    publishedBy: 'M. Ortega',
    publishedAt: '2026-08-04T00:00:00.000Z',
    effectiveAt: '2026-08-01T00:00:00.000Z',
    pendingApprovalOwner: null,
  };
  const defaultRuleVersionsResponse = {
    active: activeVersion,
    draft: null,
    history: [activeVersion],
    overridesAppliedToEngine: true,
  };

  // A small but representative GET /api/rules/catalog fixture -- not all 43 real rules (that
  // completeness is packages/core's ruleCatalog.test.ts's job), just enough of each family plus
  // one fixed (no-metric) rule to exercise search/family/tunable filtering and the variance
  // threshold list.
  const rulesCatalogResponse = {
    rules: [
      {
        id: 'reference-amount-match',
        name: 'Reference + Amount Match',
        family: 'Matching' as const,
        description: 'Pairs bank and GL transactions when amounts agree within tolerance.',
        varianceMetricIds: ['amountTolerance' as const],
        tunable: true,
      },
      {
        id: 'wire-correspondent-fee-deduction',
        name: 'Wire Correspondent Fee Deduction',
        family: 'Matching' as const,
        description: 'Flags a likely correspondent-bank fee deducted in transit.',
        varianceMetricIds: ['wireFeeTolerance' as const],
        tunable: true,
        risk: 'elevated' as const,
      },
      {
        id: 'fee-netting-reserved',
        name: 'Fee Netting Candidate',
        family: 'Grouped roll-up' as const,
        description: 'Bank net receipt equals GL gross revenue minus one or more fee entries.',
        varianceMetricIds: ['amountTolerance' as const, 'timingDifferenceDays' as const],
        tunable: true,
      },
      {
        id: 'LikelyMiscoding',
        name: 'Likely Miscoding',
        family: 'Classifier' as const,
        description: 'Promotes same-amount, near-date pairs into a miscoding exception.',
        varianceMetricIds: ['amountTolerance' as const],
        tunable: true,
      },
      {
        id: 'MissingFromBank',
        name: 'Missing from Bank',
        family: 'Classifier' as const,
        description: 'Classifies unmatched GL-side transactions as missing from bank activity.',
        varianceMetricIds: [],
        tunable: false,
      },
    ],
    metrics: [
      { id: 'amountTolerance' as const, unit: 'USD' as const, default: 0.01, min: 0, max: 1 },
      { id: 'timingDifferenceDays' as const, unit: 'days' as const, default: 21, min: 0, max: 90 },
      { id: 'wireFeeTolerance' as const, unit: 'USD' as const, default: 500, min: 0, max: 5000 },
    ],
  };

  return {
    latestImportRunResponse: null,
    latestImportRunError: null,
    latestImportRunPromise: null,
    matchingRunReportResponse: null,
    ruleVersionsResponse: defaultRuleVersionsResponse,
    defaultRuleVersionsResponse,
    rulesCatalogResponse,
    mappingProfileNames: ['Chase Operating', 'WF Payroll'],
    approvalCounts: {
      import: { pending: 0, approved: 0, rejected: 0, mySubmissions: 0 },
      mappingProfile: { pending: 0, approved: 0, rejected: 0, mySubmissions: 0 },
      matchingRule: { pending: 0, approved: 0, rejected: 0, mySubmissions: 0 },
      exceptionResolution: { pending: 0, approved: 0, rejected: 0, mySubmissions: 0 },
      reportDistribution: { pending: 0, approved: 0, rejected: 0, mySubmissions: 0 },
    },
    approvalRows: [],
    // One registered account per last-four the bank fixtures use, so a conventionally-named file
    // resolves to exactly one candidate and the assignment control pre-selects it.
    accounts: ['1111', '2222', '3333', '4444', '5555'].map((lastFour, index) => ({
      id: `${lastFour}${lastFour}${lastFour}${lastFour}-1111-4111-8111-11111111111${index}`,
      organizationId: 'test-org',
      accountIdentifier: lastFour,
      displayName: `Account ${lastFour}`,
      institutionName: 'Test Bank',
      lastFour,
      currencyCode: 'USD',
      glCashAccountCode: null,
      isActive: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })),
  };
});

vi.mock('./lib/api', async () => {
  const actual = await vi.importActual<typeof ApiModule>('./lib/api');

  return {
    ...actual,
    getLatestImportRunRequest: vi.fn(async () => {
      if (mockedApiState.latestImportRunPromise) {
        return (await mockedApiState.latestImportRunPromise) as Awaited<
          ReturnType<typeof actual.getLatestImportRunRequest>
        >;
      }

      if (mockedApiState.latestImportRunError) {
        throw mockedApiState.latestImportRunError;
      }

      // null is a real, valid answer here (Issue #154: an idle/no-runs-yet organization) --
      // unlike the old getLatestReconciliationRunRequest mock, not throwing when unset.
      return mockedApiState.latestImportRunResponse as Awaited<
        ReturnType<typeof actual.getLatestImportRunRequest>
      >;
    }),
    // Falls back to the real implementation (real `apiFetch`/`fetch`) when a test hasn't set
    // `matchingRunReportResponse` explicitly -- existing submission-flow tests
    // (mockImportRunSubmitFlow et al.) rely on intercepting this at the raw-fetch level via
    // `/api/reconciliation/:id`, since useImportRunSubmit's own mutationFn calls this on success;
    // only the Issue #154 hydration tests, which care about App.tsx's *own* direct call to it, set
    // this state explicitly.
    getReconciliationRunByIdRequest: vi.fn(async (runId: string) => {
      if (!mockedApiState.matchingRunReportResponse) {
        return actual.getReconciliationRunByIdRequest(runId);
      }

      return mockedApiState.matchingRunReportResponse as Awaited<
        ReturnType<typeof actual.getReconciliationRunByIdRequest>
      >;
    }),
    getRuleVersionsRequest: vi.fn(() =>
      Promise.resolve(
        mockedApiState.ruleVersionsResponse as Awaited<
          ReturnType<typeof actual.getRuleVersionsRequest>
        >,
      ),
    ),
    // Mocked unconditionally (not gated by test scenario) so ReconciliationApp's eager
    // fetch-on-mount for the NavRail family counts never falls through to the generic
    // `fetch` spy individual tests set up for /api/reconciliation/run etc. -- letting it
    // through there previously broke call-order-sensitive assertions on that spy.
    getRulesCatalogRequest: vi.fn(() =>
      Promise.resolve(
        mockedApiState.rulesCatalogResponse as Awaited<
          ReturnType<typeof actual.getRulesCatalogRequest>
        >,
      ),
    ),
    getMappingProfilesRequest: vi.fn(() => Promise.resolve(mockedApiState.mappingProfileNames)),
    // A-D1 (Issue #338): the bank account registry the assignment control reads. Mocked
    // unconditionally, like the other mount-time fetches above, so it never falls through to the
    // per-test `fetch` spies and disturbs their call-order assertions. The fixture accounts' last
    // four digits match the bank filenames `fillUploadInputs` uses, so each staged statement gets
    // its one unambiguous suggestion and the existing submission tests need no further setup --
    // exactly the flow a real operator sees when their files are named conventionally.
    listAccountsRequest: vi.fn(() => Promise.resolve(mockedApiState.accounts)),
    // Mocked unconditionally for the same reason as getRulesCatalogRequest above: NavRail's
    // per-submenu Approvals badges fetch on every mount/route change, so an unmocked call here
    // would fall through to the real `fetch` and disrupt other tests' call-order-sensitive spies.
    getApprovalCountsRequest: vi.fn(() => Promise.resolve(mockedApiState.approvalCounts)),
    // ApprovalsPage fetches its table on mount; unmocked, that would fall through to the real
    // `fetch` and disrupt other tests' call-order-sensitive fetch spies.
    getApprovalsRequest: vi.fn((type: string) =>
      Promise.resolve(mockedApiState.approvalRows.filter((row) => row.type === type)),
    ),
    decideApprovalRequest: vi.fn(() => Promise.resolve(undefined)),
    claimApprovalRequest: vi.fn(() => Promise.resolve(undefined)),
    withdrawImportRunRequest: vi.fn(() => Promise.resolve(undefined)),
  };
});

const storage = new Map<string, string>();

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
    removeItem: (key: string) => {
      storage.delete(key);
    },
    clear: () => {
      storage.clear();
    },
  },
});

const AUTHENTICATED_USER_STORAGE_KEY = 'reconciliation-platform:authenticated-user';

// Mirrors the role assignments migration 0026 backfilled server-side (and that
// apps/web/src/App.tsx used to hardcode in a usersByUsername map before ADR-0002 moved role onto
// the session itself). Tests seed localStorage directly to skip a real login round trip, so this
// mapping has to live somewhere -- here, not in App.tsx.
const testUserRoles: Record<string, UserRole> = {
  bray: 'financial-analyst',
  rray3: 'admin',
  rray: 'superuser',
};

const setAuthenticatedUser = (username: string): void => {
  const role = testUserRoles[username];
  if (!role) {
    throw new Error(`setAuthenticatedUser: no test role mapped for username "${username}"`);
  }

  globalThis.localStorage.setItem(
    AUTHENTICATED_USER_STORAGE_KEY,
    JSON.stringify({
      username,
      role,
      organizationId: 'test-org',
      // These test/dev accounts are pre-provisioned, not signed up through the real flow -- treat
      // them as already past both post-signup gates, matching how create-users.psql seeds them.
      identityVerificationStatus: 'verified',
      entityVerificationStatus: 'verified',
      isFullyVerified: true,
    }),
  );
};

const monthsWithinYear = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const createRunResponse = () => ({
  id: 'run-1',
  correlationId: 'corr-1',
  status: 'Completed',
  startedAt: new Date().toISOString(),
  completedAt: new Date().toISOString(),
  sourceFiles: [
    { id: '1', source: 'bank', fileName: 'bank.xlsx' },
    { id: '2', source: 'gl', fileName: 'gl.xlsx' },
  ],
  rawRows: [],
  normalizedTransactions: [],
  matchResults: [],
  probableMatches: [
    {
      id: 'probable-1',
      disposition: 'Review',
      confidence: 'Medium',
      ruleName: 'Amount + Date + Text with Reference Variance',
      dateDifferenceDays: 2,
      amountDifference: 0,
      evidence: ['Amount aligned', 'Date within tolerance', 'Reference mismatch detected'],
    },
  ],
  exceptions: [
    {
      id: 'exception-1',
      category: 'MissingFromGL',
      severity: 'High',
      source: 'bank',
      spreadsheetFileName: 'bank.xlsx',
      lineNumber: 5,
      amount: 125.5,
      errorMessage: 'Missing from GL',
      ruleTrace: {
        ruleId: 'missing-from-gl',
        ruleName: 'Missing from GL',
        reason:
          'No GL-side transaction remained after exact, review, and variance matching rules were applied.',
        evidence: ['Transaction stayed unmatched after cross-source candidate selection.'],
      },
      recommendedNextActions: [
        'Check whether the bank transaction was recorded to the correct GL account and period.',
        'Create or correct the GL entry if source support confirms the bank activity is valid.',
      ],
      normalizedComparisonTokens: ['ACME'],
      relatedTransactionIds: [],
    },
    {
      id: 'exception-2',
      category: 'LikelySplitCombineIssue',
      severity: 'High',
      source: 'bank',
      spreadsheetFileName: 'bank.xlsx',
      lineNumber: 8,
      amount: 250,
      errorMessage: 'Likely split/combine issue',
      ruleTrace: {
        ruleId: 'grouped-split-combine-residual',
        ruleName: 'Grouped Split/Combine Residual',
        reason:
          'Residual unmatched transactions form a one-to-many relationship that the one-to-one matcher cannot settle cleanly.',
        evidence: ['Grouped total balances across sources.'],
        counterpart: {
          source: 'gl',
          spreadsheetFileName: 'gl.xlsx',
          lineNumber: 4,
          transactionId: 'gl-4',
        },
        counterparts: [
          {
            source: 'gl',
            spreadsheetFileName: 'gl.xlsx',
            lineNumber: 4,
            transactionId: 'gl-4',
          },
          {
            source: 'gl',
            spreadsheetFileName: 'gl.xlsx',
            lineNumber: 5,
            transactionId: 'gl-5',
          },
        ],
      },
      recommendedNextActions: [
        'Review nearby transactions for one-to-many or many-to-one combinations that sum to the same net activity.',
      ],
      normalizedComparisonTokens: ['GROUPED', 'PAYMENT'],
      relatedTransactionIds: ['bank-8', 'gl-4', 'gl-5'],
    },
    {
      id: 'exception-3',
      category: 'DepositGroupingIssue',
      severity: 'High',
      source: 'gl',
      spreadsheetFileName: 'gl.xlsx',
      lineNumber: 12,
      amount: 410,
      errorMessage: 'Deposit grouping issue',
      ruleTrace: {
        ruleId: 'grouped-deposit-residual',
        ruleName: 'Grouped Deposit Residual',
        reason:
          'Residual unmatched deposits form a grouped receipt pattern rather than independent missing items.',
        evidence: ['Grouped deposit total balances across sources.'],
        counterpart: {
          source: 'bank',
          spreadsheetFileName: 'bank.xlsx',
          lineNumber: 12,
          transactionId: 'bank-12',
        },
        counterparts: [
          {
            source: 'bank',
            spreadsheetFileName: 'bank.xlsx',
            lineNumber: 12,
            transactionId: 'bank-12',
          },
        ],
      },
      recommendedNextActions: [
        'Compare the bank deposit to underlying receipts or batch detail to confirm whether multiple book entries roll into one deposit.',
      ],
      normalizedComparisonTokens: ['BATCH', 'DEPOSIT'],
      relatedTransactionIds: ['bank-12', 'gl-8', 'gl-9'],
    },
    {
      id: 'exception-4',
      category: 'TimingDifference',
      severity: 'Medium',
      source: 'bank',
      spreadsheetFileName: 'bank.xlsx',
      lineNumber: 18,
      amount: -2400,
      errorMessage: 'Timing difference',
      ruleTrace: {
        ruleId: 'timing-difference-reclassification',
        ruleName: 'Timing Difference Reclassification',
        reason:
          'A same-amount, timing-compatible counterpart exists outside the primary date tolerance but within the timing-difference window.',
        evidence: ['Same amount paired within the extended timing window.'],
        counterpart: {
          source: 'gl',
          spreadsheetFileName: 'gl.xlsx',
          lineNumber: 21,
          transactionId: 'gl-21',
        },
        counterparts: [
          {
            source: 'gl',
            spreadsheetFileName: 'gl.xlsx',
            lineNumber: 21,
            transactionId: 'gl-21',
          },
        ],
      },
      priorRuleTraces: [
        {
          ruleId: 'amount-extended-date-window-match',
          ruleName: 'Amount + Extended Date Window Match',
          reason: 'Original date variance classification',
          evidence: ['Amounts agree within configured tolerance.'],
          counterpart: {
            source: 'gl',
            spreadsheetFileName: 'gl.xlsx',
            lineNumber: 21,
            transactionId: 'gl-21',
          },
          counterparts: [
            {
              source: 'gl',
              spreadsheetFileName: 'gl.xlsx',
              lineNumber: 21,
              transactionId: 'gl-21',
            },
          ],
        },
      ],
      recommendedNextActions: [
        'Carry as timing support and monitor the next reconciliation cycle.',
      ],
      normalizedComparisonTokens: ['PAYROLL', 'APRIL'],
      relatedTransactionIds: ['bank-18', 'gl-21'],
    },
  ],
  summary: {
    totalRecordsReviewed: 12,
    bankRecords: 6,
    glRecords: 6,
    exactMatches: 4,
    probableMatches: 1,
    unmatchedItems: 2,
    duplicates: 1,
    bankDuplicates: 1,
    glDuplicates: 0,
    dateVariances: 1,
    timingDifferences: 1,
    dataQualityIssues: 1,
    amountMismatches: 0,
    missingFromBank: 1,
    missingFromGL: 1,
    unmatchedBankNetAmount: 125.5,
    unmatchedGlNetAmount: 0,
    cleanMatchedAmount: 6400,
    unresolvedExposure: 125.5,
    countsByCategory: {
      MissingFromGL: 1,
      LikelySplitCombineIssue: 1,
      DepositGroupingIssue: 1,
      TimingDifference: 1,
    },
    amountByCategory: {
      MissingFromGL: 125.5,
      LikelySplitCombineIssue: 250,
      DepositGroupingIssue: 410,
      TimingDifference: 2400,
    },
    charts: [
      { id: 'countByCategory', title: 'Counts', data: [] },
      { id: 'exposureByCategory', title: 'Exposure', data: [] },
    ],
  },
  reviewerObservations: [],
  auditEvents: [],
  outputWorkbook: {
    fileName: 'run-1.xlsx',
    generatedAt: new Date().toISOString(),
    tabNames: ['Summary', 'Probable Matches', 'Exceptions'],
  },
});

const IMPORT_RUN_ID = 'import-run-1';
const MATCHING_JOB_ID = 'matching-job-1';

const createImportRunSummary = (overrides: Record<string, unknown> = {}) => ({
  id: IMPORT_RUN_ID,
  organizationId: 'test-org',
  label: 'Monthly Recon',
  accountIdentifier: null,
  frequency: 'MONTHLY',
  periodYear: new Date().getFullYear(),
  periodMonth: 1,
  status: 'DRAFT',
  createdAt: '2026-08-01T00:00:00.000Z',
  matchingJobId: null,
  matchingJob: null,
  validationJob: null,
  files: [],
  ...overrides,
});

const createImportRunFile = (overrides: Record<string, unknown> = {}) => ({
  importFileId: 'file-1',
  role: 'GL',
  sourceType: 'GL',
  originalFilename: 'gl.csv',
  fileFormat: 'CSV',
  validationStatus: 'VALID',
  byteSize: 100,
  contentSha256: 'sha-1',
  rowCount: 10,
  errorCount: 0,
  warningCount: 0,
  ...overrides,
});

/** fetch's first parameter is `RequestInfo | URL`, not always a plain string -- String(input)
 * would use Object's default (unhelpful) stringification for a bare object shape, hence a real
 * type-narrowing helper instead. */
const requestUrl = (input: RequestInfo | URL): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

/**
 * `createImportRunRequest` (apps/web/src/lib/api.ts) uses a real `XMLHttpRequest` rather than
 * `fetch` for the `/api/imports/runs` upload specifically, so it can observe `xhr.upload`'s
 * `progress` event (Screen 02's per-file progress bars) -- something `fetch` has no equivalent
 * for. Every other call the app makes still goes through `fetch`. This fake stands in for the
 * global `XMLHttpRequest` in that one path; `respond`/`networkError`/`abort` (via the real
 * `.abort()` the app calls) drive it from a test, and `emitProgress` simulates upload-progress
 * events.
 */
class FakeImportRunXhr {
  static instances: FakeImportRunXhr[] = [];
  static autoRespond = true;
  static autoRespondStatus = 201;
  static autoRespondBody: unknown = null;

  readonly upload = new EventTarget();
  private readonly target = new EventTarget();
  method = '';
  url = '';
  readonly headers: Record<string, string> = {};
  status = 0;
  responseText = '';
  body: FormData | null = null;

  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name: string, value: string): void {
    this.headers[name] = value;
  }

  addEventListener(type: string, handler: EventListener): void {
    this.target.addEventListener(type, handler);
  }

  send(body: FormData): void {
    this.body = body;
    FakeImportRunXhr.instances.push(this);

    if (FakeImportRunXhr.autoRespond) {
      this.respond(
        FakeImportRunXhr.autoRespondStatus,
        FakeImportRunXhr.autoRespondBody ?? createImportRunSummary(),
      );
    }
  }

  abort(): void {
    this.target.dispatchEvent(new Event('abort'));
  }

  emitProgress(loaded: number, total: number): void {
    this.upload.dispatchEvent(
      Object.assign(new Event('progress'), { lengthComputable: true, loaded, total }),
    );
  }

  respond(status: number, body: unknown): void {
    this.status = status;
    this.responseText = JSON.stringify(body);
    this.target.dispatchEvent(new Event('load'));
  }

  networkError(): void {
    this.target.dispatchEvent(new Event('error'));
  }
}

/** Installs `FakeImportRunXhr` as `globalThis.XMLHttpRequest`, resetting its captured instances
 * and auto-respond behavior. Restored automatically by the shared `vi.unstubAllGlobals()` in
 * `afterEach`. */
const installFakeImportRunXhr = ({
  autoRespond = true,
  status = 201,
  body = null,
}: { autoRespond?: boolean; status?: number; body?: unknown } = {}): typeof FakeImportRunXhr => {
  FakeImportRunXhr.instances = [];
  FakeImportRunXhr.autoRespond = autoRespond;
  FakeImportRunXhr.autoRespondStatus = status;
  FakeImportRunXhr.autoRespondBody = body;
  vi.stubGlobal('XMLHttpRequest', FakeImportRunXhr);
  return FakeImportRunXhr;
};

/**
 * Mocks the full create -> submit -> fetch-report sequence `useImportRunSubmit`'s mutationFn
 * drives (apps/web/src/hooks/useImportRunSubmit.ts), so a test exercising "Submit run" doesn't
 * need to know its multi-step shape. Mirrors the synchronous (import-validation-queue-disabled)
 * fallback path -- the default in every test/dev environment here, same convention already used
 * for /api/reconciliation/run's own enabled/disabled split.
 */
const mockImportRunSubmitFlow = (finalRun: unknown = createRunResponse()) => {
  installFakeImportRunXhr();

  return vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
    const url = requestUrl(input);
    if (url === `/api/imports/runs/${IMPORT_RUN_ID}/submit`) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            importJobId: 'import-job-1',
            status: 'completed',
            passed: true,
            matchingJobId: MATCHING_JOB_ID,
            run: createImportRunSummary({ status: 'PENDING_APPROVAL' }),
          }),
          { status: 200 },
        ),
      );
    }
    if (url === `/api/reconciliation/${MATCHING_JOB_ID}`) {
      return Promise.resolve(new Response(JSON.stringify(finalRun), { status: 200 }));
    }
    throw new Error(`mockImportRunSubmitFlow: unexpected fetch call to ${url}`);
  });
};

// jsdom doesn't implement Element.scrollIntoView -- the TUNABLE cell's click-to-scroll calls it
// directly (not optional-chained past the method itself), so it needs a stub here.
const scrollIntoViewMock = vi.fn();
Element.prototype.scrollIntoView = scrollIntoViewMock;

const renderApp = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <App />
    </QueryClientProvider>,
  );

/** Fills Screen 02's upload slots -- every bank filename must start with digits followed by
 * "-"/"_" (Issue #141's account-filename convention) or `SourceDropZone` rejects it before it
 * ever reaches state. Defaults are interchangeable stand-ins for tests that don't care about file
 * identity (2 bank files, matching this suite's pre-#153 default); pass overrides for tests that
 * assert on specific bytes/names/counts. #153: two slots exist on mount (matching the prior fixed
 * layout); a target count above 2 clicks "Add another bank statement" to grow, below 2 clicks the
 * 2nd slot's Remove control to shrink. */
/**
 * Stages the run's files and waits for each bank statement's account assignment to settle.
 *
 * Async since A-D1 (Issue #338): a run cannot be submitted until every statement is assigned to a
 * registered account, and the registry is fetched, so the assignment is not available on the same
 * tick the files are staged. The fixture accounts' last four digits match these filenames, so each
 * slot resolves to exactly one candidate and is pre-selected -- what an operator sees when their
 * files are named conventionally. A test covering an unassigned or ambiguous statement stages its
 * files directly instead of going through this helper.
 */
const fillUploadInputs = async ({
  bankFiles = [new File(['bank-a'], '1111_bank.xlsx'), new File(['bank-b'], '2222_bank.xlsx')],
  glFile = new File(['gl'], 'gl.xlsx'),
}: { bankFiles?: File[]; glFile?: File } = {}): Promise<void> => {
  if (bankFiles.length === 1) {
    fireEvent.click(screen.getByRole('button', { name: 'Remove Bank workbook (Account 2)' }));
  } else {
    for (let slotCount = 2; slotCount < bankFiles.length; slotCount += 1) {
      fireEvent.click(screen.getByRole('button', { name: 'Add another bank statement' }));
    }
  }
  bankFiles.forEach((bankFile, index) => {
    fireEvent.change(screen.getByLabelText(`Bank workbook (Account ${index + 1})`), {
      target: { files: [bankFile] },
    });
  });
  fireEvent.change(screen.getByLabelText('GL workbook'), {
    target: { files: [glFile] },
  });

  // Flush the account registry fetch's promise chain and the render it triggers, so each staged
  // statement carries its pre-selected assignment before the caller asserts anything.
  //
  // Deliberately `act` rather than `waitFor`: three of the tests below install fake timers before
  // staging files, and `waitFor` polls on a timer, so it would hang there for the full test
  // timeout. Promise resolution is a microtask, which fake timers do not intercept. Two passes
  // because the hook's chain is `then -> setState -> effect -> setState`, and the second setState
  // is scheduled during the first flush.
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });

  const selects = screen.getAllByLabelText('Bank account');
  expect(selects).toHaveLength(bankFiles.length);
  for (const select of selects) {
    expect(select).not.toHaveValue('');
  }
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  storage.clear();
  mockedApiState.latestImportRunResponse = null;
  mockedApiState.latestImportRunError = null;
  mockedApiState.latestImportRunPromise = null;
  mockedApiState.matchingRunReportResponse = null;
  mockedApiState.approvalCounts = {
    import: { pending: 0, approved: 0, rejected: 0, mySubmissions: 0 },
    mappingProfile: { pending: 0, approved: 0, rejected: 0, mySubmissions: 0 },
    matchingRule: { pending: 0, approved: 0, rejected: 0, mySubmissions: 0 },
    exceptionResolution: { pending: 0, approved: 0, rejected: 0, mySubmissions: 0 },
    reportDistribution: { pending: 0, approved: 0, rejected: 0, mySubmissions: 0 },
  };
  mockedApiState.approvalRows = [];
  mockedApiState.ruleVersionsResponse = mockedApiState.defaultRuleVersionsResponse;
  globalThis.history.replaceState({}, '', '/');
});

const createDeferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
};

describe('App', () => {
  it('renders the login page when no authenticated user is stored', () => {
    renderApp();

    expect(screen.getByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    expect(screen.getByLabelText('Username')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Log in' })).toBeInTheDocument();
  });

  it('shows the invalid-credentials error banner without revealing which field failed', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ message: 'The user or password does not match.' }), {
        status: 401,
      }),
    );

    renderApp();

    fireEvent.change(screen.getByLabelText('Username'), {
      target: { value: 'rray' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'wrong-password' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Invalid username or password. Try again.',
      );
    });
  });

  it('lands on the application page after successful login', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          token: 'test-token',
          username: 'rray',
          firstName: 'Ryan',
          lastName: 'Ray',
          role: 'superuser',
          organizationId: 'test-org',
        }),
        { status: 200 },
      ),
    );

    renderApp();

    fireEvent.change(screen.getByLabelText('Username'), {
      target: { value: 'rray' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'rray' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'New run' })).toBeInTheDocument();
    });
  });

  it('resets the URL to the app root after a successful login', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          token: 'test-token',
          username: 'rray',
          firstName: 'Ryan',
          lastName: 'Ray',
          role: 'superuser',
          organizationId: 'test-org',
        }),
        { status: 200 },
      ),
    );

    globalThis.history.pushState({}, '', '/login');
    renderApp();

    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'rray' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'rray' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'New run' })).toBeInTheDocument();
    });
    expect(globalThis.location.pathname).toBe('/');
  });

  it('navigates from login to Forgot Password and back via the placeholder screen', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByRole('link', { name: 'Forgot password?' }));

    expect(screen.getByRole('heading', { name: 'Forgot Password' })).toBeInTheDocument();
    expect(screen.getByText('Placeholder')).toBeInTheDocument();
    expect(screen.getByText("This page hasn't been designed yet.")).toBeInTheDocument();
    expect(globalThis.location.pathname).toBe('/forgot-password');

    await user.click(screen.getByRole('link', { name: '← Back to log in' }));

    expect(screen.getByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    expect(globalThis.location.pathname).toBe('/login');
  });

  it('navigates from login to the signup screen via Create an account', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByRole('link', { name: 'Create an account' }));

    expect(screen.getByRole('heading', { name: 'Create an account' })).toBeInTheDocument();
    expect(globalThis.location.pathname).toBe('/signup');
  });

  it('navigates from login to the Contact Support placeholder via the footer link', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByRole('link', { name: 'Contact support' }));

    expect(screen.getByRole('heading', { name: 'Contact Support' })).toBeInTheDocument();
    expect(globalThis.location.pathname).toBe('/support');
  });

  it('redirects a direct visit to an unknown path to /login when unauthenticated', () => {
    globalThis.history.pushState({}, '', '/some/unknown/path');
    renderApp();

    expect(screen.getByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    expect(globalThis.location.pathname).toBe('/login');
  });

  it('uses environment-prefixed docs links on an environment root route', () => {
    setAuthenticatedUser('rray');
    globalThis.history.pushState({}, '', '/dev');

    renderApp();

    expect(screen.getByRole('link', { name: 'User Guide' })).toHaveAttribute('href', '/dev/docs');
  });

  it('redirects root to /dev when the development environment path segment is configured', () => {
    setAuthenticatedUser('rray');
    vi.stubEnv('VITE_ENVIRONMENT_PATH_SEGMENT', 'dev');
    globalThis.history.pushState({}, '', '/');

    renderApp();

    expect(globalThis.location.pathname).toBe('/dev');
  });

  it('redirects a single-segment route hit directly onto /dev instead of rendering blank', () => {
    setAuthenticatedUser('rray');
    vi.stubEnv('VITE_ENVIRONMENT_PATH_SEGMENT', 'dev');
    globalThis.history.pushState({}, '', '/export');

    renderApp();

    expect(globalThis.location.pathname).toBe('/dev/export');
    expect(screen.getByRole('link', { name: /Reports/i })).toHaveAttribute('aria-current', 'page');
  });

  it('redirects a multi-segment deep link onto /dev instead of rendering blank', () => {
    setAuthenticatedUser('rray');
    vi.stubEnv('VITE_ENVIRONMENT_PATH_SEGMENT', 'dev');
    globalThis.history.pushState({}, '', '/mapping/create');

    renderApp();

    expect(globalThis.location.pathname).toBe('/dev/mapping/create');
    expect(screen.getByRole('heading', { name: 'Create Mapping' })).toBeInTheDocument();
  });

  it('does not double-prefix a route that is already under /dev', () => {
    setAuthenticatedUser('rray');
    vi.stubEnv('VITE_ENVIRONMENT_PATH_SEGMENT', 'dev');
    globalThis.history.pushState({}, '', '/dev/mapping/create');

    renderApp();

    expect(globalThis.location.pathname).toBe('/dev/mapping/create');
    expect(screen.getByRole('heading', { name: 'Create Mapping' })).toBeInTheDocument();
  });

  // Regression coverage for the segment being hardcoded to 'dev': the fix above originally only
  // rewrote bare deep links for that one literal segment, silently leaving every other
  // environment-prefixed deployment (e.g. stage) rendering blank on a direct route hit.
  it('redirects root to /stage when the stage environment path segment is configured', () => {
    setAuthenticatedUser('rray');
    vi.stubEnv('VITE_ENVIRONMENT_PATH_SEGMENT', 'stage');
    globalThis.history.pushState({}, '', '/');

    renderApp();

    expect(globalThis.location.pathname).toBe('/stage');
  });

  it('redirects a single-segment route hit directly onto /stage instead of rendering blank', () => {
    setAuthenticatedUser('rray');
    vi.stubEnv('VITE_ENVIRONMENT_PATH_SEGMENT', 'stage');
    globalThis.history.pushState({}, '', '/export');

    renderApp();

    expect(globalThis.location.pathname).toBe('/stage/export');
    expect(screen.getByRole('link', { name: /Reports/i })).toHaveAttribute('aria-current', 'page');
  });

  it('redirects a multi-segment deep link onto /stage instead of rendering blank', () => {
    setAuthenticatedUser('rray');
    vi.stubEnv('VITE_ENVIRONMENT_PATH_SEGMENT', 'stage');
    globalThis.history.pushState({}, '', '/mapping/create');

    renderApp();

    expect(globalThis.location.pathname).toBe('/stage/mapping/create');
    expect(screen.getByRole('heading', { name: 'Create Mapping' })).toBeInTheDocument();
  });

  it('does not double-prefix a route that is already under /stage', () => {
    setAuthenticatedUser('rray');
    vi.stubEnv('VITE_ENVIRONMENT_PATH_SEGMENT', 'stage');
    globalThis.history.pushState({}, '', '/stage/mapping/create');

    renderApp();

    expect(globalThis.location.pathname).toBe('/stage/mapping/create');
    expect(screen.getByRole('heading', { name: 'Create Mapping' })).toBeInTheDocument();
  });

  it('renders the documentation hub on the docs route', () => {
    setAuthenticatedUser('rray');
    globalThis.history.pushState({}, '', '/docs');

    renderApp();

    expect(screen.getByRole('heading', { name: 'Project Documents Overview' })).toBeInTheDocument();
    expect(screen.getByText('Project Overview')).toBeInTheDocument();
    expect(screen.getByLabelText('Selected document preview')).toBeInTheDocument();
  });

  it('renders the documentation hub on an environment-prefixed docs route', () => {
    setAuthenticatedUser('rray');
    globalThis.history.pushState({}, '', '/dev/docs');

    renderApp();

    expect(screen.getByRole('heading', { name: 'Project Documents Overview' })).toBeInTheDocument();
    expect(screen.getByText('Project Overview')).toBeInTheDocument();
    expect(screen.getByLabelText('Selected document preview')).toBeInTheDocument();
  });

  it('renders the rail destinations as routes and defaults to Import Files', () => {
    setAuthenticatedUser('rray');
    renderApp();

    expect(screen.getByRole('link', { name: 'New run' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('link', { name: 'Summary' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: /Exceptions/i })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: /Reports/i })).not.toHaveAttribute('aria-current');
    expect(screen.getByText('Import source files')).toBeInTheDocument();
  });

  it('navigates between rail destinations via real routes and updates the active link', async () => {
    const user = userEvent.setup();

    setAuthenticatedUser('rray');

    renderApp();

    await user.click(screen.getByRole('link', { name: 'Summary' }));

    expect(screen.getByRole('link', { name: 'Summary' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(globalThis.location.pathname).toBe('/recon-summary');

    await user.click(screen.getByRole('link', { name: /Reports/i }));

    expect(screen.getByRole('link', { name: /Reports/i })).toHaveAttribute('aria-current', 'page');
    expect(globalThis.location.pathname).toBe('/export');
  });

  it('swaps Review panels via the rail and exports from Close', async () => {
    mockImportRunSubmitFlow();

    setAuthenticatedUser('rray');

    renderApp();

    await fillUploadInputs();

    fireEvent.click(screen.getByRole('button', { name: 'Submit run' }));

    await waitFor(() => {
      expect(screen.getByText('Total reviewed')).toBeInTheDocument();
    });

    expect(screen.getByRole('heading', { name: 'Review' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Summary' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(
      screen.getByRole('heading', { name: 'Exception Category Breakdown' }),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Likely Split/Combine Issue').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Deposit Grouping Issue').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('link', { name: /Exceptions/i }));

    expect(screen.getByPlaceholderText(/Search file, message, or tokens/i)).toBeInTheDocument();
    // R3 X4: a multi-counterpart row no longer renders the ' | '-joined string inline. It shows one
    // coloured source tag per distinct source plus a count, and keeps the full joined text as the
    // cell's title so it stays searchable/hoverable.
    const counterpartCell = screen
      .getAllByTitle(/GL gl.xlsx \/ 4 \| GL gl.xlsx \/ 5/i)
      .find((element) => element.classList.contains('exception-row__counterpart'));
    expect(counterpartCell).toBeDefined();
    expect(counterpartCell).toHaveTextContent('2 counterparts');
    expect(counterpartCell?.querySelectorAll('.exception-row__source').length).toBe(1);

    fireEvent.click(screen.getByRole('link', { name: /Reports/i }));

    expect(screen.getByText('run-1.xlsx')).toBeInTheDocument();
    expect(screen.getByText(/Summary \| Probable Matches \| Exceptions/i)).toBeInTheDocument();
  });

  it('keeps a persisted run visible once the server confirms it is still the latest success', () => {
    // Issue #154: a persisted run alone is no longer trusted on its own -- the mount-time effect
    // always asks the server, so this run must also be what the server reports as the latest
    // succeeded run, or the effect would evict it (see the direct regression test below for the
    // case where the server disagrees).
    const runResponse = createRunResponse();
    mockedApiState.latestImportRunResponse = createImportRunSummary({
      status: 'RECONCILING',
      matchingJobId: runResponse.id,
    });
    mockedApiState.matchingRunReportResponse = runResponse;

    setAuthenticatedUser('rray');
    globalThis.localStorage.setItem(
      'reconciliation-platform:latest-report-run',
      // Must track RUN_STORAGE_SCHEMA_VERSION in App.tsx: a persisted run stored under an older
      // version is deliberately discarded, so a stale literal here silently stops testing hydration.
      JSON.stringify({ version: 4, run: runResponse }),
    );

    renderApp();

    fireEvent.click(screen.getByRole('link', { name: 'Summary' }));

    return waitFor(() => {
      expect(screen.getAllByText('Total reviewed').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Exact matches').length).toBeGreaterThan(0);
      expect(screen.queryByText('No review output yet')).toBeNull();
    });
  });

  it('a stale successful persisted run does not mask a newer failed run (Issue #154 regression)', async () => {
    // The direct regression test for the reported bug: an unrelated old successful run sits in
    // localStorage (e.g. from a prior session), but the server's actual latest run failed File
    // Validation. The stale cache must be evicted, not shown -- checked on the Review tab (not
    // Import Files, the default route) specifically because that's where the stale *success*
    // content would have wrongly appeared; the validation-failure view itself renders on Import
    // Files and independently re-fetches its own per-file detail, which isn't this test's concern.
    globalThis.localStorage.setItem(
      'reconciliation-platform:latest-report-run',
      JSON.stringify({ version: 4, run: createRunResponse() }),
    );
    mockedApiState.latestImportRunResponse = createImportRunSummary({
      label: 'Real Failed Attempt',
      status: 'VALIDATION_FAILED',
    });

    setAuthenticatedUser('rray');
    renderApp();

    fireEvent.click(screen.getByRole('link', { name: 'Summary' }));

    await waitFor(() => {
      expect(screen.getByText('No review output yet')).toBeInTheDocument();
    });

    expect(globalThis.localStorage.getItem('reconciliation-platform:latest-report-run')).toBeNull();
    expect(screen.queryByText('Total reviewed')).toBeNull();
  });

  it('discards a persisted run stored under an outdated schema version', () => {
    setAuthenticatedUser('rray');
    globalThis.localStorage.setItem(
      'reconciliation-platform:latest-report-run',
      JSON.stringify(createRunResponse()),
    );

    renderApp();

    expect(globalThis.localStorage.getItem('reconciliation-platform:latest-report-run')).toBeNull();
  });

  it('hydrates the Review tab from the backend latest-run endpoint when storage is empty', async () => {
    const runResponse = createRunResponse();
    mockedApiState.latestImportRunResponse = createImportRunSummary({
      status: 'RECONCILING',
      matchingJobId: runResponse.id,
    });
    mockedApiState.matchingRunReportResponse = runResponse;
    setAuthenticatedUser('rray');

    renderApp();

    fireEvent.click(screen.getByRole('link', { name: 'Summary' }));

    await waitFor(() => {
      expect(screen.getAllByText('Total reviewed').length).toBeGreaterThan(0);
    });

    expect(screen.getAllByText('Exact matches').length).toBeGreaterThan(0);
    expect(screen.queryByText('No review output yet')).toBeNull();
  });

  it('shows a loading state while hydrating the latest backend report', async () => {
    const runResponse = createRunResponse();
    const deferred = createDeferred<ReturnType<typeof createImportRunSummary>>();
    mockedApiState.latestImportRunPromise = deferred.promise;
    mockedApiState.matchingRunReportResponse = runResponse;
    setAuthenticatedUser('rray');

    renderApp();

    fireEvent.click(screen.getByRole('link', { name: 'Summary' }));

    expect(screen.getByRole('status')).toHaveTextContent('Loading review output');

    deferred.resolve(
      createImportRunSummary({ status: 'RECONCILING', matchingJobId: runResponse.id }),
    );

    await waitFor(() => {
      expect(screen.getAllByText('Total reviewed').length).toBeGreaterThan(0);
    });
  });

  it('shows an alert when latest-run hydration fails', async () => {
    mockedApiState.latestImportRunError = new Error('Backend unavailable.');
    setAuthenticatedUser('rray');

    renderApp();

    fireEvent.click(screen.getByRole('link', { name: 'Summary' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Backend unavailable.');
    });

    expect(screen.getByText('Latest review output could not be loaded')).toBeInTheDocument();
  });

  it('Issue #154: shows the live status message from the run events stream while running', async () => {
    mockedApiState.latestImportRunResponse = createImportRunSummary({
      label: 'In-Flight Run',
      status: 'VALIDATING',
    });

    const encoder = new TextEncoder();
    const eventsUrl = `/api/imports/runs/${IMPORT_RUN_ID}/events`;
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = requestUrl(input);
      if (url === eventsUrl) {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                `${JSON.stringify({
                  organizationId: 'test-org',
                  processId: IMPORT_RUN_ID,
                  queueType: 'import-validation',
                  statusMessage: 'Matching started…',
                })}\n`,
              ),
            );
          },
        });
        return Promise.resolve(new Response(stream, { status: 200 }));
      }
      throw new Error(`unexpected fetch call to ${url}`);
    });

    setAuthenticatedUser('rray');
    renderApp();

    await waitFor(() => {
      expect(screen.getByText('Matching started…')).toBeInTheDocument();
    });
  });

  it('shows the durable validation-failure phase after a remount with no live mutation', async () => {
    mockedApiState.latestImportRunResponse = createImportRunSummary({
      label: 'Failed Validation Run',
      status: 'VALIDATION_FAILED',
    });
    setAuthenticatedUser('rray');

    renderApp();

    await waitFor(() => {
      expect(screen.getByText('Validation failed')).toBeInTheDocument();
    });
  });

  it('shows the durable reconciliation-failure message via a FAILED reconciliation_job (legacy/queue path)', async () => {
    mockedApiState.latestImportRunResponse = createImportRunSummary({
      label: 'Failed Matching Run',
      status: 'PENDING_APPROVAL',
      matchingJobId: 'matching-job-failed',
      matchingJob: {
        id: 'matching-job-failed',
        currentState: 'FAILED',
        failureCode: 'MATCH_ENGINE_ERROR',
        failureMessage: 'Matching engine crashed while grouping split payments.',
        completedAt: '2026-08-21T00:05:00.000Z',
      },
    });
    setAuthenticatedUser('rray');

    renderApp();

    // Both the RunBar's status pill and the progress-meter's current-step label render
    // "Reconciliation failed" for this phase -- legitimate, not a bug, so this asserts on the
    // count rather than a single unique match (matching this file's existing pattern for text
    // that appears in more than one place).
    await waitFor(() => {
      expect(screen.getAllByText('Reconciliation failed').length).toBeGreaterThan(0);
    });
    expect(
      screen.getByText(/Matching engine crashed while grouping split payments\./),
    ).toBeInTheDocument();
  });

  it('shows the durable reconciliation-failure message via a FAILED import_job (the live path)', async () => {
    mockedApiState.latestImportRunResponse = createImportRunSummary({
      label: 'Failed Matching Run Live Path',
      status: 'PENDING_APPROVAL',
      validationJob: {
        id: 'validation-job-failed',
        status: 'FAILED',
        errorSummary: 'Matching engine crashed mid-run.',
        queuedAt: '2026-08-21T00:00:00.000Z',
        finishedAt: '2026-08-21T00:04:00.000Z',
      },
    });
    setAuthenticatedUser('rray');

    renderApp();

    await waitFor(() => {
      expect(screen.getAllByText('Reconciliation failed').length).toBeGreaterThan(0);
    });
    expect(screen.getByText(/Matching engine crashed mid-run\./)).toBeInTheDocument();
  });

  it('shows idle for an organization with no runs, without crashing', async () => {
    // Default mock state -- latestImportRunResponse is null (no explicit setup needed), matching
    // a genuinely fresh organization that has never submitted a run.
    setAuthenticatedUser('rray');

    renderApp();

    await waitFor(() => {
      expect(screen.getByText('Idle')).toBeInTheDocument();
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps a cached run visible while the latest-run fetch is still in flight', () => {
    const deferred = createDeferred<ReturnType<typeof createImportRunSummary>>();
    mockedApiState.latestImportRunPromise = deferred.promise;
    globalThis.localStorage.setItem(
      'reconciliation-platform:latest-report-run',
      JSON.stringify({ version: 4, run: createRunResponse() }),
    );

    setAuthenticatedUser('rray');
    renderApp();

    fireEvent.click(screen.getByRole('link', { name: 'Summary' }));

    // The deferred is deliberately left unresolved for the rest of this test -- the cached run
    // must still be showing while the durable fetch is pending, not blanked pre-emptively.
    expect(screen.getAllByText('Total reviewed').length).toBeGreaterThan(0);
    expect(screen.queryByText('No review output yet')).toBeNull();
  });

  it('shows the rules catalog with read-only thresholds for non-admins', async () => {
    setAuthenticatedUser('bray');
    renderApp();

    fireEvent.click(screen.getByRole('button', { name: 'Rules' }));

    // The version header's badge/publish metadata comes from an async GET /api/rules/versions
    // fetch (mocked via mockedApiState.ruleVersionsResponse) -- wait for it before asserting on
    // state that depends on it (the read-only banner, the disabled sliders).
    await waitFor(() => {
      expect(screen.getByText('v7 · ACTIVE')).toBeInTheDocument();
    });

    expect(screen.getByRole('heading', { name: 'Matching Rules' })).toBeInTheDocument();
    expect(screen.getByText('Reference + Amount Match')).toBeInTheDocument();
    expect(screen.getByText('Likely Miscoding')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Variance thresholds' })).toBeInTheDocument();

    expect(screen.queryByRole('slider')).toBeNull();
    // One whole-screen affordance, not a repeated per-row line -- exactly one occurrence.
    expect(screen.getByText('Read-only — admins set thresholds.')).toBeInTheDocument();
    expect(screen.getAllByText('21 days').length).toBeGreaterThan(0);
  });

  it('shows NOT APPLIED and genuinely disables editing, even for an admin, while overrides are not wired to the engine', async () => {
    mockedApiState.ruleVersionsResponse = {
      ...mockedApiState.defaultRuleVersionsResponse,
      overridesAppliedToEngine: false,
    };
    setAuthenticatedUser('rray3');
    renderApp();

    fireEvent.click(screen.getByRole('button', { name: 'Rules' }));

    await waitFor(() => {
      expect(
        screen.getByText('Not applied — thresholds are not reaching the engine'),
      ).toBeInTheDocument();
    });

    // No slider renders at all -- the acceptance bar isn't "disabled inputs users could still
    // try to interact with," it's that no override value can be submitted while this shows.
    expect(screen.queryByRole('slider')).toBeNull();
    expect(screen.getByText('defaultReconciliationConfig')).toBeInTheDocument();
    expect(
      screen.getByText((_, element) => {
        const hasText = (node: Element | null) =>
          Boolean(node?.textContent?.includes('threaded into the reconciliation pipeline'));
        return (
          hasText(element) && Array.from(element?.children ?? []).every((child) => !hasText(child))
        );
      }),
    ).toBeInTheDocument();
  });

  it('renders the rule grid with distinct TUNABLE treatment per rule, ASSIGNED TO chips, and a matching footer count', async () => {
    setAuthenticatedUser('rray');
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'Rules' }));
    await screen.findByText('v7 · ACTIVE');

    // Tunable, non-elevated: plain metric count. Two fixture rules (reference-amount-match,
    // LikelyMiscoding) each have exactly one metric, so this name isn't unique.
    expect(screen.getAllByRole('button', { name: '1 metric' })).toHaveLength(2);
    // Tunable, elevated risk: distinctly labeled and colored (not "one more grey slider").
    const elevatedButton = screen.getByRole('button', { name: /1 metric · elevated risk/ });
    expect(elevatedButton.className).toContain('rule-grid__tunable--elevated');
    // Fixed: stated explicitly, never blank, and not a clickable link to nowhere. Scoped to the
    // grid itself -- the NavRail also has a "No adjustable metric" filter sub-item (T5).
    const grid = screen.getByRole('table', { name: 'Matching rules' });
    expect(within(grid).getByText('No adjustable metric')).toBeInTheDocument();
    expect(within(grid).queryByRole('button', { name: 'No adjustable metric' })).toBeNull();

    // ASSIGNED TO: every row shows the same global profile chips (no per-rule assignment yet).
    expect(screen.getAllByText('Chase Operating').length).toBeGreaterThan(1);
    expect(screen.getAllByText('WF Payroll').length).toBeGreaterThan(1);

    // Footer count matches the (unfiltered) grid: 5 fixture rules, 4 tunable, 1 fixed.
    expect(screen.getByText('Showing 5 of 5 · 4 tunable · 1 fixed')).toBeInTheDocument();
  });

  it('clicking TUNABLE scrolls to and highlights the metric that rule governs', async () => {
    setAuthenticatedUser('rray');
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'Rules' }));
    await screen.findByText('v7 · ACTIVE');

    const wireFeeMetricRow = document.getElementById('variance-metric-wireFeeTolerance');
    expect(wireFeeMetricRow).not.toBeNull();
    expect(wireFeeMetricRow?.className).not.toContain('rule-variance-item--highlighted');

    fireEvent.click(screen.getByRole('button', { name: /1 metric · elevated risk/ }));

    expect(scrollIntoViewMock).toHaveBeenCalled();
    expect(wireFeeMetricRow?.className).toContain('rule-variance-item--highlighted');
  });

  it('shows LAST CHANGE from the active version only for rules that version actually touched', async () => {
    mockedApiState.ruleVersionsResponse = {
      ...mockedApiState.defaultRuleVersionsResponse,
      active: {
        ...mockedApiState.defaultRuleVersionsResponse.active!,
        varianceOverrides: { wireFeeTolerance: 750 },
        publishedAt: '2026-08-04T00:00:00.000Z',
      },
    };
    setAuthenticatedUser('rray');
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'Rules' }));
    await screen.findByText('v7 · ACTIVE');

    // The rule whose metric was actually overridden shows the publish date -- formatted via the
    // same helper the component uses, so this assertion doesn't hardcode a timezone-dependent
    // calendar day for a UTC-midnight timestamp.
    expect(screen.getByText(formatCompactDate('2026-08-04T00:00:00.000Z'))).toBeInTheDocument();
    // ...while rules untouched by that override, and fixed rules, show an explicit "—".
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('search filters the rule grid by name and description, live and client-side', async () => {
    setAuthenticatedUser('rray');
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'Rules' }));
    await screen.findByText('v7 · ACTIVE');

    expect(screen.getByText('Reference + Amount Match')).toBeInTheDocument();
    expect(screen.getByText('Missing from Bank')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/Search \d+ rules/), {
      target: { value: 'correspondent' },
    });

    expect(screen.getByText('Wire Correspondent Fee Deduction')).toBeInTheDocument();
    expect(screen.queryByText('Reference + Amount Match')).toBeNull();
    expect(screen.queryByText('Missing from Bank')).toBeNull();
  });

  it('family and tunable filters compose rather than replacing each other, and round-trip through the URL', async () => {
    setAuthenticatedUser('rray');
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'Rules' }));
    await screen.findByText('v7 · ACTIVE');

    fireEvent.click(screen.getByRole('button', { name: 'Classifier' }));
    expect(screen.getByText('Likely Miscoding')).toBeInTheDocument();
    expect(screen.getByText('Missing from Bank')).toBeInTheDocument();
    expect(screen.queryByText('Reference + Amount Match')).toBeNull();
    expect(globalThis.location.search).toContain('family=classifier');

    // Composes with the existing family filter -- doesn't replace it.
    fireEvent.click(screen.getByRole('button', { name: 'Fixed only' }));
    expect(screen.getByText('Missing from Bank')).toBeInTheDocument();
    expect(screen.queryByText('Likely Miscoding')).toBeNull();
    expect(globalThis.location.search).toContain('family=classifier');
    expect(globalThis.location.search).toContain('tunable=false');
  });

  // N3: the rail's own per-family sub-items (with counts/active-state) duplicated the Matching
  // Rules screen's own filter chips and are removed -- the URL deep-link itself must still work,
  // which is what this test now covers exclusively.
  it('reflects a family filter from the URL on load', async () => {
    setAuthenticatedUser('rray');
    globalThis.history.pushState({}, '', '/mapping/rules?family=matching');
    renderApp();
    await screen.findByText('v7 · ACTIVE');

    expect(screen.getByText('Reference + Amount Match')).toBeInTheDocument();
    expect(screen.getByText('Wire Correspondent Fee Deduction')).toBeInTheDocument();
    expect(screen.queryByText('Missing from Bank')).toBeNull();
  });

  it('shows an explicit empty state naming the active filters, with a working clear-all', async () => {
    setAuthenticatedUser('rray');
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'Rules' }));
    await screen.findByText('v7 · ACTIVE');

    fireEvent.change(screen.getByPlaceholderText(/Search \d+ rules/), {
      target: { value: 'no rule matches this text' },
    });

    expect(screen.getByText(/No rules matching "no rule matches this text"/)).toBeInTheDocument();
    expect(screen.queryByText('Reference + Amount Match')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Clear all filters' }));

    expect(screen.getByText('Reference + Amount Match')).toBeInTheDocument();
    expect(screen.queryByText(/No rules matching/)).toBeNull();
  });

  it('shows a no-data review state before any reconciliation run exists', () => {
    const deferred = createDeferred<ReturnType<typeof createImportRunSummary>>();
    mockedApiState.latestImportRunPromise = deferred.promise;
    setAuthenticatedUser('rray');
    renderApp();

    fireEvent.click(screen.getByRole('link', { name: 'Summary' }));

    expect(screen.getByRole('link', { name: 'Summary' })).toBeInTheDocument();
    expect(screen.getByText('Loading review output')).toBeInTheDocument();
  });

  it('shows a monthly month picker by default with twelve month options', () => {
    setAuthenticatedUser('rray');
    renderApp();

    const monthSelect = screen.getByLabelText(/Monthly reconciliation month/i);
    const options = Array.from((monthSelect as HTMLSelectElement).options).map(
      (option) => option.value,
    );

    expect(options).toHaveLength(12);
    expect(options[0]).toBe('January');
    expect(options[11]).toBe('December');
    expect(screen.queryByLabelText('Annual reconciliation year')).toBeNull();

    const month = monthsWithinYear[new Date().getMonth()] ?? 'January';
    const currentYear = new Date().getFullYear();
    expect(screen.getByLabelText(/Reconciliation label/i)).toHaveValue(
      `Monthly Recon for ${month} ${currentYear}`,
    );
    expect(
      screen.getByText(`Month applies to the current year (${currentYear}).`),
    ).toBeInTheDocument();
    expect(
      screen.getByText(`Suggested: Monthly Recon for ${month} ${currentYear}`),
    ).toBeInTheDocument();
  });

  // R2 V3 (necessary rewrite, not one of V1's two named ones): this test asserted the
  // `Overall process progress` <progress> element's numeric value directly -- exactly the
  // percentage-implies-precision mechanic V3 deletes (`overallProgressPercent`, and the element
  // itself, no longer exist). Rewritten to assert the run step's own status instead: `ready` once
  // everything is staged (before Submit run is ever clicked), still `pending` beforehand.
  it('shows the run step as ready once files are staged, pending before', async () => {
    setAuthenticatedUser('rray');
    renderApp();

    expect(screen.getByText('Process Progress')).toBeInTheDocument();
    expect(runStepChip().getByText('Pending')).toBeInTheDocument();

    await fillUploadInputs();

    expect(runStepChip().getByText('Ready')).toBeInTheDocument();
  });

  it('shows an annual year picker with the previous seven years when annual is selected', () => {
    setAuthenticatedUser('rray');
    renderApp();

    fireEvent.change(screen.getByLabelText('Reconciliation frequency'), {
      target: { value: 'Annual' },
    });

    const annualYearSelect = screen.getByLabelText(/Annual reconciliation year/i);
    const options = Array.from((annualYearSelect as HTMLSelectElement).options).map(
      (option) => option.value,
    );

    const currentYear = new Date().getFullYear();
    expect(options).toHaveLength(7);
    expect(options[0]).toBe(String(currentYear - 1));
    expect(options[6]).toBe(String(currentYear - 7));
    expect(screen.queryByLabelText('Monthly reconciliation month')).toBeNull();
    expect(screen.getByLabelText(/Reconciliation label/i)).toHaveValue(
      `Annual Recon for ${String(currentYear - 1)}`,
    );
    expect(screen.getByText('Choose one of the last 7 completed years.')).toBeInTheDocument();
  });

  it('uploads files and renders returned reconciliation metrics', async () => {
    mockImportRunSubmitFlow();

    setAuthenticatedUser('rray');

    renderApp();

    await fillUploadInputs();
    fireEvent.change(screen.getByPlaceholderText('OPERATING-001'), {
      target: { value: 'OPERATING-001' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Submit run' }));

    await waitFor(() => {
      expect(screen.getByText(/Run finished/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Copy run ID' })).toBeInTheDocument();
      expect(screen.getByText('Total reviewed')).toBeInTheDocument();
      expect(screen.getByText('12')).toBeInTheDocument();
      expect(screen.getAllByText('Missing in GL').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Missing from GL').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Likely Split/Combine Issue').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Deposit Grouping Issue').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('announces mutation errors when reconciliation submission fails', async () => {
    installFakeImportRunXhr({ status: 500, body: { message: 'Upload failed.' } });

    setAuthenticatedUser('rray');

    renderApp();

    await fillUploadInputs();

    fireEvent.click(screen.getByRole('button', { name: 'Submit run' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Upload failed.');
    });
  });

  it('renders the operation-specific message, reference, and code for a typed 503 (error-handling-build-plan.md EH4)', async () => {
    installFakeImportRunXhr({
      status: 503,
      body: {
        message:
          'Unable to create an import run. This feature requires a database connection, which is not configured in this environment.',
        code: 'RCN-DB-001',
        reference: '7f3a9c2e-4b11-4c00-8000-000000000000',
        retryable: false,
      },
    });

    setAuthenticatedUser('rray');

    renderApp();

    await fillUploadInputs();

    fireEvent.click(screen.getByRole('button', { name: 'Submit run' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Unable to create an import run. This feature requires a database connection, which is not configured in this environment.',
      );
    });

    expect(screen.getByRole('alert')).toHaveTextContent(
      'If you contact support, quote reference 7f3a9c2e-4b11-4c00-8000-000000000000.',
    );
    expect(screen.getByText('RCN-DB-001')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('offers a retry button when the typed error is retryable, and resends the same files on click', async () => {
    const xhr = installFakeImportRunXhr({
      status: 503,
      body: {
        message: 'The service could not reach its database. Please try again shortly.',
        code: 'RCN-DB-002',
        reference: 'ref-retry-1',
        retryable: true,
      },
    });

    setAuthenticatedUser('rray');

    renderApp();

    await fillUploadInputs();

    fireEvent.click(screen.getByRole('button', { name: 'Submit run' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    });
    expect(xhr.instances.length).toBe(1);

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(xhr.instances.length).toBe(2);
    });
    // Still retryable (same 503 both times) -- the banner and its retry affordance persist.
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('submits the selected local files and metadata as multipart form data', async () => {
    mockImportRunSubmitFlow();

    setAuthenticatedUser('rray');

    renderApp();

    const bankFileA = new File(['bank-a-data'], '1111_bank.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const bankFileB = new File(['bank-b-data'], '2222_bank.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const glFile = new File(['gl-data'], 'gl.xlsx', {
      type: 'application/octet-stream',
    });

    await fillUploadInputs({ bankFiles: [bankFileA, bankFileB], glFile });
    fireEvent.change(screen.getByPlaceholderText('OPERATING-001'), {
      target: { value: 'OPERATING-001' },
    });
    fireEvent.change(screen.getByLabelText(/Reconciliation frequency/i), {
      target: { value: 'Annual' },
    });
    fireEvent.change(screen.getByLabelText(/Annual reconciliation year/i), {
      target: { value: '2023' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Submit run' }));

    await waitFor(() => {
      expect(FakeImportRunXhr.instances).toHaveLength(1);
    });

    const request = FakeImportRunXhr.instances[0]!;
    expect(request.method).toBe('POST');
    expect(request.url).toBe('/api/imports/runs');
    expect(request.body).toBeInstanceOf(FormData);

    const formData = request.body as FormData;
    expect(formData.getAll('bankFiles')).toEqual([bankFileA, bankFileB]);
    expect(formData.get('glFile')).toBe(glFile);
    expect(formData.get('accountIdentifier')).toBe('OPERATING-001');
    expect(formData.get('frequency')).toBe('ANNUAL');
    expect(formData.get('periodYear')).toBe('2023');
    expect(formData.get('label')).toBe('Annual Recon for 2023');
  });

  it('submits selected monthly month as period label when frequency is monthly', async () => {
    mockImportRunSubmitFlow();

    setAuthenticatedUser('rray');

    renderApp();

    await fillUploadInputs();
    fireEvent.change(screen.getByLabelText(/Monthly reconciliation month/i), {
      target: { value: 'March' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Submit run' }));

    await waitFor(() => {
      expect(FakeImportRunXhr.instances).toHaveLength(1);
    });

    const formData = FakeImportRunXhr.instances[0]!.body as FormData;

    expect(formData.get('frequency')).toBe('MONTHLY');
    expect(formData.get('periodMonth')).toBe('3');
    expect(formData.get('label')).toBe(`Monthly Recon for March ${new Date().getFullYear()}`);
  });

  it('allows editing the prepopulated reconciliation label before submit', async () => {
    mockImportRunSubmitFlow();

    setAuthenticatedUser('rray');

    renderApp();

    await fillUploadInputs();
    fireEvent.change(screen.getByLabelText(/Reconciliation label/i), {
      target: { value: 'Custom Monthly Label' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Submit run' }));

    await waitFor(() => {
      expect(FakeImportRunXhr.instances).toHaveLength(1);
    });

    const formData = FakeImportRunXhr.instances[0]!.body as FormData;

    expect(formData.get('label')).toBe('Custom Monthly Label');
  });

  it('keeps the suggested label hint visible after custom edits', () => {
    setAuthenticatedUser('rray');
    renderApp();

    fireEvent.change(screen.getByLabelText(/Reconciliation label/i), {
      target: { value: 'Custom Label' },
    });

    fireEvent.change(screen.getByLabelText(/Monthly reconciliation month/i), {
      target: { value: 'April' },
    });

    expect(screen.getByLabelText(/Reconciliation label/i)).toHaveValue('Custom Label');
    expect(
      screen.getByText(`Suggested: Monthly Recon for April ${new Date().getFullYear()}`),
    ).toBeInTheDocument();
  });

  it('resets the reconciliation label to the suggested value', () => {
    setAuthenticatedUser('rray');
    renderApp();

    const labelInput = screen.getByLabelText(/Reconciliation label/i);
    fireEvent.change(labelInput, { target: { value: 'Custom Label' } });
    expect(labelInput).toHaveValue('Custom Label');

    fireEvent.click(screen.getByRole('button', { name: 'Reset to suggested' }));

    const currentYear = new Date().getFullYear();
    const month = monthsWithinYear[new Date().getMonth()];
    expect(labelInput).toHaveValue(`Monthly Recon for ${month} ${currentYear}`);
  });

  it('assigns bank and GL files from the merged drop zone by file name', async () => {
    setAuthenticatedUser('rray');
    renderApp();

    fireEvent.change(screen.getByLabelText('Source workbooks'), {
      target: {
        files: [
          new File(['bank-a'], '1111_bank.xlsx'),
          new File(['bank-b'], '2222_bank.xlsx'),
          new File(['gl'], 'gl.xlsx'),
        ],
      },
    });

    // R2 V4.3: `aria-disabled`, not the native `disabled` attribute, so a screen reader can still
    // reach the reason via `aria-describedby` on a disabled button -- `toBeDisabled()` checks the
    // native attribute, which this button no longer has at all.
    // Awaited since A-D1 (Issue #338): the account registry is fetched, so each statement's
    // assignment -- and with it the last reason Submit is disabled -- settles a tick after the
    // files are staged.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Submit run' })).toHaveAttribute(
        'aria-disabled',
        'false',
      );
    });
    expect(screen.getAllByText('1111_bank.xlsx').length).toBeGreaterThan(0);
    expect(screen.getAllByText('2222_bank.xlsx').length).toBeGreaterThan(0);
    expect(screen.getAllByText('gl.xlsx').length).toBeGreaterThan(0);
  });

  it('accepts CSV workbooks alongside XLSX in the merged drop zone', async () => {
    setAuthenticatedUser('rray');
    renderApp();

    fireEvent.change(screen.getByLabelText('Source workbooks'), {
      target: {
        files: [
          new File(['bank-a'], '1111_bank.csv'),
          new File(['bank-b'], '2222_bank.csv'),
          new File(['gl'], 'gl.csv'),
        ],
      },
    });

    // R2 V4.3: `aria-disabled`, not the native `disabled` attribute, so a screen reader can still
    // reach the reason via `aria-describedby` on a disabled button -- `toBeDisabled()` checks the
    // native attribute, which this button no longer has at all.
    // Awaited since A-D1 (Issue #338): the account registry is fetched, so each statement's
    // assignment -- and with it the last reason Submit is disabled -- settles a tick after the
    // files are staged.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Submit run' })).toHaveAttribute(
        'aria-disabled',
        'false',
      );
    });
    expect(screen.getAllByText('1111_bank.csv').length).toBeGreaterThan(0);
    expect(screen.getAllByText('2222_bank.csv').length).toBeGreaterThan(0);
    expect(screen.getAllByText('gl.csv').length).toBeGreaterThan(0);
  });

  it('shows Manual override when a slot picker disagrees with filename-based detection', () => {
    setAuthenticatedUser('rray');
    renderApp();

    // "4321_gl-export.xlsx" auto-detects to the GL slot (and satisfies the bank account-filename
    // convention so the override check itself is what's under test here, not the filename gate);
    // forcing it into the Bank Account 1 slot picker instead should flag the mismatch rather than
    // silently accept it.
    fireEvent.change(screen.getByLabelText('Bank workbook (Account 1)'), {
      target: { files: [new File(['gl'], '4321_gl-export.xlsx')] },
    });

    expect(screen.getByText('Manual override')).toBeInTheDocument();
  });

  it('exposes Bank and GL template downloads from the Import source files header', () => {
    setAuthenticatedUser('rray');
    renderApp();

    const templatesMenu = screen
      .getByText('Download templates', { selector: 'summary' })
      .closest('details')!;
    const menu = within(templatesMenu);
    expect(menu.getByRole('link', { name: 'Bank template (CSV)' })).toHaveAttribute(
      'href',
      '/templates/bank-template.csv',
    );
    expect(menu.getByRole('link', { name: 'Bank template (XLSX)' })).toHaveAttribute(
      'href',
      '/templates/bank-template.xlsx',
    );
    expect(menu.getByRole('link', { name: 'GL template (CSV)' })).toHaveAttribute(
      'href',
      '/templates/gl-template.csv',
    );
    expect(menu.getByRole('link', { name: 'GL template (XLSX)' })).toHaveAttribute(
      'href',
      '/templates/gl-template.xlsx',
    );
  });

  // R2 V1 (named rewrite): this test used to assert `role="alert"` text matching
  // `/queued for validation/i` -- passing today for the wrong reason (its own name says "instead
  // of hanging": it only proved *a* message appeared, not that the message was honest). A queued
  // submission is a real, working outcome, not an error -- it must render as a status, never an
  // alert, and the run-in-flight tone must read "Queued", never fall through to "Idle" (D6).
  it('renders a queued submission as a status, never an alert, and never reads Idle', async () => {
    installFakeImportRunXhr();
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = requestUrl(input);
      if (url === `/api/imports/runs/${IMPORT_RUN_ID}/submit`) {
        return Promise.resolve(
          new Response(JSON.stringify({ importJobId: 'import-job-1', status: 'queued' }), {
            status: 202,
          }),
        );
      }
      throw new Error(`unexpected fetch call to ${url}`);
    });

    setAuthenticatedUser('rray');
    renderApp();

    await fillUploadInputs();

    fireEvent.click(screen.getByRole('button', { name: 'Submit run' }));

    // "Queued" now renders in two places -- the RunBar status pill (V1) and the run step's own
    // chip (V2) -- so this asserts presence, not uniqueness.
    await waitFor(() => {
      expect(screen.getAllByText('Queued').length).toBeGreaterThan(0);
    });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText('Idle')).not.toBeInTheDocument();
  });

  // R2 V1: the durable phase (not just the live mutation) must leave `queued` on its own once the
  // backend resolves, since a queued submission's real outcome is often known within a second and
  // nothing previously re-checked without a manual reload. `getLatestImportRunRequest` is mocked
  // at the module level (see `mockedApiState`), not via raw `fetch` -- mutating
  // `latestImportRunResponse` between the initial submit and the timer advance simulates the
  // backend finishing between poll ticks.
  it('polls until a queued run leaves the queued phase, without a reload', async () => {
    // Fake timers have to be installed *before* the polling effect's own `setInterval` call runs
    // (i.e. before render/submit) -- installing them later doesn't retroactively convert an
    // already-created real interval into a fake one, so advancing fake time afterward would do
    // nothing and the test would hang waiting on a real interval that never gets a chance to fire
    // within the test's timeout.
    vi.useFakeTimers();
    try {
      installFakeImportRunXhr();
      vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
        const url = requestUrl(input);
        if (url === `/api/imports/runs/${IMPORT_RUN_ID}/submit`) {
          return Promise.resolve(
            new Response(JSON.stringify({ importJobId: 'import-job-1', status: 'queued' }), {
              status: 202,
            }),
          );
        }
        throw new Error(`unexpected fetch call to ${url}`);
      });

      setAuthenticatedUser('rray');
      renderApp();

      await fillUploadInputs();

      fireEvent.click(screen.getByRole('button', { name: 'Submit run' }));

      // Set only after submitting, not before rendering -- setting it earlier would make the
      // mount-time hydration fetch (unrelated to this submission) see an already-queued run and
      // start this test in a different state than a fresh session actually would.
      mockedApiState.latestImportRunResponse = createImportRunSummary({
        validationJob: {
          id: 'validation-job-1',
          status: 'QUEUED',
          errorSummary: null,
          queuedAt: '2026-08-21T00:00:00.000Z',
          finishedAt: null,
        },
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      // "Queued" renders in both the RunBar pill (V1) and the run step's own chip (V2).
      expect(screen.getAllByText('Queued').length).toBeGreaterThan(0);

      // The backend has since finished -- the next poll tick should pick this up without a reload.
      mockedApiState.latestImportRunResponse = createImportRunSummary({
        status: 'VALIDATION_FAILED',
      });

      // The interval callback itself calls an async `getLatestImportRunRequest`, not a bare
      // synchronous timer body -- `advanceTimersByTimeAsync` (not the sync `advanceTimersByTime`)
      // is what actually waits for that promise chain to settle before returning.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });

      expect(screen.getAllByText('Validation failed').length).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  // Issue #268: the direct companion to the test above, which only ever transitions a queued run
  // to a *failure*. A failure needs no report, so that test never exercised the one terminal phase
  // that does need one -- 'succeeded' -- and the missing report fetch shipped undetected.
  //
  // Asserts 'Reconciliation complete' (the `currentStepLabel`, reachable only once `reportRun` is
  // genuinely populated) rather than the RunBar's 'Complete' pill. The pill is derived from the
  // durable phase alone, so it reads 'Complete' even with the bug present -- asserting on it would
  // pass against the broken build. Only the step label separates "the server says it finished"
  // from "we actually hold the report".
  it('fetches the report when a queued run reaches the succeeded phase, without a reload', async () => {
    vi.useFakeTimers();
    try {
      const runResponse = createRunResponse();
      installFakeImportRunXhr();
      vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
        const url = requestUrl(input);
        if (url === `/api/imports/runs/${IMPORT_RUN_ID}/submit`) {
          return Promise.resolve(
            new Response(JSON.stringify({ importJobId: 'import-job-1', status: 'queued' }), {
              status: 202,
            }),
          );
        }
        throw new Error(`unexpected fetch call to ${url}`);
      });

      setAuthenticatedUser('rray');
      renderApp();

      await fillUploadInputs();

      fireEvent.click(screen.getByRole('button', { name: 'Submit run' }));

      mockedApiState.latestImportRunResponse = createImportRunSummary({
        validationJob: {
          id: 'validation-job-1',
          status: 'QUEUED',
          errorSummary: null,
          queuedAt: '2026-08-21T00:00:00.000Z',
          finishedAt: null,
        },
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(screen.getAllByText('Queued').length).toBeGreaterThan(0);

      // The backend finished between ticks -- exactly the live Dev shape that exposed this: the
      // run is RECONCILED with its matching job linked, and the report is resolvable by that id.
      mockedApiState.latestImportRunResponse = createImportRunSummary({
        status: 'RECONCILED',
        matchingJobId: runResponse.id,
        validationJob: {
          id: 'validation-job-1',
          status: 'SUCCEEDED',
          errorSummary: null,
          queuedAt: '2026-08-21T00:00:00.000Z',
          finishedAt: '2026-08-21T00:00:03.000Z',
        },
      });
      mockedApiState.matchingRunReportResponse = runResponse;

      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      // A second flush: the poll tick above only updates the durable phase. The report fetch is a
      // separate async effect that can't even be scheduled until that state change has rendered.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(screen.getAllByText('Reconciliation complete').length).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  // Issue #293: the companion to the #268 test above, which starts with NO report held -- so a
  // `Boolean(reportRun)` guard was false there and the fetch went ahead. Here a previous run's
  // report is already held (persisted from an earlier session), the ordinary shape after the first
  // run of any session. That made the old guard true, the second run's report was never fetched,
  // and the screen sat on the stale one until a manual reload.
  //
  // Asserts on the rendered source-file names, which come from `reportRun.sourceFiles` and so
  // differ between the two runs -- the one rendered field that says WHICH report is held.
  // 'Reconciliation complete' (what #268 asserts) is true for both runs and would pass against the
  // bug. The precondition is asserted explicitly too, so the test proves the stale report really
  // was held before the second run rather than assuming hydration set it up.
  it('replaces a stale held report when a later queued run succeeds, without a reload (Issue #293)', async () => {
    vi.useFakeTimers();
    try {
      // Run 1's report sits in storage from an earlier session, and the server agrees it is the
      // current latest run -- so #154's hydration keeps it rather than evicting it. Pre-set the
      // report mock to the same run so a hydration re-fetch, if any, is a no-op rather than a fall
      // through to the real fetch (which the spy below would reject).
      const previousRun = createRunResponse();
      globalThis.localStorage.setItem(
        'reconciliation-platform:latest-report-run',
        JSON.stringify({ version: 4, run: previousRun }),
      );
      mockedApiState.latestImportRunResponse = createImportRunSummary({
        status: 'RECONCILED',
        matchingJobId: previousRun.id,
      });
      mockedApiState.matchingRunReportResponse = previousRun;

      installFakeImportRunXhr();
      vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
        const url = requestUrl(input);
        if (url === `/api/imports/runs/${IMPORT_RUN_ID}/submit`) {
          return Promise.resolve(
            new Response(JSON.stringify({ importJobId: 'import-job-2', status: 'queued' }), {
              status: 202,
            }),
          );
        }
        throw new Error(`unexpected fetch call to ${url}`);
      });

      setAuthenticatedUser('rray');
      renderApp();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      // Precondition: run 1's report is genuinely held and showing. getAll, not get -- the joined
      // names render on more than one surface (RunBar and the summary page this landed on).
      expect(screen.getAllByText(/bank\.xlsx \+ gl\.xlsx/).length).toBeGreaterThan(0);

      // A fresh landing with a succeeded run resolves "/" to the run summary (N4), so get back to
      // the upload screen the way a user would before starting the next run.
      fireEvent.click(screen.getByRole('link', { name: 'New run' }));
      await fillUploadInputs();
      fireEvent.click(screen.getByRole('button', { name: 'Start new run' }));

      mockedApiState.latestImportRunResponse = createImportRunSummary({
        validationJob: {
          id: 'validation-job-2',
          status: 'QUEUED',
          errorSummary: null,
          queuedAt: '2026-09-05T00:00:00.000Z',
          finishedAt: null,
        },
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      // Run 2 finishes under a DIFFERENT matching job id, with a report that is distinguishable
      // from run 1's by its file names.
      const secondRun = {
        ...createRunResponse(),
        id: 'run-2',
        sourceFiles: [
          { id: '3', source: 'bank', fileName: 'second-bank.xlsx' },
          { id: '4', source: 'gl', fileName: 'second-gl.xlsx' },
        ],
      };
      mockedApiState.latestImportRunResponse = createImportRunSummary({
        status: 'RECONCILED',
        matchingJobId: secondRun.id,
        validationJob: {
          id: 'validation-job-2',
          status: 'SUCCEEDED',
          errorSummary: null,
          queuedAt: '2026-09-05T00:00:00.000Z',
          finishedAt: '2026-09-05T00:00:03.000Z',
        },
      });
      mockedApiState.matchingRunReportResponse = secondRun;

      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      // Second flush, same reason as #268: the poll tick only updates the durable phase; the
      // report fetch is a separate effect that cannot be scheduled until that render lands.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(screen.getAllByText(/second-bank\.xlsx \+ second-gl\.xlsx/).length).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  // R2 V2: the run step can now terminate -- these five cover the acceptance criteria directly.
  // All mount the durable phase straight from `mockedApiState.latestImportRunResponse` (no live
  // submission needed) since the step-chip status is derived from the same phase either way.
  const runStepChip = () => within(screen.getByText('Run reconciliation').closest('li')!);
  const reviewExportStepChip = () =>
    within(screen.getByText('Review and export outputs').closest('li')!);

  it('marks the run step failed when validation fails', async () => {
    mockedApiState.latestImportRunResponse = createImportRunSummary({
      status: 'VALIDATION_FAILED',
    });
    setAuthenticatedUser('rray');
    renderApp();

    await waitFor(() => {
      expect(runStepChip().getByText('Failed')).toBeInTheDocument();
    });
  });

  it('marks the run step failed when matching fails', async () => {
    mockedApiState.latestImportRunResponse = createImportRunSummary({
      status: 'PENDING_APPROVAL',
      validationJob: {
        id: 'validation-job-failed',
        status: 'FAILED',
        errorSummary: 'Matching engine crashed mid-run.',
        queuedAt: '2026-08-21T00:00:00.000Z',
        finishedAt: '2026-08-21T00:04:00.000Z',
      },
    });
    setAuthenticatedUser('rray');
    renderApp();

    await waitFor(() => {
      expect(runStepChip().getByText('Failed')).toBeInTheDocument();
    });
  });

  it('renders later steps as Not run after a failure', async () => {
    mockedApiState.latestImportRunResponse = createImportRunSummary({
      status: 'VALIDATION_FAILED',
    });
    setAuthenticatedUser('rray');
    renderApp();

    await waitFor(() => {
      expect(reviewExportStepChip().getByText('Not run')).toBeInTheDocument();
    });
  });

  it('marks the run step queued for a queued phase', async () => {
    mockedApiState.latestImportRunResponse = createImportRunSummary({
      validationJob: {
        id: 'validation-job-1',
        status: 'QUEUED',
        errorSummary: null,
        queuedAt: '2026-08-21T00:00:00.000Z',
        finishedAt: null,
      },
    });
    setAuthenticatedUser('rray');
    renderApp();

    await waitFor(() => {
      expect(runStepChip().getByText('Queued')).toBeInTheDocument();
    });
    // A queued run still expects to proceed -- unlike a failure, the step after it stays Pending,
    // never Not run (confirmed against the reference design's own per-scenario step arrays).
    expect(reviewExportStepChip().getByText('Pending')).toBeInTheDocument();
  });

  it('no step is current in a terminal phase', async () => {
    mockedApiState.latestImportRunResponse = createImportRunSummary({
      status: 'VALIDATION_FAILED',
    });
    setAuthenticatedUser('rray');
    renderApp();

    await waitFor(() => {
      expect(runStepChip().getByText('Failed')).toBeInTheDocument();
    });
    expect(screen.queryByText('In progress')).not.toBeInTheDocument();
  });

  // R2 V3: the four-segment meter and the deleted percentage.
  it('renders one segment per step', () => {
    setAuthenticatedUser('rray');
    const { container } = renderApp();

    expect(container.querySelectorAll('.run-bar__segment')).toHaveLength(4);
  });

  it('renders no percentage in the collapsed run bar', () => {
    setAuthenticatedUser('rray');
    const { container } = renderApp();

    expect(container.querySelector('.run-bar__meter-percent')).toBeNull();
    expect(screen.queryByLabelText('Run progress')).toBeNull();
  });

  it('renders no percentage in the expanded panel', () => {
    setAuthenticatedUser('rray');
    renderApp();

    // The card this lived in ("Overall Process Meter") is deleted outright, not just its number
    // -- fixing only the collapsed summary would have left this one click away.
    expect(screen.queryByText('Overall Process Meter')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Overall process progress')).toBeNull();
  });

  it('marks the failing segment and leaves later segments empty', async () => {
    mockedApiState.latestImportRunResponse = createImportRunSummary({
      status: 'VALIDATION_FAILED',
    });
    setAuthenticatedUser('rray');
    const { container } = renderApp();

    await waitFor(() => {
      expect(runStepChip().getByText('Failed')).toBeInTheDocument();
    });

    const segments = container.querySelectorAll('.run-bar__segment');
    expect(segments[2]).toHaveClass('run-bar__segment--failed');
    expect(segments[3]).toHaveClass('run-bar__segment--empty');
  });

  it('keeps the detail panel open on a failed run', async () => {
    mockedApiState.latestImportRunResponse = createImportRunSummary({
      status: 'VALIDATION_FAILED',
    });
    setAuthenticatedUser('rray');
    const { container } = renderApp();

    await waitFor(() => {
      expect(runStepChip().getByText('Failed')).toBeInTheDocument();
    });

    const detailPanel = container.querySelector('details.run-bar__progress');
    expect(detailPanel).toHaveAttribute('open');
  });

  it('states the step counter for each phase', async () => {
    setAuthenticatedUser('rray');
    renderApp();

    // Nothing staged yet -- 0 complete steps.
    expect(screen.getByText('step 0 of 4')).toBeInTheDocument();

    await fillUploadInputs();

    // Upload + configure complete, run step reads Ready (not yet current) -- step 2 of 4.
    expect(screen.getByText('step 2 of 4')).toBeInTheDocument();
  });

  it('states "stopped at" for a terminal failure', async () => {
    mockedApiState.latestImportRunResponse = createImportRunSummary({
      status: 'VALIDATION_FAILED',
    });
    setAuthenticatedUser('rray');
    renderApp();

    await waitFor(() => {
      expect(screen.getByText('stopped at step 3 of 4')).toBeInTheDocument();
    });
  });

  // R2 V4: Submit run gating. The double-submit guard is the whole point of this package -- write
  // it first, per the plan's own test list.
  it('disables Submit run while the run is queued', async () => {
    mockedApiState.latestImportRunResponse = createImportRunSummary({
      validationJob: {
        id: 'validation-job-1',
        status: 'QUEUED',
        errorSummary: null,
        queuedAt: '2026-08-21T00:00:00.000Z',
        finishedAt: null,
      },
    });
    setAuthenticatedUser('rray');
    renderApp();
    await fillUploadInputs();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Run in progress' })).toHaveAttribute(
        'aria-disabled',
        'true',
      );
    });
  });

  it('disables Submit run while the run is validating or matching', async () => {
    mockedApiState.latestImportRunResponse = createImportRunSummary({ status: 'VALIDATING' });
    setAuthenticatedUser('rray');
    renderApp();
    await fillUploadInputs();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Run in progress' })).toHaveAttribute(
        'aria-disabled',
        'true',
      );
    });
  });

  it('re-enables as Retry run after a validation failure', async () => {
    mockedApiState.latestImportRunResponse = createImportRunSummary({
      status: 'VALIDATION_FAILED',
    });
    setAuthenticatedUser('rray');
    renderApp();
    await fillUploadInputs();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Retry run' })).toHaveAttribute(
        'aria-disabled',
        'false',
      );
    });
  });

  // The caption is what this covers. It used to also assert the button re-enabled, but success
  // clears the upload slots, so an enabled button there could not actually submit anything -- see
  // 'clears the upload slots after success and disables the button until files are re-added'.
  it('relabels to Start new run after success', async () => {
    mockImportRunSubmitFlow();
    setAuthenticatedUser('rray');
    renderApp();
    await fillUploadInputs();

    fireEvent.click(screen.getByRole('button', { name: 'Submit run' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Start new run' })).toBeInTheDocument();
    });
  });

  // N4: navigating back to Import Files after a successful run (browser back, not a fresh
  // landing -- applyInitialLanding only fires once per mount) must not show the just-submitted
  // filenames sitting in the upload slots as if they hadn't been submitted yet. The caption
  // staying "Start new run" (not regressing to "Submit run") is the other half of this.
  //
  // The button is DISABLED here, and that is the fix, not a regression. It previously stayed
  // enabled: resolveSubmitButtonState skipped the upload check in the succeeded phase purely to
  // hold the caption steady, which left a live button with no files behind it -- and App's submit
  // handler silently returns in exactly that state, so clicking did nothing and reported nothing.
  // The caption is now derived from the phase independently of enablement, so it stays correct
  // while the guard stays on.
  it('clears the upload slots after success and disables the button until files are re-added', async () => {
    mockImportRunSubmitFlow();
    setAuthenticatedUser('rray');
    renderApp();
    await fillUploadInputs({ bankFiles: [new File(['bank-a'], '1111_bank.xlsx')] });

    fireEvent.click(screen.getByRole('button', { name: 'Submit run' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Start new run' })).toHaveAttribute(
        'aria-disabled',
        'true',
      );
    });
    expect(screen.queryByText('1111_bank.xlsx')).not.toBeInTheDocument();
    expect(screen.queryByText('gl.xlsx')).not.toBeInTheDocument();
  });

  // N4: "/" resolves to the active run on a genuine initial landing. Queued/running already show
  // their own in-progress panel on Import Files itself (the RunBar outcome panel) -- there's
  // nowhere better to redirect to -- so "renders the active run" means staying at '/' with that
  // panel visible, not navigating away.
  it('/ renders the active run when the durable phase is queued or running', async () => {
    mockedApiState.latestImportRunResponse = createImportRunSummary({
      validationJob: {
        id: 'validation-job-1',
        status: 'QUEUED',
        errorSummary: null,
        queuedAt: '2026-08-21T00:00:00.000Z',
        finishedAt: null,
      },
    });
    setAuthenticatedUser('rray');
    renderApp();

    await waitFor(() => {
      expect(screen.getAllByText('Queued').length).toBeGreaterThan(0);
    });
    expect(globalThis.location.pathname).toBe('/');

    cleanup();
    mockedApiState.latestImportRunResponse = createImportRunSummary({ status: 'VALIDATING' });
    setAuthenticatedUser('rray');
    renderApp();

    await waitFor(() => {
      expect(screen.getAllByText('Running').length).toBeGreaterThan(0);
    });
    expect(globalThis.location.pathname).toBe('/');
  });

  it('/ renders Import Files when the phase is idle', async () => {
    setAuthenticatedUser('rray');
    renderApp();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Submit run' })).toBeInTheDocument();
    });
    expect(globalThis.location.pathname).toBe('/');
  });

  it('names the reason for every disabled state', async () => {
    setAuthenticatedUser('rray');
    renderApp();

    // A required slot is empty (nothing staged yet).
    expect(screen.getByText('Add every bank workbook and the GL workbook.')).toBeInTheDocument();

    await fillUploadInputs();
    fireEvent.change(screen.getByLabelText(/Reconciliation label/i), {
      target: { value: '   ' },
    });

    // Run label empty.
    expect(screen.getByText('Give the run a label — it names every export.')).toBeInTheDocument();

    cleanup();
    mockedApiState.latestImportRunResponse = createImportRunSummary({
      validationJob: {
        id: 'validation-job-1',
        status: 'QUEUED',
        errorSummary: null,
        queuedAt: '2026-08-21T00:00:00.000Z',
        finishedAt: null,
      },
    });
    setAuthenticatedUser('rray');
    renderApp();
    await fillUploadInputs();

    // Run already underway.
    await waitFor(() => {
      expect(
        screen.getByText(
          'This run is already underway — submitting again would start a second attempt on the same files.',
        ),
      ).toBeInTheDocument();
    });
  });

  it('submitting twice in a row fires one request', async () => {
    mockImportRunSubmitFlow();
    setAuthenticatedUser('rray');
    renderApp();
    await fillUploadInputs();

    // The same element reference, clicked twice back to back -- whatever label it happens to
    // show at the moment of the second click (the async create-run XHR may not have resolved
    // enough for React to have re-rendered "Run in progress" yet), `handleSubmit`'s own guard is
    // what has to stop the second attempt, not this test picking a button by a label that's
    // already changed.
    const submitButton = screen.getByRole('button', { name: 'Submit run' });
    fireEvent.click(submitButton);
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Start new run' })).toBeInTheDocument();
    });
    expect(FakeImportRunXhr.instances).toHaveLength(1);
  });

  // R2 V5: the outcome panel. Naming the failing file/gate and rendering later gates as Not run
  // are already covered by the existing Screen 05/06/07 tests below (ImportValidationFailureView
  // itself is unchanged by V5 -- it already satisfied V5.2's requirements).
  it('renders the queued panel as a status, not an alert', async () => {
    mockedApiState.latestImportRunResponse = createImportRunSummary({
      label: 'Queued Panel Run',
      validationJob: {
        id: 'validation-job-1',
        status: 'QUEUED',
        errorSummary: null,
        queuedAt: '2026-08-21T00:00:00.000Z',
        finishedAt: null,
      },
    });
    setAuthenticatedUser('rray');
    renderApp();

    await waitFor(() => {
      expect(screen.getByText('Queued for validation')).toBeInTheDocument();
    });
    expect(screen.getAllByText(/Queued Panel Run/).length).toBeGreaterThan(0);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'Open Imported files' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh status' })).toBeInTheDocument();
  });

  it('renders a matching failure with its job reference', async () => {
    mockedApiState.latestImportRunResponse = createImportRunSummary({
      label: 'Matching Failure Run',
      status: 'PENDING_APPROVAL',
      matchingJob: {
        id: 'matching-job-77',
        currentState: 'FAILED',
        failureCode: 'MATCH_ENGINE_ERROR',
        failureMessage: 'Matching engine crashed while grouping split payments.',
        completedAt: '2026-08-21T00:05:00.000Z',
      },
    });
    setAuthenticatedUser('rray');
    renderApp();

    await waitFor(() => {
      expect(
        screen.getByText('Reconciliation failed for “Matching Failure Run”'),
      ).toBeInTheDocument();
    });
    expect(screen.getByText(/File validation passed/)).toBeInTheDocument();
    expect(screen.getByText('Job reference: matching-job-77')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy job reference' })).toBeInTheDocument();
  });

  it('renders no outcome panel before a run is submitted', () => {
    setAuthenticatedUser('rray');
    renderApp();

    expect(screen.queryByText('Queued for validation')).not.toBeInTheDocument();
    expect(screen.queryByText(/Reconciliation failed for/)).not.toBeInTheDocument();
    expect(
      screen.queryByText('Validating files, then matching.', { exact: false }),
    ).not.toBeInTheDocument();
  });

  it('surfaces a plain message when the failed run reports no invalid files (defensive fallback)', async () => {
    installFakeImportRunXhr();
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = requestUrl(input);
      if (url === `/api/imports/runs/${IMPORT_RUN_ID}/submit`) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              importJobId: 'import-job-1',
              status: 'completed',
              passed: false,
              run: createImportRunSummary({ status: 'VALIDATION_FAILED' }),
            }),
            { status: 200 },
          ),
        );
      }
      throw new Error(`unexpected fetch call to ${url}`);
    });

    setAuthenticatedUser('rray');
    renderApp();

    await fillUploadInputs();

    fireEvent.click(screen.getByRole('button', { name: 'Submit run' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/failed validation/i);
    });
  });

  it('shows Screen 05 (structure failure) with header comparison and gate sequence for a structural gate failure', async () => {
    installFakeImportRunXhr();
    const failedFile = createImportRunFile({
      importFileId: 'file-gl-failed',
      role: 'GL',
      sourceType: 'GL',
      originalFilename: 'gl_export_2026-08.csv',
      validationStatus: 'INVALID',
      rowCount: 0,
      errorCount: 1,
    });
    const validFile = createImportRunFile({
      importFileId: 'file-bank-valid',
      role: 'BANK_MERGED',
      sourceType: 'BANK',
      originalFilename: 'bank.xlsx',
      fileFormat: 'XLSX',
      validationStatus: 'VALID',
    });

    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = requestUrl(input);
      if (url === `/api/imports/runs/${IMPORT_RUN_ID}/submit`) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              importJobId: 'import-job-1',
              status: 'completed',
              passed: false,
              run: createImportRunSummary({
                status: 'VALIDATION_FAILED',
                files: [validFile, failedFile],
              }),
            }),
            { status: 200 },
          ),
        );
      }
      if (
        url === `/api/imports/runs/${IMPORT_RUN_ID}/files/${failedFile.importFileId}/failure-detail`
      ) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              importFileId: failedFile.importFileId,
              originalFilename: failedFile.originalFilename,
              sourceType: 'GL',
              fileFormat: 'CSV',
              validationStatus: 'INVALID',
              rowCount: 0,
              errorCount: 1,
              warningCount: 0,
              importableRowCount: 0,
              gateSequence: [
                { gate: 'HEADER', state: 'PASSED' },
                { gate: 'COLUMN_ORDER', state: 'FAILED' },
                { gate: 'CELL_VALUES', state: 'NOT_RUN' },
              ],
              headerComparison: [
                {
                  position: 1,
                  expected: 'transaction_date',
                  found: 'transaction_date',
                  matches: true,
                },
                { position: 2, expected: 'currency_code', found: null, matches: false },
              ],
              issues: [
                {
                  severity: 'ERROR',
                  code: 'STRUCT_COLUMN_MISSING',
                  message: 'Required column "currency_code" is absent.',
                  field: 'currency_code',
                  rowNumber: null,
                },
              ],
              issuesByCode: [{ code: 'STRUCT_COLUMN_MISSING', severity: 'ERROR', count: 1 }],
              amountTolerance: 0.005,
            }),
            { status: 200 },
          ),
        );
      }
      throw new Error(`unexpected fetch call to ${url}`);
    });

    setAuthenticatedUser('rray');
    renderApp();

    await fillUploadInputs();

    fireEvent.click(screen.getByRole('button', { name: 'Submit run' }));

    await waitFor(() => {
      expect(screen.getByText('gl_export_2026-08.csv — Step 2 of 3')).toBeInTheDocument();
    });
    expect(screen.getByText(/STRUCT_COLUMN_MISSING · ERROR/)).toBeInTheDocument();
    expect(screen.getByText('Required column "currency_code" is absent.')).toBeInTheDocument();
    expect(screen.getByText('— absent —')).toBeInTheDocument();
    expect(screen.getByText('Step 2 · Column order').closest('div')).toHaveTextContent('FAILED');
    expect(screen.getByText('Step 3 · Cell values').closest('div')).toHaveTextContent('NOT RUN');

    fireEvent.click(screen.getByRole('button', { name: 'Fix & re-upload' }));

    await waitFor(() => {
      expect(screen.queryByText('gl_export_2026-08.csv — Step 2 of 3')).not.toBeInTheDocument();
    });
    // Reset back to the #153 default of two empty bank slots + one empty GL slot.
    expect(screen.getAllByText('No file selected')).toHaveLength(3);
  });

  it('shows Screen 07 (all rows invalid) when every row fails Step 3 with zero rows importable', async () => {
    installFakeImportRunXhr();
    const failedFile = createImportRunFile({
      importFileId: 'file-gl-failed',
      role: 'GL',
      sourceType: 'GL',
      originalFilename: 'gl_export_2026-08.csv',
      validationStatus: 'INVALID',
      rowCount: 486,
      errorCount: 486,
    });

    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = requestUrl(input);
      if (url === `/api/imports/runs/${IMPORT_RUN_ID}/submit`) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              importJobId: 'import-job-1',
              status: 'completed',
              passed: false,
              run: createImportRunSummary({
                status: 'VALIDATION_FAILED',
                files: [failedFile],
              }),
            }),
            { status: 200 },
          ),
        );
      }
      if (
        url === `/api/imports/runs/${IMPORT_RUN_ID}/files/${failedFile.importFileId}/failure-detail`
      ) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              importFileId: failedFile.importFileId,
              originalFilename: failedFile.originalFilename,
              sourceType: 'GL',
              fileFormat: 'CSV',
              validationStatus: 'INVALID',
              rowCount: 486,
              errorCount: 486,
              warningCount: 0,
              importableRowCount: 0,
              gateSequence: [
                { gate: 'HEADER', state: 'PASSED' },
                { gate: 'COLUMN_ORDER', state: 'PASSED' },
                { gate: 'CELL_VALUES', state: 'PASSED' },
              ],
              headerComparison: null,
              issues: [],
              issuesByCode: [{ code: 'GL_UNBALANCED', severity: 'ERROR', count: 486 }],
              amountTolerance: 0.005,
            }),
            { status: 200 },
          ),
        );
      }
      if (url === `/api/imports/runs/${IMPORT_RUN_ID}/error-report.csv`) {
        return Promise.resolve(
          new Response('file,line,column,code,severity,message,raw_value\n', {
            status: 200,
            headers: { 'Content-Type': 'text/csv' },
          }),
        );
      }
      throw new Error(`unexpected fetch call to ${url}`);
    });

    setAuthenticatedUser('rray');
    renderApp();

    await fillUploadInputs();

    fireEvent.click(screen.getByRole('button', { name: 'Submit run' }));

    await waitFor(() => {
      expect(screen.getByText('0 of 486 GL lines passed validation')).toBeInTheDocument();
    });
    expect(screen.getByText(/Every entry failed GL_UNBALANCED/)).toBeInTheDocument();
    expect(screen.getByText('GL_UNBALANCED · 486')).toBeInTheDocument();
    expect(screen.getByText('tolerance 0.005')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Download error report' }));

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        `/api/imports/runs/${IMPORT_RUN_ID}/error-report.csv`,
      );
    });
  });

  it('shows Screen 06 (row grid) for a partial failure and completes "Import N rows & submit"', async () => {
    installFakeImportRunXhr();
    const failedFile = createImportRunFile({
      importFileId: 'file-bank-partial',
      role: 'BANK_MERGED',
      sourceType: 'BANK',
      originalFilename: 'bank_july.csv',
      validationStatus: 'INVALID',
      rowCount: 2,
      errorCount: 1,
    });
    const validFile = createImportRunFile({
      importFileId: 'file-gl-valid',
      role: 'GL',
      sourceType: 'GL',
      originalFilename: 'gl.csv',
      validationStatus: 'VALID',
    });

    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = requestUrl(input);
      if (url === `/api/imports/runs/${IMPORT_RUN_ID}/submit`) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              importJobId: 'import-job-1',
              status: 'completed',
              passed: false,
              run: createImportRunSummary({
                status: 'VALIDATION_FAILED',
                files: [validFile, failedFile],
              }),
            }),
            { status: 200 },
          ),
        );
      }
      if (
        url === `/api/imports/runs/${IMPORT_RUN_ID}/files/${failedFile.importFileId}/failure-detail`
      ) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              importFileId: failedFile.importFileId,
              originalFilename: failedFile.originalFilename,
              sourceType: 'BANK',
              fileFormat: 'CSV',
              validationStatus: 'INVALID',
              rowCount: 2,
              errorCount: 1,
              warningCount: 0,
              importableRowCount: 1,
              gateSequence: [
                { gate: 'HEADER', state: 'PASSED' },
                { gate: 'COLUMN_ORDER', state: 'PASSED' },
                { gate: 'CELL_VALUES', state: 'PASSED' },
              ],
              headerComparison: null,
              issues: [
                {
                  severity: 'ERROR',
                  code: 'BANK_AMOUNT_FORMAT',
                  message: '"amount" is not a valid number.',
                  field: 'amount',
                  rowNumber: 2,
                },
              ],
              issuesByCode: [{ code: 'BANK_AMOUNT_FORMAT', severity: 'ERROR', count: 1 }],
              amountTolerance: 0.005,
            }),
            { status: 200 },
          ),
        );
      }
      if (url === `/api/imports/runs/${IMPORT_RUN_ID}/files/${failedFile.importFileId}/rows`) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              headers: ['transaction_id', 'amount'],
              rows: [
                {
                  lineNumber: 1,
                  values: { transaction_id: 'TXN-1', amount: '100.00' },
                  status: 'IMPORT',
                  flaggedFields: {},
                  rowLevelIssues: [],
                },
                {
                  lineNumber: 2,
                  values: { transaction_id: 'TXN-2', amount: 'not-a-number' },
                  status: 'SKIP',
                  flaggedFields: {
                    amount: {
                      code: 'BANK_AMOUNT_FORMAT',
                      severity: 'ERROR',
                      message: '"amount" is not a valid number.',
                    },
                  },
                  rowLevelIssues: [],
                },
              ],
              totalRows: 2,
              errorRowCount: 1,
              warningRowCount: 0,
              cleanRowCount: 1,
              truncated: false,
            }),
            { status: 200 },
          ),
        );
      }
      if (url === `/api/imports/runs/${IMPORT_RUN_ID}/import`) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              status: 'completed',
              passed: true,
              matchingJobId: MATCHING_JOB_ID,
              run: createImportRunSummary({
                status: 'PENDING_APPROVAL',
                files: [validFile, failedFile],
              }),
            }),
            { status: 200 },
          ),
        );
      }
      if (url === `/api/reconciliation/${MATCHING_JOB_ID}`) {
        return Promise.resolve(new Response(JSON.stringify(createRunResponse()), { status: 200 }));
      }
      throw new Error(`unexpected fetch call to ${url}`);
    });

    setAuthenticatedUser('rray');
    renderApp();

    await fillUploadInputs();

    fireEvent.click(screen.getByRole('button', { name: 'Submit run' }));

    await waitFor(() => {
      expect(screen.getByText('Cell validation results')).toBeInTheDocument();
    });
    expect(screen.getByText('TXN-1')).toBeInTheDocument();
    expect(screen.getByText('TXN-2')).toBeInTheDocument();
    expect(screen.getByText('All rows · 2')).toBeInTheDocument();
    expect(screen.getByText('Errors only · 1')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Errors only · 1' }));
    expect(screen.queryByText('TXN-1')).not.toBeInTheDocument();
    expect(screen.getByText('TXN-2')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'All rows · 2' }));

    fireEvent.click(screen.getByRole('button', { name: 'Import 1 rows & submit' }));

    await waitFor(() => {
      expect(screen.getByText(/Run finished/)).toBeInTheDocument();
    });
  });

  it('rejects an unsupported file extension at selection with the exact Screen 02 code and copy, removable without ever uploading it', () => {
    setAuthenticatedUser('rray');
    renderApp();

    fireEvent.change(screen.getByLabelText('Source workbooks'), {
      target: { files: [new File(['%PDF-1.4'], 'june_statement.pdf')] },
    });

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('UPLOAD_EXTENSION_UNSUPPORTED');
    expect(alert).toHaveTextContent(
      'Rejected at upload. Only .csv and .xlsx are accepted — format is detected by extension.',
    );
    expect(screen.getByText('june_statement.pdf')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    expect(screen.queryByText('june_statement.pdf')).not.toBeInTheDocument();
  });

  it('rejects a file over the 50 MB limit at selection with the exact Screen 02 code and copy', () => {
    setAuthenticatedUser('rray');
    renderApp();

    const oversizedFile = new File(['gl'], 'gl_full_year_2025.xlsx');
    Object.defineProperty(oversizedFile, 'size', { value: 78.4 * 1024 * 1024 });

    fireEvent.change(screen.getByLabelText('Source workbooks'), {
      target: { files: [oversizedFile] },
    });

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('UPLOAD_SIZE_EXCEEDED · limit 50 MB');
    expect(alert).toHaveTextContent(
      'Split the export by period, or switch the run frequency to Annual and import per quarter.',
    );
  });

  it('accepts a bank file whose name has no leading account-number prefix (A-D1)', () => {
    // The inverse of the old contract. A-D1 (Issue #338) made the account an explicit per-slot
    // choice, so a filename can no longer reject an upload -- the statement is staged, and it is
    // the missing assignment (not the name) that holds submission back.
    setAuthenticatedUser('rray');
    renderApp();

    fireEvent.change(screen.getByLabelText('Bank workbook (Account 1)'), {
      target: { files: [new File(['bank'], 'checking-account.csv')] },
    });

    expect(screen.queryByText('UPLOAD_BANK_FILENAME_INVALID')).not.toBeInTheDocument();
    // Staged into slot 1, so only the other two slots (1 bank + GL) are still empty.
    expect(screen.getAllByText('No file selected')).toHaveLength(2);
  });

  it('#153: starts with two bank slots, and "Add another bank statement" adds slots up to 4', () => {
    setAuthenticatedUser('rray');
    renderApp();

    expect(screen.getByLabelText('Bank workbook (Account 1)')).toBeInTheDocument();
    expect(screen.getByLabelText('Bank workbook (Account 2)')).toBeInTheDocument();
    expect(screen.queryByLabelText('Bank workbook (Account 3)')).not.toBeInTheDocument();

    const addButton = () => screen.getByRole('button', { name: 'Add another bank statement' });

    fireEvent.click(addButton());
    expect(screen.getByLabelText('Bank workbook (Account 3)')).toBeInTheDocument();

    fireEvent.click(addButton());
    expect(screen.getByLabelText('Bank workbook (Account 4)')).toBeInTheDocument();

    // Capped at 4 -- the Add control disappears once the 4th slot exists.
    expect(
      screen.queryByRole('button', { name: 'Add another bank statement' }),
    ).not.toBeInTheDocument();
  });

  it('#153: a per-slot Remove control appears down to the minimum 1 slot, and removes a slot', () => {
    setAuthenticatedUser('rray');
    renderApp();

    // Remove is available on the default 2-slot layout...
    expect(
      screen.getByRole('button', { name: 'Remove Bank workbook (Account 2)' }),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Bank workbook (Account 2)'), {
      target: { files: [new File(['bank-2'], '2222_bank.csv')] },
    });
    expect(screen.getAllByText('2222_bank.csv').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Remove Bank workbook (Account 2)' }));

    expect(screen.queryByLabelText('Bank workbook (Account 2)')).not.toBeInTheDocument();
    expect(screen.queryByText('2222_bank.csv')).not.toBeInTheDocument();
    // ...but disappears once only the minimum 1 slot remains.
    expect(
      screen.queryByRole('button', { name: 'Remove Bank workbook (Account 1)' }),
    ).not.toBeInTheDocument();
  });

  it('#153: submits with just 1 bank file (the minimum)', async () => {
    installFakeImportRunXhr();
    setAuthenticatedUser('rray');
    renderApp();

    await fillUploadInputs({ bankFiles: [new File(['bank-a'], '1111_bank.xlsx')] });

    // R2 V4.3: `aria-disabled`, not the native `disabled` attribute, so a screen reader can still
    // reach the reason via `aria-describedby` on a disabled button -- `toBeDisabled()` checks the
    // native attribute, which this button no longer has at all.
    expect(screen.getByRole('button', { name: 'Submit run' })).toHaveAttribute(
      'aria-disabled',
      'false',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Submit run' }));

    await waitFor(() => {
      expect(FakeImportRunXhr.instances).toHaveLength(1);
    });
    const formData = FakeImportRunXhr.instances[0]!.body as FormData;
    expect(formData.getAll('bankFiles')).toHaveLength(1);
  });

  it('#153: submits with all 4 bank files (the maximum)', async () => {
    installFakeImportRunXhr();
    setAuthenticatedUser('rray');
    renderApp();

    await fillUploadInputs({
      bankFiles: [
        new File(['bank-1'], '1111_bank.xlsx'),
        new File(['bank-2'], '2222_bank.xlsx'),
        new File(['bank-3'], '3333_bank.xlsx'),
        new File(['bank-4'], '4444_bank.xlsx'),
      ],
    });

    // R2 V4.3: `aria-disabled`, not the native `disabled` attribute, so a screen reader can still
    // reach the reason via `aria-describedby` on a disabled button -- `toBeDisabled()` checks the
    // native attribute, which this button no longer has at all.
    expect(screen.getByRole('button', { name: 'Submit run' })).toHaveAttribute(
      'aria-disabled',
      'false',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Submit run' }));

    await waitFor(() => {
      expect(FakeImportRunXhr.instances).toHaveLength(1);
    });
    const formData = FakeImportRunXhr.instances[0]!.body as FormData;
    expect(formData.getAll('bankFiles')).toHaveLength(4);
  });

  it('#153: rejects a 5th bank-shaped file dropped once all 4 slots are filled', async () => {
    setAuthenticatedUser('rray');
    renderApp();

    await fillUploadInputs({
      bankFiles: [
        new File(['bank-1'], '1111_bank.xlsx'),
        new File(['bank-2'], '2222_bank.xlsx'),
        new File(['bank-3'], '3333_bank.xlsx'),
        new File(['bank-4'], '4444_bank.xlsx'),
      ],
    });

    fireEvent.change(screen.getByLabelText('Source workbooks'), {
      target: { files: [new File(['bank-5'], '5555_bank.xlsx')] },
    });

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('UPLOAD_BANK_ACCOUNT_LIMIT_REACHED');
    expect(screen.queryByLabelText('Bank workbook (Account 5)')).not.toBeInTheDocument();
  });

  it('shows real per-file upload progress and lets Cancel abort the transfer without an error banner', async () => {
    installFakeImportRunXhr({ autoRespond: false });

    setAuthenticatedUser('rray');
    renderApp();

    const bankFileA = new File(['bank-a'], '1111_bank-a.xlsx');
    Object.defineProperty(bankFileA, 'size', { value: 2_000_000 });
    const bankFileB = new File(['bank-b'], '2222_bank-b.xlsx');
    Object.defineProperty(bankFileB, 'size', { value: 2_000_000 });
    const glFile = new File(['gl'], 'gl.csv');
    Object.defineProperty(glFile, 'size', { value: 6_000_000 });

    await fillUploadInputs({ bankFiles: [bankFileA, bankFileB], glFile });

    fireEvent.click(screen.getByRole('button', { name: 'Submit run' }));

    await waitFor(() => {
      expect(FakeImportRunXhr.instances).toHaveLength(1);
    });

    const request = FakeImportRunXhr.instances[0]!;
    // bankFileA (2,000,000 B) then bankFileB (2,000,000 B) are appended before glFile
    // (6,000,000 B) -- 7,000,000 loaded bytes is both bank files fully sent (Stored) plus
    // 3,000,000 of GL's 6,000,000 (exactly half).
    fireEvent(
      request.upload as unknown as HTMLElement,
      Object.assign(new Event('progress'), {
        lengthComputable: true,
        loaded: 7_000_000,
        total: 10_000_200,
      }),
    );

    await waitFor(() => {
      expect(screen.getAllByText('Stored')).toHaveLength(2);
      expect(screen.getByText(/50% ·/)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => {
      expect(screen.getByLabelText('Source workbooks')).toBeInTheDocument();
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    // The files stay selected -- cancelling only aborts the in-flight transfer.
    expect(screen.getByText('1111_bank-a.xlsx')).toBeInTheDocument();
    expect(screen.getByText('2222_bank-b.xlsx')).toBeInTheDocument();
    expect(screen.getByText('gl.csv')).toBeInTheDocument();
  });

  it('surfaces a network-interruption card and resends all files from the start on Retry, not a chunk resume', async () => {
    installFakeImportRunXhr({ autoRespond: false });

    setAuthenticatedUser('rray');
    renderApp();

    await fillUploadInputs();

    fireEvent.click(screen.getByRole('button', { name: 'Submit run' }));

    await waitFor(() => {
      expect(FakeImportRunXhr.instances).toHaveLength(1);
    });

    FakeImportRunXhr.instances[0]!.networkError();

    // All three files were part of the one combined request, so all three cards surface the
    // failure.
    await waitFor(() => {
      expect(screen.getAllByText('UPLOAD_NETWORK_INTERRUPTED')).toHaveLength(3);
    });
    expect(
      screen.getAllByText(
        'The transfer was interrupted. Nothing was written to the run -- retry resends all files from the start.',
      ),
    ).toHaveLength(3);

    fireEvent.click(screen.getAllByRole('button', { name: 'Retry upload' })[0]!);

    await waitFor(() => {
      expect(FakeImportRunXhr.instances).toHaveLength(2);
    });
  });

  it('lands financial analysts on the Review tab', async () => {
    setAuthenticatedUser('bray');
    renderApp();

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Summary' })).toHaveAttribute(
        'aria-current',
        'page',
      );
    });
  });

  it('lets financial analysts still reach Import Files by clicking it, despite their default landing tab', async () => {
    const user = userEvent.setup();
    setAuthenticatedUser('bray');
    renderApp();

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Summary' })).toHaveAttribute(
        'aria-current',
        'page',
      );
    });

    await user.click(screen.getByRole('link', { name: 'New run' }));

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'New run' })).toHaveAttribute(
        'aria-current',
        'page',
      );
    });
    expect(screen.getByText('Import source files')).toBeInTheDocument();
  });

  it('leads the Summary panel with the reconciliation verdict', async () => {
    mockImportRunSubmitFlow();

    setAuthenticatedUser('rray');
    renderApp();

    await fillUploadInputs();

    fireEvent.click(screen.getByRole('button', { name: 'Submit run' }));

    await waitFor(() => {
      expect(screen.getByText('Unexplained residual')).toBeInTheDocument();
    });

    expect(screen.getByText('Bank unmatched (net)')).toBeInTheDocument();
    expect(screen.getByText('Prior-period comparison')).toBeInTheDocument();
  });

  it('disables submit when reconciliation label is blank', async () => {
    setAuthenticatedUser('rray');
    renderApp();

    await fillUploadInputs();
    fireEvent.change(screen.getByLabelText(/Reconciliation label/i), {
      target: { value: '   ' },
    });

    expect(screen.getByRole('button', { name: 'Submit run' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(
      screen.getByText('Reconciliation label is required before running.'),
    ).toBeInTheDocument();
  });

  it('enforces financial analyst scope for bray with app and docs access', () => {
    setAuthenticatedUser('bray');

    renderApp();

    expect(screen.getByRole('link', { name: 'New run' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'User Guide' })).toHaveAttribute('href', '/docs');
  });

  it('allows admin role to adjust variance thresholds in Rules', async () => {
    setAuthenticatedUser('rray3');

    renderApp();

    fireEvent.click(screen.getByRole('button', { name: 'Rules' }));

    // Editing is gated on the async-loaded version state (ADMIN·EDITABLE requires an ACTIVE
    // version with overridesAppliedToEngine true, not just the role) -- wait for GET
    // /api/rules/versions to resolve before the slider exists at all.
    const slider = await screen.findByRole('slider', { name: /Amount Tolerance/i });

    expect(slider).not.toBeDisabled();
    expect(screen.getByText(/Admin control mode is enabled\./i)).toBeInTheDocument();

    fireEvent.change(slider, { target: { value: '0.65' } });

    expect(screen.getAllByText('$0.65').length).toBeGreaterThan(0);
  });

  it('allows superuser to access all scopes and adjust slider defaults', async () => {
    setAuthenticatedUser('rray');

    renderApp();

    expect(screen.getByRole('link', { name: 'New run' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'User Guide' })).toHaveAttribute('href', '/docs');

    fireEvent.click(screen.getByRole('button', { name: 'Rules' }));

    const slider = await screen.findByRole('slider', { name: /Timing Difference Days/i });
    expect(slider).not.toBeDisabled();
  });

  it('renders the identity footer and signs out from it', () => {
    setAuthenticatedUser('rray');
    renderApp();

    const nav = screen.getByRole('navigation', { name: 'Primary' });
    expect(within(nav).getByText('rray')).toBeInTheDocument();
    expect(within(nav).getByText('SuperUser')).toBeInTheDocument();

    fireEvent.click(within(nav).getByRole('button', { name: 'Open account menu' }));
    fireEvent.click(within(nav).getByRole('button', { name: 'Log out' }));

    expect(screen.getByRole('heading', { name: 'Log in' })).toBeInTheDocument();
  });

  // N3: this rail menu duplicated the Import source files header's own template menu verbatim --
  // removed here; NavRail.test.tsx covers "renders no download links", and the surviving menu is
  // covered by "exposes Bank and GL template downloads from the Import source files header" above.

  it('opens and closes the footer account menu', () => {
    setAuthenticatedUser('rray');
    renderApp();

    const menuToggle = screen.getByRole('button', { name: 'Open account menu' });
    expect(menuToggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('link', { name: 'Profile' })).toBeNull();

    fireEvent.click(menuToggle);

    expect(screen.getByRole('button', { name: 'Close account menu' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByRole('link', { name: 'Profile' })).toBeInTheDocument();
  });

  it('routes placeholder destinations to the shared coming-soon page', async () => {
    setAuthenticatedUser('rray');
    renderApp();

    fireEvent.click(screen.getByRole('button', { name: 'Open account menu' }));
    fireEvent.click(screen.getByRole('link', { name: 'Profile' }));

    expect(screen.getByRole('heading', { name: 'Profile' })).toBeInTheDocument();
    expect(screen.getByText('Placeholder')).toBeInTheDocument();
    expect(screen.getByText('Profile settings are coming soon.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '← Back' }));

    await waitFor(() => {
      expect(globalThis.location.pathname).toBe('/');
    });
  });

  it('opens the Remove account confirmation dialog and requires typing the username to confirm', () => {
    setAuthenticatedUser('rray');
    renderApp();

    fireEvent.click(screen.getByRole('button', { name: 'Open account menu' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove account' }));

    const dialogHeading = screen.getByRole('heading', { name: 'Remove account' });
    const dialog = dialogHeading.closest('.remove-account-modal');
    if (!(dialog instanceof HTMLElement)) {
      throw new TypeError('Remove account dialog was not found.');
    }

    const confirmButton = within(dialog).getByRole('button', { name: 'Remove account' });
    expect(confirmButton).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText(/Type rray to confirm/i), {
      target: { value: 'rray' },
    });

    expect(confirmButton).not.toBeDisabled();
  });

  // N1: the five per-type Approvals submenus collapse into one "Pending approvals" destination.
  it('exposes Rules-based reconciliation and one consolidated Pending approvals destination', () => {
    setAuthenticatedUser('rray');
    renderApp();

    expect(screen.getByRole('link', { name: 'Probable matches' })).toHaveAttribute(
      'href',
      '/probable-matches',
    );
    expect(screen.queryByRole('link', { name: 'Pending Imports' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Approved Imports' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Rejected Imports' })).toBeNull();

    // The five old submenu labels no longer exist as separate rail links.
    expect(screen.queryByRole('link', { name: 'Matching Rule & Variances' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Exception Resolutions' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Report Distribution' })).toBeNull();

    // 'Pending' is also a run-step chip status, so query the rail entry by role rather than text.
    const link = screen.getByRole('link', { name: 'Pending' });
    expect(link).toHaveAttribute('href', '/approvals');

    fireEvent.click(link!);

    expect(screen.getByRole('heading', { name: 'Pending approvals' })).toBeInTheDocument();
  });

  // N1: "every old approval URL lands on the object it shadowed" -- kept for one release as
  // redirects, not dead links, even though the rail no longer points at any of them.
  it.each([
    ['/approvals/imports', '/'],
    ['/approvals/mapping-profiles', '/approvals'],
    ['/approvals/matching-rules', '/mapping/rules'],
    ['/approvals/exception-resolutions', '/exceptions'],
    ['/approvals/report-distribution', '/export'],
  ])('redirects legacy %s to %s', (legacyPath, targetPath) => {
    setAuthenticatedUser('rray');
    globalThis.history.pushState({}, '', legacyPath);
    renderApp();

    expect(window.location.pathname).toBe(targetPath);
  });

  // N2: Run Book renders ComingSoonPage, so its rail entry is removed for every role -- the route
  // itself stays declared (per N2's own scope), this only covers the rail's own inventory.
  it('never shows a Run Book link in the rail, for any role', () => {
    setAuthenticatedUser('rray3');
    renderApp();

    expect(screen.queryByRole('link', { name: 'Run Book' })).toBeNull();
  });
});

// The rail badge is App state refetched on route change; before onApprovalStateChange existed,
// approving on /approvals left it stale until the user navigated away.
describe('NavRail Pending approvals badge after a decision', () => {
  const zero = { pending: 0, approved: 0, rejected: 0, mySubmissions: 0 };
  const pendingRun: ApprovalRow = {
    id: 'run-approval-1',
    type: 'reconciliationRun',
    title: 'Operating account · Aug 2026',
    submitter: 'bray',
    approver: 'rray',
    ageHours: 3,
    state: 'PENDING',
  };

  it('refetches the counts when a reconciliation run is approved, without a route change', async () => {
    setAuthenticatedUser('rray');
    mockedApiState.approvalCounts = {
      ...mockedApiState.approvalCounts,
      import: { ...zero, pending: 1 },
    };
    mockedApiState.approvalRows = [pendingRun];
    globalThis.history.pushState({}, '', '/approvals');
    renderApp();

    const approve = await screen.findByRole('button', { name: 'Approve' });
    const railLink = screen.getByRole('link', { name: /Pending/ });
    await waitFor(() => expect(railLink.querySelector('.nav-rail__badge')).toHaveTextContent('1'));

    // The decision succeeds server-side; the next counts fetch reports nothing pending.
    mockedApiState.approvalCounts = { ...mockedApiState.approvalCounts, import: zero };
    mockedApiState.approvalRows = [];
    fireEvent.click(approve);

    await waitFor(() => expect(railLink.querySelector('.nav-rail__badge')).toBeNull());
    expect(globalThis.location.pathname).toBe('/approvals');
  });
});
