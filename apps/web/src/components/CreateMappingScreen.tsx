import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react';

import { useNavigate } from 'react-router';

import { baseAliases } from '@recon/config';
import type { CanonicalField, MappingProfilePair, TransformKind } from '@recon/domain';

import { getCanonicalFieldsRequest, saveMappingProfileRequest } from '../lib/api';
import { readHeaderOnly, type MappingSourceColumn } from '../lib/csvHeader';
import { suggestMapping } from '../lib/mappingSuggest';
import {
  applyTransform,
  defaultTransformForType,
  TRANSFORM_KINDS,
  TRANSFORM_LABELS,
  validateSampleValue,
} from '../lib/mappingTransforms';
import { routePaths } from '../routes/routePaths';
import { CreateMappingCanvas } from './CreateMappingCanvas';

type UploadSide = 'gl' | 'bank';
type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/** Mirrors App.tsx's session storage key — no shared auth module exists yet to import it from. */
const AUTHENTICATED_USER_STORAGE_KEY = 'reconciliation-platform:authenticated-user';

function getCurrentUsername(): string | null {
  try {
    const raw = globalThis.localStorage?.getItem(AUTHENTICATED_USER_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { username?: unknown };
    return typeof parsed.username === 'string' ? parsed.username : null;
  } catch {
    return null;
  }
}

/** First real step of the reconciliation workflow: map GL and Bank columns onto the canonical schema. */
export function CreateMappingScreen() {
  const navigate = useNavigate();

  const [canonicalFields, setCanonicalFields] = useState<CanonicalField[]>([]);
  const [canonicalFieldsError, setCanonicalFieldsError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getCanonicalFieldsRequest()
      .then((fields) => {
        if (!cancelled) setCanonicalFields(fields);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setCanonicalFieldsError(
            error instanceof Error ? error.message : 'Could not load the canonical schema.',
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const [glCols, setGlCols] = useState<MappingSourceColumn[]>([]);
  const [bankCols, setBankCols] = useState<MappingSourceColumn[]>([]);
  const [glFileName, setGlFileName] = useState<string | null>(null);
  const [bankFileName, setBankFileName] = useState<string | null>(null);
  const [glError, setGlError] = useState<string | null>(null);
  const [bankError, setBankError] = useState<string | null>(null);
  const [glAutoSuggest, setGlAutoSuggest] = useState<Record<string, string>>();
  const [bankAutoSuggest, setBankAutoSuggest] = useState<Record<string, string>>();

  const [mapping, setMapping] = useState<{ gl: MappingProfilePair[]; bank: MappingProfilePair[] }>({
    gl: [],
    bank: [],
  });
  const [glTransforms, setGlTransforms] = useState<Record<string, TransformKind>>({});
  const [bankTransforms, setBankTransforms] = useState<Record<string, TransformKind>>({});

  const handleCanvasChange = useCallback(
    (next: { gl: MappingProfilePair[]; bank: MappingProfilePair[] }) => {
      setMapping(next);
    },
    [],
  );

  const canonicalFieldIds = useMemo(
    () => canonicalFields.map((field) => field.id),
    [canonicalFields],
  );
  const requiredFieldIds = useMemo(
    () => canonicalFields.filter((field) => field.required).map((field) => field.id),
    [canonicalFields],
  );
  const fieldTypeById = useMemo(
    () => Object.fromEntries(canonicalFields.map((field) => [field.id, field.type])),
    [canonicalFields],
  );

  // Newly-connected pairs get a type-appropriate default transform; existing selections
  // (including anything the user picked manually) are never overwritten.
  useEffect(() => {
    setGlTransforms((current) => {
      const next = { ...current };
      let changed = false;
      for (const pair of mapping.gl) {
        if (!(pair.col in next)) {
          next[pair.col] = defaultTransformForType(fieldTypeById[pair.db] ?? 'text');
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [mapping.gl, fieldTypeById]);

  useEffect(() => {
    setBankTransforms((current) => {
      const next = { ...current };
      let changed = false;
      for (const pair of mapping.bank) {
        if (!(pair.col in next)) {
          next[pair.col] = defaultTransformForType(fieldTypeById[pair.db] ?? 'text');
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [mapping.bank, fieldTypeById]);

  const glSampleByColumn = useMemo(
    () => Object.fromEntries(glCols.map((c) => [c.id, c.sample])),
    [glCols],
  );
  const bankSampleByColumn = useMemo(
    () => Object.fromEntries(bankCols.map((c) => [c.id, c.sample])),
    [bankCols],
  );

  const handleFileChange = useCallback(
    (side: UploadSide) => async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      // Reset the input so choosing the same file name again still fires a change event.
      event.target.value = '';
      if (!file) return;

      try {
        const columns = await readHeaderOnly(file);
        const suggested = suggestMapping(
          columns.map((column) => column.id),
          baseAliases,
          canonicalFieldIds,
        );

        if (side === 'gl') {
          setGlError(null);
          setGlFileName(file.name);
          setGlCols(columns);
          setGlAutoSuggest(suggested);
        } else {
          setBankError(null);
          setBankFileName(file.name);
          setBankCols(columns);
          setBankAutoSuggest(suggested);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Could not read that file.';
        if (side === 'gl') {
          setGlError(message);
        } else {
          setBankError(message);
        }
      }
    },
    [canonicalFieldIds],
  );

  const handleGlTransformChange = useCallback((column: string, kind: TransformKind) => {
    setGlTransforms((current) => ({ ...current, [column]: kind }));
  }, []);
  const handleBankTransformChange = useCallback((column: string, kind: TransformKind) => {
    setBankTransforms((current) => ({ ...current, [column]: kind }));
  }, []);

  const glByField = useMemo(
    () => Object.fromEntries(mapping.gl.map((pair) => [pair.db, pair.col])),
    [mapping.gl],
  );
  const bankByField = useMemo(
    () => Object.fromEntries(mapping.bank.map((pair) => [pair.db, pair.col])),
    [mapping.bank],
  );

  const glRequiredDone = requiredFieldIds.filter((id) => glByField[id]).length;
  const bankRequiredDone = requiredFieldIds.filter((id) => bankByField[id]).length;
  const missingFields = requiredFieldIds.filter((id) => !glByField[id] || !bankByField[id]);
  // canonicalFields.length guards against the brief window before the schema has loaded, where
  // requiredFieldIds is empty and missingFields.length === 0 would otherwise look "ready".
  const readyToSave = canonicalFields.length > 0 && missingFields.length === 0;

  const visibleRows = canonicalFields.filter(
    (field) => glByField[field.id] || bankByField[field.id] || field.required,
  );

  const [profileName, setProfileName] = useState('');
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);

  const glPairsWithTransform = useMemo(
    () =>
      mapping.gl.map((pair) => ({
        ...pair,
        transform:
          glTransforms[pair.col] ?? defaultTransformForType(fieldTypeById[pair.db] ?? 'text'),
      })),
    [mapping.gl, glTransforms, fieldTypeById],
  );
  const bankPairsWithTransform = useMemo(
    () =>
      mapping.bank.map((pair) => ({
        ...pair,
        transform:
          bankTransforms[pair.col] ?? defaultTransformForType(fieldTypeById[pair.db] ?? 'text'),
      })),
    [mapping.bank, bankTransforms, fieldTypeById],
  );

  const hasUnsavedWork =
    glCols.length > 0 || bankCols.length > 0 || mapping.gl.length > 0 || mapping.bank.length > 0;

  // Warns on tab close/refresh/typed-URL navigation. In-app navigation can't be blocked the same
  // way without a data router (this app uses plain BrowserRouter, where useBlocker is a no-op) —
  // the back link below covers that case with an explicit confirm instead.
  useEffect(() => {
    if (!hasUnsavedWork || saveState === 'saved') return undefined;
    const handleBeforeUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
    };
    globalThis.addEventListener('beforeunload', handleBeforeUnload);
    return () => globalThis.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedWork, saveState]);

  const handleBack = useCallback(() => {
    if (hasUnsavedWork && saveState !== 'saved') {
      const confirmed = globalThis.confirm(
        'You have unsaved mapping work. Leave this page and discard it?',
      );
      if (!confirmed) return;
    }
    void navigate(-1);
  }, [hasUnsavedWork, saveState, navigate]);

  const handleSave = useCallback(async () => {
    const username = getCurrentUsername();
    if (!username) {
      setSaveState('error');
      setSaveError('Could not determine the signed-in user — please log in again.');
      return;
    }

    setSaveState('saving');
    setSaveError(null);

    try {
      await saveMappingProfileRequest({
        name: profileName.trim(),
        gl: glPairsWithTransform,
        bank: bankPairsWithTransform,
        createdBy: username,
      });
      setSaveState('saved');
      void navigate(routePaths.mappingProfiles);
    } catch (error) {
      setSaveState('error');
      setSaveError(error instanceof Error ? error.message : 'Could not save the mapping profile.');
    }
  }, [profileName, glPairsWithTransform, bankPairsWithTransform, navigate]);

  const canSave = readyToSave && profileName.trim().length > 0 && saveState !== 'saving';

  return (
    <div className="mapping-page">
      <div className="mapping-page__top">
        <button type="button" className="mapping-back-link" onClick={handleBack}>
          ← Mapping
        </button>
        <div className="mapping-page__top-row">
          <div className="mapping-page__title">
            <h1>Create Mapping</h1>
            <span className="mapping-page__explainer">
              Map the General Ledger and Bank statement columns onto the canonical transaction
              schema. Only each file&apos;s header row is read.
            </span>
          </div>
          <div className="mapping-page__actions">
            <label className="mapping-page__name-field">
              <span className="mapping-page__name-label">Profile name</span>
              <input
                type="text"
                className="mapping-page__name-input"
                value={profileName}
                onChange={(event) => setProfileName(event.target.value)}
                placeholder="e.g. Monthly Bank + GL"
              />
            </label>
            <button type="button" className="secondary-button" onClick={handleBack}>
              Cancel
            </button>
            <button
              type="button"
              className="accent-button"
              disabled={!canSave}
              onClick={() => {
                void handleSave();
              }}
            >
              {saveState === 'saving' ? 'Saving…' : 'Save mapping profile'}
            </button>
          </div>
        </div>
        {canonicalFieldsError ? (
          <span className="mapping-upload__error">{canonicalFieldsError}</span>
        ) : null}
        {saveState === 'error' && saveError ? (
          <span className="mapping-upload__error">{saveError}</span>
        ) : null}
      </div>

      <div className="mapping-uploads">
        <div className="mapping-upload mapping-upload--gl">
          <div className="mapping-upload__head">
            <span className="mapping-upload__title">General Ledger file</span>
            <span className="mapping-tag mapping-tag--gl">CSV</span>
          </div>
          <div className="mapping-upload__picker-row">
            <label className="mapping-picker">
              Choose GL file
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={(event) => {
                  void handleFileChange('gl')(event);
                }}
                style={{ display: 'none' }}
              />
            </label>
            <span className="mapping-upload__fname">{glFileName ?? 'No file chosen'}</span>
          </div>
          {glError ? (
            <span className="mapping-upload__error">{glError}</span>
          ) : (
            <span className="mapping-upload__meta">
              {glCols.length > 0
                ? `${glCols.length} columns detected · header row only`
                : 'Header row only is read'}
            </span>
          )}
        </div>
        <div className="mapping-upload mapping-upload--bank">
          <div className="mapping-upload__head">
            <span className="mapping-upload__title">Bank transactions file</span>
            <span className="mapping-tag mapping-tag--bank">CSV</span>
          </div>
          <div className="mapping-upload__picker-row">
            <label className="mapping-picker">
              Choose bank file
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={(event) => {
                  void handleFileChange('bank')(event);
                }}
                style={{ display: 'none' }}
              />
            </label>
            <span className="mapping-upload__fname">{bankFileName ?? 'No file chosen'}</span>
          </div>
          {bankError ? (
            <span className="mapping-upload__error">{bankError}</span>
          ) : (
            <span className="mapping-upload__meta">
              {bankCols.length > 0
                ? `${bankCols.length} columns detected · header row only`
                : 'Header row only is read'}
            </span>
          )}
        </div>
      </div>

      <div className="mapping-coverage">
        <span className="mapping-coverage__label">Required coverage</span>
        <span className="mapping-bar">
          <i
            className={
              requiredFieldIds.length > 0 && glRequiredDone === requiredFieldIds.length
                ? 'mapping-bar__fill mapping-bar__fill--gl-ok'
                : 'mapping-bar__fill'
            }
            style={{
              width: `${Math.round((glRequiredDone / Math.max(1, requiredFieldIds.length)) * 100)}%`,
            }}
          />
        </span>
        <span className="mapping-coverage__count">
          GL {glRequiredDone}/{requiredFieldIds.length}
        </span>
        <span className="mapping-bar">
          <i
            className={
              requiredFieldIds.length > 0 && bankRequiredDone === requiredFieldIds.length
                ? 'mapping-bar__fill mapping-bar__fill--bank-ok'
                : 'mapping-bar__fill'
            }
            style={{
              width: `${Math.round((bankRequiredDone / Math.max(1, requiredFieldIds.length)) * 100)}%`,
            }}
          />
        </span>
        <span className="mapping-coverage__count">
          Bank {bankRequiredDone}/{requiredFieldIds.length}
        </span>
        <span className="mapping-coverage__spacer" />
        <span className="mapping-coverage__hint">
          {missingFields.length
            ? `Needs both sides: ${missingFields.join(', ')}`
            : 'All required fields mapped on both sides — ready to save'}
        </span>
      </div>

      <div className="mapping-legend">
        <span className="mapping-legend__item">
          <span className="mapping-legend__swatch mapping-legend__swatch--gl" />
          GL → database
        </span>
        <span className="mapping-legend__item">
          <span className="mapping-legend__swatch mapping-legend__swatch--bank" />
          Bank → database
        </span>
        <span className="mapping-legend__item">
          <span className="mapping-legend__dot-req" />
          Required, not yet mapped on both sides
        </span>
        <span className="mapping-legend__divider">·</span>
        <span className="mapping-legend__item">
          Drag from a source column&apos;s handle onto a database column. Select a line and press
          Delete to unmap.
        </span>
      </div>

      <div className="mapping-canvas-shell">
        <div className="mapping-canvas-head">
          <div className="mapping-canvas-head__cols">
            <div className="mapping-canvas-head__col">
              <span className="mapping-canvas-head__title">GL file columns</span>
              <span className="mapping-canvas-head__sub">{glFileName ?? 'No file selected'}</span>
            </div>
            <div className="mapping-canvas-head__mid">maps to →</div>
            <div className="mapping-canvas-head__col mapping-canvas-head__col--center">
              <span className="mapping-canvas-head__title">Database columns</span>
              <span className="mapping-canvas-head__sub">canonical_transactions</span>
            </div>
            <div className="mapping-canvas-head__mid">← maps to</div>
            <div className="mapping-canvas-head__col mapping-canvas-head__col--end">
              <span className="mapping-canvas-head__title">Bank file columns</span>
              <span className="mapping-canvas-head__sub">{bankFileName ?? 'No file selected'}</span>
            </div>
          </div>
        </div>
        <div className="mapping-canvas-viewport">
          <CreateMappingCanvas
            glCols={glCols}
            bankCols={bankCols}
            canonicalFields={canonicalFields}
            initialGlMapping={glAutoSuggest}
            initialBankMapping={bankAutoSuggest}
            onChange={handleCanvasChange}
          />
        </div>
      </div>

      <section className="mapping-table-panel">
        <div className="mapping-table-panel__head">
          <h2>Mapped fields</h2>
          <span className="mapping-table-panel__sub">
            {mapping.gl.length} GL · {mapping.bank.length} bank mappings
          </span>
        </div>
        <table className="mapping-table">
          <thead>
            <tr>
              <th>GL column</th>
              <th>GL transform</th>
              <th>Database column</th>
              <th>Bank column</th>
              <th>Bank transform</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((field) => {
              const gl = glByField[field.id];
              const bank = bankByField[field.id];
              const both = Boolean(gl && bank);
              const status = both
                ? 'Both sides'
                : field.required
                  ? 'Incomplete — required'
                  : gl
                    ? 'GL only'
                    : bank
                      ? 'Bank only'
                      : 'Incomplete — required';
              const statusClass = both
                ? 'mapping-table__status'
                : field.required
                  ? 'mapping-table__status mapping-table__status--required'
                  : 'mapping-table__status mapping-table__status--muted';
              return (
                <tr key={field.id}>
                  <td
                    className={
                      gl
                        ? 'mapping-table__col mapping-table__col--gl'
                        : 'mapping-table__col mapping-table__col--empty'
                    }
                  >
                    {gl ?? '—'}
                  </td>
                  <td className="mapping-table__col">
                    {gl ? (
                      <TransformCell
                        columnName={gl}
                        fieldType={field.type}
                        sampleValue={glSampleByColumn[gl] ?? ''}
                        transformKind={glTransforms[gl] ?? defaultTransformForType(field.type)}
                        onChange={handleGlTransformChange}
                      />
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="mapping-table__col mapping-table__col--db">{field.id}</td>
                  <td
                    className={
                      bank
                        ? 'mapping-table__col mapping-table__col--bank'
                        : 'mapping-table__col mapping-table__col--empty'
                    }
                  >
                    {bank ?? '—'}
                  </td>
                  <td className="mapping-table__col">
                    {bank ? (
                      <TransformCell
                        columnName={bank}
                        fieldType={field.type}
                        sampleValue={bankSampleByColumn[bank] ?? ''}
                        transformKind={bankTransforms[bank] ?? defaultTransformForType(field.type)}
                        onChange={handleBankTransformChange}
                      />
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className={statusClass}>{status}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}

/** A transform `<select>` plus its live preview, computed from the mapped column's sample value. */
function TransformCell({
  columnName,
  fieldType,
  sampleValue,
  transformKind,
  onChange,
}: Readonly<{
  columnName: string;
  fieldType: CanonicalField['type'];
  sampleValue: string;
  transformKind: TransformKind;
  onChange: (column: string, kind: TransformKind) => void;
}>) {
  const preview = applyTransform(transformKind, sampleValue);
  const validation = validateSampleValue(fieldType, preview);

  return (
    <div className="mapping-transform-cell">
      <select
        className="mapping-transform-cell__select"
        value={transformKind}
        onChange={(event) => onChange(columnName, event.target.value as TransformKind)}
        aria-label={`Transform for ${columnName}`}
      >
        {TRANSFORM_KINDS.map((kind) => (
          <option key={kind} value={kind}>
            {TRANSFORM_LABELS[kind]}
          </option>
        ))}
      </select>
      {sampleValue ? (
        <span
          className={
            validation.valid
              ? 'mapping-transform-cell__preview'
              : 'mapping-transform-cell__preview mapping-transform-cell__preview--warn'
          }
          title={validation.message}
        >
          {preview || '—'}
        </span>
      ) : null}
    </div>
  );
}
