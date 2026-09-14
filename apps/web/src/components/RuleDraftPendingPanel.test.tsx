// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import type { MatchingConfig, MatchingConfigVersion } from '@recon/domain';

import { diffVarianceOverrides } from '../lib/ruleVersionState';
import { RuleDraftPendingPanel } from './RuleDraftPendingPanel';

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

const renderPanel = (
  draft: MatchingConfigVersion,
  active: MatchingConfigVersion | null = version(12, 'ACTIVE', { dateToleranceDays: 3 }),
) =>
  render(
    <RuleDraftPendingPanel
      draft={draft}
      active={active}
      changes={diffVarianceOverrides(draft, active, labelFor)}
    />,
  );

describe('RuleDraftPendingPanel (2b approver sheet, #404)', () => {
  /**
   * The gap this screen closes: the banner claimed the approver was "reviewing draft vN against
   * the active version" while the screen rendered no comparison at all. An approver decided a
   * change they could not see, with only the replay estimate of its consequences below.
   */
  it('states what the draft changes, from and to', () => {
    renderPanel(version(13, 'DRAFT', { dateToleranceDays: 5 }));

    expect(screen.getByRole('term').textContent).toBe('dateToleranceDays');
    expect(screen.getByRole('definition').textContent).toBe('3 → 5');
  });

  it('names the proposer and the reason they recorded', () => {
    renderPanel(version(13, 'DRAFT', { dateToleranceDays: 5 }));

    expect(screen.getByText('m.reyes')).toBeTruthy();
    expect(screen.getByText('widen the payroll window')).toBeTruthy();
  });

  /**
   * Versions created before changeset 0080 have no reason and no truthful way to supply one.
   * Printing an empty quote attributed to the proposer would put words in their mouth inside an
   * audit trail, so the panel says the reason is absent instead.
   */
  it('says a reason is absent rather than rendering an empty quote', () => {
    renderPanel(version(13, 'DRAFT', { dateToleranceDays: 5 }, { draftReason: null }));

    expect(screen.getByText(/No reason was recorded/)).toBeTruthy();
  });

  /**
   * `RuleVersionHeader` above already renders the DRAFT pill and "Waiting on <approver>". Repeating
   * either here put two identical badges on one screen — caught by that component's own test
   * finding two nodes where it expected one. This pins the split: the header says what the version
   * IS and who it waits on, the panel says where it came from and what it does.
   */
  it('does not repeat the status badge or the waiting-on line the header already renders', () => {
    const { container } = renderPanel(
      version(13, 'DRAFT', { dateToleranceDays: 5 }, { pendingApprovalOwner: 'd.okafor' }),
    );

    expect(container.textContent).not.toContain('DRAFT');
    expect(container.textContent).not.toContain('d.okafor');
  });

  /**
   * A metric absent from ACTIVE is a new override, not a change from zero: an unset override falls
   * back to the platform default, and printing "0 → 5" would claim the org had deliberately set
   * zero.
   */
  it('reads a newly set metric as "not set", never as zero', () => {
    renderPanel(version(13, 'DRAFT', { amountTolerance: 0.05 }), version(12, 'ACTIVE', {}));

    expect(screen.getByText('not set')).toBeTruthy();
  });

  it('says so when a draft changes nothing, rather than rendering an empty list', () => {
    renderPanel(version(13, 'DRAFT', {}), version(12, 'ACTIVE', { dateToleranceDays: 3 }));

    expect(screen.getByText('This draft changes no variance settings.')).toBeTruthy();
  });

  /**
   * The approvals inbox owns the decision, where the row carries its claim state and the
   * segregation-of-duty CHECK (changeset 0042) refuses a self-approval. A second decision surface
   * here would present the same decision twice with only one of them able to say who claimed it.
   */
  it('offers no approve or reject control', () => {
    renderPanel(version(13, 'DRAFT', { dateToleranceDays: 5 }));

    const labels = screen
      .queryAllByRole('button')
      .map((button) => (button.textContent ?? '').toLowerCase());
    expect(labels.some((label) => label.includes('approve') || label.includes('reject'))).toBe(
      false,
    );
  });

  /**
   * The estimate below is of a closed period that will never be re-matched. Without this sentence
   * a reader can take it for a projection of the next run, which is the reading ADR-0018's copy
   * tests exist to prevent.
   */
  it('states that the change applies next run onward and re-matches nothing', () => {
    renderPanel(version(13, 'DRAFT', { dateToleranceDays: 5 }));

    expect(screen.getByText(/no closed period is re-matched/i)).toBeTruthy();
  });
});
