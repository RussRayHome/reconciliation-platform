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
  latestRunResponse: unknown;
  latestRunError: Error | null;
  latestRunPromise: Promise<unknown> | null;
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
    latestRunResponse: null,
    latestRunError: null,
    latestRunPromise: null,
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
    getLatestReconciliationRunRequest: vi.fn(async () => {
      if (mockedApiState.latestRunPromise) {
        return (await mockedApiState.latestRunPromise) as Awaited<
          ReturnType<typeof actual.getLatestReconciliationRunRequest>
        >;
      }

      if (mockedApiState.latestRunError) {
        throw mockedApiState.latestRunError;
      }

      if (!mockedApiState.latestRunResponse) {
        throw new Error('No latest reconciliation run available in test state.');
      }

      return mockedApiState.latestRunResponse as Awaited<
        ReturnType<typeof actual.getLatestReconciliationRunRequest>
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

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  storage.clear();
  mockedApiState.latestRunResponse = null;
  mockedApiState.latestRunError = null;
  mockedApiState.latestRunPromise = null;
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
    expect(screen.getByRole('link', { name: /Reconciliation/i })).not.toHaveAttribute(
      'aria-current',
    );
    expect(screen.getByRole('link', { name: /Exceptions/i })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: /Reports/i })).not.toHaveAttribute('aria-current');
    expect(screen.getByText('Source Upload')).toBeInTheDocument();
  });

  it('navigates between rail destinations via real routes and updates the active link', async () => {
    const user = userEvent.setup();

    setAuthenticatedUser('rray');

    renderApp();

    await user.click(screen.getByRole('link', { name: /Reconciliation/i }));

    expect(screen.getByRole('link', { name: /Reconciliation/i })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(globalThis.location.pathname).toBe('/recon-summary');

    await user.click(screen.getByRole('link', { name: /Reports/i }));

    expect(screen.getByRole('link', { name: /Reports/i })).toHaveAttribute('aria-current', 'page');
    expect(globalThis.location.pathname).toBe('/export');
  });

  it('swaps Review panels via the rail and exports from Close', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(createRunResponse()), { status: 201 }),
    );

    setAuthenticatedUser('rray');

    renderApp();

    fireEvent.change(screen.getByLabelText('Bank workbook'), {
      target: { files: [new File(['bank'], 'bank.xlsx')] },
    });
    fireEvent.change(screen.getByLabelText('GL workbook'), {
      target: { files: [new File(['gl'], 'gl.xlsx')] },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Run reconciliation' }));

    await waitFor(() => {
      expect(screen.getByText('Total reviewed')).toBeInTheDocument();
    });

    expect(screen.getByRole('heading', { name: 'Review' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Reconciliation/i })).toHaveAttribute(
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

  it('hydrates the Review tab from the last successful persisted run after remount', () => {
    setAuthenticatedUser('rray');
    globalThis.localStorage.setItem(
      'reconciliation-platform:latest-report-run',
      // Must track RUN_STORAGE_SCHEMA_VERSION in App.tsx: a persisted run stored under an older
      // version is deliberately discarded, so a stale literal here silently stops testing hydration.
      JSON.stringify({ version: 3, run: createRunResponse() }),
    );

    renderApp();

    fireEvent.click(screen.getByRole('link', { name: /Reconciliation/i }));

    return waitFor(() => {
      expect(screen.getAllByText('Total reviewed').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Exact matches').length).toBeGreaterThan(0);
      expect(screen.queryByText('No review output yet')).toBeNull();
    });
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
    mockedApiState.latestRunResponse = createRunResponse();
    setAuthenticatedUser('rray');

    renderApp();

    fireEvent.click(screen.getByRole('link', { name: /Reconciliation/i }));

    await waitFor(() => {
      expect(screen.getAllByText('Total reviewed').length).toBeGreaterThan(0);
    });

    expect(screen.getAllByText('Exact matches').length).toBeGreaterThan(0);
    expect(screen.queryByText('No review output yet')).toBeNull();
  });

  it('shows a loading state while hydrating the latest backend report', async () => {
    const deferred = createDeferred<ReturnType<typeof createRunResponse>>();
    mockedApiState.latestRunPromise = deferred.promise;
    setAuthenticatedUser('rray');

    renderApp();

    fireEvent.click(screen.getByRole('link', { name: /Reconciliation/i }));

    expect(screen.getByRole('status')).toHaveTextContent('Loading review output');

    deferred.resolve(createRunResponse());

    await waitFor(() => {
      expect(screen.getAllByText('Total reviewed').length).toBeGreaterThan(0);
    });
  });

  it('shows an alert when latest-run hydration fails', async () => {
    mockedApiState.latestRunError = new Error('Backend unavailable.');
    setAuthenticatedUser('rray');

    renderApp();

    fireEvent.click(screen.getByRole('link', { name: /Reconciliation/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Backend unavailable.');
    });

    expect(screen.getByText('Latest review output could not be loaded')).toBeInTheDocument();
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
    expect(screen.getByText('Variance thresholds')).toBeInTheDocument();

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
    expect(screen.getByText('executeReconciliation')).toBeInTheDocument();
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
    const deferred = createDeferred<ReturnType<typeof createRunResponse>>();
    mockedApiState.latestRunPromise = deferred.promise;
    setAuthenticatedUser('rray');
    renderApp();

    fireEvent.click(screen.getByRole('link', { name: /Reconciliation/i }));

    expect(screen.getByRole('link', { name: /Reconciliation/i })).toBeInTheDocument();
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

    fireEvent.change(screen.getByLabelText('Bank workbook'), {
      target: { files: [new File(['bank'], 'bank.xlsx')] },
    });
    fireEvent.change(screen.getByLabelText('GL workbook'), {
      target: { files: [new File(['gl'], 'gl.xlsx')] },
    });

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
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(createRunResponse()), { status: 201 }),
    );

    setAuthenticatedUser('rray');

    renderApp();

    fireEvent.change(screen.getByLabelText('Bank workbook'), {
      target: { files: [new File(['bank'], 'bank.xlsx')] },
    });
    fireEvent.change(screen.getByLabelText('GL workbook'), {
      target: { files: [new File(['gl'], 'gl.xlsx')] },
    });
    fireEvent.change(screen.getByPlaceholderText('OPERATING-001'), {
      target: { value: 'OPERATING-001' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Run reconciliation' }));

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
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ message: 'Upload failed.' }), { status: 500 }),
    );

    setAuthenticatedUser('rray');

    renderApp();

    fireEvent.change(screen.getByLabelText('Bank workbook'), {
      target: { files: [new File(['bank'], 'bank.xlsx')] },
    });
    fireEvent.change(screen.getByLabelText('GL workbook'), {
      target: { files: [new File(['gl'], 'gl.xlsx')] },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Run reconciliation' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Upload failed.');
    });
  });

  it('submits the selected local files and metadata as multipart form data', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify(createRunResponse()), { status: 201 }));

    setAuthenticatedUser('rray');

    renderApp();

    const bankFile = new File(['bank-data'], 'bank.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const glFile = new File(['gl-data'], 'gl.xlsx', {
      type: 'application/octet-stream',
    });

    fireEvent.change(screen.getByLabelText('Bank workbook'), {
      target: { files: [bankFile] },
    });
    fireEvent.change(screen.getByLabelText('GL workbook'), {
      target: { files: [glFile] },
    });
    fireEvent.change(screen.getByPlaceholderText('OPERATING-001'), {
      target: { value: 'OPERATING-001' },
    });
    fireEvent.change(screen.getByLabelText(/Reconciliation frequency/i), {
      target: { value: 'Annual' },
    });
    fireEvent.change(screen.getByLabelText(/Annual reconciliation year/i), {
      target: { value: '2023' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Run reconciliation' }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    const [url, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/reconciliation/run');
    expect(options.method).toBe('POST');
    expect(options.body).toBeInstanceOf(FormData);

    const formData = options.body as FormData;
    expect(formData.get('bankFile')).toBe(bankFile);
    expect(formData.get('glFile')).toBe(glFile);
    expect(formData.get('accountIdentifier')).toBe('OPERATING-001');
    expect(formData.get('reconciliationFrequency')).toBe('Annual');
    expect(formData.get('periodLabel')).toBe('Annual Recon for 2023');
  });

  it('submits selected monthly month as period label when frequency is monthly', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify(createRunResponse()), { status: 201 }));

    setAuthenticatedUser('rray');

    renderApp();

    const bankFile = new File(['bank-data'], 'bank.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const glFile = new File(['gl-data'], 'gl.xlsx', {
      type: 'application/octet-stream',
    });

    fireEvent.change(screen.getByLabelText('Bank workbook'), {
      target: { files: [bankFile] },
    });
    fireEvent.change(screen.getByLabelText('GL workbook'), {
      target: { files: [glFile] },
    });
    fireEvent.change(screen.getByLabelText(/Monthly reconciliation month/i), {
      target: { value: 'March' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Run reconciliation' }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const formData = options.body as FormData;

    expect(formData.get('reconciliationFrequency')).toBe('Monthly');
    expect(formData.get('periodLabel')).toBe(`Monthly Recon for March ${new Date().getFullYear()}`);
  });

  it('allows editing the prepopulated reconciliation label before submit', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify(createRunResponse()), { status: 201 }));

    setAuthenticatedUser('rray');

    renderApp();

    fireEvent.change(screen.getByLabelText('Bank workbook'), {
      target: { files: [new File(['bank-data'], 'bank.xlsx')] },
    });
    fireEvent.change(screen.getByLabelText('GL workbook'), {
      target: { files: [new File(['gl-data'], 'gl.xlsx')] },
    });
    fireEvent.change(screen.getByLabelText(/Reconciliation label/i), {
      target: { value: 'Custom Monthly Label' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Run reconciliation' }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const formData = options.body as FormData;

    expect(formData.get('periodLabel')).toBe('Custom Monthly Label');
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
      target: { files: [new File(['bank'], 'bank.xlsx'), new File(['gl'], 'gl.xlsx')] },
    });

    expect(screen.getByRole('button', { name: 'Run reconciliation' })).not.toBeDisabled();
    expect(screen.getAllByText('bank.xlsx').length).toBeGreaterThan(0);
    expect(screen.getAllByText('gl.xlsx').length).toBeGreaterThan(0);
  });

  it('lands financial analysts on the Review tab', async () => {
    setAuthenticatedUser('bray');
    renderApp();

    await waitFor(() => {
      expect(screen.getByRole('link', { name: /Reconciliation/i })).toHaveAttribute(
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
      expect(screen.getByRole('link', { name: /Reconciliation/i })).toHaveAttribute(
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
    expect(screen.getByText('Source Upload')).toBeInTheDocument();
  });

  it('leads the Summary panel with the reconciliation verdict', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(createRunResponse()), { status: 201 }),
    );

    setAuthenticatedUser('rray');
    renderApp();

    fireEvent.change(screen.getByLabelText('Bank workbook'), {
      target: { files: [new File(['bank'], 'bank.xlsx')] },
    });
    fireEvent.change(screen.getByLabelText('GL workbook'), {
      target: { files: [new File(['gl'], 'gl.xlsx')] },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Run reconciliation' }));

    await waitFor(() => {
      expect(screen.getByText('Unexplained residual')).toBeInTheDocument();
    });

    expect(screen.getByText('Bank unmatched (net)')).toBeInTheDocument();
    expect(screen.getByText('Prior-period comparison')).toBeInTheDocument();
  });

  it('disables submit when reconciliation label is blank', () => {
    setAuthenticatedUser('rray');
    renderApp();

    fireEvent.change(screen.getByLabelText('Bank workbook'), {
      target: { files: [new File(['bank'], 'bank.xlsx')] },
    });
    fireEvent.change(screen.getByLabelText('GL workbook'), {
      target: { files: [new File(['gl'], 'gl.xlsx')] },
    });
    fireEvent.change(screen.getByLabelText(/Reconciliation label/i), {
      target: { value: '   ' },
    });

    expect(screen.getByRole('button', { name: 'Run reconciliation' })).toBeDisabled();
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

    fireEvent.click(within(nav).getByRole('button', { name: 'Log out' }));

    expect(screen.getByRole('heading', { name: 'Log in' })).toBeInTheDocument();
  });

  it('exposes Bank and GL template downloads under Mapping', () => {
    setAuthenticatedUser('rray');
    renderApp();

    expect(screen.getByRole('link', { name: /Bank template/i })).toHaveAttribute(
      'href',
      '/templates/bank-template.csv',
    );
    expect(screen.getByRole('link', { name: /GL template/i })).toHaveAttribute(
      'href',
      '/templates/gl-template.csv',
    );
  });

  it('collapses and expands the Account section, persisting the choice', () => {
    setAuthenticatedUser('rray');
    renderApp();

    const accountHeader = screen.getByRole('button', { name: 'Account' });
    expect(accountHeader).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('link', { name: 'Profile' })).toBeInTheDocument();

    fireEvent.click(accountHeader);

    expect(accountHeader).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('link', { name: 'Profile' })).toBeNull();
    expect(
      globalThis.localStorage.getItem('reconciliation-platform:nav.section.account:rray'),
    ).toBe('false');
  });

  it('routes placeholder destinations to the shared coming-soon page', async () => {
    setAuthenticatedUser('rray');
    renderApp();

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

  it('drops Probable matches from the rail and routes the new Approvals items', () => {
    setAuthenticatedUser('rray');
    renderApp();

    expect(screen.queryByRole('link', { name: /Probable matches/i })).toBeNull();

    fireEvent.click(screen.getByRole('link', { name: 'Pending Imports' }));

    expect(screen.getByRole('heading', { name: 'Pending Imports' })).toBeInTheDocument();
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
