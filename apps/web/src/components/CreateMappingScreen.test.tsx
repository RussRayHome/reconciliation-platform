// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

import type { CanonicalField, MappingProfileSaveResult } from '@recon/domain';

import * as api from '../lib/api';
import { CreateMappingScreen } from './CreateMappingScreen';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  globalThis.localStorage?.clear();
});

const AUTHENTICATED_USER_STORAGE_KEY = 'reconciliation-platform:authenticated-user';

const seedSignedInUser = (): void => {
  globalThis.localStorage.setItem(
    AUTHENTICATED_USER_STORAGE_KEY,
    JSON.stringify({ username: 'rray' }),
  );
};

// Kept to one required field so a single auto-matched column on each side (GL and bank) is
// enough to make `readyToSave` true, without needing to drive the full canvas UI.
const CANONICAL_FIELDS: CanonicalField[] = [
  { id: 'amount', type: 'numeric', required: true, note: '' },
];

const csvFile = (name: string, headerLine: string): File =>
  new File([`${headerLine}\nrow1`], name, { type: 'text/csv' });

// N2: this used to navigate to routePaths.mappingProfiles (a Coming Soon page) on success, so a
// successful save looked like it destroyed the user's work -- the fix confirms in place instead.
describe('CreateMappingScreen save confirmation (N2 redirect-trap fix)', () => {
  it('confirms in place with the saved profile name and never navigates away', async () => {
    seedSignedInUser();
    vi.spyOn(api, 'getCanonicalFieldsRequest').mockResolvedValue(CANONICAL_FIELDS);
    // The component discards this result entirely (fire-and-forget confirm-on-success) -- the
    // fixture only needs to satisfy the type, not represent a realistic saved profile.
    const saveSpy = vi
      .spyOn(api, 'saveMappingProfileRequest')
      .mockResolvedValue({} as MappingProfileSaveResult);

    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/mapping/create']}>
        <CreateMappingScreen />
      </MemoryRouter>,
    );

    // `getCanonicalFieldsRequest` being *called* is trivially true from the very first render
    // (before its promise even settles) -- waiting on that gives no real guarantee the resulting
    // `setCanonicalFields` state update has actually landed. If a file is uploaded too early, the
    // canvas's auto-suggestion effect fires with an empty canonical-field list and never re-fires
    // once the schema does load (it depends only on the uploaded columns, not on canonicalFields),
    // permanently losing the mapping. Wait for a real signal that the fetched schema is in state.
    await screen.findByText('GL 0/1');

    await user.upload(screen.getByLabelText('Choose GL file'), csvFile('gl.csv', 'Amount'));
    await user.upload(screen.getByLabelText('Choose bank file'), csvFile('bank.csv', 'Amount'));

    // Auto-suggestion lands a few renders after the upload's own promise resolves (upload ->
    // glCols/bankCols update -> the canvas's edge effect -> its onChange effect -> setMapping in
    // the parent) -- wait for the real coverage signal rather than assuming it's synchronous.
    await screen.findByText('GL 1/1');
    await screen.findByText('Bank 1/1');

    const saveButton = screen.getByRole('button', { name: 'Save mapping profile' });
    // canSave also requires a non-empty profile name -- still disabled until it's typed below.
    expect(saveButton).toBeDisabled();

    await user.type(screen.getByPlaceholderText('e.g. Monthly Bank + GL'), 'My Monthly Mapping');
    await waitFor(() => expect(saveButton).toBeEnabled());
    await user.click(saveButton);

    expect(await screen.findByRole('status')).toHaveTextContent('Saved “My Monthly Mapping”.');
    expect(saveSpy).toHaveBeenCalledTimes(1);
    // The screen the old redirect pointed at -- confirms navigation never fired, not just that
    // *a* status text appeared.
    expect(screen.queryByText(/coming soon/i)).not.toBeInTheDocument();
  });
});
