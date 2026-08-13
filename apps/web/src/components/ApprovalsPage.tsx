import { useEffect, useState } from 'react';

import { NavLink, useLocation, useSearchParams } from 'react-router';

import type { ApprovableType, ApprovalRow } from '@recon/domain';

import {
  claimApprovalRequest,
  decideApprovalRequest,
  getApprovalsRequest,
  type ApprovalTab,
} from '../lib/api';
import { routePaths } from '../routes/routePaths';
import { SemanticIcon, type SemanticIconName } from './SemanticIcon';

/** One rail submenu = one approvals table. Matching Rule & Variances covers two `ApprovableType`s
 * (they're both fields on the same versioned matching-config object, not separate entities). */
const APPROVAL_GROUPS: ReadonlyArray<{
  key: string;
  path: string;
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
    path: routePaths.approvalsImports,
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
    path: routePaths.approvalsMappingProfiles,
    title: 'Mapping Profiles',
    types: ['mappingProfile'],
    icon: 'architecture',
    tint: 'bank',
    isLive: false,
  },
  {
    key: 'matchingRule',
    path: routePaths.approvalsMatchingRules,
    title: 'Matching Rule & Variances',
    types: ['matchingRule', 'varianceThreshold'],
    icon: 'rule',
    tint: 'severity-medium',
    isLive: true,
  },
  {
    key: 'exceptionResolution',
    path: routePaths.approvalsExceptionResolutions,
    title: 'Exception Resolutions',
    types: ['exceptionResolution'],
    icon: 'exceptions',
    tint: 'negative',
    isLive: false,
  },
  {
    key: 'reportDistribution',
    path: routePaths.approvalsReportDistribution,
    title: 'Report Distribution',
    types: ['reportDistribution'],
    icon: 'reports',
    tint: 'text-disabled',
    isLive: false,
  },
];

const groupForPathname = (pathname: string): (typeof APPROVAL_GROUPS)[number] =>
  APPROVAL_GROUPS.find((group) => group.path === pathname) ?? APPROVAL_GROUPS[0]!;

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

/** One rail submenu's approvals table -- reached by clicking Imported files / Mapping Profiles /
 * Matching Rule & Variances / Exception Resolutions / Report Distribution under the collapsible
 * Approvals rail section. The type shown is derived from the route, not passed as a prop. */
export function ApprovalsPage({
  canApprove,
  isAdmin,
}: Readonly<{ canApprove: boolean; isAdmin: boolean }>) {
  const location = useLocation();
  const group = groupForPathname(location.pathname);
  const [searchParams] = useSearchParams();
  const activeTab = (searchParams.get('tab') as ApprovalTab | null) ?? 'pending';

  const [rows, setRows] = useState<ApprovalRow[]>([]);
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

    void Promise.all(group.types.map((type) => getApprovalsRequest(type, activeTab)))
      .then((results) => {
        if (!cancelled) {
          setRows(results.flat());
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
  }, [group.key, group.types, activeTab, refreshToken]);

  const refresh = (): void => setRefreshToken((token) => token + 1);

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
    // Each selected row keeps its own type -- group.types[0] would be wrong here whenever a group
    // merges more than one ApprovableType onto one table (import+reconciliationRun,
    // matchingRule+varianceThreshold): a selected row of the second type would get decided under
    // the first type's endpoint.
    void Promise.all(
      Array.from(selectedIds).map((id) => {
        const row = rows.find((candidate) => candidate.id === id);
        return row ? decideApprovalRequest(row.type, id, 'APPROVED') : Promise.resolve();
      }),
    )
      .then(refresh)
      .catch((error: unknown) => {
        setActionError(error instanceof Error ? error.message : 'Unable to complete bulk approve.');
      });
  };

  const tabs: Array<{ tab: ApprovalTab; label: string }> = canApprove
    ? [
        { tab: 'pending', label: 'Pending' },
        { tab: 'approved', label: 'Approved' },
        { tab: 'rejected', label: 'Rejected' },
        { tab: 'mine', label: 'My submissions' },
      ]
    : [
        { tab: 'pending', label: 'Submitted' },
        { tab: 'approved', label: 'Approved' },
        { tab: 'rejected', label: 'Rejected' },
      ];

  const showCheckboxes = canApprove && group.isLive && activeTab === 'pending';

  return (
    <div className="approvals">
      <header className="approvals__header">
        <p className="eyebrow">Review</p>
        <h1 className="approvals__title">{group.title}</h1>
        <p className="approvals__subcopy">
          {canApprove
            ? 'Items waiting on your decision appear below. Approving a versioned object promotes its draft; the live version keeps running until then.'
            : 'Everything you submitted, and where it stands. You can withdraw or resubmit -- approving is not yours to do.'}
        </p>
        <div className="approvals__header-actions">
          {canApprove && activeTab === 'pending' ? (
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

      <nav className="approvals__tabs" aria-label="Approval status">
        {tabs.map(({ tab, label }) => (
          <NavLink
            key={tab}
            to={tab === 'pending' ? group.path : `${group.path}?tab=${tab}`}
            className={
              activeTab === tab ? 'approvals__tab approvals__tab--active' : 'approvals__tab'
            }
          >
            {label}
            {tab === activeTab && !isLoading ? (
              <span className="approvals__tab-count">{rows.length}</span>
            ) : null}
          </NavLink>
        ))}
      </nav>

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
          <ApprovalTable
            title={group.title}
            icon={group.icon}
            tint={group.tint}
            rows={rows}
            isLive={group.isLive}
            canApprove={canApprove}
            showCheckboxes={showCheckboxes}
            selectedIds={selectedIds}
            onToggleSelected={toggleSelected}
            onApprove={(row) => handleDecision(row, 'APPROVED')}
            onReject={(row) => handleDecision(row, 'REJECTED')}
            onClaim={handleClaim}
          />
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
  canApprove,
  showCheckboxes,
  selectedIds,
  onToggleSelected,
  onApprove,
  onReject,
  onClaim,
}: Readonly<{
  title: string;
  icon: SemanticIconName;
  tint: string;
  rows: ApprovalRow[];
  isLive: boolean;
  canApprove: boolean;
  showCheckboxes: boolean;
  selectedIds: Set<string>;
  onToggleSelected: (id: string) => void;
  onApprove: (row: ApprovalRow) => void;
  onReject: (row: ApprovalRow) => void;
  onClaim: (row: ApprovalRow) => void;
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
                <span>{row.title}</span>
                {row.meta ? <span className="approvals__row-sub">{row.meta}</span> : null}
              </span>
              <span>{row.submitter}</span>
              <span className={row.approver === null ? 'approvals__row-unassigned' : undefined}>
                {row.approver ?? 'Unassigned'}
              </span>
              <span className="approvals__row-age">{formatAge(row.ageHours)}</span>
              <span className="approvals__row-actions">
                {!canApprove ? null : row.approver === null ? (
                  <button
                    type="button"
                    className="secondary-button approvals__row-action"
                    onClick={() => onClaim(row)}
                  >
                    Claim to review
                  </button>
                ) : row.state === 'PENDING' ? (
                  <>
                    <button
                      type="button"
                      className="secondary-button approvals__row-action"
                      onClick={() => onReject(row)}
                    >
                      Reject
                    </button>
                    <button
                      type="button"
                      className="approvals__row-action"
                      onClick={() => onApprove(row)}
                    >
                      {approveLabel(row)}
                    </button>
                  </>
                ) : null}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
