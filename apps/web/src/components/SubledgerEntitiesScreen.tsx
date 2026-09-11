import { useCallback, useEffect, useState, type FormEvent } from 'react';

import type { SubledgerEntity, SubledgerKind } from '@recon/domain';
import { formatSubledgerEntityLabel } from '@recon/domain';
import { SectionCard } from '@recon/ui';

import {
  listSubledgerEntitiesRequest,
  registerSubledgerEntityRequest,
  updateSubledgerEntityRequest,
} from '../lib/api';

/** Per-registry copy. 5b is "the same shell, receivables-specific columns", so the shell is one
 * component and only the words differ — a second screen would drift from this one the first time
 * either changed. */
const REGISTRY_COPY: Record<
  SubledgerKind,
  { noun: string; title: string; sample: string; note: string }
> = {
  ap: {
    noun: 'AP',
    title: 'AP entities',
    sample: 'E400_ap-payments.csv',
    note: 'Invoices and payments in one file are split by Doc Type.',
  },
  ar: {
    noun: 'AR',
    title: 'AR entities',
    sample: 'E400_ar-invoices.csv',
    note: 'Unpaid invoices flow to the open items schedule rather than exceptions.',
  },
};

/**
 * The AP and AR entity registries (Issue #448, designs 5a/5b), built on the bank account
 * registry's pattern because a subledger entity is the same kind of object: a stable identity a
 * file is attributed to, which outlives any one run.
 *
 * Two rules the screen states rather than merely obeys:
 *
 * **The entity id is immutable once created.** It is what a filename claims, so changing it would
 * silently re-point every file, run and open item already attributed to it. The display name is
 * the mutable half. Enforced in the API by omission, not by a disabled input here.
 *
 * **Deactivate, never delete.** A deactivated entity keeps its history and stops being offered for
 * new assignments. There is no delete affordance anywhere on this screen.
 */
export function SubledgerEntitiesScreen({
  kind,
  canManage,
}: Readonly<{ kind: SubledgerKind; canManage: boolean }>) {
  const copy = REGISTRY_COPY[kind];
  const [entities, setEntities] = useState<SubledgerEntity[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [entityId, setEntityId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [currencyCode, setCurrencyCode] = useState('USD');

  const reload = useCallback(() => {
    setIsLoading(true);
    listSubledgerEntitiesRequest(kind)
      .then((next) => {
        setEntities(next);
        setLoadError(null);
      })
      .catch((error: unknown) => {
        setLoadError(error instanceof Error ? error.message : 'Could not load the registry.');
      })
      .finally(() => setIsLoading(false));
  }, [kind]);

  useEffect(reload, [reload]);

  const handleRegister = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (entityId.trim().length === 0 || displayName.trim().length === 0) {
      setFormError('An entity id and a display name are both required.');
      return;
    }
    setIsSaving(true);
    setFormError(null);
    try {
      await registerSubledgerEntityRequest(kind, {
        entityId: entityId.trim(),
        displayName: displayName.trim(),
        currencyCode: currencyCode.trim() || undefined,
      });
      setEntityId('');
      setDisplayName('');
      reload();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Could not open the entity.');
    } finally {
      setIsSaving(false);
    }
  };

  const setActive = async (entity: SubledgerEntity, isActive: boolean): Promise<void> => {
    try {
      await updateSubledgerEntityRequest(kind, entity.id, { isActive });
      reload();
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Could not update the entity.');
    }
  };

  const activeCount = entities.filter((entity) => entity.isActive).length;

  return (
    <div className="registry-screen">
      <header className="registry-screen__header">
        <div>
          <p className="registry-screen__eyebrow">Configure / {copy.title}</p>
          <h1 className="registry-screen__title">{copy.title}</h1>
          <p className="registry-screen__subtitle">
            File names carry the entity id — they help you pick the right one, they never decide it.
          </p>
        </div>
      </header>

      <div className="registry-screen__body">
        <SectionCard
          title={`Registered ${copy.noun} entities`}
          description={`${activeCount} active · ${entities.length - activeCount} deactivated`}
        >
          {loadError ? (
            <p role="alert" className="registry-screen__error">
              {loadError}
            </p>
          ) : null}

          {isLoading ? (
            <p>Loading the registry…</p>
          ) : entities.length === 0 ? (
            <p className="registry-screen__empty">
              No {copy.noun} entities yet. Open one to start attributing {copy.noun} files to it.
            </p>
          ) : (
            <table className="registry-table">
              <thead>
                <tr>
                  <th scope="col">Entity</th>
                  <th scope="col">Ledger source</th>
                  <th scope="col">Currency</th>
                  <th scope="col">Status</th>
                  {canManage ? <th scope="col">Action</th> : null}
                </tr>
              </thead>
              <tbody>
                {entities.map((entity) => (
                  <tr key={entity.id}>
                    <th scope="row">
                      <span className="registry-table__name">{entity.displayName}</span>
                      <span className="registry-table__id">{entity.entityId}</span>
                    </th>
                    <td>{entity.ledgerSource ?? 'Files (CSV or XLSX)'}</td>
                    <td>{entity.currencyCode}</td>
                    <td>
                      <span className={entity.isActive ? 'badge' : 'badge badge--muted'}>
                        {entity.isActive ? 'Active' : 'Deactivated'}
                      </span>
                    </td>
                    {canManage ? (
                      <td>
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => void setActive(entity, !entity.isActive)}
                        >
                          {entity.isActive ? 'Deactivate' : 'Reactivate'}
                        </button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* Stated on screen, not just enforced in the API. An operator who cannot see why an id
              is fixed will try to change it and read the refusal as a bug. */}
          <p className="registry-screen__rule">
            The entity id is what a file name claims, so it is immutable once any import references
            it — rename the display name instead. Deactivating keeps every file, run and open item
            already attributed to the entity and stops it being offered for new assignments. As with
            bank accounts, there is no delete.
          </p>
          <p className="registry-screen__rule">{copy.note}</p>
        </SectionCard>

        {/* 13c: for a non-admin the panel is REMOVED, not disabled — [OBJECT] rule 27's
            "not available" case. */}
        {canManage ? (
          <SectionCard title={`Open new ${copy.noun} entity`}>
            <form className="registry-form" onSubmit={(event) => void handleRegister(event)}>
              <label htmlFor="subledger-entity-id">Entity id</label>
              <input
                id="subledger-entity-id"
                value={entityId}
                onChange={(event) => setEntityId(event.target.value)}
                placeholder="E400"
              />
              <p className="registry-form__hint">
                Prefixes its files, e.g. {copy.sample}. Cannot change later.
              </p>

              <label htmlFor="subledger-entity-name">Display name</label>
              <input
                id="subledger-entity-name"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="Highlander Services"
              />

              <label htmlFor="subledger-entity-currency">Currency</label>
              <input
                id="subledger-entity-currency"
                value={currencyCode}
                onChange={(event) => setCurrencyCode(event.target.value)}
                maxLength={3}
              />

              {formError ? (
                <p role="alert" className="registry-screen__error">
                  {formError}
                </p>
              ) : null}

              <button type="submit" className="primary-button" disabled={isSaving}>
                {isSaving ? 'Opening…' : 'Open entity'}
              </button>

              {/* Renders the real formatter's output, never a hard-coded string: the point of a
                  preview is that it cannot disagree with what ships. */}
              <div className="registry-form__preview">
                <span className="registry-form__preview-label">Preview</span>
                <span className="registry-form__preview-value">
                  {formatSubledgerEntityLabel({
                    displayName: displayName.trim() || 'Highlander Services',
                    entityId: entityId.trim() || 'E400',
                  } as SubledgerEntity)}
                </span>
                <p className="registry-form__hint">
                  How the entity appears in the New run {copy.noun} tab, exception evidence and the
                  audit workbook.
                </p>
              </div>
            </form>
          </SectionCard>
        ) : null}
      </div>
    </div>
  );
}
