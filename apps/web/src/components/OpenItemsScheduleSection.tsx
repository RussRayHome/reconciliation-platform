import { type ReactNode, useState } from 'react';

import { errorCategoryDisplayNames } from '@recon/domain';
import { SectionCard } from '@recon/ui';

import { useAgingThreshold, type AgingThresholdSetting } from '../hooks/useAgingThreshold';
import { useOpenItemsSchedule } from '../hooks/useOpenItemsSchedule';
import { agingBucketLabelFor, buildAgingBuckets, type ReconciliationFrequency } from '../lib/agingBuckets';
import { formatCurrency, formatShortDate } from '../lib/format';

const STATUS_OPTIONS = ['OPEN', 'CLEARED', 'WRITTEN_OFF', 'ADJUSTED', 'VOIDED', 'SUPERSEDED'] as const;

const FREQUENCY_OPTIONS: readonly ReconciliationFrequency[] = ['Monthly', 'Annual'];

/**
 * Unreconciled Item Roll-Forward PR F.4: the read-only open-items schedule -- what replaces the
 * spreadsheet support schedule `packages/domain/src/messages.ts` currently tells reviewers to
 * carry by hand ("Carry as an outstanding item on the reconciliation support schedule..."). Owner
 * and due date are always shown as unassigned/not set today: nothing in the app writes to those
 * columns yet (no assignment UI exists), so this view is honest about that rather than implying
 * an editing capability that isn't there.
 *
 * R1 WP6: the aging bucket column used to use its own fixed 0-5/6-30/31-60/61+ bands, reasoned as
 * a deliberate simplification since this cross-run, cross-account view has no single run's config
 * to key off. That reasoning is superseded now -- the threshold is a page-level, per-user display
 * lens (`useAgingThreshold`) fed into the same `buildAgingBuckets` shape every other aging view in
 * the app uses, so a reviewer picks the policy they're reading the schedule under, and the column
 * header states it. It never rewrites `item.ageInDays` or any stored figure -- only which band an
 * already-computed age is shown to fall into.
 */
export function OpenItemsScheduleSection({
  accountIdentifier,
  username,
}: Readonly<{ accountIdentifier?: string; username: string }>) {
  const [statusFilter, setStatusFilter] = useState<string>('OPEN');
  const { setting: agingSetting, setSetting: setAgingSetting } = useAgingThreshold(username);
  const { items, isLoading, error } = useOpenItemsSchedule({
    accountId: accountIdentifier,
    status: statusFilter || undefined,
  });
  const agingBuckets = buildAgingBuckets(agingSetting.thresholdDays, agingSetting.frequency);

  const updateAgingSetting = (next: Partial<AgingThresholdSetting>): void => {
    setAgingSetting({ ...agingSetting, ...next });
  };

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
                <th>Aging Bucket ({agingSetting.thresholdDays}d)</th>
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
                  <td>{agingBucketLabelFor(agingBuckets, item.ageInDays)}</td>
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
      {/* [SCREEN] 8b interim scope notice. AR unpaid invoices were designed to land here and
          cannot until the AR subledger can be imported -- so an empty schedule reads as "nothing
          is overdue", which is the worst false negative in this product. Stated in the header
          area and visible without interaction, never a tooltip. Wording is approved copy; do not
          reword. Remove this when AR import ships. */}
      <p className="open-items-scope-notice">
        Bank and general ledger activity only. Unpaid AR invoices are not tracked here until the AR
        subledger can be imported — keep using your AR aging report for those. An empty schedule
        means nothing carried forward from bank or GL, not that nothing is overdue.
      </p>

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

        <label htmlFor="open-items-aging-threshold">Aging threshold</label>
        <select
          id="open-items-aging-threshold"
          value={agingSetting.thresholdDays}
          onChange={(event) => updateAgingSetting({ thresholdDays: Number(event.target.value) })}
        >
          {[30, 45, 60, 90, 120].map((days) => (
            <option key={days} value={days}>
              {days} days
            </option>
          ))}
        </select>

        <label htmlFor="open-items-band-cadence">Band cadence</label>
        <select
          id="open-items-band-cadence"
          value={agingSetting.frequency}
          onChange={(event) =>
            updateAgingSetting({ frequency: event.target.value as ReconciliationFrequency })
          }
        >
          {FREQUENCY_OPTIONS.map((frequency) => (
            <option key={frequency} value={frequency}>
              {frequency}
            </option>
          ))}
        </select>
      </div>

      {content}
    </SectionCard>
  );
}
