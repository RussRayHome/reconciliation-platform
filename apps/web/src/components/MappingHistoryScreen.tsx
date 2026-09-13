import { useEffect, useState } from 'react';

import type { MappingProfileDetail, MappingProfileVersion } from '@recon/domain';

import { getMappingProfileDetailRequest, getMappingProfilesRequest } from '../lib/api';
import { formatShortDate } from '../lib/format';
import { MappingTabs } from './MappingTabs';

/** One change between consecutive versions of one side. */
interface ColumnChange {
  canonical: string;
  from: string | undefined;
  to: string | undefined;
}

/**
 * What changed between two consecutive versions.
 *
 * Three kinds, and they are kept distinct rather than flattened into "changed": a field that was
 * newly mapped, one that stopped being mapped, and one that was re-pointed at a different source
 * column. Collapsing them would lose the only distinction that matters when explaining why a run's
 * output moved.
 */
export const diffVersions = (
  older: MappingProfileVersion,
  newer: MappingProfileVersion,
): ColumnChange[] => {
  const keys = new Set([...Object.keys(older.columnMapping), ...Object.keys(newer.columnMapping)]);

  return [...keys]
    .sort()
    .map((canonical) => ({
      canonical,
      from: older.columnMapping[canonical],
      to: newer.columnMapping[canonical],
    }))
    .filter((change) => change.from !== change.to);
};

/**
 * Screen 9d — a history of mapping profile changes (UI-11, #450).
 *
 * 9c lists the versions; this says what actually changed between them, which is the question
 * anyone arrives with. "Why did last month reconcile differently?" is answered by a re-pointed
 * column, not by a version number.
 *
 * Derived from the same detail call rather than a new endpoint: the versions already carry their
 * column mappings, so the diff is computable client-side and needs no server work.
 */
export function MappingHistoryScreen() {
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
    ? ([detail.bank, detail.gl].filter(Boolean) as NonNullable<MappingProfileDetail['bank']>[])
    : [];

  return (
    <section className="section-card mapping-history">
      <h2>Mapping History</h2>
      <MappingTabs />
      <p className="mapping-profiles__lede">
        What changed between versions, and when. A re-pointed column is the usual reason a
        run&apos;s output moved — this is where that shows.
      </p>

      {error ? (
        <p role="alert" className="mapping-profiles__error">
          {error}
        </p>
      ) : null}

      {names === null ? (
        <p aria-busy="true">Loading…</p>
      ) : names.length === 0 ? (
        <p className="mapping-profiles__empty">No mapping profiles yet, so nothing has changed.</p>
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
            <SideHistory
              key={side.profile.id}
              label={side.profile.sourceType === 'bank' ? 'Bank' : 'General ledger'}
              versions={side.versions}
            />
          ))}
        </>
      )}
    </section>
  );
}

function SideHistory({
  label,
  versions,
}: Readonly<{ label: string; versions: MappingProfileVersion[] }>) {
  // Newest first from the API, so each version is compared against the one after it in the list.
  const steps = versions.slice(0, -1).map((newer, index) => ({
    newer,
    older: versions[index + 1]!,
  }));

  return (
    <section className="mapping-profiles__side">
      <h3>{label}</h3>
      {versions.length <= 1 ? (
        // Not an empty list: one version means nothing has changed yet, which is a different and
        // more useful statement than showing a blank panel.
        <p className="mapping-profiles__side-meta">
          Only one version so far — the original mapping, unchanged since{' '}
          {versions[0] ? formatShortDate(versions[0].createdAt) : 'it was created'}.
        </p>
      ) : (
        <ol className="mapping-history__steps">
          {steps.map(({ older, newer }) => {
            const changes = diffVersions(older, newer);
            return (
              <li key={newer.id}>
                <div className="mapping-versions__head">
                  <strong>
                    v{older.versionNumber} → v{newer.versionNumber}
                  </strong>
                  <span className="mapping-profiles__side-meta">
                    {newer.createdBy} · {formatShortDate(newer.createdAt)}
                  </span>
                </div>
                {changes.length === 0 ? (
                  // A version published with no column change is real -- transformation rules can
                  // change without the mapping moving -- and saying so beats an empty row.
                  <p className="mapping-profiles__side-meta">No column mapping changed.</p>
                ) : (
                  <ul className="mapping-history__changes">
                    {changes.map((change) => (
                      <li key={change.canonical}>
                        <strong>{change.canonical}</strong>{' '}
                        {change.from === undefined ? (
                          <>
                            newly mapped to <em>{change.to}</em>
                          </>
                        ) : change.to === undefined ? (
                          <>
                            no longer mapped (was <em>{change.from}</em>)
                          </>
                        ) : (
                          <>
                            <em>{change.from}</em> → <em>{change.to}</em>
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
