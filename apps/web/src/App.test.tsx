// @vitest-environment jsdom

import type { RuleCatalogResponse, RuleVersionsResponse, UserRole } from '@recon/domain';
import type * as ApiModule from './lib/api';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

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
    getMappingProfilesRequest: vi.fn(() =>
      Promise.resolve(mockedApiState.mappingProfileNames),
    ),
    // Mocked unconditionally for the same reason as getRulesCatalogRequest above: NavRail's
    // per-submenu Approvals badges fetch on every mount/route change, so an unmocked call here
    // would fall through to the real `fetch` and disrupt other tests' call-order-sensitive spies.
    getApprovalCountsRequest: vi.fn(() => {
      const emptyCounts = { pending: 0, approved: 0, rejected: 0, mySubmissions: 0 };
      return Promise.resolve({
        import: emptyCounts,
        mappingProfile: emptyCounts,
        matchingRule: emptyCounts,
        exceptionResolution: emptyCounts,
        reportDistribution: emptyCounts,
      });
    }),
    // ApprovalsPage fetches its table on mount; unmocked, that would fall through to the real
    // `fetch` and disrupt other tests' call-order-sensitive fetch spies.
    getApprovalsRequest: vi.fn(() => Promise.resolve([])),
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
    this.upload.dispatchEvent(Object.assign(new Event('progress'), { lengthComputable: true, loaded, total }));
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
const installFakeImportRunXhr = (
  { autoRespond = true, status = 201, body = null }: { autoRespond?: boolean; status?: number; body?: unknown } = {},
): typeof FakeImportRunXhr => {
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
const fillUploadInputs = ({
  bankFiles = [new File(['bank-a'], '1111_bank.xlsx'), new File(['bank-b'], '2222_bank.xlsx')],
  glFile = new File(['gl'], 'gl.xlsx'),
}: { bankFiles?: File[]; glFile?: File } = {}): void => {
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
      expect(screen.getByRole('link', { name: /Import Files/i })).toBeInTheDocument();
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
      expect(screen.getByRole('link', { name: /Import Files/i })).toBeInTheDocument();
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

    expect(screen.getByRole('link', { name: /Import Files/i })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('link', { name: 'File-based' })).not.toHaveAttribute(
      'aria-current',
    );
    expect(screen.getByRole('link', { name: /Exceptions/i })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: /Reports/i })).not.toHaveAttribute('aria-current');
    expect(screen.getByText('Import source files')).toBeInTheDocument();
  });

  it('navigates between rail destinations via real routes and updates the active link', async () => {
    const user = userEvent.setup();

    setAuthenticatedUser('rray');

    renderApp();

    await user.click(screen.getByRole('link', { name: 'File-based' }));

    expect(screen.getByRole('link', { name: 'File-based' })).toHaveAttribute(
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

    fillUploadInputs();

    fireEvent.click(screen.getByRole('button', { name: 'Submit run' }));

    await waitFor(() => {
      expect(screen.getByText('Total reviewed')).toBeInTheDocument();
    });

    expect(screen.getByRole('heading', { name: 'Review' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'File-based' })).toHaveAttribute(
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
    expect(screen.getAllByText(/GL gl.xlsx \/ 4 \| GL gl.xlsx \/ 5/i).length).toBeGreaterThan(0);

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

    fireEvent.click(screen.getByRole('link', { name: 'File-based' }));

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

    fireEvent.click(screen.getByRole('link', { name: 'File-based' }));

    await waitFor(() => {
      expect(screen.queryByText('No review output yet')).not.toBeNull();
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

    fireEvent.click(screen.getByRole('link', { name: 'File-based' }));

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

    fireEvent.click(screen.getByRole('link', { name: 'File-based' }));

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

    fireEvent.click(screen.getByRole('link', { name: 'File-based' }));

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

    fireEvent.click(screen.getByRole('link', { name: 'File-based' }));

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
          hasText(element) &&
          Array.from(element?.children ?? []).every((child) => !hasText(child))
        );
      }),
    ).toBeInTheDocument();
  });

  it('renders the rule grid with distinct TUNABLE treatment per rule, ASSIGNED TO chips, and a matching footer count', async () => {
    setAuthenticatedUser('rray');
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'Rules' }));
    await waitFor(() => screen.getByText('v7 · ACTIVE'));

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
    await waitFor(() => screen.getByText('v7 · ACTIVE'));

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
    await waitFor(() => screen.getByText('v7 · ACTIVE'));

    // The rule whose metric was actually overridden shows the publish date -- formatted via the
    // same helper the component uses, so this assertion doesn't hardcode a timezone-dependent
    // calendar day for a UTC-midnight timestamp.
    expect(
      screen.getByText(formatCompactDate('2026-08-04T00:00:00.000Z')),
    ).toBeInTheDocument();
    // ...while rules untouched by that override, and fixed rules, show an explicit "—".
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('search filters the rule grid by name and description, live and client-side', async () => {
    setAuthenticatedUser('rray');
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'Rules' }));
    await waitFor(() => screen.getByText('v7 · ACTIVE'));

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
    await waitFor(() => screen.getByText('v7 · ACTIVE'));

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

  it('reflects a family filter from the URL on load, and NavRail sub-item links carry real counts', async () => {
    setAuthenticatedUser('rray');
    globalThis.history.pushState({}, '', '/mapping/rules?family=matching');
    renderApp();
    await waitFor(() => screen.getByText('v7 · ACTIVE'));

    expect(screen.getByText('Reference + Amount Match')).toBeInTheDocument();
    expect(screen.getByText('Wire Correspondent Fee Deduction')).toBeInTheDocument();
    expect(screen.queryByText('Missing from Bank')).toBeNull();

    const nav = screen.getByRole('navigation', { name: 'Primary' });
    const matchingSubItem = within(nav)
      .getAllByRole('link')
      .find((link) => link.getAttribute('href') === '/mapping/rules?family=matching');
    expect(matchingSubItem).toBeDefined();
    expect(matchingSubItem?.textContent).toContain('Matching');
    expect(matchingSubItem?.textContent).toContain('2');
    expect(matchingSubItem?.className).toContain('nav-rail__item--active');
  });

  it('shows an explicit empty state naming the active filters, with a working clear-all', async () => {
    setAuthenticatedUser('rray');
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'Rules' }));
    await waitFor(() => screen.getByText('v7 · ACTIVE'));

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

    fireEvent.click(screen.getByRole('link', { name: 'File-based' }));

    expect(screen.getByRole('link', { name: 'File-based' })).toBeInTheDocument();
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

  it('shows overall process progress and updates it after file selection', () => {
    setAuthenticatedUser('rray');
    renderApp();

    const overallMeter = screen.getByLabelText('Overall process progress');
    expect(screen.getByText('Process Progress')).toBeInTheDocument();
    expect((overallMeter as HTMLProgressElement).value).toBe(0);

    fillUploadInputs();

    expect((overallMeter as HTMLProgressElement).value).toBe(50);
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

    fillUploadInputs();
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

    fillUploadInputs();

    fireEvent.click(screen.getByRole('button', { name: 'Submit run' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Upload failed.');
    });
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

    fillUploadInputs({ bankFiles: [bankFileA, bankFileB], glFile });
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

    fillUploadInputs();
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

    fillUploadInputs();
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

  it('assigns bank and GL files from the merged drop zone by file name', () => {
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

    expect(screen.getByRole('button', { name: 'Submit run' })).not.toBeDisabled();
    expect(screen.getAllByText('1111_bank.xlsx').length).toBeGreaterThan(0);
    expect(screen.getAllByText('2222_bank.xlsx').length).toBeGreaterThan(0);
    expect(screen.getAllByText('gl.xlsx').length).toBeGreaterThan(0);
  });

  it('accepts CSV workbooks alongside XLSX in the merged drop zone', () => {
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

    expect(screen.getByRole('button', { name: 'Submit run' })).not.toBeDisabled();
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

  it('surfaces a message instead of hanging when the import run is queued for async validation', async () => {
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

    fillUploadInputs();

    fireEvent.click(screen.getByRole('button', { name: 'Submit run' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/queued for validation/i);
    });
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

    fillUploadInputs();

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
        url ===
        `/api/imports/runs/${IMPORT_RUN_ID}/files/${failedFile.importFileId}/failure-detail`
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
                { position: 1, expected: 'transaction_date', found: 'transaction_date', matches: true },
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

    fillUploadInputs();

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
        url ===
        `/api/imports/runs/${IMPORT_RUN_ID}/files/${failedFile.importFileId}/failure-detail`
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

    fillUploadInputs();

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
        url ===
        `/api/imports/runs/${IMPORT_RUN_ID}/files/${failedFile.importFileId}/failure-detail`
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
      if (
        url === `/api/imports/runs/${IMPORT_RUN_ID}/files/${failedFile.importFileId}/rows`
      ) {
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
              run: createImportRunSummary({ status: 'PENDING_APPROVAL', files: [validFile, failedFile] }),
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

    fillUploadInputs();

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

  it('rejects a bank file whose name has no leading account-number prefix, at selection', () => {
    setAuthenticatedUser('rray');
    renderApp();

    fireEvent.change(screen.getByLabelText('Bank workbook (Account 1)'), {
      target: { files: [new File(['bank'], 'checking-account.csv')] },
    });

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('UPLOAD_BANK_FILENAME_INVALID');
    expect(alert).toHaveTextContent(
      'Bank file names must start with the account number (or its last 4 digits) followed by "-" or "_", e.g. "4321_bank-export.csv".',
    );
    // Rejected -- never assigned into the slot, so all remaining slots (2 bank + GL) stay empty.
    expect(screen.getAllByText('No file selected')).toHaveLength(3);
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
    expect(screen.queryByRole('button', { name: 'Add another bank statement' })).not.toBeInTheDocument();
  });

  it('#153: a per-slot Remove control appears down to the minimum 1 slot, and removes a slot', () => {
    setAuthenticatedUser('rray');
    renderApp();

    // Remove is available on the default 2-slot layout...
    expect(screen.getByRole('button', { name: 'Remove Bank workbook (Account 2)' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Bank workbook (Account 2)'), {
      target: { files: [new File(['bank-2'], '2222_bank.csv')] },
    });
    expect(screen.getAllByText('2222_bank.csv').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Remove Bank workbook (Account 2)' }));

    expect(screen.queryByLabelText('Bank workbook (Account 2)')).not.toBeInTheDocument();
    expect(screen.queryByText('2222_bank.csv')).not.toBeInTheDocument();
    // ...but disappears once only the minimum 1 slot remains.
    expect(screen.queryByRole('button', { name: 'Remove Bank workbook (Account 1)' })).not.toBeInTheDocument();
  });

  it('#153: submits with just 1 bank file (the minimum)', async () => {
    installFakeImportRunXhr();
    setAuthenticatedUser('rray');
    renderApp();

    fillUploadInputs({ bankFiles: [new File(['bank-a'], '1111_bank.xlsx')] });

    expect(screen.getByRole('button', { name: 'Submit run' })).not.toBeDisabled();
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

    fillUploadInputs({
      bankFiles: [
        new File(['bank-1'], '1111_bank.xlsx'),
        new File(['bank-2'], '2222_bank.xlsx'),
        new File(['bank-3'], '3333_bank.xlsx'),
        new File(['bank-4'], '4444_bank.xlsx'),
      ],
    });

    expect(screen.getByRole('button', { name: 'Submit run' })).not.toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Submit run' }));

    await waitFor(() => {
      expect(FakeImportRunXhr.instances).toHaveLength(1);
    });
    const formData = FakeImportRunXhr.instances[0]!.body as FormData;
    expect(formData.getAll('bankFiles')).toHaveLength(4);
  });

  it('#153: rejects a 5th bank-shaped file dropped once all 4 slots are filled', () => {
    setAuthenticatedUser('rray');
    renderApp();

    fillUploadInputs({
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

    fillUploadInputs({ bankFiles: [bankFileA, bankFileB], glFile });

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

    fillUploadInputs();

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
      expect(screen.getByRole('link', { name: 'File-based' })).toHaveAttribute(
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
      expect(screen.getByRole('link', { name: 'File-based' })).toHaveAttribute(
        'aria-current',
        'page',
      );
    });

    await user.click(screen.getByRole('link', { name: /Import Files/i }));

    await waitFor(() => {
      expect(screen.getByRole('link', { name: /Import Files/i })).toHaveAttribute(
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

    fillUploadInputs();

    fireEvent.click(screen.getByRole('button', { name: 'Submit run' }));

    await waitFor(() => {
      expect(screen.getByText('Unexplained residual')).toBeInTheDocument();
    });

    expect(screen.getByText('Bank unmatched (net)')).toBeInTheDocument();
    expect(screen.getByText('Prior-period comparison')).toBeInTheDocument();
  });

  it('disables submit when reconciliation label is blank', () => {
    setAuthenticatedUser('rray');
    renderApp();

    fillUploadInputs();
    fireEvent.change(screen.getByLabelText(/Reconciliation label/i), {
      target: { value: '   ' },
    });

    expect(screen.getByRole('button', { name: 'Submit run' })).toBeDisabled();
    expect(
      screen.getByText('Reconciliation label is required before running.'),
    ).toBeInTheDocument();
  });

  it('enforces financial analyst scope for bray with app and docs access', () => {
    setAuthenticatedUser('bray');

    renderApp();

    expect(screen.getByRole('link', { name: /Import Files/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'User Guide' })).toHaveAttribute('href', '/docs');
  });

  it('allows admin role to adjust variance thresholds in Rules', async () => {
    setAuthenticatedUser('rray3');

    renderApp();

    fireEvent.click(screen.getByRole('button', { name: 'Rules' }));

    // Editing is gated on the async-loaded version state (ADMIN·EDITABLE requires an ACTIVE
    // version with overridesAppliedToEngine true, not just the role) -- wait for GET
    // /api/rules/versions to resolve before the slider exists at all.
    const slider = await waitFor(() =>
      screen.getByRole('slider', { name: /Amount Tolerance/i }),
    );

    expect(slider).not.toBeDisabled();
    expect(screen.getByText(/Admin control mode is enabled\./i)).toBeInTheDocument();

    fireEvent.change(slider, { target: { value: '0.65' } });

    expect(screen.getAllByText('$0.65').length).toBeGreaterThan(0);
  });

  it('allows superuser to access all scopes and adjust slider defaults', async () => {
    setAuthenticatedUser('rray');

    renderApp();

    expect(screen.getByRole('link', { name: /Import Files/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'User Guide' })).toHaveAttribute('href', '/docs');

    fireEvent.click(screen.getByRole('button', { name: 'Rules' }));

    const slider = await waitFor(() =>
      screen.getByRole('slider', { name: /Timing Difference Days/i }),
    );
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

  it('exposes Bank and GL template downloads under Mapping', () => {
    setAuthenticatedUser('rray');
    renderApp();

    const nav = within(screen.getByRole('navigation'));
    expect(nav.getByRole('link', { name: 'Bank template CSV' })).toHaveAttribute(
      'href',
      '/templates/bank-template.csv',
    );
    expect(nav.getByRole('link', { name: 'Bank template XLSX' })).toHaveAttribute(
      'href',
      '/templates/bank-template.xlsx',
    );
    expect(nav.getByRole('link', { name: 'GL template CSV' })).toHaveAttribute(
      'href',
      '/templates/gl-template.csv',
    );
    expect(nav.getByRole('link', { name: 'GL template XLSX' })).toHaveAttribute(
      'href',
      '/templates/gl-template.xlsx',
    );
  });

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

  it('exposes Rules-based reconciliation and a collapsible Approvals section with five submenus', () => {
    setAuthenticatedUser('rray');
    renderApp();

    expect(screen.getByRole('link', { name: 'Rules-based' })).toHaveAttribute(
      'href',
      '/probable-matches',
    );
    expect(screen.queryByRole('link', { name: 'Pending Imports' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Approved Imports' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Rejected Imports' })).toBeNull();

    expect(screen.getByRole('link', { name: 'Imported files' })).toHaveAttribute(
      'href',
      '/approvals/imports',
    );
    expect(screen.getByRole('link', { name: 'Matching Rule & Variances' })).toHaveAttribute(
      'href',
      '/approvals/matching-rules',
    );
    expect(screen.getByRole('link', { name: 'Exception Resolutions' })).toHaveAttribute(
      'href',
      '/approvals/exception-resolutions',
    );
    expect(screen.getByRole('link', { name: 'Report Distribution' })).toHaveAttribute(
      'href',
      '/approvals/report-distribution',
    );

    fireEvent.click(screen.getByRole('link', { name: 'Imported files' }));

    expect(screen.getByRole('heading', { name: 'Imported files' })).toBeInTheDocument();
  });

  it('shows the Run Book link for admin and superuser roles', () => {
    setAuthenticatedUser('rray3');
    renderApp();

    expect(screen.getByRole('link', { name: 'Run Book' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('link', { name: 'Run Book' }));

    expect(screen.getByRole('heading', { name: 'Run Book' })).toBeInTheDocument();
  });

  it('hides the Run Book link for roles without run book access', () => {
    setAuthenticatedUser('bray');
    renderApp();

    expect(screen.queryByRole('link', { name: 'Run Book' })).toBeNull();
  });
});
