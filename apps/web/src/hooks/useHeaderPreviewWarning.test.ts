// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { CanonicalField } from '@recon/domain';

import { useHeaderPreviewWarning } from './useHeaderPreviewWarning';

afterEach(cleanup);

const csvFile = (headerLine: string): File => new File([`${headerLine}\nrow1,row2`], 'file.csv');
const xlsxFile = (): File => new File(['not really xlsx bytes'], 'file.xlsx');

const REQUIRED_AMOUNT_FIELD: CanonicalField[] = [
  { id: 'amount', type: 'text', required: true, note: '' },
];

describe('useHeaderPreviewWarning (Issue #250)', () => {
  it('returns null while there is no file', () => {
    const { result } = renderHook(() => useHeaderPreviewWarning(null, REQUIRED_AMOUNT_FIELD));
    expect(result.current).toBeNull();
  });

  it('returns null for an XLSX file -- no client-side header reader for it in v1', async () => {
    const { result } = renderHook(() => useHeaderPreviewWarning(xlsxFile(), REQUIRED_AMOUNT_FIELD));
    // Give any (unexpected) async resolution a tick to settle before asserting the negative.
    await waitFor(() => expect(result.current).toBeNull());
  });

  it('returns null while canonicalFields has not loaded yet', async () => {
    const { result } = renderHook(() => useHeaderPreviewWarning(csvFile('Description'), []));
    await waitFor(() => expect(result.current).toBeNull());
  });

  it('flags a missing required field for a CSV file', async () => {
    const { result } = renderHook(() =>
      useHeaderPreviewWarning(csvFile('Description'), REQUIRED_AMOUNT_FIELD),
    );
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current?.unmatchedRequiredFields).toEqual(REQUIRED_AMOUNT_FIELD);
  });

  it('reports no warning once the required field is present', async () => {
    const { result } = renderHook(() =>
      useHeaderPreviewWarning(csvFile('Amount'), REQUIRED_AMOUNT_FIELD),
    );
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current?.unmatchedRequiredFields).toEqual([]);
  });
});
