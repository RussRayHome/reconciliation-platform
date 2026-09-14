import { useEffect, useState } from 'react';

import type { MappingProfileDetail, MappingProfileSideDetail } from '@recon/domain';

import { getMappingProfileDetailRequest, getMappingProfilesRequest } from '../lib/api';
import { formatShortDate } from '../lib/format';
import { MappingTabs } from './MappingTabs';

/**
 * Screen 9c — every version of a mapping profile, both sides (UI-11, #450).
 *
 * 9a shows the profile as it stands now; this shows how it got there. The distinction matters for
 * the reason handoff decision 18 records: **a run keeps the version it matched under, and there is
 * no retro-matching.** So a superseded version is not dead history — it is the mapping a closed
 * period is still explained by, and has to stay readable.
 *
 * Built on the same detail call 9a uses, which already returns the full version list per side.
 */
export function MappingVersionsScreen() {
  const [names, setNames] = useState<string[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<MappingProfileDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

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
  }, []);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    getMappingProfileDetailRequest(selected)
      .then((found) => {
        if (!cancelled) setDetail(found);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : 'Could not load this profile.');
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const sides = detail
    ? [detail.bank, detail.gl].filter((side): side is MappingProfileSideDetail => Boolean(side))
    : [];

  return (
    <section className="section-card mapping-versions">
      <h2>Mapping Profile Versions</h2>
      <MappingTabs />
      <p className="mapping-profiles__lede">
        Every version of a profile, newest first. A run keeps the version it matched under —
        publishing a new one <strong>never re-matches a closed period</strong>, so an older version
        stays the explanation for the runs that used it.
      </p>

      {error ? (
        <p role="alert" className="mapping-profiles__error">
          {error}
        </p>
      ) : null}

      {names === null ? (
        <p aria-busy="true">Loading…</p>
      ) : names.length === 0 ? (
        <p className="mapping-profiles__empty">
          No mapping profiles yet, so there is no version history to show.
        </p>
      ) : (
        <>
          <label className="mapping-versions__picker">
            <span className="visually-hidden">Profile</span>
            <select value={selected ?? ''} onChange={(event) => setSelected(event.target.value)}>
              {names.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>

          {sides.map((side) => (
            <SideVersions key={side.profile.id} side={side} />
          ))}
        </>
      )}
    </section>
  );
}

function SideVersions({ side }: Readonly<{ side: MappingProfileSideDetail }>) {
  return (
    <section className="mapping-profiles__side">
      <h3>{side.profile.sourceType === 'bank' ? 'Bank' : 'General ledger'}</h3>
      {side.versions.length === 0 ? (
        <p className="mapping-profiles__side-meta">No versions recorded.</p>
      ) : (
        <ol className="mapping-versions__list">
          {side.versions.map((version, index) => (
            <li key={version.id}>
              <div className="mapping-versions__head">
                <strong>v{version.versionNumber}</strong>
                {/* Current is positional, not a status flag: the API returns newest first, and
                    MappingProfileVersion.status describes the PROFILE lifecycle, not which version
                    is in force. Reading status here would mark every ACTIVE-profile version
                    "current". */}
                {index === 0 ? <span className="badge">Current</span> : null}
                <span className="mapping-profiles__side-meta">
                  {version.createdBy} · {formatShortDate(version.createdAt)}
                </span>
              </div>
              <dl className="mapping-profiles__columns">
                {Object.entries(version.columnMapping).map(([canonical, source]) => (
                  <div key={canonical}>
                    <dt>{canonical}</dt>
                    <dd>{source}</dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
