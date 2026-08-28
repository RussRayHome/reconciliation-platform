// @vitest-environment jsdom

import { type Dispatch, type SetStateAction, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { CanonicalField } from '@recon/domain';

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
  initialBankFiles = [null, null],
  canonicalFields = [],
}: {
  initialBankFiles?: (File | null)[];
  canonicalFields?: CanonicalField[];
}) {
  const [bankFiles, setBankFiles] = useState<(File | null)[]>(initialBankFiles);
  const [glFile, setGlFile] = useState<File | null>(null);
  return (
    <SourceDropZone
      mode="bank-gl"
      bankFiles={bankFiles}
      glFile={glFile}
      setBankFiles={setBankFiles as Dispatch<SetStateAction<(File | null)[]>>}
      setGlFile={setGlFile}
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
      mode="billing"
      apFiles={apFiles}
      setApFiles={setApFiles as Dispatch<SetStateAction<(File | null)[]>>}
      canonicalFields={canonicalFields}
    />
  );
}

describe('SourceDropZone (mode="bank-gl")', () => {
  it('renders a slot per bank account plus one GL slot', () => {
    render(<BankGlHarness />);

    expect(screen.getByLabelText('Bank workbook (Account 1)')).toBeInTheDocument();
    expect(screen.getByLabelText('Bank workbook (Account 2)')).toBeInTheDocument();
    expect(screen.getByLabelText('GL workbook')).toBeInTheDocument();
  });

  it('auto-assigns a bank-named file to the first empty bank slot via the merged input', async () => {
    const user = userEvent.setup();
    render(<BankGlHarness />);

    await user.upload(screen.getByLabelText('Source workbooks'), makeFile('1111_bank-export.csv'));

    expect(screen.getByText('1111_bank-export.csv')).toBeInTheDocument();
  });

  it('auto-assigns a gl-named file to the GL slot via the merged input', async () => {
    const user = userEvent.setup();
    render(<BankGlHarness />);

    await user.upload(screen.getByLabelText('Source workbooks'), makeFile('gl-export.csv'));

    const glSlot = screen.getByLabelText('GL workbook').closest('.source-slot');
    expect(glSlot).toHaveTextContent('gl-export.csv');
  });

  it('rejects a bank file whose name does not start with an account number', async () => {
    const user = userEvent.setup();
    render(<BankGlHarness />);

    await user.upload(screen.getByLabelText('Source workbooks'), makeFile('bank-export.csv'));

    expect(screen.getByText('UPLOAD_BANK_FILENAME_INVALID')).toBeInTheDocument();
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
    expect(screen.queryByRole('button', { name: 'Add another bank statement' })).not.toBeInTheDocument();
  });

  it('a manual override via a specific slot input still fills that exact slot', async () => {
    const user = userEvent.setup();
    render(<BankGlHarness />);

    await user.upload(screen.getByLabelText('Bank workbook (Account 2)'), makeFile('2222_override.csv'));

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

describe('SourceDropZone (mode="billing")', () => {
  it('renders one AP entity slot by default', () => {
    render(<ApHarness />);

    expect(screen.getByLabelText('AP/Billing workbook (Entity 1)')).toBeInTheDocument();
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

    expect(screen.getByLabelText('AP/Billing workbook (Entity 2)')).toBeInTheDocument();
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

    expect(screen.getByLabelText('AP/Billing workbook (Entity 4)')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Add another AP entity ledger' }),
    ).not.toBeInTheDocument();
    expect(MAX_AP_ENTITIES).toBe(MAX_BANK_ACCOUNTS);
  });

  it('a manual override via a specific slot input still fills that exact slot', async () => {
    const user = userEvent.setup();
    render(<ApHarness />);

    await user.upload(
      screen.getByLabelText('AP/Billing workbook (Entity 1)'),
      makeFile('E100_override.csv'),
    );

    const slotOne = screen.getByLabelText('AP/Billing workbook (Entity 1)').closest('.source-slot');
    expect(slotOne).toHaveTextContent('E100_override.csv');
  });

  it('a remove button clears a slot without dropping below the minimum', async () => {
    const user = userEvent.setup();
    render(<ApHarness initialApFiles={[makeFile('E100_ap-export.csv'), makeFile('E200_ap-export.csv')]} />);

    await user.click(screen.getByRole('button', { name: 'Remove AP/Billing workbook (Entity 2)' }));

    expect(screen.queryByLabelText('AP/Billing workbook (Entity 2)')).not.toBeInTheDocument();
    expect(screen.getByLabelText('AP/Billing workbook (Entity 1)')).toBeInTheDocument();
  });
});
