import { useEffect, useState } from 'react';

import type { MappingProfileDetail, MappingProfileSideDetail } from '@recon/domain';

import {
  getMappingProfileDetailRequest,
  getMappingProfilesRequest,
  retireMappingProfileRequest,
} from '../lib/api';
import { formatShortDate } from '../lib/format';

/**
 * Screen 9a — the saved mapping profiles registry (UI-11, #450).
 *
 * Master–detail rather than one wide table, because the list endpoint returns **names only**
 * (`GET /api/mapping/profiles`) and the columns worth showing live behind a per-name detail call.
 * Rendering a table would mean one request per row on load; this asks for exactly the profile the
 * operator is looking at.
 *
 * A profile has two sides, bank and GL, each with its own version history — they are versioned
 * independently, so the screen shows them separately rather than implying one version number
 * covers both.
 */
export function MappingProfilesScreen({
  canManage,
}: Readonly<{
  /** Retiring is a mutation on org-wide configuration; a reader does not get the control at all. */
  canManage: boolean;
}>) {
  const [names, setNames] = useState<string[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<MappingProfileDetail | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getMappingProfilesRequest()
      .then((found) => {
        if (cancelled) return;
        setNames(found);
        setSelected((current) => current ?? found[0] ?? null);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setNames([]);
        setError(caught instanceof Error ? caught.message : 'Could not load mapping profiles.');
      });
    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setIsLoadingDetail(true);
    getMappingProfileDetailRequest(selected)
      .then((found) => {
        if (!cancelled) setDetail(found);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setDetail(null);
        setError(caught instanceof Error ? caught.message : 'Could not load this profile.');
      })
      .finally(() => {
        if (!cancelled) setIsLoadingDetail(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected, refreshToken]);

  const retire = (name: string): void => {
    setError(null);
    void retireMappingProfileRequest(name)
      .then(() => setRefreshToken((token) => token + 1))
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : 'Could not retire this profile.');
      });
  };

  if (names === null) {
    return (
      <section className="section-card" aria-busy="true">
        <h2>Mapping Profiles</h2>
        <p>Loading mapping profiles…</p>
      </section>
    );
  }

  return (
    <section className="section-card mapping-profiles">
      <header className="mapping-profiles__header">
        <h2>Mapping Profiles</h2>
        <p className="mapping-profiles__lede">
          Saved column mappings, one per named profile. A profile is{' '}
          <strong>retired, never deleted</strong> — every run already mapped under it keeps its
          mapping, and a retired profile simply stops being offered for new imports.
        </p>
      </header>

      {error ? (
        <p role="alert" className="mapping-profiles__error">
          {error}
        </p>
      ) : null}

      {names.length === 0 ? (
        <p className="mapping-profiles__empty">
          No mapping profiles yet. One is created the first time a file&apos;s columns are mapped on
          the mapping canvas.
        </p>
      ) : (
        <div className="mapping-profiles__body">
          <nav className="mapping-profiles__list" aria-label="Saved mapping profiles">
            <ul>
              {names.map((name) => (
                <li key={name}>
                  <button
                    type="button"
                    className={
                      name === selected
                        ? 'mapping-profiles__item mapping-profiles__item--active'
                        : 'mapping-profiles__item'
                    }
                    aria-current={name === selected ? 'true' : undefined}
                    onClick={() => setSelected(name)}
                  >
                    {name}
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          <div className="mapping-profiles__detail">
            {isLoadingDetail ? (
              <p aria-busy="true">Loading {selected}…</p>
            ) : detail ? (
              <ProfileDetail detail={detail} canManage={canManage} onRetire={retire} />
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}

function ProfileDetail({
  detail,
  canManage,
  onRetire,
}: Readonly<{
  detail: MappingProfileDetail;
  canManage: boolean;
  onRetire: (name: string) => void;
}>) {
  // Both sides retired means the profile is retired; one side still active means it is still in
  // use for that source, so the control stays.
  const sides = [detail.bank, detail.gl].filter((side): side is MappingProfileSideDetail =>
    Boolean(side),
  );
  const isRetired = sides.length > 0 && sides.every((side) => side.profile.status === 'DEPRECATED');

  return (
    <>
      <div className="mapping-profiles__detail-head">
        <h3>{detail.name}</h3>
        {canManage && !isRetired ? (
          <button
            type="button"
            className="secondary-button button-small"
            onClick={() => onRetire(detail.name)}
          >
            Retire profile
          </button>
        ) : null}
        {isRetired ? <span className="badge">Retired</span> : null}
      </div>

      {sides.length === 0 ? (
        <p>This profile has no mapped sides yet.</p>
      ) : (
        sides.map((side) => <ProfileSide key={side.profile.id} side={side} />)
      )}
    </>
  );
}

/**
 * One side of a profile. Bank and GL are versioned independently, so each carries its own current
 * version — showing a single number for the pair would claim a shared lineage they do not have.
 */
function ProfileSide({ side }: Readonly<{ side: MappingProfileSideDetail }>) {
  const current = side.versions[0];
  const columns = current ? Object.entries(current.columnMapping) : [];

  return (
    <section className="mapping-profiles__side">
      <h4>
        {side.profile.sourceType === 'bank' ? 'Bank' : 'General ledger'}
        {current ? <span className="badge">v{current.versionNumber}</span> : null}
        {side.profile.status === 'DEPRECATED' ? <span className="badge">Retired</span> : null}
      </h4>
      <p className="mapping-profiles__side-meta">
        {side.versions.length} {side.versions.length === 1 ? 'version' : 'versions'} · created{' '}
        {formatShortDate(side.profile.createdAt)}
        {current ? ` · v${current.versionNumber} by ${current.createdBy}` : ''}
      </p>

      {columns.length === 0 ? (
        <p className="mapping-profiles__side-meta">No column mapping recorded on this version.</p>
      ) : (
        <dl className="mapping-profiles__columns">
          {columns.map(([canonical, source]) => (
            <div key={canonical}>
              <dt>{canonical}</dt>
              {/* Source column verbatim: this is what the operator's file actually says, and
                  prettifying it would break the only link back to their spreadsheet. */}
              <dd>{source}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
