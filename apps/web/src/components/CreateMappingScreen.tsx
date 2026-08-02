import { useCallback, useMemo, useState } from 'react';

import { useNavigate } from 'react-router-dom';

import type { CanonicalField, MappingProfilePair } from '@recon/domain';

import { CreateMappingCanvas, type MappingSourceColumn } from './CreateMappingCanvas';

/**
 * TEMPORARY fixture standing in for `GET /api/mapping/canonical-fields` (added in the
 * Persistence phase). Field set mirrors `BusinessField` so profiles built here already target
 * the reconciliation engine's real canonical vocabulary — not a separate, disconnected schema.
 */
const CANONICAL_FIELDS_FIXTURE: CanonicalField[] = [
  { id: 'transactionDate', type: 'date', required: true, note: 'Posting or transaction date' },
  { id: 'description', type: 'text', required: true, note: 'Narrative or memo' },
  { id: 'amount', type: 'numeric', required: true, note: 'Signed transaction amount' },
  { id: 'accountIdentifier', type: 'text', required: true, note: 'Account key on both sides' },
  { id: 'postingDate', type: 'date', required: false, note: 'Bank posting date, if distinct' },
  { id: 'transactionType', type: 'text', required: false, note: 'Instrument or channel' },
  { id: 'checkNumber', type: 'text', required: false, note: 'Check number, if applicable' },
  { id: 'serialNumber', type: 'text', required: false, note: 'Serial number, if applicable' },
  { id: 'referenceNumber', type: 'text', required: false, note: 'Document or bank reference' },
  { id: 'merchantName', type: 'text', required: false, note: 'Merchant name, if available' },
  { id: 'payeeName', type: 'text', required: false, note: 'Payee name, if available' },
  { id: 'splitAmount', type: 'numeric', required: false, note: 'Line-level split amount' },
  { id: 'debit', type: 'numeric', required: false, note: 'Debit column, if split from credit' },
  { id: 'credit', type: 'numeric', required: false, note: 'Credit column, if split from debit' },
  { id: 'runningBalance', type: 'numeric', required: false, note: 'Balance after the entry' },
];

const GL_SAMPLE_FIXTURE: MappingSourceColumn[] = [
  { id: 'JE Date', sample: '2026-07-14' },
  { id: 'Account Code', sample: '1010-000' },
  { id: 'Memo', sample: 'Payroll funding — July' },
  { id: 'Debit Amount', sample: '1,250.00' },
  { id: 'Doc Number', sample: 'JE-2026-0714-08' },
];

const BANK_SAMPLE_FIXTURE: MappingSourceColumn[] = [
  { id: 'Post Date', sample: '07/14/2026' },
  { id: 'Description', sample: 'ACH CREDIT — NORTHWIND PAYROLL' },
  { id: 'Debit', sample: '1,250.00' },
  { id: 'Balance', sample: '84,102.66' },
  { id: 'Reference', sample: 'CHK-889201' },
];

const REQUIRED_FIELD_IDS = CANONICAL_FIELDS_FIXTURE.filter((field) => field.required).map((field) => field.id);

/** First real step of the reconciliation workflow: map GL and Bank columns onto the canonical schema. */
export function CreateMappingScreen() {
  const navigate = useNavigate();
  const [glCols] = useState<MappingSourceColumn[]>(GL_SAMPLE_FIXTURE);
  const [bankCols] = useState<MappingSourceColumn[]>(BANK_SAMPLE_FIXTURE);
  const [mapping, setMapping] = useState<{ gl: MappingProfilePair[]; bank: MappingProfilePair[] }>({
    gl: [],
    bank: [],
  });

  const handleCanvasChange = useCallback(
    (next: { gl: MappingProfilePair[]; bank: MappingProfilePair[] }) => {
      setMapping(next);
    },
    [],
  );

  const glByField = useMemo(
    () => Object.fromEntries(mapping.gl.map((pair) => [pair.db, pair.col])),
    [mapping.gl],
  );
  const bankByField = useMemo(
    () => Object.fromEntries(mapping.bank.map((pair) => [pair.db, pair.col])),
    [mapping.bank],
  );

  const glRequiredDone = REQUIRED_FIELD_IDS.filter((id) => glByField[id]).length;
  const bankRequiredDone = REQUIRED_FIELD_IDS.filter((id) => bankByField[id]).length;
  const missingFields = REQUIRED_FIELD_IDS.filter((id) => !glByField[id] || !bankByField[id]);
  const readyToSave = missingFields.length === 0;

  const visibleRows = CANONICAL_FIELDS_FIXTURE.filter(
    (field) => glByField[field.id] || bankByField[field.id] || field.required,
  );

  return (
    <div className="mapping-page">
      <div className="mapping-page__top">
        <button type="button" className="mapping-back-link" onClick={() => navigate(-1)}>
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
            <button type="button" className="secondary-button" onClick={() => navigate(-1)}>
              Cancel
            </button>
            <button type="button" className="accent-button" disabled={!readyToSave}>
              Save mapping profile
            </button>
          </div>
        </div>
      </div>

      <div className="mapping-uploads">
        <div className="mapping-upload mapping-upload--gl">
          <div className="mapping-upload__head">
            <span className="mapping-upload__title">General Ledger file</span>
            <span className="mapping-tag mapping-tag--gl">CSV</span>
          </div>
          <div className="mapping-upload__picker-row">
            <span className="mapping-picker">Choose GL file</span>
            <span className="mapping-upload__fname">gl_july_2026.csv (sample)</span>
          </div>
          <span className="mapping-upload__meta">{glCols.length} columns detected · header row only</span>
        </div>
        <div className="mapping-upload mapping-upload--bank">
          <div className="mapping-upload__head">
            <span className="mapping-upload__title">Bank transactions file</span>
            <span className="mapping-tag mapping-tag--bank">CSV</span>
          </div>
          <div className="mapping-upload__picker-row">
            <span className="mapping-picker">Choose bank file</span>
            <span className="mapping-upload__fname">chase_stmt_2026-07.csv (sample)</span>
          </div>
          <span className="mapping-upload__meta">{bankCols.length} columns detected · header row only</span>
        </div>
      </div>

      <div className="mapping-coverage">
        <span className="mapping-coverage__label">Required coverage</span>
        <span className="mapping-bar">
          <i
            className={glRequiredDone === REQUIRED_FIELD_IDS.length ? 'mapping-bar__fill mapping-bar__fill--gl-ok' : 'mapping-bar__fill'}
            style={{ width: `${Math.round((glRequiredDone / REQUIRED_FIELD_IDS.length) * 100)}%` }}
          />
        </span>
        <span className="mapping-coverage__count">
          GL {glRequiredDone}/{REQUIRED_FIELD_IDS.length}
        </span>
        <span className="mapping-bar">
          <i
            className={
              bankRequiredDone === REQUIRED_FIELD_IDS.length ? 'mapping-bar__fill mapping-bar__fill--bank-ok' : 'mapping-bar__fill'
            }
            style={{ width: `${Math.round((bankRequiredDone / REQUIRED_FIELD_IDS.length) * 100)}%` }}
          />
        </span>
        <span className="mapping-coverage__count">
          Bank {bankRequiredDone}/{REQUIRED_FIELD_IDS.length}
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
              <span className="mapping-canvas-head__sub">gl_july_2026.csv</span>
            </div>
            <div className="mapping-canvas-head__mid">maps to →</div>
            <div className="mapping-canvas-head__col mapping-canvas-head__col--center">
              <span className="mapping-canvas-head__title">Database columns</span>
              <span className="mapping-canvas-head__sub">canonical_transactions</span>
            </div>
            <div className="mapping-canvas-head__mid">← maps to</div>
            <div className="mapping-canvas-head__col mapping-canvas-head__col--end">
              <span className="mapping-canvas-head__title">Bank file columns</span>
              <span className="mapping-canvas-head__sub">chase_stmt_2026-07.csv</span>
            </div>
          </div>
        </div>
        <div className="mapping-canvas-viewport">
          <CreateMappingCanvas
            glCols={glCols}
            bankCols={bankCols}
            canonicalFields={CANONICAL_FIELDS_FIXTURE}
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
              <th>Database column</th>
              <th>Bank column</th>
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
                  <td className={gl ? 'mapping-table__col mapping-table__col--gl' : 'mapping-table__col mapping-table__col--empty'}>
                    {gl ?? '—'}
                  </td>
                  <td className="mapping-table__col mapping-table__col--db">{field.id}</td>
                  <td
                    className={bank ? 'mapping-table__col mapping-table__col--bank' : 'mapping-table__col mapping-table__col--empty'}
                  >
                    {bank ?? '—'}
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
