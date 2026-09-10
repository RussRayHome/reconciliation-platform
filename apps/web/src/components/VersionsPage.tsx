import { useEffect, useState } from 'react';

import { Link } from 'react-router';

import type { MatchingConfigVersion, MatchingConfigVersionStatus } from '@recon/domain';

import { getRuleVersionsRequest } from '../lib/api';
import { routePaths } from '../routes/routePaths';

const STATUS_LABEL: Record<MatchingConfigVersionStatus, string> = {
  DRAFT: 'draft',
  ACTIVE: 'live',
  SUPERSEDED: 'superseded',
  REJECTED: 'rejected',
};

const STATUS_TONE: Record<MatchingConfigVersionStatus, string> = {
  DRAFT: 'approvals__version-pill--draft',
  ACTIVE: 'approvals__version-pill--live',
  SUPERSEDED: 'approvals__version-pill--superseded',
  REJECTED: 'approvals__version-pill--rejected',
};

const describeChange = (version: MatchingConfigVersion): string => {
  const metricIds = Object.keys(version.varianceOverrides);
  if (metricIds.length === 0) {
    return 'No variance overrides';
  }
  return `Variance: ${metricIds.join(', ')}`;
};

/**
 * Read-mostly matching-rule version lineage (RailMenuMods §5), sourced from the same
 * GET /api/rules/versions data the Matching Rules panel already loads. Deliberately scoped down
 * from the full design: no REJECTED state, no "Based on" parent lineage, no locked-v1-default --
 * those need a real lineage data model this pass doesn't build (see the plan's Phase 5 note).
 * Approve/reject actions live on the Approvals page, not here -- this screen only reads.
 */
export function VersionsPage() {
  const [versions, setVersions] = useState<MatchingConfigVersion[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getRuleVersionsRequest()
      .then((data) => {
        if (!cancelled) {
          setVersions(data.history);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : 'Unable to load rule versions.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="approvals">
      <header className="approvals__header">
        <p className="eyebrow">Configure</p>
        <h1 className="approvals__title">Matching Rule Versions</h1>
        <p className="approvals__subcopy">
          Every published and in-progress matching-config version for your organization. Approve
          or reject a pending draft from the{' '}
          <Link to={routePaths.approvalsMatchingRules}>Approvals</Link> queue.
        </p>
      </header>

      {loadError ? (
        <p role="alert" className="approvals__error">
          {loadError}
        </p>
      ) : versions === null ? (
        <p>Loading versions…</p>
      ) : (
        <div className="approvals__card">
          <div className="approvals__version-grid">
            <div className="approvals__version-row approvals__version-row--header">
              <span>Version</span>
              <span>Change</span>
              <span>Owner</span>
              <span>Status</span>
            </div>
            {versions.map((version) => (
              <div className="approvals__version-row" key={version.id}>
                <span className="approvals__row-primary">
                  <span>v{version.versionNumber}</span>
                </span>
                <span className="approvals__row-sub">{describeChange(version)}</span>
                <span>{version.publishedBy ?? version.createdBy}</span>
                <span className={`approvals__version-pill ${STATUS_TONE[version.status]}`}>
                  {STATUS_LABEL[version.status]}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
