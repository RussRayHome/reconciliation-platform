// @vitest-environment jsdom

import type * as ApiModule from '../lib/api';
import type { MatchingConfigVersion } from '@recon/domain';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

import { VersionsPage } from './VersionsPage';

afterEach(() => {
  cleanup();
});

const mockedApi = vi.hoisted(() => ({
  response: null as { history: MatchingConfigVersion[] } | null,
  error: null as Error | null,
  getRuleVersionsRequest: vi.fn<typeof ApiModule.getRuleVersionsRequest>(),
}));

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof ApiModule>('../lib/api');
  return {
    ...actual,
    getRuleVersionsRequest: mockedApi.getRuleVersionsRequest,
  };
});

const baseVersion = (overrides: Partial<MatchingConfigVersion>): MatchingConfigVersion => ({
  id: 'mcv-1',
  organizationId: 'org-1',
  versionNumber: 1,
  status: 'DRAFT',
  varianceOverrides: {},
  createdBy: 'j.doe',
  createdAt: '2026-08-01T00:00:00.000Z',
  publishedBy: null,
  publishedAt: null,
  effectiveAt: null,
  pendingApprovalOwner: null,
  ...overrides,
});

beforeEach(() => {
  mockedApi.response = null;
  mockedApi.error = null;
  mockedApi.getRuleVersionsRequest.mockReset();
  mockedApi.getRuleVersionsRequest.mockImplementation(() => {
    if (mockedApi.error) return Promise.reject(mockedApi.error);
    return Promise.resolve({
      active: null,
      draft: null,
      history: mockedApi.response?.history ?? [],
      overridesAppliedToEngine: false,
    });
  });
});

const renderPage = () =>
  render(
    <MemoryRouter>
      <VersionsPage />
    </MemoryRouter>,
  );

describe('VersionsPage', () => {
  it('shows a loading message before the fetch resolves', () => {
    mockedApi.getRuleVersionsRequest.mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(screen.getByText('Loading versions…')).toBeTruthy();
  });

  it('surfaces a load error instead of the table', async () => {
    mockedApi.error = new Error('rule versions unavailable');
    renderPage();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('rule versions unavailable');
  });

  it('renders each status tier with its label, and falls back to createdBy when unpublished', async () => {
    mockedApi.response = {
      history: [
        baseVersion({
          id: 'v-draft',
          versionNumber: 3,
          status: 'DRAFT',
          createdBy: 'j.doe',
          publishedBy: null,
        }),
        baseVersion({
          id: 'v-active',
          versionNumber: 2,
          status: 'ACTIVE',
          publishedBy: 'm.ortega',
          varianceOverrides: { amountTolerance: 0.02 },
        }),
        baseVersion({
          id: 'v-superseded',
          versionNumber: 1,
          status: 'SUPERSEDED',
          publishedBy: 'm.ortega',
        }),
      ],
    };
    renderPage();

    expect(await screen.findByText('v3')).toBeTruthy();
    expect(screen.getByText('draft')).toBeTruthy();
    expect(screen.getByText('live')).toBeTruthy();
    expect(screen.getByText('superseded')).toBeTruthy();

    // Draft with no publishedBy falls back to createdBy.
    expect(screen.getByText('j.doe')).toBeTruthy();
    // Active/superseded both published by the same person.
    expect(screen.getAllByText('m.ortega')).toHaveLength(2);
  });

  it('describes variance overrides, or their absence, per version', async () => {
    mockedApi.response = {
      history: [
        baseVersion({ id: 'v-empty', varianceOverrides: {} }),
        baseVersion({
          id: 'v-overrides',
          versionNumber: 2,
          varianceOverrides: { amountTolerance: 0.02, timingDifferenceDays: 5 },
        }),
      ],
    };
    renderPage();

    expect(await screen.findByText('No variance overrides')).toBeTruthy();
    expect(screen.getByText('Variance: amountTolerance, timingDifferenceDays')).toBeTruthy();
  });

  it('links back to the Approvals matching-rules queue', async () => {
    mockedApi.response = { history: [] };
    renderPage();
    await screen.findByText(/Every published and in-progress/);
    const link = screen.getByRole('link', { name: 'Approvals' }) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/approvals/matching-rules');
  });
});
