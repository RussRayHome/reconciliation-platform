import { useEffect, useState } from 'react';

import { NavLink } from 'react-router';

import type { ApprovableType, ApprovalRow } from '@recon/domain';

import {
  claimApprovalRequest,
  decideApprovalRequest,
  getApprovalsRequest,
  withdrawImportRunRequest,
} from '../lib/api';
import { routePaths } from '../routes/routePaths';
import { SemanticIcon, type SemanticIconName } from './SemanticIcon';

/** N1: one inbox row-group per approvable type family. Matching Rule & Variances covers two
 * `ApprovableType`s (they're both fields on the same versioned matching-config object, not
 * separate entities). `objectPath` is where a row's own title links -- "the object's own screen,
 * not a queue copy" -- and is also where each type's legacy /approvals/* URL now redirects
 * (App.tsx). Only import/matchingRule are live (isLive below), so it's the only pair that ever
 * actually renders a link a user can click. */
const APPROVAL_GROUPS: ReadonlyArray<{
  key: string;
  objectPath: string;
  title: string;
  types: ApprovableType[];
  icon: SemanticIconName;
  tint: 'accent' | 'bank' | 'severity-medium' | 'negative' | 'text-disabled';
  /** True once something in the product actually opens an approval request for this type.
   * mappingProfile/exceptionResolution/reportDistribution have the API/UI plumbing but no
   * creation trigger yet (mapping profiles have no draft concept; exception resolutions and
   * report distribution have no backing entity at all) -- their table says so explicitly instead
   * of rendering the same "nothing pending" a genuinely-empty live queue would. */
  isLive: boolean;
}> = [
  {
    key: 'import',
    objectPath: routePaths.importFilesBank,
    title: 'Imported files',
    // 'reconciliationRun' (File Imports & Validation) merges onto the same table as 'import' --
    // both row types render together here, same pattern as matchingRule+varianceThreshold below.
    types: ['import', 'reconciliationRun'],
    icon: 'upload',
    tint: 'accent',
    isLive: true,
  },
  {
    key: 'mappingProfile',
    // No Mapping Profiles object screen exists yet (N2: it's still ComingSoonPage) -- and since
    // this type is not live, no row can exist to click through anyway.
    objectPath: routePaths.approvals,
    title: 'Mapping Profiles',
    types: ['mappingProfile'],
    icon: 'architecture',
    tint: 'bank',
    isLive: false,
  },
  {
    key: 'matchingRule',
    objectPath: routePaths.mappingRules,
    title: 'Matching Rule & Variances',
    types: ['matchingRule', 'varianceThreshold'],
    icon: 'rule',
    tint: 'severity-medium',
    isLive: true,
  },
  {
    key: 'exceptionResolution',
    objectPath: routePaths.exceptions,
    title: 'Exception Resolutions',
    types: ['exceptionResolution'],
    icon: 'exceptions',
    tint: 'negative',
    isLive: false,
  },
  {
    key: 'reportDistribution',
    objectPath: routePaths.export,
    title: 'Report Distribution',
    types: ['reportDistribution'],
    icon: 'reports',
    tint: 'text-disabled',
    isLive: false,
  },
];

const formatAge = (ageHours: number): string => {
  if (ageHours < 24) {
    return `${ageHours}h`;
  }
  return `${Math.round(ageHours / 24)}d`;
};

/** Versioned types read "Promote v7", never "Approve" (RailMenuMods: approving a versioned
 * object promotes its draft -- the live version keeps running until then). */
const approveLabel = (row: ApprovalRow): string => {
  if (row.type === 'matchingRule' || row.type === 'varianceThreshold') {
    return `Promote ${row.title.replace('Matching config ', '')}`;
  }
  return 'Approve';
};

/** N1: one consolidated Pending approvals inbox, replacing the five per-type routed pages the
 * rail used to link to directly. Always shows the 'pending' tab's rows -- for an approver that's
 * everything awaiting their decision org-wide; for a non-approver, the same endpoint already
 * scopes to their own pending submissions server-side (matching the old default-landing tab's
 * behaviour exactly). Deeper history (approved/rejected/mine) lives on each object's own screen
 * now, not a separate queue with tabs. */
export function PendingApprovalsInbox({
  canApprove,
  isAdmin,
}: Readonly<{ canApprove: boolean; isAdmin: boolean }>) {
  const [rowsByGroup, setRowsByGroup] = useState<Record<string, ApprovalRow[]>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setLoadError(null);
    setSelectedIds(new Set());

    void Promise.all(
      APPROVAL_GROUPS.map((group) =>
        Promise.all(group.types.map((type) => getApprovalsRequest(type, 'pending'))).then(
          (results) => [group.key, results.flat()] as const,
        ),
      ),
    )
      .then((entries) => {
        if (!cancelled) {
          setRowsByGroup(Object.fromEntries(entries));
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : 'Unable to load approvals.');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  const refresh = (): void => setRefreshToken((token) => token + 1);
  const allRows = Object.values(rowsByGroup).flat();

  const handleDecision = (row: ApprovalRow, status: 'APPROVED' | 'REJECTED'): void => {
    setActionError(null);
    void decideApprovalRequest(row.type, row.id, status)
      .then(refresh)
      .catch((error: unknown) => {
        setActionError(error instanceof Error ? error.message : 'Unable to record decision.');
      });
  };

  const handleClaim = (row: ApprovalRow): void => {
    setActionError(null);
    void claimApprovalRequest(row.type, row.id)
      .then(refresh)
      .catch((error: unknown) => {
        setActionError(error instanceof Error ? error.message : 'Unable to claim this approval.');
      });
  };

  const handleWithdraw = (row: ApprovalRow): void => {
    setActionError(null);
    void withdrawImportRunRequest(row.id)
      .then(refresh)
      .catch((error: unknown) => {
        setActionError(error instanceof Error ? error.message : 'Unable to withdraw this submission.');
      });
  };

  const toggleSelected = (id: string): void => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleBulkApprove = (): void => {
    setActionError(null);
    // Each selected row keeps its own type -- a group's first type would be wrong here whenever a
    // group merges more than one ApprovableType onto one table (import+reconciliationRun,
    // matchingRule+varianceThreshold): a selected row of the second type would get decided under
    // the first type's endpoint.
    void Promise.all(
      Array.from(selectedIds).map((id) => {
        const row = allRows.find((candidate) => candidate.id === id);
        return row ? decideApprovalRequest(row.type, id, 'APPROVED') : Promise.resolve();
      }),
    )
      .then(refresh)
      .catch((error: unknown) => {
        setActionError(error instanceof Error ? error.message : 'Unable to complete bulk approve.');
      });
  };

  return (
    <div className="approvals">
      <header className="approvals__header">
        <p className="eyebrow">Review</p>
        <h1 className="approvals__title">Pending approvals</h1>
        <p className="approvals__subcopy">
          {canApprove
            ? 'Items waiting on your decision appear below. Approving a versioned object promotes its draft; the live version keeps running until then.'
            : 'Everything you submitted that is still awaiting a decision. You can withdraw or resubmit -- approving is not yours to do.'}
        </p>
        <div className="approvals__header-actions">
          {canApprove ? (
            <button
              type="button"
              className="secondary-button approvals__pill-button"
              disabled={selectedIds.size === 0}
              onClick={handleBulkApprove}
            >
              Bulk approve
            </button>
          ) : null}
          {isAdmin ? (
            <NavLink to={routePaths.approvalsPolicy} className="approvals__pill-button">
              Approval policy
            </NavLink>
          ) : null}
        </div>
      </header>

      {selectedIds.size > 0 ? (
        <div className="approvals__bulk-bar" role="status">
          <span>{selectedIds.size} selected</span>
          <button type="button" onClick={handleBulkApprove}>
            Approve {selectedIds.size} selected
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => setSelectedIds(new Set())}
          >
            Clear
          </button>
        </div>
      ) : null}

      {actionError ? (
        <p role="alert" className="approvals__error">
          {actionError}
        </p>
      ) : null}

      {loadError ? (
        <p role="alert" className="approvals__error">
          {loadError}
        </p>
      ) : isLoading ? (
        <p>Loading approvals…</p>
      ) : (
        <div className="approvals__tables">
          {APPROVAL_GROUPS.map((group) => (
            <ApprovalTable
              key={group.key}
              title={group.title}
              icon={group.icon}
              tint={group.tint}
              rows={rowsByGroup[group.key] ?? []}
              isLive={group.isLive}
              objectPath={group.objectPath}
              canApprove={canApprove}
              showCheckboxes={canApprove && group.isLive}
              selectedIds={selectedIds}
              onToggleSelected={toggleSelected}
              onApprove={(row) => handleDecision(row, 'APPROVED')}
              onReject={(row) => handleDecision(row, 'REJECTED')}
              onClaim={handleClaim}
              onWithdraw={handleWithdraw}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ApprovalTable({
  title,
  icon,
  tint,
  rows,
  isLive,
  objectPath,
  canApprove,
  showCheckboxes,
  selectedIds,
  onToggleSelected,
  onApprove,
  onReject,
  onClaim,
  onWithdraw,
}: Readonly<{
  title: string;
  icon: SemanticIconName;
  tint: string;
  rows: ApprovalRow[];
  isLive: boolean;
  /** N1: where a row's own title links -- "the object's own screen, not a queue copy." */
  objectPath: string;
  canApprove: boolean;
  showCheckboxes: boolean;
  selectedIds: Set<string>;
  onToggleSelected: (id: string) => void;
  onApprove: (row: ApprovalRow) => void;
  onReject: (row: ApprovalRow) => void;
  onClaim: (row: ApprovalRow) => void;
  onWithdraw: (row: ApprovalRow) => void;
}>) {
  const itemCountLabel = `${rows.length} ${rows.length === 1 ? 'item' : 'items'}`;
  const cardMeta = isLive ? itemCountLabel : 'Coming soon';
  const emptyMessage = isLive
    ? `${title} -- nothing pending`
    : `${title} approvals aren't available yet`;
  const showEmptyRow = !isLive || rows.length === 0;

  return (
    <div className={isLive ? 'approvals__card' : 'approvals__card approvals__card--coming-soon'}>
      <div className="approvals__card-head">
        <span className={`approvals__type-icon approvals__type-icon--${tint}`} aria-hidden="true">
          <SemanticIcon name={icon} />
        </span>
        <span className="approvals__card-title">{title}</span>
        <span className="approvals__card-meta">{cardMeta}</span>
      </div>

      {showEmptyRow ? (
        <div className="approvals__empty-row">
          <span className={`approvals__type-icon approvals__type-icon--${tint}`} aria-hidden="true">
            <SemanticIcon name={icon} />
          </span>
          <span>{emptyMessage}</span>
        </div>
      ) : (
        <div className="approvals__grid">
          <div className="approvals__grid-row approvals__grid-row--header">
            {showCheckboxes ? <span /> : null}
            <span>Item</span>
            <span>Submitter</span>
            <span>Approver</span>
            <span>Age</span>
            <span />
          </div>
          {rows.map((row) => (
            <div className="approvals__grid-row" key={row.id}>
              {showCheckboxes ? (
                <input
                  type="checkbox"
                  aria-label={`Select ${row.title}`}
                  checked={selectedIds.has(row.id)}
                  onChange={() => onToggleSelected(row.id)}
                />
              ) : null}
              <span className="approvals__row-primary">
                <NavLink to={objectPath}>{row.title}</NavLink>
                {row.meta ? <span className="approvals__row-sub">{row.meta}</span> : null}
              </span>
              <span>{row.submitter}</span>
              <span className={row.approver === null ? 'approvals__row-unassigned' : undefined}>
                {row.approver ?? 'Unassigned'}
              </span>
              <span className="approvals__row-age">{formatAge(row.ageHours)}</span>
              <span className="approvals__row-actions">
                <RowActions
                  row={row}
                  canApprove={canApprove}
                  onApprove={onApprove}
                  onReject={onReject}
                  onClaim={onClaim}
                  onWithdraw={onWithdraw}
                />
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** The one action available for a row, by viewer role and row state -- pulled out of
 * ApprovalTable's row markup as its own component (rather than a nested ternary) so each branch
 * reads as its own case. Non-approvers only ever see "Withdraw," and only on their own pending
 * reconciliationRun submissions (README §7 item 7); approvers see claim/reject/approve as before. */
function RowActions({
  row,
  canApprove,
  onApprove,
  onReject,
  onClaim,
  onWithdraw,
}: Readonly<{
  row: ApprovalRow;
  canApprove: boolean;
  onApprove: (row: ApprovalRow) => void;
  onReject: (row: ApprovalRow) => void;
  onClaim: (row: ApprovalRow) => void;
  onWithdraw: (row: ApprovalRow) => void;
}>) {
  if (!canApprove) {
    if (row.type !== 'reconciliationRun' || row.state !== 'PENDING') {
      return null;
    }
    return (
      <button
        type="button"
        className="secondary-button approvals__row-action"
        onClick={() => onWithdraw(row)}
      >
        Withdraw
      </button>
    );
  }

  if (row.approver === null) {
    return (
      <button
        type="button"
        className="secondary-button approvals__row-action"
        onClick={() => onClaim(row)}
      >
        Claim to review
      </button>
    );
  }

  if (row.state !== 'PENDING') {
    return null;
  }

  return (
    <>
      <button type="button" className="secondary-button approvals__row-action" onClick={() => onReject(row)}>
        Reject
      </button>
      <button type="button" className="approvals__row-action" onClick={() => onApprove(row)}>
        {approveLabel(row)}
      </button>
    </>
  );
}

/** N1: a compact approval-state line for the Imported Files screen -- the import/reconciliationRun
 * counterpart to RuleVersionHeader's "Waiting on X" / "Published by X" display already on Matching
 * Rules. Only PENDING and REJECTED are checked; an APPROVED run has nothing special to say here --
 * that's just the normal completed state the rest of the screen already shows. `runId` is the
 * current durable run's id (null when there is none), matched against the org-wide pending/rejected
 * reconciliationRun rows rather than fetched by id directly, since no by-id endpoint exists. */
export function ImportRunApprovalStatus({ runId }: Readonly<{ runId: string | null }>) {
  const [row, setRow] = useState<ApprovalRow | null>(null);

  useEffect(() => {
    if (!runId) {
      setRow(null);
      return undefined;
    }

    let cancelled = false;
    void Promise.all([
      getApprovalsRequest('reconciliationRun', 'pending'),
      getApprovalsRequest('reconciliationRun', 'rejected'),
    ])
      .then(([pending, rejected]) => {
        if (cancelled) return;
        setRow([...pending, ...rejected].find((candidate) => candidate.id === runId) ?? null);
      })
      .catch(() => {
        if (!cancelled) {
          setRow(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [runId]);

  // Explicit membership, not an else-branch off PENDING -- APPROVED/OVERRIDDEN must render
  // nothing here (an approved run has nothing special to say), not fall through to "Rejected by".
  if (!row || (row.state !== 'PENDING' && row.state !== 'REJECTED')) {
    return null;
  }

  return (
    <p
      className={`import-run-approval-status import-run-approval-status--${row.state.toLowerCase()}`}
      role="status"
    >
      {row.state === 'PENDING'
        ? `Pending approval from ${row.approver ?? 'an approver'}`
        : `Rejected by ${row.approver ?? 'an approver'}`}
    </p>
  );
}
