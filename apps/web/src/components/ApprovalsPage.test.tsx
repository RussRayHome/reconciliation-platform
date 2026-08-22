// @vitest-environment jsdom

import type * as ApiModule from '../lib/api';
import type { ApprovalRow } from '@recon/domain';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

import { ApprovalsPage } from './ApprovalsPage';
import { routePaths } from '../routes/routePaths';

afterEach(() => {
  cleanup();
});

const mockedApi = vi.hoisted(() => ({
  rows: [] as ApprovalRow[],
  error: null as Error | null,
  getApprovalsRequest: vi.fn<typeof ApiModule.getApprovalsRequest>(),
  decideApprovalRequest: vi.fn<typeof ApiModule.decideApprovalRequest>(),
  claimApprovalRequest: vi.fn<typeof ApiModule.claimApprovalRequest>(),
  withdrawImportRunRequest: vi.fn<typeof ApiModule.withdrawImportRunRequest>(),
}));

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof ApiModule>('../lib/api');
  return {
    ...actual,
    getApprovalsRequest: mockedApi.getApprovalsRequest,
    decideApprovalRequest: mockedApi.decideApprovalRequest,
    claimApprovalRequest: mockedApi.claimApprovalRequest,
    withdrawImportRunRequest: mockedApi.withdrawImportRunRequest,
  };
});

const PENDING_UNASSIGNED: ApprovalRow = {
  id: 'row-1',
  type: 'import',
  title: 'bank_statement.xlsx',
  submitter: 'j.doe',
  approver: null,
  ageHours: 3,
  state: 'PENDING',
};

const PENDING_ASSIGNED: ApprovalRow = {
  id: 'row-2',
  type: 'import',
  title: 'company_gl.xlsx',
  meta: '412 rows',
  submitter: 'a.smith',
  approver: 'm.ortega',
  ageHours: 30,
  state: 'PENDING',
};

const PENDING_ASSIGNED_RUN: ApprovalRow = {
  id: 'run-1',
  type: 'reconciliationRun',
  title: 'August Recon',
  meta: 'Monthly recon · 8/2026',
  submitter: 'j.doe',
  approver: 'm.ortega',
  ageHours: 12,
  state: 'PENDING',
};

const renderPage = (
  props: Partial<{ canApprove: boolean; isAdmin: boolean }> = {},
  path: string = routePaths.approvalsImports,
) => {
  const merged = { canApprove: true, isAdmin: false, ...props };
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ApprovalsPage canApprove={merged.canApprove} isAdmin={merged.isAdmin} />
    </MemoryRouter>,
  );
};

beforeEach(() => {
  mockedApi.rows = [];
  mockedApi.error = null;
  mockedApi.getApprovalsRequest.mockReset();
  mockedApi.decideApprovalRequest.mockReset();
  mockedApi.claimApprovalRequest.mockReset();
  mockedApi.withdrawImportRunRequest.mockReset();
  mockedApi.getApprovalsRequest.mockImplementation((type: ApprovalRow['type']) => {
    if (mockedApi.error) return Promise.reject(mockedApi.error);
    return Promise.resolve(mockedApi.rows.filter((row) => row.type === type));
  });
  mockedApi.decideApprovalRequest.mockResolvedValue(undefined);
  mockedApi.claimApprovalRequest.mockResolvedValue(undefined);
  mockedApi.withdrawImportRunRequest.mockResolvedValue({
    id: 'run-1',
    organizationId: 'org-1',
    label: 'August Recon',
    accountIdentifier: null,
    frequency: 'MONTHLY',
    periodYear: 2026,
    periodMonth: 8,
    status: 'DRAFT',
    createdAt: '2026-08-01T00:00:00.000Z',
    matchingJobId: null,
    matchingJob: null,
    validationJob: null,
    files: [],
  });
});

describe('ApprovalsPage', () => {
  it('shows a loading message before the fetch resolves', () => {
    mockedApi.getApprovalsRequest.mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(screen.getByText('Loading approvals…')).toBeTruthy();
  });

  it('renders rows for a live group once loaded, with claim/approve actions gated correctly', async () => {
    mockedApi.rows = [PENDING_UNASSIGNED, PENDING_ASSIGNED];
    renderPage({ canApprove: true });

    await waitFor(() => expect(screen.getByText('bank_statement.xlsx')).toBeTruthy());
    expect(screen.getByText('company_gl.xlsx')).toBeTruthy();
    expect(screen.getByText('412 rows')).toBeTruthy();
    expect(screen.getByText('3h')).toBeTruthy();
    expect(screen.getByText('1d')).toBeTruthy();

    // Unassigned row: claim action, not approve/reject
    expect(screen.getByRole('button', { name: 'Claim to review' })).toBeTruthy();
    // Assigned + pending row: reject/approve actions
    expect(screen.getByRole('button', { name: 'Reject' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeTruthy();
  });

  it('shows the live-empty message when a live group has no rows', async () => {
    mockedApi.rows = [];
    renderPage({ canApprove: true });
    await waitFor(() => expect(screen.getByText('Imported files -- nothing pending')).toBeTruthy());
  });

  it('shows the coming-soon message for a non-live group instead of an empty queue', async () => {
    mockedApi.rows = [];
    renderPage({ canApprove: true }, routePaths.approvalsMappingProfiles);
    await waitFor(() =>
      expect(screen.getByText("Mapping Profiles approvals aren't available yet")).toBeTruthy(),
    );
    expect(screen.getByText('Coming soon')).toBeTruthy();
  });

  it('surfaces a load error instead of the table', async () => {
    mockedApi.error = new Error('network down');
    renderPage();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('network down');
  });

  it('shows the approver-facing tab set for canApprove=true and the submitter set for false', async () => {
    mockedApi.rows = [];
    const { unmount } = renderPage({ canApprove: true });
    await waitFor(() => expect(mockedApi.getApprovalsRequest).toHaveBeenCalled());
    expect(screen.getByRole('link', { name: /My submissions/ })).toBeTruthy();
    unmount();
    cleanup();

    mockedApi.getApprovalsRequest.mockClear();
    renderPage({ canApprove: false });
    await waitFor(() => expect(mockedApi.getApprovalsRequest).toHaveBeenCalled());
    expect(screen.queryByRole('link', { name: /My submissions/ })).toBeNull();
    expect(screen.getByRole('link', { name: /^Submitted/ })).toBeTruthy();
  });

  it('shows the Approval policy link only for admins', async () => {
    mockedApi.rows = [];
    const { unmount } = renderPage({ isAdmin: true });
    await waitFor(() => expect(mockedApi.getApprovalsRequest).toHaveBeenCalled());
    expect(screen.getByRole('link', { name: 'Approval policy' })).toBeTruthy();
    unmount();
    cleanup();

    mockedApi.getApprovalsRequest.mockClear();
    renderPage({ isAdmin: false });
    await waitFor(() => expect(mockedApi.getApprovalsRequest).toHaveBeenCalled());
    expect(screen.queryByRole('link', { name: 'Approval policy' })).toBeNull();
  });

  it('claims an unassigned row and refreshes the table', async () => {
    mockedApi.rows = [PENDING_UNASSIGNED];
    renderPage({ canApprove: true });
    await waitFor(() => expect(screen.getByText('bank_statement.xlsx')).toBeTruthy());

    mockedApi.getApprovalsRequest.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Claim to review' }));

    await waitFor(() =>
      expect(mockedApi.claimApprovalRequest).toHaveBeenCalledWith('import', 'row-1'),
    );
    await waitFor(() => expect(mockedApi.getApprovalsRequest).toHaveBeenCalled());
  });

  it('withdraws a pending reconciliationRun submission for a non-approver viewer', async () => {
    mockedApi.rows = [PENDING_ASSIGNED_RUN];
    renderPage({ canApprove: false });
    await waitFor(() => expect(screen.getByText('August Recon')).toBeTruthy());

    mockedApi.getApprovalsRequest.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw' }));

    await waitFor(() =>
      expect(mockedApi.withdrawImportRunRequest).toHaveBeenCalledWith('run-1'),
    );
    await waitFor(() => expect(mockedApi.getApprovalsRequest).toHaveBeenCalled());
  });

  it('shows no row action for a non-approver on a non-reconciliationRun or non-pending row', async () => {
    const decidedRun: ApprovalRow = { ...PENDING_ASSIGNED_RUN, id: 'run-2', state: 'APPROVED' };
    mockedApi.rows = [PENDING_ASSIGNED, decidedRun];
    renderPage({ canApprove: false });
    await waitFor(() => expect(screen.getByText('company_gl.xlsx')).toBeTruthy());

    expect(screen.queryByRole('button', { name: 'Withdraw' })).not.toBeInTheDocument();
  });

  it('never shows Withdraw for an approver viewer, even on a pending reconciliationRun row', async () => {
    mockedApi.rows = [PENDING_ASSIGNED_RUN];
    renderPage({ canApprove: true });
    await waitFor(() => expect(screen.getByText('August Recon')).toBeTruthy());

    expect(screen.queryByRole('button', { name: 'Withdraw' })).not.toBeInTheDocument();
  });

  it('shows an action error when withdrawing fails, without losing the table', async () => {
    mockedApi.rows = [PENDING_ASSIGNED_RUN];
    mockedApi.withdrawImportRunRequest.mockRejectedValue(new Error('Only the analyst who submitted this run may withdraw it.'));
    renderPage({ canApprove: false });
    await waitFor(() => expect(screen.getByText('August Recon')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Withdraw' }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Only the analyst who submitted this run may withdraw it.',
      ),
    );
    expect(screen.getByText('August Recon')).toBeInTheDocument();
  });

  it('approves and rejects an assigned pending row, and uses the Promote label for matching-rule rows', async () => {
    const matchingRuleRow: ApprovalRow = {
      id: 'row-3',
      type: 'matchingRule',
      title: 'Matching config v9',
      submitter: 'j.doe',
      approver: 'm.ortega',
      ageHours: 5,
      state: 'PENDING',
    };
    mockedApi.rows = [matchingRuleRow];
    renderPage({ canApprove: true }, routePaths.approvalsMatchingRules);
    await waitFor(() => expect(screen.getByText('Matching config v9')).toBeTruthy());

    const approveButton = screen.getByRole('button', { name: 'Promote v9' });
    fireEvent.click(approveButton);
    await waitFor(() =>
      expect(mockedApi.decideApprovalRequest).toHaveBeenCalledWith(
        'matchingRule',
        'row-3',
        'APPROVED',
      ),
    );

    mockedApi.decideApprovalRequest.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    await waitFor(() =>
      expect(mockedApi.decideApprovalRequest).toHaveBeenCalledWith(
        'matchingRule',
        'row-3',
        'REJECTED',
      ),
    );
  });

  it('shows an action error when a decision fails, without losing the table', async () => {
    mockedApi.rows = [PENDING_ASSIGNED];
    mockedApi.decideApprovalRequest.mockRejectedValue(new Error('decision rejected by server'));
    renderPage({ canApprove: true });
    await waitFor(() => expect(screen.getByText('company_gl.xlsx')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('decision rejected by server');
    expect(screen.getByText('company_gl.xlsx')).toBeTruthy();
  });

  it('selects rows via checkbox and bulk-approves the selection', async () => {
    mockedApi.rows = [PENDING_UNASSIGNED, PENDING_ASSIGNED];
    renderPage({ canApprove: true });
    await waitFor(() => expect(screen.getByText('bank_statement.xlsx')).toBeTruthy());

    const checkbox = screen.getByRole('checkbox', { name: 'Select company_gl.xlsx' });
    fireEvent.click(checkbox);

    expect(screen.getByText('1 selected')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Approve 1 selected' }));
    await waitFor(() =>
      expect(mockedApi.decideApprovalRequest).toHaveBeenCalledWith('import', 'row-2', 'APPROVED'),
    );
  });

  it('clears the selection via the Clear button without submitting a decision', async () => {
    mockedApi.rows = [PENDING_ASSIGNED];
    renderPage({ canApprove: true });
    await waitFor(() => expect(screen.getByText('company_gl.xlsx')).toBeTruthy());

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select company_gl.xlsx' }));
    expect(screen.getByText('1 selected')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.queryByText('1 selected')).toBeNull();
    expect(mockedApi.decideApprovalRequest).not.toHaveBeenCalled();
  });

  it('disables the header Bulk approve button until something is selected, and hides checkboxes on non-pending tabs', async () => {
    mockedApi.rows = [PENDING_ASSIGNED];
    renderPage({ canApprove: true });
    await waitFor(() => expect(screen.getByText('company_gl.xlsx')).toBeTruthy());

    const bulkButton = screen.getByRole('button', { name: 'Bulk approve' }) as HTMLButtonElement;
    expect(bulkButton.disabled).toBe(true);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select company_gl.xlsx' }));
    expect(bulkButton.disabled).toBe(false);
  });

  it('hides row checkboxes for a non-approver viewer', async () => {
    mockedApi.rows = [PENDING_ASSIGNED];
    renderPage({ canApprove: false });
    await waitFor(() => expect(screen.getByText('company_gl.xlsx')).toBeTruthy());
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Bulk approve' })).toBeNull();
  });

  it('shows an action error when claiming a row fails', async () => {
    mockedApi.rows = [PENDING_UNASSIGNED];
    mockedApi.claimApprovalRequest.mockRejectedValue(new Error('claim rejected by server'));
    renderPage({ canApprove: true });
    await waitFor(() => expect(screen.getByText('bank_statement.xlsx')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Claim to review' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('claim rejected by server');
  });

  it('unchecking a selected row removes it from the selection', async () => {
    mockedApi.rows = [PENDING_ASSIGNED];
    renderPage({ canApprove: true });
    await waitFor(() => expect(screen.getByText('company_gl.xlsx')).toBeTruthy());

    const checkbox = screen.getByRole('checkbox', { name: 'Select company_gl.xlsx' });
    fireEvent.click(checkbox);
    expect(screen.getByText('1 selected')).toBeTruthy();

    fireEvent.click(checkbox);
    expect(screen.queryByText('1 selected')).toBeNull();
  });

  it('shows an action error when bulk approve fails', async () => {
    mockedApi.rows = [PENDING_ASSIGNED];
    mockedApi.decideApprovalRequest.mockRejectedValue(new Error('bulk approve rejected by server'));
    renderPage({ canApprove: true });
    await waitFor(() => expect(screen.getByText('company_gl.xlsx')).toBeTruthy());

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select company_gl.xlsx' }));
    fireEvent.click(screen.getByRole('button', { name: 'Approve 1 selected' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('bulk approve rejected by server');
  });

  it('merges import and reconciliationRun rows into one table on /approvals/imports', async () => {
    mockedApi.rows = [PENDING_ASSIGNED, PENDING_ASSIGNED_RUN];
    renderPage({ canApprove: true });

    await waitFor(() => expect(screen.getByText('company_gl.xlsx')).toBeTruthy());
    expect(screen.getByText('August Recon')).toBeTruthy();
    expect(screen.getByText('Monthly recon · 8/2026')).toBeTruthy();
    expect(mockedApi.getApprovalsRequest).toHaveBeenCalledWith('import', 'pending');
    expect(mockedApi.getApprovalsRequest).toHaveBeenCalledWith('reconciliationRun', 'pending');
  });

  it('bulk-approves a mixed selection using each row\'s own type, not the group\'s first type', async () => {
    mockedApi.rows = [PENDING_ASSIGNED, PENDING_ASSIGNED_RUN];
    renderPage({ canApprove: true });
    await waitFor(() => expect(screen.getByText('August Recon')).toBeTruthy());

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select company_gl.xlsx' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select August Recon' }));
    fireEvent.click(screen.getByRole('button', { name: 'Approve 2 selected' }));

    await waitFor(() =>
      expect(mockedApi.decideApprovalRequest).toHaveBeenCalledWith('import', 'row-2', 'APPROVED'),
    );
    expect(mockedApi.decideApprovalRequest).toHaveBeenCalledWith('reconciliationRun', 'run-1', 'APPROVED');
  });
});
