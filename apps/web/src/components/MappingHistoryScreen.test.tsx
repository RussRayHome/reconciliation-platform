// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

import type { MappingProfileDetail, MappingProfileVersion } from '@recon/domain';

import * as api from '../lib/api';
import { diffVersions, MappingHistoryScreen } from './MappingHistoryScreen';
import { routePaths } from '../routes/routePaths';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const version = (
  versionNumber: number,
  columnMapping: Record<string, string>,
): MappingProfileVersion =>
  ({
    id: `v-${versionNumber}`,
    profileId: 'p-bank',
    versionNumber,
    columnMapping,
    transformationRules: [],
    status: 'ACTIVE',
    createdBy: 'm.ortega',
    createdAt: `2026-0${versionNumber}-01T00:00:00.000Z`,
  }) as MappingProfileVersion;

const detailWith = (versions: MappingProfileVersion[]): MappingProfileDetail =>
  ({
    name: 'Truist monthly',
    bank: {
      profile: {
        id: 'p-bank',
        organizationId: 'org-1',
        name: 'Truist monthly',
        sourceType: 'bank',
        status: 'ACTIVE',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      versions,
    },
    gl: null,
  }) as MappingProfileDetail;

const renderScreen = async (versions: MappingProfileVersion[]) => {
  vi.spyOn(api, 'getMappingProfilesRequest').mockResolvedValue(['Truist monthly']);
  vi.spyOn(api, 'getMappingProfileDetailRequest').mockResolvedValue(detailWith(versions));
  render(
    <MemoryRouter initialEntries={[routePaths.mappingHistory]}>
      <MappingHistoryScreen />
    </MemoryRouter>,
  );
  await screen.findByRole('heading', { name: 'Bank' });
};

/**
 * The three kinds of change are kept distinct rather than flattened into "changed". Which kind it
 * was is the only thing that explains why a run's output moved — a newly mapped field adds data a
 * previous run never saw, an unmapped one silently drops it, and a re-point changes its meaning.
 */
describe('diffVersions', () => {
  it('reports a re-pointed column with both ends', () => {
    const changes = diffVersions(
      version(1, { amount: 'Amount' }),
      version(2, { amount: 'Net Amount' }),
    );

    expect(changes).toEqual([{ canonical: 'amount', from: 'Amount', to: 'Net Amount' }]);
  });

  it('reports a newly mapped field with no prior source', () => {
    const changes = diffVersions(version(1, {}), version(2, { checkNumber: 'Check #' }));

    expect(changes).toEqual([{ canonical: 'checkNumber', from: undefined, to: 'Check #' }]);
  });

  it('reports a field that stopped being mapped', () => {
    const changes = diffVersions(version(1, { checkNumber: 'Check #' }), version(2, {}));

    expect(changes).toEqual([{ canonical: 'checkNumber', from: 'Check #', to: undefined }]);
  });

  it('says nothing about columns that did not move', () => {
    const changes = diffVersions(
      version(1, { amount: 'Amount', date: 'Date' }),
      version(2, { amount: 'Amount', date: 'Posting Date' }),
    );

    expect(changes.map((change) => change.canonical)).toEqual(['date']);
  });
});

describe('MappingHistoryScreen (9d, #450)', () => {
  it('describes each change in words rather than showing two blobs to compare', async () => {
    await renderScreen([
      version(2, { amount: 'Net Amount', checkNumber: 'Check #' }),
      version(1, { amount: 'Amount' }),
    ]);

    expect(screen.getByText('v1 → v2')).toBeInTheDocument();
    expect(screen.getByText(/newly mapped to/)).toBeInTheDocument();
    expect(screen.getByText('Net Amount')).toBeInTheDocument();
  });

  // A single version is not an empty history -- it means nothing has changed yet, which is a
  // different and more useful statement than a blank panel.
  it('says nothing has changed yet when there is only one version', async () => {
    await renderScreen([version(1, { amount: 'Amount' })]);

    expect(screen.getByText(/Only one version so far/)).toBeInTheDocument();
    expect(screen.queryByText(/→/)).toBeNull();
  });

  // Transformation rules can change without the column mapping moving, so a version with no
  // column change is real rather than a bug.
  it('says outright when a version changed no columns', async () => {
    await renderScreen([version(2, { amount: 'Amount' }), version(1, { amount: 'Amount' })]);

    expect(screen.getByText('No column mapping changed.')).toBeInTheDocument();
  });

  it('explains an empty registry rather than rendering a blank screen', async () => {
    vi.spyOn(api, 'getMappingProfilesRequest').mockResolvedValue([]);
    render(
      <MemoryRouter initialEntries={[routePaths.mappingHistory]}>
        <MappingHistoryScreen />
      </MemoryRouter>,
    );

    expect(await screen.findByText(/No mapping profiles yet/)).toBeInTheDocument();
  });
});
