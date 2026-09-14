// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import type { MatchingConfig, MatchingConfigVersion } from '@recon/domain';

import { diffVarianceOverrides } from '../lib/ruleVersionState';
import { RuleDraftRejectedPanel } from './RuleDraftRejectedPanel';

afterEach(cleanup);

const version = (
  versionNumber: number,
  status: MatchingConfigVersion['status'],
  overrides: Partial<Record<keyof MatchingConfig, number>> = {},
  extra: Partial<MatchingConfigVersion> = {},
): MatchingConfigVersion =>
  ({
    id: `v-${versionNumber}`,
    organizationId: 'org-1',
    versionNumber,
    status,
    varianceOverrides: overrides,
    createdBy: 'm.reyes',
    createdAt: '2026-04-01T00:00:00.000Z',
    publishedBy: null,
    publishedAt: null,
    effectiveAt: null,
    pendingApprovalOwner: null,
    draftReason: 'widen the payroll window',
    rejectionNote: null,
    rejectedBy: null,
    rejectedAt: null,
    ...extra,
  }) as MatchingConfigVersion;

const labelFor = (metric: keyof MatchingConfig) => String(metric);

describe('diffVarianceOverrides', () => {
  it('reports what the draft proposed against the version in force', () => {
    const changes = diffVarianceOverrides(
      version(13, 'REJECTED', { dateToleranceDays: 5 }),
      version(12, 'ACTIVE', { dateToleranceDays: 3 }),
      labelFor,
    );

    expect(changes).toEqual([
      { metric: 'dateToleranceDays', label: 'dateToleranceDays', from: 3, to: 5 },
    ]);
  });

  /**
   * Walking the union of both sides would report the active version's untouched settings as
   * though the draft had reverted them — a draft that changed one field would appear to have
   * changed every field the org has ever configured.
   */
  it('ignores settings the draft never touched', () => {
    const changes = diffVarianceOverrides(
      version(13, 'REJECTED', { dateToleranceDays: 5 }),
      version(12, 'ACTIVE', { dateToleranceDays: 3, amountTolerance: 0.02 }),
      labelFor,
    );

    expect(changes.map((change) => change.metric)).toEqual(['dateToleranceDays']);
  });

  it('reports a newly set metric with no prior value', () => {
    const changes = diffVarianceOverrides(
      version(13, 'REJECTED', { amountTolerance: 0.05 }),
      version(12, 'ACTIVE', {}),
      labelFor,
    );

    expect(changes[0]?.from).toBeUndefined();
  });
});

describe('RuleDraftRejectedPanel (13e, #451)', () => {
  const rejected = version(
    13,
    'REJECTED',
    { dateToleranceDays: 5 },
    {
      rejectionNote:
        'Widening the date window hides the payroll timing problem instead of fixing it.',
      rejectedBy: 'j.okafor',
      rejectedAt: '2026-04-14T09:00:00.000Z',
    },
  );

  const renderPanel = (
    nextVersionNumber = 16,
    changes = [
      {
        metric: 'dateToleranceDays' as keyof MatchingConfig,
        label: 'Date proximity window',
        from: 3,
        to: 5,
      },
    ],
  ) =>
    render(
      <RuleDraftRejectedPanel
        rejected={rejected}
        active={version(12, 'ACTIVE', { dateToleranceDays: 3 })}
        nextVersionNumber={nextVersionNumber}
        changes={changes}
      />,
    );

  it('names who rejected it and shows the reason verbatim', () => {
    renderPanel();

    expect(screen.getByText('j.okafor')).toBeInTheDocument();
    expect(screen.getByText(/hides the payroll timing problem/)).toBeInTheDocument();
  });

  /**
   * The numbering rule is the point of the screen. A rejected version keeps its number so the
   * audit trail keeps showing what it proposed; reopening takes the next FREE number, which is
   * not necessarily rejected + 1 because later drafts may already hold those.
   */
  it('reopens at the next free number, not at rejected + 1', () => {
    renderPanel(16);

    expect(screen.getByText('v16')).toBeInTheDocument();
    expect(screen.getByText(/never reused/)).toBeInTheDocument();
    expect(screen.getByText(/v14–v15 are already allocated/)).toBeInTheDocument();
  });

  it('does not claim versions are allocated when the next number is simply the following one', () => {
    renderPanel(14);

    expect(screen.queryByText(/already allocated/)).toBeNull();
  });

  // Reopening carries every change forward. Saying so is what stops a rejection costing the editor
  // the work the approver never objected to.
  it('says the untouched changes carry forward when there is more than one', () => {
    renderPanel(16, [
      {
        metric: 'dateToleranceDays' as keyof MatchingConfig,
        label: 'Date proximity window',
        from: 3,
        to: 5,
      },
      {
        metric: 'amountTolerance' as keyof MatchingConfig,
        label: 'Amount tolerance',
        from: 0.01,
        to: 0.02,
      },
    ]);

    expect(screen.getByText(/carries all 2 changes forward/)).toBeInTheDocument();
  });

  it('says nothing about carrying forward when only one thing changed', () => {
    renderPanel();

    expect(screen.queryByText(/carries all/)).toBeNull();
  });

  /**
   * A rejection recorded before the reason became mandatory has none. Printing an empty quote
   * attributed to an approver would fabricate a justification inside an audit trail.
   */
  it('says outright when no reason was recorded rather than showing an empty quote', () => {
    render(
      <RuleDraftRejectedPanel
        rejected={version(13, 'REJECTED', {}, { rejectedBy: 'j.okafor' })}
        active={null}
        nextVersionNumber={14}
        changes={[]}
      />,
    );

    expect(screen.getByText(/No reason was recorded/)).toBeInTheDocument();
    expect(screen.getByText(/one has not been invented here/)).toBeInTheDocument();
  });
});
