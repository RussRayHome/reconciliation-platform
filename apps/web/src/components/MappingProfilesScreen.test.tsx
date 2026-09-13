// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { MappingProfileDetail } from '@recon/domain';

import * as api from '../lib/api';
import { MappingProfilesScreen } from './MappingProfilesScreen';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const side = (
  sourceType: 'bank' | 'gl',
  over: { status?: 'ACTIVE' | 'DEPRECATED'; versionNumber?: number } = {},
) =>
  ({
    profile: {
      id: `p-${sourceType}`,
      organizationId: 'org-1',
      name: 'Truist monthly',
      sourceType,
      status: over.status ?? 'ACTIVE',
      createdAt: '2026-01-04T00:00:00.000Z',
    },
    versions: [
      {
        id: `v-${sourceType}`,
        profileId: `p-${sourceType}`,
        versionNumber: over.versionNumber ?? 3,
        // Each side gets its own source headers -- a bank statement and a GL export never share
        // column names, and a fixture that pretends otherwise hides which side a value came from.
        columnMapping:
          sourceType === 'bank'
            ? { transactionDate: 'Posting Date', amount: 'Amount' }
            : { transactionDate: 'Txn Date', amount: 'Debit/Credit' },
        transformationRules: [],
        status: 'ACTIVE',
        createdBy: 'm.ortega',
        createdAt: '2026-02-01T00:00:00.000Z',
      },
    ],
  }) as MappingProfileDetail['bank'];

const detail = (over: Partial<MappingProfileDetail> = {}): MappingProfileDetail => ({
  name: 'Truist monthly',
  bank: side('bank'),
  gl: side('gl', { versionNumber: 1 }),
  ...over,
});

const renderScreen = async (
  names: string[],
  found: MappingProfileDetail | null = detail(),
  canManage = true,
) => {
  vi.spyOn(api, 'getMappingProfilesRequest').mockResolvedValue(names);
  if (found) {
    vi.spyOn(api, 'getMappingProfileDetailRequest').mockResolvedValue(found);
  }
  render(<MappingProfilesScreen canManage={canManage} />);
  if (names.length > 0) await screen.findByRole('heading', { name: names[0]! });
};

describe('MappingProfilesScreen (9a, #450)', () => {
  it('lists saved profiles and opens the first one without being asked', async () => {
    await renderScreen(['Truist monthly', 'Amex corporate']);

    expect(screen.getByRole('button', { name: 'Amex corporate' })).toBeInTheDocument();
    // A registry that opens empty makes the operator click before it tells them anything.
    expect(api.getMappingProfileDetailRequest).toHaveBeenCalledWith('Truist monthly');
  });

  // Bank and GL are versioned independently. One number for the pair would claim a shared lineage
  // they do not have, and would be wrong the moment one side is re-mapped.
  it('shows each side with its own version rather than one number for the pair', async () => {
    await renderScreen(['Truist monthly']);

    expect(screen.getByRole('heading', { name: /Bank/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /General ledger/ })).toBeInTheDocument();
    expect(screen.getByText('v3')).toBeInTheDocument();
    expect(screen.getByText('v1')).toBeInTheDocument();
  });

  it('shows each side its own source columns, verbatim', async () => {
    await renderScreen(['Truist monthly']);

    // Scoped per side deliberately: the canonical key is the SAME on both (transactionDate), and
    // only the source header differs. An unscoped assertion would pass while the screen showed the
    // GL headers under the Bank heading -- exactly the mix-up this screen exists to prevent.
    const bank = screen.getByRole('heading', { name: /Bank/ }).closest('section')!;
    const gl = screen.getByRole('heading', { name: /General ledger/ }).closest('section')!;

    // The operator's own spreadsheet header is the only link back to their file.
    expect(within(bank).getByText('Posting Date')).toBeInTheDocument();
    expect(within(gl).getByText('Txn Date')).toBeInTheDocument();
    expect(within(bank).queryByText('Txn Date')).toBeNull();
  });

  it('loads the profile the operator picks', async () => {
    const user = userEvent.setup();
    await renderScreen(['Truist monthly', 'Amex corporate']);

    await user.click(screen.getByRole('button', { name: 'Amex corporate' }));

    await waitFor(() => {
      expect(api.getMappingProfileDetailRequest).toHaveBeenCalledWith('Amex corporate');
    });
  });

  // Retired, never deleted -- the same rule bank accounts and saved views follow. A retired
  // profile keeps every run already mapped under it.
  it('offers Retire and states the rule on screen, not just in the API', async () => {
    await renderScreen(['Truist monthly']);

    expect(screen.getByRole('button', { name: 'Retire profile' })).toBeInTheDocument();
    expect(screen.getByText(/retired, never deleted/i)).toBeInTheDocument();
    expect(
      screen.getAllByRole('button').filter((b) => /delete|remove/i.test(b.textContent ?? '')),
    ).toEqual([]);
  });

  it('stops offering Retire once both sides are retired', async () => {
    await renderScreen([
      'Truist monthly',
    ], detail({ bank: side('bank', { status: 'DEPRECATED' }), gl: side('gl', { status: 'DEPRECATED' }) }));

    expect(screen.queryByRole('button', { name: 'Retire profile' })).toBeNull();
    expect(screen.getAllByText('Retired').length).toBeGreaterThan(0);
  });

  // One side still active means the profile is still in use for that source.
  it('keeps Retire available while one side is still active', async () => {
    await renderScreen(['Truist monthly'], detail({ bank: side('bank', { status: 'DEPRECATED' }) }));

    expect(screen.getByRole('button', { name: 'Retire profile' })).toBeInTheDocument();
  });

  // [OBJECT] rule 27's "not available" case: a reader cannot retire by any sequence of actions, so
  // the control is removed rather than rendered disabled.
  it('removes the retire control for a reader', async () => {
    await renderScreen(['Truist monthly'], detail(), false);

    expect(screen.queryByRole('button', { name: 'Retire profile' })).toBeNull();
    // The registry itself still reads.
    expect(screen.getByRole('heading', { name: 'Truist monthly' })).toBeInTheDocument();
  });

  it('explains an empty registry rather than showing an empty frame', async () => {
    await renderScreen([]);

    expect(await screen.findByText(/No mapping profiles yet/)).toBeInTheDocument();
  });

  it('surfaces a load failure instead of rendering as empty', async () => {
    vi.spyOn(api, 'getMappingProfilesRequest').mockRejectedValue(new Error('database unavailable'));
    render(<MappingProfilesScreen canManage />);

    expect(await screen.findByRole('alert')).toHaveTextContent('database unavailable');
  });
});
