import { type ReactNode, useState } from 'react';

import { errorCategoryDisplayNames } from '@recon/domain';
import { SectionCard } from '@recon/ui';

import { useOpenItemsSchedule } from '../hooks/useOpenItemsSchedule';
import { formatCurrency, formatShortDate } from '../lib/format';

const STATUS_OPTIONS = ['OPEN', 'CLEARED', 'WRITTEN_OFF', 'ADJUSTED', 'VOIDED', 'SUPERSEDED'] as const;

/** Display-only aging bands for this cross-run, cross-account schedule -- deliberately fixed
 * thresholds, not the per-run policy-driven bands `buildAgingBuckets` (packages/core) computes
 * from a single run's `staleOutstandingCheckDays`. This view has no single run's config to key
 * off (it spans every account and period at once), so fixed 0-5/6-30/31-60/61+ bands are the
 * honest simplification -- purely for visual grouping in this table, not a reporting figure. */
const AGING_BUCKETS = [
  { label: '0-5 days', maxDays: 5 },
  { label: '6-30 days', maxDays: 30 },
  { label: '31-60 days', maxDays: 60 },
  { label: '61+ days', maxDays: Infinity },
] as const;

const agingBucketFor = (ageInDays: number): string =>
  (AGING_BUCKETS.find((bucket) => ageInDays <= bucket.maxDays) ?? AGING_BUCKETS.at(-1)!).label;

/**
 * Unreconciled Item Roll-Forward PR F.4: the read-only open-items schedule -- what replaces the
 * spreadsheet support schedule `packages/domain/src/messages.ts` currently tells reviewers to
 * carry by hand ("Carry as an outstanding item on the reconciliation support schedule..."). Owner
 * and due date are always shown as unassigned/not set today: nothing in the app writes to those
 * columns yet (no assignment UI exists), so this view is honest about that rather than implying
 * an editing capability that isn't there.
 */
export function OpenItemsScheduleSection({
  accountIdentifier,
}: Readonly<{ accountIdentifier?: string }>) {
  const [statusFilter, setStatusFilter] = useState<string>('OPEN');
  const { items, isLoading, error } = useOpenItemsSchedule({
    accountId: accountIdentifier,
    status: statusFilter || undefined,
  });

  let content: ReactNode;
  if (error) {
    content = <p role="alert">{error}</p>;
  } else if (isLoading) {
    content = <p>Loading open items…</p>;
  } else if (items.length === 0) {
    content = <p>No open items match this filter.</p>;
  } else {
    content = (
      <div className="table-shell">
        <div className="table-scroll table-scroll--desktop">
          <table>
            <thead>
              <tr>
                <th>Account</th>
                <th>Category</th>
                <th>Check / Reference</th>
                <th>Description</th>
                <th>Original Date</th>
                <th>Age</th>
                <th>Aging Bucket</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Owner</th>
                <th>Due Date</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>{item.accountIdentifier}</td>
                  <td>{errorCategoryDisplayNames[item.category] ?? item.category}</td>
                  <td>{item.checkNumber ?? item.referenceNumber ?? '—'}</td>
                  <td>{item.descriptionSnapshot ?? '—'}</td>
                  <td>{formatShortDate(item.originalTransactionDate)}</td>
                  <td>{item.ageInDays}d</td>
                  <td>{agingBucketFor(item.ageInDays)}</td>
                  <td className="cell-amount">{formatCurrency(item.amount)}</td>
                  <td>{item.status}</td>
                  <td>{item.ownerUsername ?? 'Unassigned'}</td>
                  <td>{item.dueDate ? formatShortDate(item.dueDate) : 'Not set'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <SectionCard
      title="Open Items Schedule"
      description="The reconciling-item support schedule: every carried-forward item, its age, and its disposition, in one browsable list."
    >
      <div className="table-toolbar">
        <label htmlFor="open-items-status-filter">Status</label>
        <select
          id="open-items-status-filter"
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
        >
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
      </div>

      {content}
    </SectionCard>
  );
}
