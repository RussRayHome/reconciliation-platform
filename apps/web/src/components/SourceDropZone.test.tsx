// @vitest-environment jsdom

import { type Dispatch, type SetStateAction, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { CanonicalField, ReconciliationAccount } from '@recon/domain';

import { MAX_AP_ENTITIES, MAX_BANK_ACCOUNTS, SourceDropZone } from './SourceDropZone';

const makeFile = (name: string, contents = 'contents'): File => new File([contents], name);

const largeFile = (name: string): File => {
  const file = new File(['x'], name);
  Object.defineProperty(file, 'size', { value: 51 * 1024 * 1024 });
  return file;
};

afterEach(cleanup);

/** Wraps SourceDropZone with real React state so slot-filling behavior (which depends on the
 * setter actually taking effect between renders) can be exercised end to end, not just asserted
 * against a single mocked setState call. */
function BankGlHarness({
  only = 'bank',
  initialBankFiles = [null, null],
  canonicalFields = [],
  accounts = [],
}: {
  /** Which half of the pair to render. Bank and GL are separate tabs on 1a (Phase 2) but stay one
   * component, so dropped files are still routed by filename signature across both. */
  only?: 'bank' | 'gl' | 'both';
  initialBankFiles?: (File | null)[];
  canonicalFields?: CanonicalField[];
  /** A-D1 (Issue #338): the registry the per-slot assignment control offers. Empty by default --
   * the slot-filling behaviour these tests cover is independent of it. */
  accounts?: ReconciliationAccount[];
}) {
  const [bankFiles, setBankFiles] = useState<(File | null)[]>(initialBankFiles);
  const [bankAccountIds, setBankAccountIds] = useState<(string | null)[]>(
    initialBankFiles.map(() => null),
  );
  const [glFile, setGlFile] = useState<File | null>(null);
  const shared = {
    bankFiles,
    glFile,
    setBankFiles: setBankFiles as Dispatch<SetStateAction<(File | null)[]>>,
    setGlFile,
    accounts,
    bankAccountIds,
    setBankAccountIds,
    canonicalFields,
  };
  // 'both' mounts the two panels over one state, which is what the real screen does across a tab
  // switch -- App.tsx owns the file state above the panel, so switching tabs never remounts it.
  if (only === 'both') {
    return (
      <>
        <SourceDropZone mode="bank-gl" only="bank" {...shared} />
        <SourceDropZone mode="bank-gl" only="gl" {...shared} />
      </>
    );
  }
  return (
    <SourceDropZone
      mode="bank-gl"
      only={only}
      bankFiles={bankFiles}
      glFile={glFile}
      setBankFiles={setBankFiles as Dispatch<SetStateAction<(File | null)[]>>}
      setGlFile={setGlFile}
      accounts={accounts}
      bankAccountIds={bankAccountIds}
      setBankAccountIds={setBankAccountIds}
      canonicalFields={canonicalFields}
    />
  );
}

function ApHarness({
  initialApFiles = [null],
  canonicalFields = [],
}: {
  initialApFiles?: (File | null)[];
  canonicalFields?: CanonicalField[];
}) {
  const [apFiles, setApFiles] = useState<(File | null)[]>(initialApFiles);
  return (
    <SourceDropZone
      mode="subledger"
      subledger="ap"
      apFiles={apFiles}
      setApFiles={setApFiles as Dispatch<SetStateAction<(File | null)[]>>}
      canonicalFields={canonicalFields}
    />
  );
}

describe('SourceDropZone (bank panel)', () => {
  it('renders a slot per bank account and no GL slot', () => {
    // Phase 2 split bank and GL into separate tabs; the GL slot belongs to the GL panel now.
    render(<BankGlHarness />);

    expect(screen.getByLabelText('Bank workbook (Account 1)')).toBeInTheDocument();
    expect(screen.getByLabelText('Bank workbook (Account 2)')).toBeInTheDocument();
    expect(screen.queryByLabelText('GL workbook')).not.toBeInTheDocument();
  });

  it('renders only the GL slot on the GL panel', () => {
    render(<BankGlHarness only="gl" />);

    expect(screen.getByLabelText('GL workbook')).toBeInTheDocument();
    expect(screen.queryByLabelText('Bank workbook (Account 1)')).not.toBeInTheDocument();
  });

  it('auto-assigns a bank-named file to the first empty bank slot via the merged input', async () => {
    const user = userEvent.setup();
    render(<BankGlHarness />);

    await user.upload(screen.getByLabelText('Source workbooks'), makeFile('1111_bank-export.csv'));

    expect(screen.getByText('1111_bank-export.csv')).toBeInTheDocument();
  });

  it('still routes a gl-named file dropped on the bank panel to the GL slot', async () => {
    // The two tabs share one component precisely so this keeps working: a user who drops the GL
    // export on the Bank tab should not have the file silently go nowhere because they guessed the
    // wrong tab. The bank panel does not render the GL slot, so the file's arrival is observed on
    // the GL panel -- which is the user-visible consequence.
    const user = userEvent.setup();
    render(<BankGlHarness only="both" />);

    // Drop it on the bank panel's input, the one a user on the Bank tab would reach.
    await user.upload(
      screen.getAllByLabelText('Source workbooks')[0]!,
      makeFile('gl-export.csv'),
    );

    const glSlot = screen.getByLabelText('GL workbook').closest('.source-slot');
    expect(glSlot).toHaveTextContent('gl-export.csv');
  });

  it('accepts a bank file whose name does not start with an account number (A-D1)', async () => {
    // Previously rejected outright: the filename was the only thing saying which account a
    // statement belonged to, so a name without one could not be merged. A-D1 (Issue #338) moved
    // that to an explicit per-slot assignment, leaving the name with no authority at all.
    const user = userEvent.setup();
    render(<BankGlHarness />);

    await user.upload(screen.getByLabelText('Source workbooks'), makeFile('bank-export.csv'));

    expect(screen.queryByText('UPLOAD_BANK_FILENAME_INVALID')).not.toBeInTheDocument();
    const bankSlot = screen.getByLabelText('Bank workbook (Account 1)').closest('.source-slot');
    expect(bankSlot).toHaveTextContent('bank-export.csv');
  });

  it('offers an account assignment control for a staged bank file, defaulting to no selection', async () => {
    const user = userEvent.setup();
    render(
      <BankGlHarness
        accounts={[
          {
            id: '11111111-1111-4111-8111-111111111111',
            organizationId: 'org-1',
            accountIdentifier: '4321',
            displayName: 'Operating',
            institutionName: 'Truist',
            lastFour: '4321',
            currencyCode: 'USD',
            glCashAccountCode: null,
            isActive: true,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ]}
      />,
    );

    await user.upload(screen.getByLabelText('Source workbooks'), makeFile('9999_bank.csv'));

    // The label is what the operator picks by; the account's UUID never appears (A-D1).
    const select = screen.getByLabelText('Bank account');
    expect(select).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Operating — ending in 4321' })).toBeInTheDocument();
    // 9999 matches nothing, so nothing is pre-selected -- a filename never picks on its own.
    expect(select).toHaveValue('');
  });

  it('pre-selects the one account a filename unambiguously points at', async () => {
    const user = userEvent.setup();
    render(
      <BankGlHarness
        accounts={[
          {
            id: '11111111-1111-4111-8111-111111111111',
            organizationId: 'org-1',
            accountIdentifier: '4321',
            displayName: 'Operating',
            institutionName: 'Truist',
            lastFour: '4321',
            currencyCode: 'USD',
            glCashAccountCode: null,
            isActive: true,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ]}
      />,
    );

    await user.upload(screen.getByLabelText('Source workbooks'), makeFile('4321_bank.csv'));

    expect(screen.getByLabelText('Bank account')).toHaveValue(
      '11111111-1111-4111-8111-111111111111',
    );
  });

  it('does not pre-select when two accounts share the filename\'s last four (A-D1)', async () => {
    const base = {
      organizationId: 'org-1',
      displayName: null,
      institutionName: null,
      lastFour: '4321',
      currencyCode: 'USD',
      glCashAccountCode: null,
      isActive: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const user = userEvent.setup();
    render(
      <BankGlHarness
        accounts={[
          { ...base, id: '11111111-1111-4111-8111-111111111111', accountIdentifier: '1114321' },
          { ...base, id: '22222222-2222-4222-8222-222222222222', accountIdentifier: '2224321' },
        ]}
      />,
    );

    await user.upload(screen.getByLabelText('Source workbooks'), makeFile('4321_bank.csv'));

    // "Never choose the first match automatically" -- the operator is told to pick instead.
    expect(screen.getByLabelText('Bank account')).toHaveValue('');
    expect(screen.getByText(/More than one account ends in 4321/)).toBeInTheDocument();
  });

  it('rejects an oversized file', async () => {
    const user = userEvent.setup();
    render(<BankGlHarness />);

    await user.upload(screen.getByLabelText('Source workbooks'), largeFile('1111_bank.csv'));

    expect(screen.getByText('UPLOAD_SIZE_EXCEEDED · limit 50 MB')).toBeInTheDocument();
  });

  it('"Add another bank statement" grows a new slot up to the max', async () => {
    const user = userEvent.setup();
    render(<BankGlHarness />);

    await user.click(screen.getByRole('button', { name: 'Add another bank statement' }));
    await user.click(screen.getByRole('button', { name: 'Add another bank statement' }));

    expect(screen.getByLabelText('Bank workbook (Account 4)')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Add another bank statement' }),
    ).not.toBeInTheDocument();
  });

  it('a manual override via a specific slot input still fills that exact slot', async () => {
    const user = userEvent.setup();
    render(<BankGlHarness />);

    await user.upload(
      screen.getByLabelText('Bank workbook (Account 2)'),
      makeFile('2222_override.csv'),
    );

    const slotTwo = screen.getByLabelText('Bank workbook (Account 2)').closest('.source-slot');
    expect(slotTwo).toHaveTextContent('2222_override.csv');
  });
});

// R2 V6 (warn-only design, Issue #250): the fuzzy header preview, wired through SourceSlot via
// useHeaderPreviewWarning. Never blocks -- these tests assert the heads-up copy appears/doesn't,
// not anything about Submit being disabled (that's App.test.tsx's V4 gating concern, untouched by
// this package).
describe('SourceDropZone header preview (Issue #250)', () => {
  const REQUIRED_FIELDS: CanonicalField[] = [
    { id: 'transactionDate', type: 'date', required: true, note: '' },
    { id: 'amount', type: 'numeric', required: true, note: '' },
  ];

  it('shows a heads-up when a required column has no plausible match in a CSV header', async () => {
    const user = userEvent.setup();
    render(<BankGlHarness canonicalFields={REQUIRED_FIELDS} />);

    await user.upload(
      screen.getByLabelText('Bank workbook (Account 1)'),
      makeFile('1111_bank.csv', 'Description\nrow one'),
    );

    const slot = screen.getByLabelText('Bank workbook (Account 1)').closest('.source-slot');
    await waitFor(() => expect(slot).toHaveTextContent('amount'));
  });

  it('shows no heads-up once every required column is present', async () => {
    const user = userEvent.setup();
    render(<BankGlHarness canonicalFields={REQUIRED_FIELDS} />);

    await user.upload(
      screen.getByLabelText('Bank workbook (Account 1)'),
      makeFile('1111_bank.csv', 'Transaction Date,Amount\n2026-01-01,100'),
    );

    const slot = screen.getByLabelText('Bank workbook (Account 1)').closest('.source-slot');
    await waitFor(() => expect(slot).toHaveTextContent('1111_bank.csv'));
    expect(slot?.querySelector('.source-slot__header-warning')).not.toBeInTheDocument();
  });

  it('shows no heads-up for an XLSX file -- no client-side header reader for it in v1', async () => {
    const user = userEvent.setup();
    render(<BankGlHarness canonicalFields={REQUIRED_FIELDS} />);

    await user.upload(
      screen.getByLabelText('Bank workbook (Account 1)'),
      makeFile('1111_bank.xlsx', 'not real xlsx bytes'),
    );

    const slot = screen.getByLabelText('Bank workbook (Account 1)').closest('.source-slot');
    await waitFor(() => expect(slot).toHaveTextContent('1111_bank.xlsx'));
    expect(slot?.querySelector('.source-slot__header-warning')).not.toBeInTheDocument();
  });

  it('shows no heads-up when canonicalFields has not loaded yet', async () => {
    const user = userEvent.setup();
    render(<BankGlHarness canonicalFields={[]} />);

    await user.upload(
      screen.getByLabelText('Bank workbook (Account 1)'),
      makeFile('1111_bank.csv', 'Description\nrow one'),
    );

    const slot = screen.getByLabelText('Bank workbook (Account 1)').closest('.source-slot');
    await waitFor(() => expect(slot).toHaveTextContent('1111_bank.csv'));
    expect(slot?.querySelector('.source-slot__header-warning')).not.toBeInTheDocument();
  });
});

describe('SourceDropZone (subledger: AP)', () => {
  it('renders one AP entity slot by default', () => {
    render(<ApHarness />);

    expect(screen.getByLabelText('AP workbook (Entity 1)')).toBeInTheDocument();
  });

  it('fills the first empty AP slot in drop order via the merged input', async () => {
    const user = userEvent.setup();
    render(<ApHarness />);

    await user.upload(
      screen.getByLabelText('AP/Billing subledger workbooks'),
      makeFile('E100_ap-export.csv'),
    );

    expect(screen.getByText('E100_ap-export.csv')).toBeInTheDocument();
  });

  it('adds a slot automatically up to the four-entity cap', async () => {
    const user = userEvent.setup();
    render(<ApHarness initialApFiles={[makeFile('E100_ap-export.csv')]} />);

    await user.upload(
      screen.getByLabelText('AP/Billing subledger workbooks'),
      makeFile('E200_ap-export.csv'),
    );

    expect(screen.getByLabelText('AP workbook (Entity 2)')).toBeInTheDocument();
    expect(screen.getByText('E200_ap-export.csv')).toBeInTheDocument();
  });

  it('rejects a fifth AP ledger with a limit-reached message', async () => {
    const user = userEvent.setup();
    render(
      <ApHarness
        initialApFiles={Array.from({ length: MAX_AP_ENTITIES }, (_, index) =>
          makeFile(`E${index}00_ap-export.csv`),
        )}
      />,
    );

    await user.upload(
      screen.getByLabelText('AP/Billing subledger workbooks'),
      makeFile('E999_ap-export.csv'),
    );

    expect(screen.getByText('UPLOAD_AP_ENTITY_LIMIT_REACHED')).toBeInTheDocument();
  });

  it('rejects an AP file whose name has no entity-id delimiter', async () => {
    const user = userEvent.setup();
    render(<ApHarness />);

    await user.upload(
      screen.getByLabelText('AP/Billing subledger workbooks'),
      makeFile('apexportnodelimiter.csv'),
    );

    expect(screen.getByText('UPLOAD_AP_FILENAME_INVALID')).toBeInTheDocument();
  });

  it('parses the entity id from the file name into the slot content', async () => {
    const user = userEvent.setup();
    render(<ApHarness />);

    await user.upload(
      screen.getByLabelText('AP/Billing subledger workbooks'),
      makeFile('E100-AcmeCorp-Subledger.xlsx'),
    );

    expect(screen.getByText('E100-AcmeCorp-Subledger.xlsx')).toBeInTheDocument();
  });

  it('"Add another AP entity ledger" grows a new slot up to the max', async () => {
    const user = userEvent.setup();
    render(<ApHarness />);

    await user.click(screen.getByRole('button', { name: 'Add another AP entity ledger' }));
    await user.click(screen.getByRole('button', { name: 'Add another AP entity ledger' }));
    await user.click(screen.getByRole('button', { name: 'Add another AP entity ledger' }));

    expect(screen.getByLabelText('AP workbook (Entity 4)')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Add another AP entity ledger' }),
    ).not.toBeInTheDocument();
    expect(MAX_AP_ENTITIES).toBe(MAX_BANK_ACCOUNTS);
  });

  it('a manual override via a specific slot input still fills that exact slot', async () => {
    const user = userEvent.setup();
    render(<ApHarness />);

    await user.upload(
      screen.getByLabelText('AP workbook (Entity 1)'),
      makeFile('E100_override.csv'),
    );

    const slotOne = screen.getByLabelText('AP workbook (Entity 1)').closest('.source-slot');
    expect(slotOne).toHaveTextContent('E100_override.csv');
  });

  it('a remove button clears a slot without dropping below the minimum', async () => {
    const user = userEvent.setup();
    render(
      <ApHarness
        initialApFiles={[makeFile('E100_ap-export.csv'), makeFile('E200_ap-export.csv')]}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Remove AP workbook (Entity 2)' }));

    expect(screen.queryByLabelText('AP workbook (Entity 2)')).not.toBeInTheDocument();
    expect(screen.getByLabelText('AP workbook (Entity 1)')).toBeInTheDocument();
  });
});

describe('per-slot file input ignores an empty change event (Issue #291)', () => {
  /** A `change` carrying no files used to pass `null` through to `onBankFileChange`, which took its
   * `file === null` branch and emptied the slot -- silently, with no rejection recorded and nothing
   * rendered but "No file selected". #291 reports exactly that shape, and the silence is what made
   * it undiagnosable for weeks. These pin that the handler now ignores it. */

  it('keeps a file already in the slot when a change event carries no files', async () => {
    const user = userEvent.setup();
    render(<BankGlHarness />);

    await user.upload(
      screen.getByLabelText('Bank workbook (Account 1)'),
      makeFile('1111_bank.csv'),
    );
    expect(screen.getByText('1111_bank.csv')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Bank workbook (Account 1)'), { target: { files: [] } });

    expect(screen.getByText('1111_bank.csv')).toBeInTheDocument();
  });

  it('leaves an empty slot alone rather than re-emptying it', () => {
    render(<BankGlHarness />);
    const slot = screen.getByLabelText('Bank workbook (Account 1)').closest('.source-slot');

    fireEvent.change(screen.getByLabelText('Bank workbook (Account 1)'), { target: { files: [] } });

    expect(slot).toHaveTextContent('Drop statement here');
  });

  it('warns when it ignores one, so the next occurrence leaves a trace', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    render(<BankGlHarness />);

    fireEvent.change(screen.getByLabelText('Bank workbook (Account 1)'), { target: { files: [] } });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('bank-workbook-input');
    expect(warn.mock.calls[0]?.[0]).toContain('#291');
    warn.mockRestore();
  });

  it('still accepts a real file, so the guard has not broken the normal path', async () => {
    const user = userEvent.setup();
    render(<BankGlHarness />);

    await user.upload(
      screen.getByLabelText('Bank workbook (Account 2)'),
      makeFile('2222_bank.csv'),
    );

    expect(screen.getByText('2222_bank.csv')).toBeInTheDocument();
  });
});
